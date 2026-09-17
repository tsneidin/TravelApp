import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function optionalInt(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? '', 10);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

function optionalBool(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export const config = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: optionalInt('PORT', 3000),
  debugLogging: optionalBool('DEBUG_LOGGING', false),

  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),

  uploadDir: optional('UPLOAD_DIR', './uploads'),
  publicBaseUrl: optional('PUBLIC_BASE_URL', 'http://localhost:8070'),
  maxUploadMb: optionalInt('MAX_UPLOAD_MB', 25),

  bootstrap: {
    email: optional('BOOTSTRAP_EMAIL'),
    password: optional('BOOTSTRAP_PASSWORD'),
    name: optional('BOOTSTRAP_NAME', 'Admin'),
  },

  legacyEmail: {
    user: optional('LEGACY_IMAP_USER').trim().toLowerCase(),
    recipient: optional('LEGACY_EMAIL_RECIPIENT').trim().toLowerCase(),
  },

  ai: {
    enabled: optionalBool('AI_ENABLED', false),
    baseUrl: optional('AI_BASE_URL', 'http://open-webui:8080'),
    apiKey: optional('AI_API_KEY'),
    model: optional('AI_MODEL', 'llama3'),
    timeoutMs: optionalInt('AI_TIMEOUT_MS', 120_000),
  },

  search: {
    googlePlacesApiKey: optional('GOOGLE_PLACES_BACKEND_API_KEY') || optional('GOOGLE_PLACES_API_KEY'),
    searxngUrl: optional('SEARXNG_URL', 'http://searxng:8080'),
    timeoutMs: optionalInt('SEARCH_TIMEOUT_MS', 10_000),
    enabled: optionalBool('SEARCH_ENABLED', true),
  },
};
