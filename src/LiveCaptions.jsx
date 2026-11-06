import React from 'react';
import { Capacitor } from '@capacitor/core';
import { createPortal } from 'react-dom';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import './live-captions.css';

const SEGMENT_MS = 6000;
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

const LiveCaptions = () => {
  const room = useRoomContext();
  const [active, setActive] = React.useState(false);
  const [mode, setMode] = React.useState('original');
  const [lines, setLines] = React.useState([]);
  const [error, setError] = React.useState('');
  const [controlHost, setControlHost] = React.useState(null);
  const activeRef = React.useRef(false);
  const contextRef = React.useRef(null);
  const destinationRef = React.useRef(null);
  const sourcesRef = React.useRef(new Map());
  const recorderRef = React.useRef(null);
  const timerRef = React.useRef(0);
  const modeRef = React.useRef(mode);

  React.useEffect(() => { modeRef.current = mode; }, [mode]);

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
    try {
      if (recorderRef.current?.state && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    } catch {}
    recorderRef.current = null;
    try { sourcesRef.current.forEach(source => source.disconnect()); } catch {}
    sourcesRef.current.clear();
    try { contextRef.current?.close(); } catch {}
    contextRef.current = null;
    destinationRef.current = null;
    setActive(false);
  }, []);

  const captureSegment = React.useCallback(() => new Promise(resolve => {
    const stream = destinationRef.current?.stream;
    if (!stream || !activeRef.current) return resolve(null);
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) return resolve(null);
    let recorder;
    try { recorder = new MediaRecorder(stream, { mimeType }); }
    catch { return resolve(null); }
    const parts = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timerRef.current);
      recorderRef.current = null;
      resolve(parts.length ? new Blob(parts, { type: mimeType }) : null);
    };
    recorder.ondataavailable = event => { if (event.data?.size) parts.push(event.data); };
    recorder.onerror = finish;
    recorder.onstop = finish;
    recorderRef.current = recorder;
    try {
      recorder.start();
      timerRef.current = window.setTimeout(() => {
        try { if (recorder.state !== 'inactive') recorder.stop(); else finish(); }
        catch { finish(); }
      }, SEGMENT_MS);
    } catch { finish(); }
  }), []);

  const runCaptionLoop = React.useCallback(async () => {
    while (activeRef.current) {
      const blob = await captureSegment();
      if (!activeRef.current) break;
      if (!blob || blob.size < 1200) continue;
      try {
        const translate = modeRef.current === 'english';
        const response = await fetch(API_BASE + '/api/live-caption' + (translate ? '?translate=1' : ''), {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'audio/webm' },
          body: blob
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Live captions could not process this audio.');
        const text = String((translate ? result.translatedText : result.originalText) || '').trim();
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
      if (typeof MediaRecorder === 'undefined') throw new Error('This browser does not support live audio captions.');
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('This browser does not support live audio captions.');
      const context = new AudioContextClass();
      await context.resume();
      contextRef.current = context;
      destinationRef.current = context.createMediaStreamDestination();
      sourcesRef.current = new Map();
      connectTracks();
      if (!destinationRef.current.stream.getAudioTracks().length) {
        // Tracks can arrive shortly after joining; the track events below attach them.
      }
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
        <select aria-label="Caption language" value={mode} onChange={event => setMode(event.target.value)} disabled={active}>
          <option value="original">Original</option>
          <option value="english">English</option>
        </select>
        <button type="button" className={active ? 'captions-on' : 'captions-off'} onClick={active ? stopCaptions : startCaptions}>
          {active ? 'CC On' : 'CC'}
        </button>
      </div>,
      controlHost
    )}
    {active && lines.length > 0 && <div className={'live-caption-overlay' + (mode === 'english' ? ' caption-english' : '')} aria-live="polite">
      {lines.map((line, index) => <div className="live-caption-line" key={index}>{line}</div>)}
    </div>}
    {active && <div className="live-caption-status">AI captions on · audio is being processed</div>}
    {error && <div className="live-caption-error" role="status">{error}<button onClick={() => setError('')} aria-label="Dismiss caption error">×</button></div>}
  </>;
};

export default LiveCaptions;
