const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { existsSync, createReadStream } = require('node:fs');
const { mkdtemp, readFile } = require('node:fs/promises');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const { extname, join, resolve, sep } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { SAVE_KEY, CLUES } = require('../../episode.js');
const { appPlayer, ACTIONS } = require('./encounter-app-player.cjs');
const { observeCourse, play } = require('./encounter-player.cjs');

const ROOT = resolve(__dirname, '../..');
const checkpointKey = SAVE_KEY + ':v2:checkpoint';
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };

async function serve(port) {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/__qa_setup') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<title>Disposable course verification</title>');
      return;
    }
    const file = resolve(ROOT, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(ROOT + sep) || !mime[extname(file)] || !existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', mime[extname(file)]);
    createReadStream(file).pipe(response);
  });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function openChrome(visible) {
  const exe = process.env.RUN_VOID_QA_CHROME ??
    'C:/Program Files/Google/Chrome/Application/chrome.exe';
  assert.ok(existsSync(exe), 'Set RUN_VOID_QA_CHROME to a Chrome or Chromium executable');
  const profile = await mkdtemp(join(tmpdir(), 'run-void-chrome-'));
  const args = [`--user-data-dir=${profile}`, '--remote-debugging-port=0',
    '--no-first-run', '--no-default-browser-check', '--mute-audio', 'about:blank'];
  if (!visible) args.unshift('--headless=new', '--disable-gpu');
  const chrome = spawn(exe, args, { windowsHide: !visible, stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = once(chrome, 'exit');
  if (process.env.RUN_VOID_QA_VERBOSE) chrome.stderr.pipe(process.stderr);
  else chrome.stderr.resume();
  try {
    for (let attempt = 0; attempt < 100 && chrome.exitCode === null; attempt++) {
      const marker = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => null);
      if (marker) {
        const [port] = marker.split(/\r?\n/);
        const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = tabs.find(({ type }) => type === 'page');
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await once(socket, 'open');
        return { chrome, exited, profile, socket };
      }
      await delay(100);
    }
    throw new Error(`Chrome did not open a debug port for ${profile}`);
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
    for (const command of pending.values()) command.reject(new Error(`Chrome closed the QA connection during ${command.method}`));
    pending.clear();
  });

  async function call(method, params = {}) {
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
      const onEvent = ({ data }) => {
        if (JSON.parse(data).method !== 'Page.loadEventFired') return;
        socket.removeEventListener('message', onEvent);
        resolve();
      };
      socket.addEventListener('message', onEvent);
    });
    const result = await call('Page.navigate', { url });
    assert.ok(!result.errorText, result.errorText);
    await loaded;
  }
  return { call, evaluate, navigate };
}

async function fixture(browser, origin, discoveredClues) {
  await browser.navigate(origin + '/__qa_setup');
  await browser.evaluate('localStorage.clear()');
  if (discoveredClues) {
    const checkpoint = { version: 2, discoveredClues, meters: CLUES[discoveredClues - 1].meters, bolts: 0 };
    await browser.evaluate(`localStorage.setItem(${JSON.stringify(checkpointKey)}, ${JSON.stringify(JSON.stringify(checkpoint))})`);
  }
}

function virtualFrames(drawEvery) {
  let callback;
  let frame = 0;
  let run;
  window.requestAnimationFrame = (next) => { callback = next; };
  // Observe the game through the scene's normal input, and advance its ordinary 60 Hz frame callback.
  Object.defineProperty(window, 'VoidScene', {
    configurable: true,
    set(Scene) {
      Object.defineProperty(window, 'VoidScene', {
        value: class extends Scene {
          draw(activeRun, ...args) {
            run = activeRun;
            if (frame % drawEvery === 0) super.draw(activeRun, ...args);
          }
        },
      });
    },
  });
  window.qaFrame = (until) => {
    while (frame < until) callback(frame++ * 1000 / 60);
    return { time: run.time, speed: run.baseSpeed, mode: document.body.dataset.mode,
      distance: run.distance, lane: run.lane, crash: run.crash?.type ?? null };
  };
}

const KEYS = { ArrowLeft: 37, ArrowRight: 39, Space: 32, ArrowDown: 40, KeyX: 88 };

async function replay(browser, origin, player, config) {
  const { discoveredClues, touch, late, seed, scenario, pace, swipeFrames } = config;
  await fixture(browser, origin, discoveredClues);
  await browser.call('Emulation.setDeviceMetricsOverride', {
    width: touch ? 390 : 960, height: touch ? 844 : 620, deviceScaleFactor: 1, mobile: touch,
  });
  await browser.call('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 1 });
  const { identifier } = await browser.call('Page.addScriptToEvaluateOnNewDocument', {
    source: `(${virtualFrames})(${late ? 30 : 1})`,
  });
  const query = new URLSearchParams({ seed });
  if (scenario) query.set('scenario', scenario);
  if (pace) query.set('pace', pace);
  await browser.navigate(`${origin}/?${query}`);
  await browser.call('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  await browser.evaluate("document.querySelector('#start').click()");
  const live = await browser.evaluate('qaFrame(1)');
  assert.equal(live.mode, 'running');
  assert.equal(live.speed, scenario ? 176 : [48, 80, 112, 144, 176][discoveredClues]);
  const center = touch ? await browser.evaluate(`(() => {
    const rect = document.querySelector('#swipe-field').getBoundingClientRect();
    return { x: rect.left + rect.width * 0.45, y: rect.top + rect.height * 0.57 };
  })()`) : null;
  async function frames(until) {
    const state = await browser.evaluate(`qaFrame(${until})`);
    assert.equal(state.crash, null, `Crash at frame ${until}: ${JSON.stringify({ state, config })}`);
    return state;
  }
  for (const { action, frame } of player.inputs) {
    await frames(frame);
    const [direction, code] = ACTIONS[action];
    if (touch) {
      const vertical = action === 'jump' || action === 'slide';
      const start = { ...center, id: 1 };
      await browser.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
      await frames(frame + swipeFrames);
      const end = { id: 1, x: start.x + (vertical ? 0 : 42 * direction),
        y: start.y + (vertical ? 42 * direction : 0) };
      await browser.call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
      await frames(frame + swipeFrames + 1);
      await browser.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      const event = { code, key: code === 'Space' ? ' ' : code, windowsVirtualKeyCode: KEYS[code] };
      await browser.call('Input.dispatchKeyEvent', { ...event, type: 'rawKeyDown' });
      await browser.call('Input.dispatchKeyEvent', { ...event, type: 'keyUp' });
    }
  }
  const state = await frames(player.frames);
  assert.ok(Math.abs(state.distance - player.run.distance) < 0.01, 'Replay follows the same physics as the planned route');
  assert.equal(state.lane, player.run.lane);
  console.log(`${query} • save ${discoveredClues} • ${touch ? 'touch' : 'keyboard'} • ${state.time.toFixed(1)}s • ${state.speed.toFixed(1)}m/s`);
}

async function main() {
  const args = process.argv.slice(2);
  const serving = args[0] === '--serve';
  const manual = args[0] === '--manual';
  const late = args[0] === '--late';
  const { server, origin } = await serve(serving ? Number(args[1] ?? 8774) : 0);
  if (serving) {
    console.log(origin);
    return;
  }
  let instance;
  try {
    instance = await openChrome(manual);
    console.log(`Disposable profile ${instance.profile}`);
    const browser = connect(instance.socket);
    await browser.call('Page.enable');
    if (manual) {
      const discoveredClues = Number(args[1] ?? 0);
      assert.ok(Number.isInteger(discoveredClues) && discoveredClues >= 0 && discoveredClues <= 4);
      await fixture(browser, origin, discoveredClues);
      await browser.navigate(`${origin}/?seed=${Number(args[2] ?? 187)}`);
      console.log(`Play in the separate Chrome window, then close it to stop ${origin}`);
      await instance.exited;
      return;
    }

    const { courses, runner } = observeCourse();
    const launches = late ? [4] : [0, 1, 2, 3, 4];
    const modes = [{ seed: 187, touch: false }, { seed: late ? 187 : 42, touch: true, swipeFrames: 4 }];
    const configs = launches.flatMap((discoveredClues) => modes.map((mode) => ({ ...mode, discoveredClues, late })));
    if (!late) configs.push(...modes.map((mode) => ({ ...mode, discoveredClues: 4, scenario: 'challenge', pace: 'fast' })));
    for (const config of configs) {
      const player = appPlayer(runner, config);
      const route = play(player, courses, config.late ? 248 : 26, {
        ...runner, boost: !config.touch, sweepRefuge: config.touch && !config.late,
        forkGate: config.touch, boostCrossing: config.late,
      });
      if (late) assert.ok(route.passed.some(({ speed, name, boostedGate }) => speed >= 572 && name === 'duck-cross-duck' && boostedGate));
      await replay(browser, origin, player, config);
    }
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
