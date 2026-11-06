import React from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { createRoot } from 'react-dom/client';
import { LiveKitRoom, VideoConference, useParticipants } from '@livekit/components-react';
import '@livekit/components-styles';
import './style.css';
import MeetingRecorder from './MeetingRecorder.jsx';
import LiveCaptions from './LiveCaptions.jsx';

const NativeCallListener = registerPlugin('NativeCallListener');
function apiFetch(path, options) {
  const base = Capacitor.isNativePlatform() ? 'https://zoom-clone.pages.dev' : '';
  return fetch(base + path, options);
}

const RECORD_DB = 'meet-local-recordings';
function openRecordDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(RECORD_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('assets', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function saveRecordAsset(key, value) {
  const db = await openRecordDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('assets', 'readwrite');
    tx.objectStore('assets').put({ key, value });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
async function readRecordAsset(key) {
  const db = await openRecordDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('assets', 'readonly').objectStore('assets').get(key);
    request.onsuccess = () => { db.close(); resolve(request.result?.value ?? null); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}
async function deleteRecordAsset(key) {
  const db = await openRecordDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('assets', 'readwrite');
    tx.objectStore('assets').delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
function downloadLocalBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function AutoSaveMeetingContacts({ currentName, onRemember }) {
  const participants = useParticipants();
  React.useEffect(() => {
    participants.forEach(participant => {
      const displayName = String(participant.name || participant.identity || '').trim();
      if (displayName && displayName.toLowerCase() !== currentName.trim().toLowerCase()) onRemember(displayName);
    });
  }, [participants, currentName, onRemember]);
  return null;
}

function App() {
  const [room, setRoom] = React.useState('');
  const [name, setName] = React.useState(() => {
    try { return localStorage.getItem('meet-display-name') || ''; }
    catch { return ''; }
  });
  const [profileSaved, setProfileSaved] = React.useState(() => {
    try { return Boolean(localStorage.getItem('meet-display-name')); }
    catch { return false; }
  });
  const [callTarget, setCallTarget] = React.useState('');
  const [contacts, setContacts] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('meet-contacts') || '[]').filter(x => typeof x === 'string'); }
    catch { return []; }
  });
  const [incoming, setIncoming] = React.useState(null);
  const [dismissedCalls, setDismissedCalls] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('meet-dismissed-calls') || '[]'); }
    catch { return []; }
  });
  const [callMode, setCallMode] = React.useState(null);
  const [token, setToken] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [meetingError, setMeetingError] = React.useState('');
  const [notificationPermission, setNotificationPermission] = React.useState(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const [pushReady, setPushReady] = React.useState(() => { try { return localStorage.getItem('meet-push-ready') === 'yes'; } catch { return false; } });
  const [pendingVideo, setPendingVideo] = React.useState(null);
  const [originalTranscriptText, setOriginalTranscriptText] = React.useState('');
  const [translatedTranscriptText, setTranslatedTranscriptText] = React.useState('');
  const [transcriptStatus, setTranscriptStatus] = React.useState('');
  const [showTranscripts, setShowTranscripts] = React.useState(false);
  const [transcriptTab, setTranscriptTab] = React.useState('original');
  const [fullScreenCallAllowed, setFullScreenCallAllowed] = React.useState(true);
  const [batteryOptimizationIgnored, setBatteryOptimizationIgnored] = React.useState(true);
  const [permissionSetupOpen, setPermissionSetupOpen] = React.useState(() => { try { return Capacitor.isNativePlatform() && localStorage.getItem('convo-permissions-onboarding-v1') !== 'done'; } catch { return Capacitor.isNativePlatform(); } });
  const [startupPermissionResults, setStartupPermissionResults] = React.useState(null);
  const [permissionSetupBusy, setPermissionSetupBusy] = React.useState(false);
  const recorderRef = React.useRef(null);
  const audioContextRef = React.useRef(null);
  const [mediaReady, setMediaReady] = React.useState(false);
  const leavingRef = React.useRef(false);
  const notifiedCallRef = React.useRef('');

  React.useEffect(() => {
    let active = true;
    Promise.all([readRecordAsset('video'), readRecordAsset('originalTranscript'), readRecordAsset('translatedTranscript'), readRecordAsset('transcript')]).then(([video, original, translated, legacy]) => {
      if (!active) return;
      if (video) setPendingVideo(video);
      if (original) setOriginalTranscriptText(original);
      if (translated) setTranslatedTranscriptText(translated);
      // Older saved transcripts were English translations, so keep them under that label.
      if (!translated && legacy) setTranslatedTranscriptText(legacy);
      if (original || translated || legacy) setTranscriptStatus('ready');
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const handleRecordingFinished = React.useCallback(async ({ videoBlob, audioChunks, language }) => {
    if (videoBlob?.size) {
      setPendingVideo(videoBlob);
      try { await saveRecordAsset('video', videoBlob); }
      catch { setError('The recording finished, but this browser could not save it locally. Download it before closing this page.'); }
    }
    const audioBlob = new Blob(audioChunks || [], { type: audioChunks?.[0]?.type || 'audio/webm' });
    if (!audioBlob.size) { setTranscriptStatus('unavailable'); return; }
    setTranscriptStatus('processing');
    try {
      const response = await apiFetch('/api/transcribe?language=' + encodeURIComponent(language || 'ar'), {
        method: 'POST', headers: { 'Content-Type': audioBlob.type }, body: audioBlob
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Transcription could not be completed.');
      const originalText = String(result.originalText || '').trim();
      const translatedText = String(result.translatedText || '').trim();
      if (!originalText && !translatedText) throw new Error('No speech was detected in the recording.');
      setOriginalTranscriptText(originalText);
      setTranslatedTranscriptText(translatedText);
      setTranscriptStatus('ready');
      await Promise.all([
        saveRecordAsset('originalTranscript', originalText),
        saveRecordAsset('translatedTranscript', translatedText)
      ]);
    } catch (err) {
      setTranscriptStatus('error');
      setError('The video was saved, but the transcript failed: ' + (err.message || 'Please try again later.'));
    }
  }, []);

  function downloadPreviousMeeting() {
    if (!pendingVideo) return;
    downloadLocalBlob(pendingVideo, 'meet-previous-meeting.webm');
    setPendingVideo(null);
    deleteRecordAsset('video').catch(() => {});
  }

  React.useEffect(() => {
    const unlockAudio = () => {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        if (!audioContextRef.current) audioContextRef.current = new AudioContextClass();
        if (audioContextRef.current.state === 'suspended') audioContextRef.current.resume();
      } catch {}
    };
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    return () => { window.removeEventListener('pointerdown', unlockAudio); window.removeEventListener('keydown', unlockAudio); };
  }, []);

  React.useEffect(() => {
    if (!incoming) return;
    let stopped = false;
    const playChime = () => {
      const ctx = audioContextRef.current;
      if (!ctx || ctx.state !== 'running' || stopped) return;
      const now = ctx.currentTime;
      [660, 880].forEach((frequency, index) => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now + index * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.16, now + index * 0.18 + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.18 + 0.22);
        oscillator.connect(gain); gain.connect(ctx.destination);
        oscillator.start(now + index * 0.18); oscillator.stop(now + index * 0.18 + 0.24);
      });
    };
    playChime();
    const timer = window.setInterval(playChime, 1800);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [incoming]);

  React.useEffect(() => {
    try {
      const cleanName = name.trim();
      if (cleanName) {
        localStorage.setItem('meet-display-name', cleanName);
        setProfileSaved(true);
      } else {
        localStorage.removeItem('meet-display-name');
        setProfileSaved(false);
      }
    } catch { setProfileSaved(false); }
  }, [name]);

  React.useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let active = true;
    const check = () => {
      NativeCallListener.getFullScreenIntentStatus()
        .then(result => { if (active) setFullScreenCallAllowed(Boolean(result?.allowed)); })
        .catch(() => {});
      NativeCallListener.getBatteryOptimizationStatus()
        .then(result => { if (active) setBatteryOptimizationIgnored(Boolean(result?.ignored)); })
        .catch(() => {});
    };
    check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      active = false;
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  React.useEffect(() => {
    if (!Capacitor.isNativePlatform() || !name.trim()) return;
    try { if (localStorage.getItem('convo-permissions-onboarding-v1') !== 'done') return; } catch { return; }
    let active = true;
    const timer = window.setTimeout(() => {
      NativeCallListener.start({ identity: name.trim() })
        .catch(err => { if (active) setError(err.message || 'Could not start background call listening.'); });
    }, 1200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [name]);

  function urlBase64ToUint8Array(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  }

  async function enableNotifications() {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      return setError('Background notifications are not supported by this browser.');
    }
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission !== 'granted') {
        return setError(permission === 'denied' ? 'Notifications are blocked for this site. Allow them in browser settings.' : 'Notification permission was not granted.');
      }
      if (!name.trim()) return setError('Enter and save your display name first.');
      const configResponse = await apiFetch('/api/push/config', { cache: 'no-store' });
      const config = await configResponse.json();
      if (!configResponse.ok || !config.publicKey) throw Error(config.error || 'Push notifications are not configured on the server yet.');
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.publicKey)
        });
      }
      const saved = await apiFetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: name.trim(), subscription: subscription.toJSON() })
      });
      const result = await saved.json();
      if (!saved.ok) throw Error(result.error || 'Could not save this device for call alerts.');
      setPushReady(true);
      try { localStorage.setItem('meet-push-ready', 'yes'); } catch {}
      setError('');
    } catch (err) {
      setPushReady(false);
      try { localStorage.removeItem('meet-push-ready'); } catch {}
      setError(err.message || 'Could not enable background call alerts.');
    }
  }


  async function leaveMeeting() {
    leavingRef.current = true;
    if (recorderRef.current?.isRecording()) {
      setMeetingError('Finishing your recording…');
      await recorderRef.current.stopAndFinalize();
    }
    setToken('');
    setUrl('');
    setRoom('');
    setMeetingError('');
    setError('');
    setCallMode(null);
    setIncoming(null);
    // Keep the intentional-leave flag set until the next room is joined.
  }

  async function joinRoom(roomName) {
    leavingRef.current = false;
    if (Capacitor.isNativePlatform()) {
      await NativeCallListener.requestMediaPermissions();
    }
    const r = await apiFetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: roomName, identity: name.trim() })
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || 'Could not join the meeting.');
    if (!d.token || !d.url) throw Error('The meeting server returned an incomplete response.');
    setRoom(roomName);
    setToken(d.token);
    setUrl(d.url);
    setIncoming(null);
    setCallMode(null);
  }

  async function join(e) {
    e?.preventDefault();
    setError('');
    setMeetingError('');
    if (!name.trim()) return setError('Enter your name first.');
    const roomName = room.trim() || 'meet-' + Math.random().toString(36).slice(2, 8);
    setBusy(true);
    try { await joinRoom(roomName); }
    catch (err) { setError(err.message + ' Check that the server and LiveKit keys are configured.'); }
    finally { setBusy(false); }
  }

  const rememberContact = React.useCallback((value) => {
    const contact = value.trim().slice(0, 40);
    if (!contact || contact.toLowerCase() === name.trim().toLowerCase()) return;
    setContacts(previous => {
      if (previous.some(x => x.toLowerCase() === contact.toLowerCase())) return previous;
      const next = [...previous, contact].slice(-100);
      try { localStorage.setItem('meet-contacts', JSON.stringify(next)); } catch {}
      return next;
    });
  }, [name]);

  function removeContact(contact) {
    setContacts(previous => {
      const next = previous.filter(x => x !== contact);
      try { localStorage.setItem('meet-contacts', JSON.stringify(next)); } catch {}
      return next;
    });
  }

  async function startCall(e) {
    e?.preventDefault();
    setError('');
    const target = callTarget.trim();
    if (!name.trim()) return setError('Enter your name first.');
    if (!target) return setError('Enter the name of the person you want to call.');
    if (target.toLowerCase() === name.trim().toLowerCase()) return setError('You cannot call yourself.');
    setBusy(true);
    try {
      const r = await apiFetch('/api/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'invite', caller: name.trim(), callee: target })
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || 'Could not place the call.');
      setCallMode({ role: 'outgoing', room: d.room, peer: target });
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  function dismissIncomingCall(roomName) {
    setDismissedCalls(previous => {
      const next = [...new Set([...previous, roomName])].slice(-50);
      try { localStorage.setItem('meet-dismissed-calls', JSON.stringify(next)); } catch {}
      return next;
    });
    setIncoming(null);
  }

  async function answerCall(accept) {
    if (!incoming || busy) return;
    const call = incoming;
    setError('');
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(async registration => {
        const notices = await registration.getNotifications({ tag: 'meet-call-' + call.room });
        notices.forEach(notice => notice.close());
      }).catch(() => {});
    }
    if (!accept) dismissIncomingCall(call.room);
    setBusy(true);
    try {
      const r = await apiFetch('/api/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'respond',
          room: call.room,
          identity: name.trim(),
          accept
        })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(d.error || 'Could not respond to the call.');
      if (accept) await joinRoom(call.room);
    } catch (err) {
      setError(err.message || 'Could not respond to the call.');
    } finally { setBusy(false); }
  }

  React.useEffect(() => {
    if (!name.trim() || token || callMode?.role === 'outgoing' || incoming) return;
    let active = true;
    const check = async () => {
      try {
        const r = await apiFetch('/api/call?type=incoming&identity=' + encodeURIComponent(name.trim()), { cache: 'no-store' });
        const d = await r.json();
        if (active && r.ok) {
          const nextCall = (d.calls || []).find(call => !dismissedCalls.includes(call.room));
          if (nextCall) {
            setIncoming(current => current?.room === nextCall.room ? current : nextCall);
          } else {
            setIncoming(current => current && !(d.calls || []).some(call => call.room === current.room) ? null : current);
          }
        }
      } catch {}
    };
    check();
    const timer = setInterval(check, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [name, token, callMode, incoming, dismissedCalls, notificationPermission]);

  React.useEffect(() => {
    if (callMode?.role !== 'outgoing' || token) return;
    let active = true;
    const check = async () => {
      try {
        const q = new URLSearchParams({ type: 'status', room: callMode.room, identity: name.trim() });
        const r = await apiFetch('/api/call?' + q.toString(), { cache: 'no-store' });
        const d = await r.json();
        if (!active || !r.ok) return;
        if (d.status === 'accepted') {
          setCallMode(null);
          await joinRoom(callMode.room);
        } else if (d.status === 'declined' || d.status === 'expired') {
          setCallMode(null);
          setError(d.status === 'declined' ? callMode.peer + ' declined the call.' : 'No answer. The call has expired.');
        }
      } catch {}
    };
    check();
    const timer = setInterval(check, 2500);
    return () => { active = false; clearInterval(timer); };
  }, [callMode, token, name]);

  async function cancelCall() {
    if (!callMode) return;
    try {
      await apiFetch('/api/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'respond', room: callMode.room, identity: name.trim(), accept: false, cancel: true })
      });
    } catch {}
    setCallMode(null);
  }

  React.useEffect(() => {
    if (!Capacitor.isNativePlatform() || !name.trim()) return;
    let active = true;
    const openPendingCall = async () => {
      try {
        const result = await NativeCallListener.getPendingCall();
        if (!active || !result?.room) return;
        await NativeCallListener.clearPendingCall();
        await joinRoom(result.room);
      } catch (err) {
        if (active) setError(err.message || 'Could not open the accepted call.');
      }
    };
    window.addEventListener('meetNativeResume', openPendingCall);
    openPendingCall();
    return () => {
      active = false;
      window.removeEventListener('meetNativeResume', openPendingCall);
    };
  }, [name]);

  async function requestStartupPermissions() {
    setPermissionSetupBusy(true);
    try { const result = await NativeCallListener.requestStartupPermissions(); setStartupPermissionResults(result || {}); if (!result?.microphone) setError('Microphone access is needed to join calls. You can enable it from Android app permissions later.'); }
    catch (err) { setError(err.message || 'Could not request Android permissions.'); }
    finally { setPermissionSetupBusy(false); }
  }

  async function refreshPermissionSetup() {
    try { const values = await Promise.all([NativeCallListener.getFullScreenIntentStatus(), NativeCallListener.getBatteryOptimizationStatus()]); setFullScreenCallAllowed(Boolean(values[0]?.allowed)); setBatteryOptimizationIgnored(Boolean(values[1]?.ignored)); } catch {}
  }

  function finishPermissionSetup() {
    try { localStorage.setItem('convo-permissions-onboarding-v1', 'done'); } catch {}
    setPermissionSetupOpen(false); refreshPermissionSetup();
    if (name.trim()) NativeCallListener.start({ identity: name.trim() }).catch(() => {});
  }

  async function enableLockScreenCalls() {
    try { await NativeCallListener.openFullScreenIntentSettings(); window.setTimeout(refreshPermissionSetup, 1200); }
    catch (err) { setError(err.message || 'Could not open lock-screen call settings.'); }
  }

  async function enableBackgroundCalls() {
    try { await NativeCallListener.requestBatteryOptimizationExemption(); window.setTimeout(refreshPermissionSetup, 1200); }
    catch (err) { setError(err.message || 'Could not open background battery settings.'); }
  }

  async function showSharedScreenFullscreen() {
    const focusWrapper = document.querySelector('.lk-focus-layout-wrapper');
    const focusedScreen = focusWrapper?.querySelector('.lk-focus-layout .lk-participant-tile video');
    if (!focusWrapper || !focusedScreen) {
      setMeetingError('Start sharing your screen first, then choose Screen only.');
      return;
    }
    try { await focusWrapper.requestFullscreen(); }
    catch (err) { setMeetingError('Could not enter fullscreen: ' + (err?.message || 'Your browser blocked fullscreen.')); }
  }

  if (token) {
    return <div className="meeting">
      <header className="meeting-head">
        <div className="brand"><img className="brand-icon" src="/brand-icon.svg" alt="" /> Convo<span className="live">LIVE</span></div>
        <div className="room-label">Meeting · {room}</div>
        <button className="screen-only" onClick={showSharedScreenFullscreen} title="Show only the shared screen">Screen only ⛶</button>
        <button className="leave" onClick={leaveMeeting}>Leave meeting</button>
      </header>
      {meetingError && <div className="error meeting-error" role="alert">{meetingError}</div>}
      <LiveKitRoom
        data-lk-theme="default"
        token={token}
        serverUrl={url}
        connect={true}
        onError={(err) => setMeetingError('LiveKit connection error: ' + (err?.name ? err.name + ': ' : '') + (err?.message || 'Unknown error'))}
        onMediaDeviceFailure={(failure, kind) => {
          const device = kind === 'videoinput' ? 'Camera' : kind === 'audioinput' ? 'Microphone' : 'Camera or microphone';
          setMeetingError(device + ' access failed (' + (failure || 'unknown reason') + '). Use the Allow camera & microphone button and check that the device is not blocked by the operating system or another app.');
        }}
        onDisconnected={() => {
          if (!leavingRef.current) setMeetingError('You were disconnected from the meeting. You can leave and rejoin from the home screen.');
        }}
      >
        <AutoSaveMeetingContacts currentName={name} onRemember={rememberContact} />
        <MeetingRecorder ref={recorderRef} onFinished={handleRecordingFinished} />
        <LiveCaptions />
        <VideoConference />
      </LiveKitRoom>
    </div>;
  }

  if (showTranscripts) return <main className="transcript-page">
    <nav><div className="brand"><img className="brand-icon" src="/brand-icon.svg" alt="" /> Convo</div><button className="transcript-back" onClick={() => setShowTranscripts(false)}>← Back to home</button></nav>
    <section className="transcript-viewer">
      <div className="transcript-heading"><span>YOUR MEETING</span><h1>Conversation transcripts</h1><p>Read the original conversation or its English translation.</p></div>
      <div className="transcript-tabs">
        {originalTranscriptText && <button className={transcriptTab === 'original' ? 'active' : ''} onClick={() => setTranscriptTab('original')}>Original transcript</button>}
        {translatedTranscriptText && <button className={transcriptTab === 'english' ? 'active' : ''} onClick={() => setTranscriptTab('english')}>English translation</button>}
      </div>
      <article className="transcript-paper" dir={transcriptTab === 'english' ? 'ltr' : 'auto'}>
        <h2>{transcriptTab === 'english' ? 'English translation' : 'Original transcript'}</h2>
        <p>{transcriptTab === 'english' ? translatedTranscriptText : originalTranscriptText}</p>
      </article>
    </section>
  </main>;

  return <main>
    <nav><div className="brand"><img className="brand-icon" src="/brand-icon.svg" alt="" /> Convo</div><span className="nav-note">Video meetings, made simple.</span></nav>
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><i/> SIMPLE. CLEAR. CONNECTED.</div>
        <h1>Bring everyone<br/>into the <em>same room.</em></h1>
        <p>Meet face-to-face from anywhere. Call someone directly or join with a room code.</p>
        <div className="pills"><span>✦ HD video</span><span>↗ Screen sharing</span><span>◉ In-meeting chat</span></div>
      </div>
      <div className="join-card">
        <img className="card-mark" src="/brand-icon.svg" alt="Nexora" />
        <h2>Start a meeting</h2>
        <p className="card-sub">Your next conversation is one click away.</p>
        <div className="profile-label">
          <label>{profileSaved ? 'Your profile' : 'Sign in with your name'}</label>
          {profileSaved && <span className="saved-profile">✓ Saved on this device</span>}
        </div>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Enter your display name" maxLength="40" autoComplete="name"/>
        <form onSubmit={startCall}>
          <label>Call someone</label>
          <input value={callTarget} onChange={e=>setCallTarget(e.target.value)} placeholder="Enter their display name" maxLength="40"/>
          <div className="contacts-list">
            <div className="contacts-heading">SAVED CONTACTS <span>{contacts.length}</span></div>
            {contacts.length === 0 ? <p className="contacts-empty">People you meet will appear here automatically.</p> : contacts.map(contact => <div className="contact-item" key={contact}>
              <button type="button" className="contact-name" onClick={()=>setCallTarget(contact)} title="Select contact to call">
                <span className="contact-avatar">{contact.slice(0,1).toUpperCase()}</span><span>{contact}</span>
              </button>
              <button type="button" className="contact-call" onClick={()=>setCallTarget(contact)}>Call</button>
              <button type="button" className="contact-remove" onClick={()=>removeContact(contact)} aria-label={"Remove " + contact}>×</button>
            </div>)}
          </div>
          <button className="primary" disabled={busy}>{busy?'Please wait…':'Call'} <span>☎</span></button>
        </form>
        <div className="or-divider"><span>OR JOIN WITH A CODE</span></div>
        <form onSubmit={join}>
          <label>Meeting ID <small>optional</small></label>
          <input value={room} onChange={e=>setRoom(e.target.value)} placeholder="Enter a code or leave blank"/>
          <button className="secondary" disabled={busy}>Start / Join meeting <span>→</span></button>
        </form>
        {pendingVideo && <div className="previous-recording"><strong>Your previous meeting is ready</strong><button type="button" onClick={downloadPreviousMeeting}>Download previous meeting ↓</button></div>}
        {transcriptStatus === 'processing' && <div className="transcript-status">Preparing your transcript…</div>}
        {transcriptStatus === 'ready' && (originalTranscriptText || translatedTranscriptText) && <div className="previous-recording transcript-ready"><strong>Meeting transcripts are ready</strong><button type="button" onClick={() => { setTranscriptTab(originalTranscriptText ? 'original' : 'english'); setShowTranscripts(true); }}>View transcripts →</button></div>}
        {transcriptStatus === 'error' && <div className="transcript-status">Transcript could not be created. Your video recording is still available.</div>}
        {error&&<div className="error" role="alert">{error}</div>}
        {!Capacitor.isNativePlatform() && notificationPermission !== 'unsupported' && !pushReady && <div className="notification-row">
          <div><strong>Background call alerts</strong><span>{notificationPermission === 'denied' ? 'Blocked in browser settings' : 'Set up alerts when Meet is closed'}</span></div>
          <button type="button" onClick={enableNotifications}>{notificationPermission === 'granted' ? 'Finish setup' : 'Enable notifications'}</button>
        </div>}
        <div className="secure">Your name is remembered on this device. No password or account needed.</div>
      </div>
    </section>
    <section className="features">
      <div><b>01</b><strong>Face-to-face</strong><span>Camera and microphone controls.</span></div>
      <div><b>02</b><strong>Share your screen</strong><span>Present tabs, windows or your screen.</span></div>
      <div><b>03</b><strong>Stay in sync</strong><span>Participant grid and meeting chat.</span></div>
    </section>
    <footer>CONVO · A simple place to connect <span>Built for conversations.</span></footer>

    {Capacitor.isNativePlatform() && permissionSetupOpen && !token && !showTranscripts && <div className="permission-setup-backdrop" role="dialog" aria-modal="true" aria-labelledby="permission-setup-title">
      <section className="permission-setup-card">
        <div className="permission-setup-kicker">ONE-TIME SETUP</div>
        <h2 id="permission-setup-title">Get Convo ready for calls</h2>
        <p>Allow these once so calls can ring and meetings can use your camera and microphone. Android will show its own approval screens where required.</p>
        <div className="permission-setup-step"><strong>1. Camera, microphone & notifications</strong><span>{startupPermissionResults ? 'Microphone: ' + (startupPermissionResults.microphone ? 'allowed' : 'not allowed') + ' · Camera: ' + (startupPermissionResults.camera ? 'allowed' : 'not allowed') + ' · Notifications: ' + (startupPermissionResults.notifications ? 'allowed' : 'not allowed') : 'Request the normal Android permissions together.'}</span><button type="button" onClick={requestStartupPermissions} disabled={permissionSetupBusy}>{permissionSetupBusy ? 'Please wait…' : 'Allow permissions'}</button></div>
        <div className="permission-setup-step"><strong>2. Show calls over the lock screen</strong><span>{fullScreenCallAllowed ? 'Already allowed.' : 'Android may open a special access screen. Turn on full-screen notifications for Convo.'}</span>{!fullScreenCallAllowed && <button type="button" onClick={enableLockScreenCalls}>Open approval screen</button>}</div>
        <div className="permission-setup-step"><strong>3. Keep call checking active in the background</strong><span>{batteryOptimizationIgnored ? 'Battery optimization is already disabled for Convo.' : 'Approve the battery-use prompt. This may use more battery while your screen is off.'}</span>{!batteryOptimizationIgnored && <button type="button" onClick={enableBackgroundCalls}>Allow background running</button>}</div>
        <div className="permission-setup-note"><strong>Huawei phones:</strong> Android does not let Convo switch on Huawei’s Auto-launch, Secondary launch or Run in background controls automatically. If calls still fail while locked, Huawei may require those three switches in App launch settings.</div>
        <div className="permission-setup-actions"><button type="button" className="secondary" onClick={refreshPermissionSetup}>Check permissions</button><button type="button" className="primary" onClick={finishPermissionSetup}>Finish setup</button></div>
        <button type="button" className="permission-setup-skip" onClick={finishPermissionSetup}>Do this later</button>
      </section>
    </div>}
    {incoming && <div className="call-overlay">
      <div className="call-dialog">
        <div className="call-avatar">{incoming.caller?.slice(0,1).toUpperCase() || '?'}</div>
        <div className="call-kicker">INCOMING CALL</div>
        <h2>{incoming.caller}</h2>
        <p>is calling you</p>
        {error && <div className="error call-error" role="alert">{error}</div>}
        <div className="call-actions">
          <button className="decline-call" disabled={busy} onClick={()=>answerCall(false)}>Decline</button>
          <button className="accept-call" disabled={busy} onClick={()=>answerCall(true)}>Accept</button>
        </div>
      </div>
    </div>}

    {callMode?.role === 'outgoing' && <div className="call-overlay">
      <div className="call-dialog">
        <div className="call-avatar ringing">☎</div>
        <div className="call-kicker">CALLING</div>
        <h2>{callMode.peer}</h2>
        <p>Waiting for them to answer…</p>
        <button className="decline-call cancel-call" onClick={cancelCall}>Cancel call</button>
      </div>
    </div>}
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
