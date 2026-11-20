const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { EpisodeProgress, SAVE_KEY, CLUES, PULSE_LEAD } = require('../episode.js');
const { Run, STEP, LANE_COUNT, START_SPEED, ENDLESS_START_SPEED, ADVANCED_START_SPEED, FAST_START_SPEED } = require('../game.js');
const LEGACY_CHECKPOINT = SAVE_KEY + ':checkpoint';
const LEGACY_ENTRY = SAVE_KEY + ':entry:';
const CHECKPOINT = SAVE_KEY + ':v2:checkpoint';
const ENTRY = SAVE_KEY + ':v2:entry:';
const RESET_KEY = SAVE_KEY + ':reset';
const RESET_CHECKPOINT = SAVE_KEY + ':v3:checkpoint';
const RESET_ENTRY = SAVE_KEY + ':v3:entry:';

function storage(initial) {
  return Object.assign({
    writes: [],
    progress() { return new EpisodeProgress({ storage: this, databaseFactory: null }); },
    read() {
      const { meters, discoveredClues, pendingClue } = this.progress();
      return { meters, status: discoveredClues ? 'discovered' : pendingClue ? 'pending' : 'locked' };
    },
    getItem(key) { return this[key] ?? null; },
    setItem(key, value) {
      assert.ok(key.startsWith(SAVE_KEY + ':'));
      this.beforeWrite?.(key);
      this[key] = value;
      this.writes.push(this.read());
    },
    removeItem(key) { delete this[key]; },
  }, initial ? { [SAVE_KEY]: JSON.stringify(initial) } : {});
}

function browser(query = '?seed=187', store = storage(), {
  sound = true, databaseFactory, touch = false, origin = 'https://game.example',
} = {}) {
  const read = (file) => readFileSync(join(__dirname, '..', file), 'utf8');
  const events = [];
  class Element {
    constructor() {
      this.handlers = {};
      this.dataset = {};
      this.style = {};
      this.attributes = {};
      this.textContent = '';
      this.pointers = new Set();
    }
    addEventListener(type, listener) { this.handlers[type] = listener; }
    setAttribute(name, value) { this.attributes[name] = value; }
    blur() { document.activeElement = document.body; }
    focus() { document.activeElement = this; }
    setPointerCapture(id) { this.pointers.add(id); }
    releasePointerCapture(id) { this.pointers.delete(id); }
    hasPointerCapture(id) { return this.pointers.has(id); }
  }
  class Button extends Element {}
  const elements = Object.fromEntries(Array.from(read('index.html').matchAll(/<(\w+)[^>]+id="([\w-]+)"[^>]*>/g),
    ([tag, name, id]) => [id, Object.assign(name === 'button' ? new Button() : new Element(), {
      hidden: /\bhidden(?:\s|>)/.test(tag),
    })]));
  const overlays = { '.intro': new Element(), '.results': new Element() };
  overlays['.results'].hidden = true;
  const document = Object.assign(new Element(), {
    body: new Element(), getElementById: (id) => elements[id], querySelector: (name) => overlays[name],
    hidden: false,
  });
  document.body.dataset.mode = 'ready';
  document.activeElement = document.body;
  const window = Object.assign(new Element(), { localStorage: store });
  let nextFrame;
  let time = 0;
  let run;
  let starDiscovered;
  let starSignal;
  let sceneFrame;
  let sceneHorizon = 135.5;
  const audio = [];
  let player;
  const context = vm.createContext({
    document, window, URLSearchParams, location: new URL(query, origin), HTMLButtonElement: Button,
    navigator: { userAgent: '', platform: '' }, indexedDB: databaseFactory,
    matchMedia: (query) => ({ matches: touch && query === '(pointer: coarse)' }),
    ResizeObserver: class { observe() {} },
    requestAnimationFrame: (frame) => { nextFrame = frame; },
    VoidRunner: { ...require('../game.js'), Run: class extends Run {
      requestTransmission(duration, ordinal) {
        events.push(['request', this.distance, store?.read(), ordinal, duration]);
        return super.requestTransmission(duration, ordinal);
      }
    } },
    VoidScene: class {
      resize() {}
      reset() {}
      scatter(kind) { events.push(['scatter', kind]); }
      pulseSpeed() {}
      draw(currentRun, time, dt, mode, discovered, signal, death) {
        this.horizon = sceneHorizon;
        run = currentRun;
        starDiscovered = discovered;
        starSignal = signal;
        sceneFrame = { time, dt, mode, death };
      }
    },
    VoidAudio: sound ? { Soundtrack: class {
      constructor() {
        assert.equal(player, undefined);
        player = this;
      }
      unlock() { events.push(['unlock']); }
      impact(kind) { events.push(['impact', kind, audio.at(-1)?.mode]); }
      setMuted(muted) { events.push(['mute', muted]); }
      suspend() { events.push(['suspend']); }
      resume() { events.push(['resume']); }
      update(state) { audio.push(state); }
    } } : undefined,
  });
  for (const file of ['episode.js', 'app.js']) vm.runInContext(read(file), context, { filename: file });
  function step(frames = 1, milliseconds = 1000 / 60) {
    for (let frame = 0; frame < frames; frame++) {
      time += milliseconds;
      nextFrame(time);
    }
  }
  step();
  return {
    elements, events, document, store, step, overlays,
    get run() { return run; },
    get mode() { return document.body.dataset.mode; },
    get starDiscovered() { return starDiscovered; },
    get starSignal() { return starSignal; },
    get sceneFrame() { return sceneFrame; },
    setSceneHorizon(value) { sceneHorizon = value; },
    get sound() { return audio.at(-1); },
    click(id, options) {
      const button = elements[id];
      button.handlers.click({ isTrusted: true, currentTarget: button, detail: 1, ...options });
    },
    key(code, id, repeat = false) {
      const target = id ? elements[id] : document.body;
      if (id) target.focus();
      let prevented = false;
      window.handlers.keydown({ code, target, repeat, isTrusted: true, preventDefault() { prevented = true; } });
      window.handlers.keyup({ code });
      return prevented;
    },
    swipe(x, y) {
      const { handlers } = elements['swipe-field'];
      const event = { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0, preventDefault() {} };
      handlers.pointerdown(event);
      handlers.pointermove({ ...event, clientX: x, clientY: y });
      handlers.pointerup(event);
    },
    setHidden(hidden) {
      document.hidden = hidden;
      document.handlers.visibilitychange();
    },
    page(name, event) { window.handlers[name](event); },
    until(predicate, limit = 2400, milliseconds) {
      for (let frame = 0; frame < limit && !predicate(); frame++) step(1, milliseconds);
      assert.ok(predicate(), 'expected browser state was not reached');
    },
  };
}

function steerSafely(page) {
  const { run } = page;
  const next = run.obstacles.find(({ z }) => z > run.distance + 8);
  if (!next || next.z - run.distance >= run.speed * 0.67) return;
  const row = run.obstacles.filter(({ z, type, end }) => z === next.z ||
    (type === 'gap' && z <= run.distance && end > run.distance));
  const lane = [run.lane, run.lane - 1, run.lane + 1].find((candidate) => candidate >= 0 && candidate < LANE_COUNT &&
    !row.some(({ lane, lanes = 1 }) => candidate >= lane && candidate < lane + lanes));
  if (lane !== undefined && lane !== run.lane) page.key(lane < run.lane ? 'ArrowLeft' : 'ArrowRight');
}

function storageTransactions() {
  let settled = Promise.resolve();
  return {
    async idle() {
      await Promise.resolve();
      await settled;
    },
    open() {
      const request = { result: {
        close() {},
        transaction(_store, mode) {
          assert.equal(mode, 'readwrite');
          let aborted = false;
          const transaction = {
            abort() { aborted = true; transaction.onabort(); },
            objectStore() { return {
              get() {
                const read = {};
                settled = settled.then(() => {
                  read.onsuccess();
                  if (!aborted) transaction.oncomplete();
                });
                return read;
              },
            }; },
          };
          return transaction;
        },
      } };
      queueMicrotask(() => request.onsuccess());
      return request;
    },
  };
}

test('episode records actual cumulative meters and writes only changed checkpoints', () => {
  const store = storage();
  const progress = new EpisodeProgress({ storage: store });
  progress.save();
  progress.discover(1);
  assert.equal(store.writes.length, 0);
  progress.credit(4980.25);
  progress.credit(4980.25);
  progress.save();
  progress.save();
  assert.deepEqual(store.writes, [{ meters: 4980.25, status: 'locked' }]);

  const resumed = new EpisodeProgress({ storage: store });
  resumed.credit(19.5);
  assert.equal(resumed.pendingClue, null);
  resumed.credit(19.75);
  assert.deepEqual(store.read(), { meters: 5000, status: 'pending' });
  const pending = new EpisodeProgress({ storage: store });
  assert.equal(pending.pendingClue, 1);
  pending.credit(8.125);
  pending.discover(1);
  pending.discover(1);
  assert.deepEqual(store.read(), { meters: 5008.125, status: 'discovered' });
  assert.equal(store.writes.length, 3);
});

test('switching tabs preserves newer discovery and distance from both tabs', () => {
  const store = storage();
  store[CHECKPOINT] = JSON.stringify({ version: 2, meters: 4970, bolts: 0, discoveredClues: 0 });
  const stale = new EpisodeProgress({ storage: store });
  const other = new EpisodeProgress({ storage: store });
  stale.credit(18.25);
  other.credit(35.25);
  other.discover(1);
  assert.deepEqual(store.read(), { meters: 5005.25, status: 'discovered' });
  stale.save();
  assert.deepEqual(store.read(), { meters: 5023.5, status: 'discovered' });

  other.credit(40.25);
  other.save();
  assert.deepEqual(store.read(), { meters: 5028.5, status: 'discovered' });
  stale.beginRun();
  stale.credit(2.5);
  stale.save();
  stale.save();
  assert.deepEqual(store.read(), { meters: 5031, status: 'discovered' });
  assert.equal(store.writes.length, 5);
});

test('collision credits partial impact distance, keeps clue pending, and retries on the next real run', () => {
  const beforeImpact = 4950;
  const store = storage();
  store[CHECKPOINT] = JSON.stringify({ version: 2, meters: beforeImpact, bolts: 0, discoveredClues: 0 });
  const crashed = browser(undefined, store);
  assert.equal(crashed.run.speed, ENDLESS_START_SPEED);
  crashed.click('start');
  assert.equal(crashed.sound.musicTierFloor, 1);
  crashed.until(() => crashed.mode === 'dying');
  const impact = 78 - 0.25 - 0.36;
  assert.equal(crashed.run.distance, impact);
  assert.ok(Math.abs(store.read().meters - (beforeImpact + impact)) < 1e-9);
  assert.equal(store.read().status, 'pending');
  assert.equal(crashed.events.filter(([name]) => name === 'request').length, 1);
  assert.equal(crashed.events.find(([name]) => name === 'request')[2].status, 'pending');
  assert.equal(crashed.elements['replay-1'].hidden, true);
  crashed.until(() => crashed.elements['death-thought'].textContent);
  assert.equal(crashed.elements['death-thought'].textContent, 'One white dot.');
  crashed.until(() => crashed.mode === 'ended');

  const reloaded = browser(undefined, store);
  assert.equal(reloaded.run.speed, ENDLESS_START_SPEED);
  assert.equal(reloaded.run.transmission, null);
  reloaded.key('Enter');
  assert.equal(reloaded.sound.musicTierFloor, 1);
  reloaded.key('ArrowLeft');
  reloaded.until(() => reloaded.run.transmission?.phase === 'playing');
  assert.equal(reloaded.sound.transmissionTime, 0);
  assert.equal(store.read().status, 'pending');
  reloaded.step(120);
  reloaded.page('pagehide');
  const savedBeforeCompletion = store.read();
  assert.ok(Math.abs(savedBeforeCompletion.meters - (beforeImpact + impact + reloaded.run.distance)) < 1e-9);
  assert.equal(savedBeforeCompletion.status, 'pending');

  const recovered = browser(undefined, store);
  recovered.click('start');
  recovered.key('ArrowLeft');
  recovered.until(() => recovered.run.transmission?.phase === 'playing');
  assert.equal(recovered.sound.transmissionTime, 0);
  recovered.until(() => recovered.run.transmission?.phase === 'complete');
  assert.ok(Math.abs(store.read().meters - (savedBeforeCompletion.meters + recovered.run.distance)) < 1e-9);
  assert.equal(store.read().status, 'discovered');
  assert.equal(recovered.starDiscovered, 1);
  assert.equal(recovered.run.advanced, false);
  assert.ok(Math.abs(recovered.run.speed - (ENDLESS_START_SPEED + 1.8 * recovered.run.time)) < 1e-8);
  assert.equal(recovered.sound.musicTierFloor, 1);

  const nextHazard = recovered.run.obstacles[0];
  while (recovered.run.lane !== nextHazard.lane) {
    recovered.key(recovered.run.lane > nextHazard.lane ? 'ArrowLeft' : 'ArrowRight');
  }
  recovered.until(() => recovered.mode === 'ended');
  const beforeRestart = store.read().meters;
  recovered.click('restart');
  recovered.step();
  assert.equal(recovered.run.speed, ADVANCED_START_SPEED);
  assert.equal(recovered.run.distance, 0);
  assert.equal(recovered.elements.distance.textContent, '0000');
  assert.equal(recovered.sound.musicTierFloor, 2);
  assert.equal(recovered.run.transmission, null);
  assert.equal(store.read().meters, beforeRestart);
  recovered.step(10);
  recovered.page('pagehide');
  assert.ok(Math.abs(store.read().meters - (beforeRestart + recovered.run.distance)) < 1e-9);

  const discovered = browser(undefined, store);
  assert.equal(discovered.starDiscovered, 1);
  assert.equal(discovered.run.speed, ADVANCED_START_SPEED);
  assert.equal(discovered.sound.musicTierFloor, 2);
  discovered.click('start');
  discovered.step(4);
  assert.equal(discovered.sound.musicTierFloor, 2);
  assert.equal(discovered.run.transmission, null);
});

test('invalid and older saves fall back to the regular profile, and unavailable storage keeps discovery in session', () => {
  const malformed = Object.assign(storage(), { getItem: () => '{old data' });
  for (const store of [malformed, storage({ meters: 630 }), storage({ meters: -1, status: 'discovered' })]) {
    const page = browser(undefined, store);
    assert.equal(page.run.speed, ENDLESS_START_SPEED);
    page.key('Enter');
    page.step();
    assert.equal(page.run.speed, ENDLESS_START_SPEED);
    assert.equal(page.sound.musicTierFloor, 1);
    assert.equal(page.run.transmission, null);
  }

  const page = browser(undefined, null);
  page.click('start');
  let meters = 0;
  while (meters < CLUES[0].meters) {
    page.until(() => page.mode === 'ended');
    meters += page.run.distance;
    page.click('restart');
  }
  page.key('ArrowLeft');
  page.until(() => page.run.transmission?.phase === 'complete');
  assert.equal(page.starDiscovered, 1);
  assert.equal(page.run.advanced, false);
  assert.equal(page.sound.musicTierFloor, 1);
  const nextHazard = page.run.obstacles[0];
  while (page.run.lane !== nextHazard.lane) page.key(page.run.lane > nextHazard.lane ? 'ArrowLeft' : 'ArrowRight');
  page.until(() => page.mode === 'ended');
  page.click('restart', { pointerType: 'touch' });
  page.step();
  assert.equal(page.run.speed, ADVANCED_START_SPEED);
  assert.equal(page.run.distance, 0);
  assert.equal(page.sound.musicTierFloor, 2);
  assert.equal(browser(undefined, null).run.speed, ENDLESS_START_SPEED);
});

test('ordinary navigation saves the latest active distance just once', () => {
  const page = browser();
  page.click('start');
  page.step(12);
  assert.equal(page.store.writes.length, 0);
  page.setHidden(true);
  page.page('pagehide');
  assert.deepEqual(page.store.writes, [{ meters: page.run.distance, status: 'locked' }]);
  assert.ok(page.run.distance > 0);
});

test('death freezes the impact frame, keeps controls locked and gives the thought foreground reading time', () => {
  const page = browser(undefined, storage({ meters: 6000, status: 'discovered' }), {
    origin: 'http://localhost', touch: true,
  });
  const thought = page.elements['death-thought'];
  const shade = page.elements['death-shade'];
  const results = page.overlays['.results'];
  page.click('start');
  page.elements.mute.focus();
  page.until(() => page.mode === 'dying');
  const crashed = page.run;
  const frozen = JSON.stringify(crashed);
  const { time, death } = page.sceneFrame;
  assert.equal(death.elapsed, 0);
  assert.equal(death.impact.type, 'hurdle');
  assert.equal(death.impact.impact.z, crashed.distance);
  assert.equal(page.sceneFrame.dt, 0);
  assert.equal(page.sound.mode, 'ended');
  assert.equal(page.sound.transmissionTime, null);
  assert.deepEqual(page.events.filter(([name]) => name === 'impact'), [['impact', 'hurdle', 'running']]);
  assert.equal(page.events.some(([name, kind]) => name === 'scatter' && kind === 'crash'), false);
  assert.equal(thought.textContent, '');
  assert.equal(shade.hidden, true);
  assert.equal(results.hidden, true);
  assert.equal(page.elements.hud.inert, true);
  assert.equal(page.document.activeElement, page.document.body);
  assert.equal(page.elements['touch-controls'].hidden, true);
  assert.equal(page.elements['reset-results-clues'].hidden, true);
  assert.equal(page.elements.recordings.hidden, true);

  const saved = page.store.read();
  assert.equal(page.key('Enter'), true);
  assert.equal(page.key('Space', 'restart'), true);
  page.click('reset-clues');
  page.click('reset-results-clues');
  page.click('replay-1');
  page.click('start');
  page.click('restart', { pointerType: 'touch' });
  page.swipe(60, 0);
  crashed.tick = () => assert.fail('The death presentation advanced the simulation');
  page.step(60);
  assert.equal(shade.hidden, true);
  page.step(12);
  assert.equal(shade.hidden, false);
  assert.ok(Number(shade.style.opacity) > 0 && Number(shade.style.opacity) < 1);
  assert.equal(thought.textContent, '');
  assert.equal(page.run, crashed);
  assert.equal(JSON.stringify(crashed), frozen);
  assert.equal(page.sceneFrame.time, time);
  assert.equal(page.sceneFrame.dt, 0);
  assert.equal(page.sceneFrame.death, death);
  assert.deepEqual(page.store.read(), saved);

  const beforeHidden = death.elapsed;
  page.setHidden(true);
  page.step(2, 30_000);
  assert.equal(death.elapsed, beforeHidden);
  page.setHidden(false);
  page.step();
  assert.equal(death.elapsed, beforeHidden);
  page.step(1, 8000);
  assert.equal(thought.textContent, 'A voice in all that hiss?');
  assert.equal(thought.style.bottom, 'calc(100% - 127px)');
  const openingShadow = thought.style.textShadow;
  assert.match(openingShadow, /#a575f4/);
  assert.equal(shade.style.opacity, '1');
  assert.equal(page.elements['sky-signal'].textContent, '');
  assert.equal(page.sound.transmissionTime, null);
  assert.equal(page.sceneFrame.time, time);
  assert.equal(results.hidden, true);
  page.setSceneHorizon(112.75);
  page.step(1, 90);
  assert.notEqual(thought.style.textShadow, openingShadow);
  assert.ok(thought.style.textShadow);
  assert.equal(thought.style.bottom, 'calc(100% - 104px)');
  page.step(1, 100);
  assert.equal(thought.style.textShadow, '');

  const beforePagehide = death.elapsed;
  page.page('pagehide');
  page.step(1, 30_000);
  assert.equal(death.elapsed, beforePagehide);
  page.page('pageshow');
  page.step();
  assert.equal(death.elapsed, beforePagehide);
  page.step(1, 2050);
  assert.equal(page.mode, 'dying');
  assert.equal(thought.textContent, 'A voice in all that hiss?');
  assert.equal(page.key('Enter', 'restart', true), true);
  page.step(1, 180);
  assert.equal(page.mode, 'ended');
  assert.equal(thought.textContent, '');
  assert.equal(shade.hidden, false);
  assert.equal(results.hidden, false);
  assert.equal(page.sceneFrame.death, null);
  assert.equal(page.sceneFrame.time, time);
  assert.equal(page.sceneFrame.dt, 0);
  assert.equal(page.elements.hud.inert, false);
  assert.equal(page.document.activeElement, page.elements.restart);
  assert.equal(page.elements['replay-1'].hidden, false);
  assert.equal(page.elements['final-distance'].textContent, String(Math.floor(crashed.distance)));
  assert.deepEqual(page.store.read(), saved);
  assert.deepEqual(page.events.filter(([name]) => name === 'impact'), [['impact', 'hurdle', 'running']]);
  assert.equal(page.key('Enter', 'restart', true), true);
  page.key('Enter');
  page.step();
  assert.equal(page.mode, 'running');
  assert.notEqual(page.run, crashed);
  assert.equal(page.run.distance, 0);
  assert.equal(page.elements['touch-controls'].hidden, false);
  assert.equal(shade.hidden, true);
  page.key('ArrowLeft');
  assert.equal(page.run.lane, 1);
});

test('death thoughts alternate within each discovered stage and stay isolated in practice and preview', () => {
  const byStage = [
    ['One white dot.', 'I can still picture it.'],
    ['A voice in all that hiss?', 'Almost made out a word.'],
    ['Who was asking?', 'I had the same question.'],
    ['They said “again.”', 'How many times have they seen it?'],
    ['How far to the beacon?', 'Who did they mean by “we”?'],
  ];
  function readThought(page) {
    const { run } = page;
    run.obstacles.length = 0;
    run.addObstacle(run.distance + 1, run.lane, 'hurdle');
    page.until(() => page.mode === 'dying');
    page.step(1, 1600);
    page.step(1, 200);
    return page.elements['death-thought'].textContent;
  }

  for (const [stage, lines] of byStage.entries()) {
    const store = storage();
    store[CHECKPOINT] = JSON.stringify({ version: 2, meters: CLUES[stage - 1]?.meters ?? 0, discoveredClues: stage });
    const page = browser(undefined, store);
    page.click('start');
    page.step();
    for (const line of lines) {
      assert.equal(readThought(page), line);
      page.step(1, 2300);
      assert.equal(page.mode, 'ended');
      page.click('restart');
      page.step();
    }
    if (stage !== 4) continue;
    const before = store.read();
    for (const query of ['?scenario=hurdle', '?pace=fast', '?preview=clue4']) {
      const isolated = browser(query, store);
      isolated.click('start');
      isolated.step();
      if (query.includes('preview')) {
        isolated.until(() => isolated.run.transmission?.phase === 'complete');
        assert.equal(isolated.starDiscovered, 4);
      }
      assert.equal(readThought(isolated), byStage[0][0]);
      isolated.page('pagehide');
      assert.deepEqual(store.read(), before);
    }
  }
});

test('peer reset keeps the thought selected at impact and clears the run after the hold', () => {
  const store = storage({ meters: 6000, status: 'discovered' });
  const page = browser(undefined, store, { origin: 'http://localhost' });
  page.click('start');
  page.until(() => page.mode === 'dying');
  const crashed = page.run;
  store.progress().reset();
  page.page('storage', { key: RESET_KEY });
  page.step(1, 1600);
  assert.equal(page.mode, 'dying');
  assert.equal(page.run, crashed);
  assert.equal(page.starDiscovered, 1);
  assert.equal(page.elements['death-thought'].textContent, 'A voice in all that hiss?');
  page.step(1, 200);
  page.step(1, 2300);
  assert.equal(page.mode, 'ready');
  assert.notEqual(page.run, crashed);
  assert.equal(page.starDiscovered, 0);
  assert.equal(page.elements['death-thought'].textContent, '');
  assert.equal(page.document.activeElement, page.elements.start);
  assert.equal(store.progress().meters, 0);
});

test('surviving a dash break or a black hole pull sends no fatal audio event', () => {
  const barrier = browser('?scenario=barrier');
  barrier.click('start');
  barrier.until(() => barrier.run.obstacles[0].z - barrier.run.distance < 10);
  barrier.key('KeyX');
  barrier.until(() => barrier.events.some(([name, kind]) => name === 'scatter' && kind === 'break'));
  assert.equal(barrier.mode, 'running');
  assert.equal(barrier.events.some(([name]) => name === 'impact'), false);

  const hole = browser('?scenario=black-hole');
  hole.click('start');
  hole.until(() => hole.elements.feedback.textContent.includes('Pulled left'));
  assert.equal(hole.mode, 'running');
  assert.equal(hole.events.some(([name]) => name === 'impact'), false);
});

test('preview is repeatable, live, and independent of personal progress and scripted QA', () => {
  const store = storage({ meters: 800, status: 'discovered' });
  for (const [query, speed] of [['?scenario=landing', START_SPEED], ['?scenario=landing&pace=fast', FAST_START_SPEED],
    ['?scenario=high-speed', 572], ['?pace=fast', ENDLESS_START_SPEED]]) {
    const qa = browser(query, store);
    assert.equal(qa.run.speed, speed);
    qa.click('start');
    assert.equal(qa.sound.speed, speed);
    assert.equal(qa.sound.musicTierFloor, 1);
    qa.step(180);
    qa.page('pagehide');
    assert.equal(qa.run.transmission, null);
  }

  for (const [query, sound] of [['?preview=clue1', true], ['?preview=clue1&scenario=landing&pace=fast', false]]) {
    const preview = browser(query, store, { sound });
    preview.click('start');
    assert.equal(preview.sound?.speed, sound ? ENDLESS_START_SPEED : undefined);
    assert.equal(preview.sound?.musicTierFloor, sound ? 1 : undefined);
    preview.until(() => preview.run.transmission?.phase === 'playing');
    assert.equal(preview.run.scripted, false);
    assert.equal(preview.elements['signal-status'].textContent, 'Receiving a signal');
    assert.equal(preview.run.obstacles.length, 0);
    preview.key('ArrowLeft');
    preview.key('Space');
    preview.key('KeyX');
    assert.equal(preview.run.lane, 1);
    assert.equal(preview.run.airborne, true);
    assert.equal(preview.run.dashing, true);
    preview.until(() => preview.run.transmission?.phase === 'complete');
    assert.equal(preview.elements['signal-status'].textContent, '');
    assert.equal(preview.starDiscovered, 1);
    const first = preview.run.obstacles.at(0);
    assert.ok(first.z > preview.run.distance + preview.run.viewDistance);
    while (preview.run.lane !== first.lane) preview.key(preview.run.lane > first.lane ? 'ArrowLeft' : 'ArrowRight');
    preview.until(() => preview.mode === 'ended');
    assert.equal(preview.elements['replay-1'].hidden, false);
    preview.click('restart');
    preview.step();
    assert.equal(preview.run.speed, ENDLESS_START_SPEED);
    assert.equal(preview.sound?.musicTierFloor, sound ? 1 : undefined);
  }
  assert.deepEqual(store.read(), { meters: 800, status: 'discovered' });
  assert.equal(store.writes.length, 0);
});

test('audio unlock precedes fullscreen and focused replay or mute retains native activation', () => {
  const store = storage({ meters: 500, status: 'discovered' });
  const page = browser(undefined, store);
  const shade = page.elements['death-shade'];
  assert.equal(shade.hidden, true);
  page.elements.game.requestFullscreen = () => page.events.push(['fullscreen']);
  page.click('start', { pointerType: 'touch' });
  assert.equal(shade.hidden, true);
  assert.deepEqual(page.events.slice(0, 2), [['unlock'], ['fullscreen']]);

  assert.equal(page.key('Space', 'mute'), false);
  assert.equal(page.run.airborne, false);
  page.click('mute');
  assert.equal(page.elements.mute.attributes['aria-pressed'], 'true');
  assert.ok(page.events.some(([name, muted]) => name === 'mute' && muted));
  page.until(() => page.mode === 'ended');
  const persisted = store.read();
  const ended = page.run;
  const frozenTime = page.sceneFrame.time;
  assert.equal(shade.hidden, false);

  assert.equal(page.key('Enter', 'replay-1'), false);
  page.click('replay-1');
  assert.equal(shade.hidden, true);
  assert.equal(page.elements['replay-1'].textContent, 'Stop clue 1');
  assert.equal(page.key('Enter', 'replay-1', true), true);
  page.step(30);
  assert.equal(page.mode, 'ended');
  assert.equal(page.sound.mode, 'ended');
  assert.equal(page.sound.musicTierFloor, 2);
  assert.ok(page.sound.transmissionTime > 0);
  assert.ok(page.sceneFrame.time > frozenTime);
  page.setHidden(true);
  const pausedAt = page.sound.transmissionTime;
  page.step(2, 30_000);
  assert.equal(page.sound.transmissionTime, pausedAt);
  page.setHidden(false);
  page.step();
  assert.equal(page.sound.transmissionTime, pausedAt);
  page.until(() => page.sound.transmissionTime === null);
  assert.equal(shade.hidden, false);
  assert.equal(page.sceneFrame.dt, 0);
  assert.equal(page.elements['replay-1'].textContent, 'Replay clue 1');
  assert.equal(page.run, ended);
  assert.equal(500 + page.run.distance, persisted.meters);
  assert.deepEqual(store.read(), persisted);

  assert.equal(page.key('Space', 'replay-1'), false);
  page.click('replay-1');
  assert.equal(shade.hidden, true);
  page.click('replay-1');
  assert.equal(shade.hidden, false);
  page.click('replay-1');
  page.click('restart');
  page.step();
  assert.equal(page.mode, 'running');
  assert.equal(page.sound.transmissionTime, null);
  assert.notEqual(page.run, ended);
  assert.equal(page.run.distance, 0);
  assert.equal(shade.hidden, true);
  assert.deepEqual(store.read(), persisted);
});

test('foreground pause and lag at both safe-window boundaries keep simulation and presentation in sync', () => {
  const page = browser('?preview=clue1');
  page.click('start');
  page.step();
  page.step(1, 5_000);
  assert.equal(page.run.transmission.phase, 'playing');
  assert.equal(page.run.time, STEP);
  assert.equal(page.sound.transmissionTime, 0);

  page.step(30);
  const pausedAt = page.run.time;
  const pausedTransmission = page.run.transmission.elapsed;
  page.setHidden(true);
  page.step(2, 30_000);
  assert.equal(page.run.time, pausedAt);
  assert.equal(page.sound.transmissionTime, pausedTransmission);
  page.setHidden(false);
  page.step();
  assert.equal(page.run.time, pausedAt);
  assert.equal(page.sound.transmissionTime, pausedTransmission);
  assert.deepEqual(page.events.filter(([event]) => event === 'suspend' || event === 'resume'),
    [['suspend'], ['resume']]);

  page.until(() => page.run.transmission.elapsed >= CLUES[0].duration - 0.05);
  assert.equal(page.run.transmission.phase, 'playing');
  assert.equal(page.sound.transmissionTime, page.run.transmission.elapsed);
  page.step(1, 30_000);
  assert.equal(page.run.transmission.phase, 'complete');
  assert.ok(Math.abs(page.run.time - (CLUES[0].duration + STEP)) < 1e-9);
  assert.equal(page.sound.transmissionTime, null);
  const distance = page.run.distance;
  page.step();
  assert.ok(page.run.distance - distance < page.run.speed * 0.026);
});

test('legacy pending survives below the modern threshold and exact thresholds queue in order', () => {
  const pending = storage({ meters: 150, status: 'pending' });
  const restored = pending.progress();
  assert.equal(restored.meters, 150);
  assert.equal(restored.pendingClue, 1);
  restored.discover(2);
  assert.equal(pending.progress().discoveredClues, 0);
  restored.discover(1);
  assert.equal(pending.progress().discoveredClues, 1);
  assert.equal(pending.progress().pendingClue, null);

  assert.deepEqual(CLUES.map(({ meters, duration }) => [meters, duration]),
    [[5000, 8], [20000, 8], [50000, 10], [90000, 12]]);
  for (const [index, { meters }] of CLUES.entries()) {
    const store = storage({ meters: index ? 500 : 0, status: index ? 'discovered' : 'locked' });
    const active = store.progress();
    const distance = meters - active.meters;
    active.credit(distance - 0.25);
    assert.equal(active.eligibleClues, index);
    active.credit(distance);
    const reloaded = store.progress();
    assert.equal(reloaded.eligibleClues, index + 1);
    for (let ordinal = index ? 2 : 1; ordinal <= index + 1; ordinal++) {
      assert.equal(reloaded.pendingClue, ordinal);
      reloaded.discover(ordinal);
    }
    assert.equal(store.progress().pendingClue, null);
  }
});

test('stacked cues finish live with a returning hazard between them and keep the launch profile until restart', () => {
  const store = storage({ meters: 9010, status: 'locked' });
  const page = browser(undefined, store);
  page.click('start');
  let returningRow;
  for (const [index, clue] of CLUES.entries()) {
    const ordinal = index + 1;
    page.until(() => {
      steerSafely(page);
      return page.sound.transmissionClue === ordinal;
    }, 1500);
    const request = page.events.filter(([name]) => name === 'request').at(-1);
    assert.deepEqual(request.slice(3), [ordinal, clue.duration]);
    if (returningRow) assert.ok(request[1] >= returningRow.z + 2);
    assert.equal(store.progress().discoveredClues, index);
    assert.equal(page.starSignal.clueNumber, ordinal);
    assert.equal(page.sound.transmissionTime, 0);
    assert.equal(page.document.body.dataset.signalNoise, ordinal === 1 ? 'true' : 'false');
    page.until(() => page.sound.transmissionTime >= PULSE_LEAD);
    assert.equal(page.document.body.dataset.signalNoise, 'true');
    assert.equal(page.document.body.dataset.signalInvert, ordinal === 4 ? 'true' : 'false');
    assert.equal(page.elements['death-shade'].hidden, true);
    assert.equal(page.elements['sky-signal'].textContent, clue.line);
    assert.equal(store.progress().discoveredClues, index);
    page.until(() => page.run.transmission?.phase === 'complete');
    assert.equal(store.progress().discoveredClues, ordinal);
    assert.equal(page.starDiscovered, ordinal);
    assert.equal(page.starSignal, null);
    assert.equal(page.sound.musicTierFloor, 1);
    assert.ok(Math.abs(page.run.baseSpeed - (ENDLESS_START_SPEED + 1.8 * page.run.time)) < 1e-8);
    returningRow = page.run.obstacles.find(({ z }) => z > page.run.distance);
    assert.ok(returningRow.z > page.run.distance + page.run.viewDistance);
  }
  assert.equal(store.progress().pendingClue, null);
  assert.equal(page.events.filter(([name]) => name === 'request').length, 4);
  while (page.run.lane !== returningRow.lane) page.run.move(returningRow.lane - page.run.lane);
  page.until(() => page.mode === 'ended');
  const ended = page.run;
  const meters = store.progress().meters;
  assert.ok(Math.abs(meters - (9010 + ended.distance)) < 1e-8);
  for (const [index, clue] of CLUES.entries()) {
    const ordinal = index + 1;
    const id = `replay-${ordinal}`;
    assert.equal(page.elements[id].hidden, false);
    page.click(id);
    assert.equal(page.sound.transmissionClue, ordinal);
    assert.equal(page.sound.transmissionDuration, clue.duration);
    assert.equal(page.document.body.dataset.signalNoise, ordinal === 1 ? 'true' : 'false');
    page.step(78);
    assert.equal(page.elements['sky-signal'].textContent, clue.line);
    assert.equal(page.document.body.dataset.signalNoise, 'true');
    assert.equal(store.progress().meters, meters);
    assert.equal(page.run, ended);
  }
  page.click('restart');
  page.step();
  assert.equal(page.sound.transmissionClue, null);
  assert.equal(page.sound.musicTierFloor, 5);
  assert.equal(page.run.speed, 176);
  assert.equal(page.run.distance, 0);
  assert.equal(store.progress().meters, meters);
});

test('each isolated preview uses its ordinal on clear track with a readable cue even without a soundtrack', () => {
  const store = storage({ meters: 9000, status: 'pending' });
  const lines = ['', 'What is that?', 'Saw the light again', 'Still there. Looks like a beacon. We need to reach it'];
  for (let ordinal = 1; ordinal <= CLUES.length; ordinal++) {
    const page = browser(`?preview=clue${ordinal}`, store, { sound: false });
    assert.equal(page.starDiscovered, 0);
    page.click('start');
    page.until(() => page.starSignal?.elapsed === 0);
    assert.equal(page.starSignal.clueNumber, ordinal);
    assert.equal(page.run.musicTierFloor, 1);
    assert.equal(page.run.obstacles.length, 0);
    page.until(() => page.starSignal?.elapsed >= PULSE_LEAD);
    assert.equal(page.elements['sky-signal'].textContent, lines[ordinal - 1]);
    assert.equal(page.document.body.dataset.signalInvert, ordinal === 4 ? 'true' : 'false');
    page.until(() => page.run.transmission?.phase === 'complete');
    assert.equal(page.starDiscovered, ordinal);
    page.page('pagehide');
  }
  assert.equal(store.progress().discoveredClues, 0);
  assert.equal(store.progress().meters, 9000);
  assert.equal(store.writes.length, 0);
});

test('an ordinary launch refreshes another tab’s capture before taking the profile snapshot', () => {
  const store = storage({ meters: 500, status: 'pending' });
  const ready = browser(undefined, store);
  const capturing = browser(undefined, store);
  capturing.click('start');
  capturing.key('ArrowLeft');
  capturing.until(() => capturing.run.transmission?.phase === 'complete');
  assert.equal(capturing.sound.musicTierFloor, 1);
  assert.equal(ready.run.speed, ENDLESS_START_SPEED);
  ready.key('Enter');
  ready.step();
  assert.equal(ready.run.speed, ADVANCED_START_SPEED);
  assert.equal(ready.sound.musicTierFloor, 2);
  assert.equal(ready.run.transmission, null);
  assert.equal(store.progress().discoveredClues, 1);
});

test('a late capture interrupted by navigation stays pending, and a duplicate live completion only discovers that ordinal', () => {
  const store = storage({ meters: 9000, status: 'discovered' });
  store.progress().discover(2);
  const enterThirdCue = (page) => {
    page.click('start');
    page.until(() => {
      steerSafely(page);
      return page.sound.transmissionClue === 3;
    });
    assert.equal(page.sound.musicTierFloor, 3);
  };
  const interrupted = browser(undefined, store);
  enterThirdCue(interrupted);
  interrupted.step(150);
  interrupted.setHidden(true);
  interrupted.step(1, 30000);
  interrupted.page('pagehide');
  assert.equal(store.progress().discoveredClues, 2);
  assert.equal(store.progress().pendingClue, 3);

  const first = browser(undefined, store);
  const second = browser(undefined, store);
  enterThirdCue(first);
  enterThirdCue(second);
  for (const page of [first, second]) {
    page.until(() => page.run.transmission?.phase === 'complete');
    page.page('pagehide');
  }
  assert.equal(store.progress().discoveredClues, 3);
  assert.equal(store.progress().pendingClue, 4);
  const measured = 9000 + interrupted.run.distance + first.run.distance + second.run.distance;
  assert.ok(Math.abs(store.progress().meters - measured) < 1e-8);
});

test('Relay Nine remains visible before any discovery, and reduced motion holds each clue’s distinct glow steady', () => {
  const read = (file) => readFileSync(join(__dirname, '..', file), 'utf8');
  const context = vm.createContext({ VoidRunner: require('../game.js'), VoidEpisode: require('../episode.js') });
  vm.runInContext(read('scene.js'), context);
  let radius;
  let fill;
  const ctx = {
    createRadialGradient(_x, _y, _inner, _cx, _cy, outer) {
      radius = outer;
      return { addColorStop() {} };
    },
    fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill() { fill = this.fillStyle; },
  };
  const scene = { ctx, width: 667, height: 240, insets: [0, 0, 0, 0], reduceMotion: true };
  const relayNine = context.VoidScene.prototype.relayNine.bind(scene);
  relayNine(0, 0);
  assert.equal(fill, '#fff');
  assert.equal(radius, 11);
  for (let ordinal = 1; ordinal <= CLUES.length; ordinal++) {
    const previousRadius = radius;
    relayNine(0, ordinal, { clueNumber: ordinal, elapsed: 0 });
    assert.ok(radius > previousRadius);
    const initialRadius = radius;
    relayNine(32, ordinal);
    assert.equal(radius, initialRadius);
  }
  scene.reduceMotion = false;
  relayNine(0, 3, { clueNumber: 4, elapsed: 0 });
  assert.equal(radius, 11);
  relayNine(0, 3, { clueNumber: 4, elapsed: PULSE_LEAD });
  assert.ok(radius > 11);
});

test('without Web Locks, interleaved page checkpoints and repeated reloads compact without losing a suspended writer', async () => {
  const store = storage({ meters: 90, status: 'pending' });
  const databaseFactory = storageTransactions();
  const open = () => browser(undefined, store, { databaseFactory });
  const suspended = open();
  const second = open();
  suspended.click('start');
  second.click('start');
  suspended.step(7);
  second.step(12);
  store.beforeWrite = () => {
    delete store.beforeWrite;
    second.page('pagehide');
  };
  suspended.setHidden(true);
  let total = 90 + suspended.run.distance + second.run.distance;
  assert.ok(Math.abs(store.progress().meters - total) < 1e-9);
  for (let reload = 0; reload < 40; reload++) {
    const page = open();
    page.click('start');
    page.step(8);
    page.page('pagehide');
    total += page.run.distance;
    await databaseFactory.idle();
    assert.equal(store.progress().pendingClue, 1);
  }
  assert.ok(Object.keys(store).filter((key) => key.startsWith(SAVE_KEY + ':')).length <= 16);
  assert.ok(Math.abs(store.progress().meters - total) < 1e-9);
  const oldDistance = suspended.run.distance;
  suspended.setHidden(false);
  suspended.step(11);
  suspended.page('pagehide');
  assert.ok(Math.abs(store.progress().meters - (total + suspended.run.distance - oldDistance)) < 1e-9);
});

test('an interrupted merge is readable before cleanup and completes on a later load', async () => {
  const store = storage({ meters: 490, status: 'pending' });
  const databaseFactory = storageTransactions();
  const progress = new EpisodeProgress({ storage: store, databaseFactory });
  progress.discover(1);
  store.removeItem = () => { throw new Error('storage disappeared during cleanup'); };
  for (let step = 1; step <= 16; step++) {
    progress.credit(step, step);
  }
  await databaseFactory.idle();
  assert.equal(store.progress().meters, 506);
  assert.equal(store.progress().bankedBolts, 16);
  assert.equal(store.progress().discoveredClues, 1);
  store.removeItem = (key) => { delete store[key]; };
  new EpisodeProgress({ storage: store, databaseFactory });
  await databaseFactory.idle();
  assert.equal(store.progress().meters, 506);
  assert.equal(store.progress().bankedBolts, 16);
  assert.equal(store.progress().discoveredClues, 1);
  assert.equal(Object.keys(store).filter((key) => key.startsWith(ENTRY)).length, 1);
});

test('failed writes keep exact unsaved distance and discovery in memory and retry once available', () => {
  const store = storage({ meters: 490, status: 'pending' });
  const save = store.setItem;
  store.setItem = () => { throw new Error('quota exceeded'); };
  const active = store.progress();
  active.credit(10.25);
  active.discover(1);
  assert.equal(active.meters, 500.25);
  assert.equal(active.discoveredClues, 1);
  assert.equal(store.progress().discoveredClues, 0);
  active.beginRun();
  active.credit(0.5);
  store.setItem = save;
  active.save();
  active.save();
  assert.equal(store.writes.length, 1);
  assert.equal(store.progress().meters, 500.75);
  assert.equal(store.progress().discoveredClues, 1);
});

test('reset retires every older source of clue progress while keeping the bolt bank and settings', () => {
  const store = storage({ meters: 300, status: 'pending' });
  store[LEGACY_CHECKPOINT] = JSON.stringify({ meters: 4800, discoveredClues: 1 });
  store[LEGACY_ENTRY + 'old'] = JSON.stringify({ meters: 50, discoveredClues: 2 });
  const included = ENTRY + 'already-merged';
  store[CHECKPOINT] = JSON.stringify({ version: 2, meters: 60000, bolts: 17, discoveredClues: 3, merging: [included] });
  store[included] = JSON.stringify({ version: 2, meters: 10000, bolts: 11, discoveredClues: 2 });
  store[ENTRY + 'old'] = JSON.stringify({ version: 2, meters: 40000, bolts: 19, discoveredClues: 3 });
  store['void-runner-installed'] = 'yes';
  store['another-game'] = 'unchanged';
  const progress = store.progress();
  assert.equal(progress.pendingClue, 4);
  assert.equal(progress.bankedBolts, 36);
  assert.equal(progress.reset(), true);

  // An older page can still finish a write and bank its pickup, using its original format.
  store[SAVE_KEY] = JSON.stringify({ meters: 9000, status: 'discovered' });
  store[LEGACY_ENTRY + 'late'] = JSON.stringify({ meters: 1000, discoveredClues: 4 });
  store[ENTRY + 'late'] = JSON.stringify({ version: 2, meters: 10000, bolts: 5, discoveredClues: 4 });
  const reopened = store.progress();
  assert.equal(reopened.meters, 0);
  assert.equal(reopened.discoveredClues, 0);
  assert.equal(reopened.pendingClue, null);
  assert.equal(reopened.bankedBolts, 41);
  assert.equal(store['void-runner-installed'], 'yes');
  assert.equal(store['another-game'], 'unchanged');

  reopened.beginRun();
  reopened.credit(CLUES[0].meters - 0.25, 3);
  assert.equal(reopened.pendingClue, null);
  reopened.credit(CLUES[0].meters);
  assert.equal(reopened.pendingClue, 1);
  reopened.discover(1);
  assert.equal(store.progress().discoveredClues, 1);
  assert.equal(store.progress().pendingClue, null);
  assert.equal(store.progress().meters, CLUES[0].meters);
  assert.equal(store.progress().bankedBolts, 44);
});

test('a durable reset keeps confirmed and unconfirmed bolts distinct across retries', () => {
  const store = storage({ meters: 8900, status: 'discovered' });
  const write = store.setItem;
  const progress = store.progress();
  progress.credit(9, 2);
  store.setItem = (key, value) => {
    if (key !== RESET_KEY) throw new Error('journal writes rejected');
    write.call(store, key, value);
  };
  progress.credit(25, 9);
  progress.discover(2);
  assert.equal(progress.reset(), true);
  assert.equal(progress.bankedBolts, 2);
  assert.equal(progress.unsavedBolts, 7);
  assert.equal(progress.hasUnsaved, true);
  progress.credit(26, 9);
  progress.discover(1);
  assert.equal(progress.meters, 0);
  assert.equal(progress.discoveredClues, 0);

  store.setItem = write;
  progress.save();
  progress.save();
  assert.equal(progress.hasUnsaved, false);
  assert.equal(store.progress().bankedBolts, 9);
  assert.equal(store.progress().meters, 0);
  progress.beginRun();
  progress.credit(4, 1);
  assert.equal(store.progress().bankedBolts, 10);
  assert.equal(store.progress().meters, 4);
});

test('a reset with denied storage stays private while bolt pickups can retry when storage returns', () => {
  const store = storage({ meters: 8900, status: 'discovered' });
  const write = store.setItem;
  const read = store.getItem;
  const progress = store.progress();
  progress.credit(9, 2);
  store.setItem = store.getItem = () => { throw new Error('storage blocked'); };
  progress.credit(29, 4);
  assert.equal(progress.reset(), false);
  assert.equal(progress.bankedBolts, 2);
  assert.equal(progress.unsavedBolts, 2);
  assert.equal(progress.meters, 0);
  assert.equal(progress.discoveredClues, 0);
  assert.equal(progress.pendingClue, null);

  progress.beginRun();
  progress.credit(CLUES[0].meters, 1);
  assert.equal(progress.pendingClue, 1);
  progress.discover(1);
  store.setItem = write;
  store.getItem = read;
  progress.save();
  progress.save();
  assert.equal(store[RESET_KEY], undefined);
  assert.equal(progress.meters, CLUES[0].meters);
  assert.equal(progress.discoveredClues, 1);
  assert.equal(progress.unsavedBolts, 0);
  assert.equal(store.progress().meters, 8909);
  assert.equal(store.progress().discoveredClues, 1);
  assert.equal(store.progress().bankedBolts, 5);
});

test('racing resets reject distance and discovery from in-flight and stale tabs but keep all bolt deltas', () => {
  const store = storage({ meters: 9000, status: 'discovered' });
  const stale = store.progress();
  const newer = store.progress();
  store.beforeWrite = () => {
    delete store.beforeWrite;
    assert.equal(newer.reset(), true);
  };
  stale.credit(39, 4);
  assert.equal(stale.meters, 0);
  assert.equal(stale.bankedBolts, 4);
  assert.equal(stale.discoveredClues, 0);

  stale.beginRun();
  stale.credit(55, 7);
  const earlierReset = store[RESET_KEY];
  const suspended = store.progress();
  suspended.credit(10);
  store.beforeWrite = (key) => {
    if (key !== RESET_KEY) return;
    delete store.beforeWrite;
    // This reset and its first run finish before the outer reset's marker becomes visible.
    assert.equal(stale.reset(), true);
    stale.beginRun();
    stale.credit(40, 4);
  };
  assert.equal(newer.reset(), true);
  assert.notEqual(store[RESET_KEY], earlierReset);
  suspended.credit(12, 3);
  suspended.credit(13, 3);
  suspended.save();
  assert.equal(store.progress().meters, 0);
  assert.equal(store.progress().bankedBolts, 18);
  suspended.beginRun();
  suspended.credit(2, 1);
  assert.equal(store.progress().meters, 2);
  assert.equal(store.progress().bankedBolts, 19);
});

test('an interrupted compaction racing a new reset preserves the active story and each bank deposit once', async () => {
  const store = storage();
  const databaseFactory = storageTransactions();
  const writer = new EpisodeProgress({ storage: store, databaseFactory });
  writer.reset();
  writer.beginRun();
  const writeDuringMerge = store.progress();
  store.beforeWrite = (key) => {
    if (key !== RESET_CHECKPOINT) return;
    delete store.beforeWrite;
    writeDuringMerge.reset();
    writeDuringMerge.beginRun();
    writeDuringMerge.credit(CLUES[0].meters + 13, 5);
    writeDuringMerge.discover(1);
  };
  const remove = store.removeItem;
  store.removeItem = (key) => {
    if (key.startsWith(RESET_ENTRY)) throw new Error('interrupted checkpoint cleanup');
    remove.call(store, key);
  };
  for (let step = 1; step <= 16; step++) writer.credit(step, step);
  await databaseFactory.idle();
  assert.equal(JSON.parse(store[RESET_CHECKPOINT]).merging.length, 16);
  const check = () => {
    const state = store.progress();
    assert.equal(state.meters, CLUES[0].meters + 13);
    assert.equal(state.discoveredClues, 1);
    assert.equal(state.bankedBolts, 21);
  };
  check();
  store.removeItem = remove;
  new EpisodeProgress({ storage: store, databaseFactory });
  await databaseFactory.idle();
  assert.equal(JSON.parse(store[RESET_CHECKPOINT]).merging, undefined);
  check();
});

test('previous thresholds are grandfathered using only the old subtotal, including both journals and a partial merge', async () => {
  for (const [index, threshold] of [500, 2000, 5000, 9000].entries()) {
    const below = storage({ meters: threshold - 0.25, status: 'locked' }).progress();
    const reached = storage({ meters: threshold, status: 'locked' }).progress();
    assert.equal(below.eligibleClues, index);
    assert.equal(reached.eligibleClues, index + 1);
    assert.equal(reached.discoveredClues, 0);
    assert.equal(reached.pendingClue, 1);
    assert.equal(reached.meters, threshold);
  }
  const store = storage({ meters: 350, status: 'discovered' });
  const oldPresent = LEGACY_ENTRY + 'included';
  const oldDeleted = LEGACY_ENTRY + 'already-removed';
  const modernPresent = ENTRY + 'included';
  store[LEGACY_CHECKPOINT] = JSON.stringify({ meters: 1300, discoveredClues: 1, merging: [oldPresent, oldDeleted] });
  store[oldPresent] = JSON.stringify({ meters: 400, discoveredClues: 0 });
  store[LEGACY_ENTRY + 'remaining'] = JSON.stringify({ meters: 349, discoveredClues: 0 });
  store[CHECKPOINT] = JSON.stringify({ version: 2, meters: 3000, bolts: 6, discoveredClues: 0, merging: [modernPresent] });
  store[modernPresent] = JSON.stringify({ version: 2, meters: 1300, bolts: 4, discoveredClues: 0 });
  const check = (meters, clues, bolts, discovered = 1) => {
    const state = store.progress();
    assert.equal(state.meters, meters);
    assert.equal(state.eligibleClues, clues);
    assert.equal(state.discoveredClues, discovered);
    assert.equal(state.bankedBolts, bolts);
  };
  check(4999, 1, 6);
  const databaseFactory = storageTransactions();
  const modern = new EpisodeProgress({ storage: store, databaseFactory });
  modern.credit(3900, 3);
  await databaseFactory.idle();
  check(8899, 1, 9);
  assert.equal(store[oldPresent], undefined);
  assert.equal(store[modernPresent], undefined);
  assert.equal(JSON.parse(store[LEGACY_CHECKPOINT]).merging, undefined);
  assert.equal(JSON.parse(store[CHECKPOINT]).version, 2);
  // A tab still running the previous build can append an unversioned entry after the upgrade.
  store[LEGACY_ENTRY + 'older-tab'] = JSON.stringify({ meters: 1, discoveredClues: 0 });
  modern.refresh();
  assert.equal(modern.pendingClue, 2);
  check(8900, 2, 9);
  modern.discover(2);
  check(8900, 2, 9, 2);
});

test('cumulative bolt credits are integer deltas across duplicate updates, tabs, write rejection and retry', () => {
  const store = storage();
  const first = store.progress();
  const second = store.progress();
  first.credit(45, 2);
  first.credit(46, 2);
  first.credit(47, 1.5);
  first.credit(48, -10);
  assert.equal(store.writes.length, 1);
  second.credit(15, 3);
  assert.equal(store.progress().bankedBolts, 5);
  const write = store.setItem;
  store.setItem = () => { throw new Error('storage temporarily full'); };
  first.credit(49, 5);
  first.beginRun();
  first.credit(2, 4);
  assert.equal(first.bankedBolts, 5);
  assert.equal(first.unsavedBolts, 7);
  assert.equal(store.progress().bankedBolts, 5);
  assert.ok(first.hasUnsaved);
  store.setItem = write;
  first.save();
  first.save();
  second.save();
  assert.equal(first.hasUnsaved, false);
  assert.equal(store.progress().bankedBolts, 12);
  assert.equal(store.progress().meters, 66);
});

function addPickup(run, z = run.distance) {
  run.bolts.unshift({ id: 'test-bolt', lane: run.lane, z, height: 0.82 });
}

test('only ordinary loopback HTTP or HTTPS shows reset, and only between runs', () => {
  for (const origin of ['http://localhost', 'https://127.0.0.1:9000', 'http://[::1]']) {
    const page = browser(undefined, storage(), { origin });
    assert.equal(page.elements['reset-clues'].hidden, false);
    assert.equal(page.elements['reset-results-clues'].hidden, true);
    page.click('start');
    assert.equal(page.elements['reset-clues'].hidden, true);
    assert.equal(page.elements['reset-results-clues'].hidden, true);
    page.click('reset-clues');
    assert.equal(page.mode, 'running');
    assert.equal(page.store[RESET_KEY], undefined);
    page.until(() => page.mode === 'ended');
    assert.equal(page.elements['reset-results-clues'].hidden, false);
  }
  for (const [origin, query] of [
    ['https://game.example', '?reset=1'],
    ['http://127.0.0.2', '?seed=187'],
    ['http://localhost.example', '?seed=187'],
    ['http://192.168.1.1', '?seed=187'],
    ['file:///index.html', '?seed=187'],
    ['http://localhost', '?preview=clue1'],
    ['http://localhost', '?scenario=landing'],
    ['http://localhost', '?pace=fast'],
  ]) {
    const page = browser(query, storage(), { origin });
    assert.equal(page.elements['reset-clues'].hidden, true);
    assert.equal(page.elements['reset-results-clues'].hidden, true);
    page.click('reset-clues');
    assert.equal(page.store[RESET_KEY], undefined);
  }
});

test('reset at results stops the active replay and clears the scene and launch profile', () => {
  const store = storage({ meters: 9000, status: 'discovered' });
  store[CHECKPOINT] = JSON.stringify({ version: 2, meters: 90000, bolts: 43, discoveredClues: 4 });
  const page = browser(undefined, store, { origin: 'http://localhost', touch: true });
  assert.equal(page.key('Enter', 'reset-clues'), false);
  assert.equal(page.key('Space', 'reset-clues'), false);
  page.click('mute');
  page.click('start');
  page.until(() => page.mode === 'ended');
  page.click('replay-4');
  page.until(() => page.sound.transmissionTime > PULSE_LEAD);
  assert.equal(page.document.body.dataset.signalInvert, 'true');
  assert.equal(page.elements['death-shade'].hidden, true);
  assert.equal(page.starDiscovered, 4);
  assert.equal(page.key('Enter', 'reset-results-clues'), false);
  assert.equal(page.key('Space', 'reset-results-clues'), false);
  assert.equal(page.key('Enter', 'reset-results-clues', true), true);
  page.click('reset-results-clues');
  page.step();
  assert.equal(page.mode, 'ready');
  assert.equal(page.elements['death-shade'].hidden, true);
  assert.equal(page.document.activeElement, page.elements.start);
  assert.equal(page.elements['clue-reset-status'].textContent, 'Clue progress reset.');
  assert.equal(page.elements.recordings.hidden, true);
  assert.equal(page.elements['sky-signal'].textContent, '');
  assert.equal(page.document.body.dataset.signal, '0');
  assert.equal(page.document.body.dataset.signalNoise, 'false');
  assert.equal(page.document.body.dataset.signalInvert, 'false');
  assert.equal(page.starDiscovered, 0);
  assert.equal(page.starSignal, null);
  assert.equal(page.sound.transmissionTime, null);
  assert.equal(page.elements.mute.attributes['aria-pressed'], 'true');
  assert.equal(store.progress().bankedBolts, 43);

  page.page('pagehide');
  page.setHidden(true);
  page.setHidden(false);
  page.page('pageshow');
  assert.equal(store.progress().meters, 0);
  page.click('start');
  page.step();
  assert.equal(page.run.distance, 0);
  assert.equal(page.run.speed, ENDLESS_START_SPEED);
  assert.equal(page.sound.musicTierFloor, 1);
  assert.equal(page.run.transmission, null);
  assert.equal(page.elements['clue-reset-status'].textContent, '');
});

test('a peer reset cancels an active transmission and a suspended page cannot restore the old run', () => {
  const store = storage({ meters: 500, status: 'pending' });
  const open = () => browser(undefined, store, { origin: 'http://127.0.0.1' });
  const active = open();
  const suspended = open();
  for (const page of [active, suspended]) {
    page.click('start');
    page.key('ArrowLeft');
    page.until(() => page.run.transmission?.phase === 'playing');
  }
  suspended.setHidden(true);
  const resetter = open();
  resetter.click('reset-clues');
  active.page('storage', { key: RESET_KEY });
  active.step();
  suspended.setHidden(false);
  suspended.step();
  for (const page of [active, suspended]) {
    assert.equal(page.mode, 'ready');
    assert.equal(page.run.transmission, null);
    assert.equal(page.elements['signal-status'].textContent, '');
    assert.equal(page.elements['clue-reset-status'].textContent, 'Clue progress reset in another tab.');
    page.page('pagehide');
    page.step(600);
  }
  assert.equal(store.progress().meters, 0);
  assert.equal(store.progress().pendingClue, null);
  assert.equal(store.progress().discoveredClues, 0);
});

test('ready feedback reflects a session-only reset and retries pending pickups independently', () => {
  const origin = 'http://localhost';
  const withoutStorage = browser(undefined, null, { origin });
  withoutStorage.click('reset-clues');
  assert.equal(withoutStorage.elements['clue-reset-status'].textContent, 'Clue progress reset for this page only.');

  const store = storage();
  const page = browser(undefined, store, { origin });
  page.click('start');
  page.step();
  addPickup(page.run);
  const write = store.setItem;
  store.setItem = () => { throw new Error('storage temporarily blocked'); };
  page.until(() => page.mode === 'ended');
  page.click('reset-results-clues');
  assert.equal(page.mode, 'ready');
  assert.equal(page.elements['clue-reset-status'].textContent,
    'Clue progress reset for this page only. Bolt pickups are waiting to save.');
  store.setItem = write;
  page.step(70);
  assert.equal(page.elements['clue-reset-status'].textContent, 'Clue progress reset for this page only.');
  assert.equal(store.progress().bankedBolts, 1);
  page.page('pagehide');
  assert.equal(store.progress().bankedBolts, 1);
});

test('a terminal-tick pickup appears in results and retries a failed bank write without double credit', () => {
  const store = storage({ meters: 500, status: 'discovered' });
  // Start at the unchanged basic hurdle for a terminal impact on the immediately following tick.
  const basic = storage();
  const page = browser(undefined, basic);
  page.click('start');
  page.until(() => page.run.distance >= 76.97, 400, STEP * 1000);
  assert.equal(page.mode, 'running');
  assert.equal(page.run.boltsCollected, 0);
  addPickup(page.run, 77.25);
  const write = basic.setItem;
  basic.setItem = () => { throw new Error('storage temporarily full'); };
  page.until(() => page.mode === 'ended');
  assert.equal(page.run.distance, 77.39);
  assert.equal(page.run.boltsCollected, 1);
  assert.equal(page.elements['final-bolts'].textContent, '1');
  assert.equal(page.elements['banked-bolts'].textContent, '0');
  assert.equal(page.elements['bolt-save-status'].textContent, ' · Saving…');
  assert.equal(basic.progress().bankedBolts, 0);
  basic.setItem = write;
  page.step(65);
  assert.equal(page.elements['banked-bolts'].textContent, '1');
  assert.equal(page.elements['bolt-save-status'].textContent, '');
  assert.equal(basic.progress().bankedBolts, 1);
  page.page('pagehide');
  page.page('pagehide');
  page.page('pageshow');
  page.click('restart');
  page.step();
  assert.equal(page.elements.bolts.textContent, '0');
  assert.equal(basic.progress().bankedBolts, 1);

  const replay = browser(undefined, store);
  replay.click('start');
  replay.step();
  addPickup(replay.run);
  replay.until(() => replay.run.boltsCollected === 1);
  replay.until(() => replay.mode === 'ended');
  const beforeReplay = store.progress().meters;
  replay.click('replay-1');
  replay.step(600);
  replay.page('pagehide');
  assert.equal(store.progress().bankedBolts, 1);
  assert.equal(store.progress().meters, beforeReplay);
});

test('pagehide during death retries the terminal distance and pickup exactly once', () => {
  const store = storage();
  const page = browser(undefined, store);
  page.click('start');
  page.until(() => page.run.distance >= 76.97, 400, STEP * 1000);
  addPickup(page.run, 77.25);
  const write = store.setItem;
  store.setItem = () => { throw new Error('storage temporarily full'); };
  page.until(() => page.mode === 'dying');
  assert.equal(page.run.boltsCollected, 1);
  assert.ok(store.progress().meters < page.run.distance);
  assert.equal(store.progress().bankedBolts, 0);

  store.setItem = write;
  page.page('pagehide');
  assert.equal(store.progress().meters, page.run.distance);
  assert.equal(store.progress().bankedBolts, 1);
  const writes = store.writes.length;
  page.page('pagehide');
  page.page('pageshow');
  page.until(() => page.mode === 'ended');
  assert.equal(store.writes.length, writes);
  assert.equal(page.elements['final-bolts'].textContent, '1');
  assert.equal(page.elements['banked-bolts'].textContent, '1');
});

test('results distinguish a session-only pickup from a saved bank', () => {
  const page = browser(undefined, null);
  page.click('start');
  page.step();
  addPickup(page.run);
  page.until(() => page.mode === 'ended');
  assert.equal(page.elements['final-bolts'].textContent, '1');
  assert.equal(page.elements['bolt-bank'].hidden, true);
  assert.equal(page.elements['bolt-save-status'].textContent, ' · Session only');
  page.page('pagehide');
  const fresh = browser(undefined, null);
  assert.equal(fresh.run.boltsCollected, 0);
});

test('live clue bolt trails survive compaction, while practice and preview pickups remain isolated', async () => {
  const store = storage({ meters: 9000, status: 'discovered' });
  const prior = store.progress();
  prior.discover(2);
  prior.discover(3);
  const databaseFactory = storageTransactions();
  const page = browser(undefined, store, { databaseFactory });
  page.click('start');
  page.until(() => {
    steerSafely(page);
    return page.run.transmission?.phase === 'playing';
  });
  for (let frame = 0; frame < 900 && page.run.transmission.phase === 'playing'; frame++) {
    const next = page.run.bolts.find(({ transmission }) => transmission);
    if (next && next.lane !== page.run.lane) page.key(next.lane < page.run.lane ? 'ArrowLeft' : 'ArrowRight');
    page.step();
    if (frame % 60 === 0) await databaseFactory.idle();
  }
  assert.equal(page.run.transmission.phase, 'complete');
  assert.ok(page.run.boltsCollected >= 20);
  await databaseFactory.idle();
  const { meters, bankedBolts, discoveredClues } = store.progress();
  assert.equal(bankedBolts, page.run.boltsCollected);
  assert.equal(discoveredClues, 4);
  assert.ok(Object.keys(store).filter((key) => key.startsWith(ENTRY)).length < 16);
  assert.ok(JSON.parse(store[CHECKPOINT]).bolts > 0);
  for (const query of ['?preview=clue4', '?scenario=slide-gate', '?pace=fast']) {
    const practice = browser(query, store);
    practice.click('start');
    practice.step();
    addPickup(practice.run);
    practice.until(() => practice.run.boltsCollected === 1);
    assert.equal(practice.elements.bolts.textContent, '1');
    practice.page('pagehide');
  }
  assert.equal(store.progress().bankedBolts, bankedBolts);
  assert.equal(store.progress().discoveredClues, discoveredClues);
  assert.equal(store.progress().meters, meters);
});

test('both dash displays use game charge and recover a second when a bolt is collected', () => {
  for (const touch of [false, true]) {
    const page = browser('?scenario=landing', storage(), { touch });
    page.click('start');
    if (touch) page.elements['touch-dash'].handlers.pointerdown({ button: 0, pointerType: 'touch', pointerId: 1, preventDefault() {} });
    else page.key('KeyX');
    page.step(2);
    assert.equal(page.run.dashReadyAt, 4);
    assert.equal(page.elements['dash-label'].textContent, 'Dash active');
    assert.equal(page.elements['touch-dash'].dataset.state, 'active');
    const charge = page.run.dashCharge;
    addPickup(page.run);
    page.until(() => page.run.boltsCollected === 1);
    assert.equal(page.run.dashReadyAt, 3);
    assert.ok(page.run.dashCharge >= charge + 0.25);
    assert.equal(page.elements.charge.style.transform, `scaleX(${page.run.dashCharge.toFixed(3)})`);
    assert.equal(page.elements['touch-charge'].style.transform, page.elements.charge.style.transform);
    page.until(() => !page.run.dashing);
    assert.equal(page.elements['touch-dash'].dataset.state, 'charging');
    assert.equal(page.elements['dash-label'].textContent, 'Dash recharging');
    page.until(() => page.run.dashCharge === 1);
    assert.equal(page.elements['touch-dash'].dataset.state, 'ready');
    assert.equal(page.elements['dash-label'].textContent, 'Dash ready');
  }
});

test('practice shows hazard-specific cues, impacts and black hole pull', () => {
  for (const [scenario, type, cue, impact] of [
    ['platform', 'platform', /Jump onto the platform.*Space/, /platform’s edge/],
    ['slide-gate', 'slideGate', /Slide gate.*Swipe down now/, /hit a slide gate/],
    ['moving-barrier', 'movingBarrier', /Moving barrier.*Dodge/, /hit a moving barrier/],
    ['black-hole', 'blackHole', /Black hole ahead.*Pulls left/, null],
  ]) {
    const page = browser(`?scenario=${scenario}`, storage(), { touch: type === 'slideGate' });
    page.click('start');
    assert.equal(page.run.obstacles[0].type, type);
    page.until(() => cue.test(page.elements.feedback.textContent));
    if (impact) {
      page.until(() => page.mode === 'ended');
      assert.match(page.elements.impact.textContent, impact);
      assert.equal(page.elements['bolt-bank'].hidden, true);
    } else {
      page.until(() => page.run.lane === 1);
      assert.equal(page.mode, 'running');
      assert.equal(page.run.crash, null);
      assert.equal(page.elements.feedback.textContent, 'Black hole · Pulled left');
    }
  }
});

test('directional gap cue survives the middle lane of a two-input jump in either direction', () => {
  for (const touch of [false, true]) {
    for (const direction of [-1, 1]) {
      const page = browser('?scenario=landing', storage(), { touch });
      page.click('start');
      page.step();
      const launch = 2 - direction;
      const exit = 2 + direction;
      const move = (step) => touch ? page.swipe(40 * step, 0) : page.key(step < 0 ? 'ArrowLeft' : 'ArrowRight');
      const { run } = page;
      move(-direction);
      for (const lane of [0, 2, 4]) run.addClosure(63, lane, 65);
      run.addClosure(63, exit, 17);
      run.addObstacle(86, launch, 'gap', { end: 128, lateralExit: exit });
      const steering = touch ? (direction < 0 ? 'left' : 'right') : (direction < 0 ? '←' : '→');
      page.until(() => page.elements.feedback.textContent.includes(`then ${touch ? 'swipe' : 'press'} ${steering} twice`));
      page.until(() => page.elements.feedback.textContent.includes(touch ? 'Swipe up now' : 'Space now'));
      if (touch) page.swipe(0, -40);
      else page.key('Space');
      move(direction);
      page.step(4);
      assert.equal(run.lane, 2);
      assert.equal(page.elements.feedback.textContent, `${touch ? 'Swipe' : 'Press'} ${steering} to solid track`);
      move(direction);
      page.until(() => run.distance >= 100);
      assert.equal(run.lane, exit);
      assert.equal(run.crash, null);
    }
  }
});

test('moving barrier and four-lane gap guidance identify available dodges', () => {
  for (const touch of [false, true]) {
    const moving = browser('?scenario=moving-barrier', storage(), { touch });
    moving.click('start');
    moving.step();
    moving.run.dashReadyAt = 3;
    moving.until(() => /Moving barrier/.test(moving.elements.feedback.textContent));
    assert.equal(moving.elements.feedback.textContent,
      touch ? 'Moving barrier · Swipe aside' : 'Moving barrier · Dodge with ← / →');

    const wide = browser('?scenario=landing', storage(), { touch });
    wide.click('start');
    wide.step();
    wide.run.addClosure(48, 0, 80, false, 4);
    wide.until(() => /Wide gap/.test(wide.elements.feedback.textContent));
    assert.equal(wide.elements.feedback.textContent,
      touch ? 'Wide gap · Swipe right to solid track' : 'Wide gap · Solid track on the right');
  }
});
