#!/usr/bin/env node
// Prepare reference images for MiniMax H3 from the real on-chain artwork.
//
//   npm run prep:refs
//   npm run prep:refs -- --only ape,revuelto
//   npm run prep:refs -- --frames 12
//
// The hero video must be conditioned on the exact assets the brands minted, so this
// script resolves each piece through Alchemy, downloads the highest-quality media it
// can, and — where the artwork is a film or an animated GIF rather than a still —
// samples candidate frames with ffmpeg for a human to choose between.
//
// Everything lands in assets/refs/ (gitignored) plus a manifest.json recording the
// contract, chain, token and source URL behind every image: the provenance record that
// backs the licensing claim.
//
// Reads ALCHEMY_API_KEY or VITE_ALCHEMY_API_KEY from .env (loaded by the npm script).

import { Alchemy, Network } from 'alchemy-sdk';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const refsDir = resolve(root, 'assets/refs');
const rawDir = resolve(refsDir, 'raw');
const framesDir = resolve(refsDir, 'frames');
const wideDir = resolve(refsDir, 'wide');

// Widescreen reference frames, for image-to-video on /v1.
//
// This exists because of a measured API behaviour: /v1 image-to-video returns a video
// with the ASPECT RATIO OF THE FIRST FRAME — `resolution: '768P'` only sets the short
// side. Every one of these tokens is a square product shot, so submitting them raw
// yields a 768×768 video, and cropping a square to 16:9 afterwards throws away 43% of
// the frame. Composing the reference into 16:9 up front means the model frames for
// widescreen from the start.
const WIDE = { width: 1920, height: 1080 };

// MiniMax /v2 reference-image limits. Violating these fails the request, so we check
// locally rather than paying a round trip to find out.
// https://platform.minimax.io/docs/api-reference/video-generation-v2-create
const MIN_SIDE = 256;
const MAX_SIDE = 5760;
const MAX_BYTES = 30 * 1024 * 1024;
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic']);

// The cast. `source: 'frames'` means the artwork's own motion is the best likeness —
// sample the film and pick a frame; `source: 'still'` means the still is already right.
const PIECES = [
  {
    key: 'ape',
    label: 'adidas Originals: Into the Metaverse — Phase 2',
    note: 'The ape. Artwork is a 42MB mp4; the still is a single jpeg.',
    chain: 'eth-mainnet',
    address: '0x28472a58A490c5e09A238847F66A68a47cC76f0f',
    tokenId: '1',
    source: 'frames',
    // The 1920×1920 still is a trading card: neon frame, "INDIGO HERZ" type, adidas and
    // BAYC badges, and the ape himself only about a sixth of the frame. Cut him out, or
    // the card is what MiniMax reproduces.
    crops: [
      { name: 'ape-figure', rect: [700, 290, 540, 1270], height: 1600 },
      { name: 'ape-head', rect: [845, 325, 200, 250], height: 1024 },
    ],
  },
  {
    key: 'ape-phase1',
    label: 'adidas Originals: Into the Metaverse — Phase 1',
    note: 'Phase 1 artwork carries several licensed characters together.',
    chain: 'eth-mainnet',
    address: '0x28472a58A490c5e09A238847F66A68a47cC76f0f',
    tokenId: '0',
    source: 'frames',
  },
  {
    key: 'revuelto',
    label: 'Automobili Lamborghini Revuelto',
    note: 'Still is an animated GIF — needs a frame pulled out of it.',
    chain: 'base-mainnet',
    address: '0x962c80b21465fc4d1069ea764c2404cf2efF4460',
    tokenId: '1',
    source: 'frames',
  },
  {
    key: 'jacket',
    label: 'Dolce & Gabbana Collezione Genesi — The Velvet Impossible Jacket',
    chain: 'eth-mainnet',
    address: '0xd71B53FE1Df51075c5a965956cdc87421C2fFeD7',
    tokenId: '1',
    source: 'still',
  },
  {
    key: 'rimowa',
    label: 'RTFKT x RIMOWA "Meta-Artisan" Original Cabin Luggage',
    chain: 'eth-mainnet',
    address: '0xba83BF331E478294e17c46E56A446250aaD0B84C',
    tokenId: '1',
    source: 'still',
  },
  {
    key: 'lv-trunk',
    label: 'Louis Vuitton VIA Tile Trunk',
    chain: 'base-mainnet',
    address: '0xC8dA1caC0d0ec57F78d0F34bb459474244E72771',
    tokenId: '1',
    source: 'still',
  },
];

// Widescreen frames to compose once the pieces above have been fetched. `from` is
// relative to assets/refs/. Chosen by eye from the sampled candidates.
const WIDE_TARGETS = [
  { name: 'car', from: 'frames/revuelto-03.png', mode: 'crop' },
  { name: 'car-fleet', from: 'frames/revuelto-07.png', mode: 'crop' },
  // Bright flat violet card background — blur-extending it showed visible seams.
  { name: 'ape', from: 'frames/ape-head.png', mode: 'extend-edge' },
  { name: 'rimowa', from: 'raw/rimowa-still.png', mode: 'extend' },
  { name: 'lv-trunk', from: 'raw/lv-trunk-still.jpg', mode: 'extend' },
  { name: 'jacket', from: 'raw/jacket-still.jpg', mode: 'extend' },
];

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

const pad = (value, width) => String(value ?? '').padEnd(width).slice(0, width);

const arg = (flag) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
};

const only = arg('--only')?.split(',').map((value) => value.trim());
const frameCount = Number(arg('--frames') ?? 9);

const apiKey = process.env.ALCHEMY_API_KEY || process.env.VITE_ALCHEMY_API_KEY;
if (!apiKey) {
  console.error(
    'No API key. Set VITE_ALCHEMY_API_KEY in .env (npm run prep:refs loads it) ' +
      'or export ALCHEMY_API_KEY.',
  );
  process.exit(1);
}

// Same trick as scripts/verify-brands.mjs: src/services/alchemy.js reads import.meta.env
// so Node can't import it, but the chain map is the only thing we need from it.
const alchemySource = await readFile(resolve(root, 'src/services/alchemy.js'), 'utf8');
const networksBlock = alchemySource.match(/export const NETWORKS = \{([\s\S]*?)\n\};/)?.[1] ?? '';
const CHAIN_TO_NETWORK = new Map(
  [...networksBlock.matchAll(/"([a-z0-9-]+-mainnet)":\s*Network\.(\w+)/g)]
    .filter(([, , member]) => member in Network)
    .map(([, chain, member]) => [chain, Network[member]]),
);

// The media resolvers are pure and live outside alchemy.js precisely so scripts can use
// them — see src/lib/nftMedia.js.
const { resolveNftVideo, stillCandidates, resolveNftName } = await import(
  resolve(root, 'src/lib/nftMedia.js')
);

const clients = new Map();
const clientFor = (chain) => {
  const network = CHAIN_TO_NETWORK.get(chain);
  if (!network) throw new Error(`chain "${chain}" is not in NETWORKS`);
  if (!clients.has(chain)) clients.set(chain, new Alchemy({ apiKey, network }));
  return clients.get(chain);
};

/** ffprobe the first video stream. Works for stills, GIFs and mp4 alike. */
const probe = async (file) => {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,nb_frames',
    '-show_entries', 'format=duration',
    '-of', 'json',
    file,
  ]);
  const { streams = [], format = {} } = JSON.parse(stdout);
  return {
    width: Number(streams[0]?.width ?? 0),
    height: Number(streams[0]?.height ?? 0),
    frames: Number(streams[0]?.nb_frames ?? 0) || null,
    duration: Number(format.duration ?? 0) || null,
  };
};

// ipfs.io answers 504 for these CIDs more often than not, which silently costs us the
// full-resolution `originalUrl` and leaves us on Alchemy's downscaled copy. Try the same
// CID across several public gateways before giving up on it.
const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://dweb.link/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://nftstorage.link/ipfs/',
];

const urlVariants = (url) => {
  const match = url.match(/\/ipfs\/(.+)$/);
  if (!match) return [url];
  const path = match[1];
  return [url, ...IPFS_GATEWAYS.map((gateway) => gateway + path)].filter(
    (value, index, all) => all.indexOf(value) === index,
  );
};

const extFor = (url, contentType) => {
  const fromUrl = extname(new URL(url).pathname).toLowerCase();
  if (fromUrl) return fromUrl;
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
  };
  return map[contentType?.split(';')[0]?.trim()] ?? '.bin';
};

/**
 * Download `url`, trying every IPFS gateway variant before failing. The adidas film is
 * 42MB over a public gateway, which reliably outlives fetch's default behaviour — hence
 * the explicit long timeout rather than letting it abort as "terminated".
 */
const download = async (url, basename, { timeoutMs = 180_000 } = {}) => {
  const attempts = [];
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
      const file = resolve(rawDir, basename + extFor(response.url || candidate, contentType));
      await writeFile(file, buffer);
      return { file, bytes: buffer.length, contentType, url: candidate };
    } catch (error) {
      attempts.push(`${new URL(candidate).host}: ${error.message}`);
    }
  }
  throw new Error(attempts.join('; '));
};

/**
 * Cut a region out of a source image and scale it to a usable reference size.
 *
 * This is not cosmetic. Several of these tokens present the artwork as a composite —
 * the adidas ape is a small figure on a trading card, framed in neon and surrounded by
 * type. Handed to MiniMax whole, the card is what gets reproduced. Cropping to the
 * subject is what makes the reference a reference.
 */
const cropTo = async (source, name, { rect, height }) => {
  const [x, y, w, h] = rect;
  const out = resolve(framesDir, `${name}.png`);
  await run('ffmpeg', [
    '-v', 'error', '-y',
    '-i', source,
    '-vf', `crop=${w}:${h}:${x}:${y},scale=-2:${height}:flags=lanczos`,
    '-frames:v', '1',
    out,
  ]);
  return out;
};

/**
 * Sample `count` evenly-spaced frames as PNGs. Percentile-based rather than
 * timestamp-based so it behaves the same on a 3s GIF and a 90s film. Skips the extreme
 * head and tail, which are usually a title card or a fade to black.
 */
const sampleFrames = async (file, key, count) => {
  const { duration, frames } = await probe(file);
  const span = duration ?? 0;
  const written = [];

  for (let index = 0; index < count; index += 1) {
    const fraction = (index + 1) / (count + 1);
    const out = resolve(framesDir, `${key}-${String(index + 1).padStart(2, '0')}.png`);
    const args = ['-v', 'error', '-y'];

    if (span > 0.5) {
      // -ss before -i is the fast seek; accurate enough for frame shopping.
      args.push('-ss', (span * fraction).toFixed(3), '-i', file);
    } else if (frames && frames > 1) {
      // Very short GIFs report no useful duration — index by frame instead.
      args.push('-i', file, '-vf', `select=eq(n\\,${Math.floor(frames * fraction)})`, '-vsync', '0');
    } else {
      args.push('-i', file);
    }

    args.push('-frames:v', '1', out);
    try {
      await run('ffmpeg', args);
      written.push(out);
    } catch {
      // A seek past the end of a short clip is expected; keep whatever we got.
    }
    if (span <= 0.5 && !(frames && frames > 1)) break; // single-frame source
  }
  return written;
};

/**
 * Compose a square reference into a 1920×1080 frame.
 *
 * `crop` for subjects that are already wide — the Revuelto fills its frame horizontally,
 * so a centre crop just improves the composition.
 *
 * `extend` for tall subjects on a dark field (a standing case, a jacket on a mannequin).
 * Cropping those decapitates them, so the source is blown up, heavily blurred and used as
 * its own backdrop with the sharp original composited on top. On the near-black studio
 * voids these tokens use, the join is invisible.
 *
 * `extend-edge` for tall subjects on a bright, flat, saturated field. Blur-extending those
 * leaves visible vertical seams where the sharp inset meets the blur — measured on the ape,
 * whose violet card background made the wings obvious. Instead, stretch a narrow strip of
 * the source's own left and right edges outward. On a flat or gently patterned background
 * that is genuinely seamless, because the pixels being stretched are the background.
 *
 * Both matter because MiniMax preserves the composition it is handed rather than extending
 * the scene itself — whatever we hand over is what comes back.
 */
const composeWide = async (source, name, mode) => {
  const { width, height } = WIDE;
  const out = resolve(wideDir, `${name}.png`);

  const blurExtend =
    `split=2[bg][fg];` +
    `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},gblur=sigma=42,eq=brightness=-0.04[back];` +
    `[fg]scale=-2:${height}[front];` +
    `[back][front]overlay=(W-w)/2:0`;

  // Left half of the canvas is the source's left edge stretched out, right half is its
  // right edge, then the untouched subject sits centred on top.
  const edgeExtend =
    `split=3[fg][le][re];` +
    `[fg]scale=-2:${height},setsar=1[front];` +
    `[le]crop=iw*0.04:ih:0:0,scale=${width}:${height},setsar=1,gblur=sigma=6[base];` +
    `[re]crop=iw*0.04:ih:iw*0.96:0,scale=${width / 2}:${height},setsar=1,gblur=sigma=6[right];` +
    `[base][right]overlay=${width / 2}:0[back];` +
    `[back][front]overlay=(W-w)/2:0`;

  const filter =
    mode === 'crop'
      ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
      : mode === 'extend-edge'
        ? edgeExtend
        : blurExtend;

  await run('ffmpeg', [
    '-v', 'error', '-y',
    '-i', source,
    '-filter_complex', filter,
    '-frames:v', '1',
    out,
  ]);
  return out;
};

const validate = async (file) => {
  const problems = [];
  const ext = extname(file).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) problems.push(`extension ${ext} not accepted by MiniMax`);

  const { size } = await stat(file);
  if (size > MAX_BYTES) problems.push(`${(size / 1024 / 1024).toFixed(1)}MB exceeds the 30MB cap`);

  const { width, height } = await probe(file);
  for (const [name, value] of [['width', width], ['height', height]]) {
    if (value < MIN_SIDE) problems.push(`${name} ${value}px is below the ${MIN_SIDE}px minimum`);
    if (value > MAX_SIDE) problems.push(`${name} ${value}px is above the ${MAX_SIDE}px maximum`);
  }
  return { width, height, bytes: size, problems };
};

// ------------------------------------------------------------------------ main

await rm(refsDir, { recursive: true, force: true });
await mkdir(rawDir, { recursive: true });
await mkdir(framesDir, { recursive: true });
await mkdir(wideDir, { recursive: true });

const pieces = PIECES.filter((piece) => !only || only.includes(piece.key));
if (only) {
  const unknown = only.filter((key) => !PIECES.some((piece) => piece.key === key));
  if (unknown.length) {
    console.error(`Unknown --only keys: ${unknown.join(', ')}`);
    process.exit(1);
  }
}

console.log(`\n${c.bold}Preparing ${pieces.length} reference pieces${c.reset}`);
console.log(`${c.dim}${refsDir}${c.reset}\n`);

const manifest = [];
let failures = 0;

for (const piece of pieces) {
  console.log(`${c.cyan}${piece.key}${c.reset} ${c.dim}${piece.label}${c.reset}`);

  let nft;
  try {
    nft = await clientFor(piece.chain).nft.getNftMetadata(piece.address, piece.tokenId);
  } catch (error) {
    console.log(`  ${c.red}✗ metadata: ${error.message}${c.reset}\n`);
    failures += 1;
    continue;
  }

  const entry = {
    key: piece.key,
    label: piece.label,
    note: piece.note ?? null,
    onChainName: resolveNftName(nft),
    provenance: { chain: piece.chain, contract: piece.address, tokenId: piece.tokenId },
    sources: [],
    candidates: [],
  };

  // Always keep the best still we can get — it is either the reference itself or a
  // useful cross-check against the frames we sample.
  const stills = stillCandidates(nft);
  for (const candidateUrl of stills) {
    try {
      const { file, bytes, contentType, url } = await download(candidateUrl, `${piece.key}-still`);
      const { width, height } = await probe(file);
      entry.sources.push({ role: 'still', url, file, bytes, contentType, width, height });
      console.log(`  ${c.green}✓${c.reset} still  ${width}×${height} ${c.dim}${(bytes / 1024).toFixed(0)}KB${c.reset}`);
      break;
    } catch (error) {
      console.log(
        `  ${c.yellow}·${c.reset} still  ${c.dim}${candidateUrl.slice(0, 52)}… — ${error.message.slice(0, 80)}${c.reset}`,
      );
    }
  }

  const videoUrl = piece.source === 'frames' ? resolveNftVideo(nft) : null;
  const stillEntry = entry.sources.find((source) => source.role === 'still');

  // What do we sample frames from? The film if there is one, otherwise the still —
  // which for the Revuelto is an animated GIF and therefore has frames of its own.
  const frameSource =
    videoUrl != null
      ? await download(videoUrl, `${piece.key}-film`)
          .then((result) => {
            entry.sources.push({ role: 'film', url: videoUrl, ...result });
            console.log(`  ${c.green}✓${c.reset} film   ${c.dim}${(result.bytes / 1024 / 1024).toFixed(1)}MB${c.reset}`);
            return result.file;
          })
          .catch((error) => {
            console.log(`  ${c.yellow}·${c.reset} film   ${c.dim}${error.message}${c.reset}`);
            return stillEntry?.file ?? null;
          })
      : piece.source === 'frames'
        ? stillEntry?.file ?? null
        : null;

  if (frameSource) {
    const written = await sampleFrames(frameSource, piece.key, frameCount);
    for (const file of written) {
      const { width, height, bytes, problems } = await validate(file);
      entry.candidates.push({ file, width, height, bytes, problems });
      if (problems.length) failures += 1;
    }
    const bad = entry.candidates.filter((candidate) => candidate.problems.length).length;
    console.log(
      `  ${bad ? c.red + '✗' : c.green + '✓'}${c.reset} frames ${entry.candidates.length} sampled` +
        (bad ? ` ${c.red}(${bad} outside MiniMax limits)${c.reset}` : ''),
    );
  }

  // Composite artwork needs the subject cut out of it before it can act as a reference.
  for (const crop of piece.crops ?? []) {
    if (!stillEntry) break;
    try {
      const file = await cropTo(stillEntry.file, crop.name, crop);
      const { width, height, bytes, problems } = await validate(file);
      entry.candidates.push({ file, width, height, bytes, problems, crop: crop.rect });
      if (problems.length) failures += 1;
      console.log(
        `  ${problems.length ? c.red + '✗' : c.green + '✓'}${c.reset} crop   ` +
          `${crop.name} ${width}×${height}` +
          (problems.length ? ` ${c.red}${problems.join('; ')}${c.reset}` : ''),
      );
    } catch (error) {
      console.log(`  ${c.red}✗ crop   ${crop.name}: ${error.message}${c.reset}`);
      failures += 1;
    }
  }

  // A `still` piece uses its still directly, so that is the candidate to validate.
  if (piece.source === 'still' && stillEntry) {
    const { width, height, bytes, problems } = await validate(stillEntry.file);
    entry.candidates.push({ file: stillEntry.file, width, height, bytes, problems });
    if (problems.length) {
      failures += 1;
      for (const problem of problems) console.log(`  ${c.red}✗ ${problem}${c.reset}`);
    }
  }

  if (!entry.candidates.length) {
    console.log(`  ${c.red}✗ nothing usable resolved${c.reset}`);
    failures += 1;
  }

  manifest.push(entry);
  console.log('');
}

// ------------------------------------------------- widescreen composition for /v1 i2v
const wide = [];
if (!only) {
  console.log(`${c.bold}Composing 16:9 reference frames${c.reset}`);
  for (const target of WIDE_TARGETS) {
    const source = resolve(refsDir, target.from);
    try {
      const file = await composeWide(source, target.name, target.mode);
      const { width, height, bytes, problems } = await validate(file);
      // /v1 is stricter than /v2: under 20MB, short side over 300px, aspect between 2:5
      // and 5:2. A 1920×1080 PNG clears all three, but check rather than assume.
      if (bytes > 20 * 1024 * 1024) problems.push(`${(bytes / 1024 / 1024).toFixed(1)}MB exceeds the /v1 20MB cap`);
      if (Math.min(width, height) <= 300) problems.push(`short side ${Math.min(width, height)}px must exceed 300px for /v1`);
      wide.push({ name: target.name, from: target.from, mode: target.mode, file, width, height, bytes, problems });
      if (problems.length) failures += 1;
      console.log(
        `  ${problems.length ? c.red + '✗' : c.green + '✓'}${c.reset} ${pad(target.name, 12)} ` +
          `${width}×${height} ${c.dim}${target.mode}${c.reset}` +
          (problems.length ? ` ${c.red}${problems.join('; ')}${c.reset}` : ''),
      );
    } catch (error) {
      console.log(`  ${c.red}✗ ${pad(target.name, 12)} ${error.message.slice(0, 90)}${c.reset}`);
      failures += 1;
    }
  }
  console.log('');
}

await writeFile(
  resolve(refsDir, 'manifest.json'),
  `${JSON.stringify({ generatedFrom: 'src/data/brands.js', pieces: manifest, wide }, null, 2)}\n`,
);

const candidates = manifest.reduce((total, entry) => total + entry.candidates.length, 0);
console.log(
  `${c.bold}Done${c.reset}  ${candidates} candidate images · ` +
    (failures ? `${c.red}${failures} problems${c.reset}` : `${c.green}all within MiniMax limits${c.reset}`),
);
console.log(
  `\n${c.yellow}Next: open assets/refs/frames/ and pick the frames where the ape and the\n` +
    `jacket read clearly. Nothing should be rendered until that has been eyeballed.${c.reset}\n`,
);

if (failures) process.exit(1);
