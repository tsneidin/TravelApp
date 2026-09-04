import { prisma } from '../db.js';
import { config } from '../config.js';

export interface AiConfigData {
  enabled: boolean;
  provider: string; // 'open-webui' | 'ollama' | 'openai' | 'groq' | 'custom'
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
}

const AI_CONFIG_KEY = 'ai_config';

export async function getAiConfig(): Promise<AiConfigData> {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: AI_CONFIG_KEY },
    });
    if (setting?.value) {
      const parsed = JSON.parse(setting.value) as Partial<AiConfigData>;
      return {
        enabled: parsed.enabled ?? config.ai.enabled,
        provider: parsed.provider || (parsed.baseUrl?.includes('openai.com') ? 'openai' : 'custom'),
        baseUrl: parsed.baseUrl || config.ai.baseUrl,
        apiKey: parsed.apiKey !== undefined ? parsed.apiKey : config.ai.apiKey,
        model: parsed.model || config.ai.model,
        timeoutMs: parsed.timeoutMs || config.ai.timeoutMs,
      };
    }
  } catch (err) {
    console.warn('[settings] Failed to read AI config from DB, using env defaults:', (err as Error).message);
  }

  return {
    enabled: config.ai.enabled,
    provider: config.ai.baseUrl.includes('openai.com') ? 'openai' : 'custom',
    baseUrl: config.ai.baseUrl,
    apiKey: config.ai.apiKey,
    model: config.ai.model,
    timeoutMs: config.ai.timeoutMs,
  };
}

export async function saveAiConfig(data: Partial<AiConfigData>): Promise<AiConfigData> {
  const current = await getAiConfig();
  const updated: AiConfigData = {
    enabled: data.enabled !== undefined ? Boolean(data.enabled) : current.enabled,
    provider: data.provider || current.provider,
    baseUrl: (data.baseUrl || current.baseUrl).trim(),
    apiKey: data.apiKey !== undefined ? data.apiKey.trim() : current.apiKey,
    model: (data.model || current.model).trim(),
    timeoutMs: data.timeoutMs || current.timeoutMs,
  };

  await prisma.systemSetting.upsert({
    where: { key: AI_CONFIG_KEY },
    update: { value: JSON.stringify(updated) },
    create: { key: AI_CONFIG_KEY, value: JSON.stringify(updated) },
  });

  return updated;
}

export interface TestResult {
  ok: boolean;
  models: string[];
  message: string;
  error?: string;
}

function normalizeModelsUrl(baseUrl: string): string[] {
  const base = baseUrl.replace(/\/+$/, '');
  const urls: string[] = [];

  // If URL already ends with /v1, try /v1/models and /models
  if (base.endsWith('/v1')) {
    urls.push(`${base}/models`);
    urls.push(`${base.replace(/\/v1$/, '')}/models`);
    urls.push(`${base.replace(/\/v1$/, '')}/api/tags`); // Ollama native
  } else if (base.endsWith('/api')) {
    urls.push(`${base}/models`);
    urls.push(`${base}/v1/models`);
  } else {
    urls.push(`${base}/v1/models`);
    urls.push(`${base}/models`);
    urls.push(`${base}/api/tags`); // Ollama native
  }
  return urls;
}

export async function testAiConnection(target: {
  baseUrl: string;
  apiKey?: string;
  model?: string;
}): Promise<TestResult> {
  const baseUrl = target.baseUrl.trim();
  if (!baseUrl) {
    return { ok: false, models: [], message: 'Base URL is required' };
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (target.apiKey) {
    headers.Authorization = `Bearer ${target.apiKey}`;
  }

  const modelUrls = normalizeModelsUrl(baseUrl);
  const foundModels: string[] = [];
  let lastError = '';

  for (const url of modelUrls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timer);

      if (res.ok) {
        const json = (await res.json()) as Record<string, unknown>;
        // OpenAI / Open WebUI format: { data: [{ id: "model-name" }] }
        if (Array.isArray(json.data)) {
          for (const item of json.data) {
            if (typeof item === 'object' && item && 'id' in item && typeof item.id === 'string') {
              foundModels.push(item.id);
            }
          }
        }
        // Ollama format: { models: [{ name: "model:tag" }] }
        if (Array.isArray(json.models)) {
          for (const item of json.models) {
            if (typeof item === 'object' && item && 'name' in item && typeof item.name === 'string') {
              foundModels.push(item.name);
            }
          }
        }

        if (foundModels.length > 0) {
          return {
            ok: true,
            models: Array.from(new Set(foundModels)).sort(),
            message: `Connection successful! Found ${foundModels.length} models.`,
          };
        }
      } else {
        lastError = `HTTP ${res.status}: ${res.statusText}`;
      }
    } catch (e) {
      lastError = (e as Error).message;
    }
  }

  // If fetching models list didn't work, test a ping to the chat completions endpoint directly
  try {
    const chatEndpoint = baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : baseUrl.endsWith('/v1')
        ? `${baseUrl}/chat/completions`
        : `${baseUrl}/v1/chat/completions`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(chatEndpoint, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: target.model || 'test',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok || res.status === 400 || res.status === 404) {
      // 400 with invalid model means the server IS reachable!
      return {
        ok: true,
        models: target.model ? [target.model] : [],
        message: 'Endpoint is reachable! (Manual model entry allowed)',
      };
    }
    lastError = `HTTP ${res.status} from chat endpoint`;
  } catch (e) {
    lastError = (e as Error).message;
  }

  return {
    ok: false,
    models: [],
    message: `Failed to connect: ${lastError}`,
    error: lastError,
  };
}
