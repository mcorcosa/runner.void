const assert = require('node:assert/strict');
const test = require('node:test');
const { observeCourse, play } = require('./qa/encounter-player.cjs');
const { appPlayer } = require('./qa/encounter-app-player.cjs');
const { CLUES } = require('../episode.js');

const { courses, runner, direct } = observeCourse();
const { START_SPEED, FAST_START_SPEED } = runner;
const launchSpeeds = [48, 80, 112, 144, 176];
const mix = new Set(['jump-and-slide', 'duck-vault', 'platform-and-slide', 'pull-and-slide',
  'vault-sweep-duck', 'duck-cross-duck', 'fork-funnel']);

test('ordinary launches reach mixed sections promptly and still vary at 572 m/s and above', () => {
  const seen = new Map();
  const phases = new Set();
  for (const [discoveredClues, launchSpeed] of launchSpeeds.entries()) {
    for (const seed of [1, 42, 187, 0xffffffff]) {
      const player = direct({ seed, discoveredClues });
      const extended = discoveredClues === 4 && seed === 187;
      const duration = extended ? 310 : (572 - launchSpeed) / 1.8 + 60;
      const { passed, fastAt, closures } = play(player, courses, duration, {
        ...runner, boost: seed % 2 === 0,
      });
      assert.equal(player.run.dashReadyAt, 0);
      assert.ok(passed[0].start < (discoveredClues ? 7.5 : 15));
      assert.ok(mix.has(passed[0].name));
      if (discoveredClues >= 3) assert.ok(['vault-sweep-duck', 'pull-and-slide', 'duck-cross-duck',
        'fork-funnel', 'platform-and-slide', 'jump-and-slide'].includes(passed[0].name));
      assert.ok(closures >= 10, 'Ordinary long closures still interrupt the authored runs');
      if (extended) assert.ok(passed.some(({ speed }) => speed > 700));
      assert.ok(passed.filter(({ start }) => start >= fastAt && start < fastAt + 60).length >= 8);
      assert.ok(passed.some(({ speed, name }) => speed >= 572 && name === 'duck-cross-duck'));
      assert.ok(passed.some(({ speed, seam }) => speed >= 572 && seam < 1.1));
      assert.ok(passed.some(({ speed, seam }) => speed >= 572 && seam > 3));
      for (const [index, beat] of passed.entries()) {
        assert.notEqual(beat.name, passed[index - 1]?.name);
        assert.ok(Math.abs(beat.lane - beat.entryLane) <= 3);
        if (!seen.has(beat.name)) seen.set(beat.name, new Set());
        seen.get(beat.name).add(beat.lane);
        if (beat.sweepRoute !== undefined) phases.add(beat.sweepRoute);
      }
    }
  }
  assert.deepEqual(new Set(seen.keys()), mix);
  for (const lanes of seen.values()) assert.ok(lanes.has(1) && lanes.has(3), 'Both handed approaches appear');
  assert.ok(phases.has('refuge') && phases.has(0) && phases.has(4), 'Dodge in both directions or use the refuge');
});

test('app keyboard and separate timed swipes play every ordinary launch tier', () => {
  for (const [discoveredClues, speed] of launchSpeeds.entries()) {
    for (const [seed, touch] of [[187, false], [42, true]]) {
      const player = appPlayer(runner, { seed, touch, discoveredClues, swipeFrames: 4 });
      assert.equal(player.run.baseSpeed, speed);
      const { passed } = play(player, courses, 26, {
        ...runner, boost: !touch, sweepRefuge: touch, forkGate: touch,
      });
      assert.ok(passed.length >= 2);
      assert.equal(player.run.dashReadyAt, 0);
    }
  }
  const player = appPlayer(runner, { seed: 187, touch: true, discoveredClues: 4, swipeFrames: 4 });
  const { passed, fastAt } = play(player, courses, 248, { ...runner, sweepRefuge: false, forkGate: true, boostCrossing: true });
  assert.ok(fastAt >= 220 && fastAt < 221);
  assert.ok(passed.some(({ name, speed, boostedGate }) => name === 'duck-cross-duck' && speed >= 572 && boostedGate));
});

test('the ordinary app keeps generating through live clues and at high speed', () => {
  const duration = 385;
  for (const discoveredClues of [0, 2, 4]) {
    const player = appPlayer(runner, { seed: 187, discoveredClues });
    const { run, step } = player;
    const completed = [];
    let phase;
    let pausedId;
    let playbackAt;
    player.step = () => {
      step();
      assert.ok(player.frames < (duration + 15) * 60, 'The app run clock keeps advancing');
      const transmission = run.transmission;
      const nextPhase = transmission?.phase;
      if (nextPhase === 'draining' && phase !== 'draining') pausedId = run.id;
      if (nextPhase === 'draining' || nextPhase === 'playing') {
        assert.equal(run.id, pausedId, 'Spawning pauses while the course drains and the clue plays');
      }
      if (nextPhase === 'playing' && phase !== 'playing') {
        playbackAt = run.time;
        assert.ok(run.obstacles.every(({ z, end = z }) => end < run.distance), 'Playback begins on cleared track');
      }
      const firstAhead = run.obstacles.find(({ z, end = z }) => end > run.distance);
      if (nextPhase === 'complete' && phase !== 'complete') {
        const expectedClue = discoveredClues + completed.length + 1;
        assert.equal(player.latestClue, expectedClue, 'The app discovers the completed clue');
        assert.ok(Math.abs(run.time - playbackAt - CLUES[expectedClue - 1].duration) < runner.STEP);
        assert.ok(firstAhead?.z > run.distance + run.viewDistance, 'The returning row gets a full warning horizon');
        completed.push(expectedClue);
      }
      if (!nextPhase || nextPhase === 'complete') {
        assert.ok(firstAhead, `No obstacles ahead at ${run.distance.toFixed(1)} m with ${discoveredClues} saved clues`);
      }
      phase = nextPhase;
    };
    const { passed } = play(player, courses, duration, runner);
    assert.deepEqual(completed, CLUES.slice(discoveredClues).map((_, index) => discoveredClues + index + 1));
    assert.equal(player.latestClue, CLUES.length);
    const fastSections = passed.filter(({ speed }) => speed >= 572);
    assert.ok(fastSections.length >= 10, 'Playable sections span multiple late-tier bags');
    assert.equal(new Set(fastSections.map(({ name }) => name)).size, 5);
  }
});

test('Challenge hands off from its final gate to playable endless sections at both paces', () => {
  const sections = [
    ['', ['vault-sweep-duck', 'pull-and-slide', 'platform-and-slide', 'jump-and-slide']],
    ['fast', ['duck-cross-duck', 'fork-funnel', 'vault-sweep-duck', 'pull-and-slide', 'platform-and-slide']],
  ];
  for (const [pace, tierSections] of sections) {
    for (const touch of [false, true]) {
      const player = appPlayer(runner, { seed: 187, touch, scenario: 'challenge', pace, discoveredClues: 4 });
      const { run } = player;
      const authoredId = run.id;
      const { passed } = play(player, courses, 40, { ...runner, sweepRefuge: touch, forkGate: touch });
      assert.deepEqual(passed.slice(0, 3).map(({ name }) => name),
        ['vault-sweep-duck', 'duck-cross-duck', 'pull-and-slide']);
      assert.ok(run.id > authoredId && run.obstacles.some(({ z }) => z > run.distance),
        'Obstacles stop spawning after the final Challenge gate');
      const followups = passed.slice(3);
      assert.ok(followups.length >= 4, 'The player clears generated sections beyond the authored course');
      assert.ok(followups.every(({ name }) => tierSections.includes(name)), 'Generated sections use the Challenge launch tier');
      assert.equal(run.musicTierFloor, 1);
      assert.equal(run.transmission, null);
      assert.equal(run.boltsCollected, 0);
      assert.equal(player.latestClue, 0, 'Challenge stays isolated from saved progress');
    }
  }
});

test('omitting the intended jump, duck, or pull correction hits its hazard', () => {
  for (const [omit, type] of [['first-jump', 'hurdle'], ['last-slide', 'slideGate']]) {
    const player = direct({ seed: 187, discoveredClues: 1 });
    assert.throws(() => play(player, courses, 26, { ...runner, omit }), /jump-and-slide|duck-vault/);
    assert.equal(player.run.crash?.type, type);
  }
  for (const [omit, type] of [['lateral-jump', 'gap'], ['jump-over-gate', 'slideGate'], ['correction', 'barrier']]) {
    const player = direct({ scenario: 'challenge', pace: 'fast' });
    assert.throws(() => play(player, courses, 21, { ...runner, omit }), /duck-cross-duck|pull-and-slide/);
    assert.equal(player.run.crash?.type, type);
  }
});

test('the late gate bank requires a slide even when the runner changes lanes or tries to jump over it', () => {
  for (const bankAttempt of ['lane', 'jump']) {
    const player = direct({ seed: 187, discoveredClues: 4 });
    assert.throws(() => play(player, courses, 275, { ...runner, bankAttempt }), /duck-cross-duck/);
    assert.ok(player.run.baseSpeed >= 572);
    assert.equal(player.run.crash?.type, 'slideGate');
  }
});

test('challenge keeps a reachable sweep refuge and rewards a dash without requiring another charge', () => {
  for (const mode of ['refuge', 'dash']) {
    const player = direct({ seed: 187, scenario: 'challenge', pace: 'fast' });
    const firstGeneratedId = player.run.id;
    const { passed } = play(player, courses, 17, {
      ...runner, sweepRefuge: mode === 'refuge', dashSweep: mode === 'dash',
    });
    assert.equal(passed[0].sweepRoute, mode);
    assert.deepEqual(passed.slice(0, 3).map(({ name }) => name), ['vault-sweep-duck', 'duck-cross-duck', 'pull-and-slide']);
    if (mode === 'dash') {
      assert.ok(passed[1].chargeAtStart < 1, 'The next combination starts before dash recharges');
      const authoredBreaks = player.events.filter(({ name, detail }) => name === 'break' && detail.id < firstGeneratedId);
      assert.deepEqual(authoredBreaks.map(({ detail }) => detail.type), ['movingBarrier']);
    }
    assert.equal(player.run.boltsCollected, 0);
  }
});

test('all authored practice URLs clear at both paces using keyboard and touch', () => {
  const drills = [
    ['jump-slide', [START_SPEED, FAST_START_SPEED], ['jump-and-slide']],
    ['lane-jump', [START_SPEED, FAST_START_SPEED], ['lateral']],
    ['challenge', [144, 176], ['vault-sweep-duck', 'duck-cross-duck', 'pull-and-slide']],
  ];
  for (const [scenario, speeds, names] of drills) {
    for (const [index, pace] of ['', 'fast'].entries()) {
      for (const [seed, touch] of [[187, false], [42, true]]) {
        const player = appPlayer(runner, { seed, touch, scenario, pace, discoveredClues: 4 });
        assert.ok(player.run.scripted);
        assert.equal(player.run.baseSpeed, speeds[index]);
        const { passed } = play(player, courses, 17, runner);
        const authored = scenario === 'challenge' ? passed.slice(0, names.length) : passed;
        assert.deepEqual(authored.map(({ name }) => name), names);
        assert.ok(passed[0].start >= 1.9 && passed[0].start < 2.1);
      }
    }
  }
});
