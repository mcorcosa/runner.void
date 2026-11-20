const assert = require('node:assert/strict');
const test = require('node:test');
const { DASH_COOLDOWN, positionAt, update } = require('../bolts.js');
const { Run, STEP, laneX } = require('../game.js');
const { CLUES } = require('../episode.js');
const { observeCourse, play } = require('./qa/encounter-player.cjs');

function tickUntil(run, condition, limit = 3000) {
  for (let tick = 0; tick < limit && !condition(); tick++) {
    run.tick();
    assert.equal(run.crash, null);
  }
  assert.ok(condition(), 'Runner did not reach the expected state');
}

function addBolt(run, { lane = run.lane, z = run.distance + 0.25, height = 0.82 } = {}) {
  const bolt = { lane, z, height };
  run.bolts.push(bolt);
  return bolt;
}

test('a crossing collects only once and restores a quarter of the four-second dash charge', () => {
  const events = [];
  const run = new Run({ scenario: 'landing', onEvent: (event, detail) => events.push([event, detail]) });
  assert.deepEqual(run.bolts, []);
  assert.equal(run.boltsCollected, 0);
  assert.equal(run.dashCharge, 1);
  assert.equal(DASH_COOLDOWN, 4);

  run.dash();
  assert.equal(run.dashCharge, 0);
  assert.equal(run.dashReadyAt, 4);
  const bolt = addBolt(run);
  run.tick();
  assert.equal(run.dashReadyAt, 3);
  assert.equal(run.dashCharge, (1 + STEP) / 4);
  assert.equal(run.boltsCollected, 1);
  assert.deepEqual(events.map(([event]) => event), ['dash', 'bolt']);
  assert.equal(events[1][1], bolt);
  assert.deepEqual(run.bolts, []);
  tickUntil(run, () => run.time >= 0.2);
  assert.equal(run.boltsCollected, 1);
});

test('pickups at full or nearly full charge count, cap recharge, and cannot restart an active dash', () => {
  const run = new Run({ scenario: 'landing' });
  addBolt(run);
  run.tick();
  assert.equal(run.boltsCollected, 1);
  assert.equal(run.dashCharge, 1);

  run.dash();
  const dashUntil = run.dashUntil;
  for (let i = 0; i < 4; i++) addBolt(run);
  run.tick();
  assert.equal(run.boltsCollected, 5);
  assert.equal(run.dashCharge, 1);
  assert.equal(run.dashReadyAt, run.time);
  run.dashSpent = true;
  run.dash();
  assert.equal(run.dashUntil, dashUntil);
  assert.equal(run.dashSpent, true);
  tickUntil(run, () => !run.dashing);
  run.dash();
  assert.equal(run.dashCharge, 0);
  assert.equal(run.dashReadyAt, run.time + 4);
});

test('pickup sweep must overlap across all three axes at the same time', () => {
  const run = new Run({ scenario: 'landing' });
  const bolt = addBolt(run, { z: 1, lane: 3 });
  update(run, { z: 0, x: laneX(3), y: 0 }, { z: 1, x: laneX(2), y: 0 });
  // The lane was still close enough for the near edge at z=0.22. A later bolt is missed.
  assert.equal(run.boltsCollected, 1);
  assert.ok(!run.bolts.includes(bolt));

  addBolt(run, { z: 2, lane: 3 });
  update(run, { z: 0, x: laneX(3), y: 0 }, { z: 3, x: laneX(1), y: 0 });
  assert.equal(run.boltsCollected, 1);
  assert.equal(run.bolts.length, 0);
});

test('motion stays within the lane and above the deck, with a stable anchor for reduced motion and legacy bolts', () => {
  const bolt = { lane: 3, height: 0.82, z: 10, motionPhase: 0.4 };
  const anchors = { x: laneX(3), y: bolt.height };
  const positions = Array.from({ length: 241 }, (_, tick) => positionAt(bolt, tick * STEP));
  assert.ok(positions.every(({ x, y }) => Math.abs(x - anchors.x) < 0.5 && y > 0.65 && y < 0.99));
  assert.ok(Math.max(...positions.map(({ x }) => x)) - Math.min(...positions.map(({ x }) => x)) > 0.9);
  assert.ok(Math.max(...positions.map(({ y }) => y)) - Math.min(...positions.map(({ y }) => y)) > 0.3);
  assert.deepEqual(positions[137], positionAt(bolt, 137 * STEP));
  assert.deepEqual(positionAt(bolt, 137 * STEP, true), anchors);
  assert.deepEqual(positionAt({ lane: bolt.lane, height: bolt.height }, 137 * STEP), anchors);
});

test('a moving bolt can cross the runner between samples only while their depth intervals overlap', () => {
  for (const reducedMotion of [false, true]) {
    const run = new Run({ scenario: 'landing' });
    run.reducedMotion = reducedMotion;
    const passedEarly = { lane: 2, height: 0.82, z: 1, motionPhase: 0 };
    const passesAtPeak = { ...passedEarly, z: 5 };
    run.bolts.push(passedEarly, passesAtPeak);
    const from = { x: 1.1, y: 0, z: 0 };
    const to = { ...from, z: 10 };
    assert.ok(Math.abs(from.x - positionAt(passesAtPeak, 0).x) > 0.72);
    assert.ok(Math.abs(to.x - positionAt(passesAtPeak, 0.72).x) > 0.72);
    const hits = [];
    run.onEvent = (name, bolt) => { if (name === 'bolt') hits.push(bolt); };
    update(run, from, to, 0, 0.72);
    assert.deepEqual(hits, reducedMotion ? [] : [passesAtPeak]);
    assert.equal(run.boltTime, 0.72);
  }
});

test('pickup timing uses the actual vertical trajectory and the in-step slide interval', () => {
  const run = new Run({ scenario: 'landing' });
  const high = addBolt(run, { z: 5, height: 3.2 });
  const from = { x: 0, y: 0, z: 0 };
  const to = { ...from, z: 10 };
  update(run, from, to, 0, 1, {
    step: 1, segments: [{ start: 0, end: 1, y: 0, velocity: 8, gravity: 16 }],
    slideStart: Infinity, slideEnd: Infinity,
  });
  assert.equal(run.boltsCollected, 1);
  assert.ok(!run.bolts.includes(high));

  addBolt(run, { z: 2, height: 1.35 });
  const afterSlide = addBolt(run, { z: 8, height: 1.35 });
  const hits = [];
  run.onEvent = (name, bolt) => { if (name === 'bolt') hits.push(bolt); };
  update(run, from, to, 1, 2, {
    step: 1, segments: [{ start: 0, end: 1, y: 0, velocity: 0, gravity: 0 }],
    slideStart: -Infinity, slideEnd: 0.6,
  });
  assert.deepEqual(hits, [afterSlide]);
});

test('elevated motion requires a jump at 32 and 572 m/s in either motion mode', () => {
  for (const scenario of ['landing', 'high-speed']) {
    for (const reducedMotion of [false, true]) {
      for (const action of ['stand', 'slide', 'jump']) {
        const run = new Run({ scenario });
        run.obstacles.length = 0;
        run.reducedMotion = reducedMotion;
        const z = run.speed * 0.55;
        const bolt = { lane: 2, z, height: 2.65, motionPhase: 0.4 };
        run.bolts.push(bolt);
        if (action === 'jump') {
          run.addObstacle(z, 2, 'hurdle');
          tickUntil(run, () => z - run.distance <= run.speed * 0.25);
          run.jump();
        } else if (action === 'slide') {
          tickUntil(run, () => z - run.distance <= 7);
          run.slide();
          assert.ok(run.sliding);
        }
        tickUntil(run, () => run.distance > z + 1);
        assert.equal(run.boltsCollected, Number(action === 'jump'), `${scenario}, ${action}, reduce=${reducedMotion}`);
      }
    }
  }
});

test('a jumping runner can collect at its body height but passes above a low bolt', () => {
  const run = new Run({ scenario: 'landing' });
  run.jump();
  tickUntil(run, () => run.height > 1.9);
  const low = addBolt(run);
  const high = addBolt(run, { height: 2.35 });
  run.tick();
  assert.equal(run.boltsCollected, 1);
  assert.ok(run.bolts.includes(low));
  assert.ok(!run.bolts.includes(high));
  tickUntil(run, () => !run.airborne);
  assert.equal(run.boltsCollected, 1);
  assert.equal(run.bolts.length, 0);
  run.slide();
  addBolt(run);
  run.tick();
  assert.equal(run.boltsCollected, 2);
});

test('the high-speed partial step collects before impact, and a fresh run resets the pickups', () => {
  const events = [];
  const run = new Run({ scenario: 'high-speed', onEvent: (event, detail) => events.push([event, detail]) });
  run.obstacles.length = 0;
  run.addObstacle(4.5, 2, 'barrier');
  run.dashReadyAt = 4;
  const reached = Object.assign(addBolt(run, { z: 2 }), { motionPhase: 1.2 });
  // This bolt's catch radius touches the partial sweep, but its center is behind the crash.
  addBolt(run, { z: 4.1 });
  addBolt(run, { z: 4.5 });
  run.tick();
  assert.equal(run.crash.type, 'barrier');
  assert.ok(run.distance > 3.8 && run.distance < 4);
  assert.deepEqual(events.map(([event]) => event), ['bolt', 'crash']);
  assert.equal(events[0][1], reached);
  assert.equal(run.boltTime, events[1][1].impactTime);
  assert.ok(run.boltTime < run.time);
  assert.equal(run.boltsCollected, 1);
  assert.equal(run.dashReadyAt, 3);
  run.tick();
  assert.equal(run.boltsCollected, 1);

  const restarted = new Run({ seed: 42 });
  assert.equal(restarted.boltsCollected, 0);
  assert.equal(restarted.dashCharge, 1);
  assert.deepEqual(restarted.bolts, []);
  assert.equal(restarted.boltTime, 0);
});

test('fractional fatal steps do not collect motion that crosses after impact', () => {
  const from = { x: 1.15, y: 0, z: 0 };
  const to = { ...from, z: 4 };
  const bolt = { lane: 2, height: 0.82, z: 3.9, motionPhase: 0 };
  const motion = { step: 0.3, segments: [{ start: 0, end: 1, y: 0, velocity: 0, gravity: 0 }],
    slideStart: -Infinity, slideEnd: -Infinity };
  const crash = new Run({ scenario: 'landing' });
  crash.crash = { type: 'barrier' };
  crash.bolts.push(bolt);
  update(crash, from, to, 0, 0.24, motion);
  assert.equal(crash.boltTime, 0.24);
  assert.equal(crash.boltsCollected, 0);
  const alive = new Run({ scenario: 'landing' });
  alive.bolts.push(bolt);
  update(alive, from, to, 0, 0.3, motion);
  assert.equal(alive.boltsCollected, 1);
});

function blockedAt(obstacle, lane, z) {
  const left = Math.min(obstacle.lane, obstacle.toLane ?? obstacle.lane);
  const right = Math.max(obstacle.toLane ?? obstacle.lane, obstacle.lane + (obstacle.lanes ?? 1) - 1);
  return lane >= left && lane <= right && z >= obstacle.z - 1 && z <= (obstacle.end ?? obstacle.z) + 1;
}

function surveyCourse(seed, discoveredClues, seconds, enabled = true) {
  const run = new Run({ seed, discoveredClues });
  const placements = [];
  const course = new Map();
  const launchSpeed = run.baseSpeed;
  let last = null;
  for (let tick = 0; tick < seconds / STEP; tick++) {
    // Survey full generated courses, including routes a player might steer away from.
    const from = { x: 0, y: 10, z: run.distance };
    run.time += STEP;
    run.baseSpeed = launchSpeed + 1.8 * run.time;
    run.speed = run.baseSpeed;
    run.distance += run.speed * STEP;
    if (enabled) update(run, from, { ...from, z: run.distance });
    const next = run.bolts.at(-1);
    if (next && next !== last) {
      const eta = (next.z - run.distance) / run.speed;
      assert.ok(eta >= 1.6, `seed ${seed}: only ${eta}s of warning at ${run.speed} m/s`);
      const blockers = run.obstacles.filter((obstacle) => blockedAt(obstacle, next.lane, next.z));
      const elevated = next.height > 2;
      if (elevated) {
        assert.equal(blockers.length, 1, `seed ${seed}: elevated bolt has overlapping hazards at ${next.z}`);
        assert.ok(['hurdle', 'platform'].includes(blockers[0].type));
      } else {
        assert.deepEqual(blockers, [], `seed ${seed}: bolt placed in a blocker at ${next.z} in lane ${next.lane}`);
      }
      const near = run.obstacles.some((obstacle) => {
        const beside = Math.abs(next.z - obstacle.z) <= run.speed * 0.4 ? obstacle.z : next.z;
        return [next.lane - 1, next.lane + 1].some((lane) => blockedAt(obstacle, lane, beside));
      });
      placements.push({ ...next, eta, time: run.time + eta, near: elevated || near, host: blockers[0]?.type });
      last = next;
    }
    run.obstacles = run.obstacles.filter(({ z, end }) => (end ?? z) >= run.distance - run.viewDistance * 0.15);
    run.populate();
    for (const obstacle of run.obstacles) course.set(obstacle.id, obstacle);
  }
  return { placements, course };
}

test('bolts are seeded independently of the course and appear in the first tier', () => {
  const first = surveyCourse(42, 0, 20);
  assert.deepEqual(first, surveyCourse(42, 0, 20));
  const otherSeed = surveyCourse(43, 0, 20);
  assert.notDeepEqual(first.placements, otherSeed.placements);
  assert.deepEqual(first.course, surveyCourse(42, 0, 20, false).course);
  const promoted = surveyCourse(42, 2, 70);
  assert.ok(promoted.placements.some(({ host }) => host));
  assert.deepEqual(promoted.course, surveyCourse(42, 2, 70, false).course);
  assert.ok(first.placements[0].time >= 7 && first.placements[0].time < 10);
  assert.ok(first.placements.length >= 2);
});

test('ordinary spacing stays sparse and late bolts favor safe placements around hazards', () => {
  const raised = new Set();
  for (const tier of [0, 1, 2, 3, 4]) {
    for (const seed of [42, 187, 0xffffffff]) {
      const { placements } = surveyCourse(seed, tier, 205);
      const late = placements.filter(({ time }) => time > 32);
      assert.ok(late.length >= 17 && late.length <= 25, `seed ${seed}, clues ${tier}: ${late.length} late bolts`);
      const near = late.filter((bolt) => bolt.near).length;
      assert.ok(near / late.length >= 0.65, `seed ${seed}, clues ${tier}: ${near}/${late.length} near hazards`);
      assert.ok(placements.filter(({ host }) => host).length < placements.length / 2);
      for (const { host } of placements) if (host) raised.add(host);
      for (let i = 1; i < placements.length; i++) {
        const spacing = placements[i].time - placements[i - 1].time;
        assert.ok(spacing > 7 && spacing < 12, `seed ${seed}, clues ${tier}: ${spacing}s between bolts`);
      }
    }
  }
  assert.deepEqual(raised, new Set(['hurdle', 'platform']));
});

test('complete seeded routes can collect a hurdle reward and an elevated deck reward without a dash', () => {
  const { courses, direct, runner } = observeCourse();
  const cases = [
    { seed: 101, clues: 1, host: 'hurdle', duration: 12, minSpeed: 0 },
    { seed: 42, clues: 2, host: 'platform', duration: 12, minSpeed: 0 },
    { seed: 42, clues: 4, host: 'platform', duration: 240, minSpeed: 572 },
    { seed: 101, clues: 4, host: 'hurdle', duration: 243, minSpeed: 572 },
  ];
  for (const { seed, clues, host, duration, minSpeed } of cases) {
    const player = direct({ seed, discoveredClues: clues });
    const catches = [];
    player.run.onEvent = (event, bolt) => {
      if (event !== 'bolt' || bolt.height <= 2 || player.run.speed < minSpeed) return;
      const hazard = player.run.obstacles.find(({ type, lane, z, end }) => lane === bolt.lane &&
        ((type === 'platform' && z < bolt.z && bolt.z < end) || (type === 'hurdle' && z === bolt.z)));
      catches.push({ pose: player.run.height, host: hazard?.type });
    };
    const route = play(player, courses, duration, { ...runner, boost: false, forkGate: false });
    assert.equal(catches[0]?.host, host, `seed ${seed}, clues ${clues}, at or above ${minSpeed} m/s`);
    if (host === 'platform') assert.equal(catches[0].pose, runner.PLATFORM_HEIGHT);
    else assert.ok(catches[0].pose > 0.71);
    assert.ok(!route.actionLog.some(({ action }) => action === 'dash'));
  }
});

test('an ordinary player can steer to the first pickup, miss the next hazard, and restart', () => {
  const run = new Run({ seed: 42 });
  let row = -Infinity;
  let seekingBolt = true;
  for (let tick = 0; tick < 15 / STEP && !run.crash; tick++) {
    const upcoming = run.obstacles.find(({ z }) => z > row);
    const bolt = run.bolts.find(({ z }) => z > run.distance);
    if (run.boltsCollected) seekingBolt = false;
    if (seekingBolt && upcoming && upcoming.z - run.distance < 0.6 * run.speed) {
      row = upcoming.z;
      const lanes = [run.lane, run.lane - 1, run.lane + 1].filter((lane) => lane >= 0 && lane < 5 &&
        !run.obstacles.some((obstacle) => blockedAt(obstacle, lane, row)));
      if (bolt) lanes.sort((left, right) => Math.abs(left - bolt.lane) - Math.abs(right - bolt.lane));
      if (lanes.length) run.move(lanes[0] - run.lane);
    }
    if (seekingBolt && bolt && bolt.z - run.distance < 0.5 * run.speed &&
      !run.obstacles.some((obstacle) => obstacle.z <= bolt.z + 1 &&
        blockedAt(obstacle, bolt.lane, Math.max(run.distance, obstacle.z)))) {
      run.move(bolt.lane - run.lane);
    }
    if (!seekingBolt && upcoming && upcoming.z - run.distance < 0.55 * run.speed) {
      run.move(upcoming.lane - run.lane);
    }
    run.tick();
  }
  assert.equal(run.boltsCollected, 1);
  assert.ok(run.crash, 'A missed obstacle should still end the run after collection');
  const fresh = new Run({ seed: 42 });
  assert.equal(fresh.boltsCollected, 0);
  assert.equal(fresh.dashCharge, 1);
});

test('a late bolt beside a moving barrier can be taken and left with ordinary lane changes', () => {
  const run = new Run({ seed: 42, discoveredClues: 4 });
  run.time = 7;
  run.obstacles.length = 0;
  run.lastHazardEnd = 1200;
  run.addObstacle(145, 1, 'barrier');
  run.addObstacle(310, 2, 'movingBarrier', { toLane: 3 });
  run.addClosure(310, 4, 500);
  run.addObstacle(470, 1, 'barrier');

  run.tick();
  assert.deepEqual(run.bolts.map(({ lane, z }) => [lane, z]), [[1, 310]]);
  tickUntil(run, () => run.distance > 150);
  run.move(-1);
  tickUntil(run, () => run.boltsCollected === 1);
  run.move(-1);
  tickUntil(run, () => run.distance > 475);
  assert.equal(run.lane, 0);
});

test('transmission bolts wait for the course to clear', () => {
  const run = new Run({ seed: 42 });
  run.obstacles.length = 0;
  run.addObstacle(70, 0, 'barrier');
  assert.ok(run.requestTransmission(8));
  while (run.transmission.phase === 'draining') {
    assert.deepEqual(run.bolts, []);
    run.tick();
    assert.equal(run.crash, null);
  }
  assert.ok(run.distance > 70);
  tickUntil(run, () => run.bolts.length > 0);
  assert.equal(run.bolts[0].transmission, true);
  assert.equal(run.bolts[0].lane, 2);
});

test('all live clues provide a visible, followable trail with one-lane transitions across speeds', () => {
  const cases = CLUES.map(({ duration }, index) => ({ index, duration }));
  cases.push({ index: 3, duration: CLUES[3].duration, speed: 572 });
  for (const { index, duration, speed } of cases) {
    const run = new Run({ seed: 42 + index, discoveredClues: index, transmissionCount: CLUES.length });
    if (speed) run.baseSpeed = run.speed = speed;
    const entryLane = index % 2 ? 4 : 0;
    run.obstacles.length = 0;
    for (let move = 0; move < 2; move++) run.move(entryLane - run.lane);
    assert.ok(run.requestTransmission(duration, index + 1));
    tickUntil(run, () => run.transmission.phase === 'playing');
    run.dash();
    const seen = new Set();
    let previousLane = entryLane;
    let previousZ = run.distance;
    let changes = 0;
    while (run.transmission.phase === 'playing') {
      const bolt = run.bolts[0];
      if (bolt && bolt.z - run.distance <= run.speed * 0.5) run.move(bolt.lane - run.lane);
      if (run.transmission.elapsed >= 2.2 && run.transmission.elapsed < 2.2 + STEP) run.slide();
      run.tick();
      assert.equal(run.crash, null);
      if (run.transmission.phase !== 'playing') break;
      assert.deepEqual(run.obstacles, []);
      for (const visible of run.bolts) {
        if (seen.has(visible)) continue;
        seen.add(visible);
        assert.ok(visible.transmission);
        assert.ok((visible.z - run.distance) / run.speed > 0.65, 'Trail should show ahead of contact');
        assert.ok(visible.z - run.distance < run.viewDistance);
        assert.ok(visible.z > previousZ);
        assert.ok(Math.abs(visible.lane - previousLane) <= 1);
        if (visible.lane !== previousLane) changes++;
        previousZ = visible.z;
        previousLane = visible.lane;
      }
    }
    assert.equal([...seen][0].lane, entryLane);
    assert.ok(changes >= 3);
    assert.ok(seen.size / duration >= 2 && seen.size / duration <= 3);
    assert.equal(run.boltsCollected, seen.size);
    assert.equal(run.dashCharge, 1);
    for (let i = 0; i < 5 / STEP; i++) {
      // Inspect the post-window pickup cadence on unobstructed deck.
      run.obstacles.length = 0;
      run.tick();
      assert.equal(run.crash, null);
      assert.deepEqual(run.bolts, []);
    }
    tickUntil(run, () => {
      run.obstacles.length = 0;
      return run.bolts.length > 0;
    });
    assert.equal(run.bolts[0].transmission, false);
  }
});

test('scripted practice does not generate ordinary or transmission pickups', () => {
  const run = new Run({ scenario: 'landing' });
  assert.ok(run.requestTransmission(8));
  tickUntil(run, () => run.time > 20);
  assert.deepEqual(run.bolts, []);
  assert.equal(run.boltsCollected, 0);
});
