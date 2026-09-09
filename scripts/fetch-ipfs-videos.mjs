#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PINATA_API_URL = 'https://api.pinata.cloud/v3/files/public?limit=100';
const GATEWAY_URL = process.env.PINATA_GATEWAY ?? 'https://gateway.pinata.cloud';
const JWT = process.env.PINATA_JWT;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = path.join(__dirname, '../src/data/examples.json');

async function main() {
  if (!JWT) {
    console.error('PINATA_JWT environment variable is required.');
    process.exit(1);
  }

  console.log('Fetching files from Pinata...');
  const response = await fetch(PINATA_API_URL, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${JWT}`
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Pinata API request failed: ${response.status} ${response.statusText}`);
    console.error(errorText);
    process.exit(1);
  }

  const data = await response.json();
  const files = data.data.files || [];

  const videos = files
    .filter(file => file.mime_type === 'video/mp4')
    .slice(0, 25)
    .map(file => {
      const { cid, mime_type, keyvalues } = file;
      return {
        cid,
        gatewayUrl: `${GATEWAY_URL.replace(/\/$/, '')}/ipfs/${cid}`,
        mimeType: mime_type,
        mindId: keyvalues?.mindId,
        filmId: keyvalues?.filmId,
        takeId: keyvalues?.takeId
      };
    });

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(videos, null, 2));
  console.log(`Saved ${videos.length} videos to src/data/examples.json`);
}

main().catch(console.error);
