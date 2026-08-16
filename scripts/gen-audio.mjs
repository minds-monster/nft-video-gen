#!/usr/bin/env node
// Build the race-launch soundtrack and mux it onto a render.
//
// Three layers, because no single source gives all of it:
//
//   1. STEM — the audio H3 generated with the picture. Verified present: launch-1.mp4 carries
//      an aac/32kHz/stereo track (the Hailuo-02 renders are silent). This is the only layer
//      perfectly synced to the image, so the rain, servos, engine note, crowd and thunder all
//      come from here. It sits at ambience level throughout and steps down further at the green
//      light: measured, three quite different scores produced near-identical envelopes for the
//      first ten seconds because the rain and idling engines were louder than any of them, and a
//      slow build nobody can hear is not a build. The music leads; the stem is texture.
//   2. SCORE — a continuous instrumental from music-3.0. H3's per-clip audio can't carry
//      music across a whole film, so the emotional arc is laid underneath separately.
//   3. CALL — a TTS "RACE ON!" landing on the green light.
//   4. BOOM — a synthesised sub-bass impact on the same frame, made in ffmpeg not generated.
//
// The score is sidechain-ducked under the call so the line cuts through without anyone
// riding a fader, and a rising volume envelope carries anticipation into exhilaration.
//
//   node --env-file=.env scripts/gen-audio.mjs --candidates          # 3 scores to choose from
//   node --env-file=.env scripts/gen-audio.mjs <render.mp4> --score b
//   node --env-file=.env scripts/gen-audio.mjs <render.mp4> --launch 10.8
//   node --env-file=.env scripts/gen-audio.mjs <render.mp4> --reuse   # remix, no API calls

import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createMusic, createSpeech } from './minimax.mjs';

const run = promisify(execFile);
const OUT = 'assets/audio';

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
};
const has = (flag) => process.argv.includes(flag);

const video = process.argv[2];
if (!video || video.startsWith('--')) {
  // --candidates needs no render: it only generates music for you to audition.
  if (!has('--candidates')) {
    console.log('usage: gen-audio.mjs <render.mp4> [--launch 10.8] [--score a|b|c] [--reuse]');
    console.log('       gen-audio.mjs --candidates');
    process.exit(1);
  }
}

// Where the lights go green — everything in the mix is timed off this one number. Default is
// measured, not guessed: sampling oneshot-2 at 6fps across 10.4-12.4s puts the switch from red
// to green at t≈10.75s. Re-measure it for any new render rather than inheriting this.
const launchAt = Number(arg('--launch', 10.8));

// Three candidates on deliberately different axes, because the score is the one element I
// cannot judge — I have no ears here, so the choice belongs to whoever does.
//
// Two things learned from v2's score, which was the weakest part of the film:
//
//  * LENGTH. v2's prompt was 423 characters against a ~300-character working limit — 41% over,
//    so the tail was diluted or dropped outright. All three of these stay inside it.
//  * TIMING INSTRUCTIONS ARE WASTED. v2 spent characters on "a hard drop at eleven seconds";
//    music-3.0 does not honour timings and returned a 68s composition whose drop was nowhere
//    near 0:11. Timing is solved downstream by choosing WHICH WINDOW of the track to use
//    (see bestScoreOffset), so the prompt only has to describe the music.
//
// Guidance followed: genre, mood, instruments, dynamic direction, and a deliberate ending.
const SCORE_PROMPTS = {
  a:
    'Epic cinematic orchestral cue. Four-chord minor ostinato on piano and pulsing synth, ' +
    'driving eighth-note pulse beneath it, strings swelling above, low brass arriving late and ' +
    'enormous. Relentless, accelerating, triumphant. No vocals. Ends on one huge sustained hit.',
  b:
    'Epic cinematic action cue, drums forward. Taiko and floor toms driving hard from the first ' +
    'bar, tight staccato brass stabs, aggressive string ostinato, deep sub bass. Relentless, ' +
    'accelerating, no let-up. No vocals. Ends on one huge sustained hit.',
  c:
    'Modern hybrid trailer cue. Huge brass braams over sub bass, rising synth arpeggios, ' +
    'distorted risers, thunderous percussion building to a wall of brass. Dark, glossy, adrenal, ' +
    'overwhelming. No vocals. Ends on one huge sustained hit.',

  // d/e/f target one specific register instead of spreading across three: the slow-building
  // four-chord blockbuster finale, accelerated. a/b/c were each a different genre and none of
  // them was that, which is why they missed.
  //
  // The musical DNA being asked for, written as content rather than as a reference: a very
  // simple looping minor chord progression, a steady pulsing ostinato underneath doing the work
  // of a clock, and a layered build — lone piano, then strings, then vast sustained brass —
  // with the emotional arc running elegiac to triumphant. The ticking ostinato is a happy
  // accident of fit here: it is also what a race countdown sounds like.
  //
  // They differ only in how hard the back half accelerates, which is the "taken up a level" part.
  d:
    'Slow-building epic orchestral cue. A simple four-chord minor progression loops over a steady ' +
    'pulsing ostinato, layering lone piano, then strings, then vast sustained brass, then pounding ' +
    'drums. Patient and elegiac becoming colossal and triumphant. No vocals.',
  e:
    'Epic cinematic build on four repeating minor chords over an insistent ticking ostinato. Lone ' +
    'piano opens, strings swell, then thunderous taiko and towering sustained brass take over ' +
    'completely. Inevitable, overwhelming, euphoric. No vocals. Ends enormous.',
  f:
    'Vast slow-burn orchestral cue: four looping minor chords, a relentless pulsing ostinato ' +
    'beneath, building in layers to a wall of sustained brass over driving double-time percussion. ' +
    'Melancholy turning triumphant and unstoppable. No vocals.',
};

const exists = (f) => access(f).then(() => true).catch(() => false);

const write = async (file, { audio, isUrl }) => {
  if (isUrl) {
    // Retried, because a bare fetch here is not good enough: generating the third candidate
    // died on ECONNRESET mid-download after the track had already been generated and paid
    // for. minimax.mjs wraps its own calls in fetchWithRetry for exactly this reason; the
    // asset download needs the same treatment.
    let response;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        response = await fetch(audio, { signal: AbortSignal.timeout(120_000) });
        if (response.ok) break;
        throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        if (attempt === 3) throw new Error(`fetching generated audio failed: ${error.message}`);
        await new Promise((done) => setTimeout(done, 2000 * 2 ** attempt));
      }
    }
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
  } else {
    // t2a (and music, when a URL is unavailable) return hex-encoded bytes.
    await writeFile(file, Buffer.from(audio, 'hex'));
  }
  return file;
};

const duration = async (file) => {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ]);
  return Number(stdout.trim());
};

const hasAudioStream = async (file) => {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file,
  ]);
  return stdout.trim().length > 0;
};

/**
 * Find where in the score to start.
 *
 * music-3.0 ignores requested timings and returns a whole composition — asking for "a drop at
 * eleven seconds" produced a 68s track whose drop is nowhere near 0:11. Taking the first 15s
 * would land the launch in the middle of an intro. So instead: measure the RMS envelope and
 * pick the window whose loudness STEPS UP hardest exactly at the launch beat. The music then
 * hits the green light because it was chosen to, not because the model was asked nicely.
 */
const bestScoreOffset = async (file, windowSeconds, launchSeconds) => {
  const probe = '/tmp/hero-score-rms.txt';
  await run('ffmpeg', [
    '-v', 'error', '-i', file,
    '-af', `astats=metadata=1:reset=22,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=${probe}`,
    '-f', 'null', '-',
  ]);

  const text = await readFile(probe, 'utf8');
  const series = [];
  let at = null;
  for (const line of text.split('\n')) {
    const time = /pts_time:([0-9.]+)/.exec(line);
    if (time) { at = Number(time[1]); continue; }
    const rms = /RMS_level=(-?[0-9.]+)/.exec(line);
    if (rms && at !== null) series.push([at, Number(rms[1])]);
  }
  if (series.length < 50) return { offset: 0, step: null };

  const mean = (lo, hi) => {
    const vals = series.filter(([t]) => t >= lo && t < hi).map(([, v]) => v);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const total = series[series.length - 1][0];

  // What the score is actually FOR, established by measuring the mix: the loudest moment of
  // the finished piece (-7.1 dB, just after the green light) comes from the H3 stem — the
  // engines launching and the crowd — and it is already locked to picture. The score does not
  // need to supply the hit. Its job is the BUILD: sit low and tense under the three driver
  // beats, then open up and carry the back half.
  //
  // So rank windows by how much louder the post-launch section is than the pre-launch one,
  // and reject any window whose pre-launch section is near-silent. Without that guard the
  // sharpest "rise" in the track is its own silence-to-intro onset (+23.6 dB), which aligns
  // an empty bar to the launch and wastes the first ten seconds.
  const NEAR_SILENT = -34;
  let best = { offset: 0, step: null, rank: -Infinity };
  for (let offset = 0; offset <= total - windowSeconds; offset += 0.5) {
    const pre = mean(offset, offset + launchSeconds);
    const post = mean(offset + launchSeconds, offset + windowSeconds);
    if (pre === null || post === null) continue;
    if (pre < NEAR_SILENT) continue;
    const rank = (post - pre) * 2 + post * 0.5;
    if (rank > best.rank) best = { offset, step: post - pre, rank };
  }
  return best;
};

const CANDIDATES = `${OUT}/candidates`;
await mkdir(CANDIDATES, { recursive: true });

// --score a|b|c|... picks a generated candidate; --score <path> takes any file.
const chosen = arg('--score', null);
// A supplied track is treated differently from a generated one in two ways below: its own
// dynamics are respected rather than overwritten with our synthetic build ramp, and the TTS
// announcer is not generated for it unless it is actually wanted.
const suppliedTrack = Boolean(chosen && !SCORE_PROMPTS[chosen]);
// --bare: music + the diegetic stem only. No announcer, no synthesised sub-bass impact.
const bare = has('--bare');
const scoreFile = chosen
  ? (SCORE_PROMPTS[chosen] ? `${CANDIDATES}/score-${chosen}.mp3` : chosen)
  : `${OUT}/score.mp3`;
const callFile = `${OUT}/call.mp3`;

// ------------------------------------------------------- generate the three candidates
if (has('--candidates')) {
  console.log('Generating 3 score candidates. Listen to them and pick with --score a|b|c.\n');
  const rows = [];
  for (const [key, prompt] of Object.entries(SCORE_PROMPTS)) {
    const file = `${CANDIDATES}/score-${key}.mp3`;
    if (await exists(file)) {
      console.log(`${key}  … already generated, keeping it`);
    } else {
      console.log(`${key}  … ${prompt.length} chars`);
      await write(file, await createMusic({ prompt, instrumental: true }));
    }
    const secs = await duration(file);
    // Report the same measurement the mix will use to place it, so the numbers mean something:
    // how much louder the track gets after the launch beat in its best 15s window.
    const best = await bestScoreOffset(file, 15.2, 10.8);
    rows.push({ key, file, secs, ...best });
    console.log(`   → ${file}  ${secs.toFixed(1)}s  best window from ${best.offset.toFixed(1)}s, +${(best.step ?? 0).toFixed(1)} dB after the launch beat`);
  }
  console.log('\n──────── candidates');
  for (const r of rows) {
    console.log(`  ${r.key}  ${r.file}  (${r.secs.toFixed(1)}s, +${(r.step ?? 0).toFixed(1)} dB step)`);
  }
  console.log('\nThe dB step is the only thing measurable here — it says nothing about whether the');
  console.log('music is any good. Listen, then re-run with:  --score a   (add --reuse to skip the call)');
  process.exit(0);
}

// ---------------------------------------------------------------- generate the layers
if (has('--reuse') && (await exists(scoreFile)) && (bare || (await exists(callFile)))) {
  console.log(`reusing ${scoreFile} and call.mp3 (no API calls)`);
} else {
  if (!(await exists(scoreFile))) {
    console.log('score  … music-3.0, instrumental (candidate a)');
    await write(scoreFile, await createMusic({ prompt: SCORE_PROMPTS.a, instrumental: true }));
    console.log(`       → ${scoreFile} (${(await duration(scoreFile)).toFixed(1)}s)`);
  }

  if (bare) {
    console.log('call   … skipped (--bare)');
  } else {
  console.log('call   … speech-02-hd');
  await write(
    callFile,
    await createSpeech({
      text: 'Race on!',
      // A trackside announcer, not a narrator: pushed up in speed and volume so it reads as
      // a shout over engines rather than a voiceover.
      voiceId: 'English_expressive_narrator',
      speed: 1.08,
      vol: 1.6,
      emotion: 'happy',
    }),
  );
  console.log(`       → ${callFile} (${(await duration(callFile)).toFixed(1)}s)`);
  }
}

// ------------------------------------------------------------------------------- mix
const videoSeconds = await duration(video);
const stem = await hasAudioStream(video);
const suffix = SCORE_PROMPTS[chosen]
  ? `.scored-${chosen}.mp4`
  : `.scored-track${bare ? '-bare' : ''}.mp4`;
const out = video.replace(/\.mp4$/, suffix);

const override = arg('--offset', null);
const picked = override !== null
  ? { offset: Number(override), step: null }
  : await bestScoreOffset(scoreFile, videoSeconds + 0.1, launchAt);

console.log(`\nmix    … ${videoSeconds.toFixed(2)}s video, launch at ${launchAt}s, stem ${stem ? 'present' : 'ABSENT'}`);
console.log(
  `       score window from ${picked.offset.toFixed(1)}s` +
    (picked.step !== null
      ? ` (+${picked.step.toFixed(1)} dB louder after the launch beat than before it)`
      : ' (manual)'),
);

// HEADROOM. Measured: the H3 stem peaks at -0.4 dBFS, and both generated files peak at 0.0.
// Summing three full-scale sources can only clip, and a limiter alone does not fix that — it
// just squashes everything against the ceiling (max_volume stayed pinned at 0.0 dB until each
// layer was pulled down here). So every layer gets explicit headroom BEFORE the mix, and the
// limiter goes back to being a safety net rather than the mix engineer.
// Headroom, again, and the reason it needed revisiting: raising the score to full scale and
// adding a sub-bass impact on the same frame put mixes A and B back at 0.0 dBFS. Loudness here
// comes from the RELATIVE balance below, not from pushing every layer up — so the score sits
// under unity and the boom is well below it, and the result measures ~-1 dBFS peak.
//
// The music leads, throughout — not just after the green light.
//
// This was measured, not guessed. With the stem at 0.62 the envelopes of three quite different
// scores came out nearly identical for the first ten seconds, because the rain and idling
// engines were louder than any of them. A slow-building cue whose build cannot be heard is
// pointless, so the stem drops to ambience level and the score starts well forward and rises
// from there. The stem still steps down again at the green light, so the payoff is music too.
const STEM_PRE = 0.46;   // ambience, not the lead — see the note below
const STEM_POST = 0.36;  // after: further back still, the score carries the payoff
const SCORE_CEIL = 0.86; // the ramp's top, reached at the launch beat
const CALL_GAIN = 0.9;
const BOOM_GAIN = 0.58;

const ms = Math.round(launchAt * 1000);

// Score: the chosen window, faded at both ends, rising into the launch and full thereafter.
//
// A SUPPLIED TRACK GETS A FLAT GAIN, NOT THE RAMP. The ramp exists because music-3.0's output
// has no reliable arc of its own, so one had to be imposed. A mastered track that somebody chose
// already has its dynamics — Oracle sits at a steady -9.4 dB through its body with a deliberate
// breakdown at 45-55s — and riding a 0.68->1.0 curve over that would flatten exactly the shape
// it was picked for. So the window selection still places the track (that is what aligns its
// drop to the green light), but the level is left alone.
const scoreVolume = suppliedTrack
  ? `volume=${SCORE_CEIL}`
  : `volume='min(${SCORE_CEIL}, ${(SCORE_CEIL * 0.68).toFixed(3)} + ${(SCORE_CEIL * 0.32).toFixed(3)}*t/${launchAt})':eval=frame`;

const scoreChain =
  `[1:a]atrim=start=${picked.offset.toFixed(3)}:duration=${videoSeconds.toFixed(3)},asetpts=N/SR/TB,` +
  `${scoreVolume},` +
  `afade=t=in:st=0:d=0.6,afade=t=out:st=${(videoSeconds - 0.7).toFixed(3)}:d=0.7[score]`;

// Call: delayed onto the green light, and used as the sidechain key so the score dips for it.
const callChain = `[2:a]adelay=${ms}|${ms},volume=${CALL_GAIN}[call]`;

// Sub-bass impact on the green light. A decaying 45 Hz sine, synthesised rather than generated
// — deterministic, free, and the single cheapest thing that makes a launch feel like a launch.
// Ramped in over 8ms so it starts on a zero crossing instead of clicking.
const boomChain =
  `[3:a]aformat=channel_layouts=stereo,adelay=${ms}|${ms},volume=${BOOM_GAIN}[boom]`;

const filters = bare ? [scoreChain] : [scoreChain, callChain, boomChain];

// Stem: a half-second linear ride down at the launch rather than a hard step, which would click.
const stemVolume =
  `volume='if(lt(t,${launchAt}), ${STEM_PRE}, ` +
  `if(lt(t,${launchAt + 0.5}), ${STEM_PRE} - ${((STEM_PRE - STEM_POST) / 0.5).toFixed(4)}*(t-${launchAt}), ${STEM_POST}))':eval=frame`;

// Limiter, then an explicit trim. The limiter alone is not enough: it caps sample peaks, but
// AAC and Opus reconstruct INTER-sample peaks slightly higher, and a mix measuring -0.7 dBFS
// came back out of the AAC encoder at 0.0 — i.e. clipping in the file that actually ships. So
// leave real headroom for the codec rather than mastering to the ceiling.
const LIMIT = 'alimiter=limit=0.80:level=false,volume=-2.0dB';
if (bare) {
  // Two layers, nothing to duck against.
  if (stem) {
    filters.push(`[0:a]${stemVolume},highpass=f=45[stem]`);
    filters.push(`[stem][score]amix=inputs=2:duration=first:normalize=0,${LIMIT}[mix]`);
  } else {
    filters.push(`[score]${LIMIT}[mix]`);
  }
} else if (stem) {
  filters.push(`[0:a]${stemVolume},highpass=f=45[stem]`);
  filters.push('[score][call]sidechaincompress=threshold=0.045:ratio=8:attack=5:release=320[ducked]');
  filters.push(`[stem][ducked][call][boom]amix=inputs=4:duration=first:normalize=0,${LIMIT}[mix]`);
} else {
  filters.push('[score][call]sidechaincompress=threshold=0.045:ratio=8:attack=5:release=320[ducked]');
  filters.push(`[ducked][call][boom]amix=inputs=3:duration=first:normalize=0,${LIMIT}[mix]`);
}
const mixInputs = bare ? (stem ? 2 : 1) : (stem ? 4 : 3);

// Inputs have to match the graph: in bare mode the call file may not even exist, so it must
// not be passed at all rather than passed and ignored.
const inputs = [
  '-i', video,      // [0] picture + H3 stem
  '-i', scoreFile,  // [1] score
];
if (!bare) {
  inputs.push('-i', callFile); // [2] "RACE ON!"
  // [3] the sub-bass impact, generated inline by lavfi rather than shipped as a file
  inputs.push('-f', 'lavfi', '-i', "aevalsrc='0.95*exp(-4.5*t)*sin(2*PI*45*t)*min(1,t/0.008)':d=1.6:s=44100");
}

await run('ffmpeg', [
  '-v', 'error', '-y',
  ...inputs,
  '-filter_complex', filters.join(';'),
  '-map', '0:v', '-map', '[mix]',
  '-c:v', 'copy',
  '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
  '-shortest', '-movflags', '+faststart',
  out,
]);

const { stdout } = await run('ffprobe', [
  '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,channels', '-of', 'csv=p=0', out,
]);
console.log(`       → ${out}\n${stdout.trim().split('\n').map((l) => '         ' + l).join('\n')}`);
console.log(`\n${mixInputs} layers mixed. LISTEN before encoding — a mix looks fine in ffprobe and`);
console.log('wrong in the ear, especially where the call lands relative to the green light.');
