(function () {
  'use strict';

  const DASH_COOLDOWN = 4;
  const DASH_RECOVERY = 1;
  const LANES = [0, 1, 2, 3, 4];
  const LANE_WIDTH = 2.5;
  const BOLT_HEIGHT = 0.82;
  const ELEVATED_HEIGHT = 2.65;
  const MOTION_SAMPLES_PER_SECOND = 24;
  const SWAY = 0.48;
  const TRAIL_SWAY = 0.24;
  const FLOAT = 0.16;
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
    run.boltTime = run.time;
    run.boltsCollected = 0;
    const motionPhase = randomFor(seed ^ 0x9e3779b9)() * 2 * Math.PI;
    states.set(run, { random, motionPhase, ordinaryAt: run.time + ordinaryInterval(random),
      ordinaryZ: null, ordinaryIndex: 0, trail: null, id: 0 });
  }

  function laneX(lane) {
    return (lane - 2) * LANE_WIDTH;
  }

  function positionAt(bolt, simulationTime, reducedMotion = false) {
    const x = laneX(bolt.lane);
    const y = bolt.height;
    if (reducedMotion || bolt.motionPhase === undefined) return { x, y };

    // Interpolate fixed samples of each wave so rendering and pickup sweeps share the same path.
    const sample = simulationTime * MOTION_SAMPLES_PER_SECOND;
    const index = Math.floor(sample);
    const fraction = sample - index;
    const wave = (frequency, phase) => {
      const stride = frequency * 2 * Math.PI / MOTION_SAMPLES_PER_SECOND;
      const first = Math.sin(index * stride + phase);
      const next = Math.sin((index + 1) * stride + phase);
      return first + (next - first) * fraction;
    };
    return {
      x: x + (bolt.transmission ? TRAIL_SWAY : SWAY) * wave(0.70, bolt.motionPhase),
      y: y + FLOAT * wave(0.95, bolt.motionPhase * 1.7),
    };
  }

  function axisInterval(from, to, min, max) {
    const delta = to - from;
    if (delta === 0) return from >= min && from <= max ? [0, 1] : null;
    const first = (min - from) / delta;
    const last = (max - from) / delta;
    const enter = Math.max(0, Math.min(first, last));
    const exit = Math.min(1, Math.max(first, last));
    return enter <= exit ? [enter, exit] : null;
  }

  function heightContact(y, velocity, gravity, duration, low, high) {
    // Relative height is quadratic because the bolt's path is linear between samples.
    const apex = gravity ? Math.max(0, Math.min(duration, velocity / gravity)) : 0;
    const height = (at) => y + (velocity - gravity * at / 2) * at;
    for (const [first, last] of [[0, apex], [apex, duration]]) {
      const start = height(first);
      if (start >= low && start <= high) return first;
      const end = height(last);
      const boundary = start < low ? low : high;
      if (boundary < Math.min(start, end) || boundary > Math.max(start, end)) continue;
      const speed = velocity - gravity * first;
      const root = Math.sqrt(Math.max(0, speed ** 2 - 2 * gravity * (boundary - start)));
      return Math.min(last, first + 2 * (boundary - start) / (speed + Math.sign(end - start) * root));
    }
    return null;
  }

  function contactAt(bolt, from, to, startTime, endTime, reducedMotion, motion, sliding) {
    const depth = axisInterval(from.z, to.z, bolt.z - PICKUP_HALF_DEPTH, bolt.z + PICKUP_HALF_DEPTH);
    if (!depth) return null;

    const duration = endTime - startTime;
    // Physics fractions keep referring to the full tick when a crash clips its travel.
    const step = motion?.step ?? 1;
    const stepScale = motion ? duration / step : 1;
    const secondsPerFraction = motion ? duration : 1;
    const segments = motion?.segments ?? [{ start: 0, end: 1, y: from.y, velocity: to.y - from.y, gravity: 0 }];
    const slideStart = motion ? motion.slideStart / stepScale : sliding ? -Infinity : Infinity;
    const slideEnd = motion ? motion.slideEnd / stepScale : Infinity;
    const animate = !reducedMotion && bolt.motionPhase !== undefined && duration > 0;
    const timeAt = (fraction) => startTime + fraction * duration;
    const xAt = (fraction) => from.x + fraction * (to.x - from.x);
    let first = depth[0];
    let sample = Math.floor(timeAt(first) * MOTION_SAMPLES_PER_SECOND) + 1;
    while (first <= depth[1]) {
      const edge = animate ? (sample++ / MOTION_SAMPLES_PER_SECOND - startTime) / duration : Infinity;
      if (edge <= first) continue;
      const last = Math.min(edge, depth[1]);
      const a = positionAt(bolt, timeAt(first), reducedMotion);
      const b = positionAt(bolt, timeAt(last), reducedMotion);
      const across = axisInterval(xAt(first) - a.x, xAt(last) - b.x, -PICKUP_HALF_WIDTH, PICKUP_HALF_WIDTH);
      if (across) {
        const span = last - first;
        const enter = first + span * across[0];
        const exit = first + span * across[1];
        const boltVelocity = span ? (b.y - a.y) / span : 0;
        const postures = [
          [enter, enter < slideStart ? Math.min(exit, slideStart) : -Infinity, STANDING_HEIGHT],
          [Math.max(enter, slideStart), Math.min(exit, slideEnd), SLIDING_HEIGHT],
          [slideEnd < exit ? Math.max(enter, slideEnd) : Infinity, exit, STANDING_HEIGHT],
        ];
        for (const segment of segments) {
          for (const [postureStart, postureEnd, playerHeight] of postures) {
            const low = Math.max(postureStart, segment.start / stepScale);
            const high = Math.min(postureEnd, segment.end / stepScale);
            if (low > high) continue;
            const elapsed = low * secondsPerFraction - segment.start * step;
            const runnerY = segment.y + (segment.velocity - segment.gravity * elapsed / 2) * elapsed;
            const boltY = a.y + boltVelocity * (low - first);
            const speed = (segment.velocity - segment.gravity * elapsed) * secondsPerFraction - boltVelocity;
            const at = heightContact(runnerY - boltY, speed, segment.gravity * secondsPerFraction ** 2,
              high - low, -PICKUP_HALF_HEIGHT - playerHeight, PICKUP_HALF_HEIGHT);
            if (at !== null) return low + at;
          }
        }
      }
      if (last === depth[1]) break;
      first = last;
    }
    return null;
  }

  function collect(run, from, to, startTime, endTime, motion) {
    if (!run.bolts.length) return;
    const contacts = [];
    let remaining = 0;
    for (const bolt of run.bolts) {
      if (bolt.z < from.z - PICKUP_HALF_DEPTH) continue;
      const ahead = bolt.z > to.z + PICKUP_HALF_DEPTH || (run.crash && (bolt.z > to.z || endTime <= startTime));
      const at = ahead ? null : contactAt(bolt, from, to, startTime, endTime, run.reducedMotion, motion, run.sliding);
      if (at !== null && (!run.crash || at < 1 - 1e-10)) contacts.push({ bolt, at });
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

  function addBolt(run, state, lane, z, transmission = false, height = BOLT_HEIGHT) {
    const id = state.id++;
    const motionPhase = state.motionPhase + ((Math.imul(id, 0x9e3779b9) >>> 0) / 4294967296 * 2 * Math.PI);
    run.bolts.push({ id, lane, z, height, transmission, motionPhase });
  }

  function elevatedPlacement(run, target) {
    const limit = target + run.baseSpeed;
    let course;
    for (const hazard of run.obstacles) {
      if (hazard.z > limit) break;
      if (hazard.type !== 'hurdle' && hazard.type !== 'platform') continue;
      const speed = run.upperBaseAt(hazard.z);
      const platform = hazard.type === 'platform';
      const z = platform ? hazard.z + speed * 0.59 : hazard.z;
      if (z < target || z > limit || (platform && hazard.end - z < speed * 0.22)) continue;

      // Keep takeoff, clearance, and touchdown free of other hazards in the reward lane.
      course ??= run.obstacles.concat(run.forecastObstacles ?? []);
      const others = course.filter((obstacle) => obstacle !== hazard);
      if (!openLanesBetween(others, hazard.z - speed * 0.48, z + speed * 0.64).includes(hazard.lane)) continue;
      const before = others.findLast((obstacle) => obstacle.z < hazard.z - 1.3);
      const after = others.find((obstacle) => obstacle.z > (hazard.end ?? hazard.z) + 1.3);
      if (before && !rowLanes(others, before.z).some((lane) => Math.abs(lane - hazard.lane) <= 1)) continue;
      if (after && !rowLanes(others, after.z).some((lane) => Math.abs(lane - hazard.lane) <= 1)) continue;
      return { lane: hazard.lane, z };
    }
    return null;
  }

  function placeOrdinary(run, state) {
    if (state.ordinaryZ !== null || run.time + ORDINARY_LEAD < state.ordinaryAt) return;

    const target = run.distance + run.baseSpeed * ORDINARY_LEAD;
    const laterTier = run.musicTierFloor > 1 || run.time + ORDINARY_LEAD >= 30;
    let lane;
    if (laterTier) {
      if (state.ordinaryIndex % 3 === 0) {
        const elevated = elevatedPlacement(run, target);
        if (elevated) {
          addBolt(run, state, elevated.lane, elevated.z, false, ELEVATED_HEIGHT);
          state.ordinaryZ = elevated.z;
          return;
        }
      }
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

  function update(run, from, to, startTime = run.boltTime, endTime = run.time, motion) {
    const state = states.get(run);
    run.boltTime = endTime;
    collect(run, from, to, startTime, endTime, motion);
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
      state.ordinaryIndex++;
      state.ordinaryAt = run.time + ordinaryInterval(state.random);
    }
    if (run.transmission?.phase !== 'draining') placeOrdinary(run, state);
  }

  const api = { init, update, positionAt, DASH_COOLDOWN };
  if (typeof module !== 'undefined') module.exports = api;
  else globalThis.VoidBolts = api;
})();
