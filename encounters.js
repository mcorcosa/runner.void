(function () {
  'use strict';

  const LANES = [0, 1, 2, 3, 4];
  const PLATFORM_HEIGHT = 1.05;
  const TIER_TIMES = [0, 8, 24, 43, 65];
  const turns = [[1, -1], [1, 1], [2, -1], [2, 1], [3, -1], [3, 1]];
  const inward = [[1, 1], [3, -1]];
  const histories = new WeakMap();

  function later(run, z, seconds) {
    return z + run.distanceIn(z, seconds);
  }

  function wall(run, z, open) {
    for (const lane of LANES) {
      if (!open.includes(lane)) run.addObstacle(z, lane, 'barrier');
    }
  }

  function gate(run, z, ...lanes) {
    const end = z + Math.ceil(run.upperBaseAt(z) * 0.11);
    for (const lane of lanes) run.addObstacle(z, lane, 'slideGate', { end });
    return end;
  }

  function duck(run, z, lane) {
    wall(run, z, [lane]);
    return gate(run, z, lane);
  }

  function vault(run, z, lane) {
    wall(run, z, [lane]);
    run.addObstacle(z, lane, 'hurdle');
  }

  function jumpAndSlide(run, z) {
    vault(run, z, 1);
    const slide = later(run, z, 1.23);
    return [duck(run, slide, 1), [1]];
  }

  function lateralCrossing(run, divide, launch, landing, reopenAfter, lipAfter) {
    const lip = later(run, divide, lipAfter);
    const end = later(run, lip, 1.05);
    for (const lane of [0, 2, 4]) run.addClosure(divide, lane, end - divide);
    // Returning the receiving deck just before the lip gives the airborne runner somewhere to land.
    const receivingDeck = later(run, divide, reopenAfter);
    run.addClosure(divide, landing, receivingDeck - divide);
    run.addObstacle(lip, launch, 'gap', { end, lateralExit: landing });
    return end;
  }

  function laneJump(run, z) {
    wall(run, z, [1]);
    const divide = later(run, z, 1.06);
    return [lateralCrossing(run, divide, 1, 3, 0.99, 1.42), [3]];
  }

  function vaultToDuck(run, z, lane, turn, variation) {
    vault(run, z, lane);
    const exit = lane + turn;
    // Include touchdown and a new swipe after the runner clears the hurdle.
    return [duck(run, later(run, z, 1.06 + variation), exit), [exit]];
  }

  function duckToVault(run, z, lane, turn, variation) {
    const exit = lane + turn;
    const jump = later(run, duck(run, z, lane), 0.78 + variation);
    vault(run, jump, exit);
    return [jump, [exit]];
  }

  function raisedToDuck(run, z, lane, turn, variation) {
    wall(run, z, [lane]);
    const deck = later(run, z, 0.96);
    run.addObstacle(z, lane, 'platform', { end: deck, height: PLATFORM_HEIGHT });
    const exit = lane + turn;
    // Take the next lane after the deck drops so the slide fits below the gate.
    return [duck(run, later(run, deck, 0.78 + variation), exit), [exit]];
  }

  function sweepToDuck(run, z, lane, turn, variation) {
    vault(run, z, lane);
    const crossing = later(run, z, 1.10 + variation);
    const outer = lane - turn;
    const refuge = lane + turn;
    wall(run, crossing, [outer, lane, refuge]);
    run.addObstacle(crossing, outer, 'movingBarrier', { toLane: lane });
    // Read the sweep or take a timed slide along its inside edge.
    const last = gate(run, crossing, refuge);
    const exit = refuge + turn;
    return [duck(run, later(run, last, 0.97 + variation), exit), [exit]];
  }

  function pullToDuck(run, z, lane, turn, variation) {
    vault(run, z, lane);
    const pull = later(run, z, 0.91 + variation);
    wall(run, pull, [lane]);
    run.addObstacle(pull, lane, 'blackHole', { direction: turn });
    // The pull sends the runner away from the gate. Steer back after it releases.
    return [duck(run, later(run, pull, 0.73 + variation), lane), [lane]];
  }

  function duckToCrossing(run, z, lane, turn, variation) {
    const entrance = duck(run, z, lane);
    const divide = later(run, entrance, 0.69 + variation);
    const landing = lane + 2 * turn;
    const deck = lateralCrossing(run, divide, lane, landing, 0.68, 1.05);
    const beam = later(run, deck, 0.21 + variation);
    // All five lanes are back. The beam spans the track, so a tall jump or a lane change cannot replace the slide.
    return [gate(run, beam, ...LANES), LANES];
  }

  function forkToFunnel(run, z, lane, turn, variation) {
    const other = lane + 2 * turn;
    wall(run, z, [lane, other]);
    run.addObstacle(z, lane, 'hurdle');
    const entrance = gate(run, z, other);
    const funnel = later(run, entrance, 0.85 + variation);
    const slide = later(run, funnel, 0.67);
    const end = later(run, slide, 0.87);
    const middle = lane + turn;
    for (const closed of LANES) {
      if (closed !== middle) run.addClosure(funnel, closed, end - funnel);
    }
    gate(run, slide, middle);
    return [end, [middle]];
  }

  const vaultDuck = { build: vaultToDuck, entries: turns };
  const duckVault = { build: duckToVault, entries: turns };
  const raised = { build: raisedToDuck, entries: turns };
  const sweep = { build: sweepToDuck, entries: inward };
  const pull = { build: pullToDuck, entries: inward };
  const crossing = { build: duckToCrossing, entries: inward };
  const fork = { build: forkToFunnel, entries: inward };
  const tierSections = [
    [],
    [vaultDuck, duckVault],
    [raised, vaultDuck, duckVault],
    [sweep, pull, raised, vaultDuck],
    [crossing, fork, sweep, pull, raised],
  ];

  function placeSection(run, z, build, lane, turn, variation) {
    const [end, exitLanes] = build(run, z, lane, turn, variation);
    run.lastHazardEnd = end;
    run.openLanes = exitLanes;
    return end;
  }

  function placePracticeEncounter(run, name, z) {
    if (name === 'jump-slide') placeSection(run, z, jumpAndSlide);
    else if (name === 'lane-jump') placeSection(run, z, laneJump);
    else if (name === 'challenge') {
      const first = placeSection(run, z, sweep.build, 1, 1, 0.08);
      const second = placeSection(run, first + run.rowClearance(first), crossing.build, 3, -1, 0.08);
      placeSection(run, second + run.rowClearance(second), pull.build, 1, 1, 0.08);
    } else return false;
    return true;
  }

  function getEntrance(run, entries) {
    const steps = entries.map(([lane]) => Math.max(...run.openLanes.map((exit) => Math.abs(exit - lane))));
    const least = Math.min(...steps);
    // Prefer a nearby entrance, with room for a mirrored turn and a change from a single-lane exit.
    let choices = entries.filter(([lane], index) => steps[index] <= Math.min(least + 1, 2) ||
      steps[index] === least);
    const varied = choices.filter(([lane]) => run.openLanes.length > 1 || lane !== run.openLanes[0]);
    if (varied.length) choices = varied;
    return choices[Math.floor(run.random() * choices.length)];
  }

  function placeEncounter(run, z) {
    if (!run.endless || run.closure || run.shortGapDue) return false;
    const history = histories.get(run);
    if (history && z < history.nextAt) return false;

    const secondsAhead = 2 * (z - run.distance) / (run.baseSpeed + run.upperBaseAt(z));
    const survivalTier = TIER_TIMES.findLastIndex((seconds) => run.time + secondsAhead >= seconds) + 1;
    const tier = Math.max(run.courseTierFloor, survivalTier);
    if (tier < 2) return false;

    const remaining = history?.tier === tier && history.remaining.length ? history.remaining : tierSections[tier - 1];
    const available = remaining.filter((section) => section !== history?.previous);
    const section = available[Math.floor(run.random() * available.length)];
    const [lane, turn] = getEntrance(run, section.entries);
    const end = placeSection(run, z, section.build, lane, turn, run.random() * 0.18);

    // Let ordinary rows and scheduled closures cut across the authored rhythm every few sections.
    const streak = (history?.streak ?? 0) + 1;
    const breakForStandard = streak >= 4 || (streak === 3 && run.random() < 0.55);
    const nextAt = breakForStandard ? later(run, end, 1.35 + run.random() * 0.72) : end;
    histories.set(run, { tier, previous: section, remaining: remaining.filter((item) => item !== section),
      nextAt, streak: breakForStandard ? 0 : streak });
    return true;
  }

  const api = { placeEncounter, placePracticeEncounter };
  if (typeof module !== 'undefined') module.exports = api;
  else globalThis.VoidEncounters = api;
})();
