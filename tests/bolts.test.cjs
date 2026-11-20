const assert = require('node:assert/strict');
const test = require('node:test');
const { DASH_COOLDOWN, update } = require('../bolts.js');
const { Run, STEP, laneX } = require('../game.js');
const { CLUES } = require('../episode.js');

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
  const reached = addBolt(run, { z: 2 });
  // This bolt's catch radius touches the partial sweep, but its center is behind the crash.
  addBolt(run, { z: 4.1 });
  addBolt(run, { z: 4.5 });
  run.tick();
  assert.equal(run.crash.type, 'barrier');
  assert.ok(run.distance > 3.8 && run.distance < 4);
  assert.deepEqual(events.map(([event]) => event), ['bolt', 'crash']);
  assert.equal(events[0][1], reached);
  assert.equal(run.boltsCollected, 1);
  assert.equal(run.dashReadyAt, 3);
  run.tick();
  assert.equal(run.boltsCollected, 1);

  const restarted = new Run({ seed: 42 });
  assert.equal(restarted.boltsCollected, 0);
  assert.equal(restarted.dashCharge, 1);
  assert.deepEqual(restarted.bolts, []);
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
      assert.ok(!run.obstacles.some((obstacle) => blockedAt(obstacle, next.lane, next.z)),
        `seed ${seed}: bolt placed in a blocker at ${next.z} in lane ${next.lane}`);
      const near = run.obstacles.some((obstacle) => {
        const beside = Math.abs(next.z - obstacle.z) <= run.speed * 0.4 ? obstacle.z : next.z;
        return [next.lane - 1, next.lane + 1].some((lane) => blockedAt(obstacle, lane, beside));
      });
      placements.push({ ...next, eta, time: run.time + eta, near });
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
  assert.ok(first.placements[0].time >= 7 && first.placements[0].time < 10);
  assert.ok(first.placements.length >= 2);
});

test('ordinary spacing stays sparse across launch speeds and late bolts favor adjacent hazards', () => {
  for (const tier of [0, 1, 2, 3, 4]) {
    for (const seed of [42, 187, 0xffffffff]) {
      const { placements } = surveyCourse(seed, tier, 205);
      const late = placements.filter(({ time }) => time > 32);
      assert.ok(late.length >= 17 && late.length <= 25, `seed ${seed}, clues ${tier}: ${late.length} late bolts`);
      const near = late.filter((bolt) => bolt.near).length;
      assert.ok(near / late.length >= 0.65, `seed ${seed}, clues ${tier}: ${near}/${late.length} near hazards`);
      for (let i = 1; i < placements.length; i++) {
        const spacing = placements[i].time - placements[i - 1].time;
        assert.ok(spacing > 7 && spacing < 12, `seed ${seed}, clues ${tier}: ${spacing}s between bolts`);
      }
    }
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
    const run = new Run({ seed: 42 + index, discoveredClues: index });
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
