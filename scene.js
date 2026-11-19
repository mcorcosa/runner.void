(function () {
  'use strict';

  const { LANE_WIDTH, LANE_COUNT, START_SPEED, MIN_VIEW_DISTANCE, SPIKE_HEIGHT, laneX, obstacles } = globalThis.VoidRunner;
  const ROAD_HALF = LANE_WIDTH * LANE_COUNT / 2;
  const TILE = 6;
  const FAR_TILES = 36;
  const MARKING_TILES = 24;
  const OBSTACLE_VIEW_FRACTION = 0.9;
  const CUT_DEPTH = 2.15;
  const NEAR = 1.3;
  const PITCH = 0.207;
  const SIN = Math.sin(PITCH);
  const COS = Math.cos(PITCH);

  const steel = ['#ada4d5', '#4b426a', '#80739f'];
  const violet = ['#aa89f4', '#36274f', '#624693'];
  const suit = ['#63558c', '#252036', '#3f345a'];
  const amber = ['#ffd18b', '#a65a3a', '#d58b53'];
  const pink = ['#e49aff', '#823c9c', '#a65ac1'];

  function repeatable(index) {
    const value = Math.sin(index * 19.829 + 4.51) * 43758.5453;
    return value - Math.floor(value);
  }

  function speedWidening(speed) {
    const extra = Math.max(0, speed - START_SPEED);
    return 0.32 * (1 - 36 / (36 + extra));
  }

  function levelOfDetail(distance, spacing, count) {
    return Math.max(1, 2 ** Math.ceil(Math.log2(distance / (spacing * count))));
  }

  function deckSurfaces(missing) {
    if (missing < 0) return [[-ROAD_HALF, ROAD_HALF]];
    const x = laneX(missing);
    return [[-ROAD_HALF, x - LANE_WIDTH / 2], [x + LANE_WIDTH / 2, ROAD_HALF]];
  }

  function clip(points) {
    const visible = [];
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      const next = points[(index + 1) % points.length];
      if (point[2] >= NEAR) visible.push(point);
      if ((point[2] >= NEAR) !== (next[2] >= NEAR)) {
        const mix = (NEAR - point[2]) / (next[2] - point[2]);
        visible.push([point[0] + (next[0] - point[0]) * mix, point[1] + (next[1] - point[1]) * mix, NEAR]);
      }
    }
    return visible;
  }

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
      this.speedPulse = 0;
      this.speedTravel = 0;
      this.rush = 0;
      this.widening = this.reduceMotion ? 0 : speedWidening(speed);
    }

    pulseSpeed() {
      if (!this.reduceMotion) this.speedPulse = 1;
    }

    scatter(kind, run, obstacle) {
      if (this.reduceMotion) return;
      const impact = kind === 'break' || kind === 'crash';
      const x = impact ? obstacle.impact.x : run.x;
      const z = impact ? obstacle.impact.z : run.distance + 1;
      const y = impact ? obstacle.impact.y : 0;
      const color = kind === 'boost' ? '#98ffe3' : kind === 'land' ? '#ac89eb' :
        obstacle.type === 'spikes' ? '#ff788e' : obstacle.type === 'roadblock' ? '#ffe787' : '#ec9dff';
      const count = impact ? 28 : kind === 'boost' ? 18 : 8;
      for (let index = 0; index < count; index++) {
        this.particles.push({
          x: x + (Math.random() - 0.5) * 1.35,
          y: impact ? y + 0.12 + Math.random() * (kind === 'break' ? 1.15 : 0.55) : 0.1,
          z: z + (Math.random() - 0.5) * 0.7,
          vx: (Math.random() - 0.5) * 8,
          vy: 0.6 + Math.random() * 4,
          vz: (Math.random() - 0.65) * 14,
          size: 0.035 + Math.random() * 0.09,
          life: 0.38 + Math.random() * 0.42,
          color,
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

    sky(time) {
      const { ctx, width, height, centerX, horizon } = this;
      const backdrop = ctx.createLinearGradient(0, 0, 0, height);
      backdrop.addColorStop(0, '#0c0a1b');
      backdrop.addColorStop(0.32, '#100e24');
      backdrop.addColorStop(0.56, '#050b17');
      backdrop.addColorStop(1, '#02050d');
      ctx.fillStyle = backdrop;
      ctx.fillRect(0, 0, width, height);

      const moonX = centerX + width * 0.05;
      const moonY = horizon - height * 0.105;
      const radius = height * 0.19;
      const haze = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, width * 0.46);
      haze.addColorStop(0, '#8252c74d');
      haze.addColorStop(0.27, '#6736a939');
      haze.addColorStop(1, '#4a237000');
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, width, height);

      for (const star of this.stars) {
        const size = star.light > 0.95 ? 2 : 1;
        ctx.fillStyle = `rgba(212,185,255,${0.13 + star.light * 0.47})`;
        ctx.fillRect(star.x * width, star.y * height, size, size);
      }

      const eclipse = ctx.createLinearGradient(0, moonY - radius, 0, moonY + radius);
      eclipse.addColorStop(0, '#170e2b');
      eclipse.addColorStop(1, '#35185132');
      ctx.beginPath();
      ctx.arc(moonX, moonY, radius, 0, Math.PI * 2);
      ctx.fillStyle = eclipse;
      ctx.fill();
      ctx.strokeStyle = '#a978f36a';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      for (let ring = 0; ring < 3; ring++) {
        ctx.beginPath();
        ctx.arc(moonX, moonY, radius + 7 + ring * 12, Math.PI * (0.9 + ring * .17), Math.PI * (1.48 + ring * .25));
        ctx.strokeStyle = ['#bf93ff5e', '#b488ec30', '#b488ec23'][ring];
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      const depthHaze = ctx.createLinearGradient(0, horizon - height * 0.10, 0, horizon + height * 0.12);
      depthHaze.addColorStop(0, '#030b1800');
      depthHaze.addColorStop(1, '#030a17d6');
      ctx.fillStyle = depthHaze;
      ctx.fillRect(0, 0, width, height);

      for (let i = 0; i < 30; i++) {
        const side = i % 2 ? 1 : -1;
        const x = centerX + side * width * (0.11 + repeatable(i + 37) * 0.45);
        const y = horizon + height * (repeatable(i + 173) * .53 - .09);
        const size = 1.5 + repeatable(i + 67) * 10;
        ctx.save();
        ctx.translate(x, y + Math.sin(time * 0.45 + i) * size * 0.25);
        ctx.rotate(0.2 + repeatable(i + 89) * 1.6);
        ctx.fillStyle = '#28334d';
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.fillStyle = '#8b9cdf62';
        ctx.fillRect(-size / 2, -size / 2, size, 1);
        ctx.restore();
      }
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

      for (const gap of gaps) {
        const x = laneX(gap.lane);
        const entry = gap.z - distance;
        const resume = gap.end - distance;
        if (entry >= -this.rearViewDistance && entry <= this.viewDistance) {
          this.ctx.globalAlpha = Math.min(1, (210 - this.projectedDepth(entry)) / 130);
          this.flat(x - 1.17, x + 1.17, entry - 0.8, entry, '#dfb557', 0.034);
        }
        if (resume >= -this.rearViewDistance && resume + 1.52 <= this.viewDistance) {
          this.ctx.globalAlpha = Math.max(0.48, Math.min(1, (210 - this.projectedDepth(resume)) / 130));
          this.flat(x - 1.19, x + 1.19, resume, resume + 0.58, '#59a3ab', 0.034);
          for (const offset of [-0.78, 0, 0.78]) {
            this.flat(x + offset - 0.20, x + offset + 0.20, resume + 0.62, resume + 1.52, '#99edf0', 0.034);
          }
        }
      }
      this.ctx.globalAlpha = 1;
    }

    trackTile(distance, gaps, selected, start, end) {
      const near = start - distance;
      const far = end - distance;
      const dust = Math.min(1, Math.max(0.22, (210 - this.projectedDepth(near)) / 145));
      this.ctx.globalAlpha = dust;
      // Work in world coordinates at the cut, irrespective of the section's level of detail.
      const gap = gaps.find((obstacle) => obstacle.z < end && obstacle.end > start);
      if (!gap) {
        this.deckSection(near, far, selected, -1);
        return;
      }

      const entry = Math.max(near, gap.z - distance);
      const resume = Math.min(far, gap.end - distance);
      this.deckSection(resume, far, selected, -1);
      if (gap.end <= end) {
        this.ctx.globalAlpha = Math.max(0.48, dust);
        this.cutLip(laneX(gap.lane), resume);
        this.ctx.globalAlpha = dust;
      }
      this.deckSection(entry, resume, selected, gap.lane);
      this.deckSection(near, entry, selected, -1);
    }

    trackMarks(distance, gaps, start, end, stride, opacity) {
      const scale = stride / TILE;
      const first = Math.floor(start / stride);
      const last = Math.ceil(end / stride) - 1;
      for (let tile = last; tile >= first; tile--) {
        const z = tile * stride;
        const near = z - distance;
        const gap = gaps.find((cut) => cut.z < z + stride && cut.end > z);
        const missing = gap?.lane ?? -1;
        this.ctx.globalAlpha = opacity * Math.min(1, Math.max(0.22, (210 - this.projectedDepth(near)) / 145));
        if (z >= start) {
          for (const [left, right] of deckSurfaces(missing)) {
            if (left < right) this.flat(left, right, near, Math.min(end - distance, near + .09 * scale), '#130f20', .018);
          }
        }
        const markerStart = Math.max(start - distance, near + 1.05 * scale);
        const markerEnd = Math.min(end - distance, near + 2.1 * scale);
        if (markerStart >= markerEnd) continue;
        for (let lane = 1; lane < LANE_COUNT; lane++) {
          if (lane === missing || lane - 1 === missing) continue;
          const edge = -ROAD_HALF + lane * LANE_WIDTH;
          this.flat(edge - 0.018, edge + 0.018, markerStart, markerEnd, '#9b77c7', 0.023);
        }
        for (const side of [-1, 1]) {
          if (missing === (side < 0 ? 0 : LANE_COUNT - 1)) continue;
          const edge = side * ROAD_HALF;
          this.flat(edge - 0.064, edge + 0.064, markerStart, markerEnd, '#dfbcff', 0.037);
        }
        if (gap) {
          const braceNear = Math.max(start - distance, gap.z - distance, near + 3.65 * scale);
          const braceFar = Math.min(end - distance, gap.end - distance, near + 4.25 * scale);
          if (braceFar <= braceNear) continue;
          const left = laneX(missing) - LANE_WIDTH / 2;
          const right = left + LANE_WIDTH;
          if (missing > 0 && this.cameraX > left) this.cutBrace(left, braceNear, braceFar);
          if (missing < LANE_COUNT - 1 && this.cameraX < right) this.cutBrace(right, braceNear, braceFar);
        }
      }
    }

    deckSection(near, far, selected, missing) {
      if (far <= near) return;
      const half = LANE_WIDTH / 2;
      const cut = laneX(missing);
      if (missing > 0) this.cutWall(cut - half, near, far);
      if (missing >= 0 && missing < LANE_COUNT - 1) this.cutWall(cut + half, near, far);
      for (const [left, right] of deckSurfaces(missing)) {
        if (right <= left) continue;
        this.flat(left, right, near, far, '#261b38');
      }
      if (missing > 0) this.flat(cut - half - 0.16, cut - half, near, far, '#929ec1', 0.025);
      if (missing >= 0 && missing < LANE_COUNT - 1) {
        this.flat(cut + half, cut + half + 0.16, near, far, '#929ec1', 0.025);
      }
      if (selected >= 0 && selected !== missing) {
        const x = laneX(selected);
        this.flat(x - half + 0.045, x + half - 0.045, near, far, '#302248', 0.012);
      }
      for (let lane = 1; lane < LANE_COUNT; lane++) {
        if (lane === missing || lane - 1 === missing) continue;
        const edge = -ROAD_HALF + lane * LANE_WIDTH;
        this.flat(edge - 0.025, edge + 0.025, near, far, '#61477d', 0.019);
      }
      for (const side of [-1, 1]) {
        if (missing === (side < 0 ? 0 : LANE_COUNT - 1)) continue;
        const edge = side * ROAD_HALF;
        this.flat(edge - 0.20, edge + 0.20, near, far, '#583888', 0.025);
        this.flat(edge - 0.037, edge + 0.037, near, far, '#a77cf9', 0.032);
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
      this.box(x, 0, z, 1.92, 0.17, 0.47, ['#7b5271', '#44314d', '#987182']);
      this.box(x, 0.17, z, 1.92, 0.54, 0.5, amber);
      const front = z - 0.252;
      const dashes = [-0.61, -0.13, 0.35];
      for (const dash of dashes) {
        this.face([[x + dash, .25, front], [x + dash + .19, .25, front],
          [x + dash + .42, .61, front], [x + dash + .23, .61, front]], '#592f3d');
      }
      this.line([[x - 0.94, .67, front], [x + 0.94, .67, front]], '#ffe3ac', 1.6);
    }

    barrier(x, z) {
      const front = z - 0.323;
      this.box(x, 0, z, 1.98, 2.48, 0.64, pink);
      this.face([[x - .82, .17, front], [x + .81, .17, front], [x + .81, 2.31, front],
        [x - .54, 2.31, front], [x - .82, 2.03, front]], '#532766');
      this.line([[x - .86, .16, front], [x - .86, 2.03, front], [x - .54, 2.34, front],
        [x + .83, 2.34, front], [x + .83, .15, front], [x - .86, .15, front]], '#e4a8f8', 1.3);
      const crack = [[x + .35, 2.30, front], [x - .08, 1.75, front], [x + .17, 1.45, front],
        [x - .29, 1.09, front], [x - .07, 0.86, front], [x - .44, 0.16, front]];
      this.line(crack, '#be5ede', 5.4);
      this.line(crack, '#f7c1ff', 2);
      this.line([[x + .7, .73, front], [x + .42, 1.01, front], crack[3], [x - .55, 1.44, front]], '#ec9df8', 1.1);
    }

    roadblock(x, z) {
      const { width, height, depth } = obstacles.roadblock;
      this.box(x, 0, z + depth / 2, width, height, depth, ['#ffe687', '#695036', '#b98a44']);
      const front = z - 0.003;
      this.face([[x - 1.10, 0.24, front], [x + 1.10, 0.24, front], [x + 1.10, 1.96, front],
        [x - 1.10, 1.96, front]], '#2c2433');
      for (const offset of [-0.69, 0, 0.69]) {
        this.face([[x + offset - 0.28, 0.82, front], [x + offset + 0.04, 0.82, front],
          [x + offset + 0.30, 1.38, front], [x + offset - 0.02, 1.38, front]], '#ffda65');
      }
      this.line([[x - 1.11, 1.92, front], [x + 1.11, 1.92, front]], '#fff1af', 2.2);
      this.line([[x - 1.11, 0.29, front], [x + 1.11, 0.29, front]], '#ffc752', 1.7);
    }

    spikes(patch, distance) {
      const left = laneX(patch.lane) - LANE_WIDTH / 2 + 0.1;
      const right = left + LANE_WIDTH * patch.lanes - 0.2;
      const limit = this.viewDistance * OBSTACLE_VIEW_FRACTION;
      for (let tile = patch.tiles - 1; tile >= 0; tile--) {
        const start = patch.z - distance + tile * patch.tileLength;
        const end = start + patch.tileLength;
        if (end < -this.rearViewDistance || start > limit) continue;
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

    player(run, time, ready, dashing) {
      const x = run.x;
      const lift = run.height;
      const sliding = run.sliding;
      const stride = this.reduceMotion || run.airborne || ready || sliding ? 0 : Math.sin(run.time * 14);
      const bob = this.reduceMotion || run.airborne || sliding ? 0 : ready ? Math.sin(time * 1.9) * 0.035 : Math.abs(stride) * 0.055;
      const y = lift + bob;
      const landingCue = run.slideWindowOpen || (run.boosting && !dashing);
      const ring = landingCue ? '#9bffe6' : dashing ? '#90d9ff' : '#c0a0ff';
      const signal = landingCue ? '#65ffd7' : dashing ? '#a6e1ff' : '#ab82fa';
      const overCut = run.obstacles.some((obstacle) => obstacle.type === 'gap' &&
        obstacle.z < run.distance + 0.59 && obstacle.end > run.distance - 0.75 &&
        Math.abs(laneX(obstacle.lane) - x) < LANE_WIDTH / 2 + 0.87);
      if (!overCut) {
        this.flat(x - .67, x + .67, -.49, sliding ? .91 : .59, '#0e0a18a8', .032);
        this.ctx.globalAlpha = landingCue || dashing ? 1 : 0.57;
        this.line([[x - .65, .035, -.75], [x - .87, .035, -.35], [x - .87, .035, .38]], ring, 2);
        this.line([[x + .65, .035, -.75], [x + .87, .035, -.35], [x + .87, .035, .38]], ring, 2);
        this.ctx.globalAlpha = 1;
      }

      if (!this.reduceMotion && (dashing || run.boosting)) {
        const trail = dashing ? '#56b6ffad' : '#6fffd37d';
        const core = dashing ? '#cfedff' : '#b9ffea';
        const length = dashing ? 6.1 : 4.1;
        const anchor = sliding ? y - .51 : y;
        for (const side of [-1, 1]) {
          const end = [x + side * 1.15, y + .36, -length];
          this.face([[x + side * .57, anchor + 1.24, 0], [x + side * .73, anchor + .92, 0], end], trail);
          this.line([[x + side * .66, anchor + 1.09, 0], [x + side * .92, anchor + .71, -length * .65]], core, dashing ? 3.2 : 2.2);
        }
      }

      if (sliding) {
        this.slidePlayer(x, signal);
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

    slidePlayer(x, signal) {
      for (const side of [-1, 1]) {
        const legX = x + side * .27;
        const reach = side > 0 ? .22 : 0;
        this.box(legX, .03, .56 + reach, .43, .23, .69, violet);
        this.box(legX, .19, .26 + reach, .40, .21, .68, suit);
      }
      this.box(x, .25, -.20, .95, .49, .69, violet);
      for (const side of [-1, 1]) {
        this.box(x + side * .59, .36, -.11, .30, .27, .51, suit);
        this.box(x + side * .66, .33, .21, .33, .21, .28, steel);
      }
      this.box(x, .37, -.62, .53, .34, .21, suit);
      this.box(x, .56, -.74, .30, .08, .026, [signal, signal, signal]);
      this.box(x, .71, -.31, .68, .57, .65, steel);
      this.box(x, .88, -.65, .56, .17, .035, ['#8966c3', '#221735', '#8463b3']);
      this.box(x, .94, -.67, .46, .042, .01, [signal, signal, signal]);
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
      const baseRush = speedWidening(run.baseSpeed);
      const boostRush = (run.boosting ? 0.72 : 0) + (run.dashing ? 1 : 0);
      const target = mode === 'running' ? Math.min(1, baseRush + boostRush) : 0;
      this.rush = target + (this.rush - target) * Math.exp(-dt * (target > this.rush ? 15 : 9));
      this.speedPulse *= Math.exp(-dt * 5.5);
      this.speedTravel += dt * (0.55 + 4.4 * (1 - 110 / (110 + run.speed)));
    }

    drawSpeed(run) {
      const intensity = Math.min(1, this.rush + this.speedPulse * 0.40);
      if (intensity < 0.03) return;
      const { ctx, width, height, centerX, horizon } = this;
      const tint = run.boosting ? '112, 255, 212' : '191, 135, 255';
      const core = run.boosting ? '226, 255, 247' : '245, 226, 255';
      const originY = horizon + height * 0.07;
      const edge = ctx.createRadialGradient(centerX, originY, Math.min(width, height) * 0.31,
        centerX, originY, Math.hypot(width * 0.54, height * 0.65));
      edge.addColorStop(0, `rgba(${tint}, 0)`);
      edge.addColorStop(1, `rgba(${tint}, ${intensity * 0.17 + this.speedPulse * 0.2})`);
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, width, height);

      for (const line of this.speedLines) {
        const phase = (line.offset + this.speedTravel * line.pace) % 1;
        const start = 0.35 + phase * 0.86;
        const end = start + (0.046 + intensity * 0.23) * line.size;
        const dx = line.x * width * 0.67;
        const dy = line.y * height * 0.94;
        const opacity = intensity * Math.min(phase * 7, (1 - phase) * 6, 1) * line.size;
        ctx.beginPath();
        ctx.moveTo(centerX + dx * start, originY + dy * start);
        ctx.lineTo(centerX + dx * end, originY + dy * end);
        ctx.lineWidth = 1.5 + intensity * line.size * 4;
        ctx.strokeStyle = `rgba(${tint}, ${opacity * 0.26})`;
        ctx.stroke();

        const coreStart = end - (end - start) * 0.66;
        ctx.beginPath();
        ctx.moveTo(centerX + dx * coreStart, originY + dy * coreStart);
        ctx.lineTo(centerX + dx * end, originY + dy * end);
        ctx.lineWidth = 0.7 + intensity * line.size * 1.5;
        ctx.strokeStyle = `rgba(${core}, ${opacity * 0.92})`;
        ctx.stroke();
      }
    }

    drawDash() {
      const { ctx, width, height } = this;
      // Keep the dash effect inside the outer gutters so obstacles stay readable.
      const gutter = width * 0.14;
      for (const side of [-1, 1]) {
        const edge = side < 0 ? 0 : width;
        const inward = -side;
        const glow = ctx.createLinearGradient(edge, 0, edge + inward * gutter, 0);
        glow.addColorStop(0, '#4c9fff63');
        glow.addColorStop(1, '#4c9fff00');
        ctx.fillStyle = glow;
        ctx.fillRect(side < 0 ? 0 : width - gutter, 0, gutter, height);

        for (let index = 0; index < 5; index++) {
          const phase = (this.speedTravel * 0.8 + (index + 0.18) / 5) % 1;
          const near = edge + inward * gutter * (0.95 - phase * 0.36);
          const far = near - inward * gutter * (0.23 + phase * 0.40);
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

    draw(run, time, dt, mode) {
      const ready = mode === 'ready';
      const dashing = mode === 'running' && run.dashing;
      this.updateSpeed(run, dt, mode);
      this.openingBlend = ready ? 1 : this.openingBlend * Math.exp(-dt * 8);
      this.frameCamera(run);

      this.sky(this.reduceMotion ? 0 : time);
      this.deepVoid(run.distance);
      this.track(run, ready);
      for (const obstacle of run.obstacles) {
        if (obstacle.type === 'spikes') this.spikes(obstacle, run.distance);
      }
      const obstacleView = this.viewDistance * OBSTACLE_VIEW_FRACTION;
      const visible = run.obstacles.filter((obstacle) => obstacles[obstacle.type] &&
        obstacle.z - run.distance >= -this.rearViewDistance && obstacle.z - run.distance < obstacleView);
      let playerDrawn = false;
      for (const obstacle of visible.reverse()) {
        const z = obstacle.z - run.distance;
        if (z < 0 && !playerDrawn) {
          this.player(run, time, ready, dashing);
          playerDrawn = true;
        }
        this.ctx.globalAlpha = Math.min(1, (185 - this.projectedDepth(z)) / 112);
        const x = laneX(obstacle.lane);
        const halfWidth = obstacles[obstacle.type].halfWidth;
        if (halfWidth) this.flat(x - halfWidth - 0.11, x + halfWidth + 0.11, z - 0.63, z + 0.54, '#130b20b5', .028);
        this[obstacle.type](x, z);
        this.ctx.globalAlpha = 1;
      }
      if (!playerDrawn) this.player(run, time, ready, dashing);
      this.drawParticles(dt, run.distance);
      if (mode === 'running' && !this.reduceMotion) {
        if (dashing) this.drawDash();
        else this.drawSpeed(run);
      }
    }
  }

  globalThis.VoidScene = Scene;
})();
