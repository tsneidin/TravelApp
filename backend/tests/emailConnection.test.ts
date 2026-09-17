import { describe, expect, it } from 'vitest';
import { decryptEmailPassword, encryptEmailPassword } from '../src/services/emailConnection.js';

describe('saved Gmail credentials', () => {
  it('encrypts app passwords with a different nonce each time and rejects changes', () => {
    const first = encryptEmailPassword('example-app-password');
    const second = encryptEmailPassword('example-app-password');
    expect(first).not.toBe(second);
    expect(first).not.toContain('example-app-password');
    expect(decryptEmailPassword(first)).toBe('example-app-password');
    expect(decryptEmailPassword(second)).toBe('example-app-password');
    expect(() => decryptEmailPassword(`${first.slice(0, -2)}xx`)).toThrow();
  });
});
