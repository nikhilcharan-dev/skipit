'use client';
import { useSession } from '../store';
import Setup from './Setup';
import Interview from './Interview';
import Results from './Results';

export default function SessionView({ sessionId }) {
  const { session } = useSession(sessionId);
  if (!session) return null;
  if (session.status === 'setup')     return <Setup sessionId={sessionId} />;
  if (session.status === 'interview') return <Interview sessionId={sessionId} />;
  if (session.status === 'results')   return <Results sessionId={sessionId} />;
  return null;
}
