import React, { useRef, useState, useEffect } from 'react';
import { Upload, KeyRound, User, Check, Sparkles, Palette } from 'lucide-react';
import { Modal } from './Modal';
import { Avatar, PRESET_AVATARS } from './Avatar';
import { useAuth } from '../lib/auth';
import { apiPatch, apiPost, uploadAvatar } from '../lib/api';
import { THEMES, getSavedTheme, applyTheme, type ThemeId } from '../lib/theme';

export interface UserSettingsModalProps {
  onClose: () => void;
}

export function UserSettingsModal({ onClose }: UserSettingsModalProps) {
  const { user, refreshUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<'profile' | 'theme' | 'security'>('profile');
  const [name, setName] = useState(user?.name ?? '');
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(user?.avatarUrl ?? null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState('');
  const [profileError, setProfileError] = useState('');

  // Theme state
  const [currentTheme, setCurrentTheme] = useState<ThemeId>(getSavedTheme);

  useEffect(() => {
    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ theme: ThemeId }>;
      if (customEvent.detail?.theme) {
        setCurrentTheme(customEvent.detail.theme);
      }
    };
    window.addEventListener('travelapp:theme-changed', handleThemeChange);
    return () => window.removeEventListener('travelapp:theme-changed', handleThemeChange);
  }, []);

  const handleSelectTheme = (id: ThemeId) => {
    applyTheme(id);
    setCurrentTheme(id);
  };

  // Password fields
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const handleAvatarFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingAvatar(true);
    setProfileError('');
    try {
      const data = await uploadAvatar(file);
      setSelectedAvatar(data.avatarUrl);
      await refreshUser();
      setProfileSuccess('Avatar photo uploaded successfully!');
      setTimeout(() => setProfileSuccess(''), 3000);
    } catch (err) {
      setProfileError((err as Error).message);
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSavingProfile(true);
    setProfileError('');
    try {
      await apiPatch('/auth/profile', {
        name: name.trim(),
        avatarUrl: selectedAvatar,
      });
      await refreshUser();
      setProfileSuccess('Profile updated successfully!');
      setTimeout(() => setProfileSuccess(''), 3000);
    } catch (err) {
      setProfileError((err as Error).message);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) return;
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      return;
    }

    setSavingPassword(true);
    setPasswordError('');
    try {
      await apiPost('/auth/change-password', {
        currentPassword,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSuccess('Password changed successfully!');
      setTimeout(() => setPasswordSuccess(''), 3000);
    } catch (err) {
      setPasswordError((err as Error).message);
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <Modal title="Account & Member Settings" onClose={onClose} wide>
      {/* Settings Navigation Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, borderBottom: '1px solid var(--line)', paddingBottom: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`btn sm ${activeTab === 'profile' ? 'primary' : 'ghost'}`}
          onClick={() => setActiveTab('profile')}
        >
          <User size={14} /> Profile & Avatar
        </button>
        <button
          type="button"
          className={`btn sm ${activeTab === 'theme' ? 'primary' : 'ghost'}`}
          onClick={() => setActiveTab('theme')}
        >
          <Palette size={14} /> Appearance & Theme
        </button>
        <button
          type="button"
          className={`btn sm ${activeTab === 'security' ? 'primary' : 'ghost'}`}
          onClick={() => setActiveTab('security')}
        >
          <KeyRound size={14} /> Password & Security
        </button>
      </div>

      {activeTab === 'profile' && (
        <form onSubmit={handleSaveProfile}>
          {profileSuccess && (
            <div className="badge ok mb-3" style={{ padding: '8px 12px', width: '100%', boxSizing: 'border-box' }}>
              <Check size={14} style={{ marginRight: 6 }} /> {profileSuccess}
            </div>
          )}
          {profileError && (
            <div className="badge danger mb-3" style={{ padding: '8px 12px', width: '100%', boxSizing: 'border-box' }}>
              {profileError}
            </div>
          )}

          {/* Avatar Preview & Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, padding: 14, background: 'var(--panel)', borderRadius: 10, border: '1px solid var(--line)' }}>
            <Avatar name={name} avatarUrl={selectedAvatar} size="xl" />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '0.98rem', marginBottom: 4 }}>
                {name || 'Your Name'}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: 10 }}>
                {user?.email} {user?.isAdmin ? '• Admin' : '• Member'}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                >
                  <Upload size={13} /> {uploadingAvatar ? 'Uploading…' : 'Upload photo'}
                </button>
                {selectedAvatar && (
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => setSelectedAvatar(null)}
                  >
                    Reset to initials
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={handleAvatarFileUpload}
                />
              </div>
            </div>
          </div>

          {/* Preset Travel Avatars Selection */}
          <div className="field mb-4">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Sparkles size={14} style={{ color: 'var(--accent)' }} /> Choose a Travel Avatar
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(46px, 1fr))', gap: 8 }}>
              {PRESET_AVATARS.map((p) => {
                const presetToken = `preset:${p.id}`;
                const isSelected = selectedAvatar === presetToken;
                return (
                  <button
                    key={p.id}
                    type="button"
                    title={p.label}
                    onClick={() => setSelectedAvatar(presetToken)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.4rem',
                      height: 46,
                      borderRadius: 8,
                      border: isSelected ? '2px solid var(--accent)' : '1px solid var(--line)',
                      background: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'var(--panel)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {p.emoji}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="field mb-3">
            <label>Display Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name or nickname"
              required
            />
          </div>

          <div className="field mb-3">
            <label>Email Address</label>
            <input
              type="email"
              value={user?.email ?? ''}
              disabled
              style={{ opacity: 0.65, cursor: 'not-allowed' }}
            />
            <span style={{ fontSize: '0.74rem', color: 'var(--muted)', marginTop: 3 }}>
              Email cannot be changed directly. Contact admin if required.
            </span>
          </div>

          <div className="modal-actions">
            <button type="submit" className="btn primary" disabled={savingProfile || !name.trim()}>
              {savingProfile ? 'Saving…' : 'Save Changes'}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {activeTab === 'theme' && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: '1rem' }}>Workspace Theme</h3>
            <p className="small muted" style={{ margin: 0 }}>
              Choose your personalized workspace theme. Themes customize color palettes, navigation accents, card borders, and brand gradients across the app.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, marginBottom: 20 }}>
            {THEMES.map((theme) => {
              const isSelected = currentTheme === theme.id;
              return (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => handleSelectTheme(theme.id)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    padding: 14,
                    borderRadius: 10,
                    border: isSelected ? '2px solid var(--accent)' : '1px solid var(--line)',
                    background: isSelected ? 'rgba(34, 211, 238, 0.08)' : 'var(--panel)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                    position: 'relative',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          background: theme.primaryColor,
                          border: '2px solid rgba(255,255,255,0.2)',
                          boxShadow: `0 0 8px ${theme.primaryColor}55`,
                        }}
                      />
                      <span style={{ fontWeight: 700, fontSize: '0.94rem', color: 'var(--text)' }}>
                        {theme.name}
                      </span>
                    </div>

                    {isSelected && (
                      <span className="badge ok" style={{ fontSize: '0.7rem', padding: '2px 6px', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Check size={11} /> Active
                      </span>
                    )}
                  </div>

                  <span className="small muted" style={{ fontSize: '0.78rem', lineHeight: 1.35, marginBottom: 10 }}>
                    {theme.tagline}
                  </span>

                  {/* Color Palette Preview Bar */}
                  <div style={{ display: 'flex', width: '100%', height: 6, borderRadius: 3, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ flex: 1, background: theme.primaryColor }} />
                    <div style={{ flex: 1, background: theme.secondaryColor }} />
                    <div style={{ flex: 1, background: theme.bgColor }} />
                  </div>
                </button>
              );
            })}
          </div>

          <div className="modal-actions">
            <button type="button" className="btn primary" onClick={onClose}>
              Done
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      )}

      {activeTab === 'security' && (
        <form onSubmit={handleChangePassword}>
          {passwordSuccess && (
            <div className="badge ok mb-3" style={{ padding: '8px 12px', width: '100%', boxSizing: 'border-box' }}>
              <Check size={14} style={{ marginRight: 6 }} /> {passwordSuccess}
            </div>
          )}
          {passwordError && (
            <div className="badge danger mb-3" style={{ padding: '8px 12px', width: '100%', boxSizing: 'border-box' }}>
              {passwordError}
            </div>
          )}

          <div className="field mb-3">
            <label>Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
              required
              autoFocus
            />
          </div>

          <div className="field mb-3">
            <label>New Password (min. 8 characters)</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              minLength={8}
              required
            />
          </div>

          <div className="field mb-3">
            <label>Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              minLength={8}
              required
            />
          </div>

          <div className="modal-actions">
            <button
              type="submit"
              className="btn primary"
              disabled={savingPassword || !currentPassword || !newPassword || newPassword !== confirmPassword}
            >
              {savingPassword ? 'Updating…' : 'Update Password'}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
