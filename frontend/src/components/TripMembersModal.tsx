import React, { useState } from 'react';
import { UserPlus, Trash2, Crown, Shield, Eye, LogOut, Check } from 'lucide-react';
import { Modal, ConfirmModal } from './Modal';
import { Avatar } from './Avatar';
import { apiPost, apiPatch, apiDelete } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Trip, TripMember } from '../lib/types';

export interface TripMembersModalProps {
  trip: Trip;
  onClose: () => void;
  onReload: () => Promise<void>;
}

export function TripMembersModal({ trip, onClose, onReload }: TripMembersModalProps) {
  const { user } = useAuth();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [removingMember, setRemovingMember] = useState<TripMember | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const isOwner = trip.ownerId === user?.id || user?.isAdmin;
  const members = trip.members ?? [];

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setInviting(true);
    setError('');
    setSuccess('');
    try {
      await apiPost(`/trips/${trip.id}/members`, {
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
      });
      setInviteEmail('');
      setSuccess(`Invited ${inviteEmail} as ${inviteRole}!`);
      setTimeout(() => setSuccess(''), 3500);
      await onReload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: 'editor' | 'viewer') => {
    try {
      await apiPatch(`/trips/${trip.id}/members/${userId}`, { role: newRole });
      await onReload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleRemoveMember = async () => {
    if (!removingMember) return;
    try {
      await apiDelete(`/trips/${trip.id}/members/${removingMember.userId}`);
      setRemovingMember(null);
      await onReload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleLeaveTrip = async () => {
    if (!user) return;
    try {
      await apiDelete(`/trips/${trip.id}/members/${user.id}`);
      window.location.href = '/';
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <Modal title={`Trip Members & Sharing — ${trip.name}`} onClose={onClose} wide>
        {error && (
          <div className="badge danger mb-3" style={{ padding: '8px 12px', width: '100%', boxSizing: 'border-box' }}>
            {error}
          </div>
        )}
        {success && (
          <div className="badge ok mb-3" style={{ padding: '8px 12px', width: '100%', boxSizing: 'border-box' }}>
            <Check size={14} style={{ marginRight: 6 }} /> {success}
          </div>
        )}

        {/* Invite New Member Form (Available to Owner/Admin) */}
        {isOwner && (
          <form
            onSubmit={handleInvite}
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'flex-end',
              marginBottom: 20,
              padding: 14,
              background: 'var(--panel)',
              borderRadius: 10,
              border: '1px solid var(--line)',
            }}
          >
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 5 }}>
                Invite by Email
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="collaborator@example.com"
                  required
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <div style={{ width: 120 }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 5 }}>
                Role
              </label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as 'editor' | 'viewer')}
                style={{ width: '100%' }}
              >
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>

            <button type="submit" className="btn primary" disabled={inviting || !inviteEmail.trim()}>
              <UserPlus size={14} /> {inviting ? 'Inviting…' : 'Invite'}
            </button>
          </form>
        )}

        {/* Members List */}
        <div>
          <h4 style={{ margin: '0 0 10px', fontSize: '0.9rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Trip Participants ({1 + members.length})
          </h4>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Trip Owner */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                background: 'var(--panel)',
                borderRadius: 8,
                border: '1px solid var(--line)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar user={trip.owner} size="lg" />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>
                    {trip.owner?.name || 'Owner'}{' '}
                    {trip.ownerId === user?.id && <span className="badge" style={{ fontSize: '0.68rem', marginLeft: 4 }}>You</span>}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                    {trip.owner?.email}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#f59e0b', fontWeight: 600, fontSize: '0.82rem' }}>
                <Crown size={15} /> Owner
              </div>
            </div>

            {/* Invited Collaborators */}
            {members.map((m) => {
              const isCurrentUser = m.userId === user?.id;
              return (
                <div
                  key={m.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: 'var(--panel)',
                    borderRadius: 8,
                    border: '1px solid var(--line)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Avatar user={m.user} size="lg" />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>
                        {m.user?.name || 'Member'}{' '}
                        {isCurrentUser && <span className="badge" style={{ fontSize: '0.68rem', marginLeft: 4 }}>You</span>}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                        {m.user?.email}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {isOwner ? (
                      <select
                        value={m.role}
                        onChange={(e) => handleRoleChange(m.userId, e.target.value as 'editor' | 'viewer')}
                        style={{ fontSize: '0.82rem', padding: '4px 8px' }}
                      >
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    ) : (
                      <span className={`badge ${m.role === 'editor' ? 'accent' : ''}`} style={{ textTransform: 'capitalize' }}>
                        {m.role === 'editor' ? <Shield size={12} style={{ marginRight: 4 }} /> : <Eye size={12} style={{ marginRight: 4 }} />}
                        {m.role}
                      </span>
                    )}

                    {isOwner && (
                      <button
                        type="button"
                        className="btn sm ghost danger"
                        onClick={() => setRemovingMember(m)}
                        title="Remove collaborator"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Non-owner option to leave trip */}
        {!isOwner && (
          <div style={{ marginTop: 24, paddingTop: 14, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn danger sm"
              onClick={() => setConfirmLeave(true)}
            >
              <LogOut size={14} /> Leave this trip
            </button>
          </div>
        )}
      </Modal>

      {/* Remove Member Confirmation */}
      {removingMember && (
        <ConfirmModal
          title="Remove Member"
          message={`Are you sure you want to remove ${removingMember.user?.name || removingMember.user?.email || 'this member'} from the trip?`}
          confirmLabel="Remove"
          danger
          onConfirm={handleRemoveMember}
          onCancel={() => setRemovingMember(null)}
        />
      )}

      {/* Leave Trip Confirmation */}
      {confirmLeave && (
        <ConfirmModal
          title="Leave Trip"
          message={`Are you sure you want to leave "${trip.name}"? You will lose access until invited again.`}
          confirmLabel="Leave Trip"
          danger
          onConfirm={handleLeaveTrip}
          onCancel={() => setConfirmLeave(false)}
        />
      )}
    </>
  );
}
