(function () {
  'use strict';

  const LANE_COUNT = 5;
  const LANE_WIDTH = 2.5;
  const START_SPEED = 32;
  const FAST_START_SPEED = 64;
  const HIGH_SPEED_QA = 572;
  const ACCELERATION = 1.8;
  const STEP = 1 / 120;
  const GRAVITY = 23;
  const JUMP_SPEED = 9.8;
  const SLIDE_EARLY = 0.13;
  const SLIDE_LATE = 0.09;
  const SLIDE_TIME = 0.34;
  const SLIDE_BRAKE_FRACTION = 0.08;
  const MAX_SLIDE_BRAKE = 12;
  const BOOST_TIME = 0.85;
  const BOOST_SPEED = 15;
  const DASH_TIME = 0.7;
  const DASH_SPEED = 22;
  const DASH_COOLDOWN = 0.95;
  const AIR_DASH_GLIDE = 0.60;
  const GROUND_DASH_AIR_SPEED = 0.5;
  const PLAYER_HALF_WIDTH = 0.24;
  const PLAYER_HALF_DEPTH = 0.36;
  const SPIKE_HEIGHT = 0.52;
  const SPIKE_CLEAR_TIME = 2 * Math.sqrt(JUMP_SPEED ** 2 - 2 * GRAVITY * SPIKE_HEIGHT) / GRAVITY;
  const SPIKE_DESCENT_TIME = (JUMP_SPEED / GRAVITY) + SPIKE_CLEAR_TIME / 2;
  const GROUND_DASH_AIR_TRAVEL = DASH_SPEED * DASH_TIME * (2 / 3) * GROUND_DASH_AIR_SPEED;
  const SPIKES_INTRO = 360;
  const CLOSURES_INTRO = 670;
  const MAX_EXTRA_SPEED = BOOST_SPEED + DASH_SPEED;
  const CLOSURE_SECONDS = 3;
  const MIN_VIEW_DISTANCE = 186;
  const VIEW_SECONDS = 2.6;
  const REACTION_TIME = 0.86;
  const ROW_BUFFER = 3;
  const LANES = Array.from({ length: LANE_COUNT }, (_, lane) => lane);

  const obstacles = {
    hurdle: { height: 0.71, halfDepth: 0.25, halfWidth: 0.96 },
    barrier: { height: 2.48, halfDepth: 0.32, halfWidth: 0.99 },
    roadblock: { height: 2.2, depth: 0.72, width: 2.46 },
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
    camera: [[1180, 2, 'barrier']],
    'high-speed': [[620, 2, 'hurdle'], [1240, 0, 'gap', 2000], [2350, 2, 'barrier'], [3920, 1, 'spikes', 2, 2]],
    landing: [],
  };

  function laneX(lane) {
    return (lane - 2) * LANE_WIDTH;
  }

  function forwardEnvelope(speed, seconds) {
    // The step-sized term covers forward integration at the end of a tick.
    return seconds * (speed + ACCELERATION * (seconds / 2 + STEP));
  }

  function sightDistance(baseSpeed) {
    return Math.max(MIN_VIEW_DISTANCE, forwardEnvelope(baseSpeed + MAX_EXTRA_SPEED, VIEW_SECONDS));
  }

  function randomFor(seed) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 4294967296;
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

  function contactFraction(obstacle, from, to) {
    const x = laneX(obstacle.lane);
    const shape = obstacles[obstacle.type];
    let near = obstacle.z;
    let far = obstacle.end ?? near;
    let left = x - LANE_WIDTH / 2;
    let right = x + LANE_WIDTH / 2;
    let height = Infinity;

    switch (obstacle.type) {
      case 'gap':
        // The runner falls when its center enters a missing lane before the far lip.
        if (from.z >= far) return null;
        break;
      case 'spikes':
        near -= PLAYER_HALF_DEPTH;
        far += PLAYER_HALF_DEPTH;
        left += 0.10 - PLAYER_HALF_WIDTH;
        right += (obstacle.lanes - 1) * LANE_WIDTH - 0.10 + PLAYER_HALF_WIDTH;
        height = SPIKE_HEIGHT;
        break;
      case 'roadblock':
        near -= PLAYER_HALF_DEPTH;
        far += shape.depth + PLAYER_HALF_DEPTH;
        break;
      default:
        near -= shape.halfDepth + PLAYER_HALF_DEPTH;
        far += shape.halfDepth + PLAYER_HALF_DEPTH;
        left = x - shape.halfWidth - PLAYER_HALF_WIDTH;
        right = x + shape.halfWidth + PLAYER_HALF_WIDTH;
        height = shape.height;
    }

    const z = axisInterval(from.z, to.z, near, far);
    if (!z) return null;
    const horizontal = axisInterval(from.x, to.x, left, right);
    const vertical = axisInterval(from.y, to.y, 0, height);
    if (!horizontal || !vertical) return null;
    const entry = Math.max(z[0], horizontal[0], vertical[0]);
    if (obstacle.type === 'gap' && from.z + (to.z - from.z) * entry >= far) return null;
    return entry <= Math.min(z[1], horizontal[1], vertical[1]) ? entry : null;
  }

  class Run {
    constructor({ seed = Date.now(), scenario = '', pace = '', onEvent = () => {} } = {}) {
      this.scripted = Object.hasOwn(scenarios, scenario);
      this.distance = 0;
      this.time = 0;
      this.baseSpeed = START_SPEED;
      if (this.scripted && pace === 'fast') this.baseSpeed = FAST_START_SPEED;
      else if (scenario === 'high-speed') this.baseSpeed = HIGH_SPEED_QA;
      this.speed = this.baseSpeed;
      this.lane = 2;
      this.x = 0;
      this.height = 0;
      this.verticalSpeed = 0;
      this.airborne = false;
      this.queuedSlide = false;
      this.landingSlideUntil = -1;
      this.slideUntil = 0;
      this.slideSlows = false;
      this.boostUntil = 0;
      this.dashUntil = 0;
      this.dashReadyAt = 0;
      this.airDashUntil = 0;
      this.airDashed = false;
      this.dashSpent = false;
      this.crash = null;
      this.onEvent = onEvent;
      this.random = randomFor(seed);
      this.obstacles = [];
      this.openLanes = LANES.filter((lane) => lane !== 2);
      this.id = 0;
      this.nextSpikes = SPIKES_INTRO;
      this.nextClosure = CLOSURES_INTRO;
      this.closure = null;

      const opening = this.scripted ? scenarios[scenario] : [[78, 2, 'hurdle'], [165, 2, 'barrier']];
      for (const [z, lane, type, tilesOrLength, lanes] of opening) {
        if (type === 'spikes') this.addSpikes(z, lane, tilesOrLength, lanes);
        else if (type === 'gap') this.addClosure(z, lane, tilesOrLength);
        else this.addObstacle(z, lane, type);
      }
      this.lastHazardEnd = this.obstacles.at(-1)?.end ?? this.obstacles.at(-1)?.z ?? 0;
      this.populate();
    }

    addObstacle(z, lane, type, span = {}) {
      this.obstacles.push({ id: this.id++, z, lane, type, ...span });
    }

    upperBaseAt(z) {
      return Math.sqrt(this.baseSpeed ** 2 + 2 * ACCELERATION * Math.max(0, z - this.distance));
    }

    get viewDistance() {
      return sightDistance(this.baseSpeed);
    }

    addSpikes(z, lane, tiles, lanes) {
      // Two tiles exceed the normal jump's travel, including a power slide boost and ground-dash carry.
      const upperSpeed = this.upperBaseAt(z) + BOOST_SPEED;
      const tileLength = Math.ceil((forwardEnvelope(upperSpeed, SPIKE_CLEAR_TIME) + GROUND_DASH_AIR_TRAVEL) / 2);
      const end = z + tileLength * tiles;
      this.addObstacle(z, lane, 'spikes', { tiles, lanes, tileLength, end });
      return end;
    }

    addClosure(z, lane, length) {
      this.addObstacle(z, lane, 'roadblock');
      this.addObstacle(z, lane, 'gap', { end: z + length });
      return z + length;
    }

    rowClearance(z) {
      return Math.ceil(forwardEnvelope(this.upperBaseAt(z) + MAX_EXTRA_SPEED, REACTION_TIME)) + ROW_BUFFER;
    }

    distanceIn(z, seconds) {
      return Math.ceil(forwardEnvelope(this.upperBaseAt(z) + MAX_EXTRA_SPEED, seconds));
    }

    populate() {
      if (this.scripted) return;
      while (this.lastHazardEnd < this.distance + this.viewDistance) {
        const previousEnd = this.lastHazardEnd;
        const gap = this.rowClearance(previousEnd);
        const variation = Math.floor(this.random() * (this.upperBaseAt(previousEnd) + MAX_EXTRA_SPEED) * 0.08);
        const z = previousEnd + gap + variation;

        if (this.closure) {
          const { lane, throughLane, end } = this.closure;
          if (end - z >= this.rowClearance(z)) {
            this.lastHazardEnd = z;
            this.addStandardRow(z, lane, throughLane);
          } else {
            this.lastHazardEnd = end;
            this.openLanes = LANES.filter((next) => next !== lane);
            this.closure = null;
          }
          continue;
        }

        this.lastHazardEnd = z;

        if (z >= this.nextClosure || z >= this.nextSpikes) {
          const closure = z >= this.nextClosure;
          const introduced = this.nextSpikes !== SPIKES_INTRO;
          const width = !closure && introduced && this.random() < 0.6 ? 2 : 1;
          const candidates = LANES.filter((lane) => lane + width <= LANE_COUNT && this.reachable(
            LANES.filter((next) => next < lane || next >= lane + width)
          ));
          const lane = candidates[Math.floor(this.random() * candidates.length)];
          if (lane !== undefined) {
            this.openLanes = LANES.filter((next) => next < lane || next >= lane + width);
            if (closure) {
              const seconds = CLOSURE_SECONDS + this.random() * 0.5;
              const end = this.addClosure(z, lane, this.distanceIn(z, seconds));
              const neighbors = this.openLanes.filter((next) => Math.abs(next - lane) === 1);
              const throughLane = neighbors[Math.floor(this.random() * neighbors.length)];
              this.closure = { lane, throughLane, end };
              this.nextClosure = end + this.distanceIn(end, 3.55 + this.random() * 1.8);
            } else {
              const tiles = introduced && this.random() < 0.7 ? 2 : 1;
              this.lastHazardEnd = this.addSpikes(z, lane, tiles, width);
              this.nextSpikes = this.lastHazardEnd + this.distanceIn(this.lastHazardEnd, 1.1 + this.random() * 1.5);
            }
            continue;
          }
        }

        this.addStandardRow(z);
      }
    }

    addStandardRow(z, closedLane = -1, throughLane = -1) {
      let open = LANES.filter((lane) => lane !== closedLane);
      const candidates = open.filter((lane) => lane !== throughLane);
      const count = closedLane >= 0 ? 1 + Math.floor(this.random() * 2) :
        2 + Math.floor(this.random() * (z > 340 ? 3 : 2));
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

    move(direction) {
      if (this.crash) return;
      const lane = Math.min(LANE_COUNT - 1, Math.max(0, this.lane + Math.sign(direction)));
      if (lane === this.lane) return;
      this.lane = lane;
    }

    touchdownIn() {
      if (!this.airborne) return 0;
      return Math.max(0, this.airDashUntil - this.time) +
        (this.verticalSpeed + Math.sqrt(this.verticalSpeed ** 2 + 2 * GRAVITY * this.height)) / GRAVITY;
    }

    get slideWindowOpen() {
      if (this.crash) return false;
      if (this.airborne) return !this.queuedSlide && this.verticalSpeed < 0 && this.touchdownIn() <= SLIDE_EARLY;
      return this.time <= this.landingSlideUntil;
    }

    get sliding() { return this.time < this.slideUntil; }
    get braking() { return this.sliding && this.slideSlows; }
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
      this.slideUntil = this.time;
      this.landingSlideUntil = -1;
      this.airborne = true;
      this.airDashed = false;
      this.verticalSpeed = JUMP_SPEED;
    }

    slide() {
      if (this.crash || this.sliding) return;
      if (this.airborne) {
        if (this.slideWindowOpen) this.queuedSlide = true;
      } else if (this.slideWindowOpen) {
        this.powerSlide();
      } else {
        this.slideUntil = this.time + SLIDE_TIME;
        this.slideSlows = true;
      }
    }

    powerSlide() {
      this.landingSlideUntil = -1;
      this.slideUntil = this.time + SLIDE_TIME;
      this.slideSlows = false;
      this.boostUntil = this.time + BOOST_TIME;
      this.onEvent('boost');
    }

    dash() {
      if (this.crash || this.time < this.dashReadyAt) return;
      this.dashUntil = this.time + DASH_TIME;
      this.dashReadyAt = this.time + DASH_COOLDOWN;
      this.airDashUntil = this.airborne ? this.time + AIR_DASH_GLIDE : 0;
      if (this.airborne) {
        this.airDashed = true;
        // Extending the flight changes the touchdown this request was timed for.
        this.queuedSlide = false;
      }
      this.dashSpent = false;
      this.onEvent('dash');
    }

    tick() {
      if (this.crash) return;
      const startTime = this.time;
      this.time += STEP;
      this.baseSpeed += ACCELERATION * STEP;
      const boost = this.boosting ? BOOST_SPEED : 0;
      const dash = this.dashing ? DASH_SPEED * Math.sqrt((this.dashUntil - this.time) / DASH_TIME) : 0;
      const airCarry = this.airborne && !this.airDashUntil ? GROUND_DASH_AIR_SPEED : 1;
      const brake = this.braking ? Math.min(this.baseSpeed * SLIDE_BRAKE_FRACTION, MAX_SLIDE_BRAKE) : 0;
      this.speed = this.baseSpeed + boost + dash * airCarry - brake;
      const from = { x: this.x, y: this.height, z: this.distance };
      const to = { x: this.x + (laneX(this.lane) - this.x) * (1 - Math.exp(-23 * STEP)),
        y: this.height, z: this.distance + this.speed * STEP };
      if (this.airborne) {
        const fallingTime = STEP - Math.max(0, Math.min(STEP, this.airDashUntil - startTime));
        to.y = Math.max(0, from.y + this.verticalSpeed * fallingTime - GRAVITY * fallingTime ** 2 / 2);
        this.verticalSpeed -= GRAVITY * fallingTime;
      }

      const contacts = [];
      for (const obstacle of this.obstacles) {
        if (obstacle.z > to.z + 0.75) break;
        const at = contactFraction(obstacle, from, to);
        if (at !== null) contacts.push({ obstacle, at });
      }
      contacts.sort((first, second) => first.at - second.at);
      for (const { obstacle, at } of contacts) {
        const x = from.x + (to.x - from.x) * at;
        const y = from.y + (to.y - from.y) * at;
        const z = from.z + (to.z - from.z) * at;
        if (obstacle.type === 'barrier' && !this.dashSpent && startTime + STEP * at < this.dashUntil) {
          this.dashSpent = true;
          this.obstacles = this.obstacles.filter((other) => other !== obstacle);
          const { halfWidth, halfDepth } = obstacles.barrier;
          const middle = laneX(obstacle.lane);
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
        this.crash = obstacle;
        this.queuedSlide = false;
        this.landingSlideUntil = -1;
        this.onEvent('crash', { ...obstacle, impact: { x, y, z } });
        return;
      }

      this.x = to.x;
      this.height = to.y;
      this.distance = to.z;
      if (this.airborne && this.height === 0 && this.verticalSpeed <= 0) {
        this.verticalSpeed = 0;
        this.airborne = false;
        this.onEvent('land');
        if (this.queuedSlide) this.powerSlide();
        else this.landingSlideUntil = this.time + SLIDE_LATE;
        this.queuedSlide = false;
      }
      const oldest = this.obstacles[0];
      const rearLimit = this.distance - this.viewDistance * 0.15;
      if ((oldest?.end ?? oldest?.z) < rearLimit) {
        this.obstacles = this.obstacles.filter((obstacle) => (obstacle.end ?? obstacle.z) >= rearLimit);
      }
      this.populate();
    }
  }

  const api = { Run, STEP, LANE_WIDTH, LANE_COUNT, START_SPEED, FAST_START_SPEED, MAX_EXTRA_SPEED, REACTION_TIME,
    MIN_VIEW_DISTANCE, VIEW_SECONDS, SPIKE_HEIGHT, laneX, obstacles };
  if (typeof module !== 'undefined') module.exports = api;
  else globalThis.VoidRunner = api;
})();
