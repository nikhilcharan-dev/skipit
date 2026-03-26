'use client';
import { useState, useEffect, useRef } from 'react';
import { useStore, useSession } from '../store';
import { apiPost, deptS3, semS3 } from '../api';
import { User, BookOpen, FileText, ArrowRight, UploadCloud, Play, Search, X, ChevronDown } from 'lucide-react';

// ─── Static options ────────────────────────────────────────────────────────────

const deptOptions = [
  { value: '1001', label: 'Computer Science and IT',       s3: 'el_cse'  },
  { value: '1002', label: 'Electronics & Communication',   s3: 'el_ece'  },
  { value: '1003', label: 'Mechanical Engineering',        s3: 'el_mech' },
];

const DEFAULT_SEM_OPTIONS = [
  { value: '1', label: 'Software Developer - Entry Level' },
  { value: '2', label: 'Data Analyst'                     },
  { value: '3', label: 'Full Stack Developer'             },
];

const experienceOptions = [
  { value: '0',  label: 'Fresher'   },
  { value: '1',  label: '1 year'    },
  { value: '2',  label: '2 years'   },
  { value: '3+', label: '3+ years'  },
];

const DEFAULT_SUBJECTS = [
  { id: 2998, display_name: 'React Js',         label: 'React Js',         value: 'React Js'         },
  { id: 2999, display_name: 'JavaScript',       label: 'JavaScript',       value: 'JavaScript'       },
  { id: 3000, display_name: 'Python',           label: 'Python',           value: 'Python'           },
  { id: 3001, display_name: 'Data Structures',  label: 'Data Structures',  value: 'Data Structures'  },
  { id: 3002, display_name: 'SQL',              label: 'SQL',              value: 'SQL'              },
  { id: 3003, display_name: 'Java',             label: 'Java',             value: 'Java'             },
];

// ─── Step indicator ────────────────────────────────────────────────────────────

const SKILL_STEPS = [
  { num: 1, label: 'Profile',  Icon: User      },
  { num: 2, label: 'Subjects', Icon: BookOpen  },
  { num: 3, label: 'Resume',   Icon: FileText  },
];

const HR_STEPS = [
  { num: 1, label: 'Profile', Icon: User     },
  { num: 2, label: 'Resume',  Icon: FileText },
];

function StepIndicators({ current, isHR }) {
  const steps = isHR ? HR_STEPS : SKILL_STEPS;
  return (
    <div className="setup-steps">
      {steps.map((s, i) => {
        const isDone   = current > s.num;
        const isActive = current === s.num;
        return (
          <div key={s.num} style={{ display: 'flex', alignItems: 'center' }}>
            <div className={`setup-step${isActive ? ' active' : ''}${isDone ? ' done' : ''}`}>
              <div className="setup-step-num">
                {isDone ? <s.Icon size={13} /> : s.num}
              </div>
              {s.label}
            </div>
            {i < steps.length - 1 && <div className="setup-connector" />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function Setup({ sessionId }) {
  const { patch } = useStore();
  const { session, patchSession } = useSession(sessionId);
  const isHR = session?.interviewType === 'HR';

  // ── wizard state
  const [step, setStep] = useState(1);

  // ── step 1 — profile
  const [deptId,     setDeptId]     = useState('1001');
  const [semId,      setSemId]      = useState('1');
  const [experience, setExperience] = useState('0');
  const [semOptions, setSemOptions] = useState(DEFAULT_SEM_OPTIONS);
  const [semLoading, setSemLoading] = useState(false);
  const [semDet,     setSemDet]     = useState([]);
  const [profileId,  setProfileId]  = useState(24);
  const [setId,      setSetId]      = useState(1);

  // ── step 2 — subjects
  const [subjects,     setSubjects]     = useState([]);
  const [subLoading,   setSubLoading]   = useState(false);
  const [selectedIds,  setSelectedIds]  = useState([]);
  const [subSearch,    setSubSearch]    = useState('');
  const [dropOpen,     setDropOpen]     = useState(false);
  const dropRef = useRef(null);

  // ── step 3 — resume
  const [resumeFile, setResumeFile] = useState(null);
  const [beginning,  setBeginning]  = useState(false);
  const fileInputRef = useRef(null);

  // ── On mount: fetch interview types + semesters
  useEffect(() => {
    fetchInterviewTypes();
    fetchSemesters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Re-derive semester options when dept changes
  useEffect(() => {
    if (semDet.length === 0) return;
    const entry = semDet.find(d => d.Departments?.id === parseInt(deptId, 10)) || semDet[0];
    const rows = entry?.semesters || [];
    if (rows.length > 0) {
      const opts = rows.map(r => ({
        value: String(r.id || r.sem_id),
        label: r.display_name || r.name || r.sem_name || String(r.id),
      }));
      setSemOptions(opts);
      setSemId(opts[0].value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deptId, semDet]);

  async function fetchInterviewTypes() {
    try {
      const res = await apiPost(
        'interview-questions/api/sdt/fetch-interview-types',
        {
          user_cat_id:  session?.userid?.user_cat_id,
          set_id:       1,
          mail:         session?.email,
          access_token: session?.accessToken,
          college_id:   session?.collegeId,
        }
      );
      if (res?.profile_id) setProfileId(res.profile_id);
    } catch (e) {
      console.warn('[Setup] fetch-interview-types', e);
    }
  }

  async function fetchSemesters() {
    setSemLoading(true);
    try {
      const res = await apiPost('common/api/common/semesters', {
        access_token: session?.accessToken,
      });
      const det = res?.det || [];
      if (det.length > 0) {
        setSemDet(det);
        const entry = det.find(d => d.Departments?.id === parseInt(deptId, 10)) || det[0];
        const rows = entry?.semesters || res?.data || res?.semesters || [];
        if (rows.length > 0) {
          const opts = rows.map(r => ({
            value: String(r.id || r.sem_id),
            label: r.display_name || r.name || r.sem_name || String(r.id),
          }));
          setSemOptions(opts);
          setSemId(opts[0].value);
        }
      }
    } catch (e) {
      console.warn('[Setup] semesters', e);
    } finally {
      setSemLoading(false);
    }
  }

  // ── Close subject dropdown on outside click
  useEffect(() => {
    function handleOutside(e) {
      if (dropRef.current && !dropRef.current.contains(e.target)) setDropOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  async function fetchSubjects(dept, sem) {
    setSubLoading(true);
    setSelectedIds([]);
    try {
      const res = await apiPost(
        'common/api/common/subjects-semesters-department',
        {
          dept_id:      parseInt(dept, 10),
          sem_id:       parseInt(sem, 10),
          qtype:        'OPN',
          access_token: session?.accessToken,
        }
      );
      const rows = res?.data || res?.subjects || res?.det || [];
      if (rows.length > 0) {
        const mapped = rows.map(r => ({
          id:           r.id || r.subject_id,
          display_name: r.display_name || r.name || r.subject_name,
          label:        r.display_name || r.name || r.subject_name,
          value:        r.display_name || r.name || r.subject_name,
        }));
        setSubjects(mapped);
      } else {
        setSubjects(DEFAULT_SUBJECTS);
      }
    } catch (e) {
      console.warn('[Setup] subjects', e);
      setSubjects(DEFAULT_SUBJECTS);
    } finally {
      setSubLoading(false);
    }
  }

  // ── Navigation
  function goToStep2() {
    if (isHR) {
      setStep(2);
    } else {
      fetchSubjects(deptId, semId);
      setStep(2);
    }
  }

  function goToStep3() { setStep(3); }
  function goBack()    { setStep(s => s - 1); }

  function toggleSubject(id) {
    setSelectedIds(prev => prev.includes(id) ? [] : [id]);
    setDropOpen(false);
    setSubSearch('');
  }

  function handleDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) setResumeFile(file);
  }

  function handleDragOver(e) { e.preventDefault(); }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (file) setResumeFile(file);
  }

  // ── Begin Interview
  async function beginInterview() {
    if (beginning) return;
    setBeginning(true);

    const deptName = deptOptions.find(d => d.value === deptId)?.label || 'Computer Science and IT';
    const semName  = semOptions.find(s => s.value === semId)?.label   || 'Software Developer - Entry Level';

    const profileid = {
      dept:       { id: parseInt(deptId, 10), name: deptName, s3_folder: deptS3(parseInt(deptId, 10)) },
      sem:        { id: parseInt(semId,  10), name: semName,  s3_folder: semS3(semName)               },
      set_id:     setId,
      profile_id: profileId,
      experience,
      date:       new Date().toISOString().slice(0, 10),
    };

    const resumeFileMeta = resumeFile ? {
      name: resumeFile.name,
      type: resumeFile.type || 'application/pdf',
      size: resumeFile.size,
      date: String(resumeFile.lastModified || Date.now()),
      span: '0',
    } : null;

    patchSession({
      status:           'interview',
      profileid,
      selectedSubjects: isHR ? [] : selectedIds,
      subjects:         isHR ? [] : subjects,
      resumeFile:       resumeFile || null,
      resumeFileMeta,
    });
  }

  // ── Render helpers

  function renderStep1() {
    return (
      <div className="setup-panel">
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Your Profile</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>
            Tell us about your academic background so we can tailor your interview.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="form-group">
              <label className="form-label">Department</label>
              <select className="form-select" value={deptId} onChange={e => setDeptId(e.target.value)}>
                <option value="1001">Computer Science and IT</option>
                <option value="1002">Electronics &amp; Communication</option>
                <option value="1003">Mechanical Engineering</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Role / Level</label>
              <select
                className="form-select"
                value={semId}
                onChange={e => setSemId(e.target.value)}
                disabled={semLoading}
              >
                {(semLoading ? DEFAULT_SEM_OPTIONS : semOptions).map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Experience</label>
              <select className="form-select" value={experience} onChange={e => setExperience(e.target.value)}>
                {experienceOptions.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={goToStep2}>
            Continue <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  function renderStep2() {
    const filteredSubs = subjects.filter(s =>
      (s.display_name || s.label || '').toLowerCase().includes(subSearch.toLowerCase())
    );
    const selectedSubjects = subjects.filter(s => selectedIds.includes(s.id));

    return (
      <div className="setup-panel">
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Select Subject</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>
            Choose one subject you want to be assessed on.
          </p>

          {subLoading ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 14 }}>
              Loading subjects...
            </div>
          ) : (
            <div ref={dropRef} style={{ position: 'relative' }}>
              <div className="subject-search-box" onClick={() => setDropOpen(o => !o)}>
                <Search size={14} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
                <input
                  className="subject-search-input"
                  placeholder="Search and select a subject…"
                  value={subSearch}
                  onChange={e => { setSubSearch(e.target.value); setDropOpen(true); }}
                  onClick={e => { e.stopPropagation(); setDropOpen(true); }}
                />
                <ChevronDown
                  size={14}
                  style={{ flexShrink: 0, color: 'var(--text-muted)', transition: 'transform 0.15s', transform: dropOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                />
              </div>

              {dropOpen && (
                <div className="subject-dropdown">
                  {filteredSubs.length === 0 ? (
                    <div style={{ padding: '12px 14px', color: 'var(--text-muted)', fontSize: 13 }}>
                      No subjects match "{subSearch}"
                    </div>
                  ) : (
                    filteredSubs.map(s => {
                      const selected = selectedIds.includes(s.id);
                      return (
                        <div
                          key={s.id}
                          className={`subject-option${selected ? ' selected' : ''}`}
                          onMouseDown={e => { e.preventDefault(); toggleSubject(s.id); }}
                        >
                          <span>{s.display_name || s.label}</span>
                          {selected && <X size={12} style={{ flexShrink: 0 }} />}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}

          {!subLoading && selectedSubjects.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
              {selectedSubjects.map(s => (
                <div key={s.id} className="selected-subject-chip">
                  <span>{s.display_name || s.label}</span>
                  <button
                    className="chip-remove-btn"
                    onMouseDown={e => { e.preventDefault(); toggleSubject(s.id); }}
                    aria-label={`Remove ${s.display_name}`}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {!subLoading && selectedIds.length === 0 && (
            <p style={{ marginTop: 14, fontSize: 12, color: 'var(--error)' }}>
              Please select a subject to continue.
            </p>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button className="btn btn-outline" onClick={goBack}>Back</button>
          <button className="btn btn-primary" onClick={goToStep3} disabled={selectedIds.length === 0}>
            Continue <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  function renderResumeStep() {
    const canStart = isHR ? !!resumeFile : true;
    return (
      <div className="setup-panel">
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Upload Resume</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>
            {isHR
              ? 'Your resume is required for the HR interview — questions will be personalised based on it.'
              : 'Upload your resume to personalise questions. This step is optional.'}
          </p>

          <div
            className="resume-drop"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            {resumeFile ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <FileText size={36} color="var(--accent-light)" />
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{resumeFile.name}</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {(resumeFile.size / 1024).toFixed(1)} KB
                </p>
                <button
                  className="btn btn-sm btn-outline"
                  onClick={e => { e.stopPropagation(); setResumeFile(null); }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <UploadCloud size={40} color={isHR ? 'var(--accent)' : 'var(--text-muted)'} />
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                  Drop your resume here or click to browse
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {isHR ? 'PDF, DOC or DOCX — required' : 'PDF, DOC or DOCX — optional'}
                </p>
              </div>
            )}
          </div>

          {isHR && !resumeFile && (
            <p style={{ marginTop: 12, fontSize: 12, color: 'var(--error)' }}>
              Please upload your resume to continue.
            </p>
          )}

          <div
            style={{
              marginTop: 24, padding: '14px 16px',
              background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6,
            }}
          >
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Interview Summary
            </p>
            <SummaryRow label="Type"       value={isHR ? 'HR Interview' : 'Skill Interview'} />
            <SummaryRow label="Department" value={deptOptions.find(d => d.value === deptId)?.label} />
            <SummaryRow label="Role"       value={semOptions.find(s => s.value === semId)?.label}  />
            <SummaryRow label="Experience" value={experienceOptions.find(e => e.value === experience)?.label} />
            {!isHR && (
              <SummaryRow
                label="Subjects"
                value={
                  selectedIds.length === 0
                    ? 'None selected'
                    : subjects.filter(s => selectedIds.includes(s.id)).map(s => s.display_name || s.label).join(', ')
                }
              />
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button className="btn btn-outline" onClick={goBack}>Back</button>
          <button
            className="btn btn-primary btn-lg"
            onClick={beginInterview}
            disabled={beginning || !canStart}
          >
            {beginning ? <>Preparing…</> : <><Play size={18} /> Start Interview</>}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="setup-screen">
      <nav className="navbar">
        <div className="nav-logo">
          <div className="nav-logo-icon">SI</div>
          <span className="nav-logo-text">SkipIt</span>
        </div>
        <div className="nav-actions">
          <div className="nav-user">
            <div className="nav-avatar">
              {(session?.email?.[0] || 'U').toUpperCase()}
            </div>
            {session?.email}
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => patch({ screen: 'dashboard' })}>
            ← Dashboard
          </button>
        </div>
      </nav>

      <div className="container" style={{ paddingTop: 32 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 6 }}>Set Up Your Interview</h1>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            Complete the steps below to begin your personalised AI interview.
          </p>
        </div>

        <StepIndicators current={step} isHR={isHR} />

        {step === 1 && renderStep1()}
        {step === 2 && !isHR && renderStep2()}
        {step === 2 &&  isHR && renderResumeStep()}
        {step === 3 && !isHR && renderResumeStep()}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 13 }}>
      <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>{label}:</span>
      <span style={{ color: 'var(--text)', fontWeight: 500 }}>{value || '—'}</span>
    </div>
  );
}
