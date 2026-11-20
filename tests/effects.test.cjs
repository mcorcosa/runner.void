const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const runner = require('../game.js');
const { Run, PLATFORM_HEIGHT, STEP, laneX, obstacles } = runner;
const context = vm.createContext({
  VoidRunner: runner,
  VoidEpisode: require('../episode.js'),
  matchMedia: () => ({ matches: false }),
});
vm.runInContext(readFileSync(join(__dirname, '..', 'scene.js'), 'utf8'), context);

const dashCore = '#e1f7ff';
const dashEcho = '#8bd4ffa1';
const slideCore = '#d5ffee';
const shockwave = '#93ffdf';
const spark = '#e4fff5';

function fixture(scenario = 'landing', reduceMotion = false) {
  const ctx = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}) });
  const scene = new context.VoidScene({ getContext: () => ctx });
  Object.assign(scene, { reduceMotion, width: 390, height: 760, openingBlend: 0, insets: [0, 0, 0, 0] });
  scene.sky = scene.deepVoid = scene.track = scene.drawParticles = () => {};
  const ambient = [];
  scene.drawDash = () => ambient.push('dash');
  scene.drawBoost = () => ambient.push('boost');
  const events = [];
  const run = new Run({ scenario, seed: 1, onEvent(type, detail) {
    events.push({ type, detail, x: run.x, y: run.height, z: run.distance, time: run.time });
    if (['land', 'boost', 'break', 'crash'].includes(type)) scene.scatter(type, run, detail);
    if (type === 'boost') scene.pulseSpeed();
  } });
  scene.reset(run.speed);
  const primitives = [];
  const record = (points, color) => primitives.push({
    color, points: Array.from(points, (point) => [...point]), alpha: ctx.globalAlpha,
  });
  scene.face = scene.line = record;
  function frame(time = run.time, mode = 'running', death) {
    primitives.length = ambient.length = 0;
    scene.draw(run, time, 1 / 60, mode, 0, null, death);
    return (color) => primitives.filter((shape) => shape.color === color).map((shape) => shape.points);
  }
  return { scene, run, events, ambient, frame, primitives };
}

function advance(run, count) {
  for (let i = 0; i < count; i++) run.tick();
  assert.equal(run.crash, null);
}

function until(run, condition) {
  for (let i = 0; i < 130 && !condition(); i++) advance(run, 1);
  assert.ok(condition());
}

test('a real air dash holds its blue wake and raised silhouette at normal and high speed', () => {
  for (const scenario of ['landing', 'high-speed']) {
    const { run, scene, frame, ambient } = fixture(scenario);
    run.jump();
    advance(run, 24);
    run.dash();
    advance(run, 4);
    const onset = frame();
    assert.deepEqual(ambient, ['dash']);
    assert.equal(onset(dashCore).length, 2);
    assert.equal(onset(dashEcho).length, 1);
    assert.equal(onset(slideCore).length, 0);
    const points = [...onset(dashCore), ...onset(dashEcho)].flat();
    assert.ok(points.every(([, y, z]) => y > run.height && z < 0));
    assert.ok(Math.abs(scene.projectedDepth(Math.min(...points.map(([, , z]) => z))) + 2.912) < 1e-9);

    const untilTime = run.dashUntil;
    for (let i = 0; i < 68; i++) {
      run.dash();
      advance(run, 1);
    }
    assert.equal(run.dashUntil, untilTime);
    assert.equal(frame()(dashEcho).length, 1);
    until(run, () => !run.dashing);
    assert.equal(frame()(dashCore).length, 0);
  }
});

test('the mint cue and ordinary landing precede a separately earned, surface-anchored power-slide burst', () => {
  const normal = fixture();
  normal.run.jump();
  until(normal.run, () => normal.run.slideWindowOpen);
  const cue = normal.frame();
  assert.equal(cue('#9bffe6').length, 2);
  assert.equal(cue(slideCore).length, 0);
  assert.equal(cue(shockwave).length, 0);
  until(normal.run, () => !normal.run.airborne);
  assert.ok(normal.events.some(({ type }) => type === 'land'));
  assert.ok(normal.scene.particles.length > 0);
  assert.equal(normal.frame()(spark).length, 0);
  until(normal.run, () => !normal.run.slideWindowOpen);
  normal.run.slide();
  assert.equal(normal.run.braking, true);
  assert.equal(normal.frame()(slideCore).length, 0);

  const { run, scene, events, frame } = fixture('platform');
  advance(run, 165);
  run.jump();
  until(run, () => run.slideWindowOpen);
  run.slide();
  assert.equal(run.queuedSlide, true);
  assert.equal(scene.slideBurst, null);
  until(run, () => run.boosting);
  const land = events.find(({ type }) => type === 'land');
  const { x, y, z, time } = scene.slideBurst;
  assert.deepEqual({ x, y, z, time }, { x: land.x, y: land.y, z: land.z, time: land.time });
  assert.equal(y, PLATFORM_HEIGHT);
  assert.equal(scene.particles.length, 0);
  const layers = [];
  const drawPlayer = scene.player.bind(scene);
  scene.player = (...args) => {
    layers.push('runner');
    drawPlayer(...args);
  };
  const drawPlatform = scene.platform.bind(scene);
  scene.platform = (platform, distance, near, far) => {
    layers.push([near, far]);
    drawPlatform(platform, distance, near, far);
  };
  const rendered = frame();
  assert.equal(rendered(shockwave).length, 4);
  assert.ok(rendered(shockwave).flat().every(([, height]) => height === PLATFORM_HEIGHT + .055));
  assert.ok(rendered(spark).flat().every(([, height]) => height > PLATFORM_HEIGHT));
  assert.ok(rendered(slideCore).flat().every(([, height]) => height > PLATFORM_HEIGHT));
  const wakeRear = Math.min(...rendered(slideCore).flat().map(([, , depth]) => depth));
  assert.ok(layers.slice(0, layers.indexOf('runner')).some(([near, far]) => near <= wakeRear && far >= wakeRear));
  const beforePause = rendered(shockwave);
  assert.deepEqual(frame(time + 20)(shockwave), beforePause);
  advance(run, 5);
  assert.ok(Math.max(...frame()(shockwave).flat().map(([, , depth]) => depth)) < 0);
  until(run, () => run.time > time + .36);
  assert.equal(frame()(shockwave).length, 0);
  assert.equal(scene.slideBurst, null);
  assert.equal(frame()(slideCore).length, 2);
});

test('high-speed overlap retains the mint wake after the crouch and keeps blue around the suit', () => {
  const { run, scene, ambient, frame } = fixture('high-speed');
  run.jump();
  until(run, () => run.slideWindowOpen);
  run.slide();
  until(run, () => run.boosting);
  advance(run, 6);
  assert.equal(run.sliding, false);
  run.dash();
  const overlap = frame();
  assert.equal(overlap(dashCore).length, 2);
  assert.equal(overlap(slideCore).length, 2);
  assert.deepEqual(ambient, ['dash']);
  const highestMint = Math.max(...overlap(slideCore).flat().map(([, y]) => y));
  assert.ok(overlap(dashCore).flat().every(([, y]) => y > highestMint));
  assert.ok(scene.slideBurst);
  const ended = frame(run.time, 'ended');
  assert.equal(ended(dashCore).length, 0);
  assert.equal(ended(slideCore).length, 0);
  assert.equal(scene.slideBurst, null);
  scene.scatter('boost', run);
  const initialBurst = scene.slideBurst;
  advance(run, 1);
  scene.scatter('boost', run);
  assert.notEqual(scene.slideBurst, initialBurst);
  assert.equal(scene.slideBurst.z, run.distance);
  scene.reset();
  assert.equal(scene.slideBurst, null);
});

test('a barrier-top burst stays at contact height as the runner drops off the barrier', () => {
  const { run, scene, frame } = fixture('barrier');
  advance(run, 84);
  run.jump();
  until(run, () => run.slideWindowOpen);
  run.slide();
  until(run, () => run.boosting);
  const height = obstacles.barrier.height;
  assert.equal(scene.slideBurst.y, height);
  advance(run, 12);
  assert.ok(run.height < height);
  const rendered = frame();
  assert.ok(rendered(shockwave).length > 0);
  assert.ok(rendered(shockwave).flat().every(([, y]) => y === height + .055));
});

test('reduced motion uses steady blue and mint shapes without afterimages, particles or edge streaks', () => {
  const { run, scene, ambient, frame } = fixture('landing', true);
  run.jump();
  until(run, () => run.slideWindowOpen);
  run.slide();
  until(run, () => run.boosting);
  run.dash();
  const rendered = frame();
  const blue = rendered(dashCore);
  const mint = rendered(slideCore);
  assert.equal(blue.length, 2);
  assert.equal(mint.length, 2);
  assert.equal(rendered(dashEcho).length, 0);
  assert.equal(rendered(shockwave).length, 0);
  assert.equal(rendered(spark).length, 0);
  assert.equal(scene.slideBurst, null);
  assert.equal(scene.particles.length, 0);
  assert.deepEqual(ambient, []);
  const later = frame(run.time + 1);
  assert.deepEqual(later(dashCore), blue);
  assert.deepEqual(later(slideCore), mint);
});

const deathSuit = {
  hurdle: '#9b492d', barrier: '#8740a7', movingBarrier: '#3c7db7', slideGate: '#a84c61',
  spikes: '#9f324f', gap: '#63549c', platform: '#377e80',
};

function crashFixture(type, speed, reduceMotion = false, direction = 1) {
  const game = fixture('landing', reduceMotion);
  const { run, scene, events } = game;
  run.baseSpeed = run.speed = speed;
  scene.reset(speed);
  const z = Math.ceil(speed * 1.96 + .9 * 1.96 ** 2);
  if (type === 'spikes') run.addSpikes(z, 2, 1, 1);
  else if (type === 'gap') run.addClosure(z, 2, speed);
  else run.addObstacle(z, 2, type, {
    ...((type === 'slideGate' || type === 'platform') && { end: z + Math.ceil(speed * .30) }),
    ...(type === 'movingBarrier' && { toLane: 2 + direction }),
  });
  for (let ticks = 0; ticks < 360 && !run.crash; ticks++) run.tick();
  assert.equal(run.crash?.type, type);
  const { detail: impact } = events.find((event) => event.type === 'crash');
  const drawImpact = (elapsed) => game.frame(run.time, 'dying', { impact, elapsed })(deathSuit[type]);
  return { ...game, impact, drawImpact };
}

test('all seven physical impacts draw and retire the suit without leaving the running avatar', () => {
  for (const type of Object.keys(deathSuit)) {
    for (const speed of [48, 720]) {
      const { run, impact, scene, frame, drawImpact } = crashFixture(type, speed);
      assert.deepEqual(impact.impact, { x: run.x, y: run.height, z: run.distance });
      assert.ok(impact.impactTime <= run.time && impact.impactTime > run.time - STEP);
      scene.player = () => assert.fail('The intact avatar returned after collision');
      const onset = drawImpact(.08);
      const breakup = drawImpact(.52);
      assert.ok(onset.length >= 7, type);
      assert.notDeepEqual(breakup, onset, type);
      if (type === 'gap') assert.ok(breakup.flat().every(([, y]) => y < 0));
      if (type === 'spikes') assert.ok(Math.max(...breakup.flat().map(([, y]) => y)) > 2.4);
      assert.equal(drawImpact(1.05).length, 0);
      assert.equal(frame(run.time, 'ended')(deathSuit[type]).length, 0);
      assert.equal(scene.particles.length, 0);
    }
  }
});

test('moving impact plates travel to the side the barrier was crossing at contact', () => {
  function middle(points) {
    const xs = points.flat().map(([x]) => x);
    return (Math.max(...xs) + Math.min(...xs)) / 2;
  }
  for (const direction of [-1, 1]) {
    const { run, impact, scene, drawImpact } = crashFixture('movingBarrier', 720, false, direction);
    const atTime = [];
    scene.movingBarrier = (_, _z, time) => atTime.push(time);
    assert.equal(run.x, laneX(2));
    const early = middle(drawImpact(.08));
    const late = middle(drawImpact(.52));
    assert.ok((late - early) * direction > .65);
    assert.deepEqual(atTime, [impact.impactTime, impact.impactTime]);
  }
});

test('reduced-motion deaths have distinct fixed shapes that fade without emitting travelling shards', () => {
  const poses = new Set();
  for (const [type, color] of Object.entries(deathSuit)) {
    const { scene, primitives, drawImpact } = crashFixture(type, 720, true);
    scene.deathDebris = () => assert.fail('Reduced motion emitted travelling shards');
    const early = drawImpact(.08);
    const initialAlpha = primitives.find((shape) => shape.color === color).alpha;
    const late = drawImpact(.78);
    const finalAlpha = primitives.find((shape) => shape.color === color).alpha;
    assert.deepEqual(late, early, type);
    assert.ok(initialAlpha > finalAlpha && finalAlpha > 0, type);
    poses.add(JSON.stringify(early));
  }
  assert.equal(poses.size, 7);
});
