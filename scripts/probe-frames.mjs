#!/usr/bin/env node
// Can we get frames out of an NFT's film, and are those frames legal H3 references?
//
// THE DECISION THIS BLOCKS. Today a moving piece is submitted to MiniMax as one still, and that
// still is frame 1 — worker/casting-director.js `castingStills` never looks at animation_url,
// worker/artwork.js refuses anything whose content-type is not image/*, and an animated GIF that
// gets past both is failed by the mime floor in worker/reference-preflight.js and falls through
// to Alchemy's static PNG re-encode. Sampling real frames into the dossier is the fix, and the
// whole design turns on WHO DECODES THE VIDEO. This probe answers that, and costs nothing.
//
// ⚠️ HALF THE ANSWER IS ALREADY RECORDED, and it is not encouraging. worker/frames.js does this
// for finished MiniMax clips and its header states: as of 2026-08-27 Media Transformations is NOT
// enabled on minds.monster — /cdn-cgi/trace returns 200, so the path routes, but /cdn-cgi/media/
// and /cdn-cgi/image/ both 404. That is a dashboard toggle, so it may have changed; stage 1
// re-checks rather than trusting a three-week-old note.
//
// THE QUESTION worker/frames.js NEVER HAD TO ASK is the one that actually decides this feature.
// It transforms OUR OWN clip, which the Worker just wrote to R2 on our own zone. An NFT's film is
// on an IPFS gateway, Arweave, or a brand CDN — a third-party origin. Media Transformations
// restricts which sources it will fetch, so "enabled on the zone" and "will transform an ipfs.io
// URL" are two different facts and only the second one ships this. Stage 1 separates them by
// reporting the raw status and body rather than a boolean: a 404 everywhere is the feature being
// off, and a 200 on same-origin with a 4xx on a remote source is the source restriction.
//
// STAGE 2 RUNS REGARDLESS, and is the reason this is worth running today even if stage 1 says no.
// It needs no Cloudflare feature and no credit: it walks real tokens, asks which ones even HAVE a
// film, and measures those films where they live — status, container, size, and whether the host
// honours a range request, which Media Transformations requires and IPFS gateways frequently do
// not. That survey is the coverage number for the whole feature, and it is the input to choosing
// the fallback (browser-side canvas sampling, or offline ffmpeg in scripts/prep-cast.mjs) if the
// edge path is unavailable.
//
// ⚠️ NEVER RUN STAGE 1 AGAINST localhost. Media Transformations is an EDGE feature; `wrangler
// dev` does not serve /cdn-cgi/media at all, so a local run reports "unavailable" for a zone
// where it is switched on. Same class of trap as `wrangler kv` defaulting to the local simulator.
//
//   node --env-file-if-exists=.env scripts/probe-frames.mjs
//   node --env-file-if-exists=.env scripts/probe-frames.mjs --only adidas,nike --limit 40
//   node --env-file-if-exists=.env scripts/probe-frames.mjs --token eth-mainnet:0x28472a...:1
//   node --env-file-if-exists=.env scripts/probe-frames.mjs --origin https://v2.minds.monster
//   node --env-file-if-exists=.env scripts/probe-frames.mjs --json > /tmp/frames.json
//
//   # SPENDS NVIDIA CREDIT — the production motion pass against named tokens, control included:
//   node --env-file-if-exists=.env scripts/probe-frames.mjs --watch chain:address:id,chain:address:id
//
// ── RESULTS — 2026-09-18, 129 tokens across 23 collections, --limit 6 ───────────────────────
//
// COVERAGE. 56 of 129 tokens carry a film or an animated still. Not a niche case: 43% of the
// registry moves, and it is concentrated in the luxury half.
//
// REACHABILITY, which is where this went somewhere nobody expected:
//
//   res.cloudinary.com (Alchemy)    9   206, honours ranges, 4.2-14.9MB, mp4
//   gateway.arweave.net             6   200, IGNORES ranges (sends the whole file)
//   i2c.seadn.io (OpenSea)          5   200, ignores ranges
//   raw2.seadn.io                   2   206, honours ranges, 1.7-8.4MB
//   nft.givenchy.com                1   206 — but the body is a 0.01MB HTML error page (see below)
//   ipfs.io / dweb.link / w3s.link 30   403 CLOUDFLARE BOT CHALLENGE
//   arianee.com (YSL)               3   fetch failed, times out
//
// 🔑 THE 403s ARE A BOT CHALLENGE, NOT AN UNPINNED CID, and this corrects worker/artwork.js's
// header, which states "ipfs.io now answers a blocked CID with an HTTP 403 carrying an HTML error
// page". The page is actually Cloudflare's managed challenge — `cf-mitigated: challenge`,
// `_cf_chl_opt`, `cType: 'managed'`, "Enable JavaScript and cookies to continue". The difference
// is the whole architecture:
//
//   an unpinned CID   → another gateway may have it. The existing fallback is the right fix.
//   a bot challenge   → NO server-side fetch passes it, ever, at any user-agent, from a Worker or
//                       from node. A real browser passes it by design. More gateways cannot help.
//
// And more gateways specifically did not: walking all three rescued ZERO of the 30. w3s.link now
// 301-redirects to dweb.link, so IPFS_GATEWAYS' claim that these are "three independent
// operators" is no longer true — it is two, both Protocol Labs, both behind the same challenge.
//
// WHY IMAGES SURVIVE THIS AND FILMS DO NOT — spot-checked on Nike #2, whose film is challenged:
//
//   image.pngUrl     200 image/png   res.cloudinary.com/alchemyapi/...   ← Alchemy's mirror
//   image.cachedUrl  200 image/png   nft2-cdn.alchemy.com/...            ← Alchemy's mirror
//   the film         403 challenged  ipfs.io/ipfs/Qm.../base.mp4         ← no mirror exists
//
// ALCHEMY MIRRORS STILLS AND DOES NOT MIRROR FILMS. That single asymmetry is why every image in
// this product resolves and why the video path has never had a chance, and it is not something
// any amount of Worker-side engineering can change.
//
// MEDIA TRANSFORMATIONS IS STILL OFF. /cdn-cgi/trace 200, /cdn-cgi/media/ 404 with the generic
// Cloudflare 404 page — worker/frames.js recorded the same on 2026-08-27 and it has not changed.
// Note that flipping the toggle would NOT rescue the 30 challenged films: Cloudflare's transform
// fetcher is still a server fetching a third-party URL, and it meets the same interstitial.
//
// A 206 THAT WAS A LIE. givenchy #0 returned HTTP 206 with a 0.01MB body whose first bytes are
// `3c21` — `<!`, an HTML error page. The status said success and only the container sniff caught
// it. Exactly the class of failure worker/artwork.js's content-type check exists for, on a path
// that did not have one.
//
// ── A PREDICTION THAT WAS WRONG, AND THE ANOMALY IT TURNED UP — production KV, 2026-09-18 ───
//
// The obvious inference from the challenge finding was that the Casting Director's motion pass
// (worker/casting-director.js step 3) must already be failing silently on every challenged film,
// leaving `watchedFilm: false`. Checked against the production DOSSIERS namespace
// (5c402c9b702f475aa88b09d99f2a07b6, --remote), 24 v5 dossiers over challenged and reachable
// collections. IT IS FALSE, and the check that falsified it is the one worth keeping:
//
//   watchedFilm: false   15 dossiers
//   of those, how many actually HAVE a film that resolveNftVideo finds?   ZERO.
//
// Every single one is a genuinely filmless token. `watchedFilm: false` means "no film" far more
// often than "the watch failed", and reading it as a failure rate would have manufactured a
// production bug that does not exist. The motion pass is not quietly broken.
//
// 🔑 THE ANOMALY IS THE REAL FINDING. Two dossiers — Gucci #10 and Rimowa #2 — record
// `watchedFilm: true` with specific, plainly genuine motion notes ("The suitcase rotates
// continuously on a circular platform"), and their films are on ipfs.io and return 403 to us NOW.
// Something watched those films. Two explanations, with opposite consequences:
//
//   (a) NVIDIA's fetcher PASSES the challenge where ours does not — different IP reputation. Then
//       a server-side path to the challenged 30 exists today and the browser is not required.
//   (b) The dossiers PREDATE the challenge. Dossiers are written without a TTL, so a record from
//       before ipfs.io turned this on would survive unchanged and look like present-day success.
//
// A dossier carries no timestamp, so the record cannot settle this. `--watch` can, and did:
//
// ── SETTLED: (a) IS FALSE — `--watch`, 2026-09-18 03:19 and 03:20 UTC ────────────────────────
//
//   Gucci #10    ipfs.io      us: 403 challenge   NVIDIA: ❌ ×2  "HTTP 429 for https://ipfs.io/…"
//   Rimowa #2    ipfs.io      us: 403 challenge   NVIDIA: ❌ ×2  "HTTP 429 for https://ipfs.io/…"
//   Mercedes #1  arweave      us: 200             NVIDIA: ✅     control
//   D&G #3       cloudinary   us: 206             NVIDIA: ✅     control (a first attempt got an
//                                                                NVIDIA-side 503 "ResourceExhausted
//                                                                16/16" — their capacity, not the film)
//
// Both controls watched, so the key, the model and the request are sound; the failures are about
// the films. NVIDIA does NOT get through — ipfs.io answers its fetcher with a 429 rather than the
// 403 challenge it gives us, which is a different refusal to a different client and the same
// outcome. The two dossiers therefore PREDATE the blocking: they were written while ipfs.io still
// served these files, and a TTL-less store kept the evidence of a world that no longer exists.
//
// One honest qualification: a 429 is a rate limit, and rate limits vary by moment and by client
// load, so "NVIDIA can never reach ipfs.io" is stronger than four failures prove. What they do
// prove is the thing that matters — a server-side fetch of these films is not a DEPENDABLE path,
// and a feature cannot be built on a gateway that works when it is not busy.
//
// And a lesson for anything that reads dossiers as evidence of the present: `watchedFilm: true`
// means the film was reachable ON THE DAY IT WAS CAST, not today. A dossier is a historical record.
//
// WHAT IS STILL UNMEASURED: stage 3 has never run, because stage 1 has never passed. Whether an
// extracted frame is a LEGAL H3 reference — aspect 0.4-2.5, short side >=256px — is therefore
// still an open question on real footage, and it is the one that decides whether sampled frames
// are usable at all rather than merely obtainable.

import { resolveNftVideo, toHttp } from '../src/lib/nftMedia.js';
import { withIpfsFallback } from '../worker/artwork.js';
import { castingStills, motionRequest } from '../worker/casting-director.js';
import { chat, jsonFrom } from '../worker/nvidia.js';
import { checkReference, measureImage } from '../worker/reference-preflight.js';
import { sampleTimes } from '../worker/frames.js';
import { BRANDS } from '../src/data/brands.js';

// Matches worker/artwork.js: IPFS gateways and some creator CDNs serve 403 or 0 bytes to a bare
// fetch user-agent, and a probe that gets a different answer from production is worse than none.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0';
const TIMEOUT_MS = 15_000;

const DEFAULT_ORIGIN = 'https://minds.monster';

// Where to sample when the film's duration is unknown — which is the normal case, because the
// duration lives in an mvhd box that is often at the END of the file. A timestamp past the end is
// expected to fail and that failure is itself a measurement, so the ladder is short and early.
// Pass --duration to derive proper evenly-spaced times through worker/frames.js `sampleTimes`
// instead, which is the sampler production would use.
const DEFAULT_TIMES = [0.3, 1, 2, 4];

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const has = (name) => args.includes(`--${name}`);

const ORIGIN = (flag('origin', DEFAULT_ORIGIN) ?? DEFAULT_ORIGIN).replace(/\/$/, '');
const LIMIT = Number(flag('limit', 20));
const AS_JSON = has('json');
const DURATION = flag('duration') ? Number(flag('duration')) : null;
const TIMES = flag('times')
  ? flag('times').split(',').map(Number)
  : DURATION
    ? sampleTimes(DURATION, 4)
    : DEFAULT_TIMES;

const out = [];
const say = (line = '') => {
  // --json puts the machine-readable record on stdout, so the human report goes to stderr and the
  // two can be piped apart. Without it stdout carries the report, as every other probe here does.
  if (AS_JSON) process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
  out.push(line);
};

const pad = (value, width) => String(value ?? '').padEnd(width).slice(0, width);
const mb = (bytes) => {
  if (bytes == null) return '?';
  if (typeof bytes === 'string' && !/^\d+$/.test(bytes)) return bytes;
  return `${(Number(bytes) / 1e6).toFixed(2)}MB`;
};

// ─────────────────────────────────────────────────────────────────── stage 1: the zone

const frameUrl = (sourceUrl, atSeconds) =>
  // The exact shape worker/frames.js:50 builds. Copied rather than imported because that one is
  // not exported, and because a probe that quietly diverges from production is a probe that
  // certifies something nobody ships.
  `${ORIGIN}/cdn-cgi/media/mode=frame,time=${atSeconds}s,format=jpeg,width=640/${sourceUrl}`;

/**
 * Three separate facts, reported separately, because collapsing them loses the finding:
 *   does /cdn-cgi route at all, is Media Transformations on, and will it fetch a remote source.
 */
const probeZone = async (remoteSample) => {
  const result = { origin: ORIGIN, trace: null, remote: null };

  if (/localhost|127\.0\.0\.1/.test(ORIGIN)) {
    say('⚠️  --origin is local. Media Transformations is an edge feature and `wrangler dev` does');
    say('    not serve /cdn-cgi/media — a result from here says nothing about the real zone.');
    say('');
  }

  try {
    const trace = await fetch(`${ORIGIN}/cdn-cgi/trace`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    result.trace = trace.status;
  } catch (error) {
    result.trace = `threw: ${error.message}`;
  }
  say(`  /cdn-cgi/trace            ${result.trace}   (200 = the /cdn-cgi path routes at all)`);

  if (!remoteSample) {
    say('  /cdn-cgi/media (remote)   skipped — stage 2 found no reachable film to transform');
    return result;
  }

  try {
    const response = await fetch(frameUrl(remoteSample, TIMES[0]), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim();
    const ok = response.ok && contentType.startsWith('image/');
    // The body of a refusal is where the distinction lives: "not enabled" and "that source is not
    // allowed" are both non-200 and they mean completely different things for this design.
    const body = ok ? null : (await response.text().catch(() => '')).slice(0, 200).replace(/\s+/g, ' ');
    result.remote = { status: response.status, contentType, ok, body, source: remoteSample };
    say(`  /cdn-cgi/media (remote)   ${response.status} ${contentType || '—'}${ok ? '  ✅' : ''}`);
    if (body) say(`      ↳ ${body}`);
  } catch (error) {
    result.remote = { status: `threw: ${error.message}`, ok: false, source: remoteSample };
    say(`  /cdn-cgi/media (remote)   threw: ${error.message}`);
  }

  return result;
};

// ───────────────────────────────────────────────────────── stage 2: the films themselves

/** Container from the first bytes, the same trick worker/reference-preflight.js uses on images. */
const sniffContainer = (bytes) => {
  if (!bytes || bytes.length < 12) return null;
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (ascii(4, 8) === 'ftyp') return `mp4/${ascii(8, 12).trim()}`;
  if (ascii(0, 3) === 'GIF') return `gif/${ascii(3, 6)}`;
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  // Two impostors that arrive with a 2xx and must never be counted as films: an HTML error page
  // (givenchy #0, HTTP 206), and Alchemy's partial-mirror stub — HTTP 206, body
  // `{"keyName":…,"partialUpload":true,"contentType":"video/mp4","bytes":41889416}` — which is
  // what nft2-cdn serves for a large film it never finished copying.
  if (bytes[0] === 0x7b) return 'json-stub';
  if (bytes[0] === 0x3c) return 'html';
  return `unknown/${[...bytes.subarray(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
};

/**
 * One film, measured where it actually lives.
 *
 * A RANGE REQUEST, not a HEAD, and not a full download. Two reasons, and the second is the one
 * that matters: HEAD is answered incorrectly by enough IPFS gateways to be useless, and Media
 * Transformations needs to seek — so whether the host returns 206 with a Content-Range is a
 * precondition for the edge path working at all, and it is exactly what a range request measures.
 */
const probeOne = async (url) => {
  const record = { url, status: null, contentType: null, bytes: null, ranges: null, container: null };
  try {
    const response = await fetch(url, {
      // Origin, because many CDNs only send Access-Control-Allow-Origin when asked for it.
      headers: { 'User-Agent': BROWSER_UA, Range: 'bytes=0-1023', Origin: DEFAULT_ORIGIN },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    record.status = response.status;
    record.contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim() || null;
    // 206 means the range was honoured. A 200 means the host ignored it and is sending the whole
    // file — survivable for us, fatal for a transform that has to seek into a large object.
    record.ranges = response.status === 206 ? '206' : `ignored (${response.status})`;
    // Whether a BROWSER could read this frame too (probe-frames.html's anonymous mode needs it).
    record.cors = response.headers.get('access-control-allow-origin');
    // ONLY FOR A SUCCESSFUL RESPONSE. A 403 from an IPFS gateway still has a body, a
    // content-length and a recognisable signature — all belonging to an HTML error page. Reporting
    // those in the size and container columns is the exact confusion worker/artwork.js's header was
    // written about: "the bytes of a 'Gateway blocked' page get base64'd and handed to a vision
    // model as artwork". A refusal measures nothing, and the table must say nothing.
    if (response.status === 200 || response.status === 206) {
      record.bytes =
        response.headers.get('content-range')?.split('/')?.[1] ?? response.headers.get('content-length') ?? null;
      const head = new Uint8Array((await response.arrayBuffer()).slice(0, 32));
      record.container = sniffContainer(head);
    } else {
      record.bytes = '—';
      record.container = '—';
      // ⚠️ A BOT CHALLENGE IS NOT A DEAD CID, and telling them apart is the finding this probe
      // exists for. Cloudflare's managed challenge answers 403 with a JS/cookie interstitial —
      // `cf-mitigated: challenge`, `_cf_chl_opt`, "Just a moment...". No server-side fetch passes
      // one, at any user-agent, from a Worker or from node; a real browser passes it by design.
      // "Unpinned" argues for another gateway. "Challenged" argues for a completely different
      // architecture, so a probe that collapses them into "403" sends you the wrong way.
      const body = (await response.text().catch(() => '')).slice(0, 4000);
      record.challenge =
        response.headers.get('cf-mitigated') === 'challenge' ||
        /_cf_chl_opt|Just a moment|cf-browser-verification/.test(body);
      if (record.challenge) record.container = 'cf-challenge';
    }
  } catch (error) {
    record.status = `threw: ${error.message}`;
  }
  return record;
};

/**
 * Every URL a token's film might be served from, best first.
 *
 * ⚠️ THE CANDIDATE LIST IS THE WHOLE COVERAGE NUMBER, and this probe got it wrong twice.
 *
 * First it probed only what src/lib/nftMedia.js `resolveNftVideo` returns — the metadata's own
 * animation_url, which for 30 films is a bare ipfs.io URL behind a bot challenge. Walking the
 * IPFS_GATEWAYS fallback rescued none of them. That looked like "30 films are unreachable".
 *
 * They are not. Alchemy's v3 response carries an `animation` object —
 * `{ cachedUrl, contentType, size, originalUrl }` — exactly parallel to `image`, and NOTHING in
 * this codebase reads it: resolveNftVideo looks at raw metadata and a v2-era `animationUrl`.
 * Checked on Gucci #10 and Nike #2, both challenged on ipfs.io:
 *
 *   animation.cachedUrl    nft2-cdn.alchemy.com/…_animation   206, real video bytes, seekable
 *   animation.originalUrl  gateway.pinata.cloud/ipfs/…         206, real video bytes, CORS *
 *
 * So "Alchemy mirrors stills and not films" was wrong. It mirrors films too; we never asked.
 */
const filmCandidates = (nft, fallback) =>
  [nft?.animation?.cachedUrl, nft?.animation?.originalUrl, fallback]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => toHttp(value.trim()))
    .flatMap(withIpfsFallback)
    .filter((value, index, all) => all.indexOf(value) === index);

/** A response is a film when its BYTES are one. The status code has lied twice in this probe. */
const isFilm = (record) =>
  (record.status === 200 || record.status === 206) && /^(mp4|webm|gif)/.test(record.container ?? '');

/** `host:206/json-stub` — the status AND what it turned out to be, since those disagree. */
const describeAttempt = (a) =>
  `${new URL(a.url).host}:${a.status}${a.container && !/^(mp4|webm|gif)/.test(a.container) ? `/${a.container}` : ''}`;

/** The first candidate that answers with a film. Records every attempt, and which one won. */
const probeFilm = async (candidates) => {
  const attempts = [];
  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop -- one gateway at a time, as worker/artwork.js does.
    const record = await probeOne(candidate);
    attempts.push(record);
    if (isFilm(record)) {
      return { ...record, gateways: attempts.length, tried: attempts.map(describeAttempt) };
    }
  }
  const last = attempts[attempts.length - 1];
  return { ...last, gateways: attempts.length, tried: attempts.map(describeAttempt) };
};

// ────────────────────────────────────────────── stage 3: are the frames legal references?

/**
 * A sampled frame, measured against H3's floors BEFORE anything is designed around it.
 *
 * This is the half of the question that a working transform does not answer. A frame can extract
 * perfectly and still be unusable: worker/reference-preflight.js's aspect window is 0.4-2.5 and
 * its short side floor is 256px, and a 1080x1920 vertical film frame or a 640-wide transform of a
 * square token sit on opposite sides of those. Better to learn it here than one billed task later.
 */
const probeFrames = async (key, sourceUrl) => {
  const frames = [];
  for (const atSeconds of TIMES) {
    try {
      // eslint-disable-next-line no-await-in-loop -- serial on purpose, as worker/frames.js is:
      // parallel transforms against one cold third-party object measures the gateway, not us.
      const response = await fetch(frameUrl(sourceUrl, atSeconds), { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) {
        frames.push({ atSeconds, ok: false, why: `HTTP ${response.status}` });
        continue;
      }
      const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim();
      const bytes = new Uint8Array(await response.arrayBuffer());
      const measured = measureImage(bytes);
      const check = checkReference({ key: `${key}@${atSeconds}s`, mime, bytes });
      const floor = check.violations.filter((violation) => violation.severity === 'floor');
      frames.push({
        atSeconds,
        ok: true,
        mime,
        size: bytes.length,
        width: measured?.width ?? null,
        height: measured?.height ?? null,
        legal: floor.length === 0,
        violations: floor.map((violation) => violation.detail),
        crop: check.crop,
      });
    } catch (error) {
      frames.push({ atSeconds, ok: false, why: `threw: ${error.message}` });
    }
  }
  return frames;
};

// ──────────────────────────────────────────────────────────────────────── token gathering

const alchemyKey = () => {
  const key = process.env.VITE_ALCHEMY_API_KEY;
  if (!key) throw new Error('VITE_ALCHEMY_API_KEY is not set (it lives in .env)');
  return key;
};

const collectionsToProbe = () => {
  const only = flag('only');
  const slugs = only ? only.split(',').map((slug) => slug.trim()) : null;
  return BRANDS.filter((brand) => !slugs || slugs.includes(brand.slug)).flatMap((brand) =>
    (brand.collections ?? []).map((collection) => ({ ...collection, brand: brand.slug })),
  );
};

/** A page of a contract's tokens, in the v3 shape src/lib/nftMedia.js's resolvers expect. */
const tokensOf = async ({ chain, address, brand, name }) => {
  const url =
    `https://${chain}.g.alchemy.com/nft/v3/${alchemyKey()}/getNFTsForContract` +
    `?contractAddress=${address}&withMetadata=true&limit=${LIMIT}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) {
      say(`  ${pad(brand, 16)} ${name}: Alchemy ${response.status}`);
      return [];
    }
    const json = await response.json();
    return (json.nfts ?? []).map((nft) => ({ nft, brand, chain, address }));
  } catch (error) {
    say(`  ${pad(brand, 16)} ${name}: ${error.message}`);
    return [];
  }
};

const explicitToken = async (spec) => {
  const [chain, address, tokenId] = spec.split(':');
  const url =
    `https://${chain}.g.alchemy.com/nft/v3/${alchemyKey()}/getNFTMetadata` +
    `?contractAddress=${address}&tokenId=${tokenId}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Alchemy ${response.status} for ${spec}`);
  return [{ nft: await response.json(), brand: 'explicit', chain, address }];
};

// ─────────────────────────────────────────── --watch: can NVIDIA reach what we cannot?

/**
 * The production motion pass, run today, against named tokens.
 *
 * Exists to settle one anomaly (see RESULTS): dossiers that record a watched film whose URL now
 * 403s to us. Either NVIDIA's fetcher passes the challenge, or those dossiers predate it. The
 * request is worker/casting-director.js's own `motionRequest`, imported rather than copied.
 *
 * ⚠️ PASS A CONTROL. Include at least one token whose film is known to be reachable. If the
 * control fails too, NVIDIA or the key is down and the run says nothing about the challenge —
 * which is otherwise indistinguishable from "NVIDIA was blocked".
 *
 * Spends NVIDIA credit (one call per token), which is why it is opt-in and never part of a sweep.
 */
const runWatch = async (specs) => {
  const env = {
    NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
    // Defaults are wrangler.jsonc's production vars; override from the environment to test another.
    NVIDIA_BASE_URL: process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
    CASTING_MODEL: process.env.CASTING_MODEL ?? 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  };
  if (!env.NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY is not set (it lives in .env)');

  say('');
  say(`━━ WATCH: the production motion pass, run ${new Date().toISOString()} ━━━━━━━━━━━━━━━━━━━━━`);
  say(`  model ${env.CASTING_MODEL}`);
  say('');

  const results = [];
  for (const spec of specs) {
    // eslint-disable-next-line no-await-in-loop -- one paid call at a time, and readable output.
    const [{ nft }] = await explicitToken(spec);
    const film = resolveNftVideo(nft);
    if (!film) {
      say(`  ${spec}\n    no film — nothing to watch`);
      results.push({ spec, film: null });
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const ours = await probeOne(film);
    const started = Date.now();
    let outcome;
    try {
      // retries: 1 — a transport retry is fine, but five of them against a film NVIDIA cannot
      // fetch just buys the same refusal five times.
      // eslint-disable-next-line no-await-in-loop
      const motion = jsonFrom(await chat(env, { ...motionRequest(env, film), retries: 1 }));
      outcome = { watched: Boolean(motion?.motionNotes), notes: motion?.motionNotes ?? null };
    } catch (error) {
      outcome = { watched: false, error: error.message.slice(0, 300) };
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    say(`  ${spec}`);
    say(`    film     ${film.slice(0, 90)}`);
    say(`    us       ${ours.status}${ours.challenge ? '  (Cloudflare challenge)' : ''}`);
    say(`    NVIDIA   ${outcome.watched ? '✅ watched' : '❌ could not watch'}  (${seconds}s)`);
    if (outcome.notes) say(`    notes    ${outcome.notes}`);
    if (outcome.error) say(`    error    ${outcome.error}`);
    say('');
    results.push({ spec, film, ours: { status: ours.status, challenge: Boolean(ours.challenge) }, ...outcome, seconds });
  }

  if (AS_JSON) process.stdout.write(`${JSON.stringify({ watchedAt: new Date().toISOString(), results }, null, 2)}\n`);
};

// ─────────────────────────────────────────────────────────────────────────────────── run

const main = async () => {
  if (flag('watch')) {
    await runWatch(flag('watch').split(',').map((spec) => spec.trim()));
    return;
  }

  const token = flag('token');

  say('');
  say('━━ STAGE 2: which pieces have a film, and where does it live ━━━━━━━━━━━━━━━━━━━━━━━━');
  say('');

  const entries = token
    ? await explicitToken(token)
    : (await Promise.all(collectionsToProbe().map(tokensOf))).flat();

  if (!entries.length) {
    say('No tokens resolved. Check VITE_ALCHEMY_API_KEY, or pass --token chain:address:id.');
    process.exit(1);
  }

  const moving = [];
  const stills = [];
  for (const entry of entries) {
    // A film Alchemy knows about counts even where resolveNftVideo finds nothing.
    const film = resolveNftVideo(entry.nft) ?? entry.nft?.animation?.cachedUrl ?? null;
    // An "image" that is really an mp4 counts as moving too — adidas Phase 1 does exactly this,
    // and resolveNftVideo already folds that case in (src/lib/nftMedia.js).
    const animatedStill = castingStills(entry.nft).find((url) => /\.gif(\?|#|$)/i.test(url));
    if (film || animatedStill) moving.push({ ...entry, film: film ?? toHttp(animatedStill) });
    else stills.push(entry);
  }

  say(`  ${entries.length} tokens across ${token ? 1 : collectionsToProbe().length} collections`);
  say(`  ${moving.length} carry a film or an animated still  ·  ${stills.length} are stills only`);
  say('');
  say(`  ${pad('brand', 14)}${pad('token', 10)}${pad('status', 10)}${pad('ranges', 16)}${pad('size', 10)}${pad('container', 12)}`);
  say(`  ${'─'.repeat(72)}`);

  const films = [];
  for (const entry of moving) {
    // eslint-disable-next-line no-await-in-loop -- sequential against third-party media hosts,
    // matching worker/reference-legal.js's candidate walk.
    const measured = await probeFilm(filmCandidates(entry.nft, entry.film));
    films.push({ ...measured, brand: entry.brand, tokenId: entry.nft?.tokenId });
    say(
      `  ${pad(entry.brand, 14)}${pad(`#${entry.nft?.tokenId}`, 10)}${pad(measured.status, 10)}` +
        `${pad(measured.ranges, 16)}${pad(mb(measured.bytes), 10)}${pad(measured.container, 12)}`,
    );
  }

  const reachable = films.filter(isFilm);
  const seekable = reachable.filter((film) => film.ranges === '206');
  const gifs = films.filter((film) => film.container?.startsWith('gif'));
  const challenged = films.filter((film) => film.challenge);

  say('');
  say(`  reachable ${reachable.length}/${films.length}   ·   honour range requests ${seekable.length}/${films.length}   ·   GIF rather than video ${gifs.length}`);
  if (gifs.length) {
    say('  ⚠️  GIFs need a different mechanism regardless: Media Transformations is video-only.');
  }
  if (challenged.length) {
    say('');
    say(`  ⚠️  ${challenged.length}/${films.length} films sit behind a Cloudflare BOT CHALLENGE, not a dead CID.`);
    say('      No server-side fetch passes one — not this probe, not a Worker, not Media');
    say('      Transformations’ own fetcher, at any user-agent. A real browser passes it by design.');
    say('      Adding gateways cannot fix these; only something running in a browser can reach them.');
  }

  say('');
  say('━━ STAGE 1: is frame extraction available on this zone, for a REMOTE source ━━━━━━━━━');
  say('');

  const sample = seekable[0] ?? reachable[0] ?? null;
  const zone = await probeZone(sample?.url ?? null);

  let sampled = [];
  if (zone.remote?.ok) {
    say('');
    say('━━ STAGE 3: are the extracted frames legal H3 references ━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    say('');
    for (const film of reachable.slice(0, 3)) {
      const key = `${film.brand}#${film.tokenId}`;
      // eslint-disable-next-line no-await-in-loop -- see probeFrames.
      const frames = await probeFrames(key, film.url);
      sampled.push({ key, frames });
      for (const frame of frames) {
        if (!frame.ok) {
          say(`  ${pad(key, 22)}${pad(`${frame.atSeconds}s`, 8)}${frame.why}`);
          continue;
        }
        const verdict = frame.legal ? '✅ legal' : `❌ ${frame.violations.join('; ')}`;
        say(`  ${pad(key, 22)}${pad(`${frame.atSeconds}s`, 8)}${pad(`${frame.width}x${frame.height}`, 12)}${pad(mb(frame.size), 10)}${verdict}`);
      }
    }
  }

  say('');
  say('━━ WHAT THIS DECIDES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  say('');
  if (zone.remote?.ok) {
    const legal = sampled.flatMap((entry) => entry.frames).filter((frame) => frame.legal).length;
    say(`  The edge path WORKS on a remote source. ${legal} sampled frames passed H3's floors.`);
    say('  → Sampling belongs in worker/casting-director.js step 3, beside the motion pass.');
  } else if (!zone.remote) {
    // NOT TESTED IS NOT FAILED. Stage 1 needs a reachable film to transform; with none, the
    // transform was never exercised and saying otherwise would invent a result.
    say('  The transform was NEVER TESTED — stage 2 found no reachable film to hand it. Nothing');
    say('  here is evidence about Media Transformations either way. Re-run over a wider set, or');
    say('  against a collection whose films are not behind a challenge.');
  } else if (zone.trace === 200) {
    say('  /cdn-cgi routes but the transform did not return an image. Read the body above: an');
    say('  HTTP 404 across the board is the per-zone toggle still being off (as worker/frames.js');
    say('  recorded on 2026-08-27); a 4xx naming the source is the remote-origin restriction, and');
    say('  those need different fixes — a dashboard toggle versus proxying the film through R2.');
  } else {
    say('  The zone did not answer. Nothing is decided; re-run against a real origin.');
  }
  if (!seekable.length && films.length) {
    say('');
    say('  ⚠️  No host honoured a range request. Media Transformations has to seek, so even with');
    say('      the toggle on, these films likely need proxying through R2 first — which makes the');
    say('      browser-sampling and offline-ffmpeg fallbacks more attractive, not less.');
  }
  say('');

  if (AS_JSON) {
    process.stdout.write(
      `${JSON.stringify({ probedAt: new Date().toISOString(), origin: ORIGIN, times: TIMES, zone, films, sampled }, null, 2)}\n`,
    );
  }
};

main().catch((error) => {
  console.error(`\nprobe-frames failed: ${error.message}`);
  process.exit(1);
});
