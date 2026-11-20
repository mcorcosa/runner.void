const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { existsSync } = require('node:fs');
const { mkdtemp, readFile, writeFile } = require('node:fs/promises');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const { extname, join, resolve, sep } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const root = resolve(__dirname, '../..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const hazards = ['hurdle', 'barrier', 'movingBarrier', 'slideGate', 'spikes', 'gap', 'platform'];
const samples = [.08, .26, .52, .78];
const layouts = [
  { name: 'portrait', width: 390, height: 844, touch: true },
  { name: 'landscape', width: 844, height: 390, touch: true },
  { name: 'desktop', width: 960, height: 620, touch: false },
];
const filterCases = {
  portrait: { 48: { hazard: 'gap', reduced: false }, 720: { hazard: 'slideGate', reduced: true } },
  landscape: { 48: { hazard: 'barrier', reduced: true }, 720: { hazard: 'gap', reduced: false } },
};

async function launch(profile) {
  const chromium = process.env.RUN_VOID_QA_CHROME ??
    (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'chromium');
  const child = spawn(chromium, ['--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let failure;
  child.on('error', (error) => { failure = error.message; });
  let log = '';
  child.stderr.on('data', (data) => {
    log = (log + data).slice(-5000);
    if (process.env.RUN_VOID_QA_VERBOSE) process.stderr.write(data);
  });
  try {
    for (let attempt = 0; attempt < 100 && !failure && child.exitCode === null; attempt++) {
      const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split(/\r?\n/)[0];
      if (port) {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const socket = new WebSocket(pages.find((page) => page.type === 'page').webSocketDebuggerUrl);
        await once(socket, 'open');
        return { child, socket };
      }
      await delay(100);
    }
    throw new Error(`Chrome failed to start. Set RUN_VOID_QA_CHROME if needed.\n${failure ?? log}`);
  } catch (error) {
    child.kill();
    throw error;
  }
}

function connect(socket) {
  let lastId = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const { id, result, error } = JSON.parse(data);
    const command = pending.get(id);
    if (!command) return;
    pending.delete(id);
    if (error) command.reject(new Error(error.message));
    else command.resolve(result);
  });
  socket.addEventListener('close', () => {
    for (const { reject, method } of pending.values()) reject(new Error(`Chrome closed during ${method}`));
    pending.clear();
  });
  function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++lastId;
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

// This runs only in the disposable local browser. The stock frame callback, tick,
// crash dispatch, draw and results sequence still run through the app entry point.
function playback() {
  let request;
  let frame = 0;
  let course;
  let current;
  let sheet;
  const stagedThought = new URLSearchParams(location.search).has('qa-stage3');
  if (stagedThought) {
    Object.defineProperty(window, 'VoidEpisode', {
      configurable: true,
      set(api) {
        localStorage.setItem(api.SAVE_KEY + ':v2:checkpoint', JSON.stringify({
          version: 2, discoveredClues: 3, meters: api.CLUES[2].meters,
        }));
        Object.defineProperty(window, 'VoidEpisode', { value: api });
      },
    });
  }
  window.requestAnimationFrame = (callback) => { request = callback; };
  Object.defineProperty(window, 'VoidRunner', {
    configurable: true,
    set(api) {
      Object.defineProperty(window, 'VoidRunner', { value: { ...api, Run: class extends api.Run {
        constructor(options) {
          super(options);
          if (!course) return;
          if (stagedThought) this.obstacles.length = 0;
          const { type, speed } = course;
          this.baseSpeed = this.speed = speed;
          const seconds = 1.96;
          const z = Math.ceil(speed * seconds + .9 * seconds ** 2);
          if (type === 'gap') this.addClosure(z, 2, speed * 1.2);
          else if (type === 'spikes') this.addSpikes(z, 2, 1, 1);
          else this.addObstacle(z, 2, type, {
            ...((type === 'slideGate' || type === 'platform') && { end: z + Math.ceil(speed * .30) }),
            ...(type === 'movingBarrier' && { toLane: 3 }),
          });
        }
      } } });
    },
  });
  Object.defineProperty(window, 'VoidScene', {
    configurable: true,
    set(Scene) {
      Object.defineProperty(window, 'VoidScene', { value: class extends Scene {
        draw(run, time, dt, mode, clue, signal, death) {
          if (!current || this.width === undefined) this.resize();
          current = { run, scene: this, mode, death };
          super.draw(run, time, dt, mode, clue, signal, death);
        }
      } });
    },
  });
  const step = () => request(frame++ * 1000 / 60);
  const state = () => ({
    mode: current.mode, elapsed: current.death?.elapsed,
    type: current.run.crash?.type, speed: current.run.speed,
    result: !document.querySelector('.results').hidden,
    shade: document.querySelector('#death-shade')?.style.opacity,
    shadeHidden: document.querySelector('#death-shade')?.hidden,
    thought: document.querySelector('#death-thought')?.textContent,
  });
  const tile = { width: 248, height: 153 };
  window.deathQA = {
    layout() {
      return {
        viewport: [innerWidth, innerHeight],
        canvas: [current.scene.width, current.scene.height],
        coarse: matchMedia('(pointer: coarse)').matches,
        short: matchMedia('(min-width: 580px) and (max-height: 500px)').matches,
        touch: document.body.dataset.touch === 'true',
        reduced: current.scene.reduceMotion,
      };
    },
    start(type, speed) {
      course = { type, speed };
      document.querySelector(current?.mode === 'ended' ? '#restart' : '#start').click();
      for (let limit = frame + 180; frame < limit; ) {
        step();
        if (current.mode === 'dying') return state();
      }
      return state();
    },
    finish(seconds) {
      for (let limit = frame + 240; frame < limit && current.mode !== 'ended' && current.death.elapsed < seconds; ) step();
      return state();
    },
    thoughtLayout() {
      const thought = document.getElementById('death-thought');
      const range = document.createRange();
      range.selectNodeContents(thought);
      const lines = [...range.getClientRects()];
      const top = Math.min(...lines.map((line) => line.top));
      const bottom = Math.max(...lines.map((line) => line.bottom));
      const left = Math.min(...lines.map((line) => line.left));
      const right = Math.max(...lines.map((line) => line.right));
      return {
        lineCount: lines.length,
        fontSize: getComputedStyle(thought).fontSize,
        hudClearance: Math.round(top - document.getElementById('hud').getBoundingClientRect().bottom),
        horizonClearance: Math.round(current.scene.horizon - bottom),
        centerOffset: Math.round((left + right - innerWidth) / 2),
      };
    },
    sheet(rows, times, title) {
      sheet = document.createElement('canvas');
      sheet.width = (tile.width + 8) * times.length + 8;
      sheet.height = 45 + (tile.height + 29) * rows.length;
      const ctx = sheet.getContext('2d');
      ctx.fillStyle = '#120e20';
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      ctx.fillStyle = '#f1e8fc';
      ctx.font = 'bold 18px system-ui';
      ctx.fillText(title, 8, 20);
      ctx.font = '13px system-ui';
      times.forEach((time, column) => ctx.fillText(`Impact + ${time.toFixed(2)} s`, 8 + column * (tile.width + 8), 39));
    },
    cell(row, column, label) {
      const { run, scene, death } = current;
      const { x, y, z } = death.impact.impact;
      const [cx, cy] = scene.screenPoint(scene.viewPoint([x, y + .94, z - run.distance]));
      const unit = scene.focal / scene.viewPoint([x, y + .94, z - run.distance])[2];
      const width = Math.min(scene.width, unit * (death.impact.type === 'movingBarrier' ? 8.5 : 7.2));
      const height = width * tile.height / tile.width;
      const left = Math.max(0, Math.min(scene.width - width, cx - width / 2));
      const top = Math.max(0, Math.min(scene.height - height, cy - height * (death.impact.type === 'spikes' ? .77 : .61)));
      const dx = 8 + column * (tile.width + 8);
      const dy = 48 + row * (tile.height + 29);
      const ctx = sheet.getContext('2d');
      ctx.fillStyle = '#f1e8fc';
      ctx.font = 'bold 13px system-ui';
      if (column === 0) ctx.fillText(label, dx, dy + 12);
      ctx.drawImage(scene.canvas, left * scene.ratio, top * scene.ratio,
        width * scene.ratio, height * scene.ratio, dx, dy + 18, tile.width, tile.height);
    },
    png: () => sheet.toDataURL('image/png').split(',')[1],
  };
}

async function main() {
  const flags = process.argv.slice(2);
  assert.ok(flags.length === 0 || (flags.length === 1 && ['--landscape', '--filter', '--thoughts'].includes(flags[0])),
    'Usage: node tests/qa/death-visual.cjs [--landscape | --filter | --thoughts]');
  const filter = flags[0] === '--filter';
  const thoughts = flags[0] === '--thoughts';
  const selectedLayouts = layouts.filter(({ name }) =>
    filter ? name in filterCases : flags[0] !== '--landscape' || name === 'landscape');
  const output = await mkdtemp(join(tmpdir(), 'run-void-deaths-'));
  const profile = await mkdtemp(join(tmpdir(), 'run-void-death-chrome-'));
  const server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url, 'http://127.0.0.1');
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    const type = mime[extname(file)];
    if (!type || !file.startsWith(root + sep) || !existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', type);
    response.end(await readFile(file));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let instance;
  try {
    instance = await launch(profile);
    const browser = connect(instance.socket);
    await browser.call('Page.enable');
    await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `(${playback})()` });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const evaluate = (method, ...args) => browser.evaluate(`deathQA.${method}(${args.map((arg) => JSON.stringify(arg)).join(',')})`);
    const save = (name, data) => writeFile(join(output, name + '.png'), Buffer.from(data, 'base64'));
    const screenshot = async (name) => {
      const { data } = await browser.call('Page.captureScreenshot', { format: 'png' });
      await save(name, data);
    };
    const captureThought = async (layout, speed, hazard, long, large) => {
      await browser.navigate(`${origin}/?seed=187&${long ? 'qa-stage3' : 'scenario=landing'}`);
      const start = async () => {
        const started = await evaluate('start', hazard, speed);
        assert.equal(started.mode, 'dying', JSON.stringify(started));
        assert.equal(started.type, hazard);
      };
      if (large) await browser.evaluate("document.documentElement.style.fontSize = '24px'");
      if (long) {
        await start();
        assert.equal((await evaluate('finish', 3.85)).mode, 'ended');
      }
      await start();
      const hold = await evaluate('finish', 3.15);
      assert.equal(hold.thought, long ? 'How many times have they seen it?' : 'One white dot.');
      assert.equal(hold.result, false);
      const name = `${layout}-${speed}-${large ? 'large' : long ? 'long-standard' : 'standard'}-thought`;
      await screenshot(name);
      const placement = await evaluate('thoughtLayout');
      assert.ok(placement.hudClearance >= 12 && placement.horizonClearance >= 12, JSON.stringify(placement));
      assert.equal(placement.lineCount, large && layout !== 'landscape' ? 2 : 1);
      if (large) assert.equal(placement.fontSize, '27px');
      else assert.ok(Math.abs(placement.centerOffset) <= 1, JSON.stringify(placement));
      console.log(name, placement);
    };
    for (const { name: layout, width, height, touch } of selectedLayouts) {
      const angle = layout === 'landscape' ? 90 : 0;
      const type = layout === 'portrait' ? 'portraitPrimary' : 'landscapePrimary';
      await browser.call('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: touch, screenOrientation: { type, angle },
      });
      await browser.call('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 2 });
      for (const reduced of [false, true]) {
        await browser.call('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }],
        });
        if (thoughts) {
          const speed = reduced === (layout === 'portrait') ? 720 : 48;
          const hazard = filterCases[layout]?.[speed].hazard ?? 'hurdle';
          await captureThought(layout, speed, hazard, reduced, reduced);
          if (layout === 'landscape' && !reduced) await captureThought(layout, speed, hazard, true, false);
          continue;
        }
        await browser.navigate(`${origin}/?scenario=landing&seed=187`);
        for (const speed of [48, 720]) {
          const filterCase = filterCases[layout]?.[speed];
          if (filter && reduced !== filterCase.reduced) continue;
          const selectedHazards = filter ? [filterCase.hazard] : hazards;
          const name = `${layout}-${speed}-${reduced ? 'reduced' : 'motion'}`;
          if (!filter) await evaluate('sheet', selectedHazards, samples,
            `${layout} ${width}×${height} / ${speed} m/s launch / ${reduced ? 'reduced motion' : 'full motion'}`);
          for (const [row, hazard] of selectedHazards.entries()) {
            const started = await evaluate('start', hazard, speed);
            assert.equal(started.mode, 'dying', JSON.stringify({ started, hazard, speed }));
            assert.equal(started.type, hazard);
            assert.ok(started.speed >= speed && started.speed <= speed + 5);
            assert.equal(started.thought, '');
            assert.equal(started.result, false);
            if (row === 0) assert.deepEqual(await evaluate('layout'), {
              viewport: [width, height], canvas: [width, height], coarse: touch,
              short: layout === 'landscape', touch, reduced,
            });
            const fullTimeline = filter || (!reduced && hazard === (layout === 'portrait' ? 'movingBarrier' : 'platform') &&
              speed === (layout === 'portrait' ? 720 : 48));
            const timelineFrame = (stage) => screenshot(filter ? `${name}-${hazard}-${stage}` : `${layout}-timeline-${stage}`);
            for (let column = 0; column < samples.length; column++) {
              const state = await evaluate('finish', samples[column]);
              assert.equal(state.mode, 'dying');
              assert.equal(state.shadeHidden, true);
              if (!filter) await evaluate('cell', row, column, `${hazard} · ${started.speed.toFixed(1)} m/s`);
              if (fullTimeline && column === 1) await timelineFrame('impact');
              if (!filter && layout === 'landscape' && speed === 720 && column === 2 &&
                  ['movingBarrier', 'spikes', 'gap'].includes(hazard)) {
                await screenshot(`${name}-full-${hazard}`);
              }
            }
            if (fullTimeline) {
              const darkening = await evaluate('finish', 1.30);
              assert.equal(darkening.shadeHidden, false);
              if (reduced) assert.equal(darkening.shade, '1');
              else assert.ok(Number(darkening.shade) > 0 && Number(darkening.shade) < 1);
              assert.equal(darkening.thought, '');
              if (!filter || !reduced) await timelineFrame('darkening');
              const reveal = await evaluate('finish', 1.73);
              assert.ok(reveal.thought.trim());
              if (!filter) await timelineFrame('lore');
              const hold = await evaluate('finish', 3.15);
              assert.equal(hold.thought, reveal.thought);
              assert.equal(hold.result, false);
              await timelineFrame('hold');
            }
            const ended = await evaluate('finish', 3.85);
            assert.equal(ended.mode, 'ended');
            assert.equal(ended.result, true);
            if (fullTimeline) await timelineFrame('results');
          }
          if (!filter) await save(name, await evaluate('png'));
          console.log(name);
        }
      }
    }
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
