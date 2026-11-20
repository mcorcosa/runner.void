const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtemp, readFile, writeFile } = require('node:fs/promises');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const { extname, join, resolve, sep } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { SAVE_KEY, CLUES } = require('../../episode.js');

const obstacleSurvey = process.argv.includes('--obstacles');
const opacitySurvey = process.argv.includes('--opacity');
const [rootArg, sceneArg] = process.argv.slice(2).filter((arg) => !['--obstacles', '--opacity'].includes(arg));
const root = resolve(rootArg ?? join(__dirname, '../..'));
const sceneFile = sceneArg && resolve(sceneArg);
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

function coursePlayback(checkpointKey, matureMeters) {
  const requestedSpeed = Number(new URLSearchParams(location.search).get('qaObstacleSurvey'));
  if (requestedSpeed) {
    localStorage.clear();
    if (requestedSpeed > 48) {
      localStorage.setItem(checkpointKey, JSON.stringify({ version: 2, discoveredClues: 4, meters: matureMeters, bolts: 0 }));
    }
  }
  let request;
  let frame = 0;
  let current;
  let target;
  let count;
  let withoutForecast = false;
  window.requestAnimationFrame = (callback) => { request = callback; };
  Object.defineProperty(window, 'VoidScene', {
    configurable: true,
    set(Scene) {
      Object.defineProperty(window, 'VoidScene', { value: class extends Scene {
        draw(run, time, dt, ...args) {
          current = { scene: this, run, time, args };
          super.draw(run, time, dt, ...args);
        }
        track(...args) {
          const first = count?.faces ?? 0;
          super.track(...args);
          if (count) count.trackFaces = count.faces - first;
        }
        face(...args) {
          if (count) count.faces++;
          super.face(...args);
        }
        line(...args) {
          if (count) count.lines++;
          super.line(...args);
        }
        distantObstacle(...args) {
          const first = count ? count.faces + count.lines : 0;
          if (!withoutForecast) super.distantObstacle(...args);
          if (count) {
            count.considered++;
            count.distantPaths += count.faces + count.lines - first;
          }
        }
      } });
    },
  });

  const step = () => request(frame++ * 1000 / 60);
  function survey(run, targetDistance) {
    // Advance the nominal clock without choosing a route through intervening gameplay.
    // Use the same run and generator so the object being inspected remains the one originally forecast.
    while (targetDistance > run.distance) {
      const stride = Math.min(targetDistance - run.distance, run.viewDistance / 2);
      const speed = run.baseSpeed;
      run.baseSpeed = run.speed = Math.sqrt(speed ** 2 + 3.6 * stride);
      run.time += 2 * stride / (speed + run.baseSpeed);
      run.distance += stride;
      run.obstacles = run.obstacles.filter(({ z, end = z }) => end >= run.distance - 0.15 * run.viewDistance);
      run.populate();
    }
  }

  function findDeck(run) {
    const denied = run.obstacles.filter(({ z, end = z }) => z <= run.distance + run.speed * 0.025 + 2 && end >= run.distance - 2);
    return [2, 1, 3, 0, 4].find((lane) => denied.every((obstacle) =>
      lane < Math.min(obstacle.lane, obstacle.toLane ?? obstacle.lane) ||
      lane > Math.max(obstacle.toLane ?? obstacle.lane, obstacle.lane + (obstacle.lanes ?? 1) - 1)));
  }

  function drawComparison() {
    const { run, scene, time, args } = current;
    withoutForecast = true;
    Object.defineProperty(run, 'forecastObstacles', { configurable: true, value: [] });
    try {
      scene.draw(run, time, 0, ...args);
    } finally {
      delete run.forecastObstacles;
      withoutForecast = false;
    }
  }

  function measure(stage) {
    const { run, scene, time, args } = current;
    const { ctx, width, height, horizon, viewDistance } = scene;
    count = { faces: 0, lines: 0, considered: 0, distantPaths: 0 };
    scene.draw(run, time, 0, ...args);
    const work = count;
    count = null;
    const timings = [];
    for (let i = 0; i < 12; i++) {
      const before = performance.now();
      scene.draw(run, time, 0, ...args);
      timings.push(performance.now() - before);
    }
    timings.sort((a, b) => a - b);
    work.drawMedianMs = timings[6];
    const display = ctx.getImageData(0, 0, width, height).data;
    count = { faces: 0, lines: 0, considered: 0, distantPaths: 0 };
    drawComparison();
    work.extraTrackFaces = work.trackFaces - count.trackFaces;
    count = null;
    const comparison = ctx.getImageData(0, 0, width, height).data;
    scene.draw(run, time, 0, ...args);
    let changed = 0;
    let strongest = 0;
    const z = target.z - run.distance;
    const shape = VoidRunner.obstacles[target.type];
    const x = VoidRunner.laneX(target.lane);
    const [left, top] = scene.screenPoint(scene.viewPoint([x - shape.halfWidth, shape.height, z]));
    const [right, bottom] = scene.screenPoint(scene.viewPoint([x + shape.halfWidth, 0, z]));
    for (let py = Math.max(0, Math.floor(top) - 1); py <= Math.min(height - 1, Math.ceil(bottom) + 1); py++) {
      for (let px = Math.max(0, Math.floor(left) - 1); px <= Math.min(width - 1, Math.ceil(right) + 1); px++) {
        const i = (py * width + px) * 4;
        const delta = Math.max(...[0, 1, 2].map((channel) => Math.abs(display[i + channel] - comparison[i + channel])));
        strongest = Math.max(strongest, delta);
        if (delta >= 8) changed++;
      }
    }
    return { ...work, stage, target, forecast: run.forecastObstacles.length, live: run.obstacles.length,
      phase: run.obstacles.includes(target) ? 'live' : run.forecastObstacles.includes(target) ? 'forecast' : 'missing',
      bounds: [left, top, right, bottom], pixelsChanged: changed, strongest, horizon, viewDistance,
      speed: run.speed, distance: run.distance, targetRange: z / viewDistance, viewport: [width, height],
      reduced: run.reducedMotion };
  }

  window.trackQA = {
    sample(stage, speed) {
      if (stage === 'far') {
        document.querySelector('#start').click();
        for (let i = 0; i < 18; i++) step();
        const { run } = current;
        if (speed > run.speed) survey(run, run.distance + (speed ** 2 - run.baseSpeed ** 2) / 3.6);
        const range = run.viewDistance;
        target = run.forecastObstacles.find(({ z, type }) => z > run.distance + 1.15 * range &&
          ['hurdle', 'barrier'].includes(type));
      } else {
        const { run } = current;
        survey(run, target.z - 0.25 * run.viewDistance);
      }
      const { run } = current;
      let lane = findDeck(run);
      for (let i = 0; lane === undefined && i < 8; i++) {
        survey(run, run.distance + run.speed * 0.035);
        lane = findDeck(run);
      }
      if (lane === undefined) throw new Error(`Survey ${stage} position at ${run.distance} m overlaps every lane`);
      run.lane = lane;
      run.x = VoidRunner.laneX(lane);
      step();
      if (run.crash) throw new Error(`Survey starts inside ${run.crash.type}`);
      return measure(stage);
    },
    baseline: drawComparison,
  };
}

function opacityPlayback() {
  window.requestAnimationFrame = () => {};
  window.trackQA = {
    sample(stage, speed) {
      const { Run, laneX, movingBarrierX, obstacles, PLATFORM_HEIGHT, SLIDE_GATE_CLEARANCE, SPIKE_HEIGHT } = VoidRunner;
      const run = new Run({ scenario: 'landing', seed: 187 });
      run.baseSpeed = run.speed = speed;
      run.time = 0.36;
      const canvas = document.querySelector('#scene');
      document.body.dataset.mode = 'running';
      for (const { style } of canvas.parentElement.children) {
        if (style !== canvas.style) style.visibility = 'hidden';
      }
      const scene = new VoidScene(canvas);
      scene.resize();
      scene.openingBlend = 0;
      scene.reset(speed);
      scene.frameCamera(run);
      const range = run.viewDistance;
      const z = stage * range;
      const tileLength = range * 0.14;
      const row = [
        { type: 'hurdle', lane: 0, z },
        { type: 'barrier', lane: 1, z },
        { type: 'platform', lane: 2, z, end: z + range * 0.37, height: PLATFORM_HEIGHT },
        { type: 'movingBarrier', lane: 3, toLane: 4, z },
        { type: 'slideGate', lane: 4, z, end: z + range * 0.16 },
        { type: 'spikes', lane: 0, z: z + range * 0.19, end: z + range * 0.19 + tileLength, tileLength,
          lanes: 1, tiles: 1 },
      ];
      const viewport = [scene.width, scene.height];
      const backing = ['#f30040', '#13f040'];
      const probe = document.createElement('canvas');
      const scale = 32;
      probe.width = probe.height = 5;
      const raster = new VoidScene(probe);
      Object.assign(raster, { width: scene.width, height: scene.height, insets: scene.insets, openingBlend: 0 });
      raster.reset(speed);
      raster.frameCamera(run);
      raster.player = () => {};
      const probeAt = (hazard, x, y, depth) => {
        run.obstacles = [hazard];
        const [px, py] = raster.screenPoint(raster.viewPoint([x, y, depth]));
        const samples = backing.map((color) => {
          raster.ctx.resetTransform();
          raster.ctx.fillStyle = color;
          raster.ctx.fillRect(0, 0, probe.width, probe.height);
          raster.ctx.setTransform(scale, 0, 0, scale, 2.5 - px * scale, 2.5 - py * scale);
          raster.drawCourseObjects(run, 0, false, false, false);
          return [...raster.ctx.getImageData(2, 2, 1, 1).data];
        });
        return { delta: Math.max(...samples[0].map((value, index) => Math.abs(value - samples[1][index]))), rgb: samples[0].slice(0, 3) };
      };
      const pixels = {};
      for (const hazard of row) {
        if (hazard.type === 'spikes') {
          const start = (stage < 0.9 ? 0.84 : stage) * range;
          const plate = { ...hazard, z: start, end: start + tileLength };
          const x = laneX(plate.lane);
          const depth = Math.min(3.5, tileLength * 0.125);
          pixels.spikePlate = probeAt(plate, x, 0.027, start + tileLength * 0.24);
          pixels.spikeTooth = probeAt(plate, x - 0.575, 0.04 + (SPIKE_HEIGHT - 0.04) * 0.35,
            start + tileLength * 0.07 + depth * 0.55 * 0.35);
          continue;
        }
        const moving = hazard.type === 'movingBarrier';
        const shape = obstacles[moving ? 'barrier' : hazard.type];
        const x = moving ? movingBarrierX(hazard, run.time) : laneX(hazard.lane);
        const y = hazard.type === 'slideGate' ? SLIDE_GATE_CLEARANCE + 0.55 : (shape?.height ?? PLATFORM_HEIGHT) * 0.55;
        const depth = hazard.z - (shape?.halfDepth ?? 0);
        pixels[hazard.type] = probeAt(hazard, x, y, depth);
        if (hazard.type === 'slideGate') pixels.gateOpening = probeAt(hazard, x, SLIDE_GATE_CLEARANCE / 2, depth);
      }
      run.obstacles = row;
      scene.draw(run, 0, 0, 'running');
      return { viewport, range, fraction: stage, pixels };
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
    const script = opacitySurvey ? `(${opacityPlayback})()` : obstacleSurvey ?
      `(${coursePlayback})('${SAVE_KEY}:v2:checkpoint', ${CLUES.at(-1).meters})` : `(${playback})()`;
    await call('Page.addScriptToEvaluateOnNewDocument', { source: script });
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const [layout, width, height, mobile] of layouts) {
      if (opacitySurvey && layout === 'landscape') continue;
      const portrait = layout === 'portrait';
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile,
        screenOrientation: { type: portrait ? 'portraitPrimary' : 'landscapePrimary', angle: mobile && !portrait ? 90 : 0 } });
      await call('Emulation.setTouchEmulationEnabled', { enabled: mobile });
      for (const reduced of [false, true]) {
        if (opacitySurvey && reduced) continue;
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
          const scenario = obstacleSurvey ? `&qaObstacleSurvey=${speed}` : speed === 48 ? '' : `&scenario=landing&qaSpeed=${speed}`;
          const navigation = await call('Page.navigate', { url: `${origin}/?seed=187${scenario}` });
          assert.ok(!navigation.errorText, navigation.errorText);
          await loaded;
          const stages = opacitySurvey ? [0.898, 0.902, 1.75] : obstacleSurvey ? ['far', 'close'] : ['entry', 'lore'];
          let farTarget;
          let nearPaint;
          for (const stage of stages) {
            const result = await call('Runtime.evaluate', { expression: `trackQA.sample(${JSON.stringify(stage)}, ${speed})`, returnByValue: true });
            assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description);
            const state = result.result.value;
            assert.deepEqual(state.viewport, [width, height]);
            if (opacitySurvey) {
              assert.ok(state.pixels.gateOpening.delta > 200);
              if (!sceneFile) {
                for (const [type, { delta }] of Object.entries(state.pixels)) {
                  if (type !== 'gateOpening') assert.equal(delta, 0, `${layout} ${speed} ${stage} ${type}`);
                }
                if (stage === 0.898) nearPaint = state.pixels;
                if (stage === 0.902) {
                  for (const type of ['hurdle', 'barrier', 'platform', 'movingBarrier', 'slideGate']) {
                    const change = state.pixels[type].rgb.map((value, index) => Math.abs(value - nearPaint[type].rgb[index]));
                    assert.ok(Math.max(...change) <= 2, `${layout} ${speed} ${type} handoff`);
                  }
                }
              }
              const name = `${layout}-${speed}-${stage}`;
              const { data } = await call('Page.captureScreenshot', { format: 'png' });
              await writeFile(join(output, `${name}.png`), Buffer.from(data, 'base64'));
              report[name] = state;
              continue;
            }
            assert.equal(state.reduced, reduced);
            if (obstacleSurvey) {
              assert.ok(state.speed >= speed && state.speed < speed + 10, JSON.stringify(state));
              assert.ok(state.distantPaths < 250 && state.extraTrackFaces < 360 && state.considered < 180, JSON.stringify(state));
              const name = `${layout}-${speed}-${reduced ? 'reduced' : 'motion'}-${stage}`;
              if (stage === 'far') {
                assert.equal(state.phase, 'forecast');
                assert.ok(state.targetRange > 1.1 && state.targetRange < 4);
                assert.ok(state.pixelsChanged > 0, JSON.stringify(state));
                farTarget = state.target;
              } else {
                assert.equal(state.phase, 'live');
                assert.deepEqual(state.target, farTarget);
                assert.ok(state.targetRange > 0.1 && state.targetRange < 0.25);
                assert.equal(state.pixelsChanged, 0);
              }
              const { data } = await call('Page.captureScreenshot', { format: 'png' });
              await writeFile(join(output, `${name}.png`), Buffer.from(data, 'base64'));
              if (stage === 'far') {
                await call('Runtime.evaluate', { expression: 'trackQA.baseline()' });
                const baseline = await call('Page.captureScreenshot', { format: 'png' });
                await writeFile(join(output, `${name}-comparison.png`), Buffer.from(baseline.data, 'base64'));
              }
              report[name] = state;
              continue;
            }
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
