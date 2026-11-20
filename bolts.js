(function () {
  'use strict';

  const DASH_COOLDOWN = 4;
  const DASH_RECOVERY = 1;
  const LANES = [0, 1, 2, 3, 4];
  const LANE_WIDTH = 2.5;
  const BOLT_HEIGHT = 0.82;
  const PICKUP_HALF_WIDTH = 0.72;
  const PICKUP_HALF_DEPTH = 0.78;
  const PICKUP_HALF_HEIGHT = 0.24;
  const STANDING_HEIGHT = 1.6;
  const SLIDING_HEIGHT = 0.75;
  const ORDINARY_LEAD = 1.65;
  const TRAIL_LEAD = 1;
  const TRAIL_START = 1.0;
  const TRAIL_SPACING = 0.4;
  const TRAIL_GROUP_SIZE = 4;
  const GROUND_ACTIONS = ['hurdle', 'slideGate', 'platform'];
  const states = new WeakMap();

  function randomFor(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6D2B79F5) >>> 0;
      let bits = Math.imul(state ^ (state >>> 15), state | 1);
      bits ^= bits + Math.imul(bits ^ (bits >>> 7), bits | 61);
      return ((bits ^ (bits >>> 14)) >>> 0) / 4294967296;
    };
  }

  function ordinaryInterval(random) {
    return 7.5 + random() * 1.8;
  }

  function init(run, seed = 0) {
    const random = randomFor(seed);
    run.bolts = [];
    run.boltsCollected = 0;
    states.set(run, { random, ordinaryAt: run.time + ordinaryInterval(random), ordinaryZ: null, trail: null, id: 0 });
  }

  function laneX(lane) {
    return (lane - 2) * LANE_WIDTH;
  }

  function contactAt(bolt, from, to, playerHeight) {
    const x = laneX(bolt.lane);
    const axes = [
      ['x', x - PICKUP_HALF_WIDTH, x + PICKUP_HALF_WIDTH],
      ['y', bolt.height - PICKUP_HALF_HEIGHT - playerHeight, bolt.height + PICKUP_HALF_HEIGHT],
      ['z', bolt.z - PICKUP_HALF_DEPTH, bolt.z + PICKUP_HALF_DEPTH],
    ];
    let enter = 0;
    let leave = 1;
    for (const [axis, min, max] of axes) {
      const start = from[axis];
      const delta = to[axis] - start;
      if (delta === 0) {
        if (start < min || start > max) return null;
      } else {
        const front = (min - start) / delta;
        const back = (max - start) / delta;
        enter = Math.max(enter, Math.min(front, back));
        leave = Math.min(leave, Math.max(front, back));
        if (enter > leave) return null;
      }
    }
    return enter;
  }

  function collect(run, from, to) {
    if (!run.bolts.length) return;
    const contacts = [];
    const playerHeight = run.sliding ? SLIDING_HEIGHT : STANDING_HEIGHT;
    let remaining = 0;
    for (const bolt of run.bolts) {
      if (bolt.z < from.z - PICKUP_HALF_DEPTH) continue;
      const ahead = bolt.z > to.z + PICKUP_HALF_DEPTH || (run.crash && bolt.z > to.z);
      const at = ahead ? null : contactAt(bolt, from, to, playerHeight);
      if (at !== null && (!run.crash || at < 1)) contacts.push({ bolt, at });
      else if (bolt.z >= to.z - PICKUP_HALF_DEPTH) run.bolts[remaining++] = bolt;
    }
    run.bolts.length = remaining;
    contacts.sort((first, second) => first.at - second.at);
    for (const { bolt } of contacts) {
      run.boltsCollected++;
      if (run.dashReadyAt > run.time) run.dashReadyAt = Math.max(run.time, run.dashReadyAt - DASH_RECOVERY);
      run.onEvent('bolt', bolt);
    }
  }

  function openLanesBetween(obstacles, from, to = from) {
    return LANES.filter((lane) => !obstacles.some((obstacle) => {
      // Include the whole lateral sweep of a moving barrier and every lane in a spanning hazard.
      const firstLane = Math.min(obstacle.lane, obstacle.toLane ?? obstacle.lane);
      const lastLane = Math.max(obstacle.toLane ?? obstacle.lane, obstacle.lane + (obstacle.lanes ?? 1) - 1);
      return lane >= firstLane && lane <= lastLane &&
        obstacle.z - 1.3 <= to && (obstacle.end ?? obstacle.z) + 1.3 >= from;
    }));
  }

  function rowLanes(obstacles, z) {
    const grounded = openLanesBetween(obstacles, z);
    if (grounded.length) return grounded;
    // Authored rows can require a jump or slide. Their action lanes are valid approaches and exits.
    return openLanesBetween(obstacles.filter(({ type }) => !GROUND_ACTIONS.includes(type)), z);
  }

  function ordinaryLane(run, z, alongsideHazard, random) {
    const breathingRoom = run.baseSpeed * 0.16;
    const open = openLanesBetween(run.obstacles, z - breathingRoom, z + breathingRoom);
    const before = run.obstacles.findLast((obstacle) => obstacle.z < z - breathingRoom);
    const after = run.obstacles.find((obstacle) => obstacle.z > z + breathingRoom);
    const approaches = before ? rowLanes(run.obstacles, before.z) : LANES;
    const exits = after ? rowLanes(run.obstacles, after.z) : LANES;
    const reachable = open.filter((lane) => approaches.some((entry) => Math.abs(entry - lane) <= 1) &&
      exits.some((exit) => Math.abs(exit - lane) <= 1));
    if (!alongsideHazard) return reachable.length ? reachable[Math.floor(random() * reachable.length)] : undefined;
    const nearby = run.baseSpeed * 0.38;
    const clearAround = openLanesBetween(run.obstacles, z - nearby, z + nearby);
    const beside = reachable.filter((lane) =>
      [lane - 1, lane + 1].some((neighbor) => LANES.includes(neighbor) && !clearAround.includes(neighbor)));
    return beside.length ? beside[Math.floor(random() * beside.length)] : undefined;
  }

  function addBolt(run, state, lane, z, transmission = false) {
    run.bolts.push({ id: state.id++, lane, z, height: BOLT_HEIGHT, transmission });
  }

  function placeOrdinary(run, state) {
    if (state.ordinaryZ !== null || run.time + ORDINARY_LEAD < state.ordinaryAt) return;

    const target = run.distance + run.baseSpeed * ORDINARY_LEAD;
    const laterTier = run.musicTierFloor > 1 || run.time + ORDINARY_LEAD >= 30;
    let lane;
    if (laterTier) {
      const limit = target + run.baseSpeed * 1.0;
      let lastTried = -Infinity;
      for (const obstacle of run.obstacles) {
        if (obstacle.z > limit) break;
        if ((obstacle.end ?? obstacle.z) < target) continue;
        const z = Math.max(target, obstacle.z);
        if (z === lastTried) continue;
        lastTried = z;
        lane = ordinaryLane(run, z, true, state.random);
        if (lane === undefined) continue;
        addBolt(run, state, lane, z);
        state.ordinaryZ = z;
        return;
      }
      lane = ordinaryLane(run, target, true, state.random);
      // Give the next generated row a short chance before settling on open track.
      if (lane === undefined && run.time + ORDINARY_LEAD < state.ordinaryAt + 0.75) return;
    }

    lane ??= ordinaryLane(run, target, false, state.random);
    if (lane !== undefined) {
      addBolt(run, state, lane, target);
      state.ordinaryZ = target;
    }
  }

  function placeTrail(run, state, { elapsed, duration }) {
    if (!state.trail) {
      run.bolts.length = 0;
      state.ordinaryZ = null;
      state.trail = { lane: run.lane, next: 0, lastZ: run.distance };
    }
    const trail = state.trail;
    const arriveAt = TRAIL_START + trail.next * TRAIL_SPACING;
    if (arriveAt > duration - 0.3 || arriveAt - elapsed > TRAIL_LEAD) return;

    if (trail.next > 0 && trail.next % TRAIL_GROUP_SIZE === 0) {
      const neighbors = [trail.lane - 1, trail.lane + 1].filter((lane) => LANES.includes(lane));
      trail.lane = neighbors[Math.floor(state.random() * neighbors.length)];
    }
    // Keep the trail in order when a temporary dash, brake, or late update changes the approach.
    const z = Math.max(trail.lastZ + run.baseSpeed * 0.2, run.distance + run.baseSpeed * (arriveAt - elapsed));
    addBolt(run, state, trail.lane, z, true);
    trail.lastZ = z;
    trail.next++;
  }

  function update(run, from, to) {
    const state = states.get(run);
    collect(run, from, to);
    if (run.crash || run.scripted) return;

    if (run.transmission?.phase === 'playing') {
      placeTrail(run, state, run.transmission);
      return;
    }
    if (state.trail) {
      run.bolts.length = 0;
      state.trail = null;
      state.ordinaryAt = run.time + ordinaryInterval(state.random);
    }
    if (state.ordinaryZ !== null && to.z >= state.ordinaryZ) {
      state.ordinaryZ = null;
      state.ordinaryAt = run.time + ordinaryInterval(state.random);
    }
    if (run.transmission?.phase !== 'draining') placeOrdinary(run, state);
  }

  const api = { init, update, DASH_COOLDOWN };
  if (typeof module !== 'undefined') module.exports = api;
  else globalThis.VoidBolts = api;
})();
