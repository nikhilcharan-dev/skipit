'use client';
import React, { createContext, useContext, useReducer, useCallback } from 'react';

// ─── Per-session state shape ───────────────────────────────────────────────────

export const SESSION_INITIAL_STATE = {
  id: null,
  status: 'setup',        // 'setup' | 'interview' | 'results'
  createdAt: null,

  // Auth snapshot (copied from global at creation)
  userid: null,
  accessToken: '',
  email: '',
  collegeId: 5,

  // Setup
  interviewType: 'SKILL',
  selectedSubjects: [],
  subjects: [],
  profileid: null,
  sessionState: null,
  interviewPanel: [],
  _profileId: 24,
  _setId: 1,
  resumeFile: null,
  resumeFileMeta: null,

  // Per-session AI provider toggle
  aiProvider: 'bedrock',

  // Interview runtime
  questions: [],
  currentQ: 0,
  answers: [],
  autoMode: false,
  timerSecs: 0,
  violations: { tab: 0, full: 0 },
  logs: [],
  serverResults: null,
};

// ─── Global state (auth + navigation only) ────────────────────────────────────

export const initialState = {
  screen: 'login',        // 'login' | 'dashboard' | 'session'
  loggedIn: false,
  email: '',
  password: '',
  userid: null,
  accessToken: '',
  collegeId: 5,
  usr: null,
  sdt: null,
  studentInfo: null,
  nvidiaApiKey: '',       // user's own NVIDIA key (global setting)
  sessions: [],
  activeSessionId: null,
};

// ─── Reducer ──────────────────────────────────────────────────────────────────

function reducer(state, action) {
  switch (action.type) {
    case 'PATCH':
      return { ...state, ...action.payload };

    case 'ADD_SESSION':
      return { ...state, sessions: [...state.sessions, action.session] };

    case 'PATCH_SESSION':
      return {
        ...state,
        sessions: state.sessions.map(s =>
          s.id === action.id ? { ...s, ...action.payload } : s
        ),
      };

    case 'ADD_SESSION_LOG': {
      return {
        ...state,
        sessions: state.sessions.map(s => {
          if (s.id !== action.id) return s;
          const exists = s.logs.some(l => l.id === action.log.id);
          const logs = exists
            ? s.logs.map(l => l.id === action.log.id ? { ...l, ...action.log } : l)
            : [...s.logs, action.log];
          return { ...s, logs };
        }),
      };
    }

    case 'UPDATE_SESSION_LOG':
      return {
        ...state,
        sessions: state.sessions.map(s => {
          if (s.id !== action.id) return s;
          return {
            ...s,
            logs: s.logs.map(l =>
              l.id === action.logId ? { ...l, ...action.patch } : l
            ),
          };
        }),
      };

    case 'RESET_SESSION_DATA':
      return {
        ...state,
        sessions: state.sessions.map(s => {
          if (s.id !== action.id) return s;
          return {
            ...s,
            questions: [], currentQ: 0, answers: [],
            autoMode: false, timerSecs: 0,
            violations: { tab: 0, full: 0 },
            sessionState: null, interviewPanel: [],
            resumeFile: null, resumeFileMeta: null,
            logs: [], serverResults: null,
          };
        }),
      };

    case 'REMOVE_SESSION': {
      const remaining = state.sessions.filter(s => s.id !== action.id);
      return {
        ...state,
        sessions: remaining,
        activeSessionId:
          state.activeSessionId === action.id
            ? (remaining[0]?.id ?? null)
            : state.activeSessionId,
      };
    }

    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

const Ctx = createContext(null);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const patch = useCallback(
    (payload) => dispatch({ type: 'PATCH', payload }),
    [dispatch]
  );

  return React.createElement(
    Ctx.Provider,
    { value: { state, dispatch, patch } },
    children
  );
}

export const useStore = () => useContext(Ctx);

// ─── Per-session hook ─────────────────────────────────────────────────────────

export function useSession(sessionId) {
  const { state, dispatch } = useContext(Ctx);
  const session = state.sessions.find(s => s.id === sessionId) ?? null;

  const patchSession = useCallback(
    (payload) => dispatch({ type: 'PATCH_SESSION', id: sessionId, payload }),
    [dispatch, sessionId]
  );

  const addLog = useCallback(
    (logId, msg, status = 'active') =>
      dispatch({ type: 'ADD_SESSION_LOG', id: sessionId, log: { id: logId, msg, status, time: Date.now() } }),
    [dispatch, sessionId]
  );

  const updateLog = useCallback(
    (logId, msg, status) =>
      dispatch({ type: 'UPDATE_SESSION_LOG', id: sessionId, logId, patch: { msg, status } }),
    [dispatch, sessionId]
  );

  const resetSession = useCallback(
    () => dispatch({ type: 'RESET_SESSION_DATA', id: sessionId }),
    [dispatch, sessionId]
  );

  return { session, patchSession, addLog, updateLog, resetSession };
}
