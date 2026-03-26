// ─── Black canvas video recording ────────────────────────────────────────────

/**
 * Records a black 320×240 canvas + near-silent audio via MediaRecorder.
 * Produces video/webm;codecs=vp8,opus — matching what the server's Lambda expects.
 * The real app sends VP8+Opus; video-only streams are rejected as invalid.
 * Browser-only — do not call server-side.
 */
export function recordBlackCanvas(durationMs = 3000) {
  return new Promise((resolve, reject) => {
    let audioCtx = null;
    let oscillator = null;
    let videoStream = null;
    function cleanup() {
      try { oscillator?.stop(); } catch {}
      try { audioCtx?.close(); } catch {}
      videoStream?.getTracks().forEach(t => t.stop());
    }
    try {
      // Black canvas for video track
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 320, 240);
      videoStream = canvas.captureStream(1);

      // Near-silent audio track via Web Audio API (opus codec requires an audio track)
      audioCtx = new AudioContext();
      oscillator = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      gain.gain.value = 0.0001; // essentially inaudible
      oscillator.connect(gain);
      const audioDest = audioCtx.createMediaStreamDestination();
      gain.connect(audioDest);
      oscillator.start();

      // Combine video + audio
      const combined = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...audioDest.stream.getAudioTracks(),
      ]);

      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus' : 'video/webm';
      const rec = new MediaRecorder(combined, { mimeType: mime });
      const chunks = [];
      rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      rec.onerror = e => { cleanup(); reject(e); };
      rec.onstop = () => {
        cleanup();
        resolve(new Blob(chunks, { type: mime }));
      };
      rec.start(200);
      setTimeout(() => rec.stop(), durationMs);
    } catch (e) { cleanup(); reject(e); }
  });
}

// ─── TTS + S3 audio upload ────────────────────────────────────────────────────

/**
 * Fetch TTS audio from the proxy (tries StreamElements → Google TTS → silent WAV).
 * Returns { buffer: ArrayBuffer, type: string } or null on failure.
 */
export async function fetchTts(text) {
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const type = res.headers.get('Content-Type') || 'audio/mpeg';
    return { buffer, type };
  } catch {
    return null;
  }
}

/**
 * Upload audio blob to S3 using the presigned POST URL from generate-psurl-for-audio.
 * psurl = { url, fields: { key, AWSAccessKeyId, policy, signature, ... } }
 */
export async function uploadAudioToS3(psurl, audioBuffer, filename, contentType = 'audio/mpeg') {
  if (!psurl?.url || !psurl?.fields) return false;
  try {
    const blob = new Blob([audioBuffer], { type: contentType });
    const form = new FormData();
    for (const [k, v] of Object.entries(psurl.fields)) form.append(k, v);
    form.append('file', blob, filename);
    const res = await fetch(psurl.url, { method: 'POST', body: form });
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

export async function apiPost(path, body) {
  const res = await fetch('/api/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.warn('[API]', res.status, path);
  return res.json();
}

export async function bedrockAnswer(question, subject, provider = 'bedrock', resumeContext = null, apiKey = '') {
  try {
    const res = await fetch('/api/ai/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, subject, provider, resumeContext, apiKey }),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200) || '(no body)'}`);
    }
    if (data.error) throw new Error(data.error);
    return data.answer || '';
  } catch (e) {
    console.error('[AI]', e.message);
    return '';
  }
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

export function formatTime(sec) {
  return Math.floor(sec / 60).toString().padStart(2, '0') +
    ':' + (sec % 60).toString().padStart(2, '0');
}

// ─── S3 folder helpers ────────────────────────────────────────────────────────

const DEPT_S3 = { 1001: 'el_cse', 1002: 'el_ece', 1003: 'el_mech', 1004: 'el_civil' };
export const deptS3  = (id) => DEPT_S3[id] || `el_${id}`;
export const semS3   = (name) => (name || '').toLowerCase().replace(/ /g, '_');

// ─── LocalStorage session ─────────────────────────────────────────────────────

const SESSION_KEY = 'skipit-session';

export function saveSession({ email, password, userid, accessToken, collegeId, sdt, usr }) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ email, password, userid, accessToken, collegeId, sdt, usr }));
}

export function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}

export function clearSession() { localStorage.removeItem(SESSION_KEY); }

// ─── Login helper ─────────────────────────────────────────────────────────────

/**
 * Call sign-in API and return a patch object ready for the store.
 * Returns null if login failed.
 */
export async function signIn(email, password) {
  const data = await apiPost('signin/api/sign-in', { email, password });
  if (!data?.sts?.sts) return { error: data?.message || data?.error || 'Login failed. Check your credentials.' };

  const sdt = data.sdt || null;
  const usr = data.usr || null;
  // access_token like "SDTCdYLpI3680" reliably ends with user_cat_id digits
  const tokenCatId = parseInt((data.access_token || '').match(/\d+$/)?.[0] || '0') || null;
  const userid = {
    user_id:       sdt?.user_id       || data?.user_id  || usr?.user_id || usr?.id || null,
    user_category: sdt?.user_category || usr?.user_category || 'SDT',
    user_cat_id:   sdt?.user_cat_id   || sdt?.id        || tokenCatId  || usr?.id  || null,
  };

  return {
    loggedIn: true,
    email, password,
    usr, sdt, userid,
    accessToken: data.access_token || '',
    collegeId: usr?.college_id || sdt?.college_id || 5,
  };
}

// ─── Payload builders (match flow.json exactly) ───────────────────────────────

/**
 * Build the HR voice object from the interview_panel inside sessionState.
 * HR interviews use { PIQ, FRQ, SLF, FNL, LST } voice keys, not { INT }.
 */
export function buildHRVoice(sessionState) {
  const panel = sessionState?.introq?.interview_panel || [];
  const v = panel[0]?.voice_id || { voice_name: 'Emma', language_code: 'en-GB' };
  const qorder = panel[0]?.qorder || ['PIQ', 'FRQ', 'SLF', 'FNL', 'LST'];
  return qorder.reduce((acc, k) => ({ ...acc, [k]: v }), {});
}

/**
 * Payload for fetch-first-question.
 * sessionState comes from process-uploaded-resume response.
 */
export function buildFirstQPayload(state, selSubs) {
  const ss = state.sessionState || {};
  const isHR = state.interviewType === 'HR';
  return {
    sts: ss.sts || { sts: true, err: '', msg: 'Successfully generated pre-signed url for introductory SME question.' },
    userid:           state.userid,
    profileid:        state.profileid,
    resume:           isHR && state.resumeFileMeta
                        ? { file: state.resumeFileMeta, psurl: {} }
                        : { file: {}, psurl: {} },
    subjects:         ss.subjects         || [],
    resume_subjects:  ss.resume_subjects  || [],
    introq:           ss.introq           || {},
    interview_panel:  ss.interview_panel  || [],
    subjects_selected: selSubs,
    interview_type_code: state.interviewType,
    video: { file: { name: null, size: 0, type: null, span: null }, psurl: {} },
    voice: isHR ? buildHRVoice(ss) : (ss.voice || { INT: { voice_name: 'Matthew', language_code: 'en-US' } }),
    violations:  { Tabswitch: 0, Fullscreen: 0, Externaldisplay: 0 },
    interview_type: state.interviewType,
    access_token:   state.accessToken,
  };
}

/**
 * Payload for fetch-next-question AND generate-performance-metrics-for-each-question.
 * Both endpoints use the same payload structure (from flow.json).
 */
export function buildNextQPayload(state, selSubs, prevQ, answerText, timerSecs) {
  const ss   = state.sessionState || {};
  const isHR = state.interviewType === 'HR';
  const viol = {
    Tabswitch:      state.violations.tab,
    Fullscreen:     state.violations.full,
    Externaldisplay: 0,
  };
  return {
    sts: ss.sts || { sts: true, err: '', msg: 'Successfully generated pre-signed url for introductory SME question.' },
    userid:           state.userid,
    profileid:        state.profileid,
    resume:           isHR && state.resumeFileMeta
                        ? { file: state.resumeFileMeta, psurl: {} }
                        : { file: {}, psurl: {} },
    subjects:         ss.subjects         || [],
    resume_subjects:  ss.resume_subjects  || [],
    introq:           ss.introq           || {},
    interview_panel:  ss.interview_panel  || state.interviewPanel || [],
    subjects_selected: selSubs,
    interview_type_code: state.interviewType,
    q: {
      violations: viol,
      max_count:  prevQ.max_count || 16,
      qid:        prevQ.qid,
      qno:        prevQ.qno,
      qtype:      prevQ.qtype || 'OPN',
      choice:     '',
      question:   prevQ.question,
      response:   answerText || null, // text analysis score; audio upload handles transcription score
      subject:    prevQ.subjectObj || { id: prevQ.subjectId, display_name: prevQ.subject },
      start:      prevQ.start || '00:00:00',
      end:        formatTime(timerSecs),
    },
    violations:       viol,
    screen_violations: { exitCount: 0, isFullscreen: false, lastExitTime: null, exitHistory: [] },
    total_violations:  viol,
    interview_type:    state.interviewType,
    voice: isHR ? buildHRVoice(ss) : (ss.voice || { INT: { voice_name: 'Matthew', language_code: 'en-US' } }),
    access_token:  state.accessToken,
    audio_file: {
      file: {
        name: `${state.userid?.user_cat_id}-${state.profileid?.profile_id || 24}-question-${prevQ.qno}.wav`,
        type: 'audio/wav',
        size: 0,
      },
    },
    video_file: {},
  };
}

/**
 * Payload for generate-psurl-for-audio (called fire-and-forget after each question fetch).
 * Identical structure to buildNextQPayload — reuses it directly.
 */
export const buildAudioPsurlPayload = buildNextQPayload;

/**
 * Payload for interview-presigned-url and update-interview-profile.
 * Same as buildNextQPayload but adds video object.
 */
export function buildInterviewFinalPayload(state, selSubs, lastQ, timerSecs, withConversation = false) {
  const base = buildNextQPayload(state, selSubs, lastQ, null, timerSecs);
  // Real site uses just a Unix timestamp (e.g. "1774520302410.webm") — no userid/profileid prefix.
  const videoName = `${Date.now()}.webm`;
  return {
    ...base,
    video: { file: { name: videoName, type: 'video/webm;codecs=vp8,opus', size: 0 }, psurl: {} },
    ...(withConversation ? { interview_conversation: [] } : {}),
  };
}

/**
 * Build the payload for interview-presigned-url / update-interview-profile
 * when fixing an existing INIT-status interview from the Dashboard.
 */
export function buildFixPayload(state, profile, interviewType) {
  const subjects = (profile.subjects_selected_lst_dict || []).map(s => ({
    id: s.id, label: s.display_name, value: s.display_name, display_name: s.display_name,
  }));
  return {
    sts: { sts: true, err: '', msg: 'Successfully generated pre-signed url for introductory SME question.' },
    userid: state.userid,
    profileid: {
      dept:       profile.dept,
      sem:        profile.sem,
      profile_id: profile.profile_id,
      set_id:     1,
      experience: '0',
    },
    resume: { file: {}, psurl: {} },
    subjects: [], resume_subjects: [], introq: {}, interview_panel: [],
    subjects_selected: subjects,
    interview_type_code: interviewType,
    q: {
      violations: { Tabswitch: 0, Fullscreen: 0, Externaldisplay: 0 },
      max_count: 16, qid: null, qno: 16, qtype: 'OPN',
      choice: '', question: '', response: null,
      subject: subjects[0] || {},
      start: '00:00:00', end: '00:15:00',
    },
    violations:        { Tabswitch: 0, Fullscreen: 0, Externaldisplay: 0 },
    screen_violations: { exitCount: 0, isFullscreen: false, lastExitTime: null, exitHistory: [] },
    total_violations:  { Tabswitch: 0, Fullscreen: 0, Externaldisplay: 0 },
    interview_type: interviewType,
    voice: { INT: { voice_name: 'Matthew', language_code: 'en-US' } },
    access_token: state.accessToken,
    video: {
      file: { name: profile.interview_video, type: 'video/webm;codecs=vp8,opus', size: 0 },
      psurl: {},
    },
    audio_file: { file: { name: null, type: 'audio/wav', size: 0 } },
    video_file: {},
    interview_conversation: [],
  };
}

/**
 * Normalize a raw question object from the API into the internal format.
 */
export function normalizeQ(q, selSubs, timerSecs) {
  return {
    qid:       q.qid,
    qno:       q.qno,
    question:  q.question,
    qtype:     q.qtype || 'OPN',
    subject:   q.subject?.display_name || q.subject?.name || selSubs[0]?.display_name || 'General',
    subjectObj: q.subject || (selSubs[0] ? { id: selSubs[0].id, display_name: selSubs[0].display_name } : null),
    subjectId: q.subject?.id || selSubs[0]?.id,
    max_count: q.max_count || 16,
    start:     formatTime(timerSecs),
  };
}
