#!/usr/bin/env node
/**
 * Test TravelApp's Google Maps Platform keys from the root .env file.
 * Usage: node scripts/test-google-apis.mjs [--referrer http://host:8070/]
 */
import fs from 'node:fs';
import path from 'node:path';

function loadEnv(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}. Run this from the TravelApp repository root.`);
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at < 1) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function jsonRequest(label, url, options) {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = null; }
    if (!res.ok) {
      const message = body?.error?.message || body?.error_message || text.slice(0, 240) || `HTTP ${res.status}`;
      console.log(`FAIL  ${label}: HTTP ${res.status} — ${message}`);
      return false;
    }
    return { body, text };
  } catch (error) {
    console.log(`FAIL  ${label}: ${error.message}`);
    return false;
  }
}

const envPath = path.resolve(process.cwd(), '.env');
let env;
try {
  env = loadEnv(envPath);
} catch (error) {
  console.error(`FAIL  ${error.message}`);
  process.exit(1);
}

const placesKey = env.GOOGLE_PLACES_API_KEY;
const browserKey = env.VITE_GOOGLE_MAPS_API_KEY;
const referrer = arg('--referrer') || env.PUBLIC_BASE_URL || 'http://localhost:8070/';
let failed = false;

console.log(`Testing Google APIs using ${envPath}`);
console.log(`Browser referrer: ${referrer}`);

if (!placesKey) {
  console.log('FAIL  GOOGLE_PLACES_API_KEY is missing or empty');
  failed = true;
} else {
  const places = await jsonRequest(
    'Places API (New)',
    'https://places.googleapis.com/v1/places:searchText',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': placesKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.googleMapsUri,places.currentOpeningHours',
      },
      body: JSON.stringify({ textQuery: 'pizza near Naples International Airport Italy', pageSize: 1 }),
    },
  );
  if (places) {
    const hit = places.body?.places?.[0];
    console.log(`PASS  Places API (New): ${hit?.displayName?.text || 'request accepted'}`);
  } else failed = true;

  const geocode = await jsonRequest(
    'Geocoding API',
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent('Naples International Airport Italy')}&key=${encodeURIComponent(placesKey)}`,
  );
  if (geocode) {
    if (geocode.body?.status === 'OK') console.log(`PASS  Geocoding API: ${geocode.body.results?.[0]?.formatted_address || 'request accepted'}`);
    else {
      console.log(`FAIL  Geocoding API: ${geocode.body?.status || 'unknown status'} — ${geocode.body?.error_message || 'no result'}`);
      failed = true;
    }
  } else failed = true;
}

if (!browserKey) {
  console.log('SKIP  VITE_GOOGLE_MAPS_API_KEY is missing (main Google map is not configured)');
} else {
  const maps = await jsonRequest(
    'Maps JavaScript API',
    `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(browserKey)}&v=weekly&callback=Function.prototype`,
    { headers: { Referer: referrer } },
  );
  if (maps) {
    const errors = ['InvalidKeyMapError', 'RefererNotAllowedMapError', 'ApiNotActivatedMapError', 'BillingNotEnabledMapError'];
    const found = errors.find((name) => maps.text.includes(name));
    if (found) {
      console.log(`FAIL  Maps JavaScript API: ${found}`);
      failed = true;
    } else {
      console.log('PASS  Maps JavaScript API script loaded (final referrer enforcement still occurs in a real browser)');
    }
  } else failed = true;
}

console.log(failed ? '\nOne or more API checks failed.' : '\nAll configured API checks passed.');
process.exitCode = failed ? 1 : 0;
