const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { Run, STEP, LANE_COUNT, LANE_WIDTH, START_SPEED, MAX_SPEED, MAX_EXTRA_SPEED, REACTION_TIME, laneX } = require('../game.js');

function until(run, condition) {
  for (let tick = 0; tick < 1_200 && !condition(); tick++) {
    assert.equal(run.crash, null, 'Run crashed before the expected outcome');
    run.tick();
  }
  assert.ok(condition(), 'Expected state never arrived');
}

test('lane input stays within five lanes and settles on the selected lane', () => {
  const run = new Run({ scenario: 'landing' });
  run.move(-1);
  assert.equal(run.lane, 1);
  run.move(-1);
  run.move(-1);
  assert.equal(run.lane, 0);
  for (let press = 0; press < 5; press++) run.move(1);
  assert.equal(run.lane, 4);
  until(run, () => run.time > 0.35);
  assert.ok(Math.abs(run.x - laneX(4)) < 0.01);
});

test('a low hurdle is jumpable, a missed obstacle ends the run, and barriers are too tall to jump', () => {
  const missed = new Run({ scenario: 'hurdle' });
  until(missed, () => missed.crash);
  assert.equal(missed.crash.type, 'hurdle');
  const crashDistance = missed.distance;
  missed.tick();
  assert.equal(missed.distance, crashDistance);

  const clean = new Run({ scenario: 'hurdle' });
  until(clean, () => clean.distance >= 28);
  clean.jumpOrTap();
  until(clean, () => clean.distance > 48);
  assert.equal(clean.crash, null);

  const tall = new Run({ scenario: 'barrier' });
  until(tall, () => tall.distance >= 28);
  tall.jumpOrTap();
  until(tall, () => tall.crash);
  assert.equal(tall.crash.type, 'barrier');
});

test('landing taps reward fresh presses just before or after touchdown and expire', () => {
  const early = new Run({ scenario: 'landing' });
  early.jumpOrTap();
  until(early, () => early.tapOpen);
  assert.equal(early.airborne, true);
  early.jumpOrTap();
  assert.equal(early.boosting, false);
  until(early, () => !early.airborne);
  assert.equal(early.boosting, true);
  early.tick();
  assert.equal(early.speed, early.baseSpeed + 15);
  until(early, () => !early.boosting);
  assert.equal(early.speed, early.baseSpeed);

  const late = new Run({ scenario: 'landing' });
  late.jumpOrTap();
  until(late, () => !late.airborne);
  late.jumpOrTap();
  assert.equal(late.boosting, true);
  assert.equal(late.airborne, false);

  const missed = new Run({ scenario: 'landing' });
  missed.jumpOrTap();
  until(missed, () => missed.time > 0.2);
  missed.jumpOrTap();
  until(missed, () => missed.time > 1);
  assert.equal(missed.boosting, false);
  missed.jumpOrTap();
  assert.equal(missed.airborne, true);
});

test('dash breaks on swept contact in the physical lane, with effects at the barrier face', () => {
  for (const pace of ['', 'fast']) {
    for (const [steerAt, expectedLane] of [[30, 3], [40.55, 2]]) {
      const breaks = [];
      const run = new Run({ scenario: 'barrier', pace, onEvent: (name, payload) => {
        if (name === 'break') breaks.push(payload);
      } });
      until(run, () => run.distance >= 25);
      run.dash();
      assert.equal(run.obstacles.length, 2);
      assert.equal(breaks.length, 0);
      until(run, () => run.distance >= steerAt);
      assert.equal(breaks.length, 0);
      run.move(1);
      until(run, () => breaks.length > 0);
      assert.equal(breaks[0].lane, expectedLane);
      assert.ok(Math.abs(breaks[0].impact.x - laneX(expectedLane)) <= 0.99);
      assert.equal(breaks[0].impact.z, 41.68);
      assert.ok(run.distance >= 41.32);
    }
  }
});

test('a dash can break one barrier, and a nearby hurdle or second barrier still collides', () => {
  for (const pace of ['', 'fast']) {
    const first = new Run({ scenario: 'dash-first', pace });
    until(first, () => first.distance > 34);
    first.dash();
    first.dash();
    assert.deepEqual(first.obstacles.map((obstacle) => obstacle.z), [42, 50]);
    until(first, () => first.distance > 43);
    assert.deepEqual(first.obstacles.map((obstacle) => obstacle.z), [50]);
    until(first, () => first.crash);
    assert.equal(first.crash.z, 50);
    assert.equal(first.dashing, true);

    const hurdle = new Run({ scenario: 'hurdle', pace });
    until(hurdle, () => hurdle.distance > 28);
    hurdle.dash();
    until(hurdle, () => hurdle.crash);
    assert.equal(hurdle.crash.type, 'hurdle');
  }
});

test('barriers distinguish contact near the end of a dash from contact after expiry', () => {
  for (const [pace, early, late] of [['', 37, 44], ['fast', 18, 24]]) {
    const expired = new Run({ scenario: 'dash-expiry', pace });
    until(expired, () => expired.distance >= early);
    expired.dash();
    until(expired, () => expired.crash);
    assert.equal(expired.dashing, false);
    assert.equal(expired.crash.type, 'barrier');

    const live = new Run({ scenario: 'dash-expiry', pace });
    until(live, () => live.distance >= late);
    live.dash();
    until(live, () => live.distance > 77);
    assert.equal(live.obstacles.length, 0);
  }
});

test('dash continues to add speed for 0.7 seconds before its cooldown ends', () => {
  const run = new Run({ scenario: 'landing' });
  run.dash();
  until(run, () => run.time >= 0.65);
  assert.equal(run.dashing, true);
  assert.ok(run.speed >= run.baseSpeed + 5);
  until(run, () => !run.dashing);
  assert.ok(Math.abs(run.time - 0.7) < 1 / 120 + Number.EPSILON);
  assert.equal(run.speed, run.baseSpeed);
  assert.ok(run.dashCharge < 1);
  until(run, () => run.dashCharge === 1);
  assert.ok(Math.abs(run.time - 0.95) < 1 / 120 + Number.EPSILON);
});

test('the base pace starts at 32 m/s and gains 1.8 m/s per second', () => {
  const run = new Run({ scenario: 'landing' });
  assert.equal(run.speed, 32);
  until(run, () => run.time >= 1);
  assert.ok(Math.abs(run.speed - (32 + run.time * 1.8)) < 1e-8);
  assert.equal(MAX_SPEED, 64);
});

function crossSpikes({ pace = '', scenario = 'spike-long', jumpAt, dashAt = Infinity }) {
  const run = new Run({ scenario, pace });
  const patch = run.obstacles[0];
  while (!run.crash && run.distance < patch.end + 1) {
    if (run.distance >= jumpAt) {
      run.jumpOrTap();
      jumpAt = Infinity;
    }
    if (run.distance >= dashAt) {
      run.dash();
      dashAt = Infinity;
    }
    run.tick();
  }
  return run;
}

test('short spikes are jumpable and a range of airborne-dash timings clears two tiles', () => {
  for (const [pace, shortTimings, longTimings] of [
    ['', [84, 86, 87], [82, 85, 87]], ['fast', [77, 81, 84], [76, 81, 84]],
  ]) {
    for (const jumpAt of shortTimings) {
      assert.equal(crossSpikes({ pace, scenario: 'spike-short', jumpAt }).crash, null);
    }
    for (const jumpAt of longTimings) {
      for (const dashAt of [89, 94, 101]) {
        assert.equal(crossSpikes({ pace, jumpAt, dashAt }).crash, null, `pace=${pace} jump=${jumpAt} dash=${dashAt}`);
      }
    }
    assert.equal(crossSpikes({ pace, dashAt: 83 }).crash.type, 'spikes');
  }
});

test('two tiles defeat jump-only and boosted pre-dash then jump across both paces', () => {
  for (const pace of ['', 'fast']) {
    for (let jumpAt = 45; jumpAt <= 90; jumpAt++) {
      assert.equal(crossSpikes({ pace, jumpAt }).crash.type, 'spikes');
      // Start a real boost at takeoff to put its full duration behind the attempt.
      for (const groundDashLead of [0, 2, 5, 10]) {
        const run = new Run({ scenario: 'spike-long', pace });
        until(run, () => run.crash || run.distance >= jumpAt - groundDashLead);
        if (!run.crash) run.dash();
        until(run, () => run.distance >= jumpAt || run.crash);
        if (!run.crash) {
          run.boost();
          run.jumpOrTap();
          until(run, () => run.crash || run.distance > run.obstacles[0].end + 1);
        }
        assert.equal(run.crash?.type, 'spikes', `pace=${pace} jump=${jumpAt} lead=${groundDashLead}`);
      }
    }

    const run = new Run({ scenario: 'spike-long', pace });
    until(run, () => run.distance >= (pace ? 20 : 49));
    run.jumpOrTap();
    until(run, () => run.tapOpen);
    run.jumpOrTap();
    until(run, () => !run.airborne);
    assert.equal(run.boosting, true);
    run.dash();
    run.jumpOrTap();
    assert.equal(run.airDashed, false);
    until(run, () => run.crash);
    assert.equal(run.crash.type, 'spikes');
  }
});

test('both adjacent lanes of a wide spike patch collide and the neighboring route stays open', () => {
  const secondLane = new Run({ scenario: 'spike-long', pace: 'fast' });
  secondLane.move(1);
  until(secondLane, () => secondLane.crash);
  assert.equal(secondLane.crash.type, 'spikes');

  const nextLane = new Run({ scenario: 'spike-long', pace: 'fast' });
  nextLane.move(1);
  nextLane.move(1);
  until(nextLane, () => nextLane.distance > 155);
  assert.equal(nextLane.crash, null);
});

test('closures stop a dash at the start edge, catch lateral entry, and allow reentry at the far lip', () => {
  for (const pace of ['', 'fast']) {
    const closed = new Run({ scenario: 'gap', pace });
    until(closed, () => closed.distance >= 52);
    closed.jumpOrTap();
    closed.dash();
    until(closed, () => closed.crash);
    assert.equal(closed.crash.type, 'roadblock');
    assert.equal(closed.crash.z, 66);
    assert.equal(closed.distance, 65.64);
    assert.equal(closed.dashSpent, false);

    const lateral = new Run({ scenario: 'gap', pace });
    lateral.move(-1);
    until(lateral, () => lateral.distance >= 86);
    lateral.jumpOrTap();
    lateral.dash();
    lateral.move(1);
    until(lateral, () => lateral.crash);
    assert.equal(lateral.crash.type, 'gap');
    assert.ok(lateral.distance > 86 && lateral.distance < 386);

    const resumed = new Run({ scenario: 'gap', pace });
    resumed.move(-1);
    until(resumed, () => resumed.distance >= 386);
    resumed.move(1);
    until(resumed, () => resumed.distance > 393);
    assert.equal(resumed.crash, null);
  }
});

test('seeded courses keep a reachable route and late-game density across full closure spans', () => {
  for (let seed = 1; seed <= 24; seed++) {
    const run = new Run({ seed });
    assert.equal(run.speed, START_SPEED);
    let lastRow = 0;
    let lastEnd = 0;
    let sawSpikes = false;
    let closure = null;
    let closuresAtCap = 0;
    let previousClosureEnd = 0;
    const lanes = Array.from({ length: LANE_COUNT }, (_, lane) => lane);
    let open = lanes;
    while (run.distance < 4000 || closure) {
      const z = run.obstacles.find((obstacle) => obstacle.z > lastRow)?.z;
      assert.ok(z > lastRow, 'The next row should be generated ahead of the runner');
      if (closure && z >= closure.gap.end) {
        const { gap, began, atCap, openNeighbors, beats } = closure;
        until(run, () => run.distance >= gap.end);
        assert.ok(run.time - began >= 3 - 1 / 120);
        assert.ok(openNeighbors.length >= 1, 'A neighboring lane stays playable through the full closure');
        assert.ok(beats >= 1, 'Long closures include at least one interior row');
        if (atCap) {
          assert.ok(gap.end - gap.z >= 3 * (MAX_SPEED + MAX_EXTRA_SPEED));
          assert.ok(gap.end - gap.z <= Math.ceil(3.5 * (MAX_SPEED + MAX_EXTRA_SPEED)));
          assert.equal(beats, 2);
          closuresAtCap++;
        }
        previousClosureEnd = gap.end;
        lastEnd = gap.end;
        open = lanes.filter((lane) => lane !== gap.lane);
        closure = null;
      }
      const row = run.obstacles.filter((obstacle) => obstacle.z === z);
      const end = Math.max(...row.map((obstacle) => obstacle.type === 'spikes' ? obstacle.end : obstacle.z));
      const blocked = new Set(row.flatMap((obstacle) => Array.from({ length: obstacle.lanes ?? 1 },
        (_, offset) => obstacle.lane + offset)));
      sawSpikes ||= row.some((obstacle) => obstacle.type === 'spikes');
      if (closure) {
        assert.ok(!blocked.has(closure.gap.lane), 'Interior obstacles occupy usable lanes');
        assert.ok(row.every(({ type }) => type === 'barrier' || type === 'hurdle'));
        closure.openNeighbors = closure.openNeighbors.filter((lane) => !blocked.has(lane));
        closure.beats++;
        blocked.add(closure.gap.lane);
      }
      const nextOpen = lanes.filter((lane) => !blocked.has(lane));
      for (const lane of open) {
        assert.ok(nextOpen.some((next) => Math.abs(next - lane) <= 1), `Seed ${seed} traps lane ${lane} at ${z} m`);
      }
      const lane = [run.lane, run.lane - 1, run.lane + 1].find((candidate) => nextOpen.includes(candidate));
      assert.ok(lane !== undefined, `Seed ${seed} lacks a reachable lane at ${z} m`);
      run.move(lane - run.lane);
      until(run, () => run.distance > z + 1);
      const approachSpeed = run.baseSpeed;
      until(run, () => run.distance > end + 1);
      assert.ok(z - lastEnd - 1.4 >= (approachSpeed + MAX_EXTRA_SPEED) * REACTION_TIME);
      const gap = row.find((obstacle) => obstacle.type === 'gap');
      if (gap) {
        assert.equal(closure, null);
        assert.ok(gap.z - previousClosureEnd >= 360);
        closure = { gap, began: run.time, atCap: approachSpeed === MAX_SPEED,
          openNeighbors: lanes.filter((lane) => Math.abs(lane - gap.lane) === 1), beats: 0 };
      }
      lastRow = z;
      lastEnd = end;
      open = nextOpen;
    }
    assert.equal(run.baseSpeed, MAX_SPEED);
    assert.equal(sawSpikes, true);
    assert.ok(closuresAtCap >= 2);
  }
});

function browserHarness(scenario, { reducedMotion = false, pace = '', touch = false } = {}) {
  const read = (file) => readFileSync(join(__dirname, '..', file), 'utf8');
  const source = read('index.html');
  const frames = [];
  class Target {
    constructor() {
      this.events = {};
      this.dataset = {};
      this.style = {};
      this.textContent = '';
      this.capture = new Set();
    }
    addEventListener(type, handler) { this.events[type] = handler; }
    setPointerCapture(id) { this.capture.add(id); }
    hasPointerCapture(id) { return this.capture.has(id); }
    releasePointerCapture(id) { this.capture.delete(id); }
  }
  class Button extends Target {
    blur() { dom.activeElement = dom.body; }
    focus() { dom.activeElement = this; }
  }
  const ids = Object.fromEntries(Array.from(source.matchAll(/<(\w+)[^>]+id="([\w-]+)"/g),
    ([, tag, id]) => [id, tag === 'button' ? new Button() : new Target()]));
  const classes = { '.intro': new Target(), '.results': new Target() };
  const dom = Object.assign(new Target(), {
    body: new Target(), getElementById: (id) => ids[id], querySelector: (selector) => classes[selector],
  });
  let draws = 0;
  let speedStrokes = 0;
  let dashStrokes = 0;
  const noop = () => {};
  const ctx = new Proxy({
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    fill: () => { draws++; },
    stroke() {
      if (typeof this.strokeStyle !== 'string') return;
      if (this.strokeStyle.startsWith('rgba(195, 230, 255,')) dashStrokes++;
      else if (this.strokeStyle.startsWith('rgba(')) speedStrokes++;
    },
  }, { get: (target, key) => target[key] ?? noop });
  Object.assign(ids.scene, { clientWidth: 1440, clientHeight: 900, getContext: () => ctx });
  const window = new Target();
  let insets = {};
  let observeResize;
  const context = vm.createContext({
    document: dom, window, HTMLButtonElement: Button, devicePixelRatio: 1,
    matchMedia: (query) => ({ matches: query === '(pointer: coarse)' ? touch : reducedMotion }),
    getComputedStyle: () => ({ getPropertyValue: (prop) => `${insets[prop.slice(7)] ?? 0}px` }),
    ResizeObserver: class {
      constructor(callback) { observeResize = callback; }
      observe() {}
    },
    URLSearchParams, location: { search: `?scenario=${scenario}&pace=${pace}` },
    requestAnimationFrame: (frame) => frames.push(frame),
  });
  for (const [, file] of source.matchAll(/<script src="([^"]+)" defer/g)) {
    vm.runInContext(read(file), context, { filename: file });
  }
  let now = 0;
  let scene;
  let runner;
  const draw = context.VoidScene.prototype.draw;
  context.VoidScene.prototype.draw = function (run, ...args) {
    scene = this;
    runner = run;
    draw.call(this, run, ...args);
  };
  return {
    dom, ids, classes, Scene: context.VoidScene, draws: () => draws,
    speedStrokes: () => speedStrokes, dashStrokes: () => dashStrokes,
    get scene() { return scene; }, get runner() { return runner; },
    key: (type, code, repeat = false) => window.events[type]({ code, repeat, preventDefault: noop }),
    pointer(target, type, pointerId, clientX, clientY, options = {}) {
      const element = ids[target];
      let prevented = false;
      element.events[type]?.({ pointerId, clientX, clientY, pointerType: 'touch', button: 0,
        preventDefault: () => { prevented = true; }, ...options });
      if (['pointerup', 'pointercancel', 'lostpointercapture'].includes(type)) element.releasePointerCapture(pointerId);
      return prevented;
    },
    windowEvent: (type) => window.events[type](),
    documentEvent: (type) => dom.events[type](),
    resize(width, height, safe, source = 'resize') {
      Object.assign(ids.scene, { clientWidth: width, clientHeight: height });
      insets = safe;
      if (source === 'observer') observeResize();
      else window.events[source]();
    },
    step(count) {
      for (let frame = 0; frame < count; frame++) {
        frames.shift()(now);
        now += 1000 / 60;
      }
    },
  };
}

test('page wiring renders a frame and rejects held Space, then accepts a fresh touchdown tap', () => {
  const game = browserHarness('landing');
  game.step(1);
  assert.ok(game.draws() > 100);
  game.key('keydown', 'Enter');
  game.key('keyup', 'Enter');
  assert.equal(game.dom.body.dataset.mode, 'running');
  game.key('keydown', 'Space');
  game.step(47);
  assert.equal(game.ids.feedback.textContent, 'Tap Space now');
  game.key('keydown', 'Space', true);
  game.key('keydown', 'Space');
  game.step(16);
  assert.equal(game.dom.body.dataset.boost, 'false');
  game.key('keyup', 'Space');
  game.key('keydown', 'Space');
  game.key('keyup', 'Space');
  game.step(47);
  game.key('keydown', 'Space');
  assert.equal(game.speedStrokes(), 0);
  game.step(8);
  assert.equal(game.dom.body.dataset.boost, 'true');
  assert.equal(game.ids.feedback.textContent, 'Landing boost');
  assert.ok(game.speedStrokes() > 0);
  assert.equal(game.dashStrokes(), 0);
});

test('page wiring reports a collision, restarts with one button, and dashes with X', () => {
  const game = browserHarness('barrier');
  game.ids.start.events.click();
  game.step(119);
  assert.equal(game.dom.body.dataset.mode, 'ended');
  assert.equal(game.dom.activeElement, game.ids.restart);
  assert.equal(game.ids.impact.textContent, 'You hit a cracked barrier.');
  game.ids.restart.events.click();
  game.step(1);
  assert.equal(game.ids.distance.textContent, '0000');
  game.step(50);
  game.key('keydown', 'ShiftLeft');
  game.step(2);
  assert.equal(game.dom.body.dataset.dash, 'false');
  assert.equal(game.speedStrokes(), 0);
  assert.equal(game.dashStrokes(), 0);
  game.key('keydown', 'KeyX');
  game.step(3);
  assert.equal(game.ids.feedback.textContent, '');
  game.step(20);
  assert.equal(game.dom.body.dataset.dash, 'true');
  assert.equal(game.ids.feedback.textContent, 'Barrier broken');
  assert.equal(game.ids['dash-status'].textContent, 'Dash active');
  assert.ok(game.dashStrokes() > 0);
  game.step(80);
  assert.equal(game.dom.body.dataset.mode, 'running');
});

test('center and exterior closures expose deep walls and an empty deck before and after the far lip enters view', () => {
  const { Scene } = browserHarness('gap-edge');
  let stars = 0;
  const ctx = { beginPath() {}, arc() { stars++; }, fill() {}, fillRect() {} };
  const renderer = Object.assign(Object.create(Scene.prototype), { cameraBack: 10.8, ctx });
  const flats = [];
  const boxes = [];
  const faces = [];
  renderer.flat = (left, right, start, end, color) => flats.push({ left, right, start, end, color });
  renderer.box = (...args) => boxes.push(args);
  renderer.face = (points, color) => faces.push({ points, color });
  renderer.line = () => {};

  for (const scenario of ['gap', 'gap-edge']) {
    const run = new Run({ scenario });
    const gap = run.obstacles.find((obstacle) => obstacle.type === 'gap');
    const middle = laneX(gap.lane);
    const left = middle - LANE_WIDTH / 2;
    const right = middle + LANE_WIDTH / 2;
    run.lane = gap.lane;
    for (const distance of [0, 180, gap.end - 23, gap.end + 1]) {
      run.distance = distance;
      flats.length = boxes.length = faces.length = 0;
      renderer.track(run, false);
      const entry = gap.z - distance;
      const resume = gap.end - distance;
      const touchesVoid = (x1, x2, start, end) => x1 < right && x2 > left && start < resume && end > entry;
      assert.ok(flats.every((flat) => !touchesVoid(flat.left, flat.right, flat.start, flat.end)));
      assert.ok(boxes.every(([x, , z, width, , depth]) => !touchesVoid(x - width / 2, x + width / 2, z - depth / 2, z + depth / 2)));
      const walls = faces.filter(({ points }) => points.some(([, y]) => y <= -2.15));
      assert.ok(walls.some(({ points }) => points.every(([x]) => x === right)));
      assert.equal(walls.some(({ points }) => points.every(([x]) => x === left)), gap.lane !== 0);
      if (resume > 186) {
        assert.equal(flats.some(({ color }) => color === '#59a3ab'), false);
        assert.equal(walls.some(({ points }) => points.every(([, , z]) => z === resume)), false);
      } else {
        assert.ok(flats.some(({ start, end, color }) => start === resume && end > resume && color === '#59a3ab'));
        assert.ok(walls.some(({ points }) => points.every(([, , z]) => z === resume)));
        if (gap.lane === 0) assert.ok(flats.some(({ left, start, end }) => left < -6.25 && start === resume && end > resume));
      }
    }
    renderer.roadblock(middle, gap.z);
    const [, , z, , , depth] = boxes.at(-1);
    assert.equal(z - depth / 2, gap.z);
  }

  boxes.length = flats.length = faces.length = 0;
  Object.assign(renderer, { width: 1440, height: 900, cameraY: 5.35, cameraX: 0,
    centerX: 720, centerY: 504, focal: 1008 });
  renderer.deepVoid(180);
  assert.ok(stars > 20);
  assert.ok(faces.length > 0 && faces.every(({ points }) => points.every(([, y]) => y < -4)));
  assert.equal(flats.length, 0, 'The visible depth is scattered below the deck');
  assert.equal(boxes.length, 0);
});

test('long-spike guidance distinguishes warning, jump, air dash, and touchdown', () => {
  const game = browserHarness('spike-long');
  game.ids.start.events.click();
  const advanceTo = (distance) => {
    for (let frame = 0; Number(game.ids.distance.textContent) < distance && frame < 300; frame++) game.step(1);
  };
  advanceTo(66);
  assert.equal(game.ids.feedback.textContent, 'Long spikes ahead');
  advanceTo(84);
  assert.equal(game.ids.feedback.textContent, 'Jump now · Air dash next');
  game.key('keydown', 'Space');
  game.key('keyup', 'Space');
  game.step(1);
  assert.equal(game.ids.feedback.textContent, 'Air dash next · W / X');
  advanceTo(92);
  assert.equal(game.ids.feedback.textContent, 'Air dash now · W / X');
  game.key('keydown', 'KeyW');
  game.step(1);
  assert.equal(game.ids.feedback.textContent, 'Tap Space at landing');
  for (let frame = 0; frame < 100 && game.ids.feedback.textContent !== 'Tap Space now'; frame++) game.step(1);
  assert.equal(game.ids.feedback.textContent, 'Tap Space now');
});

test('W keeps the blue edge effect and badge active late in the dash', () => {
  const game = browserHarness('landing');
  game.ids.start.events.click();
  game.key('keydown', 'KeyW');
  game.step(35);
  const strokes = game.dashStrokes();
  game.step(3);
  assert.equal(game.ids['dash-status'].textContent, 'Dash active');
  assert.ok(game.dashStrokes() > strokes);
  assert.equal(game.speedStrokes(), 0);
  game.step(9);
  assert.equal(game.ids['dash-status'].textContent, '');
  const finishedStrokes = game.dashStrokes();
  game.step(20);
  game.key('keydown', 'KeyW', true);
  game.step(1);
  assert.equal(game.dashStrokes(), finishedStrokes);
});

test('reduced motion keeps a sustained dash badge and skips animated streaks', () => {
  const game = browserHarness('landing', { reducedMotion: true });
  game.ids.start.events.click();
  game.key('keydown', 'KeyX');
  game.step(38);
  assert.equal(game.ids['dash-status'].textContent, 'Dash active');
  assert.ok(Number(game.ids.speed.textContent) > START_SPEED);
  assert.equal(game.speedStrokes(), 0);
  assert.equal(game.dashStrokes(), 0);
  game.step(9);
  assert.equal(game.ids['dash-status'].textContent, '');
});

test('page wiring moves only one lane per press, even during keyboard repeat', () => {
  const game = browserHarness('lanes');
  game.ids.start.events.click();
  game.key('keydown', 'ArrowLeft');
  game.step(45);
  game.key('keydown', 'ArrowLeft', true);
  game.key('keydown', 'ArrowLeft');
  game.step(222);
  assert.equal(game.dom.body.dataset.mode, 'ended');
  assert.equal(game.ids.distance.textContent, '0103');

  game.key('keyup', 'ArrowLeft');
  game.ids.restart.events.click();
  for (let press = 0; press < 2; press++) {
    game.key('keydown', 'ArrowLeft');
    game.key('keyup', 'ArrowLeft');
  }
  game.step(267);
  assert.equal(game.dom.body.dataset.mode, 'running');
  assert.ok(Number(game.ids.distance.textContent) > 104);
});

test('A and D move one lane each and repeated events do not move again', () => {
  const game = browserHarness('lanes');
  game.ids.start.events.click();
  game.key('keydown', 'KeyA');
  game.step(45);
  game.key('keydown', 'KeyA', true);
  game.key('keyup', 'KeyA');
  game.step(44);
  assert.ok(Number(game.ids.distance.textContent) > 42);
  game.key('keydown', 'KeyD');
  game.step(120);
  assert.equal(game.dom.body.dataset.mode, 'running');
  assert.ok(Number(game.ids.distance.textContent) > 104);
});

test('touch swipes fire on movement once, discard taps and downward gestures, and keep keyboard input', () => {
  const game = browserHarness('landing', { touch: true });
  const field = 'swipe-field';
  assert.equal(game.ids['touch-controls'].hidden, true);
  game.ids.start.events.click();
  game.step(1);
  assert.equal(game.dom.body.dataset.touch, 'true');
  assert.equal(game.ids['touch-controls'].hidden, false);
  assert.equal(game.pointer(field, 'pointerdown', 1, 110, 180), true);
  game.pointer(field, 'pointermove', 1, 128, 184);
  assert.equal(game.runner.lane, 2);
  game.pointer(field, 'pointermove', 1, 134, 184);
  assert.equal(game.runner.lane, 3);
  game.pointer(field, 'pointermove', 1, 240, 180);
  game.pointer(field, 'pointermove', 1, 60, 130);
  game.pointer(field, 'pointerup', 1, 60, 130);
  assert.equal(game.runner.lane, 3);
  assert.equal(game.runner.airborne, false);

  game.pointer(field, 'pointerdown', 2, 110, 180);
  game.pointer(field, 'pointerup', 2, 110, 180);
  game.pointer(field, 'pointerdown', 3, 110, 180);
  game.pointer(field, 'pointermove', 3, 113, 225);
  game.pointer(field, 'pointermove', 3, 108, 125);
  game.pointer(field, 'pointerup', 3, 108, 125);
  assert.equal(game.runner.lane, 3);
  assert.equal(game.runner.airborne, false);

  game.pointer(field, 'pointerdown', 4, 110, 180);
  game.pointer(field, 'pointermove', 4, 70, 176);
  game.pointer(field, 'pointerup', 4, 70, 176);
  assert.equal(game.runner.lane, 2);
  game.key('keydown', 'ArrowLeft');
  assert.equal(game.runner.lane, 1);
  assert.equal(game.ids['touch-controls'].hidden, false);
});

test('only a fresh upward swipe in the landing window earns the touch boost', () => {
  const game = browserHarness('landing', { touch: true });
  const field = 'swipe-field';
  function swipeUp(id) {
    game.pointer(field, 'pointerdown', id, 110, 210);
    game.pointer(field, 'pointermove', id, 110, 184);
  }
  function stepToWindow() {
    for (let frame = 0; frame < 65 && !game.runner.tapOpen; frame++) game.step(1);
    assert.equal(game.ids.feedback.textContent, 'Swipe up now · Landing boost');
  }
  game.ids.start.events.click();
  game.step(1);
  swipeUp(1);
  assert.equal(game.runner.airborne, true);
  stepToWindow();
  game.pointer(field, 'pointermove', 1, 110, 120);
  game.step(16);
  assert.equal(game.runner.boosting, false);
  game.pointer(field, 'pointerup', 1, 110, 120);

  swipeUp(2);
  game.pointer(field, 'pointerup', 2, 110, 184);
  stepToWindow();
  swipeUp(3);
  game.step(12);
  assert.equal(game.runner.boosting, true);
  assert.equal(game.ids.feedback.textContent, 'Landing boost');
});

test('a second finger can dash independently, with immediate input and a live charge readout', () => {
  const game = browserHarness('landing', { touch: true });
  const field = 'swipe-field';
  const dash = 'touch-dash';
  game.ids.start.events.click();
  game.step(1);
  assert.equal(game.ids['touch-dash-label'].textContent, 'Ready');
  game.pointer(field, 'pointerdown', 1, 120, 200);
  game.pointer(field, 'pointermove', 1, 120, 172);
  game.step(10);
  assert.equal(game.pointer(dash, 'pointerdown', 2, 290, 340, { isPrimary: false }), true);
  assert.equal(game.runner.airDashed, true);
  assert.equal(game.runner.dashing, true);
  game.step(1);
  assert.equal(game.ids['touch-dash-label'].textContent, 'Active');
  assert.notEqual(game.ids['touch-charge'].style.transform, 'scaleX(1.000)');
  game.step(43);
  assert.equal(game.ids['touch-dash-label'].textContent, 'Recharging');
  game.step(16);
  assert.equal(game.ids['touch-dash-label'].textContent, 'Ready');
  game.pointer(dash, 'pointerup', 2, 290, 340);
  game.pointer(dash, 'click', 2, 290, 340, { detail: 1 });
  assert.equal(game.runner.dashing, false);
  game.pointer(field, 'pointerup', 1, 120, 172);
  game.pointer(dash, 'click', 0, 0, 0, { detail: 0, pointerType: '' });
  assert.equal(game.runner.dashing, true);
});

test('multiple field touches cannot take over a swipe, and a separate first Dash touch leaves swipes usable', () => {
  const game = browserHarness('landing', { touch: true });
  const field = 'swipe-field';
  game.ids.start.events.click();
  game.step(1);
  game.pointer(field, 'pointerdown', 1, 110, 180);
  game.pointer(field, 'pointerdown', 2, 210, 180);
  game.pointer(field, 'pointermove', 1, 70, 180);
  game.pointer(field, 'pointerup', 1, 70, 180);
  game.pointer(field, 'pointermove', 2, 270, 180);
  game.pointer(field, 'pointerup', 2, 270, 180);
  assert.equal(game.runner.lane, 2);
  game.pointer('touch-dash', 'pointerdown', 3, 290, 340);
  game.pointer(field, 'pointerdown', 4, 110, 180, { isPrimary: false });
  game.pointer(field, 'pointermove', 4, 155, 180);
  assert.equal(game.runner.lane, 3);
  assert.equal(game.runner.dashing, true);
});

test('cancel, lost capture, blur, visibility, resize, and rotation clear unfinished gestures', () => {
  const game = browserHarness('landing', { touch: true });
  const field = 'swipe-field';
  game.ids.start.events.click();
  game.step(3);
  const run = game.runner;
  const cancellations = [
    (id) => game.pointer(field, 'pointercancel', id, 110, 180),
    (id) => game.pointer(field, 'lostpointercapture', id, 110, 180),
    () => game.windowEvent('blur'),
    () => game.documentEvent('visibilitychange'),
    () => game.resize(390, 730, { bottom: 34 }),
    () => game.resize(690, 310, { left: 40, bottom: 21 }, 'observer'),
    () => game.windowEvent('orientationchange'),
  ];
  for (const [index, cancel] of cancellations.entries()) {
    const id = index + 1;
    game.pointer(field, 'pointerdown', id, 110, 180);
    assert.equal(game.ids[field].hasPointerCapture(id), true);
    cancel(id);
    assert.equal(game.ids[field].hasPointerCapture(id), false);
    game.pointer(field, 'pointermove', id, 160, 175);
    assert.equal(game.runner.lane, 2);
  }
  assert.equal(game.dom.body.dataset.mode, 'running');
  game.pointer(field, 'pointerdown', 8, 110, 180);
  game.pointer(field, 'pointermove', 8, 150, 180);
  game.step(4);
  assert.equal(game.runner, run);
  assert.equal(game.runner.lane, 3);
  assert.ok(game.runner.distance > 0);
});

test('crash and touch restart clear contacts and restore the Dash control with a fresh run', () => {
  const game = browserHarness('hurdle', { touch: true });
  const field = 'swipe-field';
  game.ids.start.events.click();
  game.step(1);
  game.pointer(field, 'pointerdown', 1, 110, 180);
  game.pointer('touch-dash', 'pointerdown', 2, 290, 340);
  game.step(95);
  assert.equal(game.dom.body.dataset.mode, 'ended');
  assert.equal(game.ids[field].hidden, true);
  assert.equal(game.ids['touch-controls'].hidden, true);
  assert.equal(game.ids['touch-dash'].capture.size, 0);
  assert.equal(game.ids[field].capture.size, 0);
  game.ids.restart.events.click();
  game.step(1);
  assert.equal(game.ids['touch-controls'].hidden, false);
  assert.equal(game.ids['touch-dash-label'].textContent, 'Ready');
  game.pointer(field, 'pointermove', 1, 160, 180);
  assert.equal(game.runner.lane, 2);
  game.pointer(field, 'pointerdown', 3, 110, 180);
  game.pointer(field, 'pointermove', 3, 160, 180);
  assert.equal(game.runner.lane, 3);
});

test('touch hazard guidance names the swipe and lets a second finger air dash over long spikes', () => {
  const game = browserHarness('spike-long', { touch: true });
  const field = 'swipe-field';
  game.ids.start.events.click();
  game.step(1);
  const advance = (distance) => {
    for (let frame = 0; game.runner.distance < distance && frame < 270; frame++) game.step(1);
  };
  advance(66);
  assert.equal(game.ids.feedback.textContent, 'Long spikes ahead');
  advance(84);
  assert.equal(game.ids.feedback.textContent, 'Swipe up now · Air dash next');
  game.pointer(field, 'pointerdown', 1, 110, 180);
  game.pointer(field, 'pointermove', 1, 110, 154);
  advance(92);
  assert.equal(game.ids.feedback.textContent, 'Air dash now · Tap Dash');
  game.pointer('touch-dash', 'pointerdown', 2, 290, 340, { isPrimary: false });
  advance(137);
  assert.equal(game.dom.body.dataset.mode, 'running');
  assert.ok(game.runner.distance >= 137);
});

test('compact camera keeps the near deck and all lane centers in portrait and short landscape safe areas', () => {
  const game = browserHarness('landing', { touch: true });
  for (const [width, height, safe] of [
    [320, 568, { top: 45, bottom: 25 }], [390, 685, { top: 47, bottom: 34 }],
    [667, 280, { left: 45, right: 18, bottom: 21 }], [844, 315, { left: 47, right: 47, bottom: 21 }],
  ]) {
    game.resize(width, height, safe);
    game.step(1);
    const { scene } = game;
    assert.equal(scene.width, width);
    assert.equal(scene.height, height);
    for (const lane of [-6.45, -5, -2.5, 0, 2.5, 5, 6.45]) {
      const [x, y] = scene.screenPoint(scene.viewPoint([lane, 0, -1]));
      assert.ok(x >= (safe.left ?? 0) && x <= width - (safe.right ?? 0), `lane fits at ${width}x${height}`);
      assert.ok(y > (safe.top ?? 0) + 45 && y < height - (safe.bottom ?? 0));
    }
  }
});

test('actual acceleration, dash, and landing boost move the FOV smoothly and within bounds', () => {
  const { Scene } = browserHarness('camera');
  const view = Object.assign(Object.create(Scene.prototype), { reduceMotion: false, openingBlend: 0,
    width: 1440, height: 900, insets: [0, 0, 0, 0], particles: [] });
  const run = new Run({ scenario: 'landing' });
  view.reset(run.speed);
  const focal = () => {
    view.frameCamera(run);
    return view.focal;
  };
  const advance = (seconds) => {
    for (let tick = 0; tick < Math.round(seconds / STEP); tick++) {
      run.tick();
      assert.equal(run.crash, null);
      view.updateSpeed(run, STEP, 'running');
    }
    return focal();
  };
  const baseline = focal();
  const midway = advance(9);
  const atCap = advance(9.5);
  assert.ok(midway / baseline > 0.90 && midway / baseline < 0.92);
  assert.equal(run.speed, 64);
  assert.ok(Math.abs(atCap / baseline - 0.82) < 0.001);

  run.dash();
  const firstDashFrame = advance(STEP);
  const dash = advance(0.2);
  assert.ok(atCap - firstDashFrame < baseline * 0.01);
  assert.ok(dash < atCap - baseline * 0.035);
  assert.ok(Math.abs(advance(1.6) - atCap) < baseline * 0.004);

  run.jumpOrTap();
  while (!run.tapOpen) advance(STEP);
  run.jumpOrTap();
  while (!run.boosting) advance(STEP);
  assert.ok(advance(0.24) < atCap - baseline * 0.03);
  run.dash();
  const both = advance(0.22);
  assert.ok(both / baseline > 0.70 && both / baseline < 0.75);
  assert.ok(Math.abs(advance(1.6) - atCap) < baseline * 0.005);
  view.updateSpeed({ speed: 900, baseSpeed: 64 }, 10, 'running');
  assert.ok(Math.abs(focal() / baseline - 0.70) < 0.0001);
});

test('speed framing preserves readable outer lanes, and reduced motion and restart reset the lens', () => {
  const game = browserHarness('camera');
  game.ids.start.events.click();
  game.step(2);
  const { scene, runner } = game;
  scene.openingBlend = 0;
  runner.x = 5;
  for (const [width, height, safe, compact] of [
    [320, 568, { top: 42, bottom: 24 }, true], [667, 280, { left: 44, right: 18, bottom: 21 }, true],
    [1280, 900, {}, false], [1440, 900, {}, false],
  ]) {
    game.resize(width, height, safe);
    scene.reset(32);
    scene.frameCamera(runner);
    const resting = scene.focal;
    for (const speed of [32, 64, 101]) {
      scene.updateSpeed({ baseSpeed: 64, speed }, 10, 'running');
      scene.frameCamera(runner);
      const xs = [-6.45, -5, -2.5, 0, 2.5, 5, 6.45].map((x) => scene.screenPoint(scene.viewPoint([x, 0, -1]))[0]);
      assert.ok(xs[0] >= (safe.left ?? 0) && xs.at(-1) <= width - (safe.right ?? 0));
      assert.ok(xs[2] - xs[1] >= 40, 'Outer lanes remain readable at the widest setting');
    }
    assert.ok(Math.abs(scene.focal / resting - (compact ? 0.76 : 0.70)) < 0.0001);
  }

  runner.distance = 1179;
  runner.x = 0;
  runner.baseSpeed = 64;
  game.step(5);
  assert.equal(game.dom.body.dataset.mode, 'ended');
  game.ids.restart.events.click();
  game.step(1);
  assert.equal(game.runner.speed, START_SPEED);
  assert.equal(scene.widening, 0);

  const reduced = browserHarness('camera', { reducedMotion: true, pace: 'fast' });
  reduced.ids.start.events.click();
  reduced.step(1);
  const resting = reduced.scene.focal;
  reduced.key('keydown', 'KeyW');
  reduced.step(18);
  assert.ok(reduced.runner.speed > MAX_SPEED);
  assert.equal(reduced.scene.focal, resting);
});
