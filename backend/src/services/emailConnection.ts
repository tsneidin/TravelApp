import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { config } from '../config.js';

const key = createHash('sha256').update('travelapp-email-credentials-v1:').update(config.jwtSecret).digest();

export function encryptEmailPassword(password: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join(':');
}

export function decryptEmailPassword(secret: string): string {
  const [version, iv, tag, encrypted] = secret.split(':');
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('Invalid saved email credential');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

export function gmailClient(username: string, password: string): ImapFlow {
  return new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: username, pass: password },
    logger: false,
  });
}

export async function testGmailConnection(username: string, password: string, folder: string): Promise<void> {
  const client = gmailClient(username, password);
  try {
    await client.connect();
    await client.mailboxOpen(folder);
  } finally {
    if (client.usable) await client.logout().catch(() => undefined);
  }
}
