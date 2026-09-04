import { config } from '../config.js';

type DebugDetails = Record<string, string | number | boolean | null | undefined>;

export function debugLog(scope: string, event: string, details: DebugDetails = {}): void {
  if (!config.debugLogging) return;
  const safe = Object.fromEntries(
    Object.entries(details)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 300) : value]),
  );
  console.log(JSON.stringify({
    level: 'debug',
    ts: new Date().toISOString(),
    scope,
    event,
    ...safe,
  }));
}
