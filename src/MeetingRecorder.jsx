import React from 'react';
import { createPortal } from 'react-dom';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import './recorder.css';

const AUDIO_CHUNK_MS = 30000;

function getAudioTracks(room) {
  const tracks = [];
  const add = participant => {
    participant.audioTrackPublications?.forEach(publication => {
      const track = publication.track?.mediaStreamTrack;
      if (track?.readyState === 'live' && !tracks.includes(track)) tracks.push(track);
    });
  };
  add(room.localParticipant);
  room.remoteParticipants?.forEach(add);
  return tracks;
}

function drawCover(ctx, video, x, y, width, height) {
  const vw = video.videoWidth || 16;
  const vh = video.videoHeight || 9;
  const scale = Math.max(width / vw, height / vh);
  const sw = width / scale;
  const sh = height / scale;
  const sx = (vw - sw) / 2;
  const sy = (vh - sh) / 2;
  ctx.drawImage(video, sx, sy, sw, sh, x, y, width, height);
}

const MeetingRecorder = React.forwardRef(function MeetingRecorder({ onFinished }, ref) {
  const room = useRoomContext();
  const [recording, setRecording] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [remoteRecording, setRemoteRecording] = React.useState(null);
  const [controlHost, setControlHost] = React.useState(null);
  const recorderRef = React.useRef(null);
  const audioRecorderRef = React.useRef(null);
  const audioContextRef = React.useRef(null);
  const audioDestinationRef = React.useRef(null);
  const audioSourcesRef = React.useRef(new Map());
  const videoChunksRef = React.useRef([]);
  const audioChunksRef = React.useRef([]);
  const canvasRef = React.useRef(null);
  const animationRef = React.useRef(0);
  const timerRef = React.useRef(0);
  const startedAtRef = React.useRef(0);
  const stopPromiseRef = React.useRef(null);
  const resolveStopRef = React.useRef(null);
  const broadcastRecording = React.useCallback(active => {
    const payload = new TextEncoder().encode(JSON.stringify({
      type: 'meet-recording-state', active,
      owner: room.localParticipant.name || room.localParticipant.identity
    }));
    room.localParticipant.publishData(payload, { reliable: true }).catch(() => {});
  }, [room]);


  React.useEffect(() => {
    let host = null;
    let observer = null;
    const attach = () => {
      const bar = document.querySelector('.lk-control-bar');
      if (!bar) return false;
      const shareButton = bar.querySelector('[data-lk-source="screen_share"], button[aria-label*="Share screen" i], button[aria-label*="Start screen share" i]');
      if (!host) {
        host = document.createElement('div');
        host.className = 'meet-recorder-host';
      }
      if (shareButton) {
        if (host.parentElement !== shareButton.parentElement || host.previousElementSibling !== shareButton) shareButton.after(host);
      } else if (host.parentElement !== bar) {
        bar.appendChild(host);
      }
      setControlHost(host);
      return true;
    };
    attach();
    observer = new MutationObserver(() => attach());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer?.disconnect();
      if (host?.parentElement) host.remove();
      setControlHost(null);
    };
  }, []);



  const connectAudioTracks = React.useCallback(() => {
    const context = audioContextRef.current;
    const destination = audioDestinationRef.current;
    if (!context || !destination) return;
    getAudioTracks(room).forEach(track => {
      if (audioSourcesRef.current.has(track) || track.readyState !== 'live') return;
      try {
        const source = context.createMediaStreamSource(new MediaStream([track]));
        source.connect(destination);
        audioSourcesRef.current.set(track, source);
      } catch {}
    });
  }, [room]);

  const drawFrame = React.useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const wrapper = document.querySelector('.lk-video-conference');
    if (!canvas || !ctx || !wrapper) {
      animationRef.current = requestAnimationFrame(drawFrame);
      return;
    }
    const bounds = wrapper.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, bounds.width);
    const scaleY = canvas.height / Math.max(1, bounds.height);
    ctx.fillStyle = '#10131b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const tiles = wrapper.querySelectorAll('.lk-participant-tile');
    let drawn = 0;
    tiles.forEach(tile => {
      const video = tile.querySelector('video');
      if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
      const rect = tile.getBoundingClientRect();
      const x = (rect.left - bounds.left) * scaleX;
      const y = (rect.top - bounds.top) * scaleY;
      const w = rect.width * scaleX;
      const h = rect.height * scaleY;
      if (w <= 0 || h <= 0) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(Math.max(0, x), Math.max(0, y), Math.min(canvas.width, w), Math.min(canvas.height, h));
      ctx.clip();
      drawCover(ctx, video, x, y, w, h);
      ctx.restore();
      drawn += 1;
    });
    if (!drawn) {
      ctx.fillStyle = '#f2f4f8';
      ctx.font = '28px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Meet recording', canvas.width / 2, canvas.height / 2);
    }
    animationRef.current = requestAnimationFrame(drawFrame);
  }, []);

  const startRecording = React.useCallback(async () => {
    if (recording || recorderRef.current) return;
    const videoMime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!videoMime) throw new Error('This browser cannot create a supported meeting recording.');
    const audioMime = ['audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!audioMime) throw new Error('This browser cannot create the audio needed for a transcript.');
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Audio recording is not supported in this browser.');

    const audioContext = new AudioContextClass();
    await audioContext.resume();
    const destination = audioContext.createMediaStreamDestination();
    audioContextRef.current = audioContext;
    audioDestinationRef.current = destination;
    audioSourcesRef.current = new Map();
    connectAudioTracks();

    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    canvasRef.current = canvas;
    const canvasStream = canvas.captureStream(24);
    const combined = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...destination.stream.getAudioTracks()
    ]);

    videoChunksRef.current = [];
    audioChunksRef.current = [];
    const videoRecorder = new MediaRecorder(combined, { mimeType: videoMime, videoBitsPerSecond: 2500000 });
    const audioRecorder = new MediaRecorder(new MediaStream(destination.stream.getAudioTracks()), { mimeType: audioMime });
    videoRecorder.ondataavailable = event => { if (event.data?.size) videoChunksRef.current.push(event.data); };
    audioRecorder.ondataavailable = event => { if (event.data?.size) audioChunksRef.current.push(event.data); };
    videoRecorder.onerror = () => finishRecording();
    videoRecorder.onstop = () => {
      broadcastRecording(false);
      const videoBlob = new Blob(videoChunksRef.current, { type: videoMime });
      const audioChunks = [...audioChunksRef.current];
      cleanup();
      onFinished?.({ videoBlob, audioChunks, language: 'auto' });
      resolveStopRef.current?.();
      resolveStopRef.current = null;
      stopPromiseRef.current = null;
    };
    recorderRef.current = videoRecorder;
    audioRecorderRef.current = audioRecorder;
    startedAtRef.current = Date.now();
    videoRecorder.start(1000);
    audioRecorder.start(AUDIO_CHUNK_MS);
    broadcastRecording(true);
    setRecording(true);
    setElapsed(0);
    animationRef.current = requestAnimationFrame(drawFrame);
    timerRef.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 1000);
  }, [recording, connectAudioTracks, drawFrame, onFinished, broadcastRecording]);

  const cleanup = React.useCallback(() => {
    cancelAnimationFrame(animationRef.current);
    window.clearInterval(timerRef.current);
    try { audioSourcesRef.current.forEach(source => source.disconnect()); } catch {}
    audioSourcesRef.current.clear();
    try { audioContextRef.current?.close(); } catch {}
    audioContextRef.current = null;
    audioDestinationRef.current = null;
    canvasRef.current = null;
    recorderRef.current = null;
    audioRecorderRef.current = null;
    setRecording(false);
  }, []);

  const finishRecording = React.useCallback(() => {
    const videoRecorder = recorderRef.current;
    if (!videoRecorder || videoRecorder.state === 'inactive') return Promise.resolve();
    if (stopPromiseRef.current) return stopPromiseRef.current;
    stopPromiseRef.current = new Promise(resolve => { resolveStopRef.current = resolve; });
    try {
      if (audioRecorderRef.current?.state !== 'inactive') audioRecorderRef.current.stop();
      videoRecorder.stop();
    } catch {
      cleanup();
      resolveStopRef.current?.();
      resolveStopRef.current = null;
      stopPromiseRef.current = null;
    }
    return stopPromiseRef.current || Promise.resolve();
  }, [cleanup]);

  React.useImperativeHandle(ref, () => ({
    stopAndFinalize: finishRecording,
    isRecording: () => Boolean(recorderRef.current && recorderRef.current.state !== 'inactive')
  }), [finishRecording]);

  React.useEffect(() => {
    const onData = payload => {
      try {
        const message = JSON.parse(new TextDecoder().decode(payload));
        if (message?.type === 'meet-recording-state') setRemoteRecording(message.active ? { owner: message.owner || 'A participant' } : null);
      } catch {}
    };
    const onParticipantLeft = participant => {
      setRemoteRecording(current => current && current.owner === (participant.name || participant.identity) ? null : current);
    };
    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantLeft);
    const update = () => connectAudioTracks();
    room.on(RoomEvent.TrackSubscribed, update);
    room.on(RoomEvent.TrackPublished, update);
    room.on(RoomEvent.LocalTrackPublished, update);
    room.on(RoomEvent.TrackUnsubscribed, update);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantLeft);
      room.off(RoomEvent.TrackSubscribed, update);
      room.off(RoomEvent.TrackPublished, update);
      room.off(RoomEvent.LocalTrackPublished, update);
      room.off(RoomEvent.TrackUnsubscribed, update);
    };
  }, [room, connectAudioTracks]);

  React.useEffect(() => () => {
    if (recorderRef.current?.state !== 'inactive') {
      try { audioRecorderRef.current?.stop(); recorderRef.current.stop(); } catch {}
    }
    cancelAnimationFrame(animationRef.current);
    window.clearInterval(timerRef.current);
    try { audioContextRef.current?.close(); } catch {}
  }, []);

  const formatTime = value => {
    const mins = Math.floor(value / 60).toString().padStart(2, '0');
    const secs = (value % 60).toString().padStart(2, '0');
    return mins + ':' + secs;
  };

  return <>
    {remoteRecording && <div className="recording-notice">● This meeting is being recorded by {remoteRecording.owner}</div>}
    {controlHost && createPortal(<div className="meet-recorder-controls">
      {recording ? <>
        <span className="recording-indicator"><i/> REC {formatTime(elapsed)}</span>
        <button type="button" className="record-stop" onClick={finishRecording}>Stop</button>
      </> : <>
        <button type="button" className="record-start" onClick={() => startRecording().catch(error => window.alert(error.message))}>● Record</button>
      </>}
    </div>, controlHost)}
  </>;
});

export default MeetingRecorder;
