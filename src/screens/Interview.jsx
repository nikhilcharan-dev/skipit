'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useStore, useSession } from '../store';
import {
  apiPost, bedrockAnswer, buildFirstQPayload, buildNextQPayload,
  buildAudioPsurlPayload, buildInterviewFinalPayload, normalizeQ, formatTime,
  fetchTts, uploadAudioToS3, recordBlackCanvas,
} from '../api';
import {
  Clock, Mic, MicOff, SkipForward, ArrowRight, XCircle,
  Zap, Monitor, Maximize, Cpu, Layers, LayoutDashboard,
} from 'lucide-react';

export default function Interview({ sessionId }) {
  const { state: globalState, patch } = useStore();
  const { session, patchSession, addLog, updateLog } = useSession(sessionId);

  // ── Local UI state ────────────────────────────────────────────────────────
  const [textAnswer, setTextAnswer] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [displayTime, setDisplayTime] = useState('00:00');

  // ── Refs to avoid stale closures ──────────────────────────────────────────
  const timerRef = useRef(null);
  const timerSecsRef = useRef(0);
  const sessionStateRef = useRef(null);
  const autoModeRef = useRef(false);
  const questionsRef = useRef([]);
  const currentQRef = useRef(0);
  const answersRef = useRef([]);
  const audioPsurlsRef = useRef({});
  const audioSizesRef = useRef({});

  // Keep refs in sync with session
  useEffect(() => { autoModeRef.current = session?.autoMode; }, [session?.autoMode]);
  useEffect(() => { questionsRef.current = session?.questions || []; }, [session?.questions]);
  useEffect(() => { currentQRef.current = session?.currentQ || 0; }, [session?.currentQ]);
  useEffect(() => { answersRef.current = session?.answers || []; }, [session?.answers]);

  // ── Timer ─────────────────────────────────────────────────────────────────
  function startTimer() {
    timerSecsRef.current = 0;
    timerRef.current = setInterval(() => {
      timerSecsRef.current++;
      setDisplayTime(formatTime(timerSecsRef.current));
    }, 1000);
  }

  function stopTimer() { clearInterval(timerRef.current); }

  // ── Subject helpers ───────────────────────────────────────────────────────
  function getSelSubs() {
    const selectedSubjects = session?.selectedSubjects || [];
    const subjects = session?.subjects || [];
    return selectedSubjects.map(id => {
      const s = subjects.find(s => s.id === id);
      return s
        ? { id: s.id, label: s.label || s.display_name, value: s.value || s.display_name, display_name: s.display_name || s.label }
        : { id, label: 'Subject', value: 'Subject', display_name: 'Subject' };
    });
  }

  // ── End interview ─────────────────────────────────────────────────────────
  async function endInterview() {
    stopTimer();

    const lastQ = questionsRef.current[currentQRef.current];
    let serverResults = null;
    if (lastQ) {
      const selSubs = getSelSubs();
      const snap = { ...session, sessionState: sessionStateRef.current };
      const finalPayload  = buildInterviewFinalPayload(snap, selSubs, lastQ, timerSecsRef.current, false);
      const updatePayload = buildInterviewFinalPayload(snap, selSubs, lastQ, timerSecsRef.current, true);

      try {
        console.log('[endInterview] recording canvas video...');
        const videoBlob = await recordBlackCanvas(3000);
        console.log('[endInterview] video blob:', videoBlob.size, 'bytes,', videoBlob.type);
        finalPayload.video.file.size  = videoBlob.size;
        finalPayload.video.file.type  = videoBlob.type;
        updatePayload.video.file.size = videoBlob.size;
        updatePayload.video.file.type = videoBlob.type;

        console.log('[endInterview] calling interview-presigned-url...');
        const psRes = await apiPost(
          'update-profile/api/sdt/update-profile/interview-presigned-url', finalPayload
        );
        const videoPsurl = psRes?.video?.psurl;
        if (videoPsurl?.url) {
          const s3ok = await uploadAudioToS3(
            videoPsurl, await videoBlob.arrayBuffer(), finalPayload.video.file.name, videoBlob.type
          );
          console.log('[endInterview] S3 upload ok:', s3ok);
        }
      } catch (e) { console.error('[endInterview] video/psurl error:', e.message); }

      try {
        console.log('[endInterview] calling update-interview-profile...');
        serverResults = await apiPost(
          'update-profile/api/sdt/update-profile/update-interview-profile', updatePayload
        );
      } catch (e) { console.error('[endInterview] update-interview-profile error:', e.message); }
    }

    patchSession({ status: 'results', timerSecs: timerSecsRef.current, serverResults });
  }

  // ── Fetch next question ───────────────────────────────────────────────────
  async function fetchNext(prevQ, answerText) {
    const selSubs = getSelSubs();
    const nextIdx = currentQRef.current + 1;

    if (nextIdx >= (prevQ.max_count || 16)) {
      endInterview();
      return;
    }

    setLoading(true);
    const actualAudioSize = audioSizesRef.current[prevQ.qno] || 0;
    const snap = { ...session, sessionState: sessionStateRef.current };

    // Fire-and-forget performance metrics
    const metricsPayload = buildNextQPayload(snap, selSubs, prevQ, answerText, timerSecsRef.current);
    metricsPayload.audio_file.file.size = actualAudioSize;
    apiPost(
      'performance-metrics/api/sdt/update-profile/generate-performance-metrics-for-each-question',
      metricsPayload
    ).catch(() => {});

    addLog('fnq-' + nextIdx, `Fetching Q${nextIdx + 1}…`, 'active');
    try {
      const payload = buildNextQPayload(snap, selSubs, prevQ, answerText, timerSecsRef.current);
      payload.audio_file.file.size = actualAudioSize;
      const r = await apiPost(
        'interview-questions/api/sdt/update-profile/fetch-next-question',
        payload
      );
      const q = r?.q || r?.data?.q || (r?.question ? r : null);
      if (q?.question) {
        const newQ = normalizeQ(q, selSubs, timerSecsRef.current);
        patchSession({ questions: [...questionsRef.current, newQ], currentQ: nextIdx });
        updateLog('fnq-' + nextIdx, `Q${nextIdx + 1} ready`, 'done');
        apiPost('interview-questions/api/sdt/update-profile/generate-psurl-for-audio',
          buildAudioPsurlPayload(snap, selSubs, newQ, null, timerSecsRef.current)
        ).then(r => {
          const psurl = r?.audio_file?.psurl;
          if (psurl?.url) audioPsurlsRef.current[newQ.qno] = psurl;
        }).catch(() => {});
      } else {
        updateLog('fnq-' + nextIdx, 'Interview complete', 'done');
        endInterview();
      }
    } catch {
      updateLog('fnq-' + nextIdx, 'Fetch failed', 'error');
      endInterview();
    }
    setLoading(false);
  }

  // ── Submit answer ─────────────────────────────────────────────────────────
  async function submitAnswer(answerText) {
    const prevQ = questionsRef.current[currentQRef.current];
    const answer = answerText || '(Voice recording)';
    const newAnswers = [
      ...answersRef.current,
      {
        qid: prevQ.qid,
        question: prevQ.question,
        subject: prevQ.subject,
        answer,
        time: formatTime(timerSecsRef.current),
      },
    ];
    patchSession({ answers: newAnswers });
    setTextAnswer('');

    const isSkipped = !answerText || answerText === '(Skipped)';
    if (!isSkipped) {
      const psurl = audioPsurlsRef.current[prevQ.qno];
      const textToSpeak = typeof answerText === 'string' ? answerText : '';
      try {
        const result = await fetchTts(textToSpeak);
        if (result) {
          audioSizesRef.current[prevQ.qno] = result.buffer.byteLength;
          if (psurl) {
            const filename = `${session?.userid?.user_cat_id}-${session?.profileid?.profile_id || 24}-question-${prevQ.qno}.wav`;
            uploadAudioToS3(psurl, result.buffer, filename, 'audio/wav').catch(() => {});
          }
        }
      } catch {}
    }

    await fetchNext(prevQ, answerText);
  }

  function handleSkip() {
    if (loading) return;
    submitAnswer('(Skipped)');
  }

  // ── Init on mount ─────────────────────────────────────────────────────────
  useEffect(() => {
    async function initInterview() {
      startTimer();

      const selSubs = getSelSubs();
      const isHR = session?.interviewType === 'HR';

      // Stage 1: resume-presigned-url
      addLog('rpu', isHR ? 'Uploading resume…' : 'Getting resume URL…', 'active');
      let resumePsurl = {};
      try {
        const r = await apiPost(
          'update-profile/api/sdt/update-resume/resume-presigned-url',
          {
            userid: session?.userid,
            resume: {
              file: isHR && session?.resumeFileMeta ? session.resumeFileMeta : {},
              psurl: {},
            },
            profileid: {
              dept:       session?.profileid?.dept,
              sem:        session?.profileid?.sem,
              set_id:     session?.profileid?.set_id,
              profile_id: session?.profileid?.profile_id,
              date:       session?.profileid?.date,
            },
            interview_type_code: session?.interviewType,
            access_token:        session?.accessToken,
          }
        );
        resumePsurl = r?.resume?.psurl || r?.psurl || {};
        if (isHR && session?.resumeFile && resumePsurl?.url) {
          const buf = await session.resumeFile.arrayBuffer();
          await uploadAudioToS3(resumePsurl, buf, session.resumeFileMeta.name, session.resumeFileMeta.type).catch(() => {});
          console.log('[initInterview] resume uploaded to S3');
        }
        updateLog('rpu', isHR ? 'Resume uploaded' : 'Resume URL ready', 'done');
      } catch {
        updateLog('rpu', 'Resume URL skipped', 'done');
      }

      // Stage 2: process-uploaded-resume
      addLog('pur', 'Processing profile…', 'active');
      let sessionState = {};
      try {
        const r = await apiPost(
          'update-profile/api/sdt/update-resume/process-uploaded-resume',
          {
            userid:              session?.userid,
            resume: {
              file: isHR && session?.resumeFileMeta ? session.resumeFileMeta : {},
              psurl: {},
            },
            profileid:           session?.profileid,
            access_token:        session?.accessToken,
            interview_type_code: session?.interviewType,
            subjects_selected:   selSubs,
          }
        );
        sessionState = r || {};
        sessionStateRef.current = sessionState;
        patchSession({ sessionState, interviewPanel: r?.interview_panel || [] });
        updateLog('pur', 'Profile processed', 'done');
      } catch {
        updateLog('pur', 'Using default session', 'done');
      }

      // Stage 3: fetch-first-question
      addLog('ffq', 'Loading first question…', 'active');
      try {
        const snap = { ...session, sessionState };
        const payload = buildFirstQPayload(snap, selSubs);
        const r = await apiPost(
          'interview-questions/api/sdt/update-profile/fetch-first-question',
          payload
        );
        const panel = r?.interview_panel || r?.data?.interview_panel;
        if (panel) patchSession({ interviewPanel: panel });
        const q = r?.q || r?.data?.q || (r?.question ? r : null);
        if (q?.question) {
          const firstQ = normalizeQ(q, selSubs, timerSecsRef.current);
          patchSession({ questions: [firstQ], currentQ: 0 });
          updateLog('ffq', 'Q1 ready', 'done');
          apiPost('interview-questions/api/sdt/update-profile/generate-psurl-for-audio',
            buildAudioPsurlPayload({ ...session, sessionState }, selSubs, firstQ, null, timerSecsRef.current)
          ).then(r => {
            const psurl = r?.audio_file?.psurl;
            if (psurl?.url) audioPsurlsRef.current[firstQ.qno] = psurl;
          }).catch(() => {});
        } else {
          updateLog('ffq', 'No question returned', 'error');
        }
      } catch {
        updateLog('ffq', 'First question failed', 'error');
      }
    }

    initInterview();
    return () => { stopTimer(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-mode: AI answers when currentQ changes ───────────────────────────
  useEffect(() => {
    if (!session?.autoMode || !session?.questions?.[session?.currentQ]) return;
    let cancelled = false;
    const q = session.questions[session.currentQ];
    const providerLabel = session.aiProvider === 'nvidia' ? 'NVIDIA' : 'Bedrock';
    addLog('ai-' + session.currentQ, `${providerLabel} answering Q${session.currentQ + 1}…`, 'active');
    const resumeCtx = session.interviewType === 'HR'
      ? (sessionStateRef.current?.introq?.resume_data || session.sessionState?.introq?.resume_data || null)
      : null;
    const nvidiaKey = globalState.nvidiaApiKey || '';
    bedrockAnswer(q.question, q.subject, session.aiProvider, resumeCtx, nvidiaKey).then(answer => {
      if (cancelled) return;
      if (answer) {
        setTextAnswer(answer);
        updateLog('ai-' + session.currentQ, `${providerLabel} answer ready`, 'done');
        setTimeout(() => {
          if (!cancelled && autoModeRef.current) submitAnswer(answer);
        }, 2000);
      } else {
        updateLog('ai-' + session.currentQ, `${providerLabel} failed`, 'error');
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.currentQ, session?.autoMode, session?.questions?.length]);

  // ── Derived values ────────────────────────────────────────────────────────
  const currentQuestion = session?.questions?.[session?.currentQ] || null;
  const totalQ = session?.questions?.length || 0;
  const progressPct = totalQ > 0
    ? Math.round(((session?.currentQ || 0) / Math.max(currentQuestion?.max_count || 16, totalQ)) * 100)
    : 0;

  const panelMember = session?.interviewPanel?.[0] || null;
  const panelName = panelMember?.name || panelMember?.display_name || 'AI Interviewer';
  const panelRole = panelMember?.role || panelMember?.designation || 'Senior Engineer';
  const panelLetter = panelName.charAt(0).toUpperCase();

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="interview-screen">
      {/* ── Header ── */}
      <header className="interview-header">
        <div className="interview-header-left">
          <span className="q-counter">
            Q {(session?.currentQ || 0) + 1} / {currentQuestion?.max_count || '—'}
          </span>
          <div style={{ width: 120 }}>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        </div>

        <div className="timer">
          <Clock size={14} />
          <span>{displayTime}</span>
        </div>

        <div className="interview-header-right">
          {/* AI provider toggle */}
          <div className="provider-toggle">
            <button
              className={`provider-btn${session?.aiProvider === 'bedrock' ? ' active' : ''}`}
              onClick={() => patchSession({ aiProvider: 'bedrock' })}
              title="Use AWS Bedrock"
            >
              <Layers size={12} /> Bedrock
            </button>
            <button
              className={`provider-btn${session?.aiProvider === 'nvidia' ? ' active' : ''}`}
              onClick={() => patchSession({ aiProvider: 'nvidia' })}
              title="Use NVIDIA NIM"
            >
              <Cpu size={12} /> NVIDIA
            </button>
          </div>

          <button
            className={`btn btn-sm btn-auto${session?.autoMode ? ' on' : ''}`}
            onClick={() => patchSession({ autoMode: !session?.autoMode })}
            title="Toggle Auto AI Mode"
          >
            <Zap size={14} />
            {session?.autoMode ? 'Auto ON' : 'Auto'}
          </button>

          <button
            className="btn btn-sm btn-outline"
            onClick={() => patch({ screen: 'dashboard' })}
            title="Back to Dashboard (interview keeps running)"
          >
            <LayoutDashboard size={14} />
            Dashboard
          </button>

          <button
            className="btn btn-sm btn-danger"
            onClick={endInterview}
            title="End Interview"
          >
            <XCircle size={14} />
            End
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="interview-body">
        <div className="interview-main">
          {/* Panel info */}
          <div className="panel-info">
            <div className="panel-avatar">{panelLetter}</div>
            <div>
              <div className="panel-name">{panelName}</div>
              <div className="panel-role">{panelRole}</div>
            </div>
          </div>

          {/* Question box */}
          <div className="question-box">
            {currentQuestion ? (
              <>
                <span className="badge badge-accent">{currentQuestion.subject}</span>
                <p className="question-text">{currentQuestion.question}</p>
              </>
            ) : (
              <p className="question-text" style={{ color: 'var(--text-muted)' }}>
                Loading question…
              </p>
            )}
          </div>

          {/* Answer area */}
          <div className="answer-area">
            <div className="record-row">
              <button
                className={`record-btn${isRecording ? ' recording' : ''}`}
                onClick={() => setIsRecording(r => !r)}
                title={isRecording ? 'Stop recording' : 'Start recording'}
                disabled={loading || !currentQuestion}
              >
                {isRecording ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
              <span className="record-status">
                {isRecording ? 'Recording… click to stop' : 'Click to record your answer'}
              </span>
            </div>

            <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
              — or type below —
            </div>

            <textarea
              className="answer-textarea"
              placeholder="Type your answer here…"
              value={textAnswer}
              onChange={e => setTextAnswer(e.target.value)}
              disabled={loading || !currentQuestion}
            />

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                className="btn btn-outline btn-sm"
                onClick={handleSkip}
                disabled={loading || !currentQuestion}
              >
                <SkipForward size={14} />
                Skip
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => submitAnswer(textAnswer)}
                disabled={loading || !currentQuestion || (!textAnswer.trim() && !isRecording)}
              >
                {loading ? 'Loading…' : 'Submit & Next'}
                {!loading && <ArrowRight size={14} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="interview-footer">
        <div className="violations">
          <span className="violation-item">
            <Monitor size={13} />
            Tab Switches: {session?.violations?.tab || 0}
          </span>
          <span className="violation-item">
            <Maximize size={13} />
            Fullscreen Exits: {session?.violations?.full || 0}
          </span>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
          {session?.interviewType === 'HR' ? 'HR Interview' : 'Skill Interview'}
        </span>
      </footer>
    </div>
  );
}
