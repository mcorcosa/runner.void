const assert = require('node:assert/strict');
const test = require('node:test');
const { Run, STEP, PLATFORM_HEIGHT, SLIDE_GATE_CLEARANCE, SLIDE_DISTANCE, slideGateBounds, laneX, movingBarrierX,
  obstacles } = require('../game.js');

function until(run, condition) {
  for (let tick = 0; tick < 1200 && !run.crash && !condition(); tick++) run.tick();
  assert.ok(condition(), `Stopped at ${run.distance} m with ${JSON.stringify(run.crash)}`);
}

function track(speed, onEvent) {
  const run = new Run({ scenario: 'landing', onEvent });
  run.speed = run.baseSpeed = speed;
  return run;
}

test('each new practice hazard has about two seconds of approach at either pace', () => {
  for (const pace of ['', 'fast']) {
    for (const [scenario, type] of [
      ['platform', 'platform'], ['slide-gate', 'slideGate'],
      ['moving-barrier', 'movingBarrier'], ['black-hole', 'blackHole'],
    ]) {
      const run = new Run({ scenario, pace });
      const [obstacle] = run.obstacles;
      assert.equal(obstacle.type, type);
      assert.equal(run.scripted, true);
      until(run, () => run.crash || obstacle.triggered);
      assert.ok(run.time > 1.9 && run.time < 2.1, `${scenario} at ${run.time}s`);
    }
  }
});

test('the authored jump-and-slide and lane-jump courses are playable at both practice paces', () => {
  for (const pace of ['', 'fast']) {
    const combo = new Run({ scenario: 'jump-slide', pace, discoveredClues: 4 });
    const hurdle = combo.obstacles.find(({ type }) => type === 'hurdle');
    const gate = combo.obstacles.find(({ type }) => type === 'slideGate');
    assert.equal(gate.lane, hurdle.lane);
    combo.move(hurdle.lane - combo.lane);
    until(combo, () => hurdle.z - combo.distance <= combo.speed * 0.24);
    combo.jump();
    until(combo, () => !combo.airborne);
    until(combo, () => gate.z - combo.distance <= combo.speed * 0.13);
    combo.slide();
    until(combo, () => combo.distance > gate.end + 1);

    const lateral = new Run({ scenario: 'lane-jump', pace, discoveredClues: 4 });
    const launch = lateral.obstacles.find(({ lateralExit }) => lateralExit !== undefined);
    const direction = Math.sign(launch.lateralExit - launch.lane);
    assert.equal(Math.abs(launch.lateralExit - launch.lane), 2);
    lateral.move(launch.lane - lateral.lane);
    until(lateral, () => launch.z - lateral.distance <= lateral.speed * 0.26);
    lateral.jump();
    const jumpTime = lateral.time;
    until(lateral, () => lateral.time >= jumpTime + 0.15);
    lateral.move(direction);
    until(lateral, () => lateral.time >= jumpTime + 0.32);
    assert.ok(lateral.airborne && Math.abs(lateral.x - laneX(2)) < 0.2);
    lateral.move(direction);
    until(lateral, () => !lateral.airborne);
    assert.equal(lateral.lane, launch.lateralExit);
    assert.ok(lateral.distance < launch.end);

    for (const run of [combo, lateral]) {
      const lastId = run.id;
      assert.equal(run.scripted, true);
      assert.equal(run.musicTierFloor, 1);
      assert.equal(run.lastHazardEnd, Math.max(...run.obstacles.map(({ z, end }) => end ?? z)));
      until(run, () => run.time > 12);
      assert.equal(run.crash, null);
      assert.equal(run.id, lastId);
      assert.deepEqual(run.bolts, []);
    }
  }
});

test('platforms support landing, running, re-jumping, and stepping off at speed', () => {
  for (const speed of [32, 64, 572]) {
    for (const exit of ['rear', 'side']) {
      const events = [];
      const run = track(speed, (event) => events.push(event));
      const z = speed * 2;
      const end = z + speed * 2;
      run.addObstacle(z, 2, 'platform', { end, height: PLATFORM_HEIGHT });
      until(run, () => z - run.distance <= run.speed * 0.25);
      run.jump();
      until(run, () => run.slideWindowOpen);
      assert.ok(run.distance >= z && run.airborne);
      run.slide();
      until(run, () => !run.airborne);
      assert.deepEqual(events, ['land', 'boost']);
      assert.equal(run.height, PLATFORM_HEIGHT);
      until(run, () => run.distance > z + speed * 0.55);
      run.jump();
      assert.equal(run.airborne, true);
      run.tick();
      assert.ok(run.height > PLATFORM_HEIGHT);
      until(run, () => !run.airborne);
      assert.equal(run.height, PLATFORM_HEIGHT);
      if (exit === 'side') run.move(1);
      until(run, () => run.airborne);
      assert.ok(run.height > 0 && run.height < PLATFORM_HEIGHT);
      assert.ok(run.verticalSpeed < 0);
      assert.equal(run.distance < end, exit === 'side');
      until(run, () => !run.airborne);
      assert.equal(run.height, 0);
      assert.deepEqual(events, ['land', 'boost', 'land', 'land']);
      assert.equal(run.crash, null);
    }
  }
});

test('the air slide buffer uses the same foot clearance at different descent speeds', () => {
  for (const verticalSpeed of [-1, -12]) {
    const events = [];
    const run = track(32, (event) => events.push(event));
    run.airborne = true;
    run.height = 1.01;
    run.verticalSpeed = verticalSpeed;
    if (verticalSpeed === -12) assert.ok(run.touchdownIn() < 0.13);
    assert.equal(run.slideWindowOpen, false);
    run.slide();
    assert.equal(run.queuedSlide, false);
    run.height = 1;
    assert.equal(run.slideWindowOpen, true);
    // The old 130 ms cutoff rejected the slow fall at the very same clearance.
    assert.equal(run.touchdownIn() > 0.13, verticalSpeed === -1);
    run.slide();
    assert.equal(run.queuedSlide, true);
    assert.equal(run.slideWindowOpen, false);
    assert.equal(run.boosting, false);
    assert.equal(run.sliding, false);
    until(run, () => !run.airborne);
    assert.deepEqual(events, ['land', 'boost']);
  }
});

test('a spike patch cannot serve as a landing or arm a slide through its teeth', () => {
  for (const height of [1.2, 0.99]) {
    const run = track(32);
    run.airborne = true;
    run.height = height;
    run.verticalSpeed = -6;
    run.addSpikes(0, 2, 1, 1);
    assert.equal(run.slideWindowOpen, false);
    run.slide();
    assert.equal(run.queuedSlide, false);
    until(run, () => run.crash);
    assert.equal(run.crash.type, 'spikes');
    assert.equal(run.boosting, false);
  }
});

test('raised tops must intersect the projected descent to accept a slide', () => {
  for (const [z, end, lane, lands] of [[3.5, 30, 2, true], [0, 1.5, 2, false], [0, 30, 3, false]]) {
    const events = [];
    const run = track(32, (event) => events.push([event, run.height]));
    run.airborne = true;
    run.height = PLATFORM_HEIGHT + 0.8;
    run.verticalSpeed = -4;
    run.addObstacle(z, lane, 'platform', { end });
    assert.equal(run.slideWindowOpen, lands);
    run.slide();
    assert.equal(run.queuedSlide, lands);
    until(run, () => !run.airborne);
    assert.deepEqual(events, lands ? [['land', PLATFORM_HEIGHT], ['boost', PLATFORM_HEIGHT]] : [['land', 0]]);
  }
});

test('steering away from a queued top requires fresh input for the deck landing', () => {
  for (const pressAgain of [false, true]) {
    const events = [];
    const run = track(32, (event) => events.push([event, run.height]));
    run.airborne = true;
    run.height = PLATFORM_HEIGHT + 0.8;
    run.verticalSpeed = -4;
    run.addObstacle(3.5, 2, 'platform', { end: 30 });
    run.slide();
    assert.equal(run.queuedSlide, true);
    run.move(1);
    run.tick();
    assert.equal(run.queuedSlide, false);
    until(run, () => run.slideWindowOpen);
    assert.ok(run.airborne && run.height <= 1);
    if (pressAgain) run.slide();
    until(run, () => !run.airborne);
    assert.deepEqual(events, pressAgain ? [['land', 0], ['boost', 0]] : [['land', 0]]);
  }
});

test('leaving the landed platform ends its grace even when an adjacent top keeps the runner grounded', () => {
  let landedAt;
  const run = track(32, (event) => { if (event === 'land') landedAt = run.distance; });
  run.addObstacle(0, 2, 'platform', { end: 100, height: PLATFORM_HEIGHT });
  run.addObstacle(0, 3, 'platform', { end: 100, height: PLATFORM_HEIGHT });
  run.airborne = true;
  run.height = PLATFORM_HEIGHT + 0.05;
  run.verticalSpeed = -8;
  run.tick();
  assert.equal(run.slideWindowOpen, true);
  run.move(1);
  until(run, () => run.x > 1.34);
  assert.equal(run.height, PLATFORM_HEIGHT);
  assert.equal(run.airborne, false);
  assert.ok(run.distance - landedAt < 3);
  assert.equal(run.slideWindowOpen, false);
  run.slide();
  assert.equal(run.braking, true);
});

test('platform front and side stay solid below the top even when boosted', () => {
  const front = track(572);
  front.addObstacle(3, 2, 'platform', { end: 100, height: 1.2 });
  front.powerSlide();
  front.dash();
  front.tick();
  assert.equal(front.crash.type, 'platform');
  assert.equal(front.dashSpent, false);
  assert.ok(front.distance < 3);

  const side = track(64);
  side.addObstacle(2, 2, 'platform', { end: 100, height: 1.2 });
  side.lane = 1;
  side.x = laneX(1);
  until(side, () => side.distance > 4);
  side.move(1);
  until(side, () => side.crash);
  assert.equal(side.crash.type, 'platform');
  assert.equal(side.height, 0);
  assert.ok(side.x < -1.3 && side.x > -1.4);
});

function jumpAtTop(height, descending = true) {
  return (9.8 + (descending ? 1 : -1) * Math.sqrt(9.8 ** 2 - 2 * 23 * height)) / 23;
}

function jumpDistance(speed, time) {
  return time * (speed + 1.8 * (time + STEP) / 2);
}

test('deck jumps can touch down on both flat shapes and on a laterally moving barrier at all tested speeds', () => {
  for (const speed of [32, 64, 572]) {
    for (const type of ['barrier', 'movingBarrier', 'hurdle']) {
      const events = [];
      const run = track(speed, (event) => events.push({ event, height: run.height, distance: run.distance }));
      const { height, halfDepth } = obstacles[type === 'hurdle' ? type : 'barrier'];
      const z = jumpDistance(speed, jumpAtTop(height));
      run.addObstacle(z, type === 'movingBarrier' ? 1 : 2, type, { toLane: 2 });
      run.jump();
      until(run, () => run.slideWindowOpen);
      run.slide();
      until(run, () => events.length >= 2);
      assert.deepEqual(events.map(({ event }) => event), ['land', 'boost']);
      assert.equal(events[0].height, height);
      assert.ok(Math.abs(events[0].distance - z) < 0.001);
      if (speed === 32) {
        assert.equal(run.airborne, false);
        assert.equal(run.height, height);
      }
      until(run, () => run.airborne && run.verticalSpeed < 0);
      assert.ok(run.distance > z + halfDepth);
      until(run, () => !run.airborne);
      assert.equal(run.height, 0);
      assert.equal(run.crash, null);
    }
  }
});

test('a shallow descending miss catches the lip while rising and lower face contacts still hit', () => {
  for (const type of ['barrier', 'movingBarrier', 'hurdle']) {
    const { height, halfDepth } = obstacles[type === 'hurdle' ? type : 'barrier'];
    for (const [offset, descending, lands] of [[0.04, true, true], [0.09, true, false], [0.04, false, false]]) {
      const events = [];
      const run = track(32, (event) => events.push(event));
      const z = jumpDistance(run.speed, jumpAtTop(height - offset, descending)) + halfDepth + 0.36;
      const lane = type === 'movingBarrier' && descending ? 1 : 2;
      run.addObstacle(z, lane, type, { toLane: lane + 1 });
      run.jump();
      if (lands) {
        until(run, () => run.slideWindowOpen);
        run.slide();
      }
      until(run, () => events.length > 0);
      assert.deepEqual(events, lands ? ['land', 'boost'] : ['crash']);
      assert.equal(run.crash?.type, lands ? undefined : type);
      assert.ok(Math.abs(run.height - (lands ? height : height - offset)) < 0.001);
    }
  }
});

test('gates sweep the standing, airborne, sliding, and elevated bodies at three speeds', () => {
  for (const speed of [32, 64, 572]) {
    for (const action of ['coast', 'jump', 'slide', 'powerSlide', 'elevatedSlide']) {
      const run = track(speed);
      const z = speed * 2;
      const end = z + speed * 0.11;
      if (action === 'elevatedSlide') {
        run.height = PLATFORM_HEIGHT;
        run.addObstacle(0, 2, 'platform', { end: end + 1, height: PLATFORM_HEIGHT });
      }
      run.addObstacle(z, 2, 'slideGate', { end });
      const { approach } = slideGateBounds(run.obstacles.at(-1));
      until(run, () => run.distance >= (action === 'jump' ? z - run.speed * 0.35 : approach));
      if (action === 'jump' || action === 'slide' || action === 'powerSlide') run[action]();
      if (action === 'elevatedSlide') run.slide();
      until(run, () => run.crash || run.distance > end + 1);
      const passes = action === 'slide' || action === 'powerSlide';
      assert.equal(run.crash?.type, passes ? undefined : 'slideGate', `${speed} m/s ${action}`);
      if (action === 'jump') assert.ok(run.height > SLIDE_GATE_CLEARANCE);
    }
  }
});

test('a gate checks a queued power slide at the substep position of its touchdown', () => {
  for (const [near, expected] of [[1, ['crash']], [3, ['land', 'boost']]]) {
    const events = [];
    const queued = track(572, (event) => events.push(event));
    queued.airborne = true;
    queued.verticalSpeed = -8;
    const flight = STEP / 2;
    queued.height = 8 * flight + 23 * flight ** 2 / 2;
    queued.slide();
    assert.equal(queued.queuedSlide, true);
    queued.addObstacle(near, 2, 'slideGate', { end: 5 });
    queued.tick();
    assert.deepEqual(events, expected);
  }
});

test('ground and power slides enter the same gate approach at every speed and stay low through the rear lip', () => {
  for (const speed of [32, 64, 572]) {
    for (const power of [false, true]) {
      for (const toApproach of [-5, 7, SLIDE_DISTANCE + 1]) {
        const run = track(speed);
        if (power) {
          const flight = STEP / 2;
          run.airborne = true;
          run.verticalSpeed = -8;
          run.height = 8 * flight + 23 * flight ** 2 / 2;
          run.tick();
          assert.equal(run.slideWindowOpen, true);
        }
        const slideStart = run.distance;
        const z = slideStart + toApproach + 180.36;
        const end = z + 60;
        run.addObstacle(z, 2, 'slideGate', { end });
        const { approach, front, back } = slideGateBounds(run.obstacles.at(-1));
        assert.ok(Math.abs(approach - slideStart - toApproach) < 1e-9);
        run.slide();
        const boostDeadline = run.time + 0.85;
        const nominal = run.slideEndDistance;
        assert.equal(nominal, slideStart + SLIDE_DISTANCE);
        until(run, () => run.distance >= nominal);
        assert.equal(run.sliding, toApproach < SLIDE_DISTANCE);
        assert.equal(run.braking, false);
        assert.ok(run.distance < front);
        if (toApproach > SLIDE_DISTANCE) {
          until(run, () => run.crash);
          assert.equal(run.crash.type, 'slideGate');
          continue;
        }

        until(run, () => run.distance > z);
        assert.equal(run.sliding, true);
        run.jump();
        assert.equal(run.airborne, false);
        while (run.distance < back) {
          assert.equal(run.boosting, power && run.time < boostDeadline);
          assert.equal(run.sliding, true);
          run.tick();
          assert.equal(run.crash, null);
        }
        assert.equal(run.sliding, false);
        run.jump();
        assert.equal(run.airborne, true);
      }
    }
  }
});

test('crossing the approach within a single tick is decided at the same distance at normal and late speeds', () => {
  for (const speed of [32, 572]) {
    for (const offset of [-0.08, 0, 0.08]) {
      const run = track(speed);
      const z = SLIDE_DISTANCE + 16.36 + offset;
      run.addObstacle(z, 2, 'slideGate', { end: z + 4 });
      const { approach, front, back } = slideGateBounds(run.obstacles[0]);
      assert.ok(Math.abs(approach - SLIDE_DISTANCE - offset) < 1e-9);
      run.slide();
      until(run, () => run.crash || run.distance > back);
      assert.equal(run.crash?.type, offset > 0 ? 'slideGate' : undefined);
      if (run.crash) assert.ok(Math.abs(run.distance - front) < 1e-9);
      else assert.equal(run.sliding, false);
    }
  }
});

test('steering and staggered beams only carry a crouch while the collider overlaps its path', () => {
  const idle = track(32);
  idle.addObstacle(0.36, 2, 'slideGate', { end: 10 });
  idle.tick();
  assert.equal(idle.crash?.type, 'slideGate');

  const adjacent = track(64);
  adjacent.addObstacle(90, 3, 'slideGate', { end: 130 });
  adjacent.slide();
  until(adjacent, () => adjacent.distance >= adjacent.slideEndDistance);
  assert.equal(adjacent.sliding, false);
  adjacent.move(1);
  until(adjacent, () => adjacent.crash);
  assert.equal(adjacent.crash.type, 'slideGate');

  const leave = track(64);
  leave.addObstacle(90, 3, 'slideGate', { end: 130 });
  leave.move(1);
  leave.slide();
  until(leave, () => leave.distance > 92);
  assert.equal(leave.sliding, true);
  leave.move(-1);
  until(leave, () => leave.x < 1.27);
  assert.equal(leave.sliding, false);
  leave.jump();
  assert.equal(leave.airborne, true);

  const cancel = track(64);
  cancel.addObstacle(90, 2, 'slideGate', { end: 130 });
  cancel.slide();
  until(cancel, () => cancel.distance >= cancel.slideEndDistance);
  assert.equal(cancel.sliding, true);
  cancel.jump();
  assert.ok(cancel.airborne && !cancel.sliding);

  for (const gap of [0.6, 0.8]) {
    const run = track(572);
    run.addObstacle(200, 2, 'slideGate', { end: 375 });
    run.addObstacle(301, 3, 'slideGate', { end: 550 });
    run.addObstacle(375 + gap, 2, 'slideGate', { end: 380 + gap });
    run.slide();
    until(run, () => run.crash || run.distance > 382);
    assert.equal(run.crash?.z, gap > 0.72 ? 375 + gap : undefined);
    if (gap < 0.72) assert.equal(run.sliding, false);
  }
});

test('moving barriers use lateral and forward sweeps and consume one break per dash', () => {
  const collision = track(572);
  collision.time = 0.45;
  collision.addObstacle(3, 1, 'movingBarrier', { toLane: 2 });
  const [barrier] = collision.obstacles;
  assert.equal(movingBarrierX(barrier, 0), laneX(1));
  assert.equal(movingBarrierX(barrier, 0.9), laneX(2));
  assert.ok(movingBarrierX(barrier, collision.time) < -1.23);
  collision.tick();
  assert.equal(collision.crash, barrier);
  assert.ok(collision.distance > 3 - 0.68 && collision.distance < 3);

  const events = [];
  const dash = track(572, (event, detail) => events.push([event, detail]));
  dash.time = 0.9;
  dash.addObstacle(2.1, 1, 'movingBarrier', { toLane: 2 });
  dash.addObstacle(4.2, 1, 'movingBarrier', { toLane: 2 });
  dash.dash();
  dash.tick();
  assert.deepEqual(events.map(([event]) => event), ['dash', 'break', 'crash']);
  assert.equal(events[1][1].type, 'movingBarrier');
  assert.ok(Math.abs(events[1][1].impact.x) < 1e-6);
  assert.equal(dash.crash.z, 4.2);
  assert.equal(dash.obstacles.length, 1);
});

test('black holes pull only a localized contact once, clamp at an edge, and let steering resume', () => {
  for (const speed of [32, 64, 572]) {
    for (const [lane, direction, pulledTo] of [[2, -1, 1], [2, 1, 3], [0, -1, 0], [4, 1, 4]]) {
      const events = [];
      const run = track(speed, (event) => events.push(event));
      run.lane = lane;
      run.x = laneX(lane);
      run.addObstacle(speed * 0.08, lane, 'blackHole', { direction });
      const [hole] = run.obstacles;
      until(run, () => hole.triggered);
      assert.equal(run.lane, pulledTo);
      run.move(-direction);
      assert.equal(run.lane, pulledTo - direction);
      until(run, () => run.time > 0.4);
      assert.equal(run.lane, pulledTo - direction);
      assert.deepEqual(events, ['black-hole']);
    }
    const clear = track(speed);
    clear.addObstacle(speed * 0.08, 1, 'blackHole', { direction: 1 });
    until(clear, () => clear.time > 0.4);
    assert.equal(clear.lane, 2);
    assert.equal(clear.obstacles[0].triggered, undefined);
  }
});

test('multi-lane gaps catch grounded runners and only check the deck on actual touchdown', () => {
  for (const speed of [32, 64, 572]) {
    for (const [lane, action, crashes] of [[2, 'coast', true], [3, 'coast', true], [4, 'coast', false],
      [3, 'jump', false], [3, 'airdash', false]]) {
      const run = track(speed);
      run.lane = lane;
      run.x = laneX(lane);
      const z = speed * 2;
      const end = run.addClosure(z, 2, speed * 0.46, true, 2);
      until(run, () => z - run.distance < run.speed * 0.16);
      if (action !== 'coast') run.jump();
      if (action === 'airdash') run.dash();
      until(run, () => run.crash || run.distance > end);
      assert.equal(run.crash?.type, crashes ? 'gap' : undefined, `${speed} m/s lane ${lane} ${action}`);
    }
  }
});

test('a transmission drains the full platform, gate, sweep, and black-hole trigger at high speed', () => {
  for (const [type, data, tail] of [
    ['platform', { end: 120, height: PLATFORM_HEIGHT }, 120.36],
    ['slideGate', { end: 80 }, 80.36],
    ['movingBarrier', { toLane: 4 }, 60.68],
    ['blackHole', { direction: -1 }, 61.51],
  ]) {
    const run = track(572);
    run.addObstacle(60, 3, type, data);
    run.requestTransmission(0.5);
    while (run.transmission.phase === 'draining') {
      assert.ok(run.distance <= tail);
      run.tick();
    }
    assert.ok(run.distance > tail);
    assert.equal(run.transmission.phase, 'playing');
    assert.equal(run.crash, null);
  }
});

test('endless generation restarts beyond the warning horizon after an authored hazard span drains', () => {
  const run = new Run({ seed: 187, discoveredClues: 4 });
  run.speed = run.baseSpeed = 572;
  run.distance = 90_000;
  run.obstacles.length = 0;
  run.addObstacle(90_020, 3, 'platform', { end: 90_085, height: PLATFORM_HEIGHT });
  run.addObstacle(90_150, 3, 'slideGate', { end: 90_208 });
  run.addObstacle(90_270, 3, 'movingBarrier', { toLane: 4 });
  run.addObstacle(90_320, 3, 'blackHole', { direction: -1 });
  run.addClosure(90_400, 3, 300, false, 2);
  run.shortGapDue = true;
  run.closure = { lane: 3, end: 90_700 };
  const firstNewId = run.id;

  assert.equal(run.requestTransmission(0.5), true);
  until(run, () => run.transmission.phase === 'playing');
  assert.ok(run.distance > 90_700.36);
  assert.equal(run.id, firstNewId);
  until(run, () => run.transmission.phase === 'complete');
  assert.equal(run.closure, null);
  assert.equal(run.shortGapDue, false);

  const added = run.obstacles.filter(({ id }) => id >= firstNewId);
  assert.ok(added.length);
  assert.ok(added[0].z - run.distance - 1.51 >= run.viewDistance);
  assert.ok(added.every(({ z }, index) => index === 0 || z >= added[index - 1].z));
  assert.ok(run.lastHazardEnd >= Math.max(...added.map(({ z, end }) => end ?? z)));
});

test('bolt integration clips pickups at crash and locks an already active dash after a refill', () => {
  const events = [];
  const run = track(572, (event) => events.push(event));
  run.addObstacle(3.5, 2, 'barrier');
  run.bolts.push(...[0.6, 0.9, 1.2, 1.5, 4.5].map((z, id) => ({ z, id, lane: 2, height: 0.82 })));
  run.dash();
  run.dashSpent = true;
  run.tick();
  assert.equal(run.dashCharge, 1);
  assert.equal(run.boltsCollected, 4);
  assert.deepEqual(events, ['dash', 'bolt', 'bolt', 'bolt', 'bolt', 'crash']);

  const active = track(572);
  active.bolts.push(...[0.6, 0.9, 1.2, 1.5].map((z, id) => ({ z, id, lane: 2, height: 0.82 })));
  active.dash();
  active.tick();
  assert.equal(active.dashCharge, 1);
  active.dashSpent = true;
  const expiry = active.dashUntil;
  active.dash();
  assert.equal(active.dashUntil, expiry);
  assert.equal(active.dashSpent, true);
  until(active, () => !active.dashing);
  active.dash();
  assert.ok(active.dashing);
  assert.equal(active.dashSpent, false);
});
