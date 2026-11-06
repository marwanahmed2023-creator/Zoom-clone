import React from 'react';
import { Capacitor } from '@capacitor/core';
import { createPortal } from 'react-dom';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import './live-captions.css';

const SEGMENT_MS = 6000;
const TARGET_RATE = 16000;
const API_BASE = Capacitor.isNativePlatform() ? 'https://zoom-clone.pages.dev' : '';

function roomAudioTracks(room) {
  const tracks = [];
  const add = participant => participant.audioTrackPublications?.forEach(publication => {
    const track = publication.track?.mediaStreamTrack;
    if (track?.readyState === 'live' && !tracks.includes(track)) tracks.push(track);
  });
  add(room.localParticipant);
  room.remoteParticipants?.forEach(add);
  return tracks;
}

function encodeWav(chunks, sourceRate) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (!total) return null;
  const input = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.length; }
  const outputLength = Math.max(1, Math.floor(input.length * TARGET_RATE / sourceRate));
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + outputLength * bytesPerSample);
  const view = new DataView(buffer);
  const write = (position, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(position + i, value.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + outputLength * bytesPerSample, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_RATE, true);
  view.setUint32(28, TARGET_RATE * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, outputLength * bytesPerSample, true);
  for (let i = 0; i < outputLength; i++) {
    const position = i * sourceRate / TARGET_RATE;
    const left = Math.floor(position);
    const fraction = position - left;
    const a = input[Math.min(left, input.length - 1)] || 0;
    const b = input[Math.min(left + 1, input.length - 1)] || 0;
    const sample = Math.max(-1, Math.min(1, a + (b - a) * fraction));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

const LiveCaptions = () => {
  const room = useRoomContext();
  const [active, setActive] = React.useState(false);
  const [lines, setLines] = React.useState([]);
  const [error, setError] = React.useState('');
  const [controlHost, setControlHost] = React.useState(null);
  const activeRef = React.useRef(false);
  const contextRef = React.useRef(null);
  const destinationRef = React.useRef(null);
  const sourcesRef = React.useRef(new Map());
  const processorRef = React.useRef(null);
  const monitorSourceRef = React.useRef(null);
  const silentGainRef = React.useRef(null);
  const segmentChunksRef = React.useRef(null);
  const segmentResolveRef = React.useRef(null);
  const timerRef = React.useRef(0);

  const connectTracks = React.useCallback(() => {
    const context = contextRef.current;
    const destination = destinationRef.current;
    if (!context || !destination) return;
    roomAudioTracks(room).forEach(track => {
      if (sourcesRef.current.has(track)) return;
      try {
        const source = context.createMediaStreamSource(new MediaStream([track]));
        source.connect(destination);
        sourcesRef.current.set(track, source);
      } catch {}
    });
  }, [room]);

  const stopCaptions = React.useCallback(() => {
    activeRef.current = false;
    window.clearTimeout(timerRef.current);
    segmentChunksRef.current = null;
    if (segmentResolveRef.current) {
      const resolve = segmentResolveRef.current;
      segmentResolveRef.current = null;
      resolve(null);
    }
    try { processorRef.current?.disconnect(); } catch {}
    try { monitorSourceRef.current?.disconnect(); } catch {}
    try { silentGainRef.current?.disconnect(); } catch {}
    processorRef.current = null;
    monitorSourceRef.current = null;
    silentGainRef.current = null;
    try { sourcesRef.current.forEach(source => source.disconnect()); } catch {}
    sourcesRef.current.clear();
    try { contextRef.current?.close(); } catch {}
    contextRef.current = null;
    destinationRef.current = null;
    setActive(false);
  }, []);

  const captureSegment = React.useCallback(() => new Promise(resolve => {
    if (!activeRef.current || !contextRef.current) return resolve(null);
    segmentChunksRef.current = [];
    segmentResolveRef.current = blob => resolve(blob);
    timerRef.current = window.setTimeout(() => {
      const chunks = segmentChunksRef.current || [];
      segmentChunksRef.current = null;
      segmentResolveRef.current = null;
      resolve(encodeWav(chunks, contextRef.current?.sampleRate || TARGET_RATE));
    }, SEGMENT_MS);
  }), []);

  const runCaptionLoop = React.useCallback(async () => {
    while (activeRef.current) {
      const blob = await captureSegment();
      if (!activeRef.current) break;
      if (!blob || blob.size < 1200) continue;
      try {
        const response = await fetch(API_BASE + '/api/live-caption', {
          method: 'POST',
          headers: { 'Content-Type': 'audio/wav' },
          body: blob
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Live captions could not process this audio.');
        const text = String(result.originalText || '').trim();
        if (text && activeRef.current) setLines(previous => [...previous, text].slice(-3));
      } catch (err) {
        if (activeRef.current) {
          setError(err.message || 'Live captions stopped unexpectedly.');
          stopCaptions();
        }
      }
    }
  }, [captureSegment, stopCaptions]);

  const startCaptions = React.useCallback(async () => {
    if (activeRef.current) return;
    const accepted = window.confirm('Live captions send meeting audio to Convo’s AI service for transcription. Audio is processed for captions and is not saved by Convo. Turn captions on only when everyone in the meeting knows.');
    if (!accepted) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('This browser does not support live audio captions.');
      const context = new AudioContextClass();
      await context.resume();
      contextRef.current = context;
      destinationRef.current = context.createMediaStreamDestination();
      sourcesRef.current = new Map();
      connectTracks();

      const monitorSource = context.createMediaStreamSource(destinationRef.current.stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      processor.onaudioprocess = event => {
        const chunks = segmentChunksRef.current;
        if (activeRef.current && chunks) chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      monitorSource.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(context.destination);
      monitorSourceRef.current = monitorSource;
      processorRef.current = processor;
      silentGainRef.current = silentGain;

      activeRef.current = true;
      setError('');
      setLines([]);
      setActive(true);
      runCaptionLoop();
    } catch (err) {
      stopCaptions();
      setError(err.message || 'Could not start live captions.');
    }
  }, [connectTracks, runCaptionLoop, stopCaptions]);

  React.useEffect(() => {
    const update = () => connectTracks();
    room.on(RoomEvent.TrackSubscribed, update);
    room.on(RoomEvent.TrackPublished, update);
    room.on(RoomEvent.LocalTrackPublished, update);
    return () => {
      room.off(RoomEvent.TrackSubscribed, update);
      room.off(RoomEvent.TrackPublished, update);
      room.off(RoomEvent.LocalTrackPublished, update);
    };
  }, [room, connectTracks]);

  React.useEffect(() => {
    let host = null;
    const attach = () => {
      const bar = document.querySelector('.lk-control-bar');
      if (!bar) return;
      if (!host) {
        host = document.createElement('div');
        host.className = 'live-caption-control-host';
      }
      const recorderHost = bar.querySelector('.meet-recorder-host');
      if (recorderHost) {
        if (host.parentElement !== recorderHost.parentElement || host.previousElementSibling !== recorderHost) recorderHost.after(host);
      } else if (host.parentElement !== bar) bar.appendChild(host);
      setControlHost(current => current === host ? current : host);
    };
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      host?.remove();
      setControlHost(null);
    };
  }, []);

  React.useEffect(() => () => stopCaptions(), [stopCaptions]);

  return <>
    {controlHost && createPortal(
      <div className="live-caption-controls">
        <button type="button" className={active ? 'captions-on' : 'captions-off'} onClick={active ? stopCaptions : startCaptions}>
          {active ? 'CC On' : 'CC'}
        </button>
      </div>,
      controlHost
    )}
    {active && lines.length > 0 && <div className="live-caption-overlay" aria-live="polite">
      {lines.map((line, index) => <div className="live-caption-line" key={index}>{line}</div>)}
    </div>}
    {active && <div className="live-caption-status">AI captions on · audio is being processed</div>}
    {error && <div className="live-caption-error" role="status">{error}<button onClick={() => setError('')} aria-label="Dismiss caption error">×</button></div>}
  </>;
};

export default LiveCaptions;
