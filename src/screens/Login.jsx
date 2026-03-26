'use client';
import React, { useState, useEffect, useRef } from 'react';
import { Eye, EyeOff, Loader } from 'lucide-react';
import { useStore } from '../store';
import { signIn, saveSession } from '../api';

export default function Login() {
  const { state, patch } = useStore();

  const [email, setEmail]         = useState(state.email || '');
  const [password, setPassword]   = useState('');
  const [showPass, setShowPass]   = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  const emailRef    = useRef(null);
  const passwordRef = useRef(null);

  // Focus email input on mount
  useEffect(() => {
    if (emailRef.current) emailRef.current.focus();
  }, []);

  async function handleSubmit() {
    if (loading) return;

    const trimmedEmail    = email.trim();
    const trimmedPassword = password.trim();

    if (!trimmedEmail) {
      setError('Please enter your email address.');
      if (emailRef.current) emailRef.current.focus();
      return;
    }
    if (!trimmedPassword) {
      setError('Please enter your password.');
      if (passwordRef.current) passwordRef.current.focus();
      return;
    }

    setError('');
    setLoading(true);

    try {
      const result = await signIn(trimmedEmail, trimmedPassword);

      if (!result) {
        setError('Login failed. Please try again.');
        return;
      }

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.loggedIn) {
        patch(result);
        saveSession(result);
        patch({ screen: 'dashboard' });
      } else {
        setError('Login failed. Please check your credentials.');
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
      console.error('[Login]', err);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSubmit();
  }

  return (
    <div className="login-screen">
      {loading && (
        <div className="login-overlay">
          <div className="login-overlay-spinner" />
          <div className="login-overlay-label">Signing in…</div>
        </div>
      )}
      <div className="login-wrapper" style={loading ? { opacity: 0.25, pointerEvents: 'none' } : undefined}>
        <div className="login-hero">
          <div className="login-hero-icon">SI</div>
          <h1>Welcome to SkipIt</h1>
          <p>Your AI-powered interview preparation platform</p>
        </div>

        <div className="login-card">
          <div className="form-group">
            <label className="form-label" htmlFor="loginEmail">
              Email address
            </label>
            <input
              id="loginEmail"
              type="email"
              className="form-input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError('');
              }}
              onKeyDown={handleKeyDown}
              ref={emailRef}
              autoComplete="email"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="loginPassword">
              Password
            </label>
            <div className="password-wrapper">
              <input
                id="loginPassword"
                type={showPass ? 'text' : 'password'}
                className="form-input"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError('');
                }}
                onKeyDown={handleKeyDown}
                ref={passwordRef}
                autoComplete="current-password"
                disabled={loading}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPass((prev) => !prev)}
                tabIndex={-1}
                aria-label={showPass ? 'Hide password' : 'Show password'}
                disabled={loading}
              >
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader size={16} className="spin" />
                Signing in...
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
