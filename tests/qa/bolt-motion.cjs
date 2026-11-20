const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtemp, readFile, writeFile } = require('node:fs/promises');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const { extname, join, resolve, sep } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { CLUES, SAVE_KEY } = require('../../episode.js');
const { appPlayer, ACTIONS } = require('./encounter-app-player.cjs');
const { observeCourse, play } = require('./encounter-player.cjs');

const ROOT = resolve(__dirname, '../..');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };
const KEYS = { ArrowLeft: 37, ArrowRight: 39, Space: 32, ArrowDown: 40, KeyX: 88 };
const SWIPE_FRAMES = 4;

async function launch(profile) {
  const executable = process.env.RUN_VOID_QA_CHROME ?? (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'chromium');
  const chrome = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--mute-audio', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let failure;
  chrome.on('error', (error) => { failure = error; });
  let log = '';
  chrome.stderr.on('data', (data) => {
    log = (log + data).slice(-5000);
    if (process.env.RUN_VOID_QA_VERBOSE) process.stderr.write(data);
  });
  try {
    for (let attempt = 0; attempt < 100 && !failure && chrome.exitCode === null; attempt++) {
      const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split(/\r?\n/)[0];
      if (port) {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const socket = new WebSocket(pages.find(({ type }) => type === 'page').webSocketDebuggerUrl);
        await once(socket, 'open');
        return { chrome, socket };
      }
      await delay(100);
    }
    throw new Error(`Chrome could not start. Set RUN_VOID_QA_CHROME if needed.\n${failure ?? log}`);
  } catch (error) {
    chrome.kill();
    throw error;
  }
}

function connect(socket) {
  let lastId = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const { id, error, result } = JSON.parse(data);
    const command = pending.get(id);
    if (!command) return;
    pending.delete(id);
    if (error) command.reject(new Error(error.message));
    else command.resolve(result);
  });
  socket.addEventListener('close', () => {
    for (const command of pending.values()) command.reject(new Error(`Chrome closed during ${command.method}`));
    pending.clear();
  });
  function call(method, params = {}) {
    const id = ++lastId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, method });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const { result, exceptionDetails } = await call('Runtime.evaluate', { expression, returnByValue: true });
    assert.ok(!exceptionDetails, exceptionDetails?.exception?.description ?? exceptionDetails?.text);
    return result.value;
  }
  async function navigate(url) {
    const loaded = new Promise((resolve) => {
      const listener = ({ data }) => {
        if (JSON.parse(data).method !== 'Page.loadEventFired') return;
        socket.removeEventListener('message', listener);
        resolve();
      };
      socket.addEventListener('message', listener);
    });
    const result = await call('Page.navigate', { url });
    assert.ok(!result.errorText, result.errorText);
    await loaded;
  }
  return { call, evaluate, navigate };
}

// Drive the app's regular frame callback on the same clock as the route planner.
// Record a rendered bolt's actual Canvas gradient center without changing how it is drawn.
function playback(checkpointKey, checkpoint) {
  localStorage.clear();
  localStorage.setItem(checkpointKey, JSON.stringify(checkpoint));
  let nextFrame;
  let frame = 0;
  let run;
  let drawing = false;
  let glyphs = [];
  window.requestAnimationFrame = (callback) => { nextFrame = callback; };
  Object.defineProperty(window, 'VoidScene', {
    configurable: true,
    set(Scene) {
      Object.defineProperty(window, 'VoidScene', {
        value: class extends Scene {
          draw(active, ...args) {
            run = active;
            if (!drawing) return;
            glyphs = [];
            super.draw(active, ...args);
          }

          bolt(bolt, z, time, reducedMotion) {
            const gradient = this.ctx.createRadialGradient;
            this.ctx.createRadialGradient = (...args) => {
              const world = VoidRunner.boltPositionAt(bolt, time, reducedMotion);
              const expected = this.screenPoint(this.viewPoint([world.x, world.y, z]));
              glyphs.push({ id: bolt.id, time, reducedMotion, world, screen: args.slice(0, 2), expected });
              return gradient.apply(this.ctx, args);
            };
            try {
              super.bolt(bolt, z, time, reducedMotion);
            } finally {
              this.ctx.createRadialGradient = gradient;
            }
          }
        },
      });
    },
  });
  window.boltQA = {
    advance(until, capture = false) {
      while (frame < until) {
        drawing = capture && frame + 1 === until;
        nextFrame(frame++ * 1000 / 60);
      }
      return { glyphs, time: run.time, boltTime: run.boltTime, distance: run.distance, count: run.boltsCollected,
        height: run.height, lane: run.lane, crash: run.crash?.type ?? null, mode: document.body.dataset.mode,
        reducedMotion: run.reducedMotion, touch: document.body.dataset.touch, hud: document.querySelector('#bolts').textContent };
    },
  };
}

function plan(runner, courses, config) {
  const player = appPlayer(runner, { ...config, swipeFrames: SWIPE_FRAMES });
  const samples = [];
  let captureId;
  let pickup;
  const events = player.run.onEvent;
  player.run.onEvent = (name, bolt) => {
    if (name === 'bolt' && bolt.id === captureId && !pickup) {
      pickup = { time: player.run.time, height: player.run.height, frame: player.frames };
    }
    events(name, bolt);
  };
  const routePlayer = { ...player, step() {
    player.step();
    const { run } = player;
    const bolt = run.bolts.find(({ height }) => height > 2);
    if (bolt && captureId === undefined) captureId = bolt.id;
    if (bolt?.id === captureId && bolt) {
      samples.push({ frame: player.frames, remaining: (bolt.z - run.distance) / run.speed });
    }
  } };
  play(routePlayer, courses, 12, { ...runner, boost: false, forkGate: false });
  assert.ok(pickup, 'The seeded route must collect the generated elevated bolt');
  const captures = [0.58, 0.33, 0.07].map((eta) => samples.find(({ remaining }) => remaining <= eta).frame);
  return { player, captureId, pickup, captures };
}

async function replay(browser, origin, output, runner, courses, config) {
  const { touch, discoveredClues, seed, reduced, host } = config;
  const { player, captureId, pickup, captures } = plan(runner, courses, config);
  if (host === 'platform') assert.equal(pickup.height, runner.PLATFORM_HEIGHT);
  else assert.ok(pickup.height > 0.71);
  await browser.call('Emulation.setDeviceMetricsOverride', {
    width: touch ? 390 : 960, height: touch ? 844 : 620, deviceScaleFactor: 1, mobile: touch,
  });
  await browser.call('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 1 });
  await browser.call('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }],
  });
  const checkpoint = { version: 2, discoveredClues, meters: CLUES[discoveredClues - 1].meters, bolts: 0 };
  const { identifier } = await browser.call('Page.addScriptToEvaluateOnNewDocument', {
    source: `(${playback})(${JSON.stringify(SAVE_KEY + ':v2:checkpoint')}, ${JSON.stringify(checkpoint)})`,
  });
  await browser.navigate(`${origin}/?seed=${seed}`);
  await browser.call('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  await browser.evaluate("document.querySelector('#start').click()");
  const prefix = `${touch ? 'touch' : 'keyboard'}-${host}${reduced ? '-reduced' : ''}`;
  const positions = [];
  let lastFrame = 0;
  const step = async (frame, draw = false) => {
    const state = await browser.evaluate(`boltQA.advance(${frame}, ${draw})`);
    lastFrame = frame;
    assert.equal(state.crash, null, `${prefix} crashed at frame ${frame}`);
    assert.equal(state.mode, 'running');
    assert.equal(state.reducedMotion, reduced);
    return state;
  };
  const screenshot = async (suffix) => {
    const { data } = await browser.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(output, `${prefix}-${suffix}.png`), Buffer.from(data, 'base64'));
  };
  await step(1);
  const center = await browser.evaluate(`(() => {
    const rect = document.querySelector('#swipe-field').getBoundingClientRect();
    return { x: rect.left + rect.width * 0.45, y: rect.top + rect.height * 0.57 };
  })()`);
  async function advance(until) {
    for (const frame of [...captures, pickup.frame]) {
      if (frame <= lastFrame || frame > until) continue;
      const state = await step(frame, true);
      const glyph = state.glyphs.find(({ id }) => id === captureId);
      if (frame === pickup.frame) {
        assert.equal(glyph, undefined);
        assert.ok(state.count > 0);
        assert.equal(Number(state.hud), state.count);
        await screenshot('collected');
        continue;
      }
      assert.ok(glyph, `Generated bolt missing from ${prefix} rendering`);
      assert.equal(glyph.time, state.boltTime);
      assert.equal(glyph.reducedMotion, state.reducedMotion);
      assert.deepEqual(glyph.screen, glyph.expected);
      positions.push(glyph.world);
      await screenshot(positions.length);
    }
    return step(until);
  }
  for (const { action, frame } of player.inputs) {
    await advance(frame);
    const [direction, code] = ACTIONS[action];
    if (touch) {
      const vertical = action === 'jump' || action === 'slide';
      const start = { ...center, id: 1 };
      await browser.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
      await advance(frame + SWIPE_FRAMES);
      const end = { id: 1, x: start.x + (vertical ? 0 : 42 * direction), y: start.y + (vertical ? 42 * direction : 0) };
      await browser.call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
      await advance(frame + SWIPE_FRAMES + 1);
      await browser.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      const event = { code, key: code === 'Space' ? ' ' : code, windowsVirtualKeyCode: KEYS[code] };
      await browser.call('Input.dispatchKeyEvent', { ...event, type: 'rawKeyDown' });
      await browser.call('Input.dispatchKeyEvent', { ...event, type: 'keyUp' });
    }
  }
  const state = await advance(player.frames);
  assert.ok(Math.abs(state.distance - player.run.distance) < 0.01);
  assert.equal(state.lane, player.run.lane);
  assert.equal(state.count, player.run.boltsCollected);
  assert.ok(state.count > 0);
  assert.equal(Number(state.hud), state.count);
  assert.equal(state.touch, touch ? 'true' : 'false');
  assert.equal(positions.length, captures.length);
  if (reduced) {
    assert.ok(positions.every(({ x, y }) => x === positions[0].x && y === positions[0].y));
  } else {
    for (const axis of ['x', 'y']) {
      const coordinates = positions.map((point) => point[axis]);
      assert.ok(Math.max(...coordinates) - Math.min(...coordinates) > 0.12, `${prefix} shows little ${axis} motion`);
    }
  }
  await browser.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide'))");
  const paused = await step(player.frames + 24);
  assert.equal(paused.boltTime, state.boltTime);
  assert.equal(paused.distance, state.distance);
  const banked = await browser.evaluate('new VoidEpisode.EpisodeProgress({ storage: localStorage }).bankedBolts');
  assert.equal(banked, state.count);
  if (!touch) {
    await browser.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow'))");
    const until = player.frames + 2400;
    const ended = await browser.evaluate(`boltQA.advance(${until})`);
    assert.equal(ended.mode, 'ended');
    await browser.evaluate("document.querySelector('#restart').click()");
    const restarted = await step(until + 1);
    assert.equal(restarted.boltTime, 0);
    assert.equal(restarted.count, 0);
  }
  console.log(`${prefix} seed ${seed}, caught at ${pickup.time.toFixed(3)}s and ${pickup.height.toFixed(2)}m, ${JSON.stringify(positions)}`);
}

async function main() {
  const output = await mkdtemp(join(tmpdir(), 'run-void-bolt-motion-'));
  const profile = await mkdtemp(join(tmpdir(), 'run-void-bolt-chrome-'));
  const server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url, 'http://127.0.0.1');
    const file = resolve(ROOT, '.' + (pathname === '/' ? '/index.html' : pathname));
    const type = MIME[extname(file)];
    const body = type && file.startsWith(ROOT + sep) ? await readFile(file).catch(() => null) : null;
    if (body) response.writeHead(200, { 'Content-Type': type }).end(body);
    else response.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let instance;
  try {
    instance = await launch(profile);
    const browser = connect(instance.socket);
    await browser.call('Page.enable');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const { runner, courses } = observeCourse();
    const touch = { touch: true, discoveredClues: 2, seed: 42, host: 'platform', reduced: false };
    const keyboard = { touch: false, discoveredClues: 1, seed: 101, host: 'hurdle', reduced: false };
    for (const config of [keyboard, touch, { ...touch, reduced: true }]) {
      await replay(browser, origin, output, runner, courses, config);
    }
    console.log(output);
  } finally {
    instance?.socket.close();
    instance?.chrome.kill();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
