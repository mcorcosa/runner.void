const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtemp, readFile, writeFile } = require('node:fs/promises');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const { extname, join, resolve, sep } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const root = resolve(process.argv[2] ?? join(__dirname, '../..'));
const sceneFile = process.argv[3] && resolve(process.argv[3]);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const layouts = [
  ['desktop', 960, 620, false], ['portrait', 390, 844, true], ['landscape', 844, 390, true],
];

async function launch(profile) {
  const chromium = process.env.RUN_VOID_QA_CHROME ??
    (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'chromium');
  const child = spawn(chromium, ['--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true });
  let failure;
  child.on('error', (error) => { failure = error; });
  child.stderr.resume();
  try {
    for (let attempt = 0; attempt < 100 && !failure && child.exitCode === null; attempt++) {
      const [port] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split(/\r?\n/);
      if (port) {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const socket = new WebSocket(pages.find(({ type }) => type === 'page').webSocketDebuggerUrl);
        await once(socket, 'open');
        return { child, socket };
      }
      await delay(100);
    }
    throw failure ?? new Error('Chrome failed to start. Set RUN_VOID_QA_CHROME if needed.');
  } catch (error) {
    child.kill();
    throw error;
  }
}

function connect(socket) {
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const { reject } of pending.values()) reject(new Error('Chrome closed during capture'));
    pending.clear();
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

// The live page still owns input, simulation, canvas drawing and the death timeline.
function playback() {
  const speed = Number(new URLSearchParams(location.search).get('qaSpeed'));
  let request;
  let frame = 0;
  let current;
  let measuring = false;
  let track;
  window.requestAnimationFrame = (callback) => { request = callback; };
  if (speed) Object.defineProperty(window, 'VoidRunner', {
    configurable: true,
    set(api) {
      Object.defineProperty(window, 'VoidRunner', { value: { ...api, Run: class extends api.Run {
        constructor(options) {
          super(options);
          this.baseSpeed = this.speed = speed;
          this.addObstacle(Math.ceil(speed * 1.9), 2, 'hurdle');
          // At capture, the first cut straddles the old horizon and the second is entirely beyond it.
          this.addClosure(this.viewDistance * .93, 0, this.viewDistance * .53);
          this.addClosure(this.viewDistance * 1.9, 4, this.viewDistance * 1.3);
        }
      } } });
    },
  });
  Object.defineProperty(window, 'VoidScene', {
    configurable: true,
    set(Scene) {
      Object.defineProperty(window, 'VoidScene', { value: class extends Scene {
        draw(run, time, dt, mode, clue, signal, death) {
          current = { run, scene: this, mode, death };
          super.draw(run, time, dt, mode, clue, signal, death);
        }
        track(run, ready) {
          if (!measuring) return super.track(run, ready);
          const { ctx, width, height, horizon } = this;
          const top = Math.floor(horizon);
          const depth = Math.min(96, height - top);
          const pixels = () => ctx.getImageData(0, top, width, depth).data;
          const before = pixels();
          const original = this.face;
          let faces = 0;
          this.face = (...args) => { faces++; return original.call(this, ...args); };
          try {
            super.track(run, ready);
          } finally {
            this.face = original;
          }
          const after = pixels();
          let visibleY = null;
          for (let y = 0; y < depth && visibleY === null; y++) {
            let changed = 0;
            for (let x = 0; x < width; x++) {
              const at = (y * width + x) * 4;
              if (Math.max(Math.abs(after[at] - before[at]), Math.abs(after[at + 1] - before[at + 1]),
                Math.abs(after[at + 2] - before[at + 2])) >= 10) changed++;
            }
            if (changed >= 2) visibleY = y + top;
          }
          const cutoffY = this.screenPoint(this.viewPoint([0, 0, this.viewDistance]))[1];
          track = { horizon, cutoffY, visibleY, faces, distance: run.distance, viewDistance: this.viewDistance,
            cuts: run.obstacles.filter(({ type }) => type === 'gap').map(({ lane, z, end }) => ({ lane, z, end })) };
        }
      } });
    },
  });
  const step = () => request(frame++ * 1000 / 60);
  window.trackQA = {
    sample(stage) {
      if (stage === 'entry') {
        document.querySelector('#start').click();
        for (let i = 0; i < 18; i++) step();
      } else {
        for (let i = 0; i < 340 && (current.death?.elapsed ?? 0) < 3.05; i++) step();
      }
      const sampleDistance = current.run.distance;
      measuring = true;
      step();
      measuring = false;
      const { mode, run, death, scene } = current;
      const thought = document.querySelector('#death-thought');
      const shade = document.querySelector('#death-shade');
      return { ...track, mode, speed: run.speed, elapsed: death?.elapsed, impact: run.crash?.type,
        thought: thought.textContent, shade: shade.style.opacity, filter: getComputedStyle(shade).backdropFilter,
        frozen: run.distance === sampleDistance, results: !document.querySelector('.results').hidden, reduced: scene.reduceMotion,
        viewport: [scene.width, scene.height] };
    },
  };
}

async function main() {
  const output = await mkdtemp(join(tmpdir(), 'run-void-track-'));
  const profile = await mkdtemp(join(tmpdir(), 'run-void-track-chrome-'));
  const server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url, 'http://127.0.0.1');
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    const type = mime[extname(file)];
    if (!type || !file.startsWith(root + sep)) return response.writeHead(404).end();
    try {
      const contents = await readFile(pathname === '/scene.js' && sceneFile ? sceneFile : file);
      response.writeHead(200, { 'Content-Type': type }).end(contents);
    } catch {
      response.writeHead(404).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let instance;
  const report = {};
  try {
    instance = await launch(profile);
    const call = connect(instance.socket);
    await call('Page.enable');
    await call('Page.addScriptToEvaluateOnNewDocument', { source: `(${playback})()` });
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const [layout, width, height, mobile] of layouts) {
      const portrait = layout === 'portrait';
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile,
        screenOrientation: { type: portrait ? 'portraitPrimary' : 'landscapePrimary', angle: mobile && !portrait ? 90 : 0 } });
      await call('Emulation.setTouchEmulationEnabled', { enabled: mobile });
      for (const reduced of [false, true]) {
        await call('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }],
        });
        for (const speed of [48, 720]) {
          const loaded = new Promise((resolve) => {
            const listener = ({ data }) => {
              if (JSON.parse(data).method !== 'Page.loadEventFired') return;
              instance.socket.removeEventListener('message', listener);
              resolve();
            };
            instance.socket.addEventListener('message', listener);
          });
          const scenario = speed === 48 ? '' : `&scenario=landing&qaSpeed=${speed}`;
          const navigation = await call('Page.navigate', { url: `${origin}/?seed=187${scenario}` });
          assert.ok(!navigation.errorText, navigation.errorText);
          await loaded;
          for (const stage of ['entry', 'lore']) {
            const result = await call('Runtime.evaluate', { expression: `trackQA.sample('${stage}')`, returnByValue: true });
            assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description);
            const state = result.result.value;
            assert.deepEqual(state.viewport, [width, height]);
            assert.equal(state.reduced, reduced);
            assert.equal(state.mode, stage === 'entry' ? 'running' : 'dying', JSON.stringify(state));
            assert.ok(state.speed >= speed && state.speed < speed + 5);
            assert.equal(state.frozen, stage === 'lore');
            if (stage === 'entry' && speed === 720) {
              const seam = state.distance + state.viewDistance;
              assert.ok(state.cuts.some(({ z, end }) => z < seam && end > seam));
              assert.ok(state.cuts.some(({ z }) => z > seam));
            }
            if (stage === 'lore') {
              assert.equal(state.impact, 'hurdle');
              assert.ok(state.thought.trim());
              assert.equal(state.shade, '1');
              assert.match(state.filter, /brightness\(/);
              assert.equal(state.results, false);
            }
            const name = `${layout}-${speed}-${reduced ? 'reduced' : 'motion'}-${stage}`;
            const { data } = await call('Page.captureScreenshot', { format: 'png' });
            await writeFile(join(output, `${name}.png`), Buffer.from(data, 'base64'));
            report[name] = state;
          }
        }
      }
    }
    await writeFile(join(output, 'metrics.json'), JSON.stringify(report, null, 2));
    console.log(output);
  } finally {
    instance?.socket.close();
    instance?.child.kill();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
