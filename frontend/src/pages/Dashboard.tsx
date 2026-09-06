import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, MapPin, ArrowRight } from 'lucide-react';
import { apiGet, apiPost } from '../lib/api';
import { endForStart } from '../lib/dateRange';
import type { Trip } from '../lib/types';
import { Spinner } from '../components/Spinner';
import { Modal } from '../components/Modal';
import { ThemeSelector } from '../components/ThemeSelector';

export function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    destination: '',
    currency: 'USD',
    startDate: '',
    endDate: '',
    description: '',
  });

  // Sidebar "+" navigates to /?new=1 — open the create dialog and clean the URL.
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowCreate(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const load = async () => {
    try {
      const r = await apiGet<{ trips: Trip[] }>('/trips');
      setTrips(r.trips);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    setSaving(true);
    try {
      await apiPost('/trips', {
        ...form,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
      });
      setShowCreate(false);
      setForm({ name: '', destination: '', currency: 'USD', startDate: '', endDate: '', description: '' });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="app-shell"><Spinner label="Loading trips…" /></div>;
  if (error) return <div className="app-shell"><div className="empty-state"><div className="big danger">{error}</div></div></div>;

  return (
    <div className="app-shell">
      <div className="page-head">
        <div>
          <h1 className="page-title">Your trips</h1>
          <p className="page-sub">Plan upcoming journeys or relive past ones.</p>
        </div>
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <ThemeSelector />
          <button className="btn primary" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> New trip
          </button>
        </div>
      </div>

      {trips.length === 0 ? (
        <div className="empty-state mt">
          <div className="big">No trips yet</div>
          <p>Create your first trip to start building an itinerary, map and budget.</p>
        </div>
      ) : (
        <div className="grid grid-3">
          {trips.map((t) => (
            <Link key={t.id} to={`/trips/${t.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="row between">
                  <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{t.name}</h3>
                  <ArrowRight size={16} style={{ color: 'var(--accent)' }} />
                </div>
                <div className="row small muted">
                  <MapPin size={14} /> {t.destination || 'No destination yet'}
                </div>
                <div className="row" style={{ marginTop: 'auto' }}>
                  <span className="badge accent">{t._count?.places ?? 0} places</span>
                  <span className="badge warn">{t._count?.expenses ?? 0} expenses</span>
                  {t.startDate && (
                    <span className="badge">
                      {new Date(t.startDate).toLocaleDateString()} — {t.endDate ? new Date(t.endDate).toLocaleDateString() : '?'}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="New trip" onClose={() => setShowCreate(false)}>
          <div className="field">
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Japan Autumn" />
          </div>
          <div className="field">
            <label>Destination</label>
            <input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="e.g. Tokyo / Kyoto" />
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label>Start date</label>
              <input type="date" value={form.startDate} onChange={(e) => { const startDate = e.target.value; setForm({ ...form, startDate, endDate: endForStart(startDate, form.endDate) }); }} />
            </div>
            <div className="field">
              <label>End date</label>
              <input type="date" min={form.startDate || undefined} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
          </div>
          <div className="field small">
            <label>Budget currency</label>
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              {['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'NZD'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional notes about this trip" />
          </div>
          {error && <div className="small danger mb">{error}</div>}
          <div className="modal-actions">
            <button className="btn" onClick={() => setShowCreate(false)}>Cancel</button>
            <button className="btn primary" onClick={create} disabled={saving || !form.name}>
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}