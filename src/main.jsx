import React from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { createRoot } from 'react-dom/client';
import { LiveKitRoom, VideoConference, useParticipants } from '@livekit/components-react';
import '@livekit/components-styles';
import './style.css';

const NativeCallListener = registerPlugin('NativeCallListener');

function apiFetch(path, options) {
  const base = Capacitor.isNativePlatform() ? 'https://zoom-clone.pages.dev' : '';
  return fetch(base + path, options);
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
  const [nativeListening, setNativeListening] = React.useState(false);
  const audioContextRef = React.useRef(null);
  const [mediaReady, setMediaReady] = React.useState(false);
  const leavingRef = React.useRef(false);
  const notifiedCallRef = React.useRef('');

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


  function leaveMeeting() {
    leavingRef.current = true;
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
        if (active && r.ok && d.calls?.length) {
          const nextCall = d.calls.find(call => !dismissedCalls.includes(call.room));
          if (nextCall) {
            setIncoming(nextCall);

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

  async function startNativeCallAlerts() {
    if (!name.trim()) return setError('Enter and save your display name first.');
    try {
      await NativeCallListener.start({ identity: name.trim() });
      setNativeListening(true);
      setError('');
    } catch (err) {
      setError(err.message || 'Could not start native call alerts.');
    }
  }

  async function stopNativeCallAlerts() {
    try {
      await NativeCallListener.stop();
      setNativeListening(false);
    } catch (err) {
      setError(err.message || 'Could not stop native call alerts.');
    }
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
        <div className="brand"><span className="brand-icon">m</span> meet<span className="live">LIVE</span></div>
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
        <VideoConference />
      </LiveKitRoom>
    </div>;
  }

  return <main>
    <nav><div className="brand"><span className="brand-icon">m</span> meet</div><span className="nav-note">Video meetings, made simple.</span></nav>
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><i/> SIMPLE. CLEAR. CONNECTED.</div>
        <h1>Bring everyone<br/>into the <em>same room.</em></h1>
        <p>Meet face-to-face from anywhere. Call someone directly or join with a room code.</p>
        <div className="pills"><span>✦ HD video</span><span>↗ Screen sharing</span><span>◉ In-meeting chat</span></div>
      </div>
      <div className="join-card">
        <div className="card-mark">m</div>
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
        {error&&<div className="error" role="alert">{error}</div>}
        {!Capacitor.isNativePlatform() && notificationPermission !== 'unsupported' && !pushReady && <div className="notification-row">
          <div><strong>Background call alerts</strong><span>{notificationPermission === 'denied' ? 'Blocked in browser settings' : 'Set up alerts when Meet is closed'}</span></div>
          <button type="button" onClick={enableNotifications}>{notificationPermission === 'granted' ? 'Finish setup' : 'Enable notifications'}</button>
        </div>}
        {Capacitor.isNativePlatform() && <div className="notification-row">
          <div><strong>Native call alerts</strong><span>{nativeListening ? 'Listening for calls, even when Meet is closed' : 'Enable background calling on this phone'}</span></div>
          <button type="button" onClick={nativeListening ? stopNativeCallAlerts : startNativeCallAlerts}>{nativeListening ? 'Stop listening' : 'Enable call alerts'}</button>
        </div>}
        <div className="secure">Your name is remembered on this device. No password or account needed.</div>
      </div>
    </section>
    <section className="features">
      <div><b>01</b><strong>Face-to-face</strong><span>Camera and microphone controls.</span></div>
      <div><b>02</b><strong>Share your screen</strong><span>Present tabs, windows or your screen.</span></div>
      <div><b>03</b><strong>Stay in sync</strong><span>Participant grid and meeting chat.</span></div>
    </section>
    <footer>MEET · A simple place to connect <span>Built for conversations.</span></footer>

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
