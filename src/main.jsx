import React from 'react';
import { createRoot } from 'react-dom/client';
import { LiveKitRoom, VideoConference, useRoomContext } from '@livekit/components-react';
import '@livekit/components-styles';
import './style.css';

function MediaPermissionButton({ onStatus }) {
  const room = useRoomContext();
  const [working, setWorking] = React.useState(false);
  async function enableDevices() {
    setWorking(true);
    onStatus('');
    try {
      await room.localParticipant.setCameraEnabled(true);
      await room.localParticipant.setMicrophoneEnabled(true);
      onStatus('Camera and microphone are enabled.');
    } catch (err) {
      const name = err?.name || 'Error';
      const detail = err?.message || 'The browser or device blocked access.';
      onStatus(name + ': ' + detail);
    } finally {
      setWorking(false);
    }
  }
  return <div className="media-permission">
    <span>Camera and microphone are off.</span>
    <button onClick={enableDevices} disabled={working}>{working ? 'Requesting access…' : 'Allow camera & microphone'}</button>
  </div>;
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
  const [mediaReady, setMediaReady] = React.useState(false);
  const leavingRef = React.useRef(false);
  const notifiedCallRef = React.useRef('');

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

  async function enableNotifications() {
    if (!('Notification' in window)) return setError('This browser does not support notifications.');
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === 'granted') setError('');
    else setError(permission === 'denied' ? 'Notifications are blocked for this site. Allow them in browser site settings.' : 'Notification permission was not granted.');
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
    const r = await fetch('/api/token', {
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

  async function startCall(e) {
    e?.preventDefault();
    setError('');
    const target = callTarget.trim();
    if (!name.trim()) return setError('Enter your name first.');
    if (!target) return setError('Enter the name of the person you want to call.');
    if (target.toLowerCase() === name.trim().toLowerCase()) return setError('You cannot call yourself.');
    setBusy(true);
    try {
      const r = await fetch('/api/call', {
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
      const r = await fetch('/api/call', {
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
        const r = await fetch('/api/call?type=incoming&identity=' + encodeURIComponent(name.trim()), { cache: 'no-store' });
        const d = await r.json();
        if (active && r.ok && d.calls?.length) {
          const nextCall = d.calls.find(call => !dismissedCalls.includes(call.room));
          if (nextCall) {
            setIncoming(nextCall);
            if (notificationPermission === 'granted' && notifiedCallRef.current !== nextCall.room) {
              notifiedCallRef.current = nextCall.room;
              try {
                const notice = new Notification('Incoming meet call', { body: nextCall.caller + ' is calling you.' });
                notice.onclick = () => { window.focus(); notice.close(); };
              } catch {}
            }
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
        const r = await fetch('/api/call?' + q.toString(), { cache: 'no-store' });
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
      await fetch('/api/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'respond', room: callMode.room, identity: name.trim(), accept: false, cancel: true })
      });
    } catch {}
    setCallMode(null);
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
        <div className="brand"><span className="brand-icon">m</span> meet<span className="live">LIVE</span></div>
        <div className="room-label">Meeting · {room}</div>
        <button className="screen-only" onClick={showSharedScreenFullscreen} title="Show only the shared screen">Screen only ⛶</button>
        <button className="leave" onClick={() => window.location.reload()}>Leave meeting</button>
      </header>
      {meetingError && <div className="error meeting-error" role="alert">{meetingError}</div>}
      <LiveKitRoom
        data-lk-theme="default"
        token={token}
        serverUrl={url}
        connect={true}
        onError={(err) => setMeetingError('LiveKit connection error: ' + (err?.message || 'Unknown error'))}
        onDisconnected={() => {
          if (!leavingRef.current) setMeetingError('You were disconnected from the meeting. You can leave and rejoin from the home screen.');
        }}
      >
        <MediaPermissionButton onStatus={setMeetingError} />
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
          <button className="primary" disabled={busy}>{busy?'Please wait…':'Call'} <span>☎</span></button>
        </form>
        <div className="or-divider"><span>OR JOIN WITH A CODE</span></div>
        <form onSubmit={join}>
          <label>Meeting ID <small>optional</small></label>
          <input value={room} onChange={e=>setRoom(e.target.value)} placeholder="Enter a code or leave blank"/>
          <button className="secondary" disabled={busy}>Start / Join meeting <span>→</span></button>
        </form>
        {error&&<div className="error" role="alert">{error}</div>}
        <div className="notification-row">
          <div><strong>Incoming call alerts</strong><span>{notificationPermission === 'granted' ? 'Notifications enabled' : notificationPermission === 'denied' ? 'Blocked in browser settings' : 'Allow alerts while this page is open'}</span></div>
          <button type="button" onClick={enableNotifications} disabled={notificationPermission === 'granted' || notificationPermission === 'unsupported'}>
            {notificationPermission === 'granted' ? 'Enabled' : 'Enable notifications'}
          </button>
        </div>
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
