'use client';
import { useEffect, useState } from 'react';
import { StoreProvider, useStore } from '../store';
import { loadSession } from '../api';
import Login from '../screens/Login';
import Dashboard from '../screens/Dashboard';
import SessionView from '../screens/SessionView';
import LiveLogs from '../components/LiveLogs';

function App() {
  const { state, patch } = useStore();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = loadSession();
    if (saved?.accessToken && saved?.email) {
      patch({
        loggedIn:    true,
        email:       saved.email,
        password:    saved.password    || '',
        userid:      saved.userid      || null,
        accessToken: saved.accessToken,
        collegeId:   saved.collegeId   || 5,
        sdt:         saved.sdt         || null,
        usr:         saved.usr         || null,
        screen:      'dashboard',
      });
    }
    setReady(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) return null;

  return (
    <>
      {state.screen === 'login'     && <Login />}
      {state.screen === 'dashboard' && <Dashboard />}

      {/* All sessions are always mounted once created; only the active one is visible
          when screen === 'session'. This keeps background interviews running. */}
      {state.sessions.map(s => (
        <div
          key={s.id}
          style={{
            display: state.screen === 'session' && s.id === state.activeSessionId
              ? 'block'
              : 'none',
          }}
        >
          <SessionView sessionId={s.id} />
        </div>
      ))}

      <LiveLogs />
    </>
  );
}

export default function Home() {
  return (
    <StoreProvider>
      <App />
    </StoreProvider>
  );
}
