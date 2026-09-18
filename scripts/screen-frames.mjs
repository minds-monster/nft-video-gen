#!/usr/bin/env node
// Screen test: does H3 render a moving NFT better from its OWN FILM'S FRAMES than from its still?
//
// Everything the frame-sampling feature would build depends on this answer, and nothing measured
// so far gives it. scripts/probe-frames.mjs proved the films are REACHABLE (51 of 61, mostly via
// Alchemy's animation mirror) and probe-frames.html proved frames are EXTRACTABLE and legal H3
// references. Neither says whether H3 does anything useful with them. In particular: H3 reads each
// reference as an identity cue, not a moment in time, so three frames of one character may come
// back as one character in the round — or as three characters. Only a render says which.
//
// THREE ARMS, SAME SHOT, SAME PROMPT BEATS. Only the references differ:
//
//   A  the still        exactly what the Director submits today (castingStills → first legal)
//   B  one frame        isolates "a frame beats the still" — e.g. a character where the still
//                       is a trading card (the ape case in scripts/probe-mesh.mjs)
//   C  several frames   isolates "several frames beat one" — the actual feature
//
// Without B, a win for C could be the frame beating the card rather than the extra views helping,
// and the feature would be built on the wrong reason.
//
// The one unavoidable prompt difference is the binding line: C binds <Subject 1> to several
// pictures, worded the way worker/rulebook.js's Screenwriter would. The beats are identical.
//
// FRAMES OF THE ARTIST'S OWN FILM ARE ORIGINAL ARTWORK, not generated frames, so H3_RULES rule 3
// ("only original artwork as a reference") permits them — the same distinction
// scripts/probe-mesh.mjs draws: "Real footage is evidence; generated footage is inference."
//
//   # 1. free — fetch the film, extract frames at EXPLICIT timestamps, open the picker page
//   node --env-file=.env scripts/screen-frames.mjs extract
//   node --env-file=.env scripts/screen-frames.mjs extract --token eth-mainnet:0x…:1 --count 8
//
//   # 2. SPENDS — prints the plan and the price, and does nothing without --yes
//   node --env-file=.env scripts/screen-frames.mjs render --run assets/screen-tests/<run> --single 3 --multi 1,3,6
//   node --env-file=.env scripts/screen-frames.mjs render --run … --single 3 --multi 1,3,6 --yes
//
// ── RESULT 1 — SUPERGUCCI BLOSSOM #11, 2026-09-18, $1.44, --single 1 --multi 1,3,5 ──────────────
//
//   A the still        on-model; skipped the turn entirely (started facing camera); cap logo lost
//   B frame 1          on-model; did the turn, side and back invented from a front view — and
//                      convincing; cap logo clear
//   C frames 1,3,5     on-model; did the turn from a straight back view that matches the film's
//                      real back (frame 5) closely. ONE character throughout — no clones, no blend.
//
// WHAT IT SETTLES: the pipeline works end to end (the film's own frames → H3 → a coherent shot),
// and the worst risk — several frames read as several characters — did not happen.
//
// WHAT IT DOES NOT: that several frames are BETTER. A and B had near-identical references (the
// still and frame 1 are the same front view) and still differed in sky, in whether the turn
// happened, and in the cap logo — so run-to-run noise is at least that large, and C's edge is
// inside it. And this piece is a poor discriminator: a symmetric white toy with an all-over print
// has a back anyone could guess from its front, so B's invented back passes. The test that could
// show a benefit needs a subject whose back or side CANNOT be guessed — a print, pack, tail or
// hair only visible from behind — and two runs per arm to measure the noise.
//
// ── RESULT 2 — Idle Hands #4: Confident, 2026-09-18, $2.40, --plan screen-plans/idle-hands-arc.json
//
// A different KIND of film: not one subject seen from angles but one subject passing through
// STATES — a hand standing like a figure, breaking free into multiplied/fused/stretched fingers,
// returning to a curled rest. 10s, 1:1, the film's own studio setting, bindings saying MOMENTS IN
// ORDER. A large effect this time, and each arm showed exactly the states its references held:
//
//   A the still        right start; then a GENERIC symmetrical palm-fan of fingers that is nowhere
//                      in the artwork, held almost static for ~4s; ends in a plain FIST — wrong.
//   B 3 frames         right start, right middle (the starburst), right end (the curled crouch).
//                      The story's shape is correct; its middle is a single state.
//   C 9 frames         the whole vocabulary IN THE ORDER GIVEN — fan, starburst, fused mass, and
//                      the long angular stretched fingers of frames 10-11, near frame-accurate,
//                      which no words described. Ends on the curled crouch. One flaw: frame 8 is a
//                      close-up, and C jumps into a close-up there — a reference's FRAMING leaks.
//
// WHAT IT SETTLES, for the product feature:
//   · A still cannot carry states it does not show; prose invents a generic stand-in. For a
//     transformation piece, frames are not an upgrade — they are the only way to render it.
//   · H3 followed the ORDER of references when told they were moments in sequence.
//   · How many frames depends on the KIND of film: a turntable needs a few angles (result 1,
//     where 3 vs 1 was inside the noise); a transformation needs one per distinct state (here 9
//     visibly beat 3). The dossier should classify the film — turntable / transformation / reel
//     of different subjects / camera move — and the frame count and binding wording follow.
//   · Frame choice matters: prefer frames with the subject fully in view, or accept the jump.
//
// WHAT IT DOES NOT: whether nine references LOCK the setting. The beats deliberately kept the
// film's own studio floor, to isolate the transformation. A visitor's film puts the subject
// somewhere new; whether H3 lets nine studio-floor frames go to a rooftop is the next question.
//
// Re-running `render` on the same run RESUMES rather than resubmitting: an arm with a task id and
// no mp4 is polled, never paid for twice — "a task id we did not write down is money nobody can
// collect" (worker/director-job.js).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, join, relative } from 'node:path';

import { resolveNftName, resolveNftVideoCandidates } from '../src/lib/nftMedia.js';
import { withIpfsFallback } from '../worker/artwork.js';
import { castingStills } from '../worker/casting-director.js';
import { fetchLegalReference } from '../worker/reference-legal.js';
import { checkReference, decodeDataUri } from '../worker/reference-preflight.js';
import { sampleTimes } from '../worker/frames.js';
import { H3_REFERENCE_LIMITS, awaitVideo, createH3Task, h3Content, priceUsd } from './minimax.mjs';

const run = promisify(execFile);

// SUPERGUCCI BLOSSOM #11 — one ceramic figure on a true 360° turntable (front, three-quarter,
// side, back, round again in 6s), the same subject in every frame. Its metadata film is a
// challenged ipfs.io URL; Alchemy's animation mirror serves it (23.5MB QuickTime).
//
// ⚠️ NOT THE ADIDAS PIECE, which was the first choice and is the more instructive failure. Its
// dossier says "the character rotates 360 degrees on a platform", but eight frames at explicit
// timestamps show a PROMO REEL: four different characters in turn — two different apes, a woman,
// a crystal figure — each in its own card, looping back to the first. Arm C would have handed H3
// four characters labelled "views of ONE character". Two lessons for the product feature:
//   · a dossier's motionNotes cannot be trusted to mean "one subject"; the model watched it and
//     missed that the subject changes. Only looking at sampled frames catches it.
//   · a film can contain OTHER pieces' characters — here, another holder's avatar. Frames used
//     unchecked could put someone else's NFT into a visitor's film. The Casting Director must
//     verify every kept frame shows the same subject as the still.
const DEFAULT_TOKEN = 'eth-mainnet:0x78d61c684a992b0289bbfe58aaa2659f667907f8:10';
const OUT = 'assets/screen-tests';

const CONFIG = { model: 'MiniMax-H3', resolution: '768P', ratio: '16:9' };

// No brand names (H3_RULES rule 1 — error 1026). Generic enough for any character piece, and it
// asks for a TURN, because a turn is where one-view and many-view references should differ most.
const BEATS =
  '<Subject 1> stands alone on a rain-wet rooftop at dusk, city lights glowing far below. ' +
  '<Subject 1> slowly turns to face the camera, then takes one step forward. The camera pushes ' +
  'in slowly from a full shot to a medium close-up. Keep <Subject 1>’s face, body, clothing ' +
  'and colours exactly as in the reference. No text, no logos, no border or frame around ' +
  '<Subject 1>.';

const bindOne = () => '<Subject 1> is the character in <Picture 1>.';
const bindMany = (count) => {
  const pictures = Array.from({ length: count }, (_, i) => `<Picture ${i + 1}>`);
  const listed = `${pictures.slice(0, -1).join(', ')} and ${pictures.at(-1)}`;
  return `<Subject 1> is the character in ${listed}. These are views of ONE character from different angles, not different characters.`;
};

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0';
const MAX_FILM_BYTES = 150 * 1024 * 1024;

const args = process.argv.slice(2);
const command = args[0];
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const has = (name) => args.includes(`--${name}`);

const IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const openFile = async (path) => {
  if (process.platform !== 'darwin') return;
  await run('open', [path]).catch(() => {});
};

// ───────────────────────────────────────────────────────────────────────── the film

/** Every URL the film might be served from — the product's own list, walked across IPFS gateways. */
const filmCandidates = (nft) => resolveNftVideoCandidates(nft).flatMap(withIpfsFallback);

/** A film is a film because of its BYTES. The status code lied three different ways in the probe. */
const filmKind = (bytes) => {
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length > 12 && ascii(4, 8) === 'ftyp') return ascii(8, 10) === 'qt' ? '.mov' : '.mp4';
  if (bytes.length > 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return '.webm';
  if (bytes.length > 6 && ascii(0, 3) === 'GIF') return '.gif';
  return null;
};

const downloadFilm = async (candidates) => {
  const tried = [];
  for (const url of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop -- one host at a time, as worker/artwork.js does.
      const response = await fetch(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(120_000) });
      if (!response.ok) {
        tried.push(`${new URL(url).host}: HTTP ${response.status}`);
        continue;
      }
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > MAX_FILM_BYTES) {
        tried.push(`${new URL(url).host}: ${(declared / 1e6).toFixed(0)}MB, over the cap`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const bytes = new Uint8Array(await response.arrayBuffer());
      const ext = filmKind(bytes);
      if (!ext) {
        // Alchemy's partial-mirror stub lands here: HTTP 206, a JSON body, no film.
        tried.push(`${new URL(url).host}: ${response.status} but not a film (${bytes.length} bytes)`);
        continue;
      }
      return { url, bytes, ext, tried };
    } catch (error) {
      tried.push(`${new URL(url).host}: ${error.message}`);
    }
  }
  throw new Error(`No candidate served a film:\n  ${tried.join('\n  ')}`);
};

// ─────────────────────────────────────────────────────────────────────────── extract

const alchemyMetadata = async (spec) => {
  const key = process.env.VITE_ALCHEMY_API_KEY;
  if (!key) throw new Error('VITE_ALCHEMY_API_KEY is not set (it lives in .env)');
  const [chain, address, tokenId] = spec.split(':');
  const response = await fetch(
    `https://${chain}.g.alchemy.com/nft/v3/${key}/getNFTMetadata?contractAddress=${address}&tokenId=${tokenId}`,
  );
  if (!response.ok) throw new Error(`Alchemy ${response.status} for ${spec}`);
  return response.json();
};

const runDirFor = (spec) => {
  const [chain, address, tokenId] = spec.split(':');
  return join(OUT, `${chain}-${address.slice(0, 10)}-${String(tokenId).slice(0, 16)}`);
};

async function extract() {
  const spec = flag('token', DEFAULT_TOKEN);
  const count = Number(flag('count', 8));
  const dir = runDirFor(spec);
  await mkdir(join(dir, 'frames'), { recursive: true });

  console.log(`\n${spec}`);
  const nft = await alchemyMetadata(spec);
  const name = resolveNftName(nft);
  console.log(`  ${name}`);

  // The still, chosen EXACTLY as worker/director-job.js resolveReferences chooses it today, so arm
  // A is the real baseline and not a better one than production would send.
  const still = await fetchLegalReference(castingStills(nft), { key: spec });
  const decoded = decodeDataUri(still.dataUri);
  const stillFile = join(dir, `still${IMAGE_EXT[decoded.mime] ?? '.png'}`);
  await writeFile(stillFile, decoded.bytes);
  console.log(`  still  ${still.measured?.width}x${still.measured?.height}  ← ${still.url.slice(0, 70)}`);

  const film = await downloadFilm(filmCandidates(nft));
  const filmFile = join(dir, `film${film.ext}`);
  await writeFile(filmFile, film.bytes);
  console.log(`  film   ${(film.bytes.length / 1e6).toFixed(1)}MB ${film.ext}  ← ${film.url.slice(0, 70)}`);
  for (const line of film.tried) console.log(`         skipped ${line}`);

  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filmFile]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`ffprobe could not read a duration from ${filmFile}`);

  // ⚠️ EXPLICIT TIMESTAMPS, one ffmpeg call each — never a select= filter. worker/frames.js's header
  // records a contact-sheet sampler whose interval grew with t and crushed every sample into the
  // first second, and a post-mortem built on it that "INVERTS the conclusion". sampleTimes is the
  // same sampler production uses.
  const frames = [];
  for (const [index, atSeconds] of sampleTimes(duration, count).entries()) {
    const n = index + 1;
    const file = join(dir, 'frames', `frame-${String(n).padStart(2, '0')}.png`);
    // eslint-disable-next-line no-await-in-loop
    await run('ffmpeg', ['-v', 'error', '-ss', String(atSeconds), '-i', filmFile, '-frames:v', '1', '-y', file]);
    // eslint-disable-next-line no-await-in-loop
    const bytes = new Uint8Array(await readFile(file));
    const check = checkReference({ key: `frame ${n}`, mime: 'image/png', bytes });
    const floor = check.violations.filter((v) => v.severity === 'floor');
    frames.push({
      n,
      atSeconds,
      file: relative(dir, file),
      width: check.measured?.width ?? null,
      height: check.measured?.height ?? null,
      legal: floor.length === 0,
      violations: floor.map((v) => v.detail),
    });
    console.log(`  frame ${String(n).padStart(2)}  ${String(atSeconds).padStart(6)}s  ${check.measured?.width}x${check.measured?.height}  ${floor.length ? '❌ ' + floor[0].detail : '✅'}`);
  }

  const manifest = {
    token: spec,
    name,
    extractedAt: new Date().toISOString(),
    still: { file: relative(dir, stillFile), url: still.url, width: still.measured?.width ?? null, height: still.measured?.height ?? null },
    film: { file: relative(dir, filmFile), url: film.url, bytes: film.bytes.length, duration },
    frames,
    arms: {},
  };
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const page = join(dir, 'pick.html');
  await writeFile(page, pickPage(dir, manifest));

  console.log(`\n  → ${page}`);
  console.log('    Pick the frames there; it writes the render command for you.\n');
  await openFile(page);
}

// ──────────────────────────────────────────────────────────────────────────── render

/** The original three arms: the still, one frame, several frames as ANGLES of one subject. */
const armsFromFlags = (manifest, frameFile) => {
  const single = Number(flag('single'));
  const multi = (flag('multi') ?? '').split(',').filter(Boolean).map(Number);
  if (!single || multi.length < 2) throw new Error('Pass --single N and --multi a,b[,c…] (two or more frames), or --plan file.json.');
  const config = { ...CONFIG, duration: Number(flag('duration', 6)) };
  const arms = [
    { id: 'A', title: 'Today — the still', refs: [manifest.still.file], binding: bindOne() },
    { id: 'B', title: `One film frame (#${single})`, refs: [frameFile(single)], binding: bindOne() },
    { id: 'C', title: `${multi.length} film frames (#${multi.join(', #')})`, refs: multi.map(frameFile), binding: bindMany(multi.length) },
  ].map((arm) => ({ ...arm, text: `${arm.binding}\n\n${BEATS}` }));
  return { arms, config };
};

/**
 * Arms, prompt and shape from a JSON plan — for pieces the three standard arms do not fit.
 *
 * The standard arms assume a CHARACTER seen from several ANGLES. An experimental film may be one
 * subject passing through STATES — and "these are views of one character from different angles"
 * is then the wrong instruction. A plan says what the pictures are, per arm, in its own words:
 *
 *   { "duration": 10, "ratio": "1:1", "beats": "…<Subject 1>…",
 *     "arms": [ { "id": "A", "title": "…", "refs": ["still"], "binding": "<Subject 1> is …" },
 *               { "id": "B", "title": "…", "refs": [2, 6, 14], "binding": "…" } ] }
 *
 * `refs` entries are frame numbers from this run, or "still". The plan file is the record of what
 * was tested — keep it beside the run.
 */
const armsFromPlan = async (path, manifest, frameFile) => {
  const plan = JSON.parse(await readFile(path, 'utf8'));
  if (!plan.beats || !Array.isArray(plan.arms) || !plan.arms.length) throw new Error(`${path} needs "beats" and a non-empty "arms".`);
  const config = { ...CONFIG, duration: plan.duration ?? 6, ratio: plan.ratio ?? CONFIG.ratio };
  const arms = plan.arms.map((arm) => {
    if (!arm.id || !arm.binding || !Array.isArray(arm.refs)) throw new Error(`${path}: every arm needs id, binding and refs.`);
    const refs = arm.refs.map((ref) => (ref === 'still' ? manifest.still.file : frameFile(Number(ref))));
    return { id: arm.id, title: arm.title ?? arm.id, refs, binding: arm.binding, text: `${arm.binding}\n\n${plan.beats}` };
  });
  return { arms, config };
};

const readManifest = async (dir) => JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
const saveManifest = (dir, manifest) => writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

async function render() {
  const dir = flag('run');
  if (!dir || !existsSync(join(dir, 'manifest.json'))) throw new Error('--run must name a folder `extract` wrote');
  const manifest = await readManifest(dir);

  const frameFile = (n) => {
    const frame = manifest.frames.find((f) => f.n === n);
    if (!frame) throw new Error(`There is no frame ${n} in this run.`);
    if (!frame.legal) throw new Error(`Frame ${n} is not a legal H3 reference: ${frame.violations.join('; ')}`);
    return frame.file;
  };
  const { arms, config } = flag('plan') ? await armsFromPlan(flag('plan'), manifest, frameFile) : armsFromFlags(manifest, frameFile);
  const each = priceUsd(config);

  for (const arm of arms) {
    if (arm.refs.length > 9) throw new Error(`Arm ${arm.id}: H3 takes at most nine references, got ${arm.refs.length}.`);
    // An arm id already rendered with DIFFERENT settings must not be silently "resumed" — that
    // would label an old render with a new plan. New settings need a new arm id.
    const previous = manifest.arms[arm.id];
    if (previous && (previous.text !== arm.text || previous.refs.join() !== arm.refs.join() || previous.config?.duration !== config.duration || previous.config?.ratio !== config.ratio)) {
      throw new Error(`Arm ${arm.id} was already rendered in this run with different settings. Give the new one a different id.`);
    }
  }

  // Settled arms cost nothing again; in-flight ones are polled, not resubmitted.
  const toSubmit = arms.filter((arm) => !manifest.arms[arm.id]?.taskId);
  const spend = toSubmit.length * each;

  console.log(`\n${manifest.name}  ·  ${config.model} ${config.resolution} ${config.duration}s ${config.ratio}`);
  for (const arm of arms) {
    const state = manifest.arms[arm.id]?.mp4 ? 'done' : manifest.arms[arm.id]?.taskId ? 'in flight — will poll' : `$${each.toFixed(2)}`;
    console.log(`  ${arm.id}  ${arm.title.padEnd(34)} ${arm.refs.length} ref${arm.refs.length > 1 ? 's' : ' '}  ${state}`);
  }
  console.log(`\n  new spend: $${spend.toFixed(2)}   (H3 768P is $0.08/s)`);

  if (spend > 0 && !has('yes')) {
    console.log('  Nothing submitted. Add --yes to spend it.\n');
    return;
  }

  // Preflight every reference while it is free — H3 checks them after the task is billed. The
  // request as a whole too: nine full-size frames can approach the 64MB body limit.
  for (const arm of toSubmit) {
    let total = 0;
    for (const ref of arm.refs) {
      // eslint-disable-next-line no-await-in-loop
      const bytes = new Uint8Array(await readFile(join(dir, ref)));
      total += bytes.length;
      const mime = ref.endsWith('.jpg') ? 'image/jpeg' : ref.endsWith('.webp') ? 'image/webp' : 'image/png';
      const floor = checkReference({ key: ref, mime, bytes }).violations.filter((v) => v.severity === 'floor');
      if (floor.length) throw new Error(`Arm ${arm.id}: ${floor.map((v) => v.detail).join('; ')}`);
    }
    if (total * 1.34 > H3_REFERENCE_LIMITS.maxRequestBytes) {
      throw new Error(`Arm ${arm.id}: references base64-encode to ~${Math.round((total * 1.34) / 1e6)}MB, over H3's ${H3_REFERENCE_LIMITS.maxRequestBytes / 1e6}MB request limit.`);
    }
  }

  for (const arm of toSubmit) {
    // eslint-disable-next-line no-await-in-loop
    const content = await h3Content({ text: arm.text, referenceImages: arm.refs.map((ref) => join(dir, ref)) });
    // eslint-disable-next-line no-await-in-loop
    const taskId = await createH3Task({ ...config, content });
    // ⚠️ WRITTEN BEFORE ANYTHING ELSE. From here we are being charged.
    manifest.arms[arm.id] = { title: arm.title, refs: arm.refs, text: arm.text, config, taskId, submittedAt: new Date().toISOString(), cost: each };
    // eslint-disable-next-line no-await-in-loop
    await saveManifest(dir, manifest);
    console.log(`  ${arm.id} submitted  task ${taskId}`);
  }

  console.log('\n  Rendering — usually 3-6 minutes, the three run side by side.\n');
  const settled = await Promise.allSettled(
    arms
      .filter((arm) => !manifest.arms[arm.id]?.mp4)
      .map(async (arm) => {
        const record = manifest.arms[arm.id];
        const { url } = await awaitVideo(record.taskId, {
          onTick: ({ tick, status }) => {
            if (tick % 6 === 0) console.log(`  ${arm.id} ${status} ${tick * 10}s`);
          },
        });
        const file = `arm-${arm.id}.mp4`;
        const response = await fetch(url);
        await writeFile(join(dir, file), Buffer.from(await response.arrayBuffer()));
        record.mp4 = file;
        record.settledAt = new Date().toISOString();
        console.log(`  ${arm.id} ✅ ${file}`);
      }),
  );
  for (const result of settled) {
    if (result.status === 'rejected') console.log(`  ❌ ${result.reason?.message ?? result.reason}  (re-run the same command to resume)`);
  }

  await saveManifest(dir, manifest);
  const page = join(dir, flag('plan') ? `compare-${basename(flag('plan'), '.json')}.html` : 'compare.html');
  await writeFile(page, comparePage(manifest, arms, config));
  console.log(`\n  → ${page}\n`);
  await openFile(page);
}

// ───────────────────────────────────────────────────────────────────────────── pages

const PAGE_STYLE = `
  :root { --bg:#f7f7f5; --panel:#fff; --ink:#1b1b1a; --muted:#6b6b66; --line:#e3e3de; --ok:#1d7f45; --bad:#b3261e; --accent:#2f5bd3; }
  @media (prefers-color-scheme: dark) { :root { --bg:#121211; --panel:#1b1b1a; --ink:#ecece8; --muted:#9a9a93; --line:#2d2d2a; --ok:#4cc27a; --bad:#ff7a70; --accent:#86a6ff; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.5 system-ui,-apple-system,sans-serif; }
  main { max-width:1200px; margin:0 auto; padding:24px 16px 64px; }
  h1 { font-size:20px; margin:0 0 4px; } h2 { font-size:15px; margin:24px 0 8px; }
  .muted { color:var(--muted); } p { max-width:75ch; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:10px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:8px; }
  .card img { width:100%; height:auto; border-radius:4px; display:block; background:var(--bg); }
  .card .meta { font-size:12px; color:var(--muted); margin-top:6px; }
  .card.illegal { opacity:.45; }
  .pick { display:flex; gap:12px; font-size:13px; margin-top:6px; }
  .pick label { display:flex; gap:4px; align-items:center; cursor:pointer; }
  textarea { width:100%; font:12px/1.4 ui-monospace,monospace; padding:10px; border-radius:6px; border:1px solid var(--line); background:var(--panel); color:var(--ink); resize:vertical; }
  button { font:inherit; padding:7px 14px; border-radius:6px; border:1px solid var(--accent); background:var(--accent); color:#fff; cursor:pointer; }
  .ok { color:var(--ok); } .bad { color:var(--bad); }
  .arms { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:14px; }
  .arm video { width:100%; border-radius:6px; background:#000; display:block; }
  .refs { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
  .refs img { width:64px; height:64px; object-fit:cover; border-radius:4px; border:1px solid var(--line); }
  details { margin-top:8px; font-size:12px; } details pre { white-space:pre-wrap; color:var(--muted); }
  ul.look li { margin-bottom:4px; }
`;

function pickPage(dir, manifest) {
  const frames = manifest.frames
    .map(
      (f) => `
    <div class="card ${f.legal ? '' : 'illegal'}">
      <img src="${escapeHtml(f.file)}" alt="Frame ${f.n} at ${f.atSeconds}s">
      <div class="meta">#${f.n} · ${f.atSeconds}s · ${f.width}×${f.height} ${f.legal ? '<span class="ok">legal</span>' : `<span class="bad">${escapeHtml(f.violations[0] ?? 'illegal')}</span>`}</div>
      ${f.legal ? `<div class="pick">
        <label><input type="radio" name="single" value="${f.n}"> single</label>
        <label><input type="checkbox" name="multi" value="${f.n}"> multi</label>
      </div>` : ''}
    </div>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pick frames</title><style>${PAGE_STYLE}</style></head>
<body><main>
  <h1>Pick frames — ${escapeHtml(manifest.name)}</h1>
  <p class="muted">${escapeHtml(manifest.token)} · film ${manifest.film.duration.toFixed(1)}s, ${(manifest.film.bytes / 1e6).toFixed(1)}MB</p>

  <h2>Today's reference — what arm A sends</h2>
  <div class="grid"><div class="card"><img src="${escapeHtml(manifest.still.file)}" alt="The still"><div class="meta">the still · ${manifest.still.width}×${manifest.still.height}</div></div></div>

  <h2>Frames from the film</h2>
  <p>Choose <strong>one</strong> frame for arm B (the single best view of the character) and
  <strong>two or three</strong> for arm C (different angles of the same character — a front, a
  three-quarter, a side). Skip frames where the character is blurred, cut off, or covered.</p>
  <div class="grid">${frames}</div>

  <h2>Then run this</h2>
  <p class="muted">It prints the plan and the price and spends nothing. Add <code>--yes</code> to render.</p>
  <textarea id="cmd" rows="3" readonly></textarea>
  <p><button id="copy">Copy command</button> <span id="note" class="muted"></span></p>
</main>
<script>
  const dir = ${JSON.stringify(dir)};
  const cmd = document.getElementById('cmd');
  const note = document.getElementById('note');
  function update() {
    const single = document.querySelector('input[name=single]:checked')?.value;
    const multi = [...document.querySelectorAll('input[name=multi]:checked')].map((i) => i.value);
    if (!single || multi.length < 2) {
      cmd.value = 'Pick one "single" frame and at least two "multi" frames.';
      return;
    }
    cmd.value = 'node --env-file=.env scripts/screen-frames.mjs render --run ' + dir + ' --single ' + single + ' --multi ' + multi.join(',');
    note.textContent = multi.length > 3 ? 'More than three is allowed, but three is the test worth running first.' : '';
  }
  document.querySelectorAll('input').forEach((i) => i.addEventListener('change', update));
  document.getElementById('copy').addEventListener('click', () => { cmd.select(); document.execCommand('copy'); note.textContent = 'Copied.'; });
  update();
</script>
</body></html>`;
}

function comparePage(manifest, arms, config) {
  const columns = arms
    .map((arm) => {
      const record = manifest.arms[arm.id] ?? {};
      const video = record.mp4
        ? `<video src="${escapeHtml(record.mp4)}" controls muted loop playsinline preload="auto"></video>`
        : `<p class="bad">Not rendered${record.taskId ? ` — task ${escapeHtml(record.taskId)} is still in flight; re-run the command to resume` : ''}.</p>`;
      return `
    <div class="card arm">
      <strong>${arm.id} — ${escapeHtml(arm.title)}</strong>
      ${video}
      <div class="refs">${arm.refs.map((ref) => `<img src="${escapeHtml(ref)}" alt="">`).join('')}</div>
      <details><summary>Prompt</summary><pre>${escapeHtml(arm.text)}</pre></details>
    </div>`;
    })
    .join('');
  const spent = Object.values(manifest.arms).reduce((sum, a) => sum + (a.cost ?? 0), 0);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Frame screen test</title><style>${PAGE_STYLE}</style></head>
<body><main>
  <h1>Screen test — ${escapeHtml(manifest.name)}</h1>
  <p class="muted">Same beats, ${escapeHtml(config.model)} ${escapeHtml(config.resolution)} ${config.duration}s ${escapeHtml(config.ratio)}. Only the reference images differ. Spent $${spent.toFixed(2)}.</p>
  <p><button id="play">Play all from the start</button></p>
  <div class="arms">${columns}</div>

  <h2>What to look for</h2>
  <ul class="look">
    <li><strong>Is it the right character?</strong> Face, body, clothing, colours — against the references under each video.</li>
    <li><strong>Did the still's baggage come through in A?</strong> A card border, lettering, a background that isn't in the beats.</li>
    <li><strong>B vs A</strong> — does one film frame already fix it? If so, the win is "frame beats still", not "more views".</li>
    <li><strong>C vs B</strong> — during the turn, does C hold the character better from new angles? Or does it show <em>several</em> characters, or blend them?</li>
  </ul>
</main>
<script>
  document.getElementById('play').addEventListener('click', () => {
    document.querySelectorAll('video').forEach((v) => { v.currentTime = 0; v.play(); });
  });
</script>
</body></html>`;
}

// ───────────────────────────────────────────────────────────────────────────── main

const main = async () => {
  if (command === 'extract') return extract();
  if (command === 'render') return render();
  console.log('Usage: screen-frames.mjs extract [--token chain:address:id] [--count 8]');
  console.log('       screen-frames.mjs render --run <dir> (--single N --multi a,b,c [--duration 6] | --plan plan.json) [--yes]');
  return undefined;
};

main().catch((error) => {
  console.error(`\nscreen-frames failed: ${error.message}`);
  process.exit(1);
});
