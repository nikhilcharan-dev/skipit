'use client';
import React, { useEffect, useState } from 'react';
import {
  Briefcase, Clock, BarChart2, BookOpen, Cpu, Layers,
  TrendingUp, Target, Code2, MessageSquare, AlertCircle, Loader2,
  Archive, RefreshCw, Users, Play, X, Key,
} from 'lucide-react';
import { useStore, SESSION_INITIAL_STATE } from '../store';
import { apiPost, uploadAudioToS3, buildFixPayload, recordBlackCanvas } from '../api';
import Navbar from '../components/Navbar';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avg(arr, key) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const vals = arr.map(item => parseFloat(item[key])).filter(v => !isNaN(v));
  if (vals.length === 0) return null;
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function statusBadgeClass(status) {
  if (!status) return 'badge-info';
  const s = status.toUpperCase();
  if (s === 'DONE' || s === 'COMPLETED') return 'badge-success';
  if (s === 'IN_PROGRESS' || s === 'INPROGRESS') return 'badge-warning';
  if (s === 'INIT') return 'badge-warning';
  return 'badge-info';
}

function statusLabel(status) {
  if (!status) return 'Unknown';
  const s = status.toUpperCase();
  if (s === 'IN_PROGRESS') return 'In Progress';
  if (s === 'INIT') return 'Processing';
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function Skeleton({ width = '100%', height = '20px', radius = '8px', style = {} }) {
  return (
    <div
      style={{
        width, height, borderRadius: radius,
        background: 'linear-gradient(90deg,#1a1a1a 25%,#2e2e2e 50%,#1a1a1a 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.6s infinite',
        ...style,
      }}
    />
  );
}

// ─── Metric Card ─────────────────────────────────────────────────────────────

function useCountUp(target, duration = 900) {
  const [display, setDisplay] = React.useState(0);
  React.useEffect(() => {
    if (target === null || target === undefined) return;
    const num = parseFloat(target);
    if (isNaN(num)) return;
    const start = performance.now();
    let raf;
    function step(now) {
      const p = Math.min((now - start) / duration, 1);
      setDisplay((p * num).toFixed(1));
      if (p < 1) raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return display;
}

function MetricCard({ label, value, colorVar, icon: Icon }) {
  const animated = useCountUp(value);
  return (
    <div className="card metric-card">
      <div className="metric-icon flex justify-center">
        <Icon size={20} color={`var(${colorVar})`} />
      </div>
      <div className="metric-value" style={{ color: `var(${colorVar})` }}>
        {value !== null && value !== undefined ? `${animated}%` : '—'}
      </div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

// ─── Past Interview Card ──────────────────────────────────────────────────────

function PastInterviewCard({ profile, interviewType, onArchive, onFixInit }) {
  const [archiving, setArchiving] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState(null);

  const subjects = Array.isArray(profile.metrics)
    ? profile.metrics.map(m => m.subject_name).filter(Boolean)
    : [];

  const scoreRaw = profile.interview_percentage;
  const scoreParsed = parseFloat(scoreRaw);
  const score = scoreRaw !== null && scoreRaw !== undefined && scoreParsed >= 0
    ? `${scoreParsed.toFixed(1)}%`
    : '—';

  const date = formatDate(profile.profile_date || profile.date || profile.created_at || profile.updated_at);
  const semName  = profile.sem?.name  || profile.sem_name  || null;
  const deptName = profile.dept?.name || profile.dept_name || null;

  async function handleArchive(e) {
    e.stopPropagation();
    setArchiving(true);
    await onArchive(profile.profile_id, interviewType);
    setArchiving(false);
  }

  async function handleFix(e) {
    e.stopPropagation();
    setFixing(true);
    setFixResult(null);
    const result = await onFixInit(profile, interviewType);
    setFixResult(result?.success ? 'done' : 'error');
    setFixing(false);
  }

  return (
    <div className="card past-interview-card" style={{ marginBottom: '12px' }}>
      <div className="flex items-center justify-between" style={{ marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
        <div className="flex items-center gap-sm" style={{ flexWrap: 'wrap' }}>
          <span className={`badge ${interviewType === 'SKILL' ? 'badge-accent' : interviewType === 'HR' ? 'badge-warning' : 'badge-info'}`}>
            {interviewType === 'SKILL' ? <Cpu size={10} /> : interviewType === 'HR' ? <Users size={10} /> : <Layers size={10} />}
            {interviewType === 'SKILL' ? 'Skill' : interviewType === 'HR' ? 'HR' : 'Comprehensive'}
          </span>
          <span className={`badge ${statusBadgeClass(profile.status)}`}>
            {statusLabel(profile.status)}
          </span>
        </div>
        <div className="flex items-center gap-sm">
          <span style={{ color: 'var(--text-muted)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={12} />
            {date}
          </span>
          {profile.status?.toUpperCase() === 'INIT' && (
            <button
              className="btn btn-outline btn-sm"
              onClick={handleFix}
              disabled={fixing || fixResult === 'done'}
              title="Upload video placeholder and mark as complete"
              style={{ padding: '3px 8px', fontSize: '11px', borderColor: fixResult === 'done' ? 'var(--success)' : fixResult === 'error' ? 'var(--error)' : undefined }}
            >
              {fixing ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />}
              {fixing ? 'Fixing…' : fixResult === 'done' ? 'Fixed!' : fixResult === 'error' ? 'Failed' : 'Fix Status'}
            </button>
          )}
          <button
            className="btn btn-outline btn-sm"
            onClick={handleArchive}
            disabled={archiving}
            title="Archive this interview"
            style={{ padding: '3px 8px', fontSize: '11px' }}
          >
            {archiving ? <Loader2 size={11} className="spin" /> : <Archive size={11} />}
            {archiving ? 'Archiving…' : 'Archive'}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: '8px' }}>
        <div>
          {semName && <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '2px' }}>{semName}</div>}
          {deptName && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{deptName}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--accent)' }}>{score}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Score</div>
        </div>
      </div>

      {subjects.length > 0 && (
        <div className="flex gap-sm" style={{ marginTop: '12px', flexWrap: 'wrap' }}>
          {subjects.slice(0, 5).map((sub, i) => (
            <span key={i} className="subject-tag">
              <BookOpen size={9} style={{ marginRight: '4px' }} />
              {sub}
            </span>
          ))}
          {subjects.length > 5 && (
            <span className="subject-tag" style={{ opacity: 0.7 }}>+{subjects.length - 5} more</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Past Interviews Section (tabbed) ─────────────────────────────────────────

const TABS = [
  { key: 'SKILL', label: 'Skill', Icon: Cpu   },
  { key: 'HR',    label: 'HR',    Icon: Users },
];

function PastInterviewsSection({ pastInterviews, listLoading, listError, onRefresh, onArchive, onFixInit }) {
  const [activeTab, setActiveTab] = useState('SKILL');
  const filtered = pastInterviews.filter(({ type }) => type === activeTab);

  const skeletons = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {[0, 1, 2].map(i => (
        <div key={i} className="card" style={{ borderLeft: '3px solid var(--border)' }}>
          <div className="flex items-center justify-between" style={{ marginBottom: '12px', gap: '8px' }}>
            <div className="flex gap-sm">
              <Skeleton width="72px" height="22px" radius="20px" />
              <Skeleton width="80px" height="22px" radius="20px" />
            </div>
            <Skeleton width="90px" height="16px" radius="4px" />
          </div>
          <div className="flex items-center justify-between">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <Skeleton width="140px" height="16px" radius="4px" />
              <Skeleton width="100px" height="14px" radius="4px" />
            </div>
            <Skeleton width="60px" height="36px" radius="8px" />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="section-gap">
      <div className="section-title" style={{ justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={18} color="var(--accent)" />
          Past Interviews
        </span>
        <button className="btn btn-outline btn-sm" onClick={onRefresh} disabled={listLoading}>
          <Loader2 size={13} className={listLoading ? 'spin' : ''} />
          Refresh
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {TABS.map(({ key, label, Icon }) => {
          const count = pastInterviews.filter(({ type }) => type === key).length;
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                border: activeTab === key ? 'none' : '1px solid var(--border)',
                background: activeTab === key ? 'var(--accent)' : 'transparent',
                color: activeTab === key ? '#000' : 'var(--text-secondary)',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              <Icon size={13} />
              {label}
              {!listLoading && (
                <span style={{
                  background: activeTab === key ? 'rgba(0,0,0,0.2)' : 'var(--bg-elevated)',
                  borderRadius: 10, padding: '1px 7px', fontSize: 11,
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {listError ? (
        <div className="flex items-center gap-sm" style={{ color: 'var(--error)', fontSize: '14px', padding: '12px 0' }}>
          <AlertCircle size={16} />{listError}
        </div>
      ) : listLoading ? skeletons
      : filtered.length === 0 ? (
        <div className="card">
          <div className="no-data-msg">
            <Clock size={32} style={{ marginBottom: '12px', opacity: 0.4 }} />
            <div>No {activeTab === 'HR' ? 'HR' : 'Skill'} interviews yet.</div>
            <div style={{ fontSize: '13px', marginTop: '4px' }}>Start one above to build your history.</div>
          </div>
        </div>
      ) : (
        <div>
          {filtered.map(({ type, profile }, idx) => (
            <PastInterviewCard
              key={`${type}-${profile.profile_id ?? idx}`}
              profile={profile}
              interviewType={type}
              onArchive={onArchive}
              onFixInit={onFixInit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Active Sessions Panel ────────────────────────────────────────────────────

function ActiveSessionsPanel({ sessions, activeSessionId, onResume, onClose }) {
  if (sessions.length === 0) return null;

  return (
    <div className="section-gap">
      <div className="section-title">
        <Play size={18} color="var(--success)" />
        Active Sessions
        <span style={{
          background: 'var(--success)', color: '#000',
          borderRadius: 10, padding: '1px 8px', fontSize: 11, fontWeight: 700,
        }}>
          {sessions.length}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sessions.map(s => (
          <div
            key={s.id}
            className="card"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', gap: 12,
              borderLeft: `3px solid ${s.id === activeSessionId ? 'var(--accent)' : 'var(--border)'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
              <span className={`badge ${s.interviewType === 'HR' ? 'badge-warning' : 'badge-accent'}`} style={{ flexShrink: 0 }}>
                {s.interviewType === 'HR' ? <Users size={10} /> : <Cpu size={10} />}
                {s.interviewType === 'HR' ? 'HR' : 'Skill'}
              </span>
              <span className={`badge ${s.status === 'interview' ? 'badge-success' : s.status === 'results' ? 'badge-info' : 'badge-warning'}`} style={{ flexShrink: 0 }}>
                {s.status === 'interview' ? 'In Progress' : s.status === 'results' ? 'Completed' : 'Setup'}
              </span>
              {s.status === 'interview' && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Q{(s.currentQ || 0) + 1} / {s.questions?.[s.currentQ]?.max_count || '—'}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => onResume(s.id)}
                style={{ padding: '4px 12px', fontSize: 12 }}
              >
                {s.status === 'results' ? 'View Results' : 'Resume'}
              </button>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => onClose(s.id)}
                title="Remove session"
                style={{ padding: '4px 8px' }}
              >
                <X size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── NVIDIA Key Card ──────────────────────────────────────────────────────────

function NvidiaKeyCard({ value, onChange }) {
  const [show, setShow] = useState(false);
  const [local, setLocal] = useState(value || '');

  return (
    <div className="card" style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Key size={16} color="var(--accent)" />
        <span style={{ fontSize: 14, fontWeight: 700 }}>NVIDIA API Key</span>
        {value && (
          <span className="badge badge-success" style={{ fontSize: 10 }}>Set</span>
        )}
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        Enter your own NVIDIA NIM API key to use the NVIDIA provider for AI answers.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type={show ? 'text' : 'password'}
          className="form-select"
          placeholder="nvapi-..."
          value={local}
          onChange={e => setLocal(e.target.value)}
          style={{ flex: 1, fontSize: 13 }}
        />
        <button
          className="btn btn-outline btn-sm"
          onClick={() => setShow(v => !v)}
          style={{ flexShrink: 0 }}
        >
          {show ? 'Hide' : 'Show'}
        </button>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => onChange(local.trim())}
          style={{ flexShrink: 0 }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const { state, dispatch, patch } = useStore();

  const [studentInfo, setStudentInfo] = useState(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [infoError,   setInfoError]   = useState(null);

  const [pastInterviews, setPastInterviews] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError,   setListError]   = useState(null);
  const [refreshKey,  setRefreshKey]  = useState(0);

  const firstName =
    state.sdt?.per?.first_name ||
    state.usr?.username ||
    (state.email ? state.email.split('@')[0] : '');
  const lastName = state.sdt?.per?.last_name || '';
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || 'Student';

  // ── Create and start a new session ───────────────────────────────────────

  function createSession(interviewType) {
    const id = `s-${Date.now()}`;
    const newSession = {
      ...SESSION_INITIAL_STATE,
      id,
      createdAt: Date.now(),
      userid:      state.userid,
      accessToken: state.accessToken,
      email:       state.email,
      collegeId:   state.collegeId,
      interviewType,
      status:     'setup',
      // Use NVIDIA if a key is saved, otherwise default to Bedrock
      aiProvider: state.nvidiaApiKey ? 'nvidia' : 'bedrock',
    };
    dispatch({ type: 'ADD_SESSION', session: newSession });
    patch({ activeSessionId: id, screen: 'session' });
  }

  // ── Resume an existing session ────────────────────────────────────────────

  function resumeSession(id) {
    patch({ activeSessionId: id, screen: 'session' });
  }

  // ── Remove a session ──────────────────────────────────────────────────────

  function closeSession(id) {
    dispatch({ type: 'REMOVE_SESSION', id });
  }

  // ── Fix INIT interview ────────────────────────────────────────────────────

  async function handleFixInit(profile, interviewType) {
    try {
      console.log('[FixInit] recording canvas video...');
      const videoBlob = await recordBlackCanvas(3000);
      const payload = buildFixPayload(state, profile, interviewType);
      payload.video.file.size = videoBlob.size;
      payload.video.file.type = videoBlob.type;

      const psRes = await apiPost(
        'update-profile/api/sdt/update-profile/interview-presigned-url', payload
      );
      const videoPsurl = psRes?.video?.psurl;
      if (!videoPsurl?.url) throw new Error('No video psurl returned');

      const videoBuffer = await videoBlob.arrayBuffer();
      const s3ok = await uploadAudioToS3(videoPsurl, videoBuffer, profile.interview_video, videoBlob.type);
      if (!s3ok) throw new Error('S3 upload failed');

      await apiPost('update-profile/api/sdt/update-profile/update-interview-profile', payload);
      await new Promise(r => setTimeout(r, 12000));
      setRefreshKey(k => k + 1);
      return { success: true };
    } catch (e) {
      console.error('[FixInit]', e);
      return { error: e.message };
    }
  }

  // ── Archive interview ─────────────────────────────────────────────────────

  async function handleArchive(profileId, interviewType) {
    try {
      await apiPost('student/api/student/archive-interview', {
        userid:         state.userid,
        profile_id:     profileId,
        archive:        1,
        interview_type: interviewType,
        access_token:   state.accessToken,
        college_id:     state.collegeId,
      });
      setPastInterviews(prev =>
        prev.filter(item => !(item.profile.profile_id === profileId && item.type === interviewType))
      );
    } catch (e) {
      console.error('[Dashboard] archive error:', e);
    }
  }

  // ── Fetch on mount ────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      setInfoLoading(true);
      setInfoError(null);
      setListLoading(true);
      setListError(null);

      try {
        const [infoRes, compRes, skillRes, hrRes] = await Promise.all([
          apiPost('student/api/student/fetch-student-information', {
            sdt:          state.userid,
            access_token: state.accessToken,
          }),
          apiPost('student/api/student/fetch-interviews', {
            userid: state.userid, archive: 0, interview_type: 'COMPREHENSIVE',
            jsr_email: state.email, access_token: state.accessToken, college_id: state.collegeId,
          }),
          apiPost('student/api/student/fetch-interviews', {
            userid: state.userid, archive: 0, interview_type: 'SKILL',
            jsr_email: state.email, access_token: state.accessToken, college_id: state.collegeId,
          }),
          apiPost('student/api/student/fetch-interviews', {
            userid: state.userid, archive: 0, interview_type: 'HR',
            jsr_email: state.email, access_token: state.accessToken, college_id: state.collegeId,
          }),
        ]);

        if (cancelled) return;

        setStudentInfo(infoRes);
        patch({ studentInfo: infoRes });
        setInfoLoading(false);

        const collected = [];
        function extractProfiles(res, type) {
          const sections = res?.set ?? res?.res ?? [];
          sections.forEach(section => {
            (section?.profiles ?? []).forEach(profile => {
              collected.push({ type, profile });
            });
          });
        }
        extractProfiles(compRes,  'COMPREHENSIVE');
        extractProfiles(skillRes, 'SKILL');
        extractProfiles(hrRes,    'HR');
        collected.sort((a, b) => {
          const da = a.profile.date || a.profile.created_at || '';
          const db = b.profile.date || b.profile.created_at || '';
          return db.localeCompare(da);
        });
        setPastInterviews(collected);
        setListLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('[Dashboard] fetch error:', err);
        setInfoError('Failed to load performance data.');
        setListError('Failed to load interview history.');
        setInfoLoading(false);
        setListLoading(false);
      }
    }

    fetchAll();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const avgScore      = avg(studentInfo?.interview_percentage_res, 'interview_percentage');
  const avgReadiness  = avg(studentInfo?.interview_readiness_res,  'interview_readiness');
  const avgTechnical  = avg(studentInfo?.technical_competence_res, 'technical_competence');
  const avgSoftSkills = avg(studentInfo?.soft_skills_res,          'soft_skills');

  return (
    <div className="dashboard-screen">
      <Navbar title="SkipIt" showUser={true} />

      <div className="container">

        {/* Welcome Banner */}
        <div className="welcome-banner">
          <h2>Welcome, {displayName}!</h2>
          <p>Ready to practice your interview skills?</p>
        </div>

        {/* ── Active Sessions ── */}
        <ActiveSessionsPanel
          sessions={state.sessions}
          activeSessionId={state.activeSessionId}
          onResume={resumeSession}
          onClose={closeSession}
        />

        {/* ── Performance Metrics ── */}
        <div className="section-gap">
          <div className="section-title">
            <BarChart2 size={18} color="var(--accent)" />
            Performance Metrics
          </div>

          {infoError ? (
            <div className="flex items-center gap-sm" style={{ color: 'var(--error)', fontSize: '14px', padding: '12px 0' }}>
              <AlertCircle size={16} />{infoError}
            </div>
          ) : (
            <div className="metrics-grid">
              {infoLoading ? (
                <>
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} className="card metric-card">
                      <div className="flex justify-center" style={{ marginBottom: '10px' }}>
                        <Skeleton width="24px" height="24px" radius="50%" />
                      </div>
                      <Skeleton width="60%" height="28px" radius="6px" style={{ margin: '0 auto 8px' }} />
                      <Skeleton width="80%" height="14px" radius="4px" style={{ margin: '0 auto' }} />
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <MetricCard label="Avg Score"  value={avgScore}      colorVar="--accent"  icon={TrendingUp}    />
                  <MetricCard label="Readiness"  value={avgReadiness}  colorVar="--success" icon={Target}        />
                  <MetricCard label="Technical"  value={avgTechnical}  colorVar="--info"    icon={Code2}         />
                  <MetricCard label="Soft Skills" value={avgSoftSkills} colorVar="--warning" icon={MessageSquare} />
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Start Interview ── */}
        <div className="section-gap">
          <div className="section-title">
            <Briefcase size={18} color="var(--accent)" />
            Start Interview
          </div>

          <div className="interview-grid">
            {/* Skill Interview */}
            <div
              className="card card-clickable interview-card"
              onClick={() => createSession('SKILL')}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && createSession('SKILL')}
            >
              <div className="card-icon icon-skill">
                <Cpu size={24} color="#fff" />
              </div>
              <h3>Skill Interview</h3>
              <p>
                Focus on specific technical subjects tailored to your domain.
                Select topics and get targeted questions to sharpen your expertise.
              </p>
              <button
                className="btn btn-primary btn-sm"
                onClick={e => { e.stopPropagation(); createSession('SKILL'); }}
              >
                <Cpu size={14} />
                Start Skill
              </button>
            </div>

            {/* HR Interview */}
            <div
              className="card card-clickable interview-card"
              onClick={() => createSession('HR')}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && createSession('HR')}
            >
              <div className="card-icon" style={{ background: 'linear-gradient(135deg,#6c63ff,#a78bfa)' }}>
                <Users size={24} color="#fff" />
              </div>
              <h3>HR Interview</h3>
              <p>
                Behavioural and soft-skills interview tailored to your resume.
                10 HR questions covering teamwork, leadership, and situational judgement.
              </p>
              <button
                className="btn btn-sm"
                style={{ background: 'linear-gradient(135deg,#6c63ff,#a78bfa)', color: '#fff' }}
                onClick={e => { e.stopPropagation(); createSession('HR'); }}
              >
                <Users size={14} />
                Start HR
              </button>
            </div>
          </div>
        </div>

        {/* ── NVIDIA Key ── */}
        <div className="section-gap">
          <NvidiaKeyCard
            value={state.nvidiaApiKey}
            onChange={key => patch({ nvidiaApiKey: key })}
          />
        </div>

        {/* ── Past Interviews ── */}
        <PastInterviewsSection
          pastInterviews={pastInterviews}
          listLoading={listLoading}
          listError={listError}
          onRefresh={() => setRefreshKey(k => k + 1)}
          onArchive={handleArchive}
          onFixInit={handleFixInit}
        />

      </div>
    </div>
  );
}
