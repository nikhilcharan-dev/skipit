'use client';
import React, { createContext, useContext, useReducer } from 'react';

export const initialState = {
  // navigation
  screen: 'login', // 'login' | 'dashboard' | 'setup' | 'interview' | 'results'

  // auth
  loggedIn: false,
  email: '',
  password: '',
  userid: null,        // { user_id, user_category, user_cat_id }
  accessToken: '',
  collegeId: 5,
  usr: null,           // raw sign-in usr object
  sdt: null,           // raw sign-in sdt object
  studentInfo: null,   // from fetch-student-information

  // setup
  interviewType: 'SKILL',   // 'SKILL' | 'COMPREHENSIVE'
  selectedSubjects: [],     // array of subject IDs (numbers)
  subjects: [],             // [{ id, display_name, label, value }]
  profileid: null,          // { dept, sem, set_id, profile_id, experience, date }
  sessionState: null,       // from process-uploaded-resume (has introq, interview_panel, voice, sts, etc.)
  interviewPanel: [],       // extracted from sessionState or fetch-first-question
  _profileId: 24,           // from fetch-interview-types response
  _setId: 1,                // from fetch-interview-types response
  resumeFile: null,

  // AI provider
  aiProvider: 'bedrock',  // 'bedrock' | 'nvidia'

  // interview runtime
  questions: [],            // [{ qid, qno, question, qtype, subject, subjectObj, subjectId, max_count, start }]
  currentQ: 0,              // index into questions array
  answers: [],              // [{ qid, question, subject, answer, time }]
  autoMode: false,
  timerSecs: 0,
  violations: { tab: 0, full: 0 },

  // live logs
  logs: [],                 // [{ id, msg, status, time }] status: 'active'|'done'|'error'|'pending'

  // server results from update-interview-profile response
  serverResults: null,      // raw response; contains set[].profiles[].interview_percentage + metrics[]
};

function reducer(state, action) {
  switch (action.type) {
    case 'PATCH':
      return { ...state, ...action.payload };
    case 'ADD_LOG': {
      const exists = state.logs.some(l => l.id === action.log.id);
      if (exists) return { ...state, logs: state.logs.map(l => l.id === action.log.id ? { ...l, ...action.log } : l) };
      return { ...state, logs: [...state.logs, action.log] };
    }
    case 'UPDATE_LOG':
      return { ...state, logs: state.logs.map(l => l.id === action.id ? { ...l, ...action.patch } : l) };
    case 'CLEAR_LOGS':
      return { ...state, logs: [] };
    case 'RESET_INTERVIEW':
      return {
        ...state,
        questions: [], currentQ: 0, answers: [],
        autoMode: false, timerSecs: 0,
        violations: { tab: 0, full: 0 },
        sessionState: null, interviewPanel: [],
        resumeFile: null, logs: [], serverResults: null,
      };
    default:
      return state;
  }
}

const Ctx = createContext(null);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  /** Shallow-merge a patch into state */
  const patch = (payload) => dispatch({ type: 'PATCH', payload });

  /** Add a live log entry */
  const addLog = (id, msg, status = 'active') =>
    dispatch({ type: 'ADD_LOG', log: { id, msg, status, time: Date.now() } });

  /** Update an existing log entry by id */
  const updateLog = (id, msg, status) =>
    dispatch({ type: 'UPDATE_LOG', id, patch: { msg, status } });

  /** Reset all interview state (called when starting a new interview) */
  const resetInterview = () => dispatch({ type: 'RESET_INTERVIEW' });

  return React.createElement(
    Ctx.Provider,
    { value: { state, patch, addLog, updateLog, resetInterview } },
    children
  );
}

export const useStore = () => useContext(Ctx);
