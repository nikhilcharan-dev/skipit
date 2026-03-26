'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import {
  apiPost, bedrockAnswer, buildFirstQPayload, buildNextQPayload,
  buildAudioPsurlPayload, buildInterviewFinalPayload, normalizeQ, formatTime,
  fetchTts, uploadAudioToS3, recordBlackCanvas,
} from '../api';
import {
  Clock, Mic, MicOff, SkipForward, ArrowRight, XCircle,
  Zap, Monitor, Maximize, Cpu, Layers,
} from 'lucide-react';

export default function Interview() {
  const { state, patch, addLog, updateLog, resetInterview } = useStore();

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
  // qno → { url, fields } presigned POST data for audio upload
  const audioPsurlsRef = useRef({});
  // qno → actual TTS buffer byte size (sent in fetch-next-question / generate-performance-metrics)
  const audioSizesRef = useRef({});

  // Keep refs in sync with store
  useEffect(() => { autoModeRef.current = state.autoMode; }, [state.autoMode]);
  useEffect(() => { questionsRef.current = state.questions; }, [state.questions]);
  useEffect(() => { currentQRef.current = state.currentQ; }, [state.currentQ]);
  useEffect(() => { answersRef.current = state.answers; }, [state.answers]);

  // ── Timer ─────────────────────────────────────────────────────────────────
  function startTimer() {
    timerSecsRef.current = 0;
    timerRef.current = setInterval(() => {
      timerSecsRef.current++;
      setDisplayTime(formatTime(timerSecsRef.current));
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerRef.current);
  }

  // ── Subject helpers ───────────────────────────────────────────────────────
  function getSelSubs() {
    return state.selectedSubjects.map(id => {
      const s = state.subjects.find(s => s.id === id);
      return s
        ? { id: s.id, label: s.label || s.display_name, value: s.value || s.display_name, display_name: s.display_name || s.label }
        : { id, label: 'Subject', value: 'Subject', display_name: 'Subject' };
    });
  }

  // ── Tab-switch handler ────────────────────────────────────────────────────
  function onTabSwitch() {
    if (document.hidden) {
      patch({ violations: { ...state.violations, tab: state.violations.tab + 1 } });
    }
  }

  // ── End interview ─────────────────────────────────────────────────────────
  async function endInterview() {
    stopTimer();
    document.removeEventListener('visibilitychange', onTabSwitch);

    const lastQ = questionsRef.current[currentQRef.current];
    let serverResults = null;
    if (lastQ) {
      const selSubs = getSelSubs();
      const stateSnap = { ...state, sessionState: sessionStateRef.current };
      const finalPayload = buildInterviewFinalPayload(stateSnap, selSubs, lastQ, timerSecsRef.current, false);
      const updatePayload = buildInterviewFinalPayload(stateSnap, selSubs, lastQ, timerSecsRef.current, true);

      try {
        console.log('[endInterview] recording canvas video...');
        const videoBlob = await recordBlackCanvas(3000);
        console.log('[endInterview] video blob:', videoBlob.size, 'bytes,', videoBlob.type);
        finalPayload.video.file.size  = videoBlob.size;
        finalPayload.video.file.type  = videoBlob.type;
        updatePayload.video.file.size = videoBlob.size;
        updatePayload.video.file.type = videoBlob.type;
        console.log('[endInterview] video filename:', finalPayload.video.file.name);

        console.log('[endInterview] calling interview-presigned-url...');
        const psRes = await apiPost(
          'update-profile/api/sdt/update-profile/interview-presigned-url', finalPayload
        );
        console.log('[endInterview] psurl sts:', psRes?.sts?.sts, '| has_psurl:', !!(psRes?.video?.psurl?.url));
        const videoPsurl = psRes?.video?.psurl;
        if (videoPsurl?.url) {
          console.log('[endInterview] uploading video to S3, key:', videoPsurl.fields?.key);
          const s3ok = await uploadAudioToS3(
            videoPsurl, await videoBlob.arrayBuffer(), finalPayload.video.file.name, videoBlob.type
          );
          console.log('[endInterview] S3 upload ok:', s3ok);
        } else {
          console.warn('[endInterview] no psurl — skipping S3 upload');
        }
      } catch (e) { console.error('[endInterview] video/psurl error:', e.message); }

      try {
        console.log('[endInterview] calling update-interview-profile...');
        serverResults = await apiPost(
          'update-profile/api/sdt/update-profile/update-interview-profile', updatePayload
        );
        console.log('[endInterview] update-interview-profile sts:', serverResults?.sts?.sts, '| msg:', serverResults?.sts?.msg);
      } catch (e) { console.error('[endInterview] update-interview-profile error:', e.message); }
    }

    patch({ screen: 'results', timerSecs: timerSecsRef.current, serverResults });
  }

  // ── Fetch next question ───────────────────────────────────────────────────
  async function fetchNext(prevQ, answerText) {
    const selSubs = getSelSubs();
    const nextIdx = currentQRef.current + 1;

    // Client-side guard: stop once max_count is reached
    if (nextIdx >= (prevQ.max_count || 16)) {
      endInterview();
      return;
    }

    setLoading(true);

    // Inject real audio size (captured from TTS response) so the server knows audio was recorded.
    // Real site sends actual byte size (e.g. 98828); size:0 tells the server no audio was uploaded.
    const actualAudioSize = audioSizesRef.current[prevQ.qno] || 0;

    // Fire-and-forget performance metrics
    const metricsPayload = buildNextQPayload({ ...state, sessionState: sessionStateRef.current }, selSubs, prevQ, answerText, timerSecsRef.current);
    metricsPayload.audio_file.file.size = actualAudioSize;
    apiPost(
      'performance-metrics/api/sdt/update-profile/generate-performance-metrics-for-each-question',
      metricsPayload
    ).catch(() => {});

    addLog('fnq-' + nextIdx, `Fetching Q${nextIdx + 1}…`, 'active');
    try {
      const payload = buildNextQPayload(
        { ...state, sessionState: sessionStateRef.current },
        selSubs, prevQ, answerText, timerSecsRef.current
      );
      payload.audio_file.file.size = actualAudioSize;
      const r = await apiPost(
        'interview-questions/api/sdt/update-profile/fetch-next-question',
        payload
      );
      const q = r?.q || r?.data?.q || (r?.question ? r : null);
      if (q?.question) {
        const newQ = normalizeQ(q, selSubs, timerSecsRef.current);
        patch({ questions: [...questionsRef.current, newQ], currentQ: nextIdx });
        updateLog('fnq-' + nextIdx, `Q${nextIdx + 1} ready`, 'done');
        // capture presigned URL for next question's audio upload
        apiPost('interview-questions/api/sdt/update-profile/generate-psurl-for-audio',
          buildAudioPsurlPayload({ ...state, sessionState: sessionStateRef.current }, selSubs, newQ, null, timerSecsRef.current)
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
    patch({ answers: newAnswers });
    setTextAnswer('');

    // TTS → S3 upload so the server can transcribe and score properly.
    // We await the TTS *fetch* (not the upload) so we know the buffer size to include
    // in the fetch-next-question payload — matching what the real site sends.
    const isSkipped = !answerText || answerText === '(Skipped)';
    if (!isSkipped) {
      const psurl = audioPsurlsRef.current[prevQ.qno];
      const textToSpeak = typeof answerText === 'string' ? answerText : '';
      try {
        const result = await fetchTts(textToSpeak);
        if (result) {
          audioSizesRef.current[prevQ.qno] = result.buffer.byteLength;
          if (psurl) {
            const filename = `${state.userid?.user_cat_id}-${state.profileid?.profile_id || 24}-question-${prevQ.qno}.wav`;
            uploadAudioToS3(psurl, result.buffer, filename, 'audio/wav').catch(() => {});
          }
        }
      } catch {}
    }

    await fetchNext(prevQ, answerText);
  }

  // ── Skip question ─────────────────────────────────────────────────────────
  function handleSkip() {
    if (loading) return;
    submitAnswer('(Skipped)');
  }

  // ── Init on mount ─────────────────────────────────────────────────────────
  useEffect(() => {
    async function initInterview() {
      resetInterview();
      startTimer();
      document.addEventListener('visibilitychange', onTabSwitch);

      const selSubs = getSelSubs();

      // Stage 1: resume-presigned-url
      addLog('rpu', 'Getting resume URL…', 'active');
      let psurl = {};
      try {
        const r = await apiPost(
          'update-profile/api/sdt/update-resume/resume-presigned-url',
          {
            userid: state.userid,
            resume: { file: {}, psurl: {} },
            profileid: {
              dept: state.profileid.dept,
              sem: state.profileid.sem,
              set_id: state.profileid.set_id,
              profile_id: state.profileid.profile_id,
              date: state.profileid.date,
            },
            interview_type_code: state.interviewType,
            access_token: state.accessToken,
          }
        );
        psurl = r?.psurl || {};
        updateLog('rpu', 'Resume URL ready', 'done');
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
            userid: state.userid,
            resume: { file: {}, psurl },
            profileid: state.profileid,
            access_token: state.accessToken,
            interview_type_code: state.interviewType,
            subjects_selected: selSubs,
          }
        );
        sessionState = r || {};
        sessionStateRef.current = sessionState;
        patch({ sessionState, interviewPanel: r?.interview_panel || [] });
        updateLog('pur', 'Profile processed', 'done');
      } catch {
        updateLog('pur', 'Using default session', 'done');
      }

      // Stage 3: fetch-first-question
      addLog('ffq', 'Loading first question…', 'active');
      try {
        const stateForPayload = { ...state, sessionState };
        const payload = buildFirstQPayload(stateForPayload, selSubs);
        const r = await apiPost(
          'interview-questions/api/sdt/update-profile/fetch-first-question',
          payload
        );
        const panel = r?.interview_panel || r?.data?.interview_panel;
        if (panel) patch({ interviewPanel: panel });
        const q = r?.q || r?.data?.q || (r?.question ? r : null);
        if (q?.question) {
          const firstQ = normalizeQ(q, selSubs, timerSecsRef.current);
          patch({ questions: [firstQ], currentQ: 0 });
          updateLog('ffq', 'Q1 ready', 'done');
          // capture presigned URL for Q1 audio upload
          apiPost('interview-questions/api/sdt/update-profile/generate-psurl-for-audio',
            buildAudioPsurlPayload({ ...state, sessionState }, selSubs, firstQ, null, timerSecsRef.current)
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

    return () => {
      stopTimer();
      document.removeEventListener('visibilitychange', onTabSwitch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-mode: AI answers when currentQ changes ───────────────────────────
  useEffect(() => {
    if (!state.autoMode || !state.questions[state.currentQ]) return;
    let cancelled = false;
    const q = state.questions[state.currentQ];
    const providerLabel = state.aiProvider === 'nvidia' ? 'NVIDIA' : 'Bedrock';
    addLog('ai-' + state.currentQ, `${providerLabel} answering Q${state.currentQ + 1}…`, 'active');
    bedrockAnswer(q.question, q.subject, state.aiProvider).then(answer => {
      if (cancelled) return;
      if (answer) {
        setTextAnswer(answer);
        updateLog('ai-' + state.currentQ, `${providerLabel} answer ready`, 'done');
        setTimeout(() => {
          if (!cancelled && autoModeRef.current) submitAnswer(answer);
        }, 2000);
      } else {
        updateLog('ai-' + state.currentQ, `${providerLabel} failed`, 'error');
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentQ, state.autoMode, state.questions.length]);

  // ── Derived values ────────────────────────────────────────────────────────
  const currentQuestion = state.questions[state.currentQ] || null;
  const totalQ = state.questions.length;
  const progressPct = totalQ > 0
    ? Math.round(((state.currentQ) / Math.max(currentQuestion?.max_count || 16, totalQ)) * 100)
    : 0;

  const panelMember = state.interviewPanel?.[0] || null;
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
            Q {state.currentQ + 1} / {currentQuestion?.max_count || '—'}
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
              className={`provider-btn${state.aiProvider === 'bedrock' ? ' active' : ''}`}
              onClick={() => patch({ aiProvider: 'bedrock' })}
              title="Use AWS Bedrock"
            >
              <Layers size={12} /> Bedrock
            </button>
            <button
              className={`provider-btn${state.aiProvider === 'nvidia' ? ' active' : ''}`}
              onClick={() => patch({ aiProvider: 'nvidia' })}
              title="Use NVIDIA NIM"
            >
              <Cpu size={12} /> NVIDIA
            </button>
          </div>

          <button
            className={`btn btn-sm btn-auto${state.autoMode ? ' on' : ''}`}
            onClick={() => patch({ autoMode: !state.autoMode })}
            title="Toggle Auto AI Mode"
          >
            <Zap size={14} />
            {state.autoMode ? 'Auto ON' : 'Auto'}
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
            {/* Record row */}
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
            Tab Switches: {state.violations.tab}
          </span>
          <span className="violation-item">
            <Maximize size={13} />
            Fullscreen Exits: {state.violations.full}
          </span>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
          {state.interviewType === 'COMPREHENSIVE' ? 'Comprehensive Interview' : 'Skill Interview'}
        </span>
      </footer>
    </div>
  );
}
