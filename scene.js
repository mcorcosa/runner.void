(function () {
  'use strict';

  const {
    LANE_WIDTH, LANE_COUNT, START_SPEED, MIN_VIEW_DISTANCE, SPIKE_HEIGHT,
    PLATFORM_HEIGHT, PLATFORM_HALF_WIDTH, SLIDE_GATE_CLEARANCE, SLIDE_GATE_HEIGHT, SLIDE_GATE_HALF_WIDTH,
    BLACK_HOLE_HALF_WIDTH, movingBarrierX, laneX, obstacles,
  } = globalThis.VoidRunner;
  const { PULSE_LEAD } = globalThis.VoidEpisode;
  const ROAD_HALF = LANE_WIDTH * LANE_COUNT / 2;
  const TILE = 6;
  const FAR_TILES = 36;
  const MARKING_TILES = 24;
  const REFLECTOR_SPACING = 10;
  const REFLECTOR_CADENCE = 5.5;
  const PACE_LINES = 16;
  const OBSTACLE_VIEW_FRACTION = 0.9;
  const CUT_DEPTH = 2.15;
  const SLIDE_BURST_TIME = 0.36;
  const DASH_WAKE = 4.55;
  const SLIDE_WAKE = 3.15;
  const SHORT_WAKE = 1.2;
  const NEAR = 1.3;
  const PITCH = 0.207;
  const SIN = Math.sin(PITCH);
  const COS = Math.cos(PITCH);

  const steel = ['#ada4d5', '#4b426a', '#80739f'];
  const violet = ['#aa89f4', '#36274f', '#624693'];
  const suit = ['#63558c', '#252036', '#3f345a'];
  const amber = ['#ffd18b', '#a65a3a', '#d58b53'];
  const pink = ['#e49aff', '#823c9c', '#a65ac1'];
  const railMount = ['#dec6fb', '#594373', '#3d2e55'];
  const platformPalette = ['#465d79', '#294053', '#2d435d', '#9be1db'];
  const gatePalette = ['#774252', '#653241', '#4d2c45', '#ffa48e'];

  const deathPalettes = {
    hurdle: ['#ffe1a8', '#ffad65', '#9b492d', '#472638'],
    barrier: ['#f7d1ff', '#de92fc', '#8740a7', '#3b204e'],
    movingBarrier: ['#c2f6ff', '#6ddaff', '#3c7db7', '#263659'],
    slideGate: ['#ffe1cb', '#ff998b', '#a84c61', '#50283f'],
    spikes: ['#ffc4cb', '#ff5a78', '#9f324f', '#4d192f'],
    gap: ['#e4daff', '#ad92f9', '#63549c', '#292544'],
    platform: ['#c7fff1', '#77e7d3', '#377e80', '#203846'],
  };
  // Separate suit plates leave a recognizable helmet, core and boots as the seams open.
  const deathArmor = [
    [[-.34, 1.48], [-.34, 1.91], [-.25, 2.07], [.25, 2.07], [.34, 1.91], [.34, 1.48]],
    [[-.46, 1.39], [.14, 1.40], [.06, 1.08], [-.14, .99], [-.06, .89], [-.39, .78], [-.46, .99]],
    [[.14, 1.40], [.46, 1.39], [.46, .83], [.21, .66], [-.34, .66], [-.39, .78],
      [-.06, .89], [-.14, .99], [.06, 1.08]],
    [[-.77, 1.29], [-.50, 1.38], [-.48, 1.17], [-.54, .76], [-.76, .68], [-.83, .85]],
    [[.77, 1.29], [.50, 1.38], [.48, 1.17], [.54, .76], [.76, .68], [.83, .85]],
    [[-.43, .65], [-.06, .65], [-.09, .22], [-.03, .02], [-.43, .02], [-.47, .22]],
    [[.43, .65], [.06, .65], [.09, .22], [.03, .02], [.43, .02], [.47, .22]],
  ];
  const gateBands = [0, .47, .93, 1.40, 1.66, 2.08];
  const reducedImpactPose = {
    hurdle: .067, barrier: .14, movingBarrier: .18, slideGate: .12,
    spikes: .20, gap: .35, platform: .18,
  };

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function easeOut(value) {
    return 1 - (1 - clamp(value, 0, 1)) ** 2;
  }

  function deathPose(type, time, direction) {
    const strike = easeOut(time / .27);
    const settle = easeOut(time / .78);
    switch (type) {
      case 'hurdle':
        return { pitch: .24 + strike * 1.70 + settle * .64, roll: -.17 - settle * .55,
          y: .10 + .57 * strike * (1 - settle * .50), depth: strike * .84 + settle * 1.72 };
      case 'barrier':
        return { pitch: -.10 - strike * .84, y: strike * .24, depth: -1.72 * settle };
      case 'movingBarrier':
        return { pitch: -.13 - strike * .51, roll: -direction * (.12 + .96 * strike),
          x: direction * (1.93 * settle), y: strike * .30, depth: -.83 * settle };
      case 'spikes':
        return { pitch: .30 + easeOut(time / .42) * 2.66, roll: .25 + settle * .60,
          y: 2.25 * settle, depth: .83 * settle };
      case 'gap':
        return { pitch: .19 + strike * .44, roll: -.13 - .27 * settle,
          y: -.48 * settle - 2.43 * (time / 1.05) ** 2, depth: 5.6 * settle,
          size: 1 - .75 * settle };
      case 'platform':
        return { pitch: -.16 - strike * .52, roll: -.10 - .31 * settle,
          y: .43 * strike * (1 - settle * .73), depth: -1.24 * settle };
      default:
        return { depth: -1.02 * settle };
    }
  }

  function repeatable(index) {
    const value = Math.sin(index * 19.829 + 4.51) * 43758.5453;
    return value - Math.floor(value);
  }

  function speedWidening(speed) {
    const extra = Math.max(0, speed - START_SPEED);
    return 0.32 * (1 - 36 / (36 + extra));
  }

  function runningPace(speed) {
    return speed / (speed + 68);
  }

  function levelOfDetail(distance, spacing, count) {
    return Math.max(1, 2 ** Math.ceil(Math.log2(distance / (spacing * count))));
  }

  function laneMissing(mask, lane) {
    return (mask & (1 << lane)) !== 0;
  }

  function gapLaneMask(gap) {
    return ((1 << (gap.lanes ?? 1)) - 1) << gap.lane;
  }

  function deckSpans(near, far, gaps) {
    const cuts = gaps.filter(({ z, end }) => z < far && end > near);
    if (cuts.length === 0) return [{ start: near, end: far, mask: 0 }];
    const boundaries = new Set([near, far]);
    for (const { z, end } of cuts) {
      boundaries.add(Math.max(near, z));
      boundaries.add(Math.min(far, end));
    }
    const edges = [...boundaries].sort((a, b) => b - a);
    const spans = [];
    for (let index = 1; index < edges.length; index++) {
      const start = edges[index];
      const end = edges[index - 1];
      let mask = 0;
      for (const cut of cuts) {
        if (cut.z < end && cut.end > start) mask |= gapLaneMask(cut);
      }
      spans.push({ start, end, mask });
    }
    return spans;
  }

  function deckSurfaces(mask) {
    const surfaces = [];
    let first = 0;
    for (let lane = 0; lane <= LANE_COUNT; lane++) {
      if (lane < LANE_COUNT && !laneMissing(mask, lane)) continue;
      if (first < lane) surfaces.push([first * LANE_WIDTH - ROAD_HALF, lane * LANE_WIDTH - ROAD_HALF]);
      first = lane + 1;
    }
    return surfaces;
  }

  function clip(points, boundary = NEAR, axis = 2, side = 1) {
    const visible = [];
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      const next = points[(index + 1) % points.length];
      const inside = (point[axis] - boundary) * side >= 0;
      if (inside) visible.push(point);
      if (inside !== ((next[axis] - boundary) * side >= 0)) {
        const mix = (boundary - point[axis]) / (next[axis] - point[axis]);
        const intersection = point.map((value, dimension) => value + (next[dimension] - value) * mix);
        intersection[axis] = boundary;
        visible.push(intersection);
      }
    }
    return visible;
  }

  const deathPlates = deathArmor.map((plate) => plate.map(([x, y]) => [x, y, 0]));
  const slicedPlates = deathPlates.map((plate) => gateBands.slice(1).map((end, band) =>
    clip(clip(plate, gateBands[band] + .015, 1), end - .015, 1, -1)));

  class Scene {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.stars = Array.from({ length: 125 }, (_, index) => ({
        x: repeatable(index * 3), y: repeatable(index * 3 + 1) * 0.86,
        light: repeatable(index * 3 + 2),
      }));
      const motion = matchMedia('(prefers-reduced-motion: reduce)');
      this.reduceMotion = motion.matches;
      motion.addEventListener?.('change', (event) => {
        this.reduceMotion = event.matches;
        if (this.reduceMotion) this.reset();
      });
      this.openingBlend = 1;
      this.particles = [];
      this.setViewDistance(MIN_VIEW_DISTANCE);
      this.speedLines = Array.from({ length: 36 }, (_, index) => {
        const angle = (repeatable(index * 5 + 471) - 0.5) * 2.3;
        return {
          x: Math.cos(angle) * (index % 2 ? 1 : -1),
          y: Math.sin(angle),
          offset: repeatable(index * 5 + 472),
          pace: 0.72 + repeatable(index * 5 + 473) * 0.46,
          size: 0.44 + repeatable(index * 5 + 474) * 0.56,
        };
      });
      this.reset();
    }

    resize() {
      const width = this.canvas.clientWidth;
      const height = this.canvas.clientHeight;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      const style = getComputedStyle(this.canvas);
      const insets = ['left', 'top', 'right', 'bottom'].map((side) =>
        parseFloat(style.getPropertyValue(`--safe-${side}`)) || 0);
      if (width === this.width && height === this.height && ratio === this.ratio &&
          insets.every((value, index) => value === this.insets[index])) return false;
      this.width = width;
      this.height = height;
      this.ratio = ratio;
      this.insets = insets;
      const pixelsWide = Math.round(width * ratio);
      const pixelsHigh = Math.round(height * ratio);
      if (this.canvas.width !== pixelsWide) this.canvas.width = pixelsWide;
      if (this.canvas.height !== pixelsHigh) this.canvas.height = pixelsHigh;
      this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      return true;
    }

    reset(speed = START_SPEED) {
      this.particles.length = 0;
      this.slideBurst = null;
      this.speedPulse = 0;
      this.speedTravel = 0;
      this.boostRush = 0;
      this.pace = this.reduceMotion ? 0 : runningPace(speed);
      this.stridePhase = 0;
      this.widening = this.reduceMotion ? 0 : speedWidening(speed);
    }

    pulseSpeed() {
      if (!this.reduceMotion) this.speedPulse = 1;
    }

    scatter(kind, run, obstacle) {
      if (this.reduceMotion || kind === 'crash') return;
      if (kind === 'boost') {
        this.particles = this.particles.filter((particle) => particle.landedAt !== run.time);
        this.slideBurst = { x: run.x, y: run.height, z: run.distance, time: run.time };
        return;
      }
      const impact = kind === 'break';
      const x = impact ? obstacle.impact.x : run.x;
      const z = impact ? obstacle.impact.z : run.distance;
      const y = impact ? obstacle.impact.y : run.height;
      const color = impact ? '#ec9dff' : '#ac89eb';
      const count = impact ? 28 : 8;
      for (let index = 0; index < count; index++) {
        this.particles.push({
          x: x + (Math.random() - 0.5) * 1.35,
          y: y + (impact ? 0.12 + Math.random() * 1.15 : 0.1),
          z: z + (Math.random() - 0.5) * 0.7,
          vx: (Math.random() - 0.5) * 8,
          vy: 0.6 + Math.random() * 4,
          vz: (Math.random() - 0.65) * 14,
          size: 0.035 + Math.random() * 0.09,
          life: 0.38 + Math.random() * 0.42,
          color,
          landedAt: impact ? undefined : run.time,
        });
      }
    }

    setViewDistance(distance) {
      this.viewDistance = distance;
      // One scale for the whole scene leaves equal world gaps equal in camera space.
      const ratio = MIN_VIEW_DISTANCE / distance;
      const projectedRange = 82 + (MIN_VIEW_DISTANCE - 82) * ratio ** 1.8;
      this.longitudinalScale = projectedRange / distance;
    }

    projectedDepth(z) {
      return z * this.longitudinalScale;
    }

    get rearViewDistance() {
      return this.cameraBack / this.longitudinalScale;
    }

    viewPoint([x, y, z]) {
      const dy = y - this.cameraY;
      const dz = this.projectedDepth(z) + this.cameraBack;
      return [x - this.cameraX, dy * COS + dz * SIN, dz * COS - dy * SIN];
    }

    screenPoint([x, y, z]) {
      const scale = this.focal / z;
      return [this.centerX + x * scale, this.centerY - y * scale];
    }

    face(points, color) {
      const view = clip(points.map((point) => this.viewPoint(point)));
      if (view.length < 3) return;
      const { ctx } = this;
      ctx.beginPath();
      for (const [x, y] of view.map((point) => this.screenPoint(point))) ctx.lineTo(x, y);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }

    flat(x1, x2, near, far, color, y = 0) {
      this.face([[x1, y, near], [x2, y, near], [x2, y, far], [x1, y, far]], color);
    }

    box(x, y, z, width, height, depth, [topColor, frontColor, sideColor]) {
      const left = x - width / 2;
      const right = x + width / 2;
      const top = y + height;
      const near = z - depth / 2;
      const far = z + depth / 2;
      if (this.cameraX < left) {
        this.face([[left, y, near], [left, top, near], [left, top, far], [left, y, far]], sideColor);
      } else if (this.cameraX > right) {
        this.face([[right, y, near], [right, top, near], [right, top, far], [right, y, far]], sideColor);
      }
      if (this.cameraY > top) this.flat(left, right, near, far, topColor, top);
      this.face([[left, y, near], [right, y, near], [right, top, near], [left, top, near]], frontColor);
    }

    line(points, color, width) {
      const view = points.map((point) => this.viewPoint(point));
      if (view.some((point) => point[2] < NEAR)) return;
      const { ctx } = this;
      ctx.beginPath();
      for (const [x, y] of view.map((point) => this.screenPoint(point))) ctx.lineTo(x, y);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }

    sky(time, latestClue, signal) {
      const { ctx, width, height, centerX, horizon } = this;
      const travel = this.reduceMotion ? 0 : this.speedTravel;
      const drift = this.reduceMotion ? 0 : this.cameraX;
      const tide = Math.sin(time * 0.16 + travel * 0.024);
      const backdrop = ctx.createLinearGradient(0, 0, 0, height);
      backdrop.addColorStop(0, '#020209');
      backdrop.addColorStop(0.34, '#060612');
      backdrop.addColorStop(0.59, '#03050e');
      backdrop.addColorStop(1, '#010207');
      ctx.fillStyle = backdrop;
      ctx.fillRect(0, 0, width, height);

      const moonX = width * (0.48 + tide * 0.018) - drift * 1.3;
      const moonY = horizon - height * (0.107 + Math.cos(time * 0.12) * 0.009);
      const radius = Math.min(height * 0.19, width * 0.34);
      const hazeRadius = Math.max(radius * 2.5, width * 0.41);
      const haze = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, hazeRadius);
      haze.addColorStop(0, `rgba(73, 43, 117, ${0.34 + tide * 0.060})`);
      haze.addColorStop(0.38, '#37205245');
      haze.addColorStop(1, '#160d2b00');
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, width, height);

      for (const star of this.stars) {
        const depth = 0.19 + star.light * 0.81;
        const x = (star.x - travel * depth * 0.0009 - drift * depth * 0.002) % 1;
        const y = star.y * height + Math.sin(time * 0.17 + star.x * 10) * depth * 3;
        const size = 0.7 + star.light ** 4 * 0.9;
        ctx.fillStyle = `rgba(171, 172, 215, ${0.11 + star.light * 0.42})`;
        ctx.fillRect((x < 0 ? x + 1 : x) * width, y, size, size);
      }

      const eclipse = ctx.createLinearGradient(0, moonY - radius, 0, moonY + radius);
      eclipse.addColorStop(0, '#070613');
      eclipse.addColorStop(1, '#100c1d');
      ctx.beginPath();
      ctx.arc(moonX, moonY, radius, 0, Math.PI * 2);
      ctx.fillStyle = eclipse;
      ctx.fill();
      ctx.strokeStyle = '#5b3c846d';
      ctx.lineWidth = 1;
      ctx.stroke();

      const arcDrift = Math.sin(time * 0.13 + travel * 0.035) * 0.15;
      for (let ring = 0; ring < 3; ring++) {
        ctx.beginPath();
        ctx.arc(moonX, moonY, radius + 6 + ring * 9,
          Math.PI * (0.88 + ring * 0.14 + arcDrift), Math.PI * (1.47 + ring * 0.18 + arcDrift));
        ctx.strokeStyle = ['#9a6ddb58', '#966cc132', '#7951b027'][ring];
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      const depthHaze = ctx.createLinearGradient(0, horizon - height * 0.19, 0, horizon + height * 0.16);
      depthHaze.addColorStop(0, '#07051a00');
      depthHaze.addColorStop(0.58, '#0b142795');
      depthHaze.addColorStop(1, '#02050de8');
      ctx.fillStyle = depthHaze;
      ctx.fillRect(0, 0, width, height);

      for (let i = 0; i < 24; i++) {
        const side = i % 2 ? 1 : -1;
        const depth = repeatable(i + 37);
        const offset = Math.sin(time * 0.22 + travel * 0.074 + i) * (4 + depth * 11);
        const x = centerX + side * width * (0.12 + depth * 0.45) + offset - drift * depth * 5;
        const y = horizon + height * (repeatable(i + 173) * 0.45 - 0.07);
        const size = 1.3 + depth * 9;
        ctx.save();
        ctx.translate(x, y + Math.sin(time * 0.27 + travel * 0.057 + i) * size * 0.3);
        ctx.rotate(0.2 + repeatable(i + 89) * 1.6);
        ctx.fillStyle = '#141b31';
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.fillStyle = '#7182b750';
        ctx.fillRect(-size / 2, -size / 2, size, 1);
        ctx.restore();
      }
      this.relayNine(time, latestClue, signal);
    }

    relayNine(time, latestClue, signal) {
      const { ctx, width, height } = this;
      const [left, top, right, bottom] = this.insets;
      const x = left + (width - left - right) * (width < 690 ? 0.83 : 0.77);
      const y = top + (height - top - bottom) * 0.23;
      const clueNumber = signal?.clueNumber ?? latestClue;
      const clock = signal?.elapsed ?? time;
      const phase = signal ? Math.min(1, clock / PULSE_LEAD) : 1;
      const wave = this.reduceMotion ? 0.65 : 0.5 + 0.5 * Math.sin(clock * 1.3);
      const pulse = clueNumber * (0.78 + 0.22 * wave) * (this.reduceMotion ? 1 : phase * phase * (3 - 2 * phase));
      const radius = 11 + 7 * pulse;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, `rgba(215, 235, 255, ${0.59 + 0.085 * pulse})`);
      glow.addColorStop(0.38, '#728de647');
      glow.addColorStop(1, '#dbe8ff00');
      ctx.fillStyle = glow;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);

      ctx.fillStyle = '#b8d6ff8c';
      ctx.fillRect(x - radius * 0.55, y - 0.5, radius * 1.1, 1);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      const point = 4 + pulse;
      ctx.moveTo(x, y - point);
      ctx.lineTo(x + point / 2, y);
      ctx.lineTo(x, y + point);
      ctx.lineTo(x - point / 2, y);
      ctx.closePath();
      ctx.fill();
    }

    deepVoid(distance) {
      const { ctx, width, height } = this;
      const stride = 23 * levelOfDetail(this.viewDistance, 23, 9);
      const first = Math.floor((distance + 14) / stride);
      const last = Math.ceil((distance + this.viewDistance * 1.24) / stride);
      for (let band = last; band >= first; band--) {
        for (let detail = 0; detail < 13; detail++) {
          const index = band * 107 + detail * 7;
          const x = (repeatable(index) - 0.5) * 22;
          const y = -5.4 - repeatable(index + 1) ** 1.45 * 29;
          const z = band * stride + repeatable(index + 2) * stride - distance;
          const brightness = repeatable(index + 3);
          const depth = this.projectedDepth(z);
          const fade = Math.max(0, Math.min(1, (232 - depth) / 130, (depth - 4) / 16));
          if (fade <= 0) continue;
          if (detail < 2) {
            ctx.globalAlpha = fade * (0.57 + brightness * 0.35);
            this.voidShard(x, y, z, 0.34 + brightness * 0.73, repeatable(index + 4) - 0.5);
            continue;
          }
          const point = this.viewPoint([x, y, z]);
          if (point[2] < NEAR) continue;
          const [px, py] = this.screenPoint(point);
          if (px < 0 || px > width || py < 0 || py > height) continue;
          const radius = Math.min(2.4, 0.6 + brightness * 0.47 + this.focal / point[2] * 0.052);
          ctx.globalAlpha = fade * (0.35 + brightness * 0.60);
          ctx.fillStyle = brightness > 0.84 ? '#b6efff' : brightness > 0.45 ? '#86b6e3' : '#687fca';
          ctx.beginPath();
          ctx.arc(px, py, radius, 0, Math.PI * 2);
          ctx.fill();
          if (brightness > 0.94) {
            ctx.globalAlpha *= 0.48;
            ctx.fillRect(px - radius * 2.2, py - 0.45, radius * 4.4, 0.9);
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    voidShard(x, y, z, size, tilt) {
      const crown = [x - tilt * size * 1.6, y + size, z + size * 0.28];
      const tip = [x + tilt * size * 2, y - size * 1.75, z + size * 0.8];
      const left = [x - size * 0.75, y - size * 0.26, z];
      const right = [x + size * 0.83, y + size * 0.15, z + size * 0.36];
      const ridge = [x + size * 0.05, y - size * 0.08, z - size * 0.41];
      this.face([crown, left, tip, ridge], '#4e729a');
      this.face([crown, ridge, tip, right], '#23405f');
      this.face([crown, left, ridge], '#a6d4eb');
    }

    track(run, ready) {
      const { distance } = run;
      const farEnd = distance + this.viewDistance;
      const nearStart = distance - this.rearViewDistance;
      const length = farEnd - nearStart;
      const stride = TILE * levelOfDetail(length, TILE, FAR_TILES);
      const gaps = run.obstacles.filter(({ type, z, end }) => type === 'gap' && z < farEnd && end > nearStart);
      const selected = ready ? -1 : run.lane;
      for (let tile = Math.ceil(farEnd / stride) - 1; (tile + 1) * stride > nearStart; tile--) {
        const z = tile * stride;
        this.trackTile(distance, gaps, selected, Math.max(nearStart, z), Math.min(farEnd, z + stride));
      }

      // Markings crossfade between world-anchored grids while the solid deck keeps its exact boundaries.
      const detail = Math.max(0, Math.log2(length / (TILE * MARKING_TILES)));
      const markStride = TILE * 2 ** Math.floor(detail);
      const blend = detail % 1;
      this.trackMarks(distance, gaps, nearStart, farEnd, markStride, 1 - blend);
      if (blend > 0) this.trackMarks(distance, gaps, nearStart, farEnd, markStride * 2, blend);
      if (!this.reduceMotion) this.railReflectors(run, gaps, nearStart, farEnd);

      for (let lane = 0; lane < LANE_COUNT; lane++) {
        const cuts = gaps.filter((gap) => laneMissing(gapLaneMask(gap), lane));
        if (cuts.length === 0) continue;
        const x = laneX(lane);
        for (const { start, end, mask } of deckSpans(nearStart, farEnd, cuts)) {
          if (mask !== 0) continue;
          if (end < farEnd) this.gapWarning(x, end - distance, start - distance);
          if (start === nearStart) continue;
          const resume = start - distance;
          const far = end - distance;
          this.ctx.globalAlpha = Math.max(0.48, Math.min(1, (210 - this.projectedDepth(resume)) / 130));
          this.flat(x - 1.19, x + 1.19, resume, Math.min(far, resume + 0.58), '#59a3ab', 0.034);
          if (far <= resume + 0.62) continue;
          for (const offset of [-0.78, 0, 0.78]) {
            this.flat(x + offset - 0.20, x + offset + 0.20, resume + 0.62,
              Math.min(far, resume + 1.52), '#99edf0', 0.034);
          }
        }
      }
      this.ctx.globalAlpha = 1;
    }

    gapWarning(x, entry, start) {
      const scale = this.longitudinalScale;
      const depth = this.projectedDepth(entry);
      const paint = 0.034;
      const red = '#ff4c59';
      this.ctx.globalAlpha = Math.max(0.72, Math.min(1, (210 - depth) / 130));
      this.flat(x - 1.17, x + 1.17, Math.max(entry - 0.65 / scale, start), entry, red, paint);

      const tip = entry - 1.65 / scale;
      // Stretch the paint in depth as it recedes to offset the shallow view of the deck.
      const length = Math.max(3.8, (depth + this.cameraBack) * 0.27) / scale;
      const at = (fraction) => tip - length * fraction;
      const paintFace = (points, color) => {
        const visible = clip(points, start);
        if (visible.length >= 3) this.face(visible, color);
      };
      paintFace([[x, paint, tip], [x - 1.11, paint, at(1)], [x + 1.11, paint, at(1)]], red);
      paintFace([[x, paint, at(0.20)], [x - 0.80, paint, at(0.88)], [x + 0.80, paint, at(0.88)]], '#271420');
      paintFace([[x - 0.15, paint, at(0.40)], [x + 0.15, paint, at(0.40)],
        [x + 0.10, paint, at(0.65)], [x - 0.10, paint, at(0.65)]], '#fff3ed');
      if (at(0.73) > start) this.flat(x - 0.115, x + 0.115, Math.max(start, at(0.83)), at(0.73), '#fff3ed', paint);
    }

    boosterMarking(x, entry) {
      this.ctx.globalAlpha = Math.min(1, (210 - this.projectedDepth(entry)) / 130);
      const stripe = 0.8 / this.longitudinalScale;
      this.flat(x - 1.17, x + 1.17, Math.max(entry - stripe, -this.rearViewDistance), entry, '#ffe787', 0.034);
      for (const offset of [2.8, 5]) {
        const tip = entry - offset / this.longitudinalScale;
        const base = tip - 1.4 / this.longitudinalScale;
        if (base < -this.rearViewDistance) continue;
        this.line([[x - 0.98, 0.034, base], [x, 0.034, tip], [x + 0.98, 0.034, base]], '#ffe787', 2.6);
      }
    }

    railReflectors(run, gaps, nearStart, farEnd) {
      const { distance, baseSpeed } = run;
      const scale = this.longitudinalScale;
      // Fade every other mount before doubling the spacing, leaving the remaining mounts in place.
      const detail = Math.max(0, Math.log2(baseSpeed / (REFLECTOR_SPACING * REFLECTOR_CADENCE)));
      const level = Math.floor(detail);
      const stride = REFLECTOR_SPACING * 2 ** level;
      const fineOpacity = 1 - (detail - level);
      const first = Math.ceil(Math.max(nearStart, distance - 8 / scale) / stride);
      const last = Math.floor(Math.min(farEnd, distance + 57 / scale) / stride);
      const halfDepth = 0.46 / scale;
      const trailLength = (0.45 + 6 * this.pace ** 2) / scale;
      const leftCuts = gaps.filter((gap) => laneMissing(gapLaneMask(gap), 0));
      const rightCuts = gaps.filter((gap) => laneMissing(gapLaneMask(gap), LANE_COUNT - 1));
      for (let index = last; index >= first; index--) {
        const anchor = index * stride;
        const z = anchor - distance;
        const depth = this.projectedDepth(z);
        const opacity = Math.min(1, (57 - depth) / 30, (depth + 8) / 3) * (index % 2 ? fineOpacity : 1);
        if (opacity <= 0) continue;
        const trailStart = anchor + halfDepth;
        for (const side of [-1, 1]) {
          const cuts = side < 0 ? leftCuts : rightCuts;
          let trailEnd = Math.min(farEnd, trailStart + trailLength);
          for (const gap of cuts) {
            if (gap.end > anchor - halfDepth) trailEnd = Math.min(trailEnd, gap.z);
          }
          if (trailEnd < trailStart) continue;
          const x = side * (ROAD_HALF + 0.09);
          if (trailEnd > trailStart) {
            this.ctx.globalAlpha = opacity * (0.38 + this.pace * 0.48);
            this.face([[x - 0.14, 0.044, trailStart - distance], [x + 0.14, 0.044, trailStart - distance],
              [x, 0.044, trailEnd - distance]], '#bc8df4');
          }
          this.ctx.globalAlpha = opacity;
          this.box(x, 0.025, z, 0.34, 0.49, halfDepth * 2, railMount);
        }
      }
      this.ctx.globalAlpha = 1;
    }

    trackTile(distance, gaps, selected, start, end) {
      const near = start - distance;
      const dust = Math.min(1, Math.max(0.22, (210 - this.projectedDepth(near)) / 145));
      // Compare against the open deck immediately beyond the tile's far edge.
      let fartherMask = 0;
      for (const gap of gaps) {
        if (gap.z <= end && gap.end > end) fartherMask |= gapLaneMask(gap);
      }
      for (const span of deckSpans(start, end, gaps)) {
        const opened = span.mask & ~fartherMask;
        this.ctx.globalAlpha = Math.max(0.48, dust);
        for (let lane = 0; opened && lane < LANE_COUNT; lane++) {
          if (laneMissing(opened, lane)) this.cutLip(laneX(lane), span.end - distance);
        }
        this.ctx.globalAlpha = dust;
        this.deckSection(span.start - distance, span.end - distance, selected, span.mask);
        fartherMask = span.mask;
      }
    }

    trackMarks(distance, gaps, start, end, stride, opacity) {
      const scale = stride / TILE;
      const first = Math.floor(start / stride);
      const last = Math.ceil(end / stride) - 1;
      for (let tile = last; tile >= first; tile--) {
        const z = tile * stride;
        const near = z - distance;
        this.ctx.globalAlpha = opacity * Math.min(1, Math.max(0.22, (210 - this.projectedDepth(near)) / 145));
        if (z >= start) {
          for (const span of deckSpans(z, Math.min(end, z + 0.09 * scale), gaps)) {
            for (const [left, right] of deckSurfaces(span.mask)) {
              this.flat(left, right, span.start - distance, span.end - distance, '#130f20', 0.018);
            }
          }
        }
        const markerStart = Math.max(start, z + 1.05 * scale);
        const markerEnd = Math.min(end, z + 2.1 * scale);
        if (markerStart < markerEnd) {
          for (const span of deckSpans(markerStart, markerEnd, gaps)) {
            this.laneMarks(span.start - distance, span.end - distance, span.mask, true);
          }
        }
        const braceNear = Math.max(start, z + 3.65 * scale);
        const braceFar = Math.min(end, z + 4.25 * scale);
        if (gaps.length === 0 || braceNear >= braceFar) continue;
        for (const span of deckSpans(braceNear, braceFar, gaps)) {
          for (let lane = 1; span.mask && lane < LANE_COUNT; lane++) {
            const missingLeft = laneMissing(span.mask, lane - 1);
            if (missingLeft === laneMissing(span.mask, lane)) continue;
            const edge = -ROAD_HALF + lane * LANE_WIDTH;
            if (missingLeft ? this.cameraX < edge : this.cameraX > edge) {
              this.cutBrace(edge, span.start - distance, span.end - distance);
            }
          }
        }
      }
    }

    deckSection(near, far, selected, mask) {
      const half = LANE_WIDTH / 2;
      for (let lane = 1; mask && lane < LANE_COUNT; lane++) {
        if (laneMissing(mask, lane - 1) !== laneMissing(mask, lane)) {
          this.cutWall(-ROAD_HALF + lane * LANE_WIDTH, near, far);
        }
      }
      for (const [left, right] of deckSurfaces(mask)) {
        this.flat(left, right, near, far, '#261b38');
      }
      if (selected >= 0 && !laneMissing(mask, selected)) {
        const x = laneX(selected);
        this.flat(x - half + 0.045, x + half - 0.045, near, far, '#302248', 0.012);
      }
      for (let lane = 1; mask && lane < LANE_COUNT; lane++) {
        const missingLeft = laneMissing(mask, lane - 1);
        if (missingLeft === laneMissing(mask, lane)) continue;
        const edge = -ROAD_HALF + lane * LANE_WIDTH;
        this.flat(edge - (missingLeft ? 0 : 0.16), edge + (missingLeft ? 0.16 : 0), near, far, '#929ec1', 0.025);
      }
      this.laneMarks(near, far, mask, false);
    }

    laneMarks(near, far, mask, ticks) {
      for (let lane = 1; lane < LANE_COUNT; lane++) {
        if (laneMissing(mask, lane) || laneMissing(mask, lane - 1)) continue;
        const edge = -ROAD_HALF + lane * LANE_WIDTH;
        if (ticks) this.flat(edge - 0.018, edge + 0.018, near, far, '#9b77c7', 0.023);
        else this.flat(edge - 0.025, edge + 0.025, near, far, '#61477d', 0.019);
      }
      for (const side of [-1, 1]) {
        if (laneMissing(mask, side < 0 ? 0 : LANE_COUNT - 1)) continue;
        const edge = side * ROAD_HALF;
        if (ticks) this.flat(edge - 0.064, edge + 0.064, near, far, '#dfbcff', 0.037);
        else {
          this.flat(edge - 0.20, edge + 0.20, near, far, '#583888', 0.025);
          this.flat(edge - 0.037, edge + 0.037, near, far, '#a77cf9', 0.032);
        }
      }
    }

    cutWall(x, near, far) {
      this.face([[x, 0, near], [x, 0, far], [x, -CUT_DEPTH, far], [x, -CUT_DEPTH, near]], '#202b43');
      this.face([[x, 0, near], [x, 0, far], [x, -0.27, far], [x, -0.27, near]], '#6b7396');
      this.face([[x, -1.07, near], [x, -1.07, far], [x, -1.21, far], [x, -1.21, near]], '#455370');
    }

    cutBrace(x, near, far) {
      const lean = (far - near) * 0.20;
      this.face([[x, -0.27, near], [x, -0.27, far],
        [x, -CUT_DEPTH, far - lean], [x, -CUT_DEPTH, near + lean]], '#49546f');
      this.face([[x, -0.29, near], [x, -0.29, near + lean],
        [x, -CUT_DEPTH, near + 1.6 * lean], [x, -CUT_DEPTH, near + lean]], '#8793b2');
    }

    cutLip(x, z) {
      const left = x - LANE_WIDTH / 2;
      const right = x + LANE_WIDTH / 2;
      this.face([[left, 0, z], [right, 0, z], [right, -CUT_DEPTH, z], [left, -CUT_DEPTH, z]], '#253951');
      this.face([[left, 0, z], [right, 0, z], [right, -0.24, z], [left, -0.24, z]], '#a6eeff');
      for (const offset of [-0.75, 0, 0.75]) {
        const lamp = x + offset;
        this.face([[lamp - 0.16, -0.40, z], [lamp + 0.17, -0.40, z],
          [lamp + 0.11, -1.29, z], [lamp - 0.11, -1.29, z]], '#6dbdcf');
      }
    }

    hurdle(x, z) {
      const { height, halfWidth, halfDepth } = obstacles.hurdle;
      this.box(x, 0, z, halfWidth * 2, 0.17, 0.47, ['#7b5271', '#44314d', '#987182']);
      this.box(x, 0.17, z, halfWidth * 2, height - 0.17, halfDepth * 2, amber);
      const front = z - halfDepth - 0.002;
      const dashes = [-0.61, -0.13, 0.35];
      for (const dash of dashes) {
        this.face([[x + dash, .25, front], [x + dash + .19, .25, front],
          [x + dash + .42, .61, front], [x + dash + .23, .61, front]], '#592f3d');
      }
      this.line([[x - 0.94, .67, front], [x + 0.94, .67, front]], '#ffe3ac', 1.6);
    }

    barrier(x, z) {
      const { height, halfWidth, halfDepth } = obstacles.barrier;
      const front = z - halfDepth - 0.003;
      const point = (dx, fraction) => [x + dx, height * fraction, front];
      this.box(x, 0, z, halfWidth * 2, height, halfDepth * 2, pink);
      this.face([point(-.82, .07), point(.81, .07), point(.81, .93),
        point(-.54, .93), point(-.82, .82)], '#532766');
      this.line([point(-.86, .065), point(-.86, .82), point(-.54, .945),
        point(.83, .945), point(.83, .06), point(-.86, .06)], '#e4a8f8', 1.3);
      const crack = [point(.35, .93), point(-.08, .71), point(.17, .585),
        point(-.29, .44), point(-.07, .35), point(-.44, .065)];
      this.line(crack, '#be5ede', 5.4);
      this.line(crack, '#f7c1ff', 2);
      this.line([point(.70, .295), point(.42, .41), crack[3], point(-.55, .58)], '#ec9df8', 1.1);
    }

    platform(platform, distance, near, far) {
      const { lane, height = PLATFORM_HEIGHT, z, end } = platform;
      const x = laneX(lane);
      const start = z - distance;
      const finish = end - distance;
      const left = x - PLATFORM_HALF_WIDTH;
      const right = x + PLATFORM_HALF_WIDTH;
      const [top, , , edge] = platformPalette;
      this.structure(left, right, 0, height, near, far, near === start, platformPalette);
      this.flat(left + 0.14, right - 0.14, near, far, '#3b506b', height + 0.012);
      for (const rail of [left, right - 0.075]) {
        this.flat(rail, rail + 0.075, near, far, edge, height + 0.018);
      }
      const stride = TILE * levelOfDetail(this.viewDistance, TILE, 16);
      const stripe = Math.min(stride * 0.15, 0.32 / this.longitudinalScale);
      for (let mark = start + Math.max(1, Math.floor((near - start) / stride)) * stride; mark < far; mark += stride) {
        if (mark + stripe <= near || mark + stripe >= finish) continue;
        this.flat(left + 0.13, right - 0.13, Math.max(mark, near), Math.min(far, mark + stripe), top, height + 0.022);
      }
      for (const lip of [start, finish - stripe]) {
        const edgeNear = Math.max(near, lip);
        const edgeFar = Math.min(far, lip + stripe);
        if (edgeNear < edgeFar) this.flat(left, right, edgeNear, edgeFar, edge, height + 0.024);
      }
      if (near !== start) return;
      this.face([[left, height - 0.13, near], [right, height - 0.13, near],
        [right, height, near], [left, height, near]], edge);
      this.face([[left + 0.16, 0.15, near], [right - 0.16, 0.15, near],
        [right - 0.32, height - 0.26, near], [left + 0.32, height - 0.26, near]], '#152635');
    }

    slideGate(gate, distance, near, far) {
      const x = laneX(gate.lane);
      const start = gate.z - distance;
      const finish = gate.end - distance;
      const left = x - SLIDE_GATE_HALF_WIDTH;
      const right = x + SLIDE_GATE_HALF_WIDTH;
      const bottom = SLIDE_GATE_CLEARANCE;
      const top = SLIDE_GATE_HEIGHT;
      const rim = '#ffa48e';
      const foot = Math.min(0.44 / this.longitudinalScale, (finish - start) / 2);
      for (const position of [start, finish - foot]) {
        const postNear = Math.max(near, position);
        const postFar = Math.min(far, position + foot);
        if (postFar <= postNear) continue;
        for (const edge of [left, right - 0.14]) {
          this.structure(edge, edge + 0.14, 0, bottom, postNear, postFar, postNear === position, gatePalette);
        }
      }
      this.structure(left, right, bottom, top, near, far, near === start, gatePalette);
      for (const rail of [left, right - 0.10]) this.flat(rail, rail + 0.10, near, far, '#ac6779', top + 0.016);
      if (near !== start) return;
      this.face([[left, bottom, near], [right, bottom, near],
        [right, bottom + 0.19, near], [left, bottom + 0.19, near]], rim);
      this.face([[left + 0.14, bottom + 0.32, near], [right - 0.14, bottom + 0.32, near],
        [right - 0.14, top - 0.22, near], [left + 0.14, top - 0.22, near]], '#291925');
      for (const inset of [0.32, 0.76]) {
        const y = bottom + inset;
        this.face([[x - 0.60, y + 0.36, near], [x, y, near], [x + 0.60, y + 0.36, near],
          [x + 0.60, y + 0.57, near], [x, y + 0.23, near], [x - 0.60, y + 0.57, near]], rim);
      }
    }

    structure(left, right, bottom, top, near, far, cap, [topColor, frontColor, sideColor]) {
      if (this.cameraX < left || this.cameraX > right) {
        const edge = this.cameraX < left ? left : right;
        this.face([[edge, bottom, near], [edge, bottom, far], [edge, top, far], [edge, top, near]], sideColor);
      }
      this.flat(left, right, near, far, topColor, this.cameraY > top ? top : bottom);
      if (cap) {
        this.face([[left, bottom, near], [right, bottom, near], [right, top, near], [left, top, near]], frontColor);
      }
    }

    movingBarrier(obstacle, z, time) {
      const x = movingBarrierX(obstacle, time);
      const left = Math.min(laneX(obstacle.lane), laneX(obstacle.toLane));
      const right = Math.max(laneX(obstacle.lane), laneX(obstacle.toLane));
      const trackZ = z - 0.82 / this.longitudinalScale;
      const depth = 0.22 / this.longitudinalScale;
      this.flat(left - 0.39, right + 0.39, trackZ - depth, trackZ + depth, '#6671a6', 0.036);
      for (const end of [left, right]) {
        this.flat(end - 0.20, end + 0.20, trackZ - 2 * depth, trackZ + 2 * depth, '#adcdf6', 0.040);
      }
      this.barrier(x, z);
      const direction = Math.sign(movingBarrierX(obstacle, time + 0.10) -
        movingBarrierX(obstacle, Math.max(0, time - 0.10)));
      if (direction) {
        const tip = x + direction * 0.61;
        const tail = x - direction * 0.57;
        const step = tip - direction * 0.43;
        this.face([[tip, 0.27, trackZ], [step, 0.53, trackZ], [step, 0.37, trackZ],
          [tail, 0.37, trackZ], [tail, 0.17, trackZ], [step, 0.17, trackZ], [step, 0.01, trackZ]], '#b3ebff');
      }
    }

    blackHole(obstacle, z, time) {
      const x = laneX(obstacle.lane);
      const { direction } = obstacle;
      const point = this.viewPoint([x, 1.02, z]);
      if (point[2] < NEAR) return;
      const [cx, cy] = this.screenPoint(point);
      const radius = Math.max(4.3, Math.min(72, this.focal / point[2] * BLACK_HOLE_HALF_WIDTH));
      const { ctx } = this;
      const edge = direction < 0 ? '#eca3ee' : '#8bdce6';
      const shade = direction < 0 ? '#783969' : '#286176';
      ctx.save();
      if (obstacle.triggered) ctx.globalAlpha *= 0.48;
      const glow = ctx.createRadialGradient(cx, cy, radius * 0.52, cx, cy, radius * 1.84);
      glow.addColorStop(0, shade);
      glow.addColorStop(1, '#01010700');
      ctx.fillStyle = glow;
      ctx.fillRect(cx - radius * 1.84, cy - radius * 1.84, radius * 3.68, radius * 3.68);
      ctx.translate(cx, cy);
      ctx.scale(radius, radius);
      ctx.fillStyle = '#02030a';
      ctx.beginPath();
      ctx.arc(0, 0, 0.91, 0, 2 * Math.PI);
      ctx.fill();
      ctx.lineWidth = Math.max(0.095, 0.8 / radius);
      ctx.strokeStyle = edge;
      for (let ring = 0; ring < 2; ring++) {
        ctx.beginPath();
        const phase = Math.sin(time * 0.82) * 0.22 + ring * 0.46 + (direction < 0 ? Math.PI : 0);
        ctx.ellipse(0, 0, 1 + ring * 0.28, 0.81 + ring * 0.20, -direction * 0.44,
          phase + 0.42, phase + (ring ? 3.91 : 5.70));
        ctx.stroke();
      }
      // The two chevrons stay readable while the accretion arcs drift.
      for (const offset of [-0.27, 0.47]) {
        const tip = direction * offset;
        ctx.beginPath();
        ctx.moveTo(tip - direction * 0.41, -0.38);
        ctx.lineTo(tip, 0);
        ctx.lineTo(tip - direction * 0.41, 0.38);
        ctx.lineWidth = Math.max(0.135, 1.05 / radius);
        ctx.stroke();
      }
      ctx.restore();
    }

    bolt(bolt, z) {
      const point = this.viewPoint([laneX(bolt.lane), bolt.height, z]);
      if (point[2] < NEAR) return;
      const [x, y] = this.screenPoint(point);
      const scale = Math.max(7.5, Math.min(60, this.focal / point[2] * 1.02));
      const { ctx } = this;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, scale);
      glow.addColorStop(0, '#49eef473');
      glow.addColorStop(1, '#49eef400');
      ctx.fillStyle = glow;
      ctx.fillRect(x - scale, y - scale, scale * 2, scale * 2);
      ctx.beginPath();
      for (const [dx, dy] of [[0.09, -0.68], [-0.45, 0.11], [-0.05, 0.11], [-0.20, 0.67],
        [0.46, -0.17], [0.06, -0.17], [0.26, -0.68]]) {
        ctx.lineTo(x + dx * scale, y + dy * scale);
      }
      ctx.closePath();
      ctx.lineWidth = Math.max(1, scale * 0.075);
      ctx.strokeStyle = '#a2f9f2';
      ctx.stroke();
      ctx.fillStyle = '#ffd474';
      ctx.fill();
    }

    spikes(patch, distance) {
      const left = laneX(patch.lane) - LANE_WIDTH / 2 + 0.1;
      const right = left + LANE_WIDTH * patch.lanes - 0.2;
      const limit = this.viewDistance * OBSTACLE_VIEW_FRACTION;
      const front = patch.z - distance;
      const first = Math.max(0, Math.ceil((-this.rearViewDistance - front) / patch.tileLength) - 1);
      const last = Math.min(patch.tiles - 1, Math.floor((limit - front) / patch.tileLength));
      for (let tile = last; tile >= first; tile--) {
        const start = patch.z - distance + tile * patch.tileLength;
        const end = start + patch.tileLength;
        this.ctx.globalAlpha = Math.min(1, (195 - this.projectedDepth(start)) / 100);
        const nearEdge = Math.max(start, -this.rearViewDistance);
        const farEdge = Math.min(end, this.viewDistance);
        this.flat(left, right, nearEdge, farEdge, '#6d223b', 0.027);
        const plateStart = Math.max(start + 0.7, nearEdge);
        const plateEnd = Math.min(end - 0.30, farEdge);
        if (plateStart < plateEnd) this.flat(left + 0.08, right - 0.08, plateStart, plateEnd, '#3e142c', 0.03);
        if (start >= -this.rearViewDistance) this.line([[left, 0.034, start], [right, 0.034, start]], '#ff7597', 1.6);
        if (end <= this.viewDistance) this.flat(left, right, end - 0.22, end, '#b54260', 0.034);
        for (let row = 5; row >= 0; row--) {
          const depth = Math.min(3.5, patch.tileLength * 0.125);
          const near = start + patch.tileLength * (0.07 + row * 0.15);
          if (near + depth < -this.rearViewDistance || near + depth > this.viewDistance) continue;
          for (let tooth = 0; tooth < patch.lanes * 2; tooth++) {
            const x = left + (tooth + 0.5) * (right - left) / (patch.lanes * 2);
            const point = [x, SPIKE_HEIGHT, near + depth * 0.55];
            this.face([[x - 0.46, 0.04, near], [x + 0.46, 0.04, near], point], '#ef577f');
            this.face([[x + 0.46, 0.04, near], [x + 0.37, 0.04, near + depth], point], '#9e3459');
            this.face([[x - 0.46, 0.04, near], [x - 0.37, 0.04, near + depth], point], '#ff90a2');
          }
        }
      }
      this.ctx.globalAlpha = 1;
    }

    player(run, time, ready, dashing, boosting) {
      const x = run.x;
      const lift = run.height;
      const sliding = run.sliding;
      const stride = this.reduceMotion || run.airborne || ready || sliding ? 0 : Math.sin(this.stridePhase);
      const bob = this.reduceMotion || run.airborne || sliding ? 0 : ready ? Math.sin(time * 1.9) * 0.035 : Math.abs(stride) * 0.055;
      const y = lift + bob;
      const mint = run.slideWindowOpen || boosting;
      const ring = mint ? '#9bffe6' : dashing ? '#90d9ff' : '#c0a0ff';
      const signal = dashing ? '#a6e1ff' : mint ? '#65ffd7' : '#ab82fa';
      const platform = run.obstacles.find((obstacle) => obstacle.type === 'platform' &&
        obstacle.z < run.distance - 0.75 && obstacle.end > run.distance + (sliding ? 0.91 : 0.59) &&
        Math.abs(laneX(obstacle.lane) - x) <= PLATFORM_HALF_WIDTH - 0.87 &&
        lift >= (obstacle.height ?? PLATFORM_HEIGHT));
      const overCut = run.obstacles.some((obstacle) => {
        if (obstacle.type !== 'gap' || obstacle.z >= run.distance + 0.59 || obstacle.end <= run.distance - 0.75) {
          return false;
        }
        const left = laneX(obstacle.lane) - LANE_WIDTH / 2;
        const right = left + (obstacle.lanes ?? 1) * LANE_WIDTH;
        return x > left - 0.87 && x < right + 0.87;
      });
      if (platform || !overCut) {
        const floor = platform ? platform.height ?? PLATFORM_HEIGHT : 0;
        this.flat(x - .67, x + .67, -.49, sliding ? .91 : .59, '#0e0a18a8', floor + .032);
        this.ctx.globalAlpha = mint || dashing ? 1 : 0.57;
        for (const side of [-1, 1]) {
          this.line([[x + side * .65, floor + .035, -.75], [x + side * .87, floor + .035, -.35],
            [x + side * .87, floor + .035, .38]], ring, 2);
        }
        this.ctx.globalAlpha = 1;
      }

      if (dashing) this.dashExhaust(x, y, sliding);
      if (boosting) this.slideExhaust(x, lift);

      if (sliding) {
        this.slidePlayer(x, y, signal);
        return;
      }

      for (const side of [-1, 1]) {
        const legX = x + side * .25;
        const step = side * stride;
        const footZ = step * .37 + (run.airborne && side > 0 ? .19 : 0);
        const footY = y + Math.max(0, step) * .16 + (run.airborne ? .09 : 0);
        this.box(legX, footY, footZ, .43, .22, .65, violet);
        this.box(legX, footY + .22, footZ, .4, .46, .53, suit);
      }
      this.box(x, y + .64, 0, .93, .79, .66, violet);
      for (const side of [-1, 1]) {
        const armZ = side * stride * -.30;
        const armY = y + .67 + (run.airborne ? .13 : 0);
        this.box(x + side * .63, armY, armZ, .30, .55, .43, suit);
        this.box(x + side * .63, armY + .53, armZ, .36, .20, .49, steel);
      }
      this.box(x, y + .83, -.38, .53, .52, .23, suit);
      this.box(x, y + 1.13, -.505, .3, .10, .026, [signal, signal, signal]);
      this.box(x, y + 1.42, .015, .68, .65, .67, steel);
      this.box(x, y + 1.58, -.328, .56, .19, .035, ['#8966c3', '#221735', '#8463b3']);
      this.box(x, y + 1.65, -.349, .46, .042, .01, [signal, signal, signal]);
    }

    dashExhaust(x, y, sliding) {
      // Express wake lengths in camera depth so fast courses do not compress them into the suit.
      const scale = this.longitudinalScale;
      if (!this.reduceMotion) {
        const silhouette = sliding ?
          [[-.53, .04], [-.76, .29], [-.64, .62], [-.35, .72], [-.35, 1.24],
            [.35, 1.24], [.35, .72], [.64, .62], [.76, .29], [.53, .04]] :
          [[-.45, .04], [-.49, .69], [-.81, .82], [-.73, 1.36], [-.34, 1.48],
            [-.34, 2.04], [.34, 2.04], [.34, 1.48], [.73, 1.36], [.81, .82], [.49, .69],
            [.45, .04], [.13, .04], [0, .55], [-.13, .04]];
        for (const [depth, color, edge] of [
          [-4, '#164ba43d', '#4d9dff73'], [-2.55, '#307aea4d', '#8bd4ffa1'],
        ]) {
          const echo = silhouette.map(([dx, dy]) => [x + dx, y + dy, depth / scale]);
          this.face(echo, color);
          this.line([...echo, echo[0]], edge, 1.5);
        }
      }
      const anchor = y + (sliding ? .58 : 1.16);
      const length = this.reduceMotion ? SHORT_WAKE : DASH_WAKE;
      for (const side of [-1, 1]) {
        const at = (dx, dy, depth) => [x + side * dx, anchor + dy, depth / scale];
        this.face([at(.56, .24, -.24), at(.92, .29, -.86), at(1.28, -.48, -length),
          at(.83, -.22, -length * .65), at(.60, -.14, -.24)], '#2075ffaa');
        this.face([at(.63, .16, -.29), at(.84, .17, -.65), at(1.16, -.38, -length * .91),
          at(.72, -.08, -.36)], '#48baffee');
        this.face([at(.68, .095, -.36), at(.79, .103, -.55), at(1.01, -.19, -length * .64),
          at(.72, -.032, -.37)], '#e1f7ff');
      }
    }

    slideExhaust(x, y) {
      const rear = (this.reduceMotion ? SHORT_WAKE : SLIDE_WAKE) / this.longitudinalScale;
      for (const side of [-1, 1]) {
        const at = (dx, dy, z) => [x + side * dx, y + dy, z];
        this.face([at(.38, .06, .44), at(.79, .065, .58), at(1.18, .15, -rear),
          at(.58, .06, -rear * .73)], '#14c191a6');
        this.face([at(.47, .085, .22), at(.71, .105, .35), at(1.08, .17, -rear * .91),
          at(.63, .095, -rear * .64)], '#5affcce8');
        this.face([at(.52, .10, .14), at(.62, .12, .26), at(.94, .18, -rear * .70),
          at(.65, .12, -rear * .38)], '#d5ffee');
      }
    }

    drawSlideBurst(z, time) {
      const { x, y, time: started } = this.slideBurst;
      const progress = Math.max(0, (time - started) / SLIDE_BURST_TIME);
      const spread = 1 - (1 - progress) ** 2;
      const opacity = (1 - progress) ** 1.45;
      const radius = .78 + spread * 1.08;
      const scale = this.longitudinalScale;
      const arc = (angle, width) => Array.from({ length: 6 }, (_, index) => {
        const theta = angle + width * index / 5;
        return [x + Math.cos(theta) * radius, y + .055, z + Math.sin(theta) * radius * .70 / scale];
      });
      this.ctx.globalAlpha = opacity;
      for (const angle of [-1.34, .24, 1.80, 3.38]) {
        const points = arc(angle, 1.1);
        this.line(points, '#2ae2a675', 7);
        this.line(points, '#93ffdf', 2.4);
      }
      for (const side of [-1, 1]) {
        for (let index = 0; index < 7; index++) {
          const reach = .64 + repeatable(index * 4 + (side > 0 ? 751 : 797)) * 1.12;
          const kick = repeatable(index * 3 + 811);
          const dx = side * (.66 + reach * (.42 + spread));
          const dy = .13 + kick * (.46 + 2.1 * progress) * (1 - progress);
          const depth = (index % 3 - 1) * .38 - spread * (index / 6 + .32);
          const tip = [x + dx, y + dy, z + depth / scale];
          const tail = [x + dx - side * (.14 + .22 * kick), y + dy * .53,
            z + (depth + .20 + kick * .19) / scale];
          this.line([tail, tip], '#31ecb493', 4.3);
          this.line([tail, tip], index % 3 === 0 ? '#e4fff5' : '#76ffce', 1.65);
        }
      }
      this.ctx.globalAlpha = 1;
    }

    slidePlayer(x, y, signal) {
      for (const side of [-1, 1]) {
        const legX = x + side * .27;
        const reach = side > 0 ? .22 : 0;
        this.box(legX, y + .03, .56 + reach, .43, .23, .69, violet);
        this.box(legX, y + .19, .26 + reach, .40, .21, .68, suit);
      }
      this.box(x, y + .25, -.20, .95, .49, .69, violet);
      for (const side of [-1, 1]) {
        this.box(x + side * .59, y + .36, -.11, .30, .27, .51, suit);
        this.box(x + side * .66, y + .33, .21, .33, .21, .28, steel);
      }
      this.box(x, y + .37, -.62, .53, .34, .21, suit);
      this.box(x, y + .56, -.74, .30, .08, .026, [signal, signal, signal]);
      this.box(x, y + .71, -.31, .68, .57, .65, steel);
      this.box(x, y + .88, -.65, .56, .17, .035, ['#8966c3', '#221735', '#8463b3']);
      this.box(x, y + .94, -.67, .46, .042, .01, [signal, signal, signal]);
    }

    deathPlayer(run, { impact: hazard, elapsed }) {
      const { type, impact, impactTime = run.time } = hazard;
      const palette = deathPalettes[type];
      if (!palette || elapsed >= 1.05) return;
      const { ctx, longitudinalScale: scale } = this;
      const still = this.reduceMotion;
      const time = still ? 0 : elapsed;
      const poseTime = still ? reducedImpactPose[type] : time;
      const fade = 1 - easeOut((elapsed - .46) / .59);
      const z = impact.z - run.distance;
      const velocity = type === 'movingBarrier' ?
        (movingBarrierX(hazard, impactTime + .001) - movingBarrierX(hazard, impactTime - .001)) / .002 : 0;
      const direction = Math.abs(velocity) > .03 ? Math.sign(velocity) : 0;
      const { pitch = 0, roll = 0, x: shift = 0, y: lift = 0, depth = 0, size = 1 } =
        deathPose(type, poseTime, direction);
      const spread = easeOut(poseTime / .85);
      const split = still ? .28 : .06 + easeOut((time - .10) / .68) * .94;
      const halfHeight = run.sliding ? .62 : 1;
      let x = impact.x + shift;
      let bodyDepth = depth;
      if (type === 'gap') {
        const left = laneX(hazard.lane) - LANE_WIDTH / 2;
        const right = left + LANE_WIDTH * (hazard.lanes ?? 1);
        x += (clamp(x, left + .47, right - .47) - x) * spread;
        bodyDepth = Math.min(depth, Math.max(0, (hazard.end - impact.z) * scale) * .82);
      }
      x = clamp(x, -ROAD_HALF + .27, ROAD_HALF - .27);
      const sine = Math.sin(pitch);
      const cosine = Math.cos(pitch);
      const lean = Math.sin(roll);
      const upright = Math.cos(roll);
      const pivot = .96 * halfHeight;
      const transform = ([px, py, pz], [dx, dy, dz]) => {
        const height = (py * halfHeight - pivot) * size;
        const thick = pz * size;
        const rise = height * cosine - thick * sine;
        const rollX = px * size * upright - rise * lean;
        const rollY = px * size * lean + rise * upright;
        const y = impact.y + lift + pivot * size + rollY + dy;
        return [x + rollX + dx, type === 'gap' ? y : Math.max(.04, y),
          z + (bodyDepth + thick * cosine + height * sine + dz) / scale];
      };

      ctx.save();
      this.deathContact(run, hazard, z, time, fade, direction, palette);
      const pieces = [];
      const sliced = type === 'slideGate';
      const thickness = type === 'barrier' || type === 'movingBarrier' ? .25 : .17;
      const backFacing = cosine * COS + sine * SIN < 0;
      const width = Math.max(1, this.width - this.insets[0] - this.insets[2]);
      const edge = width * .035;
      const boundX = (point) => {
        // Limit only the visual travel at the outer lanes and retain the signed sweep.
        const view = this.viewPoint(point);
        const min = this.cameraX + (this.insets[0] + edge - this.centerX) * view[2] / this.focal;
        const max = this.cameraX + (this.width - this.insets[2] - edge - this.centerX) * view[2] / this.focal;
        return [clamp(point[0], min, max), point[1], point[2]];
      };
      for (let part = 0; part < deathPlates.length; part++) {
        const piecesForPlate = sliced ? slicedPlates[part] : [deathPlates[part]];
        for (let band = 0; band < piecesForPlate.length; band++) {
          const section = piecesForPlate[band];
          if (section.length < 3) continue;
          const side = part === 0 ? 0 : part % 2 ? -1 : 1;
          const random = repeatable(1901 + part);
          let shift = [side * split * (.23 + random * .40), split * (random - .45) * .6, split * (random - .5) * .85];
          if (sliced) {
            const slide = (band % 2 ? -1 : 1) * (.20 + band * .27) * (.10 + spread);
            shift = [slide, (band - 2) * (.024 + spread * .115), -(.16 + band * .32) * spread];
          } else if (type === 'spikes') {
            shift[1] += split * (part >= 5 ? 1.18 : random * .9);
          } else if (type === 'movingBarrier') {
            shift[0] += direction * split * (.25 + random * .68);
          } else if (type === 'gap') {
            shift = shift.map((value) => value * .27);
          }
          const at = (point, front) => boundX(transform([point[0], point[1], front], shift));
          const front = section.map((point) => at(point, -thickness));
          const back = section.map((point) => at(point, thickness));
          const visor = part === 0 && (!sliced || band === 3) ?
            [at([-.24, 1.60], -thickness - .006), at([.24, 1.60], -thickness - .006)] : null;
          const viewDepth = front.reduce((total, point) => total + this.viewPoint(point)[2], 0) / front.length;
          pieces.push({ near: backFacing ? back : front, far: backFacing ? front : back, viewDepth, visor });
        }
      }
      ctx.globalAlpha = fade;
      const [light, rim, face, dark] = palette;
      pieces.sort((a, b) => b.viewDepth - a.viewDepth);
      if (type === 'gap' && time >= .46) this.clipDeathGap(hazard, run.distance);
      for (const { near, far, visor } of pieces) {
        this.face(far, dark);
        for (let index = 0; index < near.length; index++) {
          const next = (index + 1) % near.length;
          this.face([far[index], far[next], near[next], near[index]], dark);
        }
        this.face(near, face);
        this.line([...near, near[0]], rim, sliced ? 1.3 : 1.65);
        if (visor) this.line(visor, light, 2.8);
      }
      if (!still) this.deathDebris(type, [impact.x, impact.y, z], time, bodyDepth, fade, direction, palette);
      ctx.restore();
    }

    clipDeathGap(hazard, distance) {
      const left = laneX(hazard.lane) - LANE_WIDTH / 2;
      const right = left + LANE_WIDTH * (hazard.lanes ?? 1);
      const near = hazard.z - distance;
      const far = hazard.end - distance;
      const hull = [[left, 0, near], [left, 0, far], [right, 0, far], [right, 0, near]];
      const visible = clip(hull.map((point) => this.viewPoint(point)));
      this.ctx.beginPath();
      for (const point of visible) this.ctx.lineTo(...this.screenPoint(point));
      this.ctx.closePath();
      this.ctx.clip();
    }

    deathContact(run, hazard, z, time, fade, direction, [light, rim, face]) {
      const { ctx } = this;
      const { type, impact: { x, y, z: impactDepth }, lane } = hazard;
      const scale = this.longitudinalScale;
      const spread = easeOut(time / .50);
      const at = (dx, dy, depth = 0) => [x + dx, y + dy, z + depth / scale];
      ctx.globalAlpha = .78 * fade;
      if (type === 'barrier' || type === 'movingBarrier' || type === 'platform') {
        const platform = type === 'platform';
        const { height, halfWidth, halfDepth } = platform ?
          { height: hazard.height ?? PLATFORM_HEIGHT, halfWidth: PLATFORM_HALF_WIDTH, halfDepth: 0 } : obstacles.barrier;
        const center = type === 'movingBarrier' ? movingBarrierX(hazard, hazard.impactTime ?? run.time) : laneX(lane);
        const front = hazard.z - run.distance - halfDepth;
        const end = (hazard.end ?? hazard.z + halfDepth) - run.distance;
        const side = z > front + .025 && Math.abs(x - center) > halfWidth ? Math.sign(x - center) : 0;
        const heightAt = clamp(y + (platform ? .55 : 1.04), .18, height - .18);
        const panel = (dx, dy) => [side ? center + side * (halfWidth + .004) :
          clamp(x + dx, center - halfWidth + .03, center + halfWidth - .03),
        clamp(heightAt + dy, .045, height - .035), side ? clamp(z + dx / scale, front, end) : front - .005];
        const imprint = [panel(-.52, .31), panel(-.23, .57), panel(.26, .55), panel(.53, .26),
          panel(.43, -.37), panel(.07, -.58), panel(-.43, -.39)];
        ctx.globalAlpha *= 1 - spread * .57;
        if (!platform) this.face(imprint, face + 'aa');
        this.line([...imprint, imprint[0]], rim, platform ? 1.6 : 2);
        const origin = panel(0, .12);
        this.line([panel(-.83, .51), panel(-.34, .18), origin, panel(-.17, -.23), panel(.12, -.65)], light, 1.8);
        this.line([panel(.79, .44), panel(.33, .28), origin, panel(.37, -.12), panel(.75, -.15)], rim, 1.5);
        if (platform) {
          ctx.globalAlpha = fade * .86;
          for (let chip = 0; chip < 8; chip++) {
            const drop = easeOut(Math.max(0, (this.reduceMotion ? .29 : time) - chip * .024) / .66);
            const offset = (repeatable(chip + 1690) - .5) * 1.31;
            const top = .40 - drop * .92 + repeatable(chip + 1772) * .27;
            this.face([panel(offset - .055, top), panel(offset + .077, top - .075),
              panel(offset + .032, top - .26)], chip % 3 === 0 ? light : rim);
          }
        }
        if (direction) {
          const sweep = direction * (.67 + spread * .92);
          this.line([at(-sweep * .36, .31, -.14), at(sweep, .41, -.35)], rim, 2.4);
        }
      } else if (type === 'slideGate') {
        const front = hazard.z - run.distance - .005;
        const middle = laneX(lane);
        const atBeam = (dx, dy) => [clamp(x + dx, middle - SLIDE_GATE_HALF_WIDTH, middle + SLIDE_GATE_HALF_WIDTH),
          clamp(y + 1.58, SLIDE_GATE_CLEARANCE, SLIDE_GATE_HEIGHT - .27) + dy, front];
        for (const offset of [0, .12]) {
          this.line([atBeam(-1.36, offset), atBeam(1.36, offset)], offset ? light : rim, offset ? 1.3 : 2.8);
        }
      } else if (type === 'spikes' || type === 'hurdle') {
        const spikes = type === 'spikes';
        const base = spikes ? clamp(y, .055, SPIKE_HEIGHT) : obstacles.hurdle.height;
        const front = spikes ? Math.max(0, hazard.z - impactDepth) :
          hazard.z - obstacles.hurdle.halfDepth - impactDepth - .005;
        const mark = (dx, height, depth = 0) => [x + dx, base + height, z + front + depth / scale];
        for (const side of [-1, 1]) {
          this.line([mark(side * .26, .03), mark(side * (.57 + .19 * spread), spikes ? .32 : .16, -.15),
            mark(side * (.46 + spread * .27), spikes ? .86 + .35 * spread : .06, -.08)],
          side > 0 ? light : rim, 1.9);
        }
      } else if (type === 'gap') {
        const left = laneX(lane) - LANE_WIDTH / 2;
        const right = left + LANE_WIDTH * (hazard.lanes ?? 1);
        const center = clamp(x, left + .56, right - .56);
        const depth = clamp(z + (.83 + spread * 2.5) / scale, hazard.z - run.distance, hazard.end - run.distance);
        ctx.save();
        this.clipDeathGap(hazard, run.distance);
        for (const offset of [0, .28, .57]) {
          const width = .54 - offset * .48;
          this.line([[center - width, -.16 - offset, depth], [center, -.42 - offset, depth],
            [center + width, -.16 - offset, depth]], rim, 1.55);
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    deathDebris(type, [x, y, z], time, depth, fade, direction, [light, rim, face]) {
      const scatter = easeOut((time - .05) / .91);
      if (scatter <= 0) return;
      this.ctx.globalAlpha = fade * Math.min(1, scatter * 5);
      const scale = this.longitudinalScale;
      const count = type === 'gap' ? 7 : type === 'slideGate' ? 12 : 19;
      for (let index = 0; index < count; index++) {
        const speed = repeatable(index * 4 + 1521);
        const angle = repeatable(index * 4 + 1522) * Math.PI * 2;
        const length = repeatable(index * 4 + 1523);
        const throwX = Math.cos(angle);
        let dx = throwX * (.34 + scatter * (1 + speed * 1.15));
        let dy = .86 + Math.sin(angle) * (.32 + .71 * scatter) - scatter ** 2 * .39;
        let dz = depth + (length - .5) * scatter * 2.2;
        let width = .035 + speed * .11;
        let height = width * (1.5 + length);
        switch (type) {
          case 'hurdle':
            dy = .31 + speed * scatter * 1.21;
            dz = .38 + scatter * (1.55 + length * 2.45);
            break;
          case 'movingBarrier':
            dx = throwX * .42 + direction * scatter * (.4 + speed * 2.63);
            dy += speed * .45;
            width *= 1.8;
            break;
          case 'slideGate':
            dx = throwX * (.37 + scatter * (1.25 + speed * 1.1));
            dy = .25 + index % 5 * .39;
            width *= 3.25;
            height = .022;
            break;
          case 'spikes':
            dx *= .66;
            dy = .37 + scatter * (.55 + speed * 3.0);
            height *= 2;
            break;
          case 'gap':
            dx *= .35;
            dy = .82 - scatter * (1.3 + speed * .88);
            width *= 1 - scatter * .7;
            break;
          case 'platform':
            dx *= .65;
            dy = .43 + speed * scatter * 1.15 - scatter ** 2 * .48;
            dz -= scatter * .60;
            break;
        }
        const centerX = clamp(x + dx, -ROAD_HALF - .08, ROAD_HALF + .08);
        const bottom = type === 'gap' ? y + dy : Math.max(.04, y + dy);
        const point = (offset, rise, reach) => [centerX + offset, bottom + rise, z + (dz + reach) / scale];
        this.face([point(-width, 0, .05), point(width * .68, height * .25, 0), point(width * .23, height, -.07)],
          index % 4 === 0 ? light : index % 4 === 1 ? face : rim);
      }
    }

    drawParticles(dt, distance) {
      for (const particle of this.particles) {
        particle.life -= dt;
        if (particle.life <= 0) continue;
        particle.x += particle.vx * dt;
        particle.y = Math.max(0.02, particle.y + particle.vy * dt);
        particle.z += particle.vz * dt;
        particle.vy -= 7 * dt;
        this.ctx.globalAlpha = Math.min(1, particle.life * 2.7);
        const color = particle.color;
        this.box(particle.x, particle.y, particle.z - distance, particle.size, particle.size,
          particle.size, [color, color, color]);
      }
      this.ctx.globalAlpha = 1;
      this.particles = this.particles.filter((particle) => particle.life > 0);
    }

    updateSpeed(run, dt, mode) {
      if (this.reduceMotion) return;
      const desired = speedWidening(mode === 'ended' ? START_SPEED : run.speed);
      const response = desired > this.widening ? 0.14 : 0.32;
      this.widening = mode === 'ready' ? desired : desired + (this.widening - desired) * Math.exp(-dt / response);
      if (mode !== 'running') return;
      const pace = runningPace(run.speed) * (run.braking ? 0.52 : 1);
      const decay = Math.exp(-dt * 10);
      // Integrate the same eased pace used by the reflectors so footfall timing survives frame gaps.
      const paceTravel = pace * dt + (this.pace - pace) * (1 - decay) / 10;
      this.stridePhase = (this.stridePhase + 10 * dt + 12 * paceTravel) % (Math.PI * 2);
      this.pace = pace + (this.pace - pace) * decay;
      const target = run.boosting ? 0.72 : 0;
      this.boostRush = target + (this.boostRush - target) * Math.exp(-dt * (target > this.boostRush ? 15 : 9));
      this.speedPulse *= Math.exp(-dt * 5.5);
      this.speedTravel += dt * (0.55 + 4.4 * (1 - 110 / (110 + run.speed)));
    }

    drawPace(intensity) {
      if (intensity < 0.01) return;
      const { ctx, width, height, centerX, horizon } = this;
      const [left, , right] = this.insets;
      const gutter = Math.min((width - left - right) * 0.16, height * 0.26);
      if (gutter <= 0) return;
      const length = gutter * (0.08 + 0.56 * this.pace ** 2);
      ctx.strokeStyle = '#c9a3f4';
      ctx.lineWidth = 0.72 + 0.76 * this.pace;
      for (let index = 0; index < PACE_LINES; index++) {
        const line = this.speedLines[index];
        const side = Math.sign(line.x);
        const edge = side < 0 ? left : width - right;
        const phase = (line.offset + this.speedTravel * 0.5 * line.pace) % 1;
        const inset = gutter * (1 - phase);
        const x = edge - side * inset;
        const y = horizon + height * (0.29 + line.y * 0.27) * (0.68 + 0.32 * phase);
        const dx = Math.min(inset, length * line.size);
        const dy = dx * (y - horizon) / Math.max(1, Math.abs(x - centerX));
        ctx.globalAlpha = intensity * line.size * Math.min(1, phase * 6, (1 - phase) * 5);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + side * dx, y + dy);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    drawBoost(intensity) {
      const { ctx, width, height, horizon } = this;
      const [left, , right] = this.insets;
      const gutter = (width - left - right) * 0.14;
      if (gutter <= 0) return;
      for (const side of [-1, 1]) {
        const edge = side < 0 ? left : width - right;
        const inward = -side;
        const glow = ctx.createLinearGradient(edge, 0, edge + inward * gutter, 0);
        glow.addColorStop(0, `rgba(52, 244, 180, ${intensity * .26 + this.speedPulse * .10})`);
        glow.addColorStop(1, '#34f4b400');
        ctx.fillStyle = glow;
        ctx.fillRect(side < 0 ? edge : edge - gutter, 0, gutter, height);
        for (let index = 0; index < 7; index++) {
          const line = this.speedLines[index * 2 + (side < 0 ? 0 : 1)];
          const phase = (line.offset + this.speedTravel * line.pace) % 1;
          const start = 1 - phase * .68;
          const end = Math.max(.018, start - (.25 + intensity * .28) * line.size);
          const y = horizon + height * (.28 + phase * .46 + line.y * .12);
          const slope = height * (.095 + intensity * .13);
          const opacity = intensity * Math.min(phase * 7, (1 - phase) * 6, 1) * line.size;
          ctx.beginPath();
          ctx.moveTo(edge + inward * gutter * start, y);
          ctx.lineTo(edge + inward * gutter * end, y + (start - end) * slope);
          ctx.lineWidth = 1.15 + intensity * line.size * 1.5;
          ctx.strokeStyle = `rgba(160, 255, 218, ${opacity * .9})`;
          ctx.stroke();
        }
      }
    }

    drawDash() {
      const { ctx, width, height } = this;
      // Keep the dash effect inside the outer gutters so obstacles stay readable.
      const [left, , right] = this.insets;
      const gutter = (width - left - right) * 0.14;
      if (gutter <= 0) return;
      for (const side of [-1, 1]) {
        const edge = side < 0 ? left : width - right;
        const inward = -side;
        const glow = ctx.createLinearGradient(edge, 0, edge + inward * gutter, 0);
        glow.addColorStop(0, '#4c9fff63');
        glow.addColorStop(1, '#4c9fff00');
        ctx.fillStyle = glow;
        ctx.fillRect(side < 0 ? edge : edge - gutter, 0, gutter, height);

        for (let index = 0; index < 5; index++) {
          const phase = (this.speedTravel * 0.8 + (index + 0.18) / 5) % 1;
          const near = edge + inward * gutter * (0.95 - phase * 0.36);
          const far = edge + inward * gutter * Math.max(.018, .72 - phase * .76);
          const y = height * (0.20 + phase * 0.66);
          const endY = y + height * (0.026 + phase * 0.048);
          const opacity = Math.min(phase * 7, (1 - phase) * 7, 1);
          ctx.beginPath();
          ctx.moveTo(near, y);
          ctx.lineTo(far, endY);
          ctx.lineTo(far, endY + height * (0.009 + phase * 0.012));
          ctx.closePath();
          ctx.fillStyle = `rgba(77, 166, 255, ${opacity * 0.58})`;
          ctx.fill();

          ctx.beginPath();
          ctx.moveTo(near, y);
          ctx.lineTo(far, endY);
          ctx.lineWidth = 1.5 + phase * 2.8;
          ctx.strokeStyle = `rgba(195, 230, 255, ${opacity * 0.93})`;
          ctx.stroke();
        }
      }
    }

    frameCamera(run) {
      const { width, height } = this;
      this.setViewDistance(run.viewDistance);
      const [left, top, right, bottom] = this.insets;
      const usableWidth = Math.max(1, width - left - right);
      const usableHeight = Math.max(1, height - top - bottom);
      const short = width > height && usableHeight <= 500;
      const compact = short || usableWidth <= 760 || usableWidth < usableHeight;
      // Keep world z = -1 at its original camera depth while the rest of the scene scales.
      this.cameraBack = 9.8 + this.longitudinalScale;
      this.cameraY = 5.35;
      this.centerX = left + usableWidth * (compact ? 0.5 : 0.5 + 0.185 * this.openingBlend);
      this.centerY = top + usableHeight * (short ? 0.47 : compact ? 0.54 : 0.56);
      const heightLimit = usableHeight * (short ? 0.90 : 1.12);
      const baseFocal = Math.min(usableWidth * 0.8, heightLimit);
      // Limit lateral follow at the nearest playable rails, using the narrowest field of view.
      const railDepth = (this.cameraBack + this.projectedDepth(-1)) * COS + this.cameraY * SIN;
      const followLimit = Math.max(0, (usableWidth / 2 - 4) * railDepth / baseFocal - (ROAD_HALF + 0.2));
      const follow = Math.max(-followLimit, Math.min(followLimit, run.x * 0.22));
      this.cameraX = compact ? 0 : -1.18 * this.openingBlend + follow;
      this.focal = baseFocal * (1 - this.widening * (compact ? 0.8 : 1));
      this.horizon = this.centerY - this.focal * SIN / COS;
    }

    drawCourseObjects(run, time, ready, dashing, boosting, death = null) {
      const limit = this.viewDistance * OBSTACLE_VIEW_FRACTION;
      const rear = -this.rearViewDistance;
      let playerDepth = 0;
      if (!run.airborne && run.height > 0 && (dashing || boosting)) {
        // Paint the supporting deck beneath the whole wake before drawing the runner.
        const wake = this.reduceMotion ? SHORT_WAKE : dashing ? DASH_WAKE : SLIDE_WAKE;
        playerDepth = -wake / this.longitudinalScale;
      }
      const atDepth = new Map();
      const spans = [];
      const addPoint = (z, item) => {
        if (z < rear || z >= limit) return;
        if (!atDepth.has(z)) atDepth.set(z, []);
        atDepth.get(z).push(item);
      };
      if (!run.crash && !death) addPoint(playerDepth, { type: 'player' });
      if (this.slideBurst) {
        const z = this.slideBurst.z - run.distance;
        const orderDepth = this.slideBurst.y > 0 ? Math.max(rear, z - 1.8 / this.longitudinalScale) : z;
        if (z >= rear) addPoint(orderDepth, { type: 'slideBurst', z });
      }
      for (const obstacle of run.obstacles) {
        const z = obstacle.z - run.distance;
        switch (obstacle.type) {
          case 'gap':
            break;
          case 'spikes':
            this.spikes(obstacle, run.distance);
            break;
          case 'platform':
          case 'slideGate': {
            const near = Math.max(rear, z);
            const far = Math.min(limit, obstacle.end - run.distance);
            if (near >= far) break;
            spans.push({ obstacle, near, far });
            if (!atDepth.has(near)) atDepth.set(near, []);
            if (!atDepth.has(far)) atDepth.set(far, []);
            break;
          }
          default:
            addPoint(z, obstacle);
        }
      }
      for (const bolt of run.bolts ?? []) addPoint(bolt.z - run.distance, { type: 'bolt', bolt });

      const depths = [...atDepth.keys()].sort((a, b) => b - a);
      const ambient = (z) => Math.min(1, (185 - this.projectedDepth(z)) / 112);
      for (let index = 0; index < depths.length; index++) {
        const z = depths[index];
        for (const item of atDepth.get(z)) {
          this.ctx.globalAlpha = item.type === 'player' ? 1 : ambient(z);
          if (item.type === 'player') {
            this.player(run, time, ready, dashing, boosting);
          } else if (item.type === 'slideBurst') {
            this.drawSlideBurst(item.z, run.time);
          } else if (item.type === 'bolt') {
            this.bolt(item.bolt, z);
          } else if (item.type === 'movingBarrier') {
            const impactTime = death && item.id === death.impact.id ? death.impact.impactTime : undefined;
            this.movingBarrier(item, z, impactTime ?? run.time);
          } else if (item.type === 'blackHole') {
            this.blackHole(item, z, this.reduceMotion ? 0 : time);
          } else if (Object.hasOwn(obstacles, item.type)) {
            const x = laneX(item.lane);
            const halfWidth = obstacles[item.type].halfWidth;
            if (halfWidth) this.flat(x - halfWidth - 0.11, x + halfWidth + 0.11, z - 0.63, z + 0.54, '#130b20b5', .028);
            this[item.type](x, z);
          }
        }
        // Each span draws the part behind this depth before painting the part in front of it.
        const near = depths[index + 1];
        if (near === undefined) break;
        for (const span of spans) {
          if (near < span.near || z > span.far) continue;
          this.ctx.globalAlpha = ambient(span.near);
          this[span.obstacle.type](span.obstacle, run.distance, near, z);
        }
      }
      this.ctx.globalAlpha = 1;
      if (death) this.deathPlayer(run, death);
    }

    draw(run, time, dt, mode, latestClue = 0, signal = null, death = null) {
      const ready = mode === 'ready';
      const dashing = mode === 'running' && run.dashing;
      const boosting = mode === 'running' && run.boosting;
      if (this.slideBurst && (mode !== 'running' || run.time - this.slideBurst.time >= SLIDE_BURST_TIME)) {
        this.slideBurst = null;
      }
      this.updateSpeed(run, dt, mode);
      if (ready || this.reduceMotion) this.openingBlend = ready ? 1 : 0;
      else this.openingBlend *= Math.exp(-dt * 8);
      this.frameCamera(run);

      this.sky(this.reduceMotion ? 0 : time, latestClue, signal);
      this.deepVoid(run.distance);
      this.track(run, ready);
      this.drawCourseObjects(run, time, ready, dashing, boosting, mode === 'dying' ? death : null);
      this.drawParticles(dt, run.distance);
      if (mode === 'running' && !this.reduceMotion) {
        if (dashing) this.drawDash();
        else {
          const boost = Math.min(1, this.boostRush + this.speedPulse * 0.40);
          const pace = (0.065 + 0.44 * this.pace ** 1.4) * Math.max(0, 1 - boost * 5);
          this.drawPace(pace);
          if (boost >= 0.03) this.drawBoost(boost);
        }
      }
    }
  }

  globalThis.VoidScene = Scene;
})();
