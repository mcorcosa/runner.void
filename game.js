(function () {
  'use strict';

  const commonJS = typeof module !== 'undefined';
  const encounters = commonJS ? require('./encounters.js') : globalThis.VoidEncounters;
  const bolts = commonJS ? require('./bolts.js') : globalThis.VoidBolts;
  const { DASH_COOLDOWN } = bolts;

  const LANE_COUNT = 5;
  const LANE_WIDTH = 2.5;
  const START_SPEED = 32; // Scripted pace and the scene's FOV reference.
  const ENDLESS_START_SPEED = 48;
  const ADVANCED_START_SPEED = 80;
  const ENDLESS_LAUNCH_SPEEDS = [ENDLESS_START_SPEED, ADVANCED_START_SPEED, 112, 144, 176];
  const MAX_LAUNCH_LEVEL = ENDLESS_LAUNCH_SPEEDS.length - 1;
  const DEFAULT_TRANSMISSION_COUNT = 4;
  const FAST_START_SPEED = 64;
  const HIGH_SPEED_QA = 572;
  const ACCELERATION = 1.8;
  const STEP = 1 / 120;
  const STEER_FRACTION = 1 - Math.exp(-23 * STEP);
  const GRAVITY = 23;
  const JUMP_SPEED = 9.8;
  const JUMP_TIME = 2 * JUMP_SPEED / GRAVITY;
  const SLIDE_ARM_CLEARANCE = 1;
  const SLIDE_LANDING_TRAVEL = 3;
  const SLIDE_DISTANCE = 14;
  const SLIDE_BRAKE_FRACTION = 0.08;
  const MAX_SLIDE_BRAKE = 12;
  const MAX_BRAKE_AT = MAX_SLIDE_BRAKE / SLIDE_BRAKE_FRACTION;
  const BOOST_TIME = 0.85;
  const BOOST_SPEED = 15;
  const DASH_TIME = 0.7;
  const DASH_SPEED = 22;
  const AIR_DASH_GLIDE = 0.60;
  const GROUND_DASH_AIR_SPEED = 0.5;
  const PLAYER_HALF_WIDTH = 0.24;
  const PLAYER_HALF_DEPTH = 0.36;
  const STANDING_HEIGHT = 2.07;
  const SLIDING_HEIGHT = 1.28;
  const PLATFORM_HEIGHT = 1.05;
  const PLATFORM_HALF_WIDTH = 1.10;
  const SOLID_TOP_ALLOWANCE = 0.06;
  const SLIDE_GATE_CLEARANCE = 1.42;
  const SLIDE_GATE_HEIGHT = 3.22;
  const SLIDE_GATE_HALF_WIDTH = 0.99;
  const SLIDE_GATE_MIN_APPROACH = 16;
  const SLIDE_GATE_APPROACH_MULTIPLE = 3;
  const BLACK_HOLE_HALF_WIDTH = 0.85;
  const BLACK_HOLE_HALF_DEPTH = 1.15;
  const BLACK_HOLE_HEIGHT = 0.85;
  const SPIKE_HEIGHT = 0.52;
  const SPIKE_CLEAR_TIME = 2 * Math.sqrt(JUMP_SPEED ** 2 - 2 * GRAVITY * SPIKE_HEIGHT) / GRAVITY;
  const SPIKE_DESCENT_TIME = (JUMP_SPEED / GRAVITY) + SPIKE_CLEAR_TIME / 2;
  const GROUND_DASH_AIR_TRAVEL = DASH_SPEED * DASH_TIME * (2 / 3) * GROUND_DASH_AIR_SPEED;
  const OPENING = [[78, 2, 'hurdle'], [165, 2, 'barrier']];
  // The side lanes take turns before the first spikes. The next standard row revisits the first pair.
  const OPENING_SWEEPS = [[0, 3], [1, 4], [3, 0]];
  // Each spike pair gives its tile count along the track and its width in lanes.
  const CLUE_OPENINGS = [
    { closureAfter: 10, rows: [
      { openLanes: [0, 3] }, { openLanes: [1, 4] }, { openLanes: [2, 3] },
    ] },
    { closureAfter: 9, rows: [
      { openLanes: [0, 3] }, { openLanes: [1, 4], spikes: [1, 1] }, { openLanes: [2, 3] },
      { openLanes: [1, 4], spikes: [2, 1] }, { openLanes: [0, 4] },
    ] },
    { closureAfter: 8, rows: [
      { openLanes: [0, 3], spikes: [1, 2] }, { openLanes: [1, 4] }, { openLanes: [2, 3], spikes: [1, 2] },
      { openLanes: [1, 4] }, { openLanes: [0, 3], spikes: [1, 2] },
    ] },
    { closureAfter: 7, rows: [
      { openLanes: [1, 4], spikes: [2, 2] }, { openLanes: [0, 3] }, { openLanes: [1, 4], spikes: [2, 2] },
      { openLanes: [2, 3] }, { openLanes: [2], spikes: [2, 2] }, { openLanes: [1, 3] },
    ] },
  ];
  const HAZARD_INTRODUCTIONS = [
    { distance: 360, tiles: 1, lanes: 1 },
    { distance: 640, tiles: 2, lanes: 1 },
    { distance: 900, tiles: 1, lanes: 2 },
    { distance: 1200, type: 'closure' },
  ];
  const COURSE_DIFFICULTIES = [
    { distance: 3600, standardCount: [3, 4], closureCount: [2, 3], longChance: 0.78, wideChance: 0.75 },
    { distance: 1800, standardCount: [2, 3], closureCount: [1, 2], longChance: 0.48, wideChance: 0.40 },
    { distance: 0, standardCount: [2, 2], closureCount: [1, 1], longChance: 0, wideChance: 0.25 },
  ];
  const ADVANCED_OPENING_DIFFICULTY = COURSE_DIFFICULTIES[1];
  const MAX_EXTRA_SPEED = BOOST_SPEED + DASH_SPEED;
  const CLOSURE_SECONDS = 3;
  const SHORT_GAP_SECONDS = JUMP_TIME * 0.55;
  const MIN_SPIKE_INTERVAL = 1.1;
  const MIN_CLOSURE_INTERVAL = 3.55;
  const MIN_VIEW_DISTANCE = 186;
  const VIEW_SECONDS = 2.6;
  const RUNWAY_RANGE_MULTIPLIER = 16;
  const REACTION_TIME = 0.86;
  const ROW_BUFFER = 3;
  const LANES = Array.from({ length: LANE_COUNT }, (_, lane) => lane);

  const obstacles = {
    hurdle: { height: 0.71, halfDepth: 0.25, halfWidth: 0.96 },
    barrier: { height: 1.88, halfDepth: 0.32, halfWidth: 0.99 },
  };

  const scenarios = {
    lanes: [[42, 2, 'barrier'], [104, 1, 'barrier'], [104, 3, 'barrier']],
    hurdle: [[42, 2, 'hurdle']],
    barrier: [[42, 2, 'barrier'], [42, 3, 'barrier']],
    'dash-first': [[42, 2, 'barrier'], [50, 2, 'barrier']],
    'dash-expiry': [[76, 2, 'barrier']],
    'spike-short': [[90, 2, 'spikes', 1, 1]],
    'spike-long': [[90, 2, 'spikes', 2, 2]],
    gap: [[66, 2, 'gap', 320]],
    'gap-edge': [[67, 0, 'gap', 323]],
    'gap-short': [[66, 2, 'short-gap', 16]],
    platform: [],
    'slide-gate': [],
    'moving-barrier': [],
    'black-hole': [],
    'jump-slide': [],
    'lane-jump': [],
    challenge: [],
    camera: [[1180, 2, 'barrier']],
    'high-speed': [[620, 2, 'hurdle'], [1240, 0, 'gap', 2000], [2350, 2, 'barrier'], [3920, 1, 'spikes', 2, 2]],
    landing: [],
  };

  function laneX(lane) {
    return (lane - 2) * LANE_WIDTH;
  }

  function movingBarrierX(obstacle, time) {
    const fraction = (1 - Math.cos(time * 2 * Math.PI / 1.8)) / 2;
    return laneX(obstacle.lane + (obstacle.toLane - obstacle.lane) * fraction);
  }

  function forwardEnvelope(speed, seconds) {
    // The step-sized term covers forward integration at the end of a tick.
    return seconds * (speed + ACCELERATION * (seconds / 2 + STEP));
  }

  function sightDistance(baseSpeed) {
    return Math.max(MIN_VIEW_DISTANCE, forwardEnvelope(baseSpeed + MAX_EXTRA_SPEED, VIEW_SECONDS));
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

  function intersectIntervals(first, second) {
    if (!first || !second) return null;
    const enter = Math.max(first[0], second[0]);
    const exit = Math.min(first[1], second[1]);
    return enter <= exit ? { enter, exit } : null;
  }

  function depthMargin({ type }) {
    if (type === 'gap') return 0;
    const halfDepth = type === 'blackHole' ? BLACK_HOLE_HALF_DEPTH : solidShape(type)?.halfDepth ?? 0;
    return halfDepth + PLAYER_HALF_DEPTH;
  }

  function farCollisionEdge(obstacle) {
    return (obstacle.end ?? obstacle.z) + depthMargin(obstacle);
  }

  function slideGateBounds(gate) {
    const x = laneX(gate.lane);
    const halfWidth = SLIDE_GATE_HALF_WIDTH + PLAYER_HALF_WIDTH;
    const front = gate.z - PLAYER_HALF_DEPTH;
    const approachLength = Math.max(SLIDE_GATE_MIN_APPROACH, (gate.end - gate.z) * SLIDE_GATE_APPROACH_MULTIPLE);
    return { left: x - halfWidth, right: x + halfWidth, front, back: farCollisionEdge(gate), approach: front - approachLength };
  }

  function fallTime(height, velocity) {
    const root = Math.sqrt(Math.max(0, velocity ** 2 + 2 * GRAVITY * height));
    return velocity < 0 ? 2 * height / (root - velocity) : (velocity + root) / GRAVITY;
  }

  function solidShape(type) {
    return obstacles[type === 'movingBarrier' ? 'barrier' : type];
  }

  function solidTop(obstacle) {
    return obstacle.type === 'platform' ? obstacle.height ?? PLATFORM_HEIGHT : solidShape(obstacle.type)?.height;
  }

  function horizontalSweep(obstacle, from, to, startTime, endTime) {
    const { type } = obstacle;
    const forward = axisInterval(from.z, to.z, obstacle.z - depthMargin(obstacle), farCollisionEdge(obstacle));
    if (!forward) return null;
    const x = laneX(obstacle.lane);
    let across;
    if (type === 'gap' || type === 'spikes') {
      const padding = type === 'gap' ? 0 : PLAYER_HALF_WIDTH - 0.10;
      across = axisInterval(from.x, to.x, x - LANE_WIDTH / 2 - padding,
        x + ((obstacle.lanes ?? 1) - 0.5) * LANE_WIDTH + padding);
    } else if (type === 'movingBarrier') {
      const width = obstacles.barrier.halfWidth + PLAYER_HALF_WIDTH;
      // Sweep the runner relative to the barrier's movement during the same step.
      across = axisInterval(from.x - movingBarrierX(obstacle, startTime),
        to.x - movingBarrierX(obstacle, endTime), -width, width);
    } else {
      const width = (type === 'platform' ? PLATFORM_HALF_WIDTH :
        type === 'slideGate' ? SLIDE_GATE_HALF_WIDTH :
        type === 'blackHole' ? BLACK_HOLE_HALF_WIDTH : obstacles[type].halfWidth) + PLAYER_HALF_WIDTH;
      across = axisInterval(from.x, to.x, x - width, x + width);
    }

    const overlap = intersectIntervals(forward, across);
    return overlap ? { obstacle, ...overlap, top: solidTop(obstacle) } : null;
  }

  function heightIn(segment, at) {
    const seconds = (at - segment.start) * STEP;
    return segment.y + segment.velocity * seconds - segment.gravity * seconds ** 2 / 2;
  }

  function verticalSweep(run, from, supports, startTime) {
    const segments = [];
    const landings = [];
    let at = 0;
    let y = from.y;
    let velocity = run.verticalSpeed;
    let airborne = run.airborne;
    const glideEnd = airborne ? Math.max(0, Math.min(1, (run.airDashUntil - startTime) / STEP)) : 0;
    if (glideEnd > 0) {
      segments.push({ start: 0, end: glideEnd, y, velocity: 0, gravity: 0 });
      at = glideEnd;
    }
    while (at < 1) {
      if (!airborne) {
        let edge = y === 0 ? 1 : at;
        for (const { top, enter, exit } of supports) {
          if (top === y && enter <= at) edge = Math.max(edge, exit);
        }
        if (edge > at) {
          segments.push({ start: at, end: edge, y, velocity: 0, gravity: 0, grounded: true });
          at = edge;
          continue;
        }
        airborne = true;
        velocity = 0;
      }

      const groundAt = at + fallTime(y, velocity) / STEP;
      let end = Math.min(1, groundAt);
      let landingHeight = groundAt <= 1 ? 0 : null;
      let surface;
      const apex = y + Math.max(0, velocity) ** 2 / (2 * GRAVITY);
      const flight = { start: at, end, y, velocity, gravity: GRAVITY };
      for (const { obstacle, top, enter, exit } of supports) {
        const entry = Math.max(at, enter);
        if (entry > end || entry > exit) continue;
        const entryHeight = heightIn(flight, entry);
        let landing;
        if (apex >= top && entryHeight >= top - 1e-10) {
          landing = Math.max(entry, at + fallTime(y - top, velocity) / STEP);
        } else if (obstacle.type !== 'platform' && enter > at && entryHeight >= top - SOLID_TOP_ALLOWANCE &&
          velocity - GRAVITY * (entry - at) * STEP < 0) {
          // A descending runner can catch the lip as the collider first overlaps the top.
          landing = entry;
        } else continue;
        if (landing > end || (landing >= exit && !(landing === 1 && exit === 1))) continue;
        end = landing;
        landingHeight = top;
        surface = obstacle;
      }

      flight.end = end;
      if (end > at) segments.push(flight);
      velocity -= GRAVITY * (end - at) * STEP;
      at = end;
      y = landingHeight ?? heightIn(flight, end);
      if (landingHeight === null) break;
      landings.push({ at, height: y, surface });
      airborne = false;
      velocity = 0;
    }
    // Keep the exact surface height at a touchdown, including one at the end of the step.
    if (landings.at(-1)?.at === 1) {
      segments.push({ start: 1, end: 1, y, velocity: 0, gravity: 0, grounded: true });
    }
    return { y, velocity, airborne, segments, landings };
  }

  function heightContact(segment, enter, exit, low, high, openTop = false) {
    // Each flight is monotonic before and after its apex. Solve the height boundary
    // against the same trajectory used for landing and impact.
    const apex = segment.gravity ? segment.start + segment.velocity / (segment.gravity * STEP) : enter;
    const split = Math.max(enter, Math.min(exit, apex));
    for (const [start, end] of [[enter, split], [split, exit]]) {
      const y0 = heightIn(segment, start);
      const y1 = heightIn(segment, end);
      if (Math.max(y0, y1) < low || (openTop ? Math.min(y0, y1) >= high - 1e-10 : Math.min(y0, y1) > high)) continue;
      if (y0 >= low && y0 <= high) return start;
      const boundary = y0 < low ? low : high;
      const speed = segment.velocity - segment.gravity * (start - segment.start) * STEP;
      const root = Math.sqrt(Math.max(0, speed ** 2 - 2 * segment.gravity * (boundary - y0)));
      return Math.min(end, start + 2 * (boundary - y0) / (speed + Math.sign(y1 - y0) * root) / STEP);
    }
    return null;
  }

  function gapContactFraction(obstacle, from, to, segments) {
    const deck = segments.find((segment) => segment.grounded && segment.y === 0);
    if (!deck) return null;
    const x = from.x + (to.x - from.x) * deck.start;
    const z = from.z + (to.z - from.z) * deck.start;
    // At the far lip the floor has already resumed.
    if (z >= obstacle.end) return null;
    const left = laneX(obstacle.lane) - LANE_WIDTH / 2;
    const across = axisInterval(x, to.x, left, left + (obstacle.lanes ?? 1) * LANE_WIDTH);
    const forward = axisInterval(z, to.z, obstacle.z, obstacle.end);
    if (!across || !forward) return null;
    const enter = Math.max(across[0], forward[0]);
    if (enter > Math.min(across[1], forward[1]) || z + (to.z - z) * enter >= obstacle.end) return null;
    return deck.start + (1 - deck.start) * enter;
  }

  function contactFraction(sweep, from, to, motion, slideStart, slideEnd) {
    const { obstacle, enter, exit } = sweep;
    const { type } = obstacle;
    if (type === 'gap') return gapContactFraction(obstacle, from, to, motion.segments);
    if (type === 'blackHole' && obstacle.triggered) return null;
    if (type === 'slideGate' && exit === 0) return null;
    for (const segment of motion.segments) {
      const start = Math.max(segment.start, enter);
      const end = Math.min(segment.end, exit);
      if (start > end) continue;
      if (type === 'slideGate') {
        const ranges = [
          [start, start < slideStart ? Math.min(end, slideStart) : -Infinity, STANDING_HEIGHT],
          [Math.max(start, slideStart), Math.min(end, slideEnd), SLIDING_HEIGHT],
          [slideEnd < end ? Math.max(start, slideEnd) : Infinity, end, STANDING_HEIGHT],
        ];
        for (const [first, last, height] of ranges) {
          if (first > last) continue;
          const at = heightContact(segment, first, last, SLIDE_GATE_CLEARANCE - height, SLIDE_GATE_HEIGHT);
          if (at !== null) return at;
        }
      } else {
        if (sweep.top !== undefined && start === segment.end &&
            motion.landings.some(({ at, surface }) => at === start && surface === obstacle)) continue;
        const high = sweep.top ?? (type === 'blackHole' ? BLACK_HOLE_HEIGHT : SPIKE_HEIGHT);
        const at = heightContact(segment, start, end, -Infinity, high, sweep.top !== undefined);
        if (at !== null) return at;
      }
    }
    return null;
  }

  class Run {
    #slideGates = new Set();
    #queuedSlide = null;
    #landingSlide = null;
    #transmissionClearAfter = -Infinity;
    #transmissionTicks = 0;
    #requestedTransmissions = new Set();
    #transmissionCount;
    #courseAnchor;
    #planningCourse = false;
    #forecast = [];
    #forecastRows = [];
    // An ID stays reserved even if a transmission clears its forecast row.
    #nextObstacleId = 0;

    constructor({ seed = Date.now(), scenario = '', pace = '', advanced = false,
      discoveredClues = advanced ? 1 : 0, launchLevel, transmissionCount = DEFAULT_TRANSMISSION_COUNT,
      onEvent = () => {} } = {}) {
      if (!Number.isSafeInteger(transmissionCount) || transmissionCount < 1) {
        throw new RangeError('Transmission count must be a positive safe integer');
      }
      this.#transmissionCount = transmissionCount;
      if (launchLevel === undefined) {
        launchLevel = Number.isFinite(discoveredClues) ?
          Math.min(MAX_LAUNCH_LEVEL, Math.max(0, Math.floor(discoveredClues))) : 0;
      } else if (!Number.isInteger(launchLevel) || launchLevel < 0 || launchLevel > MAX_LAUNCH_LEVEL) {
        throw new RangeError('Launch level must be an integer from 0 to ' + MAX_LAUNCH_LEVEL);
      }
      const challenge = scenario === 'challenge';
      this.scripted = Object.hasOwn(scenarios, scenario);
      this.endless = !this.scripted || challenge;
      if (challenge) launchLevel = pace === 'fast' ? 4 : 3;
      else if (this.scripted) launchLevel = 0;
      const clueOpening = CLUE_OPENINGS[launchLevel - 1];
      this.advanced = launchLevel > 0;
      this.courseTierFloor = launchLevel + 1;
      this.musicTierFloor = this.scripted ? 1 : this.courseTierFloor;
      this.distance = 0;
      this.time = 0;
      this.baseSpeed = this.endless ? ENDLESS_LAUNCH_SPEEDS[launchLevel] : START_SPEED;
      if (!this.endless && pace === 'fast') this.baseSpeed = FAST_START_SPEED;
      else if (scenario === 'high-speed') this.baseSpeed = HIGH_SPEED_QA;
      this.speed = this.baseSpeed;
      this.lane = 2;
      this.x = 0;
      this.height = 0;
      this.verticalSpeed = 0;
      this.airborne = false;
      this.slideEndDistance = -Infinity;
      this.slideSlows = false;
      this.boostUntil = 0;
      this.dashUntil = 0;
      this.dashReadyAt = 0;
      this.airDashUntil = 0;
      this.airDashed = false;
      this.dashSpent = false;
      this.crash = null;
      this.transmission = null;
      this.onEvent = onEvent;
      this.randomState = seed >>> 0;
      this.obstacles = [];
      this.openLanes = this.advanced ? [...LANES] : LANES.filter((lane) => lane !== 2);
      this.openingSweeps = seed & 1 ? [...OPENING_SWEEPS] :
        OPENING_SWEEPS.map((row) => row.map((lane) => LANE_COUNT - 1 - lane));
      this.advancedOpening = !this.scripted && clueOpening ? clueOpening.rows.map(({ openLanes, spikes }) => ({
        openLanes: openLanes.map((lane) => seed & 1 ? lane : LANE_COUNT - 1 - lane), spikes,
      })) : [];
      this.advancedOpeningIndex = 0;
      this.id = 0;
      this.introduction = this.advanced ? HAZARD_INTRODUCTIONS.length : 0;
      this.nextSpikes = this.advanced ? 0 : Infinity;
      this.nextClosure = clueOpening ? Math.ceil(forwardEnvelope(this.baseSpeed, clueOpening.closureAfter)) : Infinity;
      this.closure = null;
      this.shortGapDue = false;
      this.nextEncounter = 0;

      const opening = this.scripted ? scenarios[scenario] : this.advanced ? [] : OPENING;
      for (const [z, lane, type, tilesOrLength, lanes] of opening) {
        if (type === 'spikes') this.addSpikes(z, lane, tilesOrLength, lanes);
        else if (type === 'gap' || type === 'short-gap') this.addClosure(z, lane, tilesOrLength, type === 'short-gap');
        else this.addObstacle(z, lane, type);
      }
      const practiceZ = Math.ceil(forwardEnvelope(this.baseSpeed, 2));
      if (scenario === 'platform') {
        this.addObstacle(practiceZ, 2, 'platform', {
          end: practiceZ + Math.ceil(forwardEnvelope(this.upperBaseAt(practiceZ), 1.45)),
          height: PLATFORM_HEIGHT,
        });
      } else if (scenario === 'slide-gate') {
        this.addObstacle(practiceZ, 2, 'slideGate', {
          end: practiceZ + Math.ceil(this.upperBaseAt(practiceZ) * 0.11),
        });
      } else if (scenario === 'moving-barrier') {
        this.addObstacle(practiceZ, 2, 'movingBarrier', { toLane: 3 });
      } else if (scenario === 'black-hole') {
        this.addObstacle(practiceZ, 2, 'blackHole', { direction: -1 });
      } else if (this.scripted) {
        encounters.placePracticeEncounter(this, scenario, practiceZ);
      }
      this.lastHazardEnd ??= this.obstacles.at(-1)?.end ?? this.obstacles.at(-1)?.z ?? 0;
      // Keep the standard opening's approach time even at the advanced launch speed.
      const firstRowAt = this.advanced ? Math.ceil(forwardEnvelope(this.baseSpeed, 1.6)) + ROW_BUFFER : 0;
      this.#anchorCourse();
      this.populate(firstRowAt);
      bolts.init(this, seed);
    }

    addObstacle(z, lane, type, span = {}) {
      if (!this.#planningCourse) this.#clearForecast();
      this.obstacles.push({ id: this.#nextObstacleId++, z, lane, type, ...span });
      this.id = this.#nextObstacleId;
    }

    random() {
      this.randomState = (Math.imul(1664525, this.randomState) + 1013904223) >>> 0;
      return this.randomState / 4294967296;
    }

    #anchorCourse() {
      this.#courseAnchor = { distance: this.distance, speed: this.baseSpeed, time: this.time };
    }

    upperBaseAt(z) {
      if (!this.#planningCourse) {
        return Math.sqrt(this.baseSpeed ** 2 + 2 * ACCELERATION * Math.max(0, z - this.distance));
      }
      const { distance, speed } = this.#courseAnchor;
      const travel = Math.max(0, z - distance);
      // Sustained braking takes the longest to cover a distance, so base speed can rise the most.
      const belowCap = (1 - SLIDE_BRAKE_FRACTION) * Math.max(0, MAX_BRAKE_AT ** 2 - speed ** 2) / (2 * ACCELERATION);
      if (travel < belowCap) return Math.sqrt(speed ** 2 + 2 * ACCELERATION * travel / (1 - SLIDE_BRAKE_FRACTION));
      const brakedSpeed = Math.max(speed, MAX_BRAKE_AT) - MAX_SLIDE_BRAKE;
      return MAX_SLIDE_BRAKE + Math.sqrt(brakedSpeed ** 2 + 2 * ACCELERATION * (travel - belowCap));
    }

    courseTimeAt(z) {
      const { distance, speed, time } = this.#courseAnchor;
      const travel = Math.max(0, z - distance);
      return time + 2 * travel / (speed + Math.sqrt(speed ** 2 + 2 * ACCELERATION * travel));
    }

    get viewDistance() {
      return sightDistance(this.baseSpeed);
    }

    get forecastObstacles() {
      return this.#forecast;
    }

    addSpikes(z, lane, tiles, lanes) {
      // Two tiles exceed the normal jump's travel, including a power slide boost and ground-dash carry.
      const upperSpeed = this.upperBaseAt(z) + BOOST_SPEED;
      const tileLength = Math.ceil((forwardEnvelope(upperSpeed, SPIKE_CLEAR_TIME) + GROUND_DASH_AIR_TRAVEL) / 2);
      const end = z + tileLength * tiles;
      this.addObstacle(z, lane, 'spikes', { tiles, lanes, tileLength, end });
      return end;
    }

    addClosure(z, lane, length, short = false, lanes = 1) {
      const end = z + length;
      this.addObstacle(z, lane, 'gap', lanes === 1 ? { end, short } : { end, short, lanes });
      return end;
    }

    rowClearance(z) {
      return Math.ceil(forwardEnvelope(this.upperBaseAt(z) + MAX_EXTRA_SPEED, REACTION_TIME)) + ROW_BUFFER;
    }

    distanceIn(z, seconds) {
      return Math.ceil(forwardEnvelope(this.upperBaseAt(z) + MAX_EXTRA_SPEED, seconds));
    }

    placeSpikeRow(z, lane, tiles, lanes) {
      this.openLanes = LANES.filter((next) => next < lane || next >= lane + lanes);
      this.lastHazardEnd = this.addSpikes(z, lane, tiles, lanes);
      this.nextSpikes = this.lastHazardEnd + this.distanceIn(this.lastHazardEnd, MIN_SPIKE_INTERVAL + this.random() * 1.5);
    }

    placeClosureRow(z, lane) {
      const seconds = CLOSURE_SECONDS + this.random() * 0.5;
      const end = this.addClosure(z, lane, this.distanceIn(z, seconds));
      this.openLanes = LANES.filter((next) => next !== lane);
      const neighbors = this.openLanes.filter((next) => Math.abs(next - lane) === 1);
      const throughLane = neighbors[Math.floor(this.random() * neighbors.length)];
      this.closure = { lane, throughLane, end };
      this.shortGapDue = true;
      this.nextClosure = end + this.distanceIn(end, MIN_CLOSURE_INTERVAL + this.random() * 1.8);
    }

    populate(firstRowAt = 0) {
      if (!this.endless || (this.transmission && this.transmission.phase !== 'complete')) return;
      const liveEnd = this.distance + this.viewDistance;
      const forecastEnd = this.distance + this.viewDistance * RUNWAY_RANGE_MULTIPLIER;
      // Promote whole generator batches with their original obstacle objects and exit state.
      let rows = 0;
      let count = 0;
      while (rows < this.#forecastRows.length && this.lastHazardEnd < liveEnd) {
        const row = this.#forecastRows[rows++];
        Object.assign(this, row.state);
        count += row.count;
      }
      if (rows) {
        this.#forecastRows.splice(0, rows);
        this.obstacles.push(...this.#forecast.splice(0, count));
      }

      if ((this.#forecastRows.at(-1)?.state.lastHazardEnd ?? this.lastHazardEnd) >= forecastEnd) return;

      this.#planningCourse = true;
      try {
        // Keep the original live horizon. Rows, closures and entire encounters still commit as a unit.
        while (this.lastHazardEnd < liveEnd) {
          this.id = this.#nextObstacleId;
          this.#generateRow(firstRowAt);
        }
        this.#extendForecast(forecastEnd);
      } finally {
        this.#planningCourse = false;
      }
    }

    #courseState() {
      const { id, randomState, introduction, nextSpikes, nextClosure, closure, shortGapDue, lastHazardEnd,
        nextEncounter, openLanes, openingSweeps, advancedOpening, advancedOpeningIndex, encounterHistory } = this;
      return { id, randomState, introduction, nextSpikes, nextClosure, closure, shortGapDue, lastHazardEnd,
        nextEncounter, openLanes, openingSweeps, advancedOpening, advancedOpeningIndex, encounterHistory };
    }

    #clearForecast() {
      this.#forecast.length = 0;
      this.#forecastRows.length = 0;
    }

    #extendForecast(end) {
      // Extend the saved tail with the same generator, then restore the live frontier.
      const live = this.#courseState();
      const obstacles = this.obstacles;
      this.obstacles = obstacles.concat(this.#forecast);
      Object.assign(this, this.#forecastRows.at(-1)?.state);
      try {
        while (this.lastHazardEnd < end) {
          const start = this.obstacles.length;
          this.id = this.#nextObstacleId;
          this.#generateRow(0);
          const added = this.obstacles.slice(start);
          this.#forecast.push(...added);
          this.#forecastRows.push({ state: this.#courseState(), count: added.length });
        }
      } finally {
        this.obstacles = obstacles;
        Object.assign(this, live);
      }
    }

    #generateRow(firstRowAt) {
      const previousEnd = this.lastHazardEnd;
      const gap = this.rowClearance(previousEnd);
      const variation = Math.floor(this.random() * (this.upperBaseAt(previousEnd) + MAX_EXTRA_SPEED) * 0.08);
      const z = Math.max(firstRowAt, previousEnd + gap + variation);
      // Lookahead can generate a row well before the runner reaches its difficulty gate.
      const difficulty = COURSE_DIFFICULTIES.find((stage) =>
        z >= stage.distance || (this.advanced && stage === ADVANCED_OPENING_DIFFICULTY));

      if (this.closure) {
        const { lane, throughLane, end } = this.closure;
        if (end - z >= this.rowClearance(z)) {
          this.lastHazardEnd = z;
          this.addStandardRow(z, difficulty.closureCount, lane, throughLane);
        } else {
          this.lastHazardEnd = end;
          this.openLanes = LANES.filter((next) => next !== lane);
          this.closure = null;
        }
        return;
      }

      this.lastHazardEnd = z;
      const openingRow = this.advancedOpening[this.advancedOpeningIndex];
      if (openingRow) {
        // A promoted opening only needs a few familiar rows before its tier's combinations.
        if (this.advancedOpeningIndex >= 3 && encounters.placeEncounter(this, z)) this.advancedOpening = [];
        else {
          this.addAdvancedOpeningRow(z, openingRow);
          this.advancedOpeningIndex++;
        }
        return;
      }

      const intro = HAZARD_INTRODUCTIONS[this.introduction];
      if (intro && z >= intro.distance) {
        this.introduction++;
        if (intro.type === 'closure') this.placeClosureRow(z, 2);
        else this.placeSpikeRow(z, 2, intro.tiles, intro.lanes);
        return;
      }

      const sweep = intro && this.openingSweeps[0];
      if (sweep) {
        this.openingSweeps = this.openingSweeps.slice(1);
        const [hurdleLane, barrierLane] = sweep;
        this.addObstacle(z, hurdleLane, 'hurdle');
        this.addObstacle(z, barrierLane, 'barrier');
        this.openLanes = LANES.filter((lane) => !sweep.includes(lane));
        return;
      }

      if (previousEnd >= this.nextEncounter && (!intro || this.introduction > 0) && encounters.placeEncounter(this, z)) return;

      if (!intro && (z >= this.nextClosure || this.shortGapDue || z >= this.nextSpikes)) {
        const closure = z >= this.nextClosure;
        const shortGap = !closure && this.shortGapDue;
        const width = !closure && !shortGap && this.random() < difficulty.wideChance ? 2 : 1;
        const candidates = LANES.filter((lane) => lane + width <= LANE_COUNT && this.reachable(
          LANES.filter((next) => next < lane || next >= lane + width)
        ));
        const lane = candidates[Math.floor(this.random() * candidates.length)];
        if (lane !== undefined) {
          if (closure) this.placeClosureRow(z, lane);
          else if (shortGap) {
            const length = Math.floor(this.upperBaseAt(z) * SHORT_GAP_SECONDS);
            this.lastHazardEnd = this.addClosure(z, lane, length, true);
            this.openLanes = LANES.filter((next) => next !== lane);
            this.shortGapDue = false;
          } else this.placeSpikeRow(z, lane, this.random() < difficulty.longChance ? 2 : 1, width);
          return;
        }
      }

      this.addStandardRow(z, difficulty.standardCount);
    }

    addAdvancedOpeningRow(z, { openLanes, spikes }) {
      let blocked = LANES.filter((lane) => !openLanes.includes(lane));
      if (spikes) {
        const [tiles, width] = spikes;
        const starts = blocked.filter((lane) => width === 1 || blocked.includes(lane + 1));
        const start = starts[Math.floor(this.random() * starts.length)];
        this.placeSpikeRow(z, start, tiles, width);
        blocked = blocked.filter((lane) => lane < start || lane >= start + width);
      }
      const single = Math.floor(this.random() * blocked.length);
      const [singleType, otherType] = this.random() < 0.56 ? ['hurdle', 'barrier'] : ['barrier', 'hurdle'];
      for (const [index, lane] of blocked.entries()) {
        this.addObstacle(z, lane, index === single ? singleType : otherType);
      }
      this.openLanes = openLanes;
    }

    addStandardRow(z, [minCount, maxCount], closedLane = -1, throughLane = -1) {
      let open = LANES.filter((lane) => lane !== closedLane);
      const candidates = open.filter((lane) => lane !== throughLane);
      const count = minCount + Math.floor(this.random() * (maxCount - minCount + 1));
      const target = open.length - count;
      while (candidates.length && open.length > target) {
        const pick = Math.floor(this.random() * candidates.length);
        const [lane] = candidates.splice(pick, 1);
        const remaining = open.filter((candidate) => candidate !== lane);
        if (!this.reachable(remaining)) continue;
        open = remaining;
        this.addObstacle(z, lane, this.random() < 0.56 ? 'hurdle' : 'barrier');
      }
      this.openLanes = open;
    }

    reachable(lanes) {
      return this.openLanes.every((previous) => lanes.some((lane) => Math.abs(previous - lane) <= 1));
    }

    requestTransmission(duration = 8, clueNumber = 1) {
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new RangeError('Transmission duration must be finite and positive');
      }
      if (!Number.isInteger(clueNumber) || clueNumber < 1 || clueNumber > this.#transmissionCount ||
        this.#requestedTransmissions.has(clueNumber) || this.crash ||
        (this.transmission && this.transmission.phase !== 'complete')) return false;
      this.#clearForecast();
      this.#transmissionClearAfter = this.obstacles.reduce((edge, obstacle) => {
        // Gaps stop colliding at the runner's center. Playback waits for its rear to clear the lip.
        const rearClearance = obstacle.type === 'gap' ? PLAYER_HALF_DEPTH : 0;
        return Math.max(edge, farCollisionEdge(obstacle) + rearClearance);
      }, -Infinity);
      this.#requestedTransmissions.add(clueNumber);
      this.#transmissionTicks = 0;
      this.transmission = { phase: 'draining', elapsed: 0, duration };
      return true;
    }

    resumeCourse() {
      // Start the first row beyond the full view horizon and leave room for its front collider.
      this.#clearForecast();
      this.#anchorCourse();
      const firstRowAt = this.distance + this.viewDistance + ROW_BUFFER;
      this.lastHazardEnd = this.distance;
      this.openLanes = [...LANES];
      this.openingSweeps = [];
      this.advancedOpening = [];
      this.closure = null;
      this.shortGapDue = false;
      // Re-enter through ordinary rows before a committed sequence. Stacked clues can drain this short section.
      this.nextEncounter = firstRowAt + this.distanceIn(firstRowAt, VIEW_SECONDS + REACTION_TIME);
      this.nextSpikes = Math.max(this.nextSpikes, firstRowAt + this.distanceIn(firstRowAt, MIN_SPIKE_INTERVAL));
      this.nextClosure = Math.max(this.nextClosure, firstRowAt + this.distanceIn(firstRowAt, MIN_CLOSURE_INTERVAL));
      this.populate(firstRowAt);
    }

    updateCourse() {
      const transmission = this.transmission;
      if (!transmission || transmission.phase === 'complete') {
        this.populate();
      } else if (transmission.phase === 'draining') {
        if (this.distance > this.#transmissionClearAfter) transmission.phase = 'playing';
      } else {
        transmission.elapsed = Math.min(transmission.duration, ++this.#transmissionTicks * STEP);
        if (transmission.elapsed === transmission.duration) {
          transmission.phase = 'complete';
          if (this.endless) this.resumeCourse();
        }
      }
    }

    move(direction) {
      if (this.crash) return;
      const lane = Math.min(LANE_COUNT - 1, Math.max(0, this.lane + Math.sign(direction)));
      if (lane === this.lane) return;
      this.lane = lane;
    }

    touchdownIn() {
      if (!this.airborne) return 0;
      const glide = Math.max(0, this.airDashUntil - this.time);
      let earliest = glide + fallTime(this.height, this.verticalSpeed);
      const apex = this.height + Math.max(0, this.verticalSpeed) ** 2 / (2 * GRAVITY);
      const target = laneX(this.lane);
      const positionAt = (seconds) => ({
        x: target + (this.x - target) * Math.exp(-23 * seconds),
        z: this.distance + forwardEnvelope(this.speed, seconds),
      });
      for (const obstacle of this.obstacles) {
        const top = solidTop(obstacle);
        const allowance = obstacle.type === 'platform' ? 0 : SOLID_TOP_ALLOWANCE;
        if (top === undefined || top - allowance > apex) continue;
        const toTop = fallTime(this.height - top, this.verticalSpeed);
        const seconds = glide + Math.max(0, toTop);
        if (seconds >= earliest) continue;
        const last = Math.min(earliest, glide + fallTime(this.height - top + allowance, this.verticalSpeed));
        const from = positionAt(seconds);
        if (from.z >= farCollisionEdge(obstacle)) continue;
        const sweep = horizontalSweep(obstacle, from, positionAt(last), this.time + seconds, this.time + last);
        if (sweep && (toTop >= 0 || sweep.enter > 0)) earliest = seconds + (last - seconds) * sweep.enter;
      }
      return earliest;
    }

    #slideLanding() {
      if (this.verticalSpeed >= 0 || this.time < this.airDashUntil) return null;
      // Follow the same substeps as the live sweep until the feet leave the clearance band.
      const lowestTop = Math.max(0, this.height - SLIDE_ARM_CLEARANCE);
      let from = { x: this.x, y: this.height, z: this.distance };
      let time = this.time;
      let baseSpeed = this.baseSpeed;
      let broken;
      const flight = { airborne: true, verticalSpeed: this.verticalSpeed, airDashUntil: this.airDashUntil };
      while (from.y >= lowestTop) {
        const nextTime = time + STEP;
        baseSpeed += ACCELERATION * STEP;
        const to = this.#stepPosition(from, this.#stepSpeed(nextTime, baseSpeed, from.z));
        const sweeps = this.#stepSweeps(from, to, time, nextTime, broken);
        const motion = verticalSweep(flight, from, sweeps.filter(({ top }) => top !== undefined), time);
        const landing = motion.landings[0];
        if (landing && landing.height < lowestTop) return null;
        const touchdown = landing?.at ?? Infinity;
        for (const sweep of sweeps) {
          const { obstacle } = sweep;
          if (obstacle.type === 'blackHole') continue;
          // The runner can duck a gate from touchdown onward. Earlier impacts still count.
          const at = contactFraction(sweep, from, to, motion, touchdown, Infinity);
          if (at === null || at > touchdown) continue;
          if (broken || !this.#canBreakBarrier(obstacle, time + STEP * at)) return null;
          broken = obstacle;
        }
        if (landing) return landing;
        from = { ...to, y: motion.y };
        flight.verticalSpeed = motion.velocity;
        time = nextTime;
      }
      return null;
    }

    get queuedSlide() { return this.#queuedSlide !== null; }

    get slideWindowOpen() {
      if (this.crash || this.sliding) return false;
      return this.airborne ? !this.queuedSlide && this.#slideLanding() !== null : this.#landingSlide !== null;
    }

    get sliding() { return this.distance < this.slideEndDistance || this.#slideGates.size > 0; }
    get braking() { return this.distance < this.slideEndDistance && this.slideSlows; }
    get boosting() { return this.time < this.boostUntil; }
    get dashing() { return this.time < this.dashUntil; }
    get dashCharge() { return Math.max(0, Math.min(1, 1 - (this.dashReadyAt - this.time) / DASH_COOLDOWN)); }

    spikeJumpLead(patch) {
      const speed = this.baseSpeed + (this.boosting ? BOOST_SPEED : 0);
      if (patch.tiles === 2) return speed * 0.23;
      return Math.max(speed * 0.10, speed * (SPIKE_DESCENT_TIME - 0.035) - patch.tileLength - PLAYER_HALF_DEPTH * 2);
    }

    jump() {
      if (this.crash || this.airborne) return;
      for (const gate of this.#slideGates) {
        if (this.distance >= slideGateBounds(gate).front) return;
      }
      this.slideEndDistance = -Infinity;
      this.#slideGates.clear();
      this.#landingSlide = null;
      this.airborne = true;
      this.airDashed = false;
      this.verticalSpeed = JUMP_SPEED;
    }

    slide() {
      if (this.crash || this.sliding) return;
      if (this.airborne) {
        this.#queuedSlide ??= this.#slideLanding();
      } else if (this.slideWindowOpen) {
        this.powerSlide();
      } else {
        this.#startSlide(true);
      }
    }

    #startSlide(slows) {
      this.slideEndDistance = this.distance + SLIDE_DISTANCE;
      this.slideSlows = slows;
    }

    powerSlide() {
      this.#landingSlide = null;
      this.#startSlide(false);
      this.boostUntil = this.time + BOOST_TIME;
      this.onEvent('boost');
    }

    dash() {
      if (this.crash || this.dashing || this.time < this.dashReadyAt) return;
      this.dashUntil = this.time + DASH_TIME;
      this.dashReadyAt = this.time + DASH_COOLDOWN;
      this.airDashUntil = this.airborne ? this.time + AIR_DASH_GLIDE : 0;
      if (this.airborne) {
        this.airDashed = true;
        // Holding height changes the landing that the slide was queued for.
        this.#queuedSlide = null;
      }
      this.dashSpent = false;
      this.onEvent('dash');
    }

    #stepSpeed(time, baseSpeed, distance) {
      const boost = time < this.boostUntil ? BOOST_SPEED : 0;
      const dash = time < this.dashUntil ? DASH_SPEED * Math.sqrt((this.dashUntil - time) / DASH_TIME) : 0;
      const airCarry = this.airborne && !this.airDashUntil ? GROUND_DASH_AIR_SPEED : 1;
      const speed = baseSpeed + boost + dash * airCarry;
      if (!this.slideSlows || distance >= this.slideEndDistance) return speed;
      const brake = Math.min(baseSpeed * SLIDE_BRAKE_FRACTION, MAX_SLIDE_BRAKE);
      const brakingTime = (this.slideEndDistance - distance) / (speed - brake);
      return speed - brake * Math.min(1, brakingTime / STEP);
    }

    #stepPosition(from, speed) {
      return { x: from.x + (laneX(this.lane) - from.x) * STEER_FRACTION, z: from.z + speed * STEP };
    }

    #stepSweeps(from, to, startTime, endTime, ignored) {
      const sweeps = [];
      for (const obstacle of this.obstacles) {
        if (obstacle.z > to.z + BLACK_HOLE_HALF_DEPTH + PLAYER_HALF_DEPTH) break;
        if (obstacle === ignored) continue;
        const sweep = horizontalSweep(obstacle, from, to, startTime, endTime);
        if (sweep) sweeps.push(sweep);
      }
      return sweeps;
    }

    #canBreakBarrier(obstacle, time) {
      return (obstacle.type === 'barrier' || obstacle.type === 'movingBarrier') &&
        !this.dashSpent && time < this.dashUntil;
    }

    #gateCrouch(from, to, beams, slideStart, nominalEnd) {
      let end = nominalEnd;
      const engaged = new Set();
      if (nominalEnd < 0 && !this.#slideGates.size) return { end, engaged };

      const claimed = new Set();
      for (const obstacle of this.obstacles) {
        if (obstacle.type !== 'slideGate') continue;
        const { approach, back, left, right } = slideGateBounds(obstacle);
        const sweep = intersectIntervals(axisInterval(from.z, to.z, approach, back), axisInterval(from.x, to.x, left, right));
        if (!sweep || sweep.exit === 0) continue;
        if (this.#slideGates.has(obstacle) || (sweep.enter <= nominalEnd && sweep.exit >= slideStart)) {
          claimed.add(obstacle);
          end = Math.max(end, sweep.exit);
          if (sweep.exit === 1) engaged.add(obstacle);
        }
      }
      // An approach needs a fresh slide. Beams that physically overlap can share an existing crouch.
      let beamEnd = -Infinity;
      for (const { obstacle, enter, exit } of beams) {
        if (exit < slideStart || exit === 0) continue;
        if (!claimed.has(obstacle) && enter > beamEnd) continue;
        beamEnd = Math.max(beamEnd, exit);
        end = Math.max(end, exit);
        if (exit === 1) engaged.add(obstacle);
      }
      return { end, engaged };
    }

    tick() {
      if (this.crash) return;
      if (this.queuedSlide) {
        const target = this.#slideLanding();
        if (!target || target.surface !== this.#queuedSlide.surface) this.#queuedSlide = null;
      }
      const startTime = this.time;
      this.time += STEP;
      this.baseSpeed += ACCELERATION * STEP;
      this.speed = this.#stepSpeed(this.time, this.baseSpeed, this.distance);
      const from = { x: this.x, y: this.height, z: this.distance };
      const to = this.#stepPosition(from, this.speed);
      const sweeps = this.#stepSweeps(from, to, startTime, this.time);
      const supports = sweeps.filter(({ top }) => top !== undefined);
      const motion = verticalSweep(this, from, supports, startTime);
      to.y = motion.y;
      const landing = motion.landings[0];
      const startsSlide = landing && this.#queuedSlide && landing.surface === this.#queuedSlide.surface;
      const slideStart = startsSlide ? landing.at : -Infinity;
      const travel = to.z - from.z;
      const nominalEnd = startsSlide ? slideStart + SLIDE_DISTANCE / travel : (this.slideEndDistance - from.z) / travel;
      const gates = sweeps.filter(({ obstacle }) => obstacle.type === 'slideGate').sort((a, b) => a.enter - b.enter);
      const { end: slideEnd, engaged } = this.#gateCrouch(from, to, gates, slideStart, nominalEnd);
      const pickupMotion = { segments: motion.segments, slideStart, slideEnd, step: STEP };
      const contacts = [];
      for (const sweep of sweeps) {
        const at = contactFraction(sweep, from, to, motion, slideStart, slideEnd);
        if (at !== null) contacts.push({ obstacle: sweep.obstacle, at });
      }
      // A collision at touchdown takes precedence over queued landing effects.
      contacts.push(...motion.landings);
      contacts.sort((first, second) => first.at - second.at);
      for (const contact of contacts) {
        const { obstacle, at, height, surface } = contact;
        const x = from.x + (to.x - from.x) * at;
        const z = from.z + (to.z - from.z) * at;
        if (!obstacle) {
          this.x = x;
          this.height = height;
          this.distance = z;
          this.verticalSpeed = 0;
          this.airborne = false;
          this.onEvent('land');
          this.#queuedSlide = null;
          if (startsSlide && contact === landing) this.powerSlide();
          else this.#landingSlide = { surface, end: z + SLIDE_LANDING_TRAVEL };
          continue;
        }
        const segment = motion.segments.findLast(({ start }) => start <= at);
        const y = heightIn(segment, at);
        if (obstacle.type === 'blackHole') {
          obstacle.triggered = true;
          this.move(obstacle.direction);
          this.onEvent('black-hole', { ...obstacle, impact: { x, y, z } });
          continue;
        }
        const movingBarrier = obstacle.type === 'movingBarrier';
        const impactTime = startTime + STEP * at;
        if (this.#canBreakBarrier(obstacle, impactTime)) {
          this.dashSpent = true;
          this.obstacles = this.obstacles.filter((other) => other !== obstacle);
          const { halfWidth, halfDepth } = obstacles.barrier;
          const middle = movingBarrier ? movingBarrierX(obstacle, impactTime) : laneX(obstacle.lane);
          const impact = {
            x: Math.max(middle - halfWidth, Math.min(middle + halfWidth, x)),
            y,
            z: Math.max(obstacle.z - halfDepth, Math.min(obstacle.z + halfDepth, z)),
          };
          this.onEvent('break', { ...obstacle, impact });
          continue;
        }

        this.x = x;
        this.height = y;
        this.distance = z;
        this.verticalSpeed = segment.velocity - segment.gravity * (at - segment.start) * STEP;
        this.airborne = !segment.grounded;
        this.crash = obstacle;
        this.#queuedSlide = null;
        this.#landingSlide = null;
        bolts.update(this, from, { x, y, z }, startTime, impactTime, pickupMotion);
        this.onEvent('crash', { ...obstacle, impact: { x, y, z }, impactTime });
        return;
      }

      this.x = to.x;
      this.height = to.y;
      this.distance = to.z;
      this.verticalSpeed = motion.velocity;
      this.airborne = motion.airborne;
      if (this.#landingSlide) {
        const { surface, end } = this.#landingSlide;
        if (this.airborne || this.distance > end ||
          (surface && !supports.some(({ obstacle, exit }) => obstacle === surface && exit === 1))) {
          this.#landingSlide = null;
        }
      }
      for (const gate of engaged) {
        const { left, right, back } = slideGateBounds(gate);
        if (to.y + SLIDING_HEIGHT >= SLIDE_GATE_CLEARANCE || to.z >= back || to.x <= left || to.x >= right) {
          engaged.delete(gate);
        }
      }
      this.#slideGates = engaged;
      const oldest = this.obstacles[0];
      const rearLimit = this.distance - this.viewDistance * 0.15;
      if ((oldest?.end ?? oldest?.z) < rearLimit) {
        this.obstacles = this.obstacles.filter((obstacle) => (obstacle.end ?? obstacle.z) >= rearLimit);
      }
      this.updateCourse();
      bolts.update(this, from, to, startTime, this.time, pickupMotion);
    }
  }

  const api = { Run, STEP, LANE_WIDTH, LANE_COUNT, START_SPEED, ENDLESS_START_SPEED, ADVANCED_START_SPEED, FAST_START_SPEED,
    MAX_EXTRA_SPEED, REACTION_TIME, MIN_VIEW_DISTANCE, VIEW_SECONDS, RUNWAY_RANGE_MULTIPLIER, SPIKE_HEIGHT, PLATFORM_HEIGHT, PLATFORM_HALF_WIDTH,
    SLIDE_GATE_CLEARANCE, SLIDE_GATE_HEIGHT, SLIDE_GATE_HALF_WIDTH, BLACK_HOLE_HALF_WIDTH, BLACK_HOLE_HALF_DEPTH,
    SLIDE_DISTANCE, slideGateBounds, laneX, movingBarrierX, obstacles, boltPositionAt: bolts.positionAt };
  if (commonJS) module.exports = api;
  else globalThis.VoidRunner = api;
})();
