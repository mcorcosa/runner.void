const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createReadStream, existsSync } = require('node:fs');
const { mkdtemp, readFile } = require('node:fs/promises');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const { extname, join, resolve, sep } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const root = resolve(__dirname, '../..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const chrome = process.env.RUN_VOID_QA_CHROME ??
  (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'chromium');

function setup() {
  let frame;
  let now = 0;
  let run;
  window.requestAnimationFrame = (callback) => { frame = callback; };
  Object.defineProperty(window, 'VoidRunner', {
    configurable: true,
    set(api) {
      Object.defineProperty(window, 'VoidRunner', { value: { ...api, Run: class extends api.Run {
        constructor(options) {
          super(options);
          run = this;
        }
      } } });
    },
  });
  Object.defineProperty(window, 'VoidEpisode', {
    configurable: true,
    set(api) {
      localStorage.clear();
      const migrated = new URLSearchParams(location.search).has('migrated');
      const key = api.SAVE_KEY + (migrated ? ':v2:checkpoint' : ':v4:checkpoint');
      const save = migrated ? { version: 2, meters: 90000, bolts: 2, discoveredClues: 4 } :
        { version: 4, generation: null, meters: 270000, bolts: 2, heard: api.CLUES.map(({ id }) => id) };
      localStorage.setItem(key, JSON.stringify(save));
      Object.defineProperty(window, 'VoidEpisode', { value: api });
    },
  });
  window.relayQA = {
    step(count) {
      for (let index = 0; index < count; index++) {
        now += 1000 / 60;
        frame(now);
      }
    },
    finish() {
      document.querySelector('#mute').click();
      document.querySelector('#start').click();
      run.obstacles.length = 0;
      run.addObstacle(8, run.lane, 'barrier');
      this.step(260);
      return document.body.dataset.mode;
    },
    snapshot() {
      const card = document.querySelector('.result-card');
      const sky = document.querySelector('#sky-signal');
      const rect = (element) => element.getBoundingClientRect().toJSON();
      return {
        mode: document.body.dataset.mode,
        stage: document.body.dataset.signal,
        invert: document.body.dataset.signalInvert,
        filter: getComputedStyle(document.querySelector('canvas')).filter,
        movingCaption: getComputedStyle(sky).animationName,
        muted: document.querySelector('#mute').getAttribute('aria-pressed'),
        focus: document.activeElement.id,
        card: rect(card), sky: rect(sky), text: sky.innerText,
        runway: rect(document.querySelector('#restart')),
        buttons: Array.from(card.querySelectorAll('.replay:not([hidden])'), (button) => ({
          ...rect(button), id: button.id, pressed: button.getAttribute('aria-pressed'),
        })),
      };
    },
  };
}

async function connect(profile, child) {
  let port;
  let spawnError;
  child.once('error', (error) => { spawnError = error; });
  for (let attempt = 0; attempt < 100 && child.exitCode === null && !spawnError; attempt++) {
    port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split(/\r?\n/)[0];
    if (port) break;
    await delay(100);
  }
  if (spawnError) throw spawnError;
  assert.ok(port, 'Chromium did not start. Set RUN_VOID_QA_CHROME to a browser executable.');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  const socket = new WebSocket(pages.find(({ type }) => type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open', { signal: AbortSignal.timeout(5000) });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const { id, result, error } = JSON.parse(data);
    const command = pending.get(id);
    if (!command) return;
    pending.delete(id);
    clearTimeout(command.timeout);
    if (error) command.reject(new Error(error.message));
    else command.resolve(result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Chromium did not answer ${method}`));
    }, 5000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await call('Runtime.evaluate', { expression, returnByValue: true });
    assert.equal(exceptionDetails, undefined, exceptionDetails?.exception?.description);
    return result.value;
  };
  const navigate = async (url) => {
    const loaded = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.removeEventListener('message', listener);
        reject(new Error(`Chromium did not finish loading ${url}`));
      }, 10000);
      const listener = ({ data }) => {
        if (JSON.parse(data).method !== 'Page.loadEventFired') return;
        clearTimeout(timeout);
        socket.removeEventListener('message', listener);
        resolve();
      };
      socket.addEventListener('message', listener);
    });
    const [result] = await Promise.all([call('Page.navigate', { url }), loaded]);
    assert.ok(!result.errorText, result.errorText);
  };
  return { call, evaluate, navigate, close: () => socket.close() };
}

async function main() {
  const profile = await mkdtemp(join(tmpdir(), 'run-void-relay-nine-'));
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    const type = types[extname(file)];
    if (!file.startsWith(root + sep) || !type || !existsSync(file)) return response.writeHead(404).end();
    response.setHeader('Content-Type', type);
    createReadStream(file).pipe(response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', process.env.RUN_VOID_QA_VERBOSE ? 'inherit' : 'ignore'], windowsHide: true });
  let browser;
  try {
    browser = await connect(profile, child);
    const { call, evaluate, navigate } = browser;
    await call('Page.enable');
    await call('Page.addScriptToEvaluateOnNewDocument', { source: `(${setup})()` });
    await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    for (const [width, height, migrated] of [[320, 568, true], [390, 620, false], [667, 375, false], [568, 320, false]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
      await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await navigate(`${origin}/?seed=187${migrated ? '&migrated' : ''}`);
      assert.equal(await evaluate('relayQA.finish()'), 'ended');
      const original = await evaluate('relayQA.snapshot()');
      assert.deepEqual(original.buttons.map(({ id }) => id), (migrated ? [1, 2, 3, 5] : [1, 2, 3, 4, 5, 6, 7, 8, 9])
        .map((ordinal) => `replay-${ordinal}`));
      assert.equal(original.focus, 'restart');
      const cue = migrated ? 5 : 9;
      const target = original.buttons.at(-1);
      assert.ok(original.buttons.every((button) => button.height >= 44 && button.width >= 44));
      assert.ok(target.bottom <= original.card.bottom && target.right <= original.card.right,
        `Replay ${cue} is clipped at ${width}×${height}`);
      await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: target.x + target.width / 2, y: target.y + 20 }] });
      await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await evaluate('relayQA.step(82)');
      const playing = await evaluate('relayQA.snapshot()');
      assert.equal(playing.mode, 'ended');
      assert.equal(playing.muted, 'true');
      assert.equal(playing.buttons.at(-1).pressed, 'true');
      assert.equal(playing.stage, '4');
      assert.equal(playing.invert, 'false');
      assert.equal(playing.filter, 'none');
      assert.equal(playing.movingCaption, 'none');
      assert.equal(playing.text, migrated ? 'Still there. Looks like a beacon. We need to reach it' :
        'We MUST reach it.\nFind out who sent this.');
      assert.ok(playing.sky.x >= 0 && playing.sky.right <= width && playing.sky.bottom <= height);
      assert.ok(playing.sky.bottom <= playing.card.top || playing.sky.left >= playing.card.right,
        `Caption overlaps the card at ${width}×${height}`);
      assert.ok(playing.runway.top >= playing.card.top && playing.runway.bottom <= playing.card.bottom);
      assert.ok(playing.buttons.every(({ bottom, left, right, top }) =>
        top >= playing.card.top && bottom <= playing.card.bottom && left >= playing.card.left && right <= playing.card.right));
      for (const [key, code, keyCode, text] of [['Enter', 'Enter', 13, '\r'], [' ', 'Space', 32, ' ']]) {
        await evaluate(`document.getElementById('replay-${cue}').focus()`);
        await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, text });
        await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
        assert.equal((await evaluate('relayQA.snapshot()')).buttons.at(-1).pressed, code === 'Space' ? 'true' : 'false');
      }
      const restarted = await evaluate('relayQA.snapshot()');
      assert.equal(restarted.buttons.at(-1).pressed, 'true');
      assert.equal(restarted.focus, `replay-${cue}`);
      await evaluate("document.getElementById('restart').click()");
      assert.equal((await evaluate('relayQA.snapshot()')).mode, 'running');
      console.log(`${width}×${height} ${migrated ? 'migrated' : 'complete'} replay passed`);
    }
  } finally {
    browser?.close();
    child.kill();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
