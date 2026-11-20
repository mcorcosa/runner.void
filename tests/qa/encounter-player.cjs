const assert = require('node:assert/strict');
const { resolve } = require('node:path');

const LANES = [0, 1, 2, 3, 4];
const STEPS = { left: -1, right: 1 };

function observeCourse(root = resolve(__dirname, '../..')) {
  const encounters = require(resolve(root, 'encounters.js'));
  const runner = require(resolve(root, 'game.js'));
  const courses = new WeakMap();
  for (const method of ['placeEncounter', 'placePracticeEncounter']) {
    const place = encounters[method];
    encounters[method] = function (run, ...args) {
      const firstId = run.id;
      const entry = [...run.openLanes];
      const previousEnd = Math.max(0, ...run.obstacles.map(({ z, end = z }) => end));
      if (!place(run, ...args)) return false;
      const obstacles = run.obstacles.filter(({ id }) => id >= firstId);
      assert.ok(obstacles.every(({ z }, index) => !index || z >= obstacles[index - 1].z));
      assert.equal(run.lastHazardEnd, Math.max(...obstacles.map(({ z, end = z }) => end)));
      if (method === 'placeEncounter') {
        assert.ok(obstacles[0].z - previousEnd >= run.rowClearance(previousEnd));
        assert.ok(obstacles[0].z - 0.68 >= run.distance + run.viewDistance, 'A new section begins beyond the warning horizon');
        assert.ok(entry.length > 0);
      }
      if (!courses.has(run)) courses.set(run, new Map());
      const batches = courses.get(run);
      const exit = [...run.openLanes];
      if (method === 'placePracticeEncounter' && args[0] === 'challenge') {
        const sweep = obstacles.find((item) => item.type === 'movingBarrier');
        const gates = obstacles.filter((item) => item.type === 'slideGate' && item.z > sweep.z);
        const crossAt = gates.find((item) => item.z > gates[0].z).z;
        const pullAt = obstacles.find((item) => item.type === 'hurdle' && item.z > crossAt).z;
        record(obstacles.filter(({ z }) => z < crossAt), entry, [gates[0].lane]);
        record(obstacles.filter(({ z }) => z >= crossAt && z < pullAt), [gates[0].lane], LANES);
        record(obstacles.filter(({ z }) => z >= pullAt), LANES, exit);
      } else record(obstacles, entry, exit);

      function record(items, entry, exit) {
        const end = Math.max(...items.map(({ z, end = z }) => end));
        batches.set(items[0].id, { obstacles: items, entry, exit, end });
      }
      return true;
    };
  }
  function direct(options) {
    const events = [];
    const run = new runner.Run({ ...options, onEvent: (name, detail) => events.push({ name, detail }) });
    return { run, events, step: () => run.tick(), input: (action) => send(run, action) };
  }
  return { courses, runner, direct };
}

function send(run, action) {
  if (Object.hasOwn(STEPS, action)) run.move(STEPS[action]);
  else run[action]();
}

function available(obstacles) {
  return LANES.filter((lane) => obstacles.every((item) =>
    lane < item.lane || lane >= item.lane + (item.lanes ?? 1)));
}

function play({ run, step, input }, courses, duration, options = {}) {
  let lastId = -1;
  let context = 'opening';
  let previousEndAt;
  let fastAt;
  let closures = 0;
  const passed = [];
  const actionLog = [];
  function tick() {
    step();
    if (fastAt === undefined && run.baseSpeed >= 572) fastAt = run.time;
    assert.equal(run.crash, null,
      `${context}, ${run.time.toFixed(3)}s, lane ${run.lane} at ${run.distance.toFixed(1)}: ${JSON.stringify(run.crash)}`);
  }

  function through(z) {
    while (run.distance <= z + 1) tick();
  }

  function pause(seconds) {
    const until = run.time + seconds;
    while (run.time < until) tick();
  }

  function act(action) {
    actionLog.push({ action, time: run.time });
    input(action);
  }

  function steer(lane) {
    assert.ok(LANES.includes(lane), `${context} has no steer destination`);
    while (run.lane !== lane) {
      act(lane < run.lane ? 'left' : 'right');
      pause(0.17);
    }
  }

  function approach(z, seconds) {
    while (z - run.distance > run.speed * seconds) tick();
  }

  function jump(z, tag) {
    approach(z, 0.25);
    assert.ok(!run.airborne, `${context} leaves time to land before the next jump`);
    if (options.omit !== tag) act('jump');
  }

  function lateBankAttempt(tag) {
    return context === 'duck-cross-duck' && tag === 'last-slide' && run.baseSpeed >= 572 && options.bankAttempt;
  }

  function slide(gate, tag) {
    if (lateBankAttempt(tag)) {
      const jump = options.bankAttempt === 'jump';
      approach(gate.z, jump ? 0.43 : 0.16);
      assert.ok(!run.airborne);
      act(jump ? 'jump' : run.lane < 2 ? 'right' : 'left');
      through(gate.end);
      return;
    }
    approach(gate.z, 0.16);
    assert.ok(!run.airborne && !run.sliding, `${context} has footing and a fresh slide at ${gate.z}`);
    if (options.omit === 'jump-over-gate' && context === 'duck-cross-duck' && tag === 'last-slide') act('jump');
    else if (options.omit !== tag) act('slide');
    through(gate.end);
  }

  function powerLand() {
    while (run.airborne && !run.slideWindowOpen) tick();
    act('slide');
    while (run.airborne) tick();
    assert.ok(run.boosting);
  }

  function lateral(gap, batch) {
    const dividers = batch.obstacles.filter((item) =>
      item.type === 'gap' && item.z < gap.z);
    assert.deepEqual(available(dividers), [gap.lane]);
    assert.equal(Math.abs(gap.lane - gap.lateralExit), 2);
    assert.ok(dividers.some((item) => item.lane === 2 && item.end === gap.end));
    steer(gap.lane);
    jump(gap.z, 'lateral-jump');
    pause(0.14);
    steer(gap.lateralExit);
    if (options.omit !== 'lateral-jump') assert.ok(run.airborne, 'Both deliberate lateral inputs fit inside a jump');
    if (options.boostCrossing && run.baseSpeed >= 572) powerLand();
    if (!(lateBankAttempt('last-slide') && options.bankAttempt === 'jump')) through(gap.end);
  }

  function playBatch(batch) {
    const { obstacles, entry, exit, end } = batch;
    const z = obstacles[0].z;
    const row = obstacles.filter((item) => item.z === z);
    const firstGate = row.find((item) => item.type === 'slideGate');
    const hurdle = obstacles.find((item) => item.type === 'hurdle');
    const platform = obstacles.find((item) => item.type === 'platform');
    const sweep = obstacles.find((item) => item.type === 'movingBarrier');
    const pull = obstacles.find((item) => item.type === 'blackHole');
    const cross = obstacles.find((item) => item.lateralExit !== undefined);
    const finishRow = obstacles.findLast((item) => item.type === 'slideGate' && item.z !== z)?.z;
    const finishGates = obstacles.filter((item) => item.type === 'slideGate' && item.z === finishRow);
    const finish = finishGates.find((item) => item.lane === cross?.lateralExit) ?? finishGates[0];
    const gaps = obstacles.filter((item) => item.type === 'gap');
    const lane = (hurdle?.z === z ? hurdle.lane : firstGate?.lane) ?? row.find((item) => item.type === 'platform')?.lane ??
      available(row)[0];
    const entryLane = run.lane;
    const chargeAtStart = run.dashCharge;
    assert.ok(entry.includes(entryLane) || run.scripted, 'The previous row stays playable');
    const start = run.time + 2 * (z - run.distance) / (run.baseSpeed + run.upperBaseAt(z));
    const speed = run.upperBaseAt(z);
    const seam = previousEndAt === undefined ? null : start - previousEndAt;
    let sweepRoute;
    let boostedGate = false;

    if (cross) {
      context = firstGate ? 'duck-cross-duck' : 'lateral';
      steer(cross.lane);
      if (firstGate) slide(firstGate, 'first-slide');
      lateral(cross, batch);
    } else if (firstGate && hurdle && hurdle.z === z) {
      context = 'fork-funnel';
      const preferGate = options.forkGate ?? Math.abs(firstGate.lane - entryLane) < Math.abs(hurdle.lane - entryLane);
      if (preferGate) {
        steer(firstGate.lane);
        slide(firstGate, 'first-slide');
      } else {
        steer(hurdle.lane);
        jump(z, 'first-jump');
        through(z);
      }
      steer(finish.lane);
    } else if (firstGate && hurdle) {
      context = 'duck-vault';
      steer(firstGate.lane);
      slide(firstGate, 'first-slide');
      steer(hurdle.lane);
      jump(hurdle.z, 'last-jump');
      through(hurdle.z);
    } else if (sweep && hurdle) {
      context = 'vault-sweep-duck';
      steer(hurdle.lane);
      jump(z, 'first-jump');
      through(z);
      const refuge = obstacles.find((item) => item.type === 'slideGate' && item.z === sweep.z);
      if (options.dashSweep && run.dashCharge === 1) {
        approach(sweep.z, 0.36);
        const arrival = run.time + (sweep.z - run.distance) / (run.speed + 11);
        const middle = options.movingBarrierX(sweep, arrival);
        const target = [sweep.lane, sweep.toLane].sort((a, b) =>
          Math.abs(options.laneX(a) - middle) - Math.abs(options.laneX(b) - middle))[0];
        steer(target);
        act('dash');
        through(refuge.end);
        assert.ok(run.dashSpent, 'Dash can break the sweep instead of dodging it');
        sweepRoute = 'dash';
      } else {
        approach(sweep.z, 0.58);
        const arrival = run.time + (sweep.z - run.distance) / (run.speed + 0.5);
        const middle = options.movingBarrierX(sweep, arrival);
        const clear = [sweep.lane, sweep.toLane].find((candidate) =>
          Math.abs(options.laneX(candidate) - middle) > 1.46);
        if (clear === undefined || options.sweepRefuge) {
          steer(refuge.lane);
          slide(refuge, 'refuge-slide');
          sweepRoute = 'refuge';
        } else {
          steer(clear);
          through(refuge.end);
          sweepRoute = clear;
        }
      }
    } else if (pull) {
      context = finish ? 'pull-and-slide' : 'pull';
      steer(pull.lane);
      if (hurdle) {
        jump(z, 'first-jump');
        through(z);
      }
      through(pull.z);
      assert.ok(pull.triggered);
      assert.equal(run.lane, pull.lane + pull.direction);
      if (finish && options.omit !== 'correction') steer(finish.lane);
      if (finish && options.omit === 'correction') through(finish.end);
    } else if (platform) {
      context = finish ? 'platform-and-slide' : 'platform';
      steer(platform.lane);
      jump(z, 'first-jump');
      through(z + (platform.end - z) * 0.76);
      assert.equal(run.height, platform.height, 'The runner reaches the raised deck');
      through(platform.end);
    } else if (hurdle && finish) {
      context = 'jump-and-slide';
      steer(hurdle.lane);
      jump(z, 'first-jump');
      through(z);
      if (options.boost && options.omit !== 'first-jump') powerLand();
    } else if (firstGate) {
      context = 'slide';
      steer(firstGate.lane);
      slide(firstGate, 'first-slide');
    } else if (sweep) {
      context = 'moving';
      steer(sweep.toLane);
      through(z);
      steer(2);
    } else if (gaps.length) {
      context = 'funnel';
      steer(2);
      through(z);
      steer(available(gaps)[0]);
    } else {
      context = 'slalom';
      for (const position of new Set(obstacles.map((item) => item.z))) {
        steer(available(obstacles.filter((item) => item.z === position))[0]);
        through(position);
      }
    }

    if (finish) {
      steer(finish.lane);
      if (!lateBankAttempt('last-slide')) approach(finish.z, 0.16);
      boostedGate = run.boosting;
      slide(finish, 'last-slide');
    }
    through(end);
    assert.ok(exit.includes(run.lane), `${context} leaves a valid next entrance`);
    const committed = ['jump-and-slide', 'duck-vault', 'platform-and-slide', 'pull-and-slide',
      'vault-sweep-duck', 'lateral', 'duck-cross-duck', 'fork-funnel'].includes(context);
    passed.push({ name: context, start, seam, speed, lane, entryLane, chargeAtStart, committed, sweepRoute, boostedGate });
    previousEndAt = run.time;
  }

  while (run.time < duration) {
    const next = run.obstacles.find(({ id }) => id > lastId);
    if (!next) {
      tick();
      continue;
    }
    const endingGap = run.obstacles.find((item) => item.type === 'gap' &&
      item.z <= run.distance && item.end > run.distance && item.end <= next.z);
    if (endingGap) {
      through(endingGap.end);
      continue;
    }
    const batch = courses.get(run)?.get(next.id);
    if (batch) {
      playBatch(batch);
      lastId = batch.obstacles.at(-1).id;
      continue;
    }
    context = 'ordinary row';
    const row = run.obstacles.filter((item) => item.z === next.z);
    const spanning = run.obstacles.filter((item) => item.type === 'gap' && item.z < next.z && item.end > next.z);
    const open = available([...row, ...spanning]);
    const lane = [run.lane, run.lane - 1, run.lane + 1].find((candidate) => open.includes(candidate));
    assert.ok(lane !== undefined, `No ordinary exit at ${next.z} from lane ${run.lane}`);
    steer(lane);
    through(Math.max(...row.map((item) => item.type === 'spikes' || item.short ? item.end : item.z)));
    closures += row.filter((item) => item.type === 'gap' && !item.short).length;
    lastId = row.at(-1).id;
  }
  return { passed, fastAt, closures, actionLog, time: run.time };
}

module.exports = { observeCourse, play };
