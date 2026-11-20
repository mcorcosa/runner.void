'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const { Soundtrack } = require('../audio.js');
const { Run } = require('../game.js');

const tracks = [
  ['the_mountain-synthwave-593074.mp3', 197.51],
  ['aberrantrealities-synthetic-cohesion-566278.mp3', 153.02],
  ['kulakovka-dark-synthwave-624644.mp3', 139.23],
  ['audiorells-outrun-neon-dreams-80s-199668.mp3', 134.4],
  ['petrushkasound-pop-synth-background-music-465681.mp3', 181.52],
  ['alex-morgan-synthwave-arcade-retro-nights-573647.mp3', 137.35],
  ['freemusiclab-charming-phonk-i-free-background-music-i-free-music-lab-release-513626.mp3', 157.53],
  ['alex-morgan-gaming-stream-arcade-session-578484.mp3', 127.08],
  ['imageaudioteam-80s-synth-166739.mp3', 166.53],
];
const durations = new Map(tracks);
const script = readFileSync(require.resolve('../audio.js'), 'utf8');
const bundle = readFileSync(require.resolve('../audio/relay-nine.js'), 'utf8');

class Param {
  constructor(value) {
    this.value = value;
    this.events = [];
  }

  setValueAtTime(value, at) { this.events.push({ value, at }); }
  setTargetAtTime(value, at, smooth) { this.events.push({ value, at, smooth }); }
  linearRampToValueAtTime(value, at) { this.events.push({ value, at }); }
  exponentialRampToValueAtTime(value, at) { this.events.push({ value, at, exponential: true }); }
  cancelScheduledValues(at) { this.events = this.events.filter(event => event.at < at); }

  valueAt(at) {
    let last = { value: this.value, at: 0 };
    for (const next of this.events) {
      if (next.at > at) {
        if (!next.exponential) break;
        return last.value * (next.value / last.value) ** ((at - last.at) / (next.at - last.at));
      }
      last = next;
    }
    return last.value;
  }
}

class Node {
  constructor() { this.outputs = []; }
  connect(...connection) { this.outputs.push(connection); }
  disconnect() { this.outputs.length = 0; }
}

class BufferSource extends Node {
  constructor(context) {
    super();
    this.context = context;
    this.playbackRate = new Param(1);
    this.startedAt = Infinity;
    this.stopAt = Infinity;
    this.done = false;
  }

  start(at, offset = 0) {
    assert.equal(this.startedAt, Infinity, 'A buffer source starts only once');
    this.startedAt = at;
    this.offset = this.position = offset;
    this.context.sources.push(this);
  }

  stop(at) { this.stopAt = at; }

  advance(now, step) {
    if (this.done || now < this.startedAt) return;
    this.position += (now - Math.max(now - step, this.startedAt)) * this.playbackRate.value;
    if (now >= this.stopAt || this.position >= this.buffer.duration) {
      this.done = true;
      this.onended?.();
    }
  }
}

class Context {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 0;
    this.destination = new Node();
    this.sources = [];
  }

  createGain() { return Object.assign(new Node(), { gain: new Param(1) }); }
  createBiquadFilter() { return Object.assign(new Node(), { Q: new Param(1), frequency: new Param(350) }); }
  createBufferSource() { return new BufferSource(this); }
  createMediaElementSource(media) { return Object.assign(new Node(), { media }); }

  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, duration: length / sampleRate, getChannelData: channel => data[channel] };
  }

  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.state = 'closed'; }

  advance(seconds) {
    if (this.state !== 'running') return;
    this.currentTime += seconds;
    for (const source of [...this.sources]) source.advance(this.currentTime, seconds);
  }
}

class Media {
  constructor() {
    this.loads = [];
    this.paused = true;
    this.muted = false;
    this.volume = 1;
    this.calls = 0;
    this.pauses = 0;
    this.seeks = [];
    this.reset();
  }

  reset() {
    this.position = 0;
    this.seeking = false;
    this.playbackRate = 1;
    this.ended = false;
    this.error = null;
  }

  set src(path) {
    this.load();
    this.path = path;
    this.loads.push(path);
  }

  get file() { return this.path?.split('/').at(-1); }
  get duration() { return durations.get(this.file); }
  set currentTime(position) {
    this.seeks.push(position);
    this.position = position;
    this.ended = position >= this.duration;
  }
  get currentTime() { return this.position; }
  removeAttribute(name) { assert.equal(name, 'src'); this.path = undefined; }

  load() { this.pause(); this.reset(); }
  pause() { this.paused = true; this.pauses++; }

  async play() {
    this.calls++;
    if (this.onPlay) await this.onPlay();
    this.paused = false;
  }

  finish() {
    this.position = this.duration;
    this.ended = true;
    this.paused = true;
    this.onended?.();
  }

  advance(seconds) {
    if (this.paused) return;
    const time = this.currentTime + seconds * this.playbackRate;
    if (time >= this.duration) this.finish();
    else {
      this.position = time;
      this.ontimeupdate?.();
    }
  }

  fail() {
    this.error = { code: 4 };
    this.onerror?.();
  }
}

function setup(t, { ContextClass = Context, protocol = 'http:', random = () => 0.75, document } = {}) {
  const instances = [];
  class Audio extends Media {
    constructor() { super(); instances.push(this); }
  }
  const sandbox = vm.createContext({
    AudioContext: ContextClass, Audio, document, location: { protocol }, Math: Object.assign(Object.create(Math), { random }),
  });
  vm.runInContext(script, sandbox);
  const sound = new sandbox.VoidAudio.Soundtrack();
  t.after(() => sound.dispose());
  return { sound, instances };
}

function setupSpoken(t, { protocol = 'http:', deferLoad = false, failLoad = false } = {}) {
  const loads = [];
  const decoded = [];
  const document = {
    currentScript: { src: protocol === 'file:' ? 'file:///C:/run.void/audio.js' : 'http://localhost/audio.js' },
    createElement: () => ({ remove() {} }),
    head: { append: element => loads.push(element) },
  };
  class DecodingContext extends Context {
    async decodeAudioData(data) {
      const bytes = Buffer.from(data);
      assert.equal(bytes.toString('ascii', 0, 3), 'ID3');
      const buffer = { duration: [6.8, 8.8, 10.8][decoded.length], bytes: bytes.length };
      decoded.push(buffer);
      return buffer;
    }
  }
  const sandbox = vm.createContext({ AudioContext: DecodingContext, Audio: Media, document, URL, atob,
    location: { protocol } });
  vm.runInContext(script, sandbox);
  const sound = new sandbox.VoidAudio.Soundtrack();
  t.after(() => sound.dispose());

  async function deliver() {
    const [element] = loads;
    if (failLoad) element.onerror();
    else {
      document.currentScript = element;
      vm.runInContext(bundle, sandbox);
      document.currentScript = null;
      element.onload();
    }
    await new Promise(setImmediate);
  }

  async function unlockSpoken() {
    await unlock(sound);
    if (!deferLoad) await deliver();
  }

  return { sound, loads, decoded, deliver, unlockSpoken };
}

async function unlock(sound) {
  assert.equal(await sound.unlock(), true);
  return sound.media;
}

function tick(sound, seconds, update) {
  sound.context.advance(seconds);
  sound.media.advance(seconds);
  sound.update(update);
}

function level(sound) {
  const now = sound.context.currentTime;
  return sound.musicGain ? sound.musicGain.gain.valueAt(now) * sound.musicDuck.gain.valueAt(now) : sound.media.volume;
}

test('loads through CommonJS and the browser global and behaves safely without audio', async () => {
  const sandbox = vm.createContext({});
  vm.runInContext(script, sandbox);
  const sound = new sandbox.VoidAudio.Soundtrack();
  assert.equal(typeof Soundtrack, 'function');
  assert.equal(await sound.unlock(), false);
  sound.update({ mode: 'running', speed: 570, transmissionTime: 1 });
  sound.impact('gap');
  assert.equal(sound.context, null);
  sound.setMuted(true);
  await sound.suspend();
  assert.equal(await sound.resume(), false);
  sound.dispose();
  sound.dispose();
  assert.equal(await sound.unlock(), false);
});

test('fatal contacts produce distinct short, tapered material signatures and a neutral fallback', async t => {
  const { sound } = setup(t);
  await unlock(sound);
  const clips = new Map();

  for (const type of ['hurdle', 'barrier', 'movingBarrier', 'slideGate', 'spikes', 'gap', 'platform', 'unknown', 'toString']) {
    sound.update({ mode: 'running' });
    sound.impact(type);
    const source = sound.impactVoice.source;
    const [gate] = source.outputs[0];
    assert.equal(gate.outputs[0][0], sound.master, 'effects bypass the music-only gains and filter');
    assert.equal(source.startedAt, sound.context.currentTime);
    assert.equal(source.buffer.numberOfChannels, 1);
    assert.ok(source.buffer.duration > 0.08 && source.buffer.duration <= 0.40, type);
    const data = source.buffer.getChannelData(0);
    assert.equal(Math.abs(data[0]), 0, type);
    assert.equal(Math.abs(data.at(-1)), 0, type);
    assert.ok(data.every(Number.isFinite), type);
    const peak = Math.max(...data.map(Math.abs));
    assert.ok(peak > 0.20 && peak < 0.25, type);
    clips.set(type, source.buffer);

    const count = sound.context.sources.length;
    sound.impact(type);
    sound.impact('platform');
    sound.update({ mode: 'ended' });
    tick(sound, 0.41);
    sound.impact(type);
    assert.equal(sound.context.sources.length, count);
    assert.equal(sound.voices.size, 0);
    assert.equal(source.outputs.length, 0);
  }

  assert.equal(new Set(clips.values()).size, 8);
  assert.equal(clips.get('toString'), clips.get('unknown'));
  assert.ok([...new Set(clips.values())].reduce((total, clip) => total + clip.getChannelData(0).byteLength, 0) < 160 * 1024);

  const rate = 24000;
  function energy(type, from, to) {
    const data = clips.get(type).getChannelData(0).subarray(from * rate, to * rate);
    return data.reduce((sum, sample) => sum + sample ** 2, 0) / data.length;
  }
  function tonePower(type, frequency, from, to) {
    const data = clips.get(type).getChannelData(0).subarray(from * rate, to * rate);
    let real = 0;
    let imaginary = 0;
    for (let i = 0; i < data.length; i++) {
      const phase = 2 * Math.PI * frequency * i / rate;
      real += data[i] * Math.cos(phase);
      imaginary += data[i] * Math.sin(phase);
    }
    return (real ** 2 + imaginary ** 2) / data.length ** 2;
  }
  assert.ok(tonePower('hurdle', 245, 0, 0.035) > 10 * tonePower('platform', 245, 0, 0.035));
  assert.ok(tonePower('platform', 77, 0.010, 0.040) > 10 * tonePower('hurdle', 77, 0.010, 0.040));
  assert.ok(tonePower('slideGate', 1130, 0, 0.040) > 10 * tonePower('barrier', 1130, 0, 0.040));
  assert.ok(energy('movingBarrier', 0.08, 0.15) > 10 * energy('barrier', 0.08, 0.15));
  assert.ok(energy('spikes', 0.08, 0.15) > 5 * energy('barrier', 0.08, 0.15));
  assert.ok(energy('gap', 0.20, 0.25) > 3 * energy('movingBarrier', 0.20, 0.25));
  assert.ok(tonePower('gap', 292, 0.052, 0.076) > 5 * tonePower('gap', 292, 0.200, 0.224));
  assert.ok(tonePower('gap', 187, 0.200, 0.224) > 5 * tonePower('gap', 187, 0.052, 0.076));
});

test('locked, muted and hidden fatal contacts are consumed without a delayed effect', async t => {
  let resumeCalls = 0;
  class DeniedOnce extends Context {
    async resume() {
      if (++resumeCalls === 1) throw new Error('Context autoplay denied');
      await super.resume();
    }
  }

  const document = { hidden: false };
  const { sound, instances } = setup(t, { ContextClass: DeniedOnce, document });
  sound.update({ mode: 'running' });
  sound.impact('barrier');
  assert.equal(instances.length, 0);
  assert.equal(sound.context, null);
  sound.update({ mode: 'ended' });

  sound.update({ mode: 'running' });
  assert.equal(await sound.unlock(), false);
  sound.impact('hurdle');
  await unlock(sound);
  sound.impact('hurdle');
  assert.equal(sound.context.sources.length, 0);
  sound.update({ mode: 'ended' });

  sound.update({ mode: 'running' });
  sound.setMuted(true);
  sound.impact('gap');
  sound.setMuted(false);
  sound.impact('gap');
  assert.equal(sound.context.sources.length, 0);
  sound.update({ mode: 'ended' });

  sound.update({ mode: 'running' });
  await sound.suspend();
  sound.impact('slideGate');
  await sound.resume();
  sound.impact('slideGate');
  assert.equal(sound.context.sources.length, 0);
  sound.update({ mode: 'ended' });

  sound.update({ mode: 'running' });
  document.hidden = true;
  sound.impact('platform');
  document.hidden = false;
  sound.impact('platform');
  assert.equal(sound.context.sources.length, 0);
  assert.equal(sound.impactBuffers.size, 0);
  assert.equal(sound.musicDuck.gain.valueAt(sound.context.currentTime), 1);
});

test('an unavailable buffer source leaves the soundtrack usable on the next run', async t => {
  class FailingContext extends Context {
    createBufferSource() {
      const source = super.createBufferSource();
      if (!this.failedSource) {
        this.failedSource = source;
        source.start = () => { throw new Error('Audio playback unavailable'); };
      }
      return source;
    }
  }

  const { sound } = setup(t, { ContextClass: FailingContext });
  sound.update({ mode: 'running' });
  const media = await unlock(sound);
  sound.impact('hurdle');
  assert.equal(sound.context.failedSource.outputs.length, 0);
  assert.equal(sound.context.failedSource.onended, null);
  assert.equal(sound.voices.size, 0);
  assert.equal(sound.musicDuck.gain.events.length, 0);
  assert.equal(media.paused, false);
  sound.update({ mode: 'ended' });
  sound.update({ mode: 'running' });
  sound.impact('hurdle');
  assert.equal(sound.context.sources.length, 1);
  sound.dispose();
  sound.impact('hurdle');
  assert.equal(sound.context, null);
  assert.equal(sound.voices.size, 0);
  assert.equal(sound.impactBuffers.size, 0);
});

for (const protocol of ['http:', 'file:']) {
  test(`the ${protocol} impact duck adds a short 4 dB dip to the existing death fade`, async t => {
    const { sound } = setup(t, { protocol });
    const { sound: control } = setup(t, { protocol });
    for (const audio of [sound, control]) audio.update({ mode: 'running', speed: 400 });
    const media = await unlock(sound);
    await unlock(control);
    const track = sound.activeMusic;
    const activity = [media.loads.length, media.pauses, media.seeks.length, media.calls];
    const duckAt = seconds => {
      for (const audio of [sound, control]) tick(audio, seconds);
      assert.equal(media.playbackRate, control.media.playbackRate);
      assert.equal(media.currentTime, control.media.currentTime);
      assert.equal(sound.activeMusic, track);
      assert.deepEqual([media.loads.length, media.pauses, media.seeks.length, media.calls], activity);
      return 20 * Math.log10(level(sound) / level(control));
    };
    duckAt(12);
    sound.impact('gap');
    assert.equal(sound.impactVoice.gate.gain.events.at(-1).value, protocol === 'file:' ? 0.60 : 1);
    for (const audio of [sound, control]) audio.update({ mode: 'ended' });
    assert.equal(duckAt(0), 0);
    assert.ok(Math.abs(duckAt(0.009) + 2) < 1e-8);
    assert.ok(Math.abs(duckAt(0.020) + 4) < 1e-8);
    assert.ok(Math.abs(duckAt(0.081) + 4) < 1e-8);
    assert.ok(Math.abs(duckAt(0.140) + 2) < 1e-8);
    assert.equal(duckAt(0.160), 0);
    assert.equal(sound.impactVoice, null);
    assert.equal(duckAt(0.840), 0);
    assert.equal(level(sound), 0.27 * 0.73);
    assert.equal(media.playbackRate, 0.9);
  });

  test(`rapid ${protocol} restart releases the duck and retires the prior effect before another impact`, async t => {
    const { sound } = setup(t, { protocol });
    sound.update({ mode: 'running', speed: 820 });
    const media = await unlock(sound);
    const startLevel = level(sound);
    const track = sound.activeMusic;
    sound.impact('gap');
    const first = sound.impactVoice.source;
    sound.update({ mode: 'ended' });
    tick(sound, 0.050);
    const inDuck = level(sound);
    const rate = media.playbackRate;
    const position = media.currentTime;
    sound.update({ mode: 'running' });
    assert.equal(level(sound), inDuck);
    assert.equal(media.playbackRate, rate);
    assert.equal(media.currentTime, position);
    assert.ok(first.stopAt - sound.context.currentTime <= 0.025);
    tick(sound, 0.010);
    assert.ok(level(sound) > inDuck && level(sound) < startLevel);
    sound.impact('platform');
    const second = sound.impactVoice.source;
    assert.notEqual(second, first);
    assert.equal(first.outputs.length, 0);
    assert.equal(sound.voices.size, 1);
    sound.update({ mode: 'ended' });
    tick(sound, 0.030);
    sound.setMuted(true);
    assert.equal(second.outputs.length, 0);
    assert.equal(sound.impactVoice, null);
    sound.setMuted(false);
    assert.equal(sound.context.sources.length, 2);
    assert.ok(level(sound) > inDuck);

    sound.update({ mode: 'running' });
    tick(sound, 0.75);
    assert.equal(level(sound), startLevel);
    assert.equal(media.playbackRate, 1);
    assert.equal(sound.activeMusic, track);
    assert.equal(media.loads.length, 1);
    assert.equal(media.calls, 1);

    sound.impact('spikes');
    const third = sound.impactVoice.source;
    sound.update({ mode: 'ended' });
    tick(sound, 0.030);
    await sound.suspend();
    assert.equal(third.outputs.length, 0);
    await sound.resume();
    assert.equal(sound.impactVoice, null);
    assert.equal(sound.context.sources.length, 3);
    assert.equal(sound.impactDuck, null);
  });
}

test('constructor, context resume and media autoplay failures each allow a later gesture', async t => {
  let calls = 0;
  class DeniedOnce extends Context {
    constructor() {
      super();
      if (++calls === 1) throw new Error('Initialization failed');
    }

    async resume() {
      if (++calls === 3) throw new Error('Context autoplay denied');
      await super.resume();
    }
  }

  const { sound, instances } = setup(t, { ContextClass: DeniedOnce });
  assert.equal(await sound.unlock(), false);
  sound.update({ mode: 'running', speed: 69 });
  assert.equal(await sound.unlock(), false);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].paused, true);
  const media = await unlock(sound);
  media.pause();
  media.onPlay = () => { throw Object.assign(new Error('Media autoplay denied'), { name: 'NotAllowedError' }); };
  sound.update();
  await new Promise(setImmediate);
  assert.equal(media.paused, true);
  const callsAfterDenial = media.calls;
  for (let i = 0; i < 5; i++) sound.update();
  assert.equal(media.calls, callsAfterDenial);
  media.onPlay = null;
  await unlock(sound);
  assert.equal(media.calls, callsAfterDenial + 1);
  assert.equal(media.paused, false);
  assert.equal(media.loads.length, 1, 'autoplay denial leaves the selection in place');
});

for (const [speed, musicTierFloor, runTrack] of [[32, undefined, 1], [80, 2, 2]]) {
  test(`a Start gesture at ${speed} m/s starts media before asynchronous resume or fullscreen can consume activation`, async t => {
    let finishResume;
    class DeferredContext extends Context {
      resume() {
        return new Promise(resolve => {
          finishResume = () => { this.state = 'running'; resolve(); };
        });
      }
    }
    const { sound, instances } = setup(t, { ContextClass: DeferredContext });
    const unlocking = sound.unlock();
    const [media] = instances;
    assert.equal(sound.context.state, 'suspended');
    assert.equal(media.file, tracks[0][0]);
    assert.equal(media.calls, 1, 'the same element is primed synchronously');
    sound.update({ mode: 'running', speed, musicTierFloor });
    assert.equal(media.file, tracks[runTrack][0]);
    assert.equal(media.calls, 2, 'the run selection starts in the same event handler');
    finishResume();
    assert.equal(await unlocking, true);
    assert.equal(instances.length, 1);
    assert.equal(media.calls, 2);
    assert.equal(media.file, tracks[runTrack][0]);
  });
}

test('first unlock during a muted advanced run loads only Tier 2 and keeps its position on unmute', async t => {
  const { sound } = setup(t, { protocol: 'file:' });
  sound.setMuted(true);
  sound.update({ mode: 'running', speed: 80, musicTierFloor: 2 });
  const media = await unlock(sound);
  assert.equal(media.file, tracks[2][0]);
  assert.equal(media.muted, true);
  tick(sound, 2);
  sound.setMuted(false);
  assert.equal(media.muted, false);
  assert.equal(media.currentTime, 2);
  assert.equal(media.calls, 1);
  assert.equal(media.loads.length, 1);
});

test('advanced restart replaces Tier 1 and keeps a matching track through the results fade and restart', async t => {
  const { sound } = setup(t);
  sound.update({ mode: 'ended', speed: 700 });
  const media = await unlock(sound);
  assert.equal(media.file, tracks[0][0]);
  tick(sound, 3);
  sound.update({ mode: 'running', speed: 80, musicTierFloor: 2 });
  assert.equal(media.file, tracks[2][0]);
  assert.equal(media.currentTime, 0);
  assert.equal(media.paused, false);
  tick(sound, 5);
  const activity = [media.loads.length, media.pauses, media.seeks.length, media.calls];
  sound.update({ mode: 'ended', speed: 80 });
  tick(sound, 1.25);
  assert.equal(media.playbackRate, 0.9);
  assert.equal(level(sound), 0.27 * 0.73);
  const position = media.currentTime;
  assert.ok(position > 5);
  sound.update({ mode: 'running', speed: 80, musicTierFloor: 2 });
  assert.equal(media.file, tracks[2][0]);
  assert.equal(media.currentTime, position);
  assert.deepEqual([media.loads.length, media.pauses, media.seeks.length, media.calls], activity);
  tick(sound, 0.71);
  assert.equal(media.playbackRate, 1);
  assert.equal(level(sound), 0.88 * 0.73);

  sound.update({ mode: 'ended', speed: 80, musicTierFloor: 2 });
  media.finish();
  assert.equal(media.file, tracks[1][0]);
  sound.update({ mode: 'running', speed: 32 });
  assert.equal(media.file, tracks[1][0]);
  media.finish();
  assert.equal(media.file, tracks[0][0], 'an ordinary run without a floor still draws from Tier 1');
});

test('an advanced run samples its floor and actual speed when songs end', async t => {
  const { sound } = setup(t);
  sound.update({ mode: 'running', speed: 80, musicTierFloor: 2 });
  const media = await unlock(sound);
  assert.equal(media.file, tracks[2][0]);
  tick(sound, 4, { speed: 900 });
  assert.equal(media.file, tracks[2][0]);
  assert.equal(media.currentTime, 4);
  sound.update({ speed: 52 });
  media.finish();
  assert.equal(media.file, tracks[3][0], 'a slowdown still draws from Tier 2');
  tick(sound, 3, { speed: 555, musicTierFloor: 4 });
  assert.equal(media.file, tracks[3][0]);
  assert.equal(media.currentTime, 3);
  media.finish();
  assert.equal(media.file, tracks[6][0], 'an updated floor takes effect at the song ending');
  sound.update({ speed: 555, musicTierFloor: 2 });
  assert.equal(media.file, tracks[6][0]);
  media.finish();
  assert.equal(media.file, tracks[4][0], 'actual speed can pick a tier above the floor');
  sound.update({ speed: 40 });
  assert.equal(media.file, tracks[4][0]);
  media.finish();
  assert.equal(media.file, tracks[2][0]);
});

test('actual speed is sampled only when the recording completes and visits every tier at its cutoff', async t => {
  const { sound, instances } = setup(t);
  sound.update({ mode: 'running', speed: 279.99 });
  const media = await unlock(sound);
  assert.equal(media.file, tracks[0][0]);
  assert.equal(media.preload, 'none');
  for (const [index, speed] of [[2, 280], [4, 530], [6, 790], [8, 1020]]) {
    const previous = media.file;
    media.currentTime = media.duration - 0.25;
    sound.update({ speed });
    assert.equal(media.file, previous);
    assert.equal(media.playbackRate, 1);
    media.advance(0.24);
    assert.equal(media.file, previous);
    media.advance(0.02);
    assert.equal(media.file, tracks[index][0]);
    assert.equal(media.currentTime, 0);
  }
  sound.update({ speed: Number.MAX_VALUE });
  assert.ok(sound.mix.level <= 0.93);
  assert.ok(sound.cutoff <= 15600);
  media.finish();
  assert.equal(media.file, tracks[8][0]);
  assert.equal(media.currentTime, 0);
  assert.equal(media.paused, false);
  assert.equal(instances.length, 1);
  assert.equal(media.loads.length, 5, 'only selected tracks load, using a single element');
});

test('shuffle bags survive tier changes, reshuffle on exhaustion and share tier one with the menu', async t => {
  const rolls = [0.1, 0.75, 0.75, 0.1, 0.75];
  const { sound } = setup(t, { random: () => {
    assert.ok(rolls.length, 'only a newly filled pair requires a random draw');
    return rolls.shift();
  } });
  const media = await unlock(sound);
  assert.equal(media.file, tracks[1][0]);
  sound.update({ mode: 'running', speed: 32 });
  assert.equal(media.file, tracks[0][0]);
  sound.update({ speed: 532 });
  media.finish();
  assert.equal(media.file, tracks[4][0]);
  sound.update({ speed: 300 });
  media.finish();
  assert.equal(media.file, tracks[2][0]);
  sound.update({ speed: 1200 });
  media.finish();
  assert.equal(media.file, tracks[8][0]);
  media.finish();
  assert.equal(media.file, tracks[8][0]);
  sound.update({ speed: 780 });
  media.finish();
  assert.equal(media.file, tracks[5][0]);
  media.finish();
  assert.equal(media.file, tracks[5][0], 'a new pair may begin with the last recording of the exhausted pair');
  media.finish();
  assert.equal(media.file, tracks[4][0]);
  sound.update({ speed: 520 });
  media.finish();
  assert.equal(media.file, tracks[3][0]);
  sound.update({ mode: 'ended', speed: 850 });
  assert.equal(media.file, tracks[3][0]);
  media.finish();
  assert.equal(media.file, tracks[0][0]);
  assert.equal(level(sound), 0.27);
  assert.equal(media.playbackRate, 0.9);
  media.finish();
  assert.equal(media.file, tracks[1][0]);
  assert.equal(rolls.length, 0);
});

test('crashing fades to quiet results as the same playhead advances, then restarting restores the mix', async t => {
  const { sound } = setup(t);
  sound.update({ mode: 'running', speed: 400 });
  const media = await unlock(sound);
  tick(sound, 26.125);
  const track = sound.activeMusic;
  const activity = [media.loads.length, media.pauses, media.seeks.length, media.calls];
  const original = level(sound);
  sound.update({ mode: 'ended', speed: 1250 });
  assert.equal(level(sound), original);
  assert.equal(media.playbackRate, 1);
  assert.equal(media.paused, false);
  tick(sound, 0.625);
  assert.equal(media.currentTime, 26.75);
  const quiet = 0.27 * 0.73;
  assert.ok(Math.abs(level(sound) - Math.sqrt(original * quiet)) < 1e-9);
  assert.equal(media.playbackRate, 0.95);
  tick(sound, 0.625);
  assert.ok(media.currentTime > 27);
  assert.equal(level(sound), quiet);
  assert.equal(media.playbackRate, 0.9);
  const positionAtRestart = media.currentTime;
  sound.update({ mode: 'running', speed: 32 });
  assert.equal(media.currentTime, positionAtRestart);
  assert.equal(level(sound), quiet);
  assert.equal(media.playbackRate, 0.9);
  tick(sound, 0.35);
  assert.ok(level(sound) > quiet && level(sound) < original);
  assert.ok(media.playbackRate > 0.9 && media.playbackRate < 1);
  tick(sound, 0.4);
  assert.equal(level(sound), original);
  assert.equal(media.playbackRate, 1);
  assert.ok(media.currentTime > positionAtRestart);
  assert.equal(sound.activeMusic, track);
  assert.deepEqual([media.loads.length, media.pauses, media.seeks.length, media.calls], activity);
});

for (const protocol of ['http:', 'file:']) {
  test(`an immediate restart reverses the ${protocol} fade from its current gain and rate`, async t => {
    const { sound } = setup(t, { protocol });
    sound.update({ mode: 'running', speed: 1050 });
    const media = await unlock(sound);
    const runLevel = level(sound);
    const file = media.file;
    tick(sound, 12);
    sound.update({ mode: 'ended' });
    tick(sound, 0.22);
    const inFade = level(sound);
    const slowed = media.playbackRate;
    const position = media.currentTime;
    assert.ok(inFade < runLevel && inFade > 0.27 * 0.79);
    assert.ok(slowed < 1 && slowed > 0.9);
    sound.update({ mode: 'running', speed: 32 });
    assert.equal(level(sound), inFade);
    assert.equal(media.playbackRate, slowed);
    assert.equal(media.currentTime, position);
    tick(sound, 0.35);
    assert.ok(level(sound) > inFade && level(sound) < runLevel);
    assert.ok(media.playbackRate > slowed && media.playbackRate < 1);
    tick(sound, 0.40);
    assert.equal(level(sound), runLevel);
    assert.equal(media.playbackRate, 1);
    assert.equal(media.file, file);
    assert.equal(media.loads.length, 1);
    assert.equal(media.calls, 1);
    sound.update({ mode: 'ended' });
    tick(sound, 1.26);
    assert.equal(level(sound), 0.27 * 0.79);
    assert.equal(media.playbackRate, 0.9);
  });
}

test('a song chosen in results continues on restart and its next ending draws at current run speed', async t => {
  const { sound } = setup(t);
  sound.update({ mode: 'running', speed: 800 });
  const media = await unlock(sound);
  sound.update({ mode: 'ended', speed: 1260 });
  assert.equal(media.file, tracks[6][0]);
  media.finish();
  assert.equal(media.file, tracks[0][0]);
  assert.equal(level(sound), 0.27);
  assert.equal(media.playbackRate, 0.9);
  tick(sound, 3);
  const position = media.currentTime;
  sound.update({ mode: 'running', speed: 800 });
  assert.equal(media.file, tracks[0][0]);
  assert.equal(media.currentTime, position);
  media.finish();
  assert.equal(media.file, tracks[7][0]);
  assert.equal(media.playbackRate, 1);
});

test('live and replay cues advance forward, hold the closing phrase and release into the current tier', async t => {
  const { sound } = setup(t);
  sound.update({ mode: 'running', speed: 1020 });
  const media = await unlock(sound);
  const runFile = media.file;
  const openingLevel = sound.mix.level;
  media.currentTime = 156.25;
  sound.update({ speed: 500, transmissionTime: 0 });
  assert.ok(sound.mix.level < openingLevel * 0.41);
  assert.equal(sound.cutoff, 2100);
  tick(sound, 0.24, { transmissionTime: 0.24 });
  assert.equal(media.playbackRate, 0.72);
  assert.ok(media.currentTime > 156.25 && media.currentTime < 156.6);
  tick(sound, 0.35, { transmissionTime: 0.59 });
  assert.equal(media.currentTime, 152.1);
  assert.equal(media.file, runFile);
  media.finish();
  assert.equal(media.currentTime, 152.1, 'native end also wraps when media updates arrive late');
  media.advance(1);
  sound.update({ speed: 800, transmissionTime: null });
  assert.equal(media.file, runFile);
  assert.ok(sound.mix.level > openingLevel * 0.97);
  tick(sound, 0.24);
  assert.equal(media.playbackRate, 1);
  tick(sound, 4);
  assert.equal(media.file, tracks[6][0]);

  sound.update({ mode: 'ended', speed: 1200 });
  media.finish();
  assert.equal(media.file, tracks[0][0]);
  sound.update({ transmissionTime: 0 });
  tick(sound, 0.24, { transmissionTime: 0.24 });
  assert.equal(media.playbackRate, 0.72);
  assert.ok(Math.abs(sound.mix.level - 0.108) < 0.001);
  media.currentTime = 190.2;
  tick(sound, 0.5, { transmissionTime: 0.74 });
  assert.equal(media.currentTime, 184);
  sound.update({ transmissionTime: null });
  tick(sound, 0.24);
  assert.equal(media.playbackRate, 0.9);
  tick(sound, 7.1);
  assert.equal(media.file, tracks[1][0]);
  assert.equal(media.playbackRate, 0.9);
});

test('restarting during a results replay releases the cue from its audible mix on the same track', async t => {
  const { sound } = setup(t);
  sound.update({ mode: 'ended', transmissionTime: 0 });
  const media = await unlock(sound);
  const cueLevel = level(sound);
  assert.equal(media.playbackRate, 0.72);
  assert.ok(sound.radioVoice);
  tick(sound, 0.2, { transmissionTime: 0.2 });
  const position = media.currentTime;
  sound.update({ mode: 'running', speed: 820 });
  assert.equal(level(sound), cueLevel);
  assert.equal(media.playbackRate, 0.72);
  assert.equal(media.currentTime, position);
  assert.equal(sound.radioVoice, null);
  tick(sound, 0.35);
  assert.ok(level(sound) > cueLevel && level(sound) < 0.88);
  assert.ok(media.playbackRate > 0.72 && media.playbackRate < 1);
  tick(sound, 0.4);
  assert.equal(level(sound), 0.88);
  assert.equal(media.playbackRate, 1);
  assert.equal(media.file, tracks[0][0]);
  assert.equal(media.loads.length, 1);
});

test('media errors try the available partner, then stop retrying the exhausted tier', async t => {
  const { sound } = setup(t);
  sound.update({ mode: 'running', speed: 300 });
  const media = await unlock(sound);
  assert.equal(media.file, tracks[2][0]);
  media.fail();
  assert.equal(media.file, tracks[3][0]);
  media.fail();
  assert.equal(media.path, undefined);
  assert.equal(media.paused, true);
  for (let i = 0; i < 5; i++) sound.update();
  assert.equal(media.loads.length, 2);
  sound.update({ speed: 530 });
  assert.equal(media.file, tracks[4][0]);
  sound.update({ mode: 'ended' });
  assert.equal(media.file, tracks[4][0]);
  media.finish();
  assert.equal(media.file, tracks[0][0]);
});

test('a stale play rejection cannot suppress or skip the replacement track', async t => {
  const { sound } = setup(t);
  const media = await unlock(sound);
  let reject;
  media.pause();
  media.onPlay = () => new Promise((resolve, fail) => { reject = fail; });
  sound.update();
  assert.equal(typeof reject, 'function');
  media.onPlay = null;
  sound.update({ mode: 'running', speed: 1050 });
  assert.equal(media.file, tracks[8][0]);
  reject(Object.assign(new Error('Old load was aborted'), { name: 'NotSupportedError' }));
  await new Promise(setImmediate);
  assert.equal(media.file, tracks[8][0]);
  assert.equal(media.paused, false);
  assert.equal(sound.unavailable.size, 0);
});

test('radio replay restarts, resyncs, mutes, and resumes from the cue clock after visibility changes', async t => {
  const { sound } = setup(t);
  sound.update({ mode: 'ended', transmissionTime: 0 });
  const media = await unlock(sound);
  const context = sound.context;
  const original = sound.radioVoice.source;
  for (let i = 1; i <= 6; i++) {
    context.advance(0.1);
    sound.update({ transmissionTime: i * 0.1 });
  }
  assert.equal(sound.radioVoice.source, original);
  sound.update({ transmissionTime: 0 });
  assert.notEqual(sound.radioVoice.source, original);
  sound.update({ transmissionTime: 1.1 });
  sound.update({ transmissionTime: 1.8 });
  sound.update({ transmissionTime: 2.5 });
  assert.equal(sound.voices.size, 2, 'current radio and one retiring radio');
  context.advance(0.03);
  assert.equal(sound.voices.size, 1);
  assert.ok(Math.abs(sound.radioVoice.source.offset - 2.524) < 1e-7);
  media.advance(2);
  const parked = media.currentTime;
  await sound.suspend();
  assert.equal(sound.radioVoice, null);
  assert.equal(sound.voices.size, 0);
  assert.equal(media.paused, true);
  media.advance(30);
  assert.equal(media.currentTime, parked);
  sound.update({ transmissionTime: 2.53 });
  await sound.resume();
  assert.equal(sound.radioVoice.source.offset, 2.53);
  assert.equal(media.currentTime, parked);
  assert.equal(media.paused, false);
  assert.equal(media.loads.length, 1);

  sound.setMuted(true);
  assert.equal(sound.master.gain.events.at(-1).value, 0);
  context.advance(0.05);
  assert.equal(sound.voices.size, 0);
  assert.equal(media.paused, false);
  sound.update({ transmissionTime: 3 });
  sound.setMuted(false);
  assert.equal(sound.master.gain.events.at(-1).value, 0.83);
  assert.equal(sound.radioVoice.source.offset, 3);
  const source = sound.mediaSource;
  sound.dispose();
  assert.equal(context.state, 'closed');
  assert.equal(media.paused, true);
  assert.equal(media.path, undefined);
  assert.equal(media.onended, null);
  assert.equal(source.outputs.length, 0);
  assert.ok(context.sources.every(node => node.outputs.length === 0));
});

test('file playback uses the native element volume and mute instead of a media source graph', async t => {
  const { sound } = setup(t, { protocol: 'file:' });
  const media = await unlock(sound);
  assert.equal(media.path, 'synth/' + tracks[0][0]);
  assert.equal(sound.mediaSource, undefined);
  assert.equal(media.volume, 0.27);
  sound.update({ mode: 'running', speed: 41 });
  assert.ok(media.volume > 0.8);
  sound.update({ transmissionTime: 1 });
  tick(sound, 0.24, { transmissionTime: 1.24 });
  assert.equal(media.playbackRate, 0.72);
  assert.ok(media.volume < 0.4);
  sound.setMuted(true);
  assert.equal(media.muted, true);
  sound.setMuted(false);
  assert.equal(media.muted, false);
  sound.update();
  tick(sound, 0.24);
  assert.equal(media.playbackRate, 1);
  assert.ok(media.volume > 0.8);
});

test('the existing radio cue still generates a bounded eight-second mono signal', async t => {
  const { sound } = setup(t);
  sound.update({ mode: 'running', transmissionTime: 0 });
  await unlock(sound);
  const radio = sound.radioBuffer;
  assert.equal(radio.duration, 8);
  assert.equal(radio.numberOfChannels, 1);
  const data = radio.getChannelData(0);
  let peak = 0;
  for (const sample of data) peak = Math.max(peak, Math.abs(sample));
  assert.ok(peak > 0.13 && peak <= 0.52);
  assert.equal(Math.abs(data[0]), 0);
  assert.ok(Math.abs(data.at(-1)) < 0.001);
});

for (const [clue, duration, protocol] of [[2, 8, 'http:'], [3, 10, 'http:'], [4, 12, 'file:']]) {
  test(`clue ${clue} uses its own recording after the pulse in live play and replay`, async t => {
    const { sound, decoded, loads, unlockSpoken } = setupSpoken(t, { protocol });
    await unlockSpoken();
    assert.equal(new URL(loads[0].src).protocol, protocol);
    assert.ok(loads[0].src.endsWith('/audio/relay-nine.js'));
    assert.equal(new Set(decoded.map(buffer => buffer.bytes)).size, 3);
    let original;
    for (const mode of ['running', 'ended']) {
      const cue = { mode, transmissionClue: clue };
      sound.update({ mode });
      tick(sound, 1.26);
      sound.update({ ...cue, transmissionTime: 0 });
      const file = sound.media.file;
      tick(sound, 1.19, { ...cue, transmissionTime: 1.19 });
      assert.equal(sound.radioVoice, null);
      assert.equal(sound.mix.cue, null);
      assert.equal(sound.media.playbackRate, mode === 'running' ? 1 : 0.9);
      tick(sound, 0.01, { ...cue, transmissionTime: 1.2 });
      const source = sound.radioVoice.source;
      assert.notEqual(source, original);
      original = source;
      assert.equal(source.buffer, decoded[clue - 2]);
      assert.equal(source.playbackRate.value, 1);
      assert.equal(source.offset, 0);
      assert.ok(Math.abs(source.stopAt - source.startedAt - (duration - 1.2)) < 1e-7);
      tick(sound, 0.25, { ...cue, transmissionTime: 1.45 });
      assert.equal(sound.media.file, file);
      assert.equal(sound.media.playbackRate, 0.72);
      assert.equal(sound.mix.cue, clue);
      sound.update({ ...cue, transmissionTime: duration });
      assert.equal(sound.radioVoice, null);
      assert.equal(sound.mix.cue, null);
      sound.context.advance(0.03);
    }
    assert.equal(loads.length, 1);
  });
}

test('spoken cue switches, mute, suspension, and restart keep a single cue clock', async t => {
  const { sound, decoded, unlockSpoken } = setupSpoken(t);
  await unlockSpoken();
  sound.update({ mode: 'ended', transmissionClue: 2, transmissionTime: 1.8 });
  const original = sound.radioVoice.source;
  sound.update({ mode: 'ended', transmissionClue: 3, transmissionTime: 1.8 });
  const replacement = sound.radioVoice.source;
  assert.equal(replacement.buffer, decoded[1]);
  assert.equal(replacement.startedAt, original.stopAt, 'retiring and replacement voices do not overlap');
  assert.ok(Math.abs(replacement.offset - 0.624) < 1e-7);
  sound.update({ mode: 'ended', transmissionClue: 4, transmissionTime: 1.8 });
  assert.equal(sound.radioVoice.source.startedAt, original.stopAt, 'cancel a queued voice without extending the delay');
  assert.ok(replacement.stopAt < replacement.startedAt);
  tick(sound, 0.12, { mode: 'ended', transmissionClue: 4, transmissionTime: 1.92 });
  assert.equal(sound.voices.size, 1);

  sound.setMuted(true);
  tick(sound, 0.18, { mode: 'ended', transmissionClue: 4, transmissionTime: 2.1 });
  assert.equal(sound.voices.size, 0);
  sound.setMuted(false);
  assert.ok(Math.abs(sound.radioVoice.source.offset - 0.9) < 1e-7);
  await sound.suspend();
  assert.equal(sound.voices.size, 0);
  sound.update({ mode: 'ended', transmissionClue: 4, transmissionTime: 2.15 });
  await sound.resume();
  assert.ok(Math.abs(sound.radioVoice.source.offset - 0.95) < 1e-7);
  sound.update({ transmissionClue: null, transmissionTime: 2.15 });
  assert.equal(sound.radioVoice, null, 'an explicit null does not fall back to clue 1');
  sound.update({ mode: 'running' });
  sound.context.advance(0.03);
  assert.equal(sound.voices.size, 0);
  assert.equal(sound.transmission, null);
});

for (const failLoad of [false, true]) {
  test(`${failLoad ? 'missing' : 'late'} recordings leave playback on the foreground clock`, async t => {
    const { sound, deliver, unlockSpoken } = setupSpoken(t, { deferLoad: true, failLoad });
    await unlockSpoken();
    sound.update({ transmissionClue: 4, transmissionTime: 0 });
    tick(sound, 1.2, { transmissionClue: 4, transmissionTime: 1.2 });
    await deliver();
    tick(sound, 1, { transmissionClue: 4, transmissionTime: 2.2 });
    assert.equal(sound.radioVoice, null);
    assert.equal(sound.media.playbackRate, 0.72);
    sound.update({ transmissionClue: 4, transmissionTime: 0 });
    tick(sound, 1.2, { transmissionClue: 4, transmissionTime: 1.2 });
    assert.equal(Boolean(sound.radioVoice), !failLoad, 'a later replay can use a recording that finished loading');
    sound.update({ transmissionTime: 0 });
    assert.equal(sound.radioVoice.source.buffer, sound.radioBuffer);
  });
}

for (const [discoveredClues, speed, firstTrack] of [[2, 112, 4], [3, 144, 6], [4, 176, 8]]) {
  test(`the ${speed} m/s launch selects Tier ${discoveredClues + 1} and reuses a matching song`, async t => {
    const { sound } = setup(t);
    const run = new Run({ discoveredClues });
    assert.equal(run.speed, speed);
    const launch = { mode: 'running', speed: run.speed, musicTierFloor: run.musicTierFloor };
    sound.update(launch);
    const media = await unlock(sound);
    assert.equal(media.file, tracks[firstTrack][0], 'first gesture on a fresh page');
    tick(sound, 3);
    sound.update({ mode: 'ended' });
    tick(sound, 1.3);
    const position = media.currentTime;
    const previous = sound.activeMusic;
    sound.update(launch);
    assert.equal(media.currentTime, position);
    assert.equal(sound.activeMusic, previous);
    sound.update({ speed: 40 });
    media.finish();
    assert.equal(media.file, tracks[Math.min(firstTrack + 1, 8)][0]);
    const songAtSpeedup = sound.activeMusic;
    sound.update({ speed: 1050 });
    assert.equal(sound.activeMusic, songAtSpeedup);
    media.finish();
    assert.equal(media.file, tracks[8][0]);
  });
}
