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

  email: {
    enabled: optionalBool('EMAIL_ENABLED', false),
    host: optional('IMAP_HOST', 'imap.gmail.com'),
    port: optionalInt('IMAP_PORT', 993),
    user: optional('IMAP_USER'),
    pass: optional('IMAP_PASS'),
    folder: optional('IMAP_FOLDER', 'INBOX'),
    pollMinutes: optionalInt('IMAP_POLL_MINUTES', 5),
    allowlist: optional('EMAIL_ALLOWLIST', '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    unseenFirst: optionalBool('IMPORT_UNSEEN_FIRST', true),
  },
};