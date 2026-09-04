import { useEffect, useState } from 'react';
import {
  Check, AlertCircle, Eye, EyeOff, Loader2, RefreshCw
} from 'lucide-react';
import { Modal } from './Modal';
import { apiGet, apiPost } from '../lib/api';
import type { AiConfig, AiTestResult } from '../lib/types';
import { Spinner } from './Spinner';

interface AISettingsModalProps {
  tripId: string;
  onClose: () => void;
  onSaved: () => void;
}

const PROVIDER_PRESETS: {
  id: string;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  requiresKey: boolean;
}[] = [
  {
    id: 'open-webui',
    label: 'Open WebUI (Docker / Unraid)',
    defaultBaseUrl: 'http://open-webui:8080',
    defaultModel: 'llama3',
    requiresKey: false,
  },
  {
    id: 'ollama',
    label: 'Ollama (Local / Host IP)',
    defaultBaseUrl: 'http://192.168.86.86:11434/v1',
    defaultModel: 'llama3.2',
    requiresKey: false,
  },
  {
    id: 'openai',
    label: 'OpenAI (Official API)',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    requiresKey: true,
  },
  {
    id: 'groq',
    label: 'Groq (Ultra-Fast Llama / Mixtral)',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    requiresKey: true,
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    defaultBaseUrl: 'http://localhost:8080/v1',
    defaultModel: 'llama3',
    requiresKey: false,
  },
];

export function AISettingsModal({ tripId, onClose, onSaved }: AISettingsModalProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState('open-webui');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [timeoutMs, setTimeoutMs] = useState(120000);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    apiGet<AiConfig>(`/trips/${tripId}/ai/config`)
      .then((cfg) => {
        if (!alive) return;
        setEnabled(cfg.enabled);
        setProvider(cfg.provider || 'open-webui');
        setBaseUrl(cfg.baseUrl || 'http://open-webui:8080');
        setApiKey(cfg.apiKey || '');
        setModel(cfg.model || 'llama3');
        setTimeoutMs(cfg.timeoutMs || 120000);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [tripId]);

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    const preset = PROVIDER_PRESETS.find((p) => p.id === newProvider);
    if (preset) {
      if (!baseUrl || PROVIDER_PRESETS.some((p) => p.defaultBaseUrl === baseUrl)) {
        setBaseUrl(preset.defaultBaseUrl);
      }
      if (!model || PROVIDER_PRESETS.some((p) => p.defaultModel === model)) {
        setModel(preset.defaultModel);
      }
    }
  };

  const handleTestConnection = async () => {
    if (!baseUrl.trim()) {
      setError('Please provide a Base URL to test');
      return;
    }
    setTesting(true);
    setTestResult(null);
    setError('');

    try {
      const res = await apiPost<AiTestResult>(`/trips/${tripId}/ai/test`, {
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
      });
      setTestResult(res);
      if (res.ok && res.models?.length) {
        setAvailableModels(res.models);
        if (!model || !res.models.includes(model)) {
          setModel(res.models[0]);
        }
      }
    } catch (e) {
      setTestResult({
        ok: false,
        models: [],
        message: (e as Error).message,
        error: (e as Error).message,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await apiPost(`/trips/${tripId}/ai/config`, {
        enabled,
        provider,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
        timeoutMs: Number(timeoutMs) || 120000,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="AI Assistant Settings" onClose={onClose}>
      {loading ? (
        <Spinner label="Loading settings…" />
      ) : (
        <div className="ai-settings-form">
          {error && <div className="ai-error mb-3">{error}</div>}

          {/* Enable Toggle */}
          <div className="ai-enable-box">
            <div className="grow">
              <b>Enable AI Assistant</b>
              <div className="small muted">Turn on trip itinerary assistance, booking imports, and chat</div>
            </div>
            <label className="switch-label">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                style={{ width: 18, height: 18, cursor: 'pointer' }}
              />
            </label>
          </div>

          {/* Provider Preset */}
          <div className="field mt-3">
            <label>AI Provider</label>
            <select value={provider} onChange={(e) => handleProviderChange(e.target.value)}>
              {PROVIDER_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* Base URL */}
          <div className="field">
            <label>Base URL (API Endpoint)</label>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://open-webui:8080 or http://<ip>:11434/v1"
            />
            <div className="small muted" style={{ marginTop: 4 }}>
              Must be accessible from the TravelApp container. Use host LAN IP (e.g. <code>http://192.168.86.86:11434/v1</code>) if Ollama is running on Unraid host.
            </div>
          </div>

          {/* API Key */}
          <div className="field">
            <label>API Key {PROVIDER_PRESETS.find((p) => p.id === provider)?.requiresKey ? '(Required)' : '(Optional)'}</label>
            <div className="row" style={{ position: 'relative' }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={apiKey ? '••••••••' : 'Optional for local Ollama / Open WebUI'}
                style={{ paddingRight: 40 }}
              />
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => setShowKey(!showKey)}
                style={{ position: 'absolute', right: 6, top: 5, padding: '4px 8px' }}
                title={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {/* Model Selection & Test Button */}
          <div className="field">
            <div className="row between" style={{ marginBottom: 4 }}>
              <label style={{ margin: 0 }}>Model Name</label>
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => void handleTestConnection()}
                disabled={testing || !baseUrl.trim()}
                title="Test connection and fetch installed models"
              >
                {testing ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
                <span>{testing ? 'Testing…' : 'Test & Fetch Models'}</span>
              </button>
            </div>

            {availableModels.length > 0 ? (
              <div className="row" style={{ gap: 8 }}>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  style={{ flex: 1 }}
                >
                  {availableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Or type custom model"
                  style={{ flex: 1 }}
                />
              </div>
            ) : (
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. llama3, llama3.2, gpt-4o-mini"
              />
            )}
          </div>

          {/* Test Result Banner */}
          {testResult && (
            <div
              className={`test-result-banner ${testResult.ok ? 'test-success' : 'test-failure'}`}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: '0.82rem',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 14,
                background: testResult.ok ? 'rgba(52, 211, 153, 0.12)' : 'rgba(248, 113, 113, 0.12)',
                border: `1px solid ${testResult.ok ? 'var(--ok)' : 'var(--danger)'}`,
                color: testResult.ok ? 'var(--ok)' : 'var(--danger)',
              }}
            >
              {testResult.ok ? <Check size={16} /> : <AlertCircle size={16} />}
              <span className="grow">{testResult.message}</span>
            </div>
          )}

          <div className="modal-actions mt-4">
            <button type="button" className="btn" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
