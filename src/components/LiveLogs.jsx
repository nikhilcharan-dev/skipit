'use client';
import React, { useRef, useEffect, useState } from 'react';
import { useStore } from '../store';
import { Activity, X, CheckCircle, AlertCircle, Loader, Circle } from 'lucide-react';

export default function LiveLogs() {
  const { state } = useStore();
  const bodyRef = useRef(null);
  const [visible, setVisible] = useState(false);

  const activeSession = state.sessions.find(s => s.id === state.activeSessionId);
  const logs = activeSession?.logs || [];

  // Show panel whenever new logs are added
  useEffect(() => {
    if (logs.length > 0) setVisible(true);
  }, [logs.length]);

  // Auto-scroll to bottom on new log entries
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [logs]);

  function getIcon(status) {
    switch (status) {
      case 'active': return <Loader size={13} className="spin" />;
      case 'done':   return <CheckCircle size={13} />;
      case 'error':  return <AlertCircle size={13} />;
      default:       return <Circle size={13} />;
    }
  }

  function getElapsed(timestamp) {
    const secs = Math.floor((Date.now() - timestamp) / 1000);
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }

  if (!visible || logs.length === 0) return null;

  return (
    <div className="logs-panel">
      <div className="logs-header">
        <span className="logs-dot" />
        <Activity size={14} />
        <span>Live Progress</span>
        <button className="logs-close" onClick={() => setVisible(false)} aria-label="Close logs">
          <X size={14} />
        </button>
      </div>
      <div className="logs-body" ref={bodyRef}>
        {logs.map(log => (
          <div key={log.id} className={`log-entry ${log.status}`}>
            {getIcon(log.status)}
            <span className="log-msg">{log.msg}</span>
            <span className="log-time">{getElapsed(log.time)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
