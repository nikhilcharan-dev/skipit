'use client';
import React, { useEffect, useRef, useState } from 'react';
import { Award, ArrowLeft, Clipboard, CheckCircle, SkipForward, Cpu, Clock, Download, Loader2, BarChart2 } from 'lucide-react';
import Navbar from '../components/Navbar';
import { useStore } from '../store';
import { apiPost } from '../api';

function formatTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getStatusBadge(answer) {
  if (!answer || answer === '(Skipped)')    return <span className="badge badge-warning">Skipped</span>;
  if (answer === '(Voice recording)')        return <span className="badge badge-info">Voice</span>;
  if (answer.length > 150)                   return <span className="badge badge-info">AI-Assisted</span>;
  return <span className="badge badge-success">Answered</span>;
}

function isMuted(answer) {
  return !answer || answer === '(Skipped)' || answer === '(Voice recording)';
}

// Extract score + metrics for a specific profile_id from any API response
function extractProfileResult(data, profileId) {
  if (!data || !profileId) return null;
  const sections = data?.set ?? data?.res ?? [];
  for (const section of sections) {
    for (const profile of (section?.profiles ?? [])) {
      if (profile.profile_id === profileId) {
        const pct = parseFloat(profile.interview_percentage);
        if (!isNaN(pct) && pct >= 0) {
          return { score: pct.toFixed(1), metrics: profile.metrics || [] };
        }
      }
    }
  }
  return null;
}

// Animated count-up for the score ring
function useCountUp(target, duration = 1200) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (target === null || target === undefined) return;
    const num = parseFloat(target);
    if (isNaN(num)) return;
    const start = performance.now();
    let raf;
    function step(now) {
      const p = Math.min((now - start) / duration, 1);
      setDisplay(Math.round(p * num * 10) / 10);
      if (p < 1) raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return display;
}

export default function Results() {
  const { state, patch } = useStore();

  const [result, setResult]   = useState(null);   // { score: string, metrics: [] }
  const [polling, setPolling] = useState(true);
  const pollRef = useRef(null);

  const answered  = state.answers.filter(a => a.answer !== '(Skipped)' && a.answer !== '(Voice recording)').length;
  const total     = state.answers.length || 1;
  const aiAnswered = state.answers.filter(a => a.answer && a.answer.length > 150).length;
  const tabCount  = state.violations?.tab || 0;

  const profileId = state.profileid?.profile_id;

  // Try serverResults first, then poll fetch-interviews
  useEffect(() => {
    // Immediate check from update-interview-profile response
    const immediate = extractProfileResult(state.serverResults, profileId);
    if (immediate) {
      setResult(immediate);
      setPolling(false);
      return;
    }

    if (!profileId || !state.userid) { setPolling(false); return; }

    let attempt = 0;
    let cancelled = false;

    async function poll() {
      if (cancelled || attempt >= 12) { if (!cancelled) setPolling(false); return; }
      attempt++;
      try {
        const res = await apiPost('student/api/student/fetch-interviews', {
          userid:         state.userid,
          archive:        0,
          interview_type: state.interviewType,
          jsr_email:      state.email,
          access_token:   state.accessToken,
          college_id:     state.collegeId,
        });
        const found = extractProfileResult(res, profileId);
        if (found) {
          if (!cancelled) { setResult(found); setPolling(false); }
          return;
        }
      } catch {}
      if (!cancelled) pollRef.current = setTimeout(poll, 5000);
    }

    poll();
    return () => { cancelled = true; clearTimeout(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedScore = useCountUp(result ? parseFloat(result.score) : null);
  const displayScore  = result ? animatedScore : null;

  function downloadInterview() {
    const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const type = state.interviewType === 'COMPREHENSIVE' ? 'Comprehensive' : 'Skill';
    const lines = [
      '════════════════════════════════════════════════════════════════',
      '                    SKIPIT — INTERVIEW REPORT',
      '════════════════════════════════════════════════════════════════',
      `Date         : ${date}`,
      `Interview    : ${type} Interview`,
      `Total Time   : ${formatTime(state.timerSecs || 0)}`,
      `Questions    : ${state.answers.length}`,
      `Answered     : ${answered}`,
      `AI-Assisted  : ${aiAnswered}`,
      `Tab Switches : ${tabCount}`,
      result ? `Score        : ${result.score}%` : '',
      '════════════════════════════════════════════════════════════════',
      '',
      'QUESTION & ANSWER REVIEW',
      '────────────────────────────────────────────────────────────────',
      '',
    ];
    state.answers.forEach((item, i) => {
      lines.push(`Q${i + 1}. [${item.subject || 'General'}]  @${item.time || ''}`);
      lines.push(`${item.question}`);
      lines.push('');
      lines.push('Answer:');
      const answer = item.answer || '(Skipped)';
      const words = answer.split(' ');
      let line = '';
      words.forEach(w => {
        if ((line + w).length > 80) { lines.push(line.trimEnd()); line = ''; }
        line += w + ' ';
      });
      if (line.trim()) lines.push(line.trimEnd());
      lines.push('');
      lines.push('────────────────────────────────────────────────────────────────');
      lines.push('');
    });
    lines.push('Generated by SkipIt — AI Interview Platform');
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skipit-interview-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="results-screen">
      <Navbar title="Interview Results" showBack={true} />

      <div className="container">

        {/* Results Hero */}
        <div className="results-hero">
          <h2>
            <Award size={28} style={{ color: 'var(--accent)' }} />
            Interview Complete!
          </h2>
          <p>Here's how you performed</p>

          <div className="score-ring">
            <svg width="160" height="160">
              <circle cx="80" cy="80" r="70" fill="none" stroke="var(--border)" strokeWidth="10" />
              <circle
                cx="80" cy="80" r="70"
                fill="none"
                stroke={result ? 'var(--accent)' : 'var(--border)'}
                strokeWidth="10"
                strokeDasharray="440"
                strokeDashoffset={result ? 440 - (440 * parseFloat(result.score) / 100) : 440}
                strokeLinecap="round"
                transform="rotate(-90 80 80)"
                style={{ transition: 'stroke-dashoffset 1.2s ease' }}
              />
            </svg>
            <div className="score-ring-value">
              {result
                ? `${displayScore}%`
                : polling
                  ? <Loader2 size={24} className="spin" />
                  : '—'}
            </div>
            <div className="score-ring-label">
              {result ? 'Overall' : polling ? 'Scoring…' : 'Score unavailable'}
            </div>
          </div>

          {polling && !result && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
              Waiting for server score…
            </p>
          )}
        </div>

        {/* Stats Grid */}
        <div className="results-grid">
          <div className="card result-card">
            <div className="result-value" style={{ color: 'var(--accent)' }}>{answered}/{total}</div>
            <div className="result-label">
              <CheckCircle size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
              Questions Answered
            </div>
          </div>

          <div className="card result-card">
            <div className="result-value" style={{ color: 'var(--info)' }}>{formatTime(state.timerSecs || 0)}</div>
            <div className="result-label">
              <Clock size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
              Total Time
            </div>
          </div>

          <div className="card result-card">
            <div className="result-value" style={{ color: 'var(--success)' }}>{aiAnswered}</div>
            <div className="result-label">
              <Cpu size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
              AI-Assisted
            </div>
          </div>

          <div className="card result-card">
            <div className="result-value" style={{ color: tabCount > 0 ? 'var(--warning)' : 'var(--success)' }}>
              {tabCount}
            </div>
            <div className="result-label">
              <SkipForward size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
              Tab Switches
            </div>
          </div>
        </div>

        {/* Per-subject metrics */}
        {result?.metrics?.length > 0 && (
          <div className="section-gap">
            <div className="section-title">
              <BarChart2 size={18} color="var(--accent)" />
              Subject Breakdown
            </div>
            <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
              {result.metrics.map((m, i) => {
                const pct = parseFloat(m.percentage) || 0;
                return (
                  <div key={i} style={{
                    padding: '12px 16px',
                    borderBottom: i < result.metrics.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{m.subject_name}</span>
                      <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 700 }}>
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                    <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${pct}%`,
                        background: pct >= 70 ? 'var(--success)' : pct >= 40 ? 'var(--accent)' : 'var(--warning)',
                        borderRadius: 3,
                        transition: 'width 1s ease',
                      }} />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      {m.score_obtained} / {m.score_maximum} pts
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Question Review */}
        <div className="section-title">
          <Clipboard size={18} />
          Question Review
        </div>

        <div className="qa-list">
          {state.answers.map((item, i) => (
            <div key={i} className="card qa-item">
              <div className="qa-q">Q{i + 1}. {item.question}</div>
              <div className="qa-a" style={isMuted(item.answer) ? { color: 'var(--text-muted)' } : undefined}>
                {item.answer || '(Skipped)'}
              </div>
              <div className="qa-meta">
                {item.subject && <span className="badge badge-accent">{item.subject}</span>}
                {getStatusBadge(item.answer)}
                {item.time != null && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={11} />
                    {item.time}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', paddingBottom: 40, flexWrap: 'wrap' }}>
          <button className="btn btn-outline btn-lg" onClick={downloadInterview}>
            <Download size={18} />
            Download Report
          </button>
          <button className="btn btn-primary btn-lg" onClick={() => patch({ screen: 'dashboard' })}>
            <ArrowLeft size={18} />
            Back to Dashboard
          </button>
        </div>

      </div>
    </div>
  );
}
