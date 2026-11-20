const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const runner = require('../game.js');
const {
  Run, laneX, movingBarrierX, LANE_WIDTH, PLATFORM_HEIGHT,
  SLIDE_GATE_CLEARANCE, SLIDE_GATE_HEIGHT, obstacles,
} = runner;
const context = vm.createContext({
  VoidRunner: runner,
  VoidEpisode: require('../episode.js'),
  matchMedia: () => ({ matches: false }),
});
vm.runInContext(readFileSync(join(__dirname, '..', 'scene.js'), 'utf8'), context);
const Scene = context.VoidScene;

function fixture({ scenario = 'landing', width = 390, height = 844, reduceMotion = false } = {}) {
  const operations = [];
  const paths = [];
  let path = [];
  const gradient = (...args) => {
    operations.push(['gradient', ...args]);
    return { addColorStop: (...stop) => operations.push(['stop', ...stop]) };
  };
  const ctx = new Proxy({
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    beginPath: () => { path = []; },
    moveTo: (...args) => path.push(args),
    lineTo: (...args) => path.push(args),
    stroke: () => paths.push(path),
    fillRect(...args) {
      const fill = typeof this.fillStyle === 'string' ? this.fillStyle : 'gradient';
      operations.push(['fillRect', fill, ...args]);
    },
    translate: (...args) => operations.push(['translate', ...args]),
    arc: (...args) => operations.push(['arc', ...args]),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  const scene = new Scene({ getContext: () => ctx });
  const run = new Run({ scenario, seed: 1 });
  scene.reduceMotion = reduceMotion;
  Object.assign(scene, { width, height, insets: [0, 0, 0, 0], openingBlend: 0 });
  scene.reset();
  scene.frameCamera(run);
  return { scene, run, operations, paths };
}

test('overlapping and wide gaps remove deck, rails and markings on every affected lane', () => {
  const { scene, run } = fixture();
  run.obstacles = [
    { type: 'gap', lane: 0, lanes: 2, z: 4, end: 15 },
    { type: 'gap', lane: 3, lanes: 2, z: 9, end: 19 },
    { type: 'gap', lane: 0, z: 13, end: 22 },
  ];
  const flats = [];
  const lips = [];
  const walls = [];
  const braces = [];
  const mounts = [];
  scene.cameraX = 2;
  scene.flat = (...args) => flats.push(args);
  scene.cutLip = (...args) => lips.push(args);
  scene.cutWall = (...args) => walls.push(args);
  scene.cutBrace = (...args) => braces.push(args);
  scene.box = (...args) => mounts.push(args);
  scene.track(run, false);

  function covers(x, z, ...colors) {
    return flats.some(([left, right, near, far, color]) => colors.includes(color) &&
      left < x && right > x && near < z && far > z);
  }
  for (let lane = 0; lane < 5; lane++) {
    assert.equal(covers(laneX(lane), 10, '#261b38'), lane === 2);
  }
  assert.ok(covers(laneX(1), 16, '#261b38'));
  assert.ok(!covers(laneX(0), 16, '#261b38'));
  assert.ok(covers(laneX(4), 20, '#261b38'));
  const outside = laneX(4) + LANE_WIDTH / 2;
  for (const edge of [-outside, outside]) {
    assert.ok(!covers(edge, 10, '#583888', '#a77cf9', '#dfbcff'));
    assert.ok(!covers(edge, 13.5, '#583888', '#dfbcff'));
  }
  assert.ok(!covers(laneX(3) + LANE_WIDTH / 2, 13.5, '#9b77c7', '#61477d'));
  assert.ok(covers(laneX(2), 12.045, '#130f20'));
  assert.ok(!covers(laneX(4), 12.045, '#130f20'));
  assert.ok(walls.some(([x, near, far]) => x === -1.25 && near <= 10 && far > 10));
  assert.ok(braces.some(([x, near, far]) => x === 1.25 && near > 15 && far < 19));
  for (const [x, near, far] of [...walls, ...braces]) {
    assert.ok(!([-3.75, 3.75].includes(x) && near < 15 && far > 9));
  }
  assert.ok(!mounts.some(([, , z]) => z === 10));
  assert.deepEqual(lips.sort((a, b) => a[1] - b[1] || a[0] - b[0]), [
    [laneX(1), 15], [laneX(3), 19], [laneX(4), 19], [laneX(0), 22],
  ]);
});

test('the authored platform has a landable top and the gate leaves standing-to-slide clearance visible', () => {
  const { scene, run } = fixture({ scenario: 'platform' });
  const platform = run.obstacles.find(({ type }) => type === 'platform');
  assert.ok(platform);
  const flats = [];
  const faces = [];
  scene.flat = (...args) => flats.push(args);
  scene.face = (...args) => faces.push(args);

  scene.platform(platform, 0, platform.z, platform.end);
  assert.ok(flats.some(([, , near, far, , height]) =>
    near === platform.z && far === platform.end && height === platform.height));
  assert.ok(faces.some(([points]) => points.every(([, , z]) => z === platform.z) &&
    points.some(([, y]) => y === platform.height) && points.some(([, y]) => y === 0)));

  flats.length = 0;
  faces.length = 0;
  const gate = new Run({ scenario: 'slide-gate' }).obstacles.find(({ type }) => type === 'slideGate');
  assert.ok(gate);
  scene.slideGate(gate, 0, gate.z, gate.end);
  assert.ok(flats.some(([, , , , , height]) => height === SLIDE_GATE_HEIGHT));
  const spanning = faces.map(([points]) => points).filter((points) =>
    Math.min(...points.map(([x]) => x)) < laneX(gate.lane) &&
    Math.max(...points.map(([x]) => x)) > laneX(gate.lane));
  assert.ok(spanning.length > 0);
  assert.equal(Math.min(...spanning.flatMap((points) => points.map(([, y]) => y))), SLIDE_GATE_CLEARANCE);
});

test('both ends of a long span occlude point objects and the player in depth order', () => {
  const { scene, run } = fixture();
  const calls = [];
  const platform = { type: 'platform', z: 87, end: 155, lane: 2, height: PLATFORM_HEIGHT };
  const gate = { type: 'slideGate', z: 120, end: 128, lane: 3 };
  run.distance = 100;
  run.obstacles = [platform, gate];
  run.bolts = [{ lane: 1, z: 132, height: 0.8 }, { lane: 4, z: 95, height: 1.8 }];
  scene.platform = (_, distance, near, far) => calls.push(['platform', near, far]);
  scene.slideGate = (_, distance, near, far) => calls.push(['gate', near, far]);
  scene.bolt = (bolt, z) => calls.push(['bolt', bolt.lane, z]);
  scene.player = () => calls.push(['player']);
  scene.drawCourseObjects(run, 0, false, false);
  assert.deepEqual(calls, [
    ['platform', 32, 55], ['bolt', 1, 32], ['platform', 28, 32], ['platform', 20, 28],
    ['gate', 20, 28], ['platform', 0, 20], ['player'], ['platform', -5, 0], ['bolt', 4, -5],
    ['platform', -scene.rearViewDistance, -5],
  ]);
});

test('grounded sliding renders at platform height and the moving barrier uses physics time', () => {
  const { scene, run } = fixture({ scenario: 'platform' });
  const platform = run.obstacles.find(({ type }) => type === 'platform');
  const boxes = [];
  const flats = [];
  scene.box = (...args) => boxes.push(args);
  scene.flat = (...args) => flats.push(args);
  Object.assign(run, { distance: platform.z + 4, height: platform.height });
  run.slide();
  assert.ok(run.sliding);
  scene.player(run, 0, false, false);
  assert.ok(boxes.length > 0 && boxes.every(([, y]) => y >= platform.height));
  assert.ok(flats.some(([, , , , , y]) => y === platform.height + 0.032));

  const practice = new Run({ scenario: 'moving-barrier' });
  const barrier = practice.obstacles.find(({ type }) => type === 'movingBarrier');
  const rendered = [];
  scene.barrier = (x, z) => rendered.push([x, z]);
  for (const time of [0.2, 0.9, 1.34]) {
    practice.time = time;
    scene.drawCourseObjects(practice, 17, false, false);
    assert.deepEqual(rendered.at(-1), [movingBarrierX(barrier, time), barrier.z]);
  }
  assert.ok(new Set(rendered.map(([x]) => x)).size === 3);
});

test('flat obstacle tops and cracked barrier markings match their physics dimensions', () => {
  const { scene } = fixture();
  const boxes = [];
  const markings = [];
  scene.box = (...args) => boxes.push(args);
  scene.face = (points) => markings.push(points);
  scene.line = (points) => markings.push(points);
  scene.flat = () => {};

  scene.hurdle(0, 10);
  const [x, base, z, width, height, depth] = boxes.at(-1);
  assert.deepEqual([x, base + height, z, width, depth], [0, obstacles.hurdle.height, 10,
    obstacles.hurdle.halfWidth * 2, obstacles.hurdle.halfDepth * 2]);

  for (const moving of [false, true]) {
    markings.length = 0;
    if (moving) scene.movingBarrier({ lane: 1, toLane: 2 }, 12, 0.5);
    else scene.barrier(0, 12);
    const { height, halfWidth, halfDepth } = obstacles.barrier;
    assert.deepEqual(boxes.at(-1).slice(1, 6), [0, 12, halfWidth * 2, height, halfDepth * 2]);
    assert.ok(markings.length > 3);
    assert.ok(markings.flat().every(([, y]) => y >= 0 && y < height));
  }
});

test('pull chevrons mirror and the lightning glyph projects from the bolt height', () => {
  const { scene, run, paths } = fixture({ scenario: 'black-hole' });
  const hole = run.obstacles.find(({ type }) => type === 'blackHole');
  for (const direction of [-1, 1]) {
    paths.length = 0;
    scene.blackHole({ ...hole, direction }, hole.z, 0);
    for (const [tail, tip, otherTail] of paths.slice(-2)) {
      assert.ok((tip[0] - tail[0]) * direction > 0);
      assert.equal(tail[0], otherTail[0]);
      assert.equal(tip[1], 0);
    }
  }
  const bolt = { lane: 2, height: 1.84 };
  const z = 30;
  paths.length = 0;
  scene.bolt(bolt, z);
  const polygon = paths[0];
  const point = scene.viewPoint([laneX(bolt.lane), bolt.height, z]);
  const [, center] = scene.screenPoint(point);
  assert.equal(polygon.length, 7);
  assert.ok(polygon[0][1] < center && polygon[3][1] > center);
  assert.ok(polygon[1][0] < polygon[2][0] && polygon[4][0] > polygon[5][0]);
});

test('the dark backdrop moves at running pace while reduced motion holds the sky steady', () => {
  for (const reduceMotion of [false, true]) {
    const { scene, run, operations } = fixture({ reduceMotion });
    scene.track = scene.deepVoid = scene.drawCourseObjects = () => {};
    scene.drawPace = scene.drawBoost = () => {};
    const frame = (time) => {
      operations.length = 0;
      scene.draw(run, time, 1 / 60, 'running', 2);
      return operations.slice();
    };
    const first = frame(0);
    const second = frame(12);
    assert.ok(first.some(([kind, offset, color]) => kind === 'stop' && offset === 0 && color === '#020209'));
    if (reduceMotion) assert.deepEqual(first, second);
    else assert.notDeepEqual(first, second);
  }
});

test('very long structures draw within the view window with bounded cost at 572 m/s and faster', () => {
  for (const speed of [572, 1500, 10_000]) {
    const { scene, run } = fixture({ width: 1440, height: 900 });
    run.distance = 1_000_000;
    run.speed = run.baseSpeed = speed;
    run.obstacles = [
      { type: 'platform', lane: 2, z: 1, end: 10_000_000, height: PLATFORM_HEIGHT },
      { type: 'slideGate', lane: 3, z: 1, end: 10_000_000 },
    ];
    const slabs = [];
    const nativeStructure = scene.structure.bind(scene);
    scene.structure = (...args) => { slabs.push(args); nativeStructure(...args); };
    scene.frameCamera(run);
    let faces = 0;
    scene.face = () => { faces++; };
    scene.drawCourseObjects(run, 1, false, false);
    assert.ok(faces > 0 && faces < 100);
    assert.equal(slabs.length, 4);
    assert.ok(slabs.every(([, , , , near, far, cap]) =>
      near >= -scene.rearViewDistance && far <= scene.viewDistance * 0.9 && cap === false));
  }
});
