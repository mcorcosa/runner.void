const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { Run, STEP, LANE_COUNT, LANE_WIDTH, START_SPEED, FAST_START_SPEED, MAX_EXTRA_SPEED, REACTION_TIME,
  MIN_VIEW_DISTANCE, VIEW_SECONDS, laneX } = require('../game.js');

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
  clean.jump();
  until(clean, () => clean.distance > 48);
  assert.equal(clean.crash, null);

  const tall = new Run({ scenario: 'barrier' });
  until(tall, () => tall.distance >= 28);
  tall.jump();
  until(tall, () => tall.crash);
  assert.equal(tall.crash.type, 'barrier');
});

test('a regular ground slide briefly slows forward travel without blocking movement or jumping', () => {
  for (const speed of [32, 64, 572]) {
    const run = new Run({ scenario: 'landing' });
    run.baseSpeed = speed;
    run.slide();
    assert.equal(run.sliding, true);
    assert.equal(run.boosting, false);
    assert.equal(run.airborne, false);
    run.tick();
    assert.equal(run.speed, run.baseSpeed - Math.min(run.baseSpeed * 0.08, 12));
    assert.equal(run.distance, run.speed * STEP);
    run.move(1);
    run.tick();
    assert.equal(run.lane, 3);
    assert.ok(run.x > 0);
    const slideEnd = run.slideUntil;
    run.slide();
    assert.equal(run.slideUntil, slideEnd);
    until(run, () => !run.sliding);
    assert.ok(run.time - 0.34 < STEP && run.time >= 0.34);
    assert.equal(run.speed, run.baseSpeed);
    run.slide();
    run.jump();
    run.tick();
    assert.equal(run.airborne, true);
    assert.equal(run.sliding, false);
    assert.equal(run.speed, run.baseSpeed);
  }
});

test('a fresh slide just before or after touchdown gives one +15 m/s power slide for 0.85 s', () => {
  const events = [];
  const early = new Run({ scenario: 'landing', onEvent: (event) => events.push(event) });
  early.jump();
  until(early, () => early.slideWindowOpen);
  assert.equal(early.airborne, true);
  assert.ok(early.touchdownIn() <= 0.13 && early.touchdownIn() > 0.13 - STEP);
  early.slide();
  early.slide();
  assert.equal(early.boosting, false);
  assert.equal(early.sliding, false);
  until(early, () => !early.airborne);
  const touchdown = early.time;
  assert.equal(early.boosting, true);
  assert.equal(early.sliding, true);
  assert.equal(early.slideWindowOpen, false);
  early.slide();
  assert.deepEqual(events, ['land', 'boost']);
  early.tick();
  assert.equal(early.speed, early.baseSpeed + 15);
  until(early, () => !early.boosting);
  assert.ok(early.time - touchdown - 0.85 < STEP && early.time - touchdown >= 0.85);
  assert.equal(early.speed, early.baseSpeed);

  const late = new Run({ scenario: 'landing' });
  late.jump();
  until(late, () => !late.airborne);
  const landedAt = late.time;
  assert.equal(late.landingSlideUntil, landedAt + 0.09);
  until(late, () => late.time >= landedAt + 0.08);
  late.slide();
  assert.equal(late.boosting, true);
  assert.equal(late.airborne, false);
});

test('early slide presses and additional jumps miss the power slide window', () => {
  const missed = new Run({ scenario: 'landing' });
  missed.jump();
  until(missed, () => missed.time > 0.2);
  missed.slide();
  until(missed, () => missed.slideWindowOpen);
  missed.jump();
  until(missed, () => missed.time > 1);
  assert.equal(missed.boosting, false);
  assert.equal(missed.sliding, false);
  missed.slide();
  assert.equal(missed.sliding, true);
  assert.equal(missed.boosting, false);
  missed.jump();
  until(missed, () => !missed.airborne);
  assert.equal(missed.slideWindowOpen, true);
  missed.jump();
  assert.equal(missed.airborne, true);
  assert.equal(missed.slideWindowOpen, false);
  assert.equal(missed.boosting, false);
});

test('an air dash retimes the slide window until after the glide', () => {
  for (const tryAgain of [false, true]) {
    const events = [];
    const run = new Run({ scenario: 'landing', onEvent: (event) => events.push(event) });
    run.jump();
    until(run, () => run.slideWindowOpen);
    run.slide();
    run.dash();
    assert.equal(run.queuedSlide, false);
    assert.equal(run.slideWindowOpen, false);
    run.slide();
    until(run, () => run.slideWindowOpen);
    assert.ok(run.time > run.airDashUntil - 0.13);
    if (tryAgain) run.slide();
    until(run, () => !run.airborne);
    assert.equal(run.boosting, tryAgain);
    assert.deepEqual(events, tryAgain ? ['dash', 'land', 'boost'] : ['dash', 'land']);
  }
});

test('sliding preserves collision and dash rules, and a crash cancels a queued power slide', () => {
  const hurdle = new Run({ scenario: 'hurdle' });
  until(hurdle, () => hurdle.distance >= 39);
  hurdle.slide();
  until(hurdle, () => hurdle.crash);
  assert.equal(hurdle.crash.type, 'hurdle');
  assert.equal(hurdle.sliding, true);

  const dash = new Run({ scenario: 'barrier' });
  until(dash, () => dash.distance >= 38);
  dash.slide();
  dash.dash();
  until(dash, () => dash.dashSpent);
  assert.equal(dash.sliding, true);
  assert.equal(dash.crash, null);

  const events = [];
  const run = new Run({ scenario: 'landing', onEvent: (event) => events.push(event) });
  run.jump();
  until(run, () => run.slideWindowOpen);
  run.slide();
  run.addObstacle(run.distance + 0.8, run.lane, 'barrier');
  until(run, () => run.crash);
  run.slide();
  assert.deepEqual(events, ['crash']);
  assert.equal(run.queuedSlide, false);
  assert.equal(run.slideWindowOpen, false);
  assert.equal(run.boosting, false);
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
  const fast = new Run({ scenario: 'landing', pace: 'fast' });
  assert.equal(fast.speed, FAST_START_SPEED);
  until(fast, () => fast.time >= 1);
  assert.ok(fast.speed > 65);
  assert.equal(new Run({ scenario: 'high-speed' }).speed, 572);
  assert.equal(new Run({ seed: 187, pace: 'fast' }).speed, START_SPEED);
});

function crossSpikes({ pace = '', scenario = 'spike-long', jumpAt, dashAt = Infinity }) {
  const run = new Run({ scenario, pace });
  const patch = run.obstacles[0];
  while (!run.crash && run.distance < patch.end + 1) {
    if (run.distance >= jumpAt) {
      run.jump();
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
          run.powerSlide();
          run.jump();
          until(run, () => run.crash || run.distance > run.obstacles[0].end + 1);
        }
        assert.equal(run.crash?.type, 'spikes', `pace=${pace} jump=${jumpAt} lead=${groundDashLead}`);
      }
    }

    const run = new Run({ scenario: 'spike-long', pace });
    until(run, () => run.distance >= (pace ? 20 : 49));
    run.jump();
    until(run, () => run.slideWindowOpen);
    run.slide();
    until(run, () => !run.airborne);
    assert.equal(run.boosting, true);
    run.dash();
    run.jump();
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
    closed.jump();
    closed.dash();
    until(closed, () => closed.crash);
    assert.equal(closed.crash.type, 'roadblock');
    assert.equal(closed.crash.z, 66);
    assert.equal(closed.distance, 65.64);
    assert.equal(closed.dashSpent, false);

    const lateral = new Run({ scenario: 'gap', pace });
    lateral.move(-1);
    until(lateral, () => lateral.distance >= 86);
    lateral.jump();
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

test('distance gates introduce hazards and increase lane coverage even when rows are prefetched', () => {
  class PrefetchedRun extends Run {
    get viewDistance() { return 9000; }
  }

  const sample = new PrefetchedRun({ seed: 187 });
  assert.equal(sample.distance, 0);
  assert.deepEqual(sample.obstacles, new PrefetchedRun({ seed: 187 }).obstacles);
  assert.notDeepEqual(sample.obstacles, new PrefetchedRun({ seed: 188 }).obstacles);

  const stages = Array.from({ length: 3 }, () => ({
    standard: [], interior: [], combinedSpikes: [],
  }));
  for (let seed = 1; seed <= 24; seed++) {
    const { obstacles } = new PrefetchedRun({ seed });
    const [hurdle, barrier] = obstacles;
    assert.deepEqual([hurdle, barrier].map(({ type, lane, z }) => [type, lane, z]), [
      ['hurdle', 2, 78], ['barrier', 2, 165],
    ]);
    const introductions = obstacles.filter(({ type }) => type === 'spikes' || type === 'gap').slice(0, 4);
    assert.deepEqual(introductions.map(({ type, tiles, lanes, lane }) => [type, tiles, lanes, lane]), [
      ['spikes', 1, 1, 2], ['spikes', 2, 1, 2], ['spikes', 1, 2, 2], ['gap', undefined, undefined, 2],
    ]);
    const gates = [360, 640, 900, 1200, 1800];
    const rows = new Map();
    for (const obstacle of obstacles) {
      if (obstacle.z >= 9000) break;
      if (!rows.has(obstacle.z)) rows.set(obstacle.z, []);
      rows.get(obstacle.z).push(obstacle);
    }
    for (const [index, intro] of introductions.entries()) {
      assert.ok(intro.z >= gates[index] && intro.z < gates[index + 1],
        `Seed ${seed} introduces ${intro.type} at ${intro.z} m`);
      assert.deepEqual(rows.get(intro.z).map(({ type }) => type),
        intro.type === 'gap' ? ['roadblock', 'gap'] : ['spikes']);
    }

    let closedUntil = 0;
    for (const [z, row] of rows) {
      const stage = stages[z < 1800 ? 0 : z < 3600 ? 1 : 2];
      const gap = row.find(({ type }) => type === 'gap');
      const spike = row.find(({ type }) => type === 'spikes');
      if (gap) closedUntil = gap.end;
      else if (spike) stage.combinedSpikes.push(Number(spike.tiles === 2 && spike.lanes === 2));
      else if (z < closedUntil) stage.interior.push(row.length);
      else stage.standard.push(row.length);
    }
  }

  const average = (rows) => rows.reduce((sum, value) => sum + value, 0) / rows.length;
  const [early, middle, late] = stages;
  assert.ok(early.standard.every((count) => count === 1));
  assert.ok(early.interior.every((count) => count === 1));
  assert.ok(early.combinedSpikes.every((combined) => !combined));
  assert.ok(average(middle.standard) >= 2);
  assert.ok(average(late.standard) > average(middle.standard) + 0.3);
  assert.ok(average(middle.interior) > 1);
  assert.ok(average(late.interior) > average(middle.interior) + 0.2);
  assert.ok(average(middle.combinedSpikes) > 0.1);
  assert.ok(average(late.combinedSpikes) > average(middle.combinedSpikes) + 0.1);
});

test('seeded courses keep one-move reachability and reaction time across full closure spans', () => {
  for (let seed = 1; seed <= 24; seed++) {
    const run = new Run({ seed });
    assert.equal(run.speed, START_SPEED);
    let lastRow = 0;
    let lastEnd = 0;
    let sawSpikes = false;
    let closure = null;
    let closuresCompleted = 0;
    let previousClosureEnd = 0;
    const lanes = Array.from({ length: LANE_COUNT }, (_, lane) => lane);
    let open = lanes;
    while (run.distance < 4000 || closure) {
      const z = run.obstacles.find((obstacle) => obstacle.z > lastRow)?.z;
      assert.ok(z > lastRow, 'The next row should be generated ahead of the runner');
      if (closure && z >= closure.gap.end) {
        const { gap, began, entrySpeed, openNeighbors, beats } = closure;
        until(run, () => run.distance >= gap.end);
        assert.ok(run.time - began >= 3 - 1 / 120);
        assert.ok(openNeighbors.length >= 1, 'A neighboring lane stays playable through the full closure');
        assert.ok(beats >= 1, 'Long closures include at least one interior row');
        assert.ok(gap.end - gap.z >= 3 * (entrySpeed + MAX_EXTRA_SPEED));
        assert.equal(beats, 2);
        closuresCompleted++;
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
      const speedAfterPrevious = Math.sqrt(START_SPEED ** 2 + 3.6 * lastEnd);
      const minimumReactionDistance = (speedAfterPrevious + MAX_EXTRA_SPEED) * REACTION_TIME + 0.9 * REACTION_TIME ** 2;
      assert.ok(z - lastEnd - 1.4 >= minimumReactionDistance,
        `seed ${seed}: ${lastEnd} to ${z} at ${approachSpeed} m/s`);
      const gap = row.find((obstacle) => obstacle.type === 'gap');
      if (gap) {
        assert.equal(closure, null);
        assert.ok(gap.z - previousClosureEnd >= 3.55 * (START_SPEED + MAX_EXTRA_SPEED));
        closure = { gap, began: run.time, entrySpeed: approachSpeed,
          openNeighbors: lanes.filter((lane) => Math.abs(lane - gap.lane) === 1), beats: 0 };
      }
      lastRow = z;
      lastEnd = end;
      open = nextOpen;
    }
    assert.ok(run.baseSpeed > 120);
    assert.equal(sawSpikes, true);
    assert.ok(closuresCompleted >= 2);
  }
});

test('the endless generator carries a reachable run past 140 m/s and through five minutes at 572 m/s', () => {
  const run = new Run({ seed: 187 });
  const gaps = new Map();
  const seen = new Set();
  let widestCourseBuffer = 0;
  for (let tick = 1; tick <= 36_000; tick++) {
    const upcoming = run.obstacles.find((obstacle) => obstacle.z > run.distance + 8);
    assert.ok(upcoming || run.lastHazardEnd >= run.distance + run.viewDistance);
    if (upcoming && upcoming.z - run.distance < run.speed * 0.67) {
      const blocked = new Set(run.obstacles.filter((obstacle) => obstacle.z === upcoming.z ||
        (obstacle.type === 'gap' && obstacle.z <= run.distance && obstacle.end > run.distance))
        .flatMap((obstacle) => Array.from({ length: obstacle.lanes ?? 1 }, (_, offset) => obstacle.lane + offset)));
      const lane = [run.lane, run.lane - 1, run.lane + 1].find((candidate) =>
        candidate >= 0 && candidate < LANE_COUNT && !blocked.has(candidate));
      if (lane !== undefined) run.move(lane - run.lane);
    }
    for (const item of run.obstacles) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (item.type === 'gap') gaps.set(item.id, { gap: item, interior: [] });
      const containing = [...gaps.values()].find(({ gap }) => item.z > gap.z && item.z < gap.end);
      if (containing) containing.interior.push(item);
    }
    run.tick();
    assert.equal(run.crash, null);
    for (const record of gaps.values()) {
      if (!record.began && run.distance >= record.gap.z) {
        record.began = run.time;
        record.entrySpeed = run.baseSpeed;
      }
      if (!record.ended && run.distance >= record.gap.end) record.ended = run.time;
    }
    widestCourseBuffer = Math.max(widestCourseBuffer, run.obstacles.length);
    if (tick === 7200 || tick === 36_000) {
      const elapsed = tick * STEP;
      assert.ok(Math.abs(run.time - elapsed) < 1e-7);
      assert.ok(Math.abs(run.speed - (32 + 1.8 * elapsed)) < 1e-7);
      assert.ok(run.viewDistance >= (run.speed + MAX_EXTRA_SPEED) * VIEW_SECONDS);
      assert.ok(run.lastHazardEnd >= run.distance + run.viewDistance);
    }
  }

  const lateClosures = Array.from(gaps.values()).filter(({ gap }) => gap.z > 70_000 && gap.end < run.distance);
  assert.ok(lateClosures.length >= 3);
  for (const { gap, interior, began, ended, entrySpeed } of lateClosures) {
    const rows = new Set(interior.map(({ z }) => z));
    const blocked = new Set(interior.map(({ lane }) => lane));
    assert.equal(rows.size, 2);
    assert.equal(blocked.has(gap.lane), false);
    assert.ok([gap.lane - 1, gap.lane + 1].some((lane) => lane >= 0 && lane < LANE_COUNT && !blocked.has(lane)));
    assert.ok(gap.end - gap.z >= (entrySpeed + MAX_EXTRA_SPEED) * 3);
    assert.ok(ended - began >= 3 - STEP);
  }
  assert.ok(widestCourseBuffer <= 20);
});

test('high speed keeps short jumps and the two-tile airborne dash contract', () => {
  for (const speed of [140, 572, 1500]) {
    for (const [tiles, tactic, passes] of [
      [1, 'jump', true], [2, 'jump', false], [2, 'ground burst', false], [2, 'air dash', true],
    ]) {
      const run = new Run({ scenario: 'landing' });
      run.baseSpeed = run.speed = speed;
      const start = speed * 2;
      const end = run.addSpikes(start, 2, tiles, 1);
      until(run, () => run.distance >= start - speed * 0.16);
      if (tactic === 'ground burst') {
        run.powerSlide();
        run.dash();
      }
      run.jump();
      if (tactic === 'air dash') {
        until(run, () => run.distance >= start + speed * 0.08);
        run.dash();
      }
      until(run, () => run.crash || run.distance > end + 1);
      assert.equal(!run.crash, passes, `${speed} m/s, ${tiles} tile(s), ${tactic}`);
    }
  }
});

test('high-speed sweeps hit consecutive barriers in one step and only break the first', () => {
  const impacts = [];
  const run = new Run({ scenario: 'landing', onEvent: (event) => impacts.push(event) });
  run.speed = run.baseSpeed = 572;
  run.addObstacle(1.1, 2, 'barrier');
  run.addObstacle(4.5, 2, 'barrier');
  run.dash();
  run.tick();
  assert.deepEqual(impacts, ['dash', 'break', 'crash']);
  assert.equal(run.crash.z, 4.5);
  assert.ok(Math.abs(run.distance - 3.82) < 1e-9);
});

test('dash and power slide add speed at 572 m/s and expire while base speed keeps rising', () => {
  const run = new Run({ scenario: 'landing' });
  run.baseSpeed = run.speed = 572;
  run.jump();
  until(run, () => run.slideWindowOpen);
  run.slide();
  until(run, () => run.boosting);
  run.dash();
  run.tick();
  const dashGain = 22 * Math.sqrt((0.7 - STEP) / 0.7);
  assert.ok(Math.abs(run.speed - run.baseSpeed - 15 - dashGain) < 1e-8);
  until(run, () => !run.boosting && !run.dashing);
  assert.equal(run.speed, run.baseSpeed);
  assert.ok(run.baseSpeed > 575);
});

function browserHarness(scenario, {
  reducedMotion = false, pace = '', touch = false, standalone = false, appleStandalone = false,
  userAgent = '', platform = '', maxTouchPoints = 0, protocol = 'https:', storage,
} = {}) {
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
      this.attributes = new Map();
    }
    addEventListener(type, handler) { this.events[type] = handler; }
    setPointerCapture(id) { this.capture.add(id); }
    hasPointerCapture(id) { return this.capture.has(id); }
    releasePointerCapture(id) { this.capture.delete(id); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
  }
  class Button extends Target {
    blur() { dom.activeElement = dom.body; }
    focus() { dom.activeElement = this; }
  }
  class Dialog extends Target {
    showModal() { this.setAttribute('open', ''); }
    close() { this.removeAttribute('open'); }
  }
  const ids = Object.fromEntries(Array.from(source.matchAll(/<(\w+)[^>]+id="([\w-]+)"/g),
    ([, tag, id]) => [id, tag === 'button' ? new Button() : tag === 'dialog' ? new Dialog() : new Target()]));
  const classes = { '.intro': new Target(), '.results': new Target() };
  const dom = Object.assign(new Target(), {
    body: new Target(), getElementById: (id) => ids[id], querySelector: (selector) => classes[selector],
  });
  dom.body.dataset.mode = 'ready';
  let draws = 0;
  let paceStrokes = 0;
  let speedStrokes = 0;
  let dashStrokes = 0;
  const noop = () => {};
  const ctx = new Proxy({
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    fill: () => { draws++; },
    stroke() {
      if (typeof this.strokeStyle !== 'string') return;
      if (this.strokeStyle === '#c9a3f4') paceStrokes++;
      else if (this.strokeStyle.startsWith('rgba(195, 230, 255,')) dashStrokes++;
      else if (this.strokeStyle.startsWith('rgba(')) speedStrokes++;
    },
  }, { get: (target, key) => target[key] ?? noop });
  Object.assign(ids.scene, { clientWidth: 1440, clientHeight: 900, getContext: () => ctx });
  const window = new Target();
  if (storage) window.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  let insets = {};
  let observeResize;
  let motionChanged;
  const context = vm.createContext({
    document: dom, window, HTMLButtonElement: Button, devicePixelRatio: 1,
    navigator: { standalone: appleStandalone, userAgent, platform, maxTouchPoints },
    matchMedia: (query) => {
      if (query === '(pointer: coarse)') return { matches: touch };
      if (query.includes('display-mode')) return { matches: standalone };
      return { matches: reducedMotion, addEventListener: (event, listener) => { if (event === 'change') motionChanged = listener; } };
    },
    getComputedStyle: () => ({ getPropertyValue: (prop) => `${insets[prop.slice(7)] ?? 0}px` }),
    ResizeObserver: class {
      constructor(callback) { observeResize = callback; }
      observe() {}
    },
    URLSearchParams, location: { search: `?scenario=${scenario}&pace=${pace}`, protocol },
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
    paceStrokes: () => paceStrokes, speedStrokes: () => speedStrokes, dashStrokes: () => dashStrokes,
    get scene() { return scene; }, get runner() { return runner; },
    key(type, code, repeat = false, options = {}) {
      let prevented = false;
      window.events[type]({ code, repeat, preventDefault: () => { prevented = true; }, ...options });
      return prevented;
    },
    click(target, options = {}) {
      const element = ids[target];
      element.events.click({ isTrusted: true, currentTarget: element, detail: 1, ...options });
    },
    pointer(target, type, pointerId, clientX, clientY, options = {}) {
      const element = ids[target];
      let prevented = false;
      element.events[type]?.({ pointerId, clientX, clientY, pointerType: 'touch', button: 0,
        isTrusted: true, currentTarget: element,
        preventDefault: () => { prevented = true; }, ...options });
      if (['pointerup', 'pointercancel', 'lostpointercapture'].includes(type)) element.releasePointerCapture(pointerId);
      return prevented;
    },
    windowEvent: (type, event) => window.events[type](event),
    documentEvent: (type) => dom.events[type](),
    changeReducedMotion: (matches) => motionChanged({ matches }),
    resize(width, height, safe, source = 'resize') {
      Object.assign(ids.scene, { clientWidth: width, clientHeight: height });
      insets = safe;
      if (source === 'observer') observeResize();
      else if (dom.events[source]) dom.events[source]();
      else window.events[source]();
    },
    delayFrame(milliseconds) { now += milliseconds; },
    step(count) {
      for (let frame = 0; frame < count; frame++) {
        frames.shift()(now);
        now += 1000 / 60;
      }
    },
  };
}

test('a native mobile start requests game fullscreen synchronously and manual exit keeps the run', async () => {
  const page = browserHarness('hurdle', { touch: true });
  const root = page.ids.game;
  const viewportRequests = [];
  let tapping = false;
  root.requestFullscreen = function ({ navigationUI }) {
    assert.equal(this, root);
    assert.ok(tapping);
    viewportRequests.push([navigationUI, page.dom.body.dataset.mode]);
    return Promise.resolve();
  };
  const tap = (button) => {
    tapping = true;
    page.click(button, { pointerType: 'touch' });
    tapping = false;
  };
  page.step(1);
  tap('start');
  assert.deepEqual(viewportRequests, [['hide', 'ready']]);
  assert.equal(page.dom.body.dataset.mode, 'running');
  assert.equal(page.ids['touch-controls'].hidden, false);
  await new Promise((resolve) => setImmediate(resolve));

  page.dom.fullscreenElement = root;
  page.resize(390, 844, { top: 47, bottom: 34 }, 'fullscreenchange');
  page.step(12);
  const run = page.runner;
  const beforeRotation = run.distance;
  page.pointer('swipe-field', 'pointerdown', 1, 110, 180);
  page.windowEvent('orientationchange');
  page.resize(844, 390, { left: 47, bottom: 21 });
  page.pointer('swipe-field', 'pointermove', 1, 165, 180);
  page.step(1);
  assert.equal(page.runner, run);
  assert.equal(page.scene.width, 844);
  assert.equal(run.lane, 2);
  assert.ok(run.distance > beforeRotation);

  page.pointer('swipe-field', 'pointerdown', 2, 110, 180);
  page.dom.fullscreenElement = null;
  page.resize(844, 315, { left: 47, bottom: 21 }, 'fullscreenchange');
  page.pointer('swipe-field', 'pointermove', 2, 170, 180);
  assert.equal(run.lane, 2);
  page.step(3);
  tap('start');
  assert.equal(page.runner, run);
  assert.equal(page.scene.height, 315);
  assert.equal(viewportRequests.length, 1);

  page.step(86);
  assert.equal(page.dom.body.dataset.mode, 'ended');
  tap('restart');
  assert.deepEqual(viewportRequests.at(-1), ['hide', 'ended']);
  page.step(1);
  assert.notEqual(page.runner, run);
  assert.equal(page.runner.distance, 0);
});

test('desktop inputs, synthetic taps, and a mouse following touch start a run without fullscreen', () => {
  const interactions = [
    (page) => page.key('keydown', 'Enter'),
    (page) => page.click('start', { pointerType: 'mouse' }),
    (page) => page.click('start', { pointerType: 'touch', isTrusted: false }),
    (page) => {
      page.pointer('start', 'pointerup', 1, 10, 10);
      page.pointer('start', 'pointerdown', 2, 10, 10, { pointerType: 'mouse' });
      page.click('start', { pointerType: undefined });
    },
    (page) => {
      page.pointer('start', 'pointerup', 1, 10, 10);
      page.click('start', { pointerType: undefined, detail: 0 });
    },
  ];
  for (const interaction of interactions) {
    const page = browserHarness('landing', { touch: true });
    let requests = 0;
    page.ids.game.requestFullscreen = () => { requests++; };
    interaction(page);
    assert.equal(page.dom.body.dataset.mode, 'running');
    assert.equal(requests, 0);
  }
});

test('legacy touch clicks use either WebKit fullscreen method and do not stack on an existing fullscreen', () => {
  for (const name of ['webkitRequestFullscreen', 'webkitRequestFullScreen']) {
    const page = browserHarness('hurdle');
    const root = page.ids.game;
    let requests = 0;
    root[name] = function (...args) {
      assert.equal(this, root);
      assert.equal(args.length, 0);
      requests++;
    };
    page.pointer('start', 'pointerup', 1, 10, 10);
    page.click('start', { pointerType: undefined });
    assert.equal(page.dom.body.dataset.touch, 'true');
    assert.equal(requests, 1);
    page.dom.webkitCurrentFullScreenElement = root;
    page.resize(390, 790, { bottom: 34 }, 'webkitfullscreenchange');
    page.step(90);
    assert.equal(page.dom.body.dataset.mode, 'ended');
    page.click('restart', { sourceCapabilities: { firesTouchEvents: true } });
    assert.equal(page.dom.body.dataset.mode, 'running');
    assert.equal(requests, 1);
  }
});

test('standalone, an existing fullscreen, a denied request, and absent APIs all preserve play', async () => {
  for (const [options, configure, expectedRequests] of [
    [{ standalone: true }, () => {}, 0],
    [{ appleStandalone: true }, () => {}, 0],
    [{}, (page) => { page.dom.fullscreenElement = page.ids.game; }, 0],
    [{}, (page) => { page.dom.fullscreenEnabled = false; }, 0],
    [{}, (page) => { delete page.ids.game.requestFullscreen; }, 0],
    [{}, () => {}, 1],
  ]) {
    const page = browserHarness('landing', options);
    let requests = 0;
    page.ids.game.requestFullscreen = () => {
      requests++;
      throw new Error('Platform denied fullscreen');
    };
    configure(page);
    page.click('start', { pointerType: 'touch' });
    page.step(4);
    assert.equal(page.dom.body.dataset.mode, 'running');
    assert.ok(page.runner.distance > 0);
    assert.equal(requests, expectedRequests);
  }

  const page = browserHarness('hurdle');
  let requests = 0;
  page.ids.game.requestFullscreen = () => {
    requests++;
    return Promise.reject(new Error('Platform denied fullscreen'));
  };
  page.ids.game.webkitRequestFullscreen = () => assert.fail('Rejection must not attempt another native request');
  page.click('start', { pointerType: 'touch' });
  page.step(90);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.dom.body.dataset.mode, 'ended');
  assert.equal(requests, 1);
  page.click('restart', { pointerType: 'touch' });
  assert.equal(page.dom.body.dataset.mode, 'running');
  assert.equal(requests, 2);
});

test('home-screen assets prefer fullscreen, fall back to standalone, and resolve under a subdirectory', () => {
  const read = (file) => readFileSync(join(__dirname, '..', file));
  const html = read('index.html').toString();
  const manifest = JSON.parse(read('manifest.webmanifest'));
  const url = new URL('https://example.com/runner/manifest.webmanifest');
  const expectedScope = 'https://example.com/runner/';
  assert.equal(new URL(manifest.scope, url).href, expectedScope);
  assert.equal(new URL(manifest.start_url, url).href, `${expectedScope}index.html`);
  assert.equal(manifest.id, undefined);
  assert.deepEqual(manifest.display_override, ['fullscreen', 'standalone']);
  assert.equal(manifest.display, 'standalone');
  assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /name="apple-mobile-web-app-status-bar-style" content="black-translucent"/);
  const apple = html.match(/rel="apple-touch-icon" sizes="(\d+x\d+)" href="([^"]+)"/);
  assert.ok(apple);
  assert.equal(apple[1], '180x180');
  assert.deepEqual(manifest.icons.map(({ sizes }) => sizes), ['192x192', '512x512']);
  for (const { src, sizes } of [...manifest.icons, { src: apple[2], sizes: apple[1] }]) {
    const icon = read(src);
    assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(icon.subarray(12, 16).toString(), 'IHDR');
    assert.equal(`${icon.readUInt32BE(16)}x${icon.readUInt32BE(20)}`, sizes);
  }
});

test('iPhone Install shows the Safari steps and traps keyboard focus without starting the run', () => {
  const page = browserHarness('landing', { userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit Safari', touch: true });
  const trigger = page.ids.install;
  const guide = page.ids['install-guide'];
  const done = page.ids['install-done'];
  assert.equal(trigger.hidden, false);
  trigger.focus();
  assert.equal(page.key('keydown', 'Enter', false, { target: trigger }), false);
  page.click('install');
  assert.equal(guide.getAttribute('open'), '');
  assert.equal(page.ids['install-apple-steps'].hidden, false);
  assert.equal(page.ids['install-browser-steps'].hidden, true);
  assert.equal(page.ids['install-host-note'].hidden, true);
  assert.equal(page.dom.activeElement, done);
  assert.equal(page.key('keydown', 'Tab', false, { shiftKey: true }), true);
  assert.equal(page.dom.activeElement, done);
  page.key('keydown', 'Enter');
  page.click('start');
  assert.equal(page.dom.body.dataset.mode, 'ready');

  page.resize(667, 320, { left: 44, bottom: 21 });
  assert.equal(guide.getAttribute('open'), '');
  assert.equal(page.key('keydown', 'Escape'), true);
  assert.equal(guide.getAttribute('open'), null);
  assert.equal(page.dom.activeElement, trigger);
  assert.equal(page.key('keydown', 'Space', false, { target: trigger }), false);
  page.click('install');
  page.click('install-done');
  assert.equal(page.dom.activeElement, trigger);
  assert.equal(page.dom.body.dataset.mode, 'ready');
  page.click('start', { pointerType: 'touch' });
  assert.equal(trigger.hidden, true);
});

test('manual help is platform-specific and the fallback dialog can be dismissed', () => {
  const page = browserHarness('landing', { userAgent: 'Mobile Firefox Android', touch: true, protocol: 'file:' });
  const guide = page.ids['install-guide'];
  guide.showModal = undefined;
  guide.close = undefined;
  page.click('install');
  assert.equal(guide.getAttribute('open'), '');
  assert.equal(page.classes['.intro'].inert, true);
  assert.equal(page.ids['install-apple-steps'].hidden, true);
  assert.equal(page.ids['install-browser-steps'].hidden, false);
  assert.equal(page.ids['install-host-note'].hidden, false);
  page.click('install-guide', { target: page.ids['install-title'] });
  assert.equal(guide.getAttribute('open'), '');
  page.click('install-guide', { target: guide });
  assert.equal(guide.getAttribute('open'), null);
  assert.equal(page.classes['.intro'].inert, false);
  assert.equal(page.dom.activeElement, page.ids.install);
  assert.equal(page.dom.body.dataset.mode, 'ready');

  const ipad = browserHarness('landing', { platform: 'MacIntel', maxTouchPoints: 5 });
  ipad.click('install');
  assert.equal(ipad.ids['install-apple-steps'].hidden, false);
});

test('native install uses a captured offer synchronously, consumes it, and handles cancellation and a fresh offer', async () => {
  const page = browserHarness('landing');
  const trigger = page.ids.install;
  assert.equal(trigger.hidden, true);
  let called = 0;
  let onClickStack = false;
  let finishChoice;
  const offer = {
    prompt() {
      assert.ok(onClickStack);
      assert.equal(this, offer);
      called++;
      return Promise.resolve();
    },
    userChoice: new Promise((resolve) => { finishChoice = resolve; }),
    preventDefault() { this.prevented = true; },
  };
  page.windowEvent('beforeinstallprompt', offer);
  assert.equal(offer.prevented, true);
  assert.equal(trigger.hidden, false);
  trigger.focus();
  onClickStack = true;
  page.click('install');
  onClickStack = false;
  assert.equal(called, 1);
  assert.equal(trigger.getAttribute('aria-disabled'), 'true');
  page.key('keydown', 'Enter');
  page.click('start');
  page.click('install');
  assert.equal(called, 1);
  assert.equal(page.dom.body.dataset.mode, 'ready');
  finishChoice({ outcome: 'dismissed' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(trigger.getAttribute('aria-disabled'), 'false');
  assert.equal(page.dom.activeElement, trigger);
  page.click('install');
  assert.equal(called, 1);
  assert.equal(page.ids['install-browser-steps'].hidden, false);
  page.click('install-done');

  page.windowEvent('beforeinstallprompt', { preventDefault() {}, prompt() { called++; return { outcome: 'accepted' }; } });
  page.click('install');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(called, 2);
  assert.equal(trigger.hidden, true);
  assert.equal(page.dom.activeElement, page.ids.start);
  assert.equal(page.dom.body.dataset.mode, 'ready');
});

test('install visibility follows appinstalled, standalone, confirmed installs, and game mode', async () => {
  for (const mode of [{ standalone: true }, { appleStandalone: true }]) {
    const page = browserHarness('landing', { ...mode, touch: true, userAgent: 'iPhone Safari' });
    page.windowEvent('beforeinstallprompt', { preventDefault() {}, prompt() { assert.fail('Standalone must not prompt'); } });
    assert.equal(page.ids.install.hidden, true);
  }
  const storage = new Map();
  const page = browserHarness('hurdle', { userAgent: 'iPhone Safari', touch: true, storage });
  page.click('install');
  page.windowEvent('appinstalled');
  assert.equal(page.ids['install-guide'].getAttribute('open'), null);
  assert.equal(page.ids.install.hidden, true);
  assert.equal(page.dom.activeElement, page.ids.start);

  const reload = browserHarness('hurdle', { touch: true, storage });
  assert.equal(reload.ids.install.hidden, true);
  reload.windowEvent('beforeinstallprompt', { preventDefault() {}, prompt() { return Promise.reject(new Error('denied')); } });
  assert.equal(reload.ids.install.hidden, false);
  reload.click('install');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reload.ids['install-guide'].getAttribute('open'), '');
  reload.click('install-done');
  reload.click('start');
  reload.windowEvent('beforeinstallprompt', { preventDefault() {}, prompt() { assert.fail('No prompt during play'); } });
  assert.equal(reload.ids.install.hidden, true);
  reload.step(90);
  assert.equal(reload.dom.body.dataset.mode, 'ended');
  assert.equal(reload.ids.install.hidden, true);
});

test('keyboard uses S and Down for slides, requires a fresh press, and keeps Space for jumping', () => {
  const game = browserHarness('landing');
  function stepToWindow() {
    for (let frame = 0; frame < 65 && !game.runner.slideWindowOpen; frame++) game.step(1);
    assert.equal(game.ids.feedback.textContent, 'Power slide now · ↓ / S');
  }
  game.step(1);
  assert.ok(game.draws() > 100);
  game.key('keydown', 'Enter');
  game.key('keyup', 'Enter');
  game.step(1);
  assert.equal(game.dom.body.dataset.mode, 'running');
  assert.equal(game.key('keydown', 'KeyS'), true);
  game.step(2);
  assert.equal(game.ids.feedback.textContent, 'Sliding');
  assert.ok(game.runner.speed < game.runner.baseSpeed);
  game.key('keydown', 'Space');
  stepToWindow();
  game.key('keydown', 'KeyS', true);
  game.key('keydown', 'KeyS');
  game.key('keyup', 'Space');
  game.key('keydown', 'Space');
  game.step(16);
  assert.equal(game.dom.body.dataset.boost, 'false');
  assert.equal(game.runner.airborne, false);
  assert.equal(game.runner.sliding, false);
  game.key('keyup', 'KeyS');
  game.key('keyup', 'Space');
  game.key('keydown', 'Space');
  game.key('keyup', 'Space');
  stepToWindow();
  assert.equal(game.key('keydown', 'ArrowDown'), true);
  assert.equal(game.runner.queuedSlide, true);
  assert.equal(game.speedStrokes(), 0);
  game.step(12);
  assert.equal(game.dom.body.dataset.boost, 'true');
  assert.equal(game.ids.feedback.textContent, 'Power slide');
  assert.equal(game.runner.sliding, true);
  assert.ok(game.speedStrokes() > 0);
  assert.equal(game.dashStrokes(), 0);
  const paceStrokes = game.paceStrokes();
  game.step(4);
  assert.equal(game.paceStrokes(), paceStrokes);
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
  const renderer = Object.assign(Object.create(Scene.prototype), { cameraBack: 10.8, ctx, particles: [] });
  renderer.setViewDistance(MIN_VIEW_DISTANCE);
  const flats = [];
  const boxes = [];
  const faces = [];
  renderer.flat = (left, right, start, end, color) => flats.push({ left, right, start, end, color });
  renderer.box = (...args) => boxes.push(args);
  renderer.face = (points, color) => faces.push({ points, color });
  renderer.line = () => {};

  for (const scenario of ['gap', 'gap-edge']) {
    const run = new Run({ scenario });
    renderer.reset(run.speed);
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
  assert.equal(game.ids.feedback.textContent, 'Slide at touchdown · ↓ / S');
  for (let frame = 0; frame < 100 && !game.runner.slideWindowOpen; frame++) game.step(1);
  assert.equal(game.ids.feedback.textContent, 'Power slide now · ↓ / S');
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
  assert.equal(game.paceStrokes(), 0);
  game.step(9);
  assert.equal(game.ids['dash-status'].textContent, '');
  assert.ok(game.paceStrokes() > 0);
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
  assert.equal(game.paceStrokes(), 0);
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

test('touch swipes fire once per gesture for movement or slides and keep keyboard input', () => {
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
  assert.equal(game.runner.sliding, false);
  game.pointer(field, 'pointerdown', 3, 110, 180);
  game.pointer(field, 'pointermove', 3, 113, 225);
  game.pointer(field, 'pointermove', 3, 108, 125);
  game.pointer(field, 'pointerup', 3, 108, 125);
  assert.equal(game.runner.lane, 3);
  assert.equal(game.runner.airborne, false);
  assert.equal(game.runner.sliding, true);
  game.step(2);
  assert.equal(game.ids.feedback.textContent, 'Sliding');
  assert.ok(game.runner.speed < game.runner.baseSpeed);

  game.pointer(field, 'pointerdown', 4, 110, 180);
  game.pointer(field, 'pointermove', 4, 70, 176);
  game.pointer(field, 'pointerup', 4, 70, 176);
  assert.equal(game.runner.lane, 2);
  game.key('keydown', 'ArrowLeft');
  assert.equal(game.runner.lane, 1);
  assert.equal(game.ids['touch-controls'].hidden, false);
});

test('only a fresh downward swipe in the landing window earns a touch power slide', () => {
  const game = browserHarness('landing', { touch: true });
  const field = 'swipe-field';
  function swipe(id, deltaY) {
    game.pointer(field, 'pointerdown', id, 110, 210);
    game.pointer(field, 'pointermove', id, 110, 210 + deltaY);
  }
  function stepToWindow() {
    for (let frame = 0; frame < 65 && !game.runner.slideWindowOpen; frame++) game.step(1);
    assert.equal(game.ids.feedback.textContent, 'Power slide now · Swipe down');
  }
  game.ids.start.events.click();
  game.step(1);
  swipe(1, -26);
  assert.equal(game.runner.airborne, true);
  stepToWindow();
  game.pointer(field, 'pointermove', 1, 110, 250);
  assert.equal(game.runner.queuedSlide, false);
  game.pointer(field, 'pointerup', 1, 110, 250);
  swipe(2, -26);
  game.pointer(field, 'pointerup', 2, 110, 184);
  game.step(16);
  assert.equal(game.runner.boosting, false);

  swipe(3, -26);
  game.pointer(field, 'pointerup', 3, 110, 184);
  swipe(4, 26);
  stepToWindow();
  game.pointer(field, 'pointermove', 4, 110, 275);
  assert.equal(game.runner.queuedSlide, false);
  game.pointer(field, 'pointerup', 4, 110, 275);
  swipe(5, 26);
  assert.equal(game.runner.queuedSlide, true);
  game.step(12);
  assert.equal(game.runner.boosting, true);
  assert.equal(game.ids.feedback.textContent, 'Power slide');
  const boostEnd = game.runner.boostUntil;
  game.pointer(field, 'pointermove', 5, 110, 285);
  assert.equal(game.runner.boostUntil, boostEnd);
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
  while (game.runner.distance < 39) game.step(1);
  game.pointer(field, 'pointermove', 1, 110, 208);
  assert.equal(game.runner.sliding, true);
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
  assert.equal(game.runner.sliding, false);
  assert.equal(game.runner.boosting, false);
  assert.equal(game.runner.slideWindowOpen, false);
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

test('actual acceleration, dash, and power slide move the FOV smoothly and within bounds', () => {
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
  const at65 = advance(9.5);
  const settledAt = (speed) => baseline * (0.68 + 0.32 * 36 / (36 + speed - START_SPEED));
  assert.ok(midway / baseline > 0.89 && midway / baseline < 0.92);
  assert.ok(run.speed > 65);
  assert.ok(Math.abs(at65 - settledAt(run.speed)) < baseline * 0.002);

  run.dash();
  const firstDashFrame = advance(STEP);
  const dash = advance(0.2);
  assert.ok(at65 - firstDashFrame < baseline * 0.01);
  assert.ok(dash < at65 - baseline * 0.025);
  const afterDash = advance(1.6);
  assert.ok(Math.abs(afterDash - settledAt(run.speed)) < baseline * 0.004);

  run.jump();
  while (!run.slideWindowOpen) advance(STEP);
  run.slide();
  while (!run.boosting) advance(STEP);
  const boost = advance(0.24);
  assert.ok(boost < settledAt(run.baseSpeed) - baseline * 0.02);
  run.dash();
  const both = advance(0.22);
  assert.ok(both < boost - baseline * 0.01);
  const afterBoth = advance(1.6);
  assert.ok(Math.abs(afterBoth - settledAt(run.speed)) < baseline * 0.005);
  const focalAt = (speed) => {
    view.updateSpeed({ speed, baseSpeed: speed }, 10, 'running');
    return focal();
  };
  const at101 = focalAt(101);
  const at140 = focalAt(140);
  const at572 = focalAt(572);
  assert.ok(at140 < at101 - baseline * 0.02);
  assert.ok(at572 < at140 - baseline * 0.05);
  assert.ok(at572 / baseline > 0.68);
  assert.ok(Math.abs(focalAt(1_000_000) / baseline - 0.68) < 0.0001);
});

test('world-anchored rail reflectors move outward from the first steps and strengthen with pace', () => {
  const game = browserHarness('landing');
  game.step(1);
  const view = game.scene;
  view.openingBlend = 0;
  const sample = (run, cuts = []) => {
    view.frameCamera(run);
    const mounts = [];
    const trails = [];
    const { box, face } = view;
    view.box = (x, y, z, _width, _height, depth) => {
      mounts.push({ x, z, depth, opacity: view.ctx.globalAlpha, screenX: view.screenPoint(view.viewPoint([x, y, z]))[0] });
    };
    view.face = (points) => trails.push(points);
    try {
      view.railReflectors(run, cuts, run.distance - view.rearViewDistance, run.distance + view.viewDistance);
    } finally {
      Object.assign(view, { box, face });
    }
    return { mounts, trails };
  };

  const run = new Run({ scenario: 'landing' });
  view.reset(run.speed);
  const start = sample(run);
  const startScale = view.longitudinalScale;
  const atWorldAnchor = (mounts, anchor) => mounts.find(({ x, z }) => x > 0 && Math.abs(z + run.distance - anchor) < 1e-8);
  const atStart = atWorldAnchor(start.mounts, 10);
  assert.ok(atStart);
  for (let tick = 0; tick < 12; tick++) run.tick();
  const next = atWorldAnchor(sample(run).mounts, 10);
  assert.ok(next.z < atStart.z && next.screenX > atStart.screenX);

  const fast = new Run({ scenario: 'landing', pace: 'fast' });
  view.reset(fast.speed);
  const fastSamples = sample(fast);
  const longestTrail = ({ trails }, scale) => Math.max(...trails.map(([start, _side, end]) => (end[2] - start[2]) * scale));
  assert.ok(longestTrail(fastSamples, view.longitudinalScale) > longestTrail(start, startScale) * 1.5);

  const blocked = sample(run, [{ lane: 0, z: 9, end: 11 }]);
  assert.ok(atWorldAnchor(blocked.mounts, 10));
  assert.ok(!blocked.mounts.some(({ x, z }) => x < 0 && Math.abs(z + run.distance - 10) < 1e-8));
  assert.ok(blocked.trails.filter(([point]) => point[0] < 0).every(([start, _other, end]) =>
    end[2] + run.distance <= 9 || start[2] + run.distance >= 11));

  for (const speed of [109.99, 110, 572, 1500, 10_000]) {
    run.distance = 89_600;
    run.baseSpeed = run.speed = speed;
    view.reset(speed);
    const { mounts } = sample(run);
    assert.ok(mounts.length >= 4 && mounts.length <= 50, `${speed} m/s draws ${mounts.length} mounts`);
    assert.equal(atWorldAnchor(mounts, 89_600).opacity, 1);
    if (speed < 110) assert.ok(atWorldAnchor(mounts, 89_610).opacity < 0.001);
    if (speed === 110) assert.equal(atWorldAnchor(mounts, 89_610), undefined);
  }
});

test('running cadence and rail streaks respond to braking and recover consistently across frame rates', () => {
  const game = browserHarness('landing');
  game.step(1);
  const view = game.scene;
  for (const speed of [START_SPEED, FAST_START_SPEED, 572]) {
    const run = new Run({ scenario: 'landing' });
    run.baseSpeed = run.speed = speed;
    view.reset(speed);
    const pace = view.pace;
    run.slide();
    run.tick();
    view.updateSpeed(run, 0.10, 'running');
    assert.ok(view.pace > pace * 0.65 && view.pace < pace * 0.72);

    run.jump();
    run.tick();
    for (let i = 0; i < 5; i++) view.updateSpeed(run, 0.1, 'running');
    assert.ok(Math.abs(view.pace - pace) < 0.004);
  }

  const sample = (frames) => {
    view.reset(START_SPEED);
    for (let i = 0; i < frames; i++) view.updateSpeed({ speed: FAST_START_SPEED }, 0.72 / frames, 'running');
    return [view.pace, view.stridePhase];
  };
  const slowFrames = sample(15);
  assert.ok(sample(43).every((value, i) => Math.abs(value - slowFrames[i]) < 1e-12));
});

test('ordinary pace streaks build in the outer safe gutters without replacing the special effects', () => {
  const game = browserHarness('landing');
  game.step(1);
  assert.equal(game.paceStrokes(), 0);
  game.click('start');
  game.step(2);
  assert.ok(game.paceStrokes() > 0);
  assert.equal(game.speedStrokes(), 0);
  assert.equal(game.dashStrokes(), 0);
  const view = game.scene;
  const run = new Run({ scenario: 'landing' });
  for (const [width, height, safe] of [[390, 685, {}], [667, 280, { left: 44, right: 18 }], [1440, 900, {}]]) {
    game.resize(width, height, safe);
    const points = [];
    let start;
    let end;
    const { ctx } = view;
    const { moveTo, lineTo, stroke } = ctx;
    ctx.moveTo = (x, y) => { start = [x, y]; };
    ctx.lineTo = (x, y) => { end = [x, y]; };
    ctx.stroke = () => {
      if (ctx.strokeStyle === '#c9a3f4') points.push({ x1: start[0], x2: end[0], alpha: ctx.globalAlpha });
    };
    const sample = (speed) => {
      points.length = 0;
      run.speed = run.baseSpeed = speed;
      view.reset(speed);
      view.draw(run, 1, 0, 'running');
      const left = safe.left ?? 0;
      const right = width - (safe.right ?? 0);
      const gutter = (right - left) * 0.16;
      assert.ok(points.length > 0 && points.length <= 16);
      assert.ok(points.every(({ x1, x2 }) =>
        (x2 >= left && x2 <= x1 && x1 <= left + gutter) || (x1 >= right - gutter && x1 <= x2 && x2 <= right)));
      return [Math.max(...points.map(({ x1, x2 }) => Math.abs(x1 - x2))), Math.max(...points.map(({ alpha }) => alpha))];
    };
    try {
      const startPace = sample(32);
      const fastPace = sample(64);
      const highPace = sample(572);
      assert.ok(fastPace.every((value, index) => value > startPace[index] * 1.3));
      assert.ok(highPace.every((value, index) => value > fastPace[index] * 1.6));
    } finally {
      Object.assign(ctx, { moveTo, lineTo, stroke });
    }
  }
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
    for (const speed of [32, 64, 101, 572, 100_000]) {
      runner.baseSpeed = runner.speed = speed;
      scene.updateSpeed(runner, 10, 'running');
      scene.frameCamera(runner);
      const xs = [-6.45, -5, -2.5, 0, 2.5, 5, 6.45].map((x) => scene.screenPoint(scene.viewPoint([x, 0, -1]))[0]);
      assert.ok(xs[0] >= (safe.left ?? 0) && xs.at(-1) <= width - (safe.right ?? 0));
      assert.ok(xs[2] - xs[1] >= 40, 'Outer lanes remain readable at the widest setting');
    }
    assert.ok(Math.abs(scene.focal / resting - (compact ? 0.744 : 0.68)) < 0.001);
  }

  runner.distance = 1179;
  runner.x = 0;
  runner.baseSpeed = 572;
  game.step(5);
  assert.equal(game.dom.body.dataset.mode, 'ended');
  game.ids.restart.events.click();
  game.step(1);
  assert.equal(game.runner.speed, START_SPEED);
  assert.equal(scene.widening, 0);
  assert.equal(scene.stridePhase, 0);
  assert.equal(scene.boostRush, 0);

  const reduced = browserHarness('camera', { reducedMotion: true, pace: 'fast' });
  reduced.ids.start.events.click();
  reduced.step(1);
  const resting = reduced.scene.focal;
  let railFrames = 0;
  reduced.scene.railReflectors = () => { railFrames++; };
  reduced.key('keydown', 'KeyW');
  reduced.step(18);
  assert.ok(reduced.runner.speed > FAST_START_SPEED + 7);
  assert.equal(reduced.scene.focal, resting);
  assert.equal(railFrames, 0);
  assert.equal(reduced.scene.stridePhase, 0);
  reduced.changeReducedMotion(false);
  reduced.step(8);
  assert.ok(reduced.scene.focal < resting);
  assert.equal(railFrames, 8);
  reduced.changeReducedMotion(true);
  reduced.step(1);
  assert.equal(reduced.scene.focal, resting);
  assert.equal(railFrames, 8);
  assert.equal(reduced.scene.pace, 0);
  assert.equal(reduced.scene.stridePhase, 0);
});

test('rendering keeps a readable reaction horizon, exact cut lip, and bounded work at high speed', () => {
  const game = browserHarness('landing');
  game.step(1);
  const view = game.scene;
  const inputs = [
    [320, 568, { top: 45, bottom: 25 }], [667, 280, { left: 44, bottom: 21 }], [1440, 900, {}],
  ];
  const observed = {};
  for (const name of ['hurdle', 'cutLip', 'trackTile', 'spikes', 'face']) {
    const original = view[name];
    view[name] = function (...args) {
      if (name === 'hurdle' || name === 'cutLip') observed[name].push(args[1]);
      else observed[name]++;
      return original.apply(this, args);
    };
  }

  for (const [width, height, safe] of inputs) {
    game.resize(width, height, safe);
    for (const speed of [32, 140, 572, 1500, 10_000]) {
      const run = new Run({ scenario: 'landing' });
      run.distance = 90_000;
      run.baseSpeed = run.speed = speed;
      const reaction = (speed + MAX_EXTRA_SPEED) * REACTION_TIME + 1;
      const far = run.viewDistance * 0.80;
      const gapStart = run.distance - speed * 2;
      const gapEnd = run.addClosure(gapStart, 2, run.distance + reaction - gapStart);
      run.addSpikes(run.distance + speed * 0.35, 0, 2, 1);
      run.addObstacle(run.distance + reaction, 1, 'hurdle');
      run.addObstacle(run.distance + far, 1, 'hurdle');
      const gap = run.obstacles.find((obstacle) => obstacle.type === 'gap');
      const realReaction = gapEnd - run.distance;
      assert.equal(gap.end, gapEnd);
      view.reset(speed);
      view.openingBlend = 0;
      Object.assign(observed, { hurdle: [], cutLip: [], trackTile: 0, spikes: 0, face: 0 });
      view.draw(run, 1, 1 / 60, 'running');

      assert.ok(observed.hurdle.some((z) => Math.abs(z - far) < 1e-7));
      assert.ok(observed.hurdle.includes(realReaction));
      assert.deepEqual(observed.cutLip, [realReaction]);
      assert.equal(observed.spikes, 1);
      assert.ok(observed.trackTile <= 45);
      assert.ok(observed.face <= 1300);
      assert.equal(view.projectedDepth(0), 0);
      assert.ok(view.projectedDepth(realReaction) < view.projectedDepth(far));

      const project = (point) => view.screenPoint(view.viewPoint(point));
      const x = laneX(1);
      const [, bottom] = project([x, 0, realReaction - 0.25]);
      const [, top] = project([x, 0.71, realReaction - 0.25]);
      const [left] = project([x - 0.96, 0.5, realReaction - 0.25]);
      const [right] = project([x + 0.96, 0.5, realReaction - 0.25]);
      if (speed >= 140) {
        assert.ok(bottom - top >= 2.6, `${width}x${height} ${speed} m/s hurdle is ${bottom - top}px tall`);
        assert.ok(right - left >= 8, `${width}x${height} ${speed} m/s hurdle is ${right - left}px wide`);
      }
    }
  }
});

test('equal display-frame advances grow through the high-speed approach to contact', () => {
  const page = browserHarness('high-speed');
  page.resize(1280, 720, {});
  page.step(1);
  const { scene, runner } = page;
  assert.equal(runner.speed, 572);
  scene.openingBlend = 0;
  scene.frameCamera(runner);
  const foot = (seconds) => scene.screenPoint(scene.viewPoint([0, 0, runner.speed * seconds]))[1];
  const advances = [0.5, 0.2, 0.12, 0.05].map((seconds) => foot(seconds - 1 / 60) - foot(seconds));
  assert.ok(advances.every((advance, index) => index === 0 || advance > advances[index - 1]),
    `1/60 s screen advances at .5, .2, .12, .05 s to contact: ${advances.map((pixels) => pixels.toFixed(2)).join(', ')} px`);
});

test('fixed longitudinal gaps use one scale across the runner, boosts, and deck detail transitions', () => {
  const page = browserHarness('high-speed');
  page.step(1);
  const { scene, runner } = page;
  const points = [-210, -140, -70, 0, 70, 140, 210];
  const depths = () => points.map((z) => scene.viewPoint([0, 0, z])[2]);
  const initial = depths();
  const spacing = initial[1] - initial[0];
  assert.ok(initial.slice(1).every((z, index) => Math.abs(z - initial[index] - spacing) < 1e-9));
  for (const extra of [15, 22, 37]) {
    runner.speed = runner.baseSpeed + extra;
    scene.updateSpeed(runner, 1 / 60, 'running');
    scene.frameCamera(runner);
    assert.deepEqual(depths(), initial);
  }

  const layers = new Map();
  scene.trackTile = () => {};
  scene.trackMarks = (_distance, _gaps, _start, _end, stride, opacity) => layers.set(stride, opacity);
  const sample = (distance) => {
    scene.setViewDistance(distance);
    layers.clear();
    scene.track({ distance: 0, baseSpeed: START_SPEED, lane: 2, obstacles: [] }, false);
    return new Map(layers);
  };
  // Find the two sides of one grid step, so the test does not depend on its absolute distance.
  let lower = 190;
  let upper = 2000;
  const initialStride = sample(lower).keys().next().value;
  while (upper - lower > 1e-4) {
    const middle = (lower + upper) / 2;
    if (sample(middle).keys().next().value === initialStride) lower = middle;
    else upper = middle;
  }
  const before = sample(lower);
  const depthBefore = scene.projectedDepth(70);
  const after = sample(upper);
  assert.ok(before.get(initialStride * 2) > 0.999);
  assert.ok(after.get(initialStride * 2) > 0.999);
  assert.ok(Math.abs(scene.projectedDepth(70) - depthBefore) < 0.001);
});

test('the rear view retains the floor, closure lip, passed hurdles and spike tiles with bounded work', () => {
  const page = browserHarness('high-speed');
  page.resize(1280, 720, {});
  page.step(1);
  const { scene } = page;
  const drawn = { flats: [], hurdles: [], lips: [], tiles: [] };
  for (const [name, field] of [['flat', 'flats'], ['hurdle', 'hurdles'], ['cutLip', 'lips'], ['trackTile', 'tiles']]) {
    const original = scene[name];
    scene[name] = function (...args) {
      drawn[field].push(args);
      return original.apply(this, args);
    };
  }
  for (const speed of [572, 1500, 10_000]) {
    Object.values(drawn).forEach((calls) => { calls.length = 0; });
    const run = new Run({ scenario: 'landing' });
    run.baseSpeed = run.speed = speed;
    run.distance = 90_000;
    scene.reset(speed);
    scene.openingBlend = 0;
    scene.frameCamera(run);
    const rear = scene.rearViewDistance;
    const closureEnd = run.distance - rear * 0.16;
    const spikeEnd = run.distance - rear * 0.11;
    const old = run.distance - run.viewDistance * 0.2;
    run.addObstacle(old, 4, 'hurdle');
    run.addClosure(run.distance - rear * 1.1, 2, closureEnd - (run.distance - rear * 1.1));
    run.addObstacle(run.distance - rear * 0.65, 1, 'spikes', {
      end: spikeEnd, tiles: 2, tileLength: rear * 0.27, lanes: 1,
    });
    const justPassed = run.distance - rear * 0.22;
    run.addObstacle(justPassed, 3, 'hurdle');
    run.tick();
    assert.ok(run.obstacles.find((obstacle) => obstacle.z === justPassed));
    scene.draw(run, 1, 1 / 60, 'running');

    const backStart = Math.min(...drawn.tiles.map(([, , , start]) => start));
    assert.ok(Math.abs(backStart - (run.distance - scene.rearViewDistance)) < 1e-7);
    assert.ok(drawn.tiles.length <= 38);
    assert.ok(drawn.flats.length <= 850);
    assert.deepEqual(drawn.lips.map(([, z]) => z), [closureEnd - run.distance]);
    assert.deepEqual(drawn.hurdles.map(([, z]) => z), [justPassed - run.distance]);
    assert.ok(drawn.flats.some(([, , near, far, color]) => color === '#6d223b' && near < far && far < 0));

    const occupied = (x, z) => drawn.flats.some(([left, right, near, far, , y]) =>
      (y === undefined || y === 0) && left < x && x < right && near < z && z < far);
    const beforeLip = closureEnd - run.distance - rear * 0.07;
    const afterLip = closureEnd - run.distance + rear * 0.07;
    assert.equal(occupied(0, beforeLip), false);
    assert.equal(occupied(laneX(1), beforeLip), true);
    assert.equal(occupied(0, afterLip), true);

    const project = (z) => scene.screenPoint(scene.viewPoint([0, 0, z]))[1];
    assert.ok(project(justPassed - run.distance) > project(0));
    assert.ok(project(justPassed - run.distance) < scene.height);
  }
});

test('a delayed browser frame still sweeps a hurdle the runner reaches late in that frame', () => {
  const game = browserHarness('landing');
  game.ids.start.events.click();
  game.step(1);
  game.runner.speed = game.runner.baseSpeed = 572;
  game.runner.addObstacle(74, 2, 'hurdle');
  game.delayFrame(150);
  game.step(1);
  assert.equal(game.dom.body.dataset.mode, 'ended');
  assert.equal(game.runner.crash.type, 'hurdle');
  assert.ok(game.runner.distance > 73 && game.runner.distance < 74);
});
