#!/usr/bin/env node
// One-off test render for the soccer-pitch scene described by the user.
//
//   node --env-file-if-exists=.env scripts/drive-test.mjs
//   node --env-file-if-exists=.env scripts/drive-test.mjs --raw   # keep brand/person names
//
// Fetches the five on-chain stills, validates/resizes them for H3 reference mode,
// submits the prompt to MiniMax-H3 (768P, 6s), polls, and writes the result to
// assets/renders/test-*.mp4.

import { Alchemy, Network } from 'alchemy-sdk';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { awaitVideo, createH3Task, h3Content, priceUsd } from './minimax.mjs';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = resolve(root, 'assets/renders');
const refDir = resolve(outDir, 'test-refs');

const raw = process.argv.includes('--raw');

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

// The five pieces we need as references.
const TOKENS = [
  {
    key: 'ape',
    label: 'adidas ape (Subject 1)',
    chain: 'eth-mainnet',
    address: '0x28472a58A490c5e09A238847F66A68a47cC76f0f',
    tokenId: '1',
  },
  {
    key: 'porsche',
    label: 'PORSCHΞ 911 (Picture 1)',
    chain: 'eth-mainnet',
    address: '0xb763d44326552600c3B83258aD490F68777D4c27',
    tokenId: '0',
  },
  {
    key: 'messi',
    label: 'Lionel Messi: The Golden One',
    chain: 'eth-mainnet',
    address: '0x912ba2984910f9e3576df76ccbbba3b8e8b1dd97',
    tokenId: '1',
  },
  {
    key: 'matrix',
    label: 'Matrix Avatar #7',
    chain: 'polygon-mainnet',
    address: '0x8eA732c9dcC90d98DAEA6c6F51A72a21B47899Ae',
    tokenId: '7',
  },
  {
    key: 'tshirt',
    label: 'BSTROY x Givenchy T-shirt',
    chain: 'eth-mainnet',
    address: '0xE5d8aEDB8dbd3A9EB406E5B11E1838b07712090A',
    tokenId: '3',
  },
];

const CHAIN_TO_NETWORK = {
  'eth-mainnet': Network.ETH_MAINNET,
  'polygon-mainnet': Network.MATIC_MAINNET,
};

const apiKey = process.env.VITE_ALCHEMY_API_KEY || process.env.ALCHEMY_API_KEY;
if (!apiKey) {
  console.error('Set VITE_ALCHEMY_API_KEY or ALCHEMY_API_KEY');
  process.exit(1);
}

const clientFor = (chain) => {
  const network = CHAIN_TO_NETWORK[chain];
  if (!network) throw new Error(`unsupported chain ${chain}`);
  return new Alchemy({ apiKey, network });
};

const toHttp = (url) =>
  url?.startsWith('ipfs://') ? 'https://ipfs.io/ipfs/' + url.slice('ipfs://'.length) : url;

const stillCandidates = (nft) =>
  [
    nft?.image?.originalUrl,
    nft?.image?.pngUrl,
    nft?.image?.cachedUrl,
    nft?.raw?.metadata?.image,
    nft?.rawMetadata?.image,
  ]
    .filter((u) => typeof u === 'string' && u.trim())
    .map((u) => toHttp(u.trim()))
    .filter((u, i, a) => a.indexOf(u) === i);

const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://dweb.link/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];

const urlVariants = (url) => {
  const m = url.match(/\/ipfs\/(.+)$/);
  if (!m) return [url];
  const path = m[1];
  return [url, ...IPFS_GATEWAYS.map((g) => g + path)].filter((u, i, a) => a.indexOf(u) === i);
};

const extFor = (url, ct) => {
  const fromUrl = extname(new URL(url).pathname).toLowerCase();
  if (fromUrl) return fromUrl;
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
  };
  return map[ct?.split(';')[0]?.trim()] ?? '.bin';
};

const download = async (url, basename, { timeoutMs = 180_000 } = {}) => {
  for (const candidate of urlVariants(url)) {
    try {
      const response = await fetch(candidate, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) throw new Error('empty body');
      const contentType = response.headers.get('content-type');
      const file = resolve(refDir, basename + extFor(response.url || candidate, contentType));
      await writeFile(file, buffer);
      return { file, bytes: buffer.length, contentType };
    } catch (e) {
      // try next gateway
    }
  }
  throw new Error(`failed to download ${url}`);
};

const probe = async (file) => {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'json',
    file,
  ]);
  const { streams = [] } = JSON.parse(stdout);
  return { width: Number(streams[0]?.width ?? 0), height: Number(streams[0]?.height ?? 0) };
};

const normalizeRef = async (source, out) => {
  // Resize to a reference-friendly 1024px short side, keeping format PNG for stability.
  await run('ffmpeg', [
    '-v', 'error', '-y',
    '-i', source,
    '-vf', 'scale=-2:1024:flags=lanczos',
    '-frames:v', '1',
    out,
  ]);
  return out;
};

const sanitizePrompt = (text) => {
  if (raw) return text;
  // Project rule: real brand/person names tend to trip MiniMax's content filter (error 1026).
  // The reference images carry the marks; the text only needs to direct motion and light.
  const replacements = [
    [/\bPorsche 911\b/gi, 'the white rounded-silhouette sports car with four round LED headlamps'],
    [/\bPorsche\b/gi, 'the white sports car'],
    [/\bLionel Messi\b/gi, 'the male soccer player'],
    [/\bMessi\b/gi, 'the soccer player'],
    [/\bGivenchy\b/gi, 'the black scripted tee'],
    [/\bBSTROY\b/gi, ''],
    [/\bMatrix Avatar #7\b/gi, 'the goalkeeper'],
  ];
  let out = text;
  for (const [re, repl] of replacements) out = out.replace(re, repl);
  // Clean up leftover "BSTROY x" / "x Givenchy" fragments.
  out = out.replace(/\s+x\s+/g, ' ').replace(/\s{2,}/g, ' ');
  return out.trim();
};

const prompt = sanitizePrompt(`
Subject 1 is the stylized ape character wearing a neon yellow tracksuit, white sneakers with three blue stripes, a yellow hat, and red heart-shaped sunglasses from the reference image, standing beside the white sports car with his left hand on the steering wheel.
Subject 2 is the male soccer player: "The Golden One" from the reference image, a soccer player wearing a golden jersey with number 10 and mid-kick with a glowing soccer ball, positioned slightly left of centre.
Subject 3 is the goalkeeper from the reference image, a male figure wearing a brown cardigan with dark buttons over a tan Oxford shirt, gray slacks, red-brown leather work boots, holding a neon green and white lunchbox, wearing the black short-sleeve tee with white stylized script and circular badge, standing in goal slightly right of centre.
Subject 4 is the black short-sleeve tee from the reference image, the black short-sleeve tee with white stylized script across chest, circular badge with blue cross on orange background, metallic chain, and stylized bee with yellow.

integrated_multimodal_description: Cinematic 35mm film simulation with slight teal-and-amber push, fine grain, and soft highlight roll-off; lens is a 35mm prime at T2.8 for shallow depth on subjects with deep background; no added text, captions, subtitles, or signage may appear anywhere in the frame. A floodlit soccer pitch at night under crisp, cool stadium lights, the grass slightly damp from recent rain, creating subtle reflections; the sky is a deep indigo with faint stars, and the goal frame is standard white with black netting, all bathed in a soft, even wash that preserves the golden glow of the soccer player’s jersey and ball, the neon green of the keeper’s lunchbox, and the neon yellow of the ape’s tracksuit without color shift. The shot is one unbroken take; the camera may move freely through 3D space around the action but must not cut or jump between setups; all transitions are achieved via physical camera motion only. The camera begins in a medium-wide, slightly low-angle static shot framing the soccer player and the glowing ball in left third, keeper and goal in right third; at the moment of foot-ball contact, the camera pushes in with small amplitude at slow speed, then executes a tracking arc shot around the trio (soccer player, ball, keeper) at medium speed, completing approximately 270 degrees as the white sports car enters from left and stops in front of the goal, then pushes out slightly to include the rebound before easing to a stop as motion returns to real-time.

Beat 1: The soccer player, in golden jersey and shorts, approaches the glowing soccer ball and plants his non-kicking foot, swinging his right leg forward as the ball hovers just ahead of him; the goalkeeper stands ready in goal, wearing the brown cardigan, tan Oxford shirt, gray slacks, red-brown work boots, and neon green/white lunchbox, with the black scripted tee visible on his chest.

Beat 2: As the soccer player's foot makes contact with the glowing ball, time dilates into slow-motion bullet-time; the camera pushes in slightly and begins a smooth tracking arc around the action at medium speed, circling from the soccer player's left side, behind the ball, to the keeper's right side while maintaining focus on the deforming ball and the soccer player's follow-through.

Beat 3: During the arc, the stylized ape character in neon yellow tracksuit, yellow hat, red heart-shaped sunglasses, and white sneakers with three blue stripes drives the white sports car from off-screen left, braking sharply to a halt directly in front of the goal mouth just as the ball would cross the line; the car's four circular LED headlamps, shield-shaped badge, and black front bumper are fully visible.

Beat 4: The glowing ball strikes the front of the white sports car and rebounds backward at high speed, snapping the scene back to real-time; the camera pushes out slightly to capture the rebound trajectory before coming to rest as the soccer player lands, the keeper reacts, and the ape shifts gear in the idle sports car.

Beat 5: The ball sails wide of the goal, coming to a stop on the damp grass; the ape gives a thumbs-up from the sports car window, the soccer player raises his hands in appeal, and the goalkeeper lowers his lunchbox, all under the steady stadium lights as the pitch settles.

Every character must be a living figure with ordinary skin and proportions—no mannequins, statues, or chrome avatars; the ape, the soccer player, and the goalkeeper must retain natural limb movement and facial expressiveness as living subjects.
`);

const sound =
  'Diegetic sound begins with the crisp impact of boot on ball, a sharp thack that echoes slightly; ' +
  'as slow-motion engages, the sound stretches into a deep, resonant low hum with the ball\'s ' +
  'deformation audible as a slow, rubbery creak; the white sports car approaches with a rising ' +
  'whine of its engine, tyres screeching slightly on wet asphalt as it stops, then the rebound ' +
  'delivers a sharp, percussive klack off the metal bumper, followed by the ball\'s rapid flutter ' +
  'through air and a soft grass shush on return to real-time.';

const text = `${prompt.trim()}\n\nSound: ${sound}`;

// --------------------------------------------------------------------------- main

await mkdir(outDir, { recursive: true });
await mkdir(refDir, { recursive: true });

const referenceImages = [];

console.log(`\n${c.bold}Fetching reference stills${c.reset}\n`);

for (const token of TOKENS) {
  process.stdout.write(`${c.cyan}${token.key}${c.reset} ${c.dim}${token.label}…${c.reset} `);
  try {
    const nft = await clientFor(token.chain).nft.getNftMetadata(token.address, token.tokenId);
    const candidates = stillCandidates(nft);
    if (!candidates.length) throw new Error('no still candidates');

    let sourceFile;
    for (const url of candidates) {
      try {
        const { file } = await download(url, `${token.key}-raw`);
        sourceFile = file;
        break;
      } catch {
        // try next candidate
      }
    }
    if (!sourceFile) throw new Error('all downloads failed');

    const normalized = resolve(refDir, `${token.key}.png`);
    await normalizeRef(sourceFile, normalized);
    referenceImages.push(normalized);
    console.log(`${c.green}✓${c.reset} ${c.dim}${normalized.replace(`${root}/`, '')}${c.reset}`);
  } catch (error) {
    console.log(`${c.red}✗ ${error.message}${c.reset}`);
    process.exit(1);
  }
}

const config = {
  api: 'v2',
  model: 'MiniMax-H3',
  resolution: '768P',
  duration: 6,
  ratio: '16:9',
  text,
  referenceImages,
};

console.log(`\n${c.bold}Submitting to MiniMax-H3${c.reset}`);
console.log(`${c.dim}${config.resolution} · ${config.duration}s · ${referenceImages.length} refs · est $${priceUsd(config).toFixed(2)}${c.reset}`);
if (!raw) console.log(`${c.yellow}brand/person names sanitized to avoid error 1026 (pass --raw to disable)${c.reset}`);

const startedAt = Date.now();
const content = await h3Content({ text: config.text, referenceImages: config.referenceImages });
const taskId = await createH3Task({ ...config, content });
console.log(`${c.dim}task ${taskId}${c.reset}`);

const { url, usage } = await awaitVideo(taskId, {
  api: 'v2',
  onTick: ({ status, elapsedMs }) => {
    process.stdout.write(`\r${c.dim}  ${status} ${Math.round(elapsedMs / 1000)}s${c.reset}   `);
  },
});
process.stdout.write('\r');

const response = await fetch(url);
const mp4 = resolve(outDir, 'test-1.mp4');
await writeFile(mp4, Buffer.from(await response.arrayBuffer()));

await writeFile(
  resolve(outDir, 'test-1.json'),
  `${JSON.stringify({ ...config, taskId, sourceUrl: url, usage, seconds: Math.round((Date.now() - startedAt) / 1000) }, null, 2)}\n`,
);

// 3x3 contact sheet at 2fps for a quick read without opening the clip.
try {
  await run('ffmpeg', [
    '-v', 'error', '-y',
    '-i', mp4,
    '-vf', 'fps=2,scale=320:-1,tile=3x3',
    '-frames:v', '1',
    resolve(outDir, 'test-1.grid.png'),
  ]);
} catch (error) {
  console.log(`${c.yellow}contact sheet failed: ${error.message}${c.reset}`);
}

console.log(`${c.green}✓${c.reset} ${mp4.replace(`${root}/`, '')}`);
console.log(`${c.dim}usage:${c.reset}`, usage);
