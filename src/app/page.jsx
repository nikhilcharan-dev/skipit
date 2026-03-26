'use client';
import { useEffect } from 'react';
import { StoreProvider, useStore } from '../store';
import { loadSession, signIn, saveSession } from '../api';
import Login from '../screens/Login';
import Dashboard from '../screens/Dashboard';
import Setup from '../screens/Setup';
import Interview from '../screens/Interview';
import Results from '../screens/Results';
import LiveLogs from '../components/LiveLogs';

function App() {
  const { state, patch } = useStore();

  useEffect(() => {
    const saved = loadSession();
    if (!saved?.email || !saved?.password) return;
    signIn(saved.email, saved.password).then(result => {
      if (result?.loggedIn) {
        patch(result);
        saveSession(result);
        patch({ screen: 'dashboard' });
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {state.screen === 'login'     && <Login />}
      {state.screen === 'dashboard' && <Dashboard />}
      {state.screen === 'setup'     && <Setup />}
      {state.screen === 'interview' && <Interview />}
      {state.screen === 'results'   && <Results />}
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
