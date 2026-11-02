import React from 'react';
import { createRoot } from 'react-dom/client';
import { LiveKitRoom, VideoConference } from '@livekit/components-react';
import '@livekit/components-styles';
import './style.css';

function App() {
  const [room, setRoom] = React.useState('');
  const [name, setName] = React.useState('');
  const [token, setToken] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [meetingError, setMeetingError] = React.useState('');

  async function join(e) {
    e?.preventDefault();
    setError('');
    setMeetingError('');
    if (!name.trim()) return setError('Enter your name first.');
    const roomName = room.trim() || 'meet-' + Math.random().toString(36).slice(2, 8);
    setBusy(true);
    try {
      const r = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: roomName, identity: name.trim() })
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || 'Could not create meeting.');
      if (!d.token || !d.url) throw Error('The meeting server returned an incomplete response.');
      setToken(d.token);
      setUrl(d.url);
      setRoom(roomName);
    } catch (err) {
      setError(err.message + ' Check that the server and LiveKit keys are configured.');
    } finally {
      setBusy(false);
    }
  }

  if (token) {
    return <div className="meeting">
      <header className="meeting-head">
        <div className="brand"><span className="brand-icon">m</span> meet<span className="live">LIVE</span></div>
        <div className="room-label">Meeting · {room}</div>
        <button className="leave" onClick={() => { setToken(''); setMeetingError(''); }}>Leave meeting</button>
      </header>
      {meetingError && <div className="error" role="alert">{meetingError}</div>}
      <LiveKitRoom
        data-lk-theme="default"
        token={token}
        serverUrl={url}
        connect={true}
        video={true}
        audio={true}
        onError={(err) => setMeetingError('LiveKit connection error: ' + (err?.message || 'Unknown error'))}
        onDisconnected={() => setMeetingError('You were disconnected from the meeting. Check your internet connection and try joining again.')}
      >
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
        <p>Meet face-to-face from anywhere. Start an instant meeting or join with a room code.</p>
        <div className="pills"><span>✦ HD video</span><span>↗ Screen sharing</span><span>◉ In-meeting chat</span></div>
      </div>
      <form className="join-card" onSubmit={join}>
        <div className="card-mark">m</div>
        <h2>Start a meeting</h2>
        <p className="card-sub">Your next conversation is one click away.</p>
        <label>Your name</label>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Alex Morgan" maxLength="40"/>
        <label>Meeting ID <small>optional</small></label>
        <input value={room} onChange={e=>setRoom(e.target.value)} placeholder="Enter a code or leave blank"/>
        <button className="primary" disabled={busy}>{busy?'Connecting…':'Start / Join meeting'} <span>→</span></button>
        {error&&<div className="error" role="alert">{error}</div>}
        <div className="secure">🔒 Your browser will ask for camera and microphone access.</div>
      </form>
    </section>
    <section className="features">
      <div><b>01</b><strong>Face-to-face</strong><span>Camera and microphone controls.</span></div>
      <div><b>02</b><strong>Share your screen</strong><span>Present tabs, windows or your screen.</span></div>
      <div><b>03</b><strong>Stay in sync</strong><span>Participant grid and meeting chat.</span></div>
    </section>
    <footer>MEET · A simple place to connect <span>Built for conversations.</span></footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
