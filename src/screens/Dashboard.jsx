'use client';
import React, { useEffect, useState } from 'react';
import {
  Briefcase, Clock, BarChart2, BookOpen, Cpu, Layers,
  TrendingUp, Target, Code2, MessageSquare, AlertCircle, Loader2,
  Archive, RefreshCw,
} from 'lucide-react';
import { useStore } from '../store';
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

  const date = formatDate(
    profile.profile_date || profile.date || profile.created_at || profile.updated_at
  );
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
          <span
            className={`badge ${interviewType === 'SKILL' ? 'badge-accent' : 'badge-info'}`}
          >
            {interviewType === 'SKILL' ? <Cpu size={10} /> : <Layers size={10} />}
            {interviewType === 'SKILL' ? 'Skill' : 'Comprehensive'}
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
              {fixing
                ? <Loader2 size={11} className="spin" />
                : <RefreshCw size={11} />}
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
            {archiving
              ? <Loader2 size={11} className="spin" />
              : <Archive size={11} />}
            {archiving ? 'Archiving…' : 'Archive'}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: '8px' }}>
        <div>
          {semName && (
            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '2px' }}>
              {semName}
            </div>
          )}
          {deptName && (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {deptName}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--accent)' }}>
            {score}
          </div>
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
            <span className="subject-tag" style={{ opacity: 0.7 }}>
              +{subjects.length - 5} more
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const { state, patch } = useStore();

  // Local state
  const [studentInfo, setStudentInfo]   = useState(null);
  const [infoLoading, setInfoLoading]   = useState(true);
  const [infoError, setInfoError]       = useState(null);

  const [pastInterviews, setPastInterviews] = useState([]);  // [{ type, profile }]
  const [listLoading, setListLoading]       = useState(true);
  const [listError, setListError]           = useState(null);
  const [refreshKey, setRefreshKey]         = useState(0);

  // Derived display name
  const firstName =
    state.sdt?.per?.first_name ||
    state.usr?.username ||
    (state.email ? state.email.split('@')[0] : '');
  const lastName = state.sdt?.per?.last_name || '';
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || 'Student';

  // ── Fix INIT interview ────────────────────────────────────────────────────

  async function handleFixInit(profile, interviewType) {
    try {
      // 1. Record VP8+Opus WebM (black canvas + near-silent audio)
      console.log('[FixInit] recording canvas video...');
      const videoBlob = await recordBlackCanvas(3000);
      console.log('[FixInit] video blob:', videoBlob.size, 'bytes', videoBlob.type);

      // 2. Build payload with real video size
      const payload = buildFixPayload(state, profile, interviewType);
      payload.video.file.size = videoBlob.size;
      payload.video.file.type = videoBlob.type;

      // 3. Get presigned URL for video S3 upload
      console.log('[FixInit] getting presigned URL...');
      const psRes = await apiPost(
        'update-profile/api/sdt/update-profile/interview-presigned-url', payload
      );
      console.log('[FixInit] psurl sts:', psRes?.sts?.sts, 'has_psurl:', !!(psRes?.video?.psurl?.url));
      const videoPsurl = psRes?.video?.psurl;
      if (!videoPsurl?.url) throw new Error('No video psurl returned');

      // 4. Upload VP8+Opus video to S3
      console.log('[FixInit] uploading to S3, key:', videoPsurl.fields?.key);
      const videoBuffer = await videoBlob.arrayBuffer();
      const s3ok = await uploadAudioToS3(videoPsurl, videoBuffer, profile.interview_video, videoBlob.type);
      console.log('[FixInit] S3 upload ok:', s3ok);
      if (!s3ok) throw new Error('S3 upload failed');

      // 5. Finalize — update-interview-profile
      console.log('[FixInit] calling update-interview-profile...');
      const updateRes = await apiPost(
        'update-profile/api/sdt/update-profile/update-interview-profile', payload
      );
      console.log('[FixInit] update response:', JSON.stringify(updateRes)?.slice(0, 400));

      // Status update is async — Lambda processes the S3 video and updates the DB.
      // Wait long enough for a cold-start Lambda (~5-10s) before refreshing.
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
      // 1. Student information
      setInfoLoading(true);
      setInfoError(null);

      // 2. Past interviews (both types in parallel)
      setListLoading(true);
      setListError(null);

      try {
        const [infoRes, compRes, skillRes] = await Promise.all([
          apiPost('student/api/student/fetch-student-information', {
            sdt:          state.userid,
            access_token: state.accessToken,
          }),
          apiPost('student/api/student/fetch-interviews', {
            userid:         state.userid,
            archive:        0,
            interview_type: 'COMPREHENSIVE',
            jsr_email:      state.email,
            access_token:   state.accessToken,
            college_id:     state.collegeId,
          }),
          apiPost('student/api/student/fetch-interviews', {
            userid:         state.userid,
            archive:        0,
            interview_type: 'SKILL',
            jsr_email:      state.email,
            access_token:   state.accessToken,
            college_id:     state.collegeId,
          }),
        ]);

        if (cancelled) return;

        // --- Student info ---
        setStudentInfo(infoRes);
        patch({ studentInfo: infoRes });
        setInfoLoading(false);

        // --- Past interviews ---
        const collected = [];

        function extractProfiles(res, type) {
          const sections = res?.set ?? res?.res ?? [];
          sections.forEach(section => {
            const profiles = section?.profiles ?? [];
            profiles.forEach(profile => {
              collected.push({ type, profile });
            });
          });
        }

        extractProfiles(compRes, 'COMPREHENSIVE');
        extractProfiles(skillRes, 'SKILL');

        // Sort newest first by date if available
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

  // ── Computed metrics ──────────────────────────────────────────────────────

  const avgScore       = avg(studentInfo?.interview_percentage_res, 'interview_percentage');
  const avgReadiness   = avg(studentInfo?.interview_readiness_res,  'interview_readiness');
  const avgTechnical   = avg(studentInfo?.technical_competence_res, 'technical_competence');
  const avgSoftSkills  = avg(studentInfo?.soft_skills_res,          'soft_skills');

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="dashboard-screen">
      <Navbar title="SkipIt" showUser={true} />

      <div className="container">

        {/* Welcome Banner */}
        <div className="welcome-banner">
          <h2>Welcome, {displayName}!</h2>
          <p>Ready to practice your interview skills?</p>
        </div>

        {/* ── Performance Metrics ── */}
        <div className="section-gap">
          <div className="section-title">
            <BarChart2 size={18} color="var(--accent)" />
            Performance Metrics
          </div>

          {infoError ? (
            <div className="flex items-center gap-sm" style={{ color: 'var(--error)', fontSize: '14px', padding: '12px 0' }}>
              <AlertCircle size={16} />
              {infoError}
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
                  <MetricCard
                    label="Avg Score"
                    value={avgScore}
                    colorVar="--accent"
                    icon={TrendingUp}
                  />
                  <MetricCard
                    label="Readiness"
                    value={avgReadiness}
                    colorVar="--success"
                    icon={Target}
                  />
                  <MetricCard
                    label="Technical"
                    value={avgTechnical}
                    colorVar="--info"
                    icon={Code2}
                  />
                  <MetricCard
                    label="Soft Skills"
                    value={avgSoftSkills}
                    colorVar="--warning"
                    icon={MessageSquare}
                  />
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
              onClick={() => patch({ interviewType: 'SKILL', screen: 'setup' })}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && patch({ interviewType: 'SKILL', screen: 'setup' })}
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
                onClick={e => { e.stopPropagation(); patch({ interviewType: 'SKILL', screen: 'setup' }); }}
              >
                <Cpu size={14} />
                Start Skill
              </button>
            </div>

          </div>
        </div>

        {/* ── Past Interviews ── */}
        <div className="section-gap">
          <div className="section-title" style={{ justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={18} color="var(--accent)" />
              Past Interviews
            </span>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setRefreshKey(k => k + 1)}
              disabled={listLoading}
              title="Refresh interview list"
            >
              <Loader2 size={13} className={listLoading ? 'spin' : ''} />
              Refresh
            </button>
          </div>

          {listError ? (
            <div className="flex items-center gap-sm" style={{ color: 'var(--error)', fontSize: '14px', padding: '12px 0' }}>
              <AlertCircle size={16} />
              {listError}
            </div>
          ) : listLoading ? (
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
          ) : pastInterviews.length === 0 ? (
            <div className="card">
              <div className="no-data-msg">
                <Clock size={32} style={{ marginBottom: '12px', opacity: 0.4 }} />
                <div>No past interviews yet.</div>
                <div style={{ fontSize: '13px', marginTop: '4px' }}>
                  Start an interview above to build your history.
                </div>
              </div>
            </div>
          ) : (
            <div>
              {pastInterviews.map(({ type, profile }, idx) => (
                <PastInterviewCard
                  key={`${type}-${profile.profile_id ?? idx}`}
                  profile={profile}
                  interviewType={type}
                  onArchive={handleArchive}
                  onFixInit={handleFixInit}
                />
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
