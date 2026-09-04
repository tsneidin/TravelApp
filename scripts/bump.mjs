#!/usr/bin/env node
/**
 * Bump the app version (patch) and stamp it into:
 *   - frontend/src/lib/version.ts  (what's shown in the UI)
 *   - README.md badge line
 *
 * Usage:  node scripts/bump.mjs [major|minor|patch]
 *         (default: patch)
 *
 * Run before committing so every push carries a visible new version.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const versionFile = path.join(root, 'frontend', 'src', 'lib', 'version.ts');

const current = fs
  .readFileSync(versionFile, 'utf8')
  .match(/APP_VERSION = ['"]([^'"]+)['"]/)?.[1];

if (!current) {
  console.error('Could not find APP_VERSION in', versionFile);
  process.exit(1);
}

const kind = process.argv[2] ?? 'patch';
const [maj, min, pat] = current.split('.').map((n) => parseInt(n, 10) || 0);
let next;
if (kind === 'major') next = `${maj + 1}.0.0`;
else if (kind === 'minor') next = `${maj}.${min + 1}.0`;
else next = `${maj}.${min}.${pat + 1}`;

const content = `/**
 * App version — bump on every commit/push so you can tell which build is deployed.
 * Run: node scripts/bump.mjs  (from the repo root)
 */
export const APP_VERSION = '${next}';\n`;

fs.writeFileSync(versionFile, content);
console.log(`Bumped version ${current} -> ${next}`);