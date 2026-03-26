'use client';
import React, { useState } from 'react';
import { LogOut, ArrowLeft } from 'lucide-react';
import { useStore } from '../store';
import { apiPost, clearSession } from '../api';

export default function Navbar({ title, showUser = false, showBack = false }) {
  const { state, patch } = useStore();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await apiPost('signin/api/sign-out', {
        userid:   state.userid,
        email:    state.email,
        operation: 'signout',
      });
    } catch {
      // proceed regardless
    } finally {
      clearSession();
      patch({ loggedIn: false, screen: 'login' });
      setSigningOut(false);
    }
  }

  const displayName =
    state.sdt?.per?.first_name ||
    state.usr?.username ||
    (state.email ? state.email.split('@')[0] : '');

  const avatarLetter = displayName ? displayName.charAt(0).toUpperCase() : '?';

  return (
    <nav className="navbar">
      <div className="nav-logo">
        <div className="nav-logo-icon">SI</div>
        {title && <span className="nav-logo-text">{title}</span>}
      </div>

      <div className="nav-actions">
        {showUser && (
          <div className="nav-user">
            <div className="nav-avatar">{avatarLetter}</div>
            <span>{displayName}</span>
          </div>
        )}

        {showUser && (
          <button
            className="btn btn-outline btn-sm"
            onClick={handleSignOut}
            disabled={signingOut}
            title="Sign out"
          >
            <LogOut size={14} />
            {signingOut ? 'Signing out…' : 'Sign Out'}
          </button>
        )}

        {showBack && (
          <button
            className="btn btn-outline btn-sm"
            onClick={() => patch({ screen: 'dashboard' })}
            title="Back to dashboard"
          >
            <ArrowLeft size={14} />
            Back
          </button>
        )}
      </div>
    </nav>
  );
}
