#!/usr/bin/env node
// Prove the hero backdrop cannot hurt page load.
//
//   npm run dev                 # in another terminal
//   npm run verify:hero
//   npm run verify:hero -- --url http://localhost:4173 --keep
//
// The claim being tested is specific: the poster is the LCP element, and video bytes are
// spent ONLY on a desktop viewport, with motion allowed, and not before first paint. Those
// are easy to write and easy to regress — a stray `preload` or an `src` on a <source> and
// several megabytes move onto the critical path silently. So we assert it in a real browser
// rather than trusting the markup.
//
// Drives Chrome over CDP directly. No puppeteer dependency: Node has a WebSocket client and
// CDP is a JSON protocol.

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (flag, fallback = null) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
};

const URL_UNDER_TEST = arg('--url', 'http://localhost:5173');
const KEEP = process.argv.includes('--keep');
const PORT = 9222;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

const VIDEO = /\/hero\/hero\..*\.(webm|mp4)$/;
const POSTER = /\/hero\/hero\..*\.poster\.webp$/;

// --------------------------------------------------------------------- CDP plumbing

let nextId = 1;

const connect = (wsUrl) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const pending = new Map();
    const listeners = [];

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve: settle, reject: fail } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) fail(new Error(message.error.message));
        else settle(message.result);
        return;
      }
      for (const listener of listeners) listener(message);
    });

    socket.addEventListener('error', reject);
    socket.addEventListener('open', () =>
      resolve({
        send: (method, params = {}) =>
          new Promise((settle, fail) => {
            const id = nextId++;
            pending.set(id, { resolve: settle, reject: fail });
            socket.send(JSON.stringify({ id, method, params }));
          }),
        on: (listener) => listeners.push(listener),
        close: () => socket.close(),
      }),
    );
  });

const launchChrome = async (profileDir) => {
  const chrome = spawn(
    CHROME,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profileDir}`,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      // Otherwise headless refuses to autoplay and the "video plays" assertion is
      // untestable — this flag isolates the loading behaviour we actually care about.
      '--autoplay-policy=no-user-gesture-required',
      'about:blank',
    ],
    { stdio: 'ignore', detached: false },
  );

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return chrome;
    } catch {
      // not up yet
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error('Chrome did not expose a debugging port');
};

const newTab = async () => {
  const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, {
    method: 'PUT',
  }).then((response) => response.json());
  return { client: await connect(target.webSocketDebuggerUrl), id: target.id };
};

const closeTab = (id) => fetch(`http://127.0.0.1:${PORT}/json/close/${id}`).catch(() => {});

/**
 * Load the page under one set of conditions and report what was fetched.
 *
 * The two cases need opposite waiting strategies, and conflating them made this harness
 * report failures that were purely its own timing:
 *
 *   expectVideo: true   poll until the video is actually rolling. A fixed sleep races the
 *                       component's requestIdleCallback deferral, so "not loaded yet" was
 *                       indistinguishable from "refused to load".
 *   expectVideo: false  wait out a generous fixed window. There is no event to wait for
 *                       when the correct behaviour is that nothing ever happens.
 */
const probe = async ({
  label, viewport, reducedMotion, throttle, settleMs = 8000, screenshot, expectVideo = false,
}) => {
  const { client, id } = await newTab();
  const requests = [];

  try {
    client.on((message) => {
      if (message.method === 'Network.requestWillBeSent') {
        requests.push({ url: message.params.request.url, at: Date.now() });
      }
    });

    await client.send('Network.enable');
    await client.send('Page.enable');
    // Focus the tab before navigating. A background tab has requestIdleCallback throttled,
    // and the backdrop defers loading through it — so an unfocused tab can sit forever with
    // the video never promoted, which looks exactly like the page correctly declining to
    // load it. Every earlier tab in this run is still open, so this is not optional.
    await client.send('Page.bringToFront');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: Boolean(viewport.mobile),
    });

    if (reducedMotion) {
      await client.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });
    }
    if (throttle) {
      // saveData / effectiveType are what the component reads; CDP can only emulate the
      // transport, so this asserts the connection-speed branch by making it genuinely slow.
      await client.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 400,
        downloadThroughput: (400 * 1024) / 8,
        uploadThroughput: (400 * 1024) / 8,
        connectionType: 'cellular2g',
      });
    }

    await client.send('Page.navigate', { url: URL_UNDER_TEST });

    if (expectVideo) {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const { result } = await client.send('Runtime.evaluate', {
          expression: `(document.querySelector('video')?.currentTime ?? 0)`,
          returnByValue: true,
        });
        if (Number(result.value) > 0.1) break;
        await new Promise((done) => setTimeout(done, 250));
      }
    } else {
      await new Promise((done) => setTimeout(done, settleMs));
    }

    if (screenshot) {
      const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(screenshot, Buffer.from(data, 'base64'));
    }

    const state = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const v = document.querySelector('video');
        if (!v) return JSON.stringify({ present: false });
        return JSON.stringify({
          present: true,
          preload: v.preload,
          paused: v.paused,
          currentTime: v.currentTime,
          readyState: v.readyState,
          poster: v.poster,
          sourcesWithSrc: [...v.querySelectorAll('source')].filter(s => s.src).length,
          sourcesTotal: v.querySelectorAll('source').length,
          heroControls: [...document.querySelectorAll('[data-hero-control]')].map(b => b.dataset.heroControl),
          videoMuted: v.muted,
        });
      })()`,
      returnByValue: true,
    });

    return { label, requests, dom: JSON.parse(state.result.value) };
  } finally {
    client.close();
    await closeTab(id);
  }
};

// ------------------------------------------------------------------------------ run

const profileDir = await mkdtemp(join(tmpdir(), 'hero-verify-'));
let chrome;
const failures = [];

const check = (ok, message, detail = '') => {
  console.log(`  ${ok ? `${c.green}✓` : `${c.red}✗`}${c.reset} ${message}${detail ? ` ${c.dim}${detail}${c.reset}` : ''}`);
  if (!ok) failures.push(message);
};

try {
  await fetch(URL_UNDER_TEST).catch(() => {
    throw new Error(`Nothing serving at ${URL_UNDER_TEST} — start it with: npm run dev`);
  });

  chrome = await launchChrome(profileDir);
  console.log(`\n${c.bold}Verifying hero backdrop${c.reset} ${c.dim}${URL_UNDER_TEST}${c.reset}\n`);

  // 1. Desktop, motion allowed: poster first, then video after idle.
  console.log(`${c.cyan}desktop 1440×900${c.reset}`);
  const desktop = await probe({
    label: 'desktop',
    viewport: { width: 1440, height: 900 },
    screenshot: '/tmp/hero-desktop.png',
    expectVideo: true,
  });
  const posterReq = desktop.requests.find((r) => POSTER.test(r.url));
  const videoReqs = desktop.requests.filter((r) => VIDEO.test(r.url));
  check(Boolean(posterReq), 'poster is requested');
  check(videoReqs.length > 0, 'video loads on desktop', videoReqs.map((r) => r.url.split('/').pop()).join(', '));
  // Must be exactly one. `<= 1` also passes when zero load, which quietly turned a real
  // failure into a green tick.
  check(videoReqs.length === 1, 'exactly one video variant is fetched', `${videoReqs.length} fetched`);
  if (posterReq && videoReqs.length) {
    check(posterReq.at <= videoReqs[0].at, 'poster is requested before the video');
  }
  check(desktop.dom.sourcesTotal === 3, 'three <source> candidates present', `${desktop.dom.sourcesTotal}`);
  check(!desktop.dom.paused && desktop.dom.currentTime > 0, 'video is actually playing', `t=${desktop.dom.currentTime?.toFixed(2)}s`);
  // Both controls, asserted by data attribute rather than by Tailwind class — the old
  // `button[class*="bottom-4"]` selector broke silently when these were wrapped in a
  // positioned container, which is exactly the kind of false green a harness must not have.
  check(
    desktop.dom.heroControls?.includes('playback'),
    'pause control is rendered once the film runs',
    (desktop.dom.heroControls ?? []).join(', ') || 'none',
  );
  check(
    desktop.dom.heroControls?.includes('sound'),
    'sound toggle is rendered once the film runs',
  );
  // v2 ships an audio track, so autoplay is only legal while muted. If this ever flips,
  // Chrome silently refuses to start the film at all.
  check(desktop.dom.videoMuted === true, 'film autoplays muted (required with an audio track)');

  // 2. Mobile: poster only.
  console.log(`\n${c.cyan}mobile 390×844${c.reset}`);
  const mobile = await probe({
    label: 'mobile',
    viewport: { width: 390, height: 844, mobile: true },
    screenshot: '/tmp/hero-mobile.png',
  });
  check(
    mobile.requests.filter((r) => VIDEO.test(r.url)).length === 0,
    'NO video bytes on a mobile viewport',
  );
  check(Boolean(mobile.requests.find((r) => POSTER.test(r.url))), 'poster still loads on mobile');
  check(mobile.dom.sourcesWithSrc === 0, 'no <source> was given a src on mobile');

  // 3. Reduced motion: poster only.
  console.log(`\n${c.cyan}desktop + prefers-reduced-motion${c.reset}`);
  const reduced = await probe({
    label: 'reduced-motion',
    viewport: { width: 1440, height: 900 },
    reducedMotion: true,
  });
  check(
    reduced.requests.filter((r) => VIDEO.test(r.url)).length === 0,
    'NO video bytes when reduced motion is requested',
  );

  // 4. Slow connection.
  console.log(`\n${c.cyan}desktop + emulated 2G${c.reset}`);
  const slow = await probe({
    label: 'slow',
    viewport: { width: 1440, height: 900 },
    throttle: true,
    settleMs: 9000,
  });
  const slowVideo = slow.requests.filter((r) => VIDEO.test(r.url));
  // Chrome's Network domain throttles the transport but does not rewrite
  // navigator.connection, so the component's saveData/effectiveType branch cannot fire
  // here. Reported rather than asserted, so the output does not imply a guarantee it isn't
  // making — the real protection on a metered connection is the saveData check itself.
  console.log(
    `  ${c.yellow}·${c.reset} video on emulated 2G: ${slowVideo.length ? 'fetched' : 'not fetched'} ` +
      `${c.dim}(CDP cannot spoof navigator.connection; informational)${c.reset}`,
  );

  // 5. Contrast spot-check across the cut. The montage swings from bright white studio to
  // near-black violet, so the scrim has to hold the headline legible at both ends. Seeking
  // the video and screenshotting is the only honest way to see it.
  const at = arg('--at', '1.2,3.6,6.0,8.4,11.0')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));

  if (at.length) {
    console.log(`\n${c.cyan}contrast frames${c.reset}`);
    const { client, id } = await newTab();
    try {
      await client.send('Page.enable');
    // Focus the tab before navigating. A background tab has requestIdleCallback throttled,
    // and the backdrop defers loading through it — so an unfocused tab can sit forever with
    // the video never promoted, which looks exactly like the page correctly declining to
    // load it. Every earlier tab in this run is still open, so this is not optional.
    await client.send('Page.bringToFront');
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
      });
      await client.send('Page.navigate', { url: URL_UNDER_TEST });
      await new Promise((done) => setTimeout(done, 6000));

      // Sample while it plays rather than seeking. Seeking looked like it worked —
      // `currentTime` reported the requested value and `seeked` fired — but Chrome kept
      // painting frame 0, because the AV1 WebM is encoded with keyframes only every 5s and
      // carries no useful cue index. Harmless for a background loop that nobody scrubs,
      // fatal for a capture harness that trusts it. So: let it run, screenshot on a wall
      // clock, and record which frame we actually got.
      // Do not touch currentTime, not even to reset it to 0 — on this file any seek wedges
      // the decoder and playback never resumes. Wait for it to be genuinely rolling, then
      // sample against a wall clock.
      let rolling = false;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const { result } = await client.send('Runtime.evaluate', {
          expression: `(document.querySelector('video')?.currentTime ?? 0)`,
          returnByValue: true,
        });
        if (Number(result.value) > 0.1) {
          rolling = true;
          break;
        }
        await new Promise((done) => setTimeout(done, 250));
      }

      // Say so rather than silently emitting identical frames. A stalled review tab and a
      // page that correctly declined to load the video look the same in a screenshot.
      if (!rolling) {
        const { result } = await client.send('Runtime.evaluate', {
          expression: `(() => {
            const v = document.querySelector('video');
            return JSON.stringify({
              paused: v?.paused, readyState: v?.readyState, preload: v?.preload,
              withSrc: v ? [...v.querySelectorAll('source')].filter(s => s.src).length : null,
              err: v?.error?.message ?? null,
            });
          })()`,
          returnByValue: true,
        });
        console.log(`  ${c.yellow}· video never started: ${result.value}${c.reset}`);
      }

      let previous = 0;
      for (const seconds of at.slice().sort((a, b) => a - b)) {
        await new Promise((done) => setTimeout(done, Math.max(0, (seconds - previous) * 1000)));
        previous = seconds;

        const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
        const { result } = await client.send('Runtime.evaluate', {
          expression: `(document.querySelector('video')?.currentTime ?? -1)`,
          returnByValue: true,
        });

        const out = `/tmp/hero-at-${String(seconds).replace('.', '_')}s.png`;
        await writeFile(out, Buffer.from(data, 'base64'));
        console.log(
          `  ${c.green}✓${c.reset} ${String(seconds).padEnd(5)} ` +
            `${c.dim}video t=${Number(result.value).toFixed(2)}s → ${out}${c.reset}`,
        );
      }
    } finally {
      client.close();
      await closeTab(id);
    }
  }

  console.log(`\n${c.dim}screenshots: /tmp/hero-desktop.png /tmp/hero-mobile.png${c.reset}`);
} catch (error) {
  console.error(`\n${c.red}${error.message}${c.reset}\n`);
  failures.push(error.message);
} finally {
  chrome?.kill();
  // Chrome keeps writing to its profile for a moment after SIGTERM, so an immediate rm
  // races it and throws ENOTEMPTY. Give it a beat, and retry rather than fail the run over
  // a temp directory.
  if (!KEEP) {
    await new Promise((done) => setTimeout(done, 500));
    await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(
      () => {},
    );
  }
}

console.log(
  failures.length
    ? `\n${c.red}${c.bold}${failures.length} check(s) failed${c.reset}\n`
    : `\n${c.green}${c.bold}All checks passed${c.reset}\n`,
);
process.exit(failures.length ? 1 : 0);
