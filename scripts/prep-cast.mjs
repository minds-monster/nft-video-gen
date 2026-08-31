#!/usr/bin/env node
// Build the race-launch cast: reference stills for every character, garment, prop and car.
//
// Separate from prep-refs.mjs on purpose. That script opens with `rm -rf assets/refs`, so
// running it re-downloads a 42MB film and every existing piece; this one is additive and
// writes only into assets/refs/cast/. Fold it into prep-refs once the film is locked.
//
// Three things learned the hard way, all encoded below:
//
//  1. IPFS CANNOT SERVE THE TWO CARS. The Porsche and McLaren CIDs return "no providers
//     found for the CID" on every gateway in prep-refs.mjs's fallback chain. Alchemy
//     mirrors the media on its own CDN (image.cachedUrl / image.pngUrl), which is the only
//     working source — so metadata is fetched first and the CDN URL preferred.
//
//  2. CROP BURNED-IN TYPE OFF EVERYTHING. Probe P3 reproduced the McLaren card's
//     "MCL_GENESIS / HONORARY" letter-perfect in the render. The adidas cards are worse:
//     they are trading cards where the character is a fraction of the frame.
//
//  3. REFERENCE ASPECT MUST BE 0.4-2.5, short side >=256px. A tall figure cut-out breaks
//     this easily and the API only says so after the task has queued and been billed. So
//     narrow figure crops get padded, and everything is verified before it is written.
//
//   node --env-file=.env scripts/prep-cast.mjs
//   node --env-file=.env scripts/prep-cast.mjs --only courtney,gmoney

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const OUT = 'assets/refs/cast';
const RAW = 'assets/refs/cast/raw';
const PHASE1 = 'assets/refs/raw/ape-phase1-still.mp4';

const alchemyKey = () => {
  const k = process.env.VITE_ALCHEMY_API_KEY;
  if (!k) throw new Error('VITE_ALCHEMY_API_KEY is not set (it lives in .env)');
  return k;
};

/** Alchemy metadata → the best reachable media URL, CDN first. */
const mediaUrl = async ({ chain, contract, tokenId }) => {
  const url = `https://${chain}.g.alchemy.com/nft/v3/${alchemyKey()}/getNFTMetadata?contractAddress=${contract}&tokenId=${tokenId}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Alchemy ${response.status} for ${contract} #${tokenId}`);
  const json = await response.json();
  const image = json.image ?? {};
  // pngUrl is a normalised re-encode, which matters because some of these are AVIF and
  // MiniMax accepts only jpg/png/webp/heic.
  const candidate = image.pngUrl || image.cachedUrl || image.originalUrl;
  if (!candidate) throw new Error(`no image URL for ${contract} #${tokenId}`);
  return { url: candidate, name: json.name ?? null };
};

const download = async (url, file) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
};

const dimensions = async (file) => {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
  ]);
  const [w, h] = stdout.trim().split(',').map(Number);
  return { w, h };
};

/** Reject anything H3 would reject, before it costs a task. */
const verify = async (file) => {
  const { w, h } = await dimensions(file);
  const aspect = w / h;
  const problems = [];
  if (aspect < 0.4 || aspect > 2.5) problems.push(`aspect ${aspect.toFixed(3)} outside [0.4, 2.5]`);
  if (Math.min(w, h) < 256) problems.push(`short side ${Math.min(w, h)}px < 256`);
  return { w, h, aspect: Number(aspect.toFixed(3)), problems };
};

// Each piece: where the pixels come from, and the exact filter that isolates the subject.
// Crops are the ones verified by eye during the probe round — see assets/renders/probe-*.
const PIECES = {
  // ---- characters, cut out of the adidas Phase 1 trading-card film -------------
  courtney: {
    label: 'PUNKS Comic — Courtney (adidas Into the Metaverse Phase 1)',
    from: { video: PHASE1, at: 0.25 },
    // Front-on card at t=0.25s. Widened to 300px so the aspect clears 0.4 — a tighter
    // 220px cut was 0.344 and the API rejected it after queueing.
    filter: 'crop=300:660:390:190,scale=-1:1024',
    note: 'bald, green diamond harlequin eye paint, plum lip, studded choker, white trefoil crop tee',
  },
  gmoney: {
    label: 'gmoney (adidas Into the Metaverse Phase 1)',
    // From the already-extracted frame, NOT the video: the film cycles each card front and
    // back, so seeking by timestamp is fragile — t=6.0 lands on gmoney's text back, which
    // crops to an unusable panel of blurred copy. This frame is verified front-on.
    from: { image: 'assets/refs/frames/ape-phase1-07.png' },
    // Cropped tight to exclude the card's "G" roundel and pink "1" badge at x>=620,
    // then padded back to a legal aspect rather than widening into them.
    filter: 'crop=190:700:425:175,pad=320:700:65:0:black,scale=-1:1024',
    note: 'brown ape punk, knitted orange beanie, black hoodie with address print',
  },

  // ---- wardrobe ---------------------------------------------------------------
  tiara: {
    label: 'D&G Collezione Genesi — The Impossible Tiara',
    token: { chain: 'eth-mainnet', contract: '0xd71B53FE1Df51075c5a965956cdc87421C2fFeD7', tokenId: 4 },
    note: 'silver, deep-red cushion stones, turquoise accents, glowing red centre. Only 500x500 exists',
  },
  'silver-dress': {
    label: 'D&G Collezione Genesi — Dress from a Dream: Silver',
    token: { chain: 'eth-mainnet', contract: '0xd71B53FE1Df51075c5a965956cdc87421C2fFeD7', tokenId: 5 },
    note: 'off-shoulder silver metallic knit, coloured jewelled goblet embroidery, gold trim. ON A GOLD CHROME MANNEQUIN — prompts must say the wearer has ordinary skin',
  },
  'mosaic-jacket': {
    label: 'D&G Collezione Genesi — The Mosaic Impossible Jacket',
    token: { chain: 'eth-mainnet', contract: '0xd71B53FE1Df51075c5a965956cdc87421C2fFeD7', tokenId: 2 },
    note: 'gold/green/white/dark-blue byzantine tile, white eight-pointed star-flowers, dark green patent collar. ON AN IRIDESCENT CHROME MANNEQUIN',
  },

  // ---- props -----------------------------------------------------------------
  blossom: {
    label: 'SUPERGUCCI BLOSSOM #1 (Gucci x Superplastic)',
    token: { chain: 'eth-mainnet', contract: '0x78d61C684A992b0289Bbfe58Aaa2659F667907f8', tokenId: 0 },
    // Cropped tight to the figure. The full 1080x1080 artwork sets the figure against a dense
    // GG-monogram-and-Flora background in the same palette, and it camouflages: passed whole,
    // v2 rendered a hatless white blob. Cropped to the figure the green cap and chin strap
    // dominate the frame instead of competing with the wallpaper.
    filter: 'crop=440:780:320:140,scale=-1:1200',
    note: 'white vinyl figure, pointed ears, green peaked cap marked 100, chin strap, painted flowers. NB the cap lettering is part of the asset — the GRADE block must not forbid printed text outright or it suppresses it',
  },

  // ---- crowd -----------------------------------------------------------------
  'moca-a': {
    label: 'Mocaverse',
    token: { chain: 'eth-mainnet', contract: '0x59325733eb952a92e069C87F0A6168b29E80627f', tokenId: 0 },
    note: 'flat 2D vector, 500x500 — renders as toy-3D in the crowd to match the adidas cast',
  },
  'moca-b': {
    label: 'Mocaverse',
    token: { chain: 'eth-mainnet', contract: '0x59325733eb952a92e069C87F0A6168b29E80627f', tokenId: 1 },
  },
  'moca-c': {
    label: 'Mocaverse',
    token: { chain: 'eth-mainnet', contract: '0x59325733eb952a92e069C87F0A6168b29E80627f', tokenId: 2 },
  },

  // ---- cars — both ONLY reachable via Alchemy's CDN ---------------------------
  porsche: {
    label: 'PORSCHΞ 911 #0',
    token: { chain: 'eth-mainnet', contract: '0xb763d44326552600c3B83258aD490F68777D4c27', tokenId: 0 },
    // 4000x4000, car in the lower-middle. 16:9 around the car including the windscreen.
    filter: 'crop=3556:2000:222:1100,scale=1920:1080',
    note: 'white 911, FRONT-ON ONLY (every token shares one CID). Windscreen is heavily tinted, so a driver will not read through it — the camera has to come round to the side window',
  },
  mclaren: {
    label: 'McLaren MSO LAB GENESIS #1',
    token: { chain: 'eth-mainnet', contract: '0xC2Ac394984f3850027dac95Fe8A62E446c5FB786', tokenId: 1 },
    // Clears BOTH the MSO LAB logo (above y=212) and the MCL_GENESIS/HONORARY type
    // (below y=782). 570px of usable height => 1013px wide for 16:9. Cropping this tight
    // makes the near-black studio backdrop dominate, so lift it slightly — the wrap pattern
    // and gold wheels are what the model has to read.
    filter: 'crop=1013:570:33:212,eq=brightness=0.06:contrast=1.08:saturation=1.05,scale=1920:1080',
    note: 'P1 in black/white topographic wrap with gold wheels',
  },

  'revuelto-clean': {
    label: 'Automobili Lamborghini Revuelto — front 3/4, number plate removed',
    from: { image: 'assets/refs/frames/revuelto-03.png' },
    // The artwork carries a "REVUELTO" number plate on the front bumper, and v3 reproduced it
    // as garbled lettering ("...MDINUERV") across the hero car's nose — the same failure mode
    // probe P3 demonstrated with the McLaren card's type, which came through letter-perfect.
    // delogo interpolates the plate away from its surroundings rather than blurring a grey box
    // over it, so the bumper still reads as bodywork.
    filter: 'delogo=x=132:y=556:w=82:h=32',
    note: 'every front-facing Revuelto frame carries this plate, so it has to be patched rather than avoided',
  },

  // ---- composites: several assets in ONE reference slot -----------------------
  //
  // H3 caps references at 9, and v2 needed 12. It spent all nine on luggage, cars, faces and
  // garments, which left the tiara, the Blossom and the entire crowd with NO reference at all
  // — they were prose-only, which is exactly why the crowd was not Mocaverse in any sense and
  // the Blossom lost its cap. cars-trio already proved the way out: side-by-side panels in one
  // slot, which is what separated the three marques in v2.
  //
  // This is not a resolution compromise. The individual crops are ~465x1024; a three-panel
  // composite at H3's ceiling (max side 5760, aspect <=2.5) gives each panel 1200x1440 — more
  // pixels per asset than passing them separately. Faces stay individual anyway, because that
  // fidelity is the thing most worth protecting.
  // Three marques in one slot. This is the reference that made the three cars distinct in v3 —
  // v2 rendered all three as the same Lamborghini because the second and third were prose-only.
  // Now built here rather than by an ad-hoc command, so it is reproducible, and at 1200x1440 a
  // panel instead of the original 840x1024.
  'cars-trio': {
    label: 'Revuelto + PORSCHΞ 911 + McLaren MSO LAB, left to right',
    panels: [`${OUT}/revuelto-clean.png`, `${OUT}/porsche.png`, `${OUT}/mclaren.png`],
    panel: [1200, 1440],
    note: 'order matters — the GRID block names first/second/third car in this same order',
  },
  'luggage-pair': {
    label: 'Rimowa cabin case + LV VIA Tile Trunk',
    panels: ['assets/refs/raw/rimowa-still.png', 'assets/refs/raw/lv-trunk-still.jpg'],
    panel: [1400, 1120], // 2800x1120 = aspect 2.50
    note: 'both render perfectly and always have — pixel-camo print with yellow bolt, and monogram with tan corners',
  },
  'wardrobe-trio': {
    label: 'D&G Velvet + Dress from a Dream: Silver + Mosaic Impossible Jacket',
    panels: ['assets/refs/raw/jacket-still.jpg', `${OUT}/silver-dress.png`, `${OUT}/mosaic-jacket.png`],
    panel: [1200, 1440], // 3600x1440 = aspect 2.50
    note: 'left-to-right: velvet (ape), silver gown (courtney), mosaic (gmoney). Two of the three are shot on chrome mannequins, so the prompt GUARD about ordinary skin still matters',
  },
  'moca-trio': {
    label: 'Mocaverse ×3',
    panels: [`${OUT}/moca-a.png`, `${OUT}/moca-b.png`, `${OUT}/moca-c.png`],
    panel: [1200, 1440],
    note: 'the crowd. Flat 2D vector — Mocaverse has no 3D or animated variant (checked: no animation_url on any token), so H3 has to dimensionalise them, which P4 showed it does well from flat card art',
  },
};

const only = (() => {
  const i = process.argv.indexOf('--only');
  return i === -1 ? null : new Set(process.argv[i + 1].split(','));
})();

await mkdir(RAW, { recursive: true });

// With `--only`, carry forward the entries this run is not rebuilding so their provenance
// is not silently dropped. A full run rebuilds everything, so it starts clean — otherwise
// the carried-forward entries would be duplicated by the ones appended below.
const manifest = only
  ? await readFile(`${OUT}/manifest.json`, 'utf8')
      .then((raw) => JSON.parse(raw).filter((entry) => !only.has(entry.key)))
      .catch(() => [])
  : [];
for (const [key, piece] of Object.entries(PIECES)) {
  if (only && !only.has(key)) continue;

  const target = `${OUT}/${key}.png`;
  let source;

  try {
    if (piece.panels) {
      // Side-by-side panels into one reference. Each source is fitted inside its panel box
      // preserving aspect and padded, so nothing is stretched or cropped further — the whole
      // point is that every asset stays individually legible.
      const [pw, ph] = piece.panel;
      const inputs = piece.panels.flatMap((f) => ['-i', f]);
      const chains = piece.panels
        .map((_, i) => `[${i}:v]scale=${pw}:${ph}:force_original_aspect_ratio=decrease,pad=${pw}:${ph}:(ow-iw)/2:(oh-ih)/2:black[p${i}]`)
        .join(';');
      const stack = `${piece.panels.map((_, i) => `[p${i}]`).join('')}hstack=inputs=${piece.panels.length}[out]`;
      source = { kind: 'composite', panels: piece.panels, panel: piece.panel };
      await run('ffmpeg', [
        '-v', 'error', '-y', ...inputs,
        '-filter_complex', `${chains};${stack}`,
        '-map', '[out]', target,
      ]);
    } else if (piece.from?.video) {
      source = { kind: 'video-frame', file: piece.from.video, at: piece.from.at };
      const args = ['-v', 'error', '-y', '-ss', String(piece.from.at), '-i', piece.from.video, '-frames:v', '1'];
      if (piece.filter) args.push('-vf', piece.filter);
      await run('ffmpeg', [...args, target]);
    } else if (piece.from?.image) {
      source = { kind: 'image', file: piece.from.image };
      const args = ['-v', 'error', '-y', '-i', piece.from.image];
      if (piece.filter) args.push('-vf', piece.filter);
      await run('ffmpeg', [...args, target]);
    } else {
      const { url, name } = await mediaUrl(piece.token);
      const rawFile = `${RAW}/${key}.bin`;
      await download(url, rawFile);
      source = { kind: 'token', url, onChainName: name, ...piece.token };
      // ffmpeg also normalises AVIF/WebP, which MiniMax will not take as-is.
      const args = ['-v', 'error', '-y', '-i', rawFile];
      if (piece.filter) args.push('-vf', piece.filter);
      await run('ffmpeg', [...args, target]);
    }

    const checked = await verify(target);
    manifest.push({ key, label: piece.label, note: piece.note ?? null, file: target, source, ...checked });
    const flag = checked.problems.length ? `✗ ${checked.problems.join('; ')}` : '✓';
    console.log(`${flag} ${key.padEnd(14)} ${checked.w}x${checked.h} aspect ${checked.aspect}  ${piece.label}`);
  } catch (error) {
    console.log(`✗ ${key.padEnd(14)} ${error.message}`);
    manifest.push({ key, label: piece.label, error: error.message });
  }
}

await writeFile(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));

const bad = manifest.filter((m) => m.error || m.problems?.length);
console.log(`\n${manifest.length} pieces → ${OUT}/manifest.json`);
if (bad.length) {
  console.log(`${bad.length} need attention: ${bad.map((b) => b.key).join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('All pieces legal for H3. Now VIEW every crop before rendering — a bad crop is');
  console.log('invisible in a manifest and obvious in a render.');
}
