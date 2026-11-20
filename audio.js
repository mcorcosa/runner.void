(function (root) {
  'use strict';

  const SAMPLE_RATE = 24000;
  const RADIO_LENGTH = 8;
  const TRANSMISSION_LENGTHS = [RADIO_LENGTH, 8, 10, 12];
  const PULSE_LEAD = root.VoidEpisode?.PULSE_LEAD ?? 1.2;
  const assetPath = 'audio/relay-nine.js';
  const scriptUrl = root.document?.currentScript?.src;
  let recordings;
  const CUE_RATE = 0.72;
  const RESULTS_RATE = 0.90;
  const RESULTS_FADE = 1.25;
  const RUN_FADE = 0.70;
  const CUE_FADE = 0.22;
  const FADE = 0.045;
  const IMPACT_DUCK = 10 ** (-4 / 20);
  const IMPACT_ATTACK = 0.018;
  const IMPACT_HOLD = 0.110;
  const IMPACT_RELEASE = 0.280;
  const IMPACT_PEAK = 0.24;
  const TAU = Math.PI * 2;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  // Measured beat grid in BPM, closing phrase [in, out] in seconds, and level from source RMS.
  const TIERS = [
    { speed: 0, tracks: [
      { file: 'the_mountain-synthwave-593074.mp3', bpm: 90, closing: [184.0, 190.5], level: 1 },
      { file: 'aberrantrealities-synthetic-cohesion-566278.mp3', bpm: 100, closing: [146.4, 151.6], level: 1 },
    ] },
    { speed: 280, tracks: [
      { file: 'kulakovka-dark-synthwave-624644.mp3', bpm: 100, closing: [132.0, 137.2], level: 0.73 },
      { file: 'audiorells-outrun-neon-dreams-80s-199668.mp3', bpm: 102.7, closing: [126.2, 131.1], level: 0.47 },
    ] },
    { speed: 530, tracks: [
      { file: 'petrushkasound-pop-synth-background-music-465681.mp3', bpm: 123, closing: [172.5, 180.5], level: 0.79 },
      { file: 'alex-morgan-synthwave-arcade-retro-nights-573647.mp3', bpm: 126, closing: [132.0, 137.1], level: 0.60 },
    ] },
    { speed: 790, tracks: [
      { file: 'freemusiclab-charming-phonk-i-free-background-music-i-free-music-lab-release-513626.mp3',
        bpm: 128, closing: [147.3, 151.9], level: 0.41 },
      { file: 'alex-morgan-gaming-stream-arcade-session-578484.mp3', bpm: 130.3, closing: [121.8, 126.4], level: 0.61 },
    ] },
    { speed: 1020, tracks: [
      { file: 'imageaudioteam-80s-synth-166739.mp3', bpm: 150, closing: [152.1, 156.6], level: 0.79 },
    ] },
  ];

  function randomFor(seed) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 2147483648 - 1;
    };
  }

  const tone = (frequency, time) => Math.sin(TAU * frequency * time);
  const decay = (time, seconds) => Math.exp(-time / seconds);
  const IMPACTS = new Map([
    // Duration, attack, and a blend of resonances and filtered noise for each surface.
    ['hurdle', [0.105, 0.003, (t, low, mid) =>
      (tone(245, t) + 0.38 * tone(510, t)) * decay(t, 0.020) + (low + mid) * decay(t, 0.013)]],
    ['barrier', [0.155, 0.002, (t, low, mid, high) =>
      (high + 0.65 * mid) * (decay(t, 0.014) + 0.32 * decay(Math.abs(t - 0.038), 0.009)) +
      0.24 * tone(465, t) * decay(t, 0.038)]],
    ['movingBarrier', [0.285, 0.010, (t, low, mid, high) =>
      (0.8 * mid + 0.4 * high + 0.24 * tone(320 - 380 * t, t)) *
      (0.68 + 0.32 * tone(39, t)) * decay(t, 0.105)]],
    ['slideGate', [0.195, 0.002, (t, low, mid, high) =>
      (0.7 * tone(1130, t) + 0.40 * tone(1823, t) + 0.26 * tone(2792, t)) * decay(t, 0.042) +
      high * decay(t, 0.009)]],
    ['spikes', [0.225, 0.006, (t, low, mid, high) =>
      (high + 0.22 * mid) * (0.78 + 0.22 * tone(58, t)) * decay(t, 0.065)]],
    ['gap', [0.380, 0.028, (t, low, mid, high) => {
      const fall = t / 0.380;
      return (0.18 * (1 - fall) * high + 0.74 * (1 - fall) * mid + (0.6 + fall) * low +
        0.27 * tone(340 - 360 * t, t)) * (1 - fall) ** 1.5;
    }]],
    ['platform', [0.165, 0.006, (t, low, mid) =>
      (tone(82 - 130 * t, t) + 0.46 * tone(157, t)) * decay(t, 0.038) +
      (0.45 * mid + 0.23 * tone(370, t)) * decay(t, 0.013)]],
  ]);
  const DEFAULT_IMPACT = [0.125, 0.004, (t, low, mid, high) =>
    (0.58 * tone(180, t) + 0.26 * mid + 0.32 * high) * decay(t, 0.027)];

  function renderImpact(context, [duration, attack, sample]) {
    const buffer = context.createBuffer(1, Math.round(duration * SAMPLE_RATE), SAMPLE_RATE);
    const data = buffer.getChannelData(0);
    const random = randomFor(0x701d);
    let low = 0;
    let body = 0;
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const noise = random();
      low += (noise - low) * 0.076;
      body += (noise - body) * 0.39;
      const t = i / SAMPLE_RATE;
      const envelope = Math.min(1, t / attack, (data.length - 1 - i) / (0.014 * SAMPLE_RATE));
      data[i] = sample(t, low, body - low, noise - body) * envelope;
      peak = Math.max(peak, Math.abs(data[i]));
    }
    const scale = IMPACT_PEAK / peak;
    for (let i = 0; i < data.length; i++) data[i] *= scale;
    return buffer;
  }

  function loadRecordings() {
    if (!root.document) return Promise.resolve([]);
    // A classic script can carry pre-encoded audio even on file: pages, where fetch is blocked.
    recordings ||= new Promise(resolve => {
      const script = root.document.createElement('script');
      const finish = () => {
        script.remove();
        resolve(script.recordings ?? []);
      };
      script.onload = script.onerror = finish;
      script.src = scriptUrl ? new URL(assetPath, scriptUrl).href : assetPath;
      root.document.head.append(script);
    });
    return recordings;
  }

  // Each token is an invented syllable with a pitch contour and moving vowel formants.
  const SYLLABLES = [
    [1.04, 0.29, 137, 153, [460, 1160, 2490], [710, 1350, 2470], 0.7],
    [1.40, 0.51, 152, 113, [520, 1790, 2490], [350, 1340, 2370], 0.45],
    [2.83, 0.33, 126, 144, [640, 1220, 2510], [440, 1020, 2330], 0.94],
    [3.18, 0.24, 150, 162, [390, 1930, 2700], [540, 1500, 2420], 0.41],
    [3.48, 0.48, 155, 120, [510, 1380, 2390], [315, 930, 2230], 0.85],
    [5.19, 0.38, 132, 157, [325, 970, 2220], [620, 1540, 2600], 0.61],
    [5.62, 0.31, 157, 147, [440, 1810, 2630], [625, 1370, 2400], 0.86],
    [5.98, 0.55, 145, 102, [570, 1130, 2390], [350, 880, 2140], 0.50],
  ];

  function* renderRadio(context) {
    const block = 8192;
    const buffer = context.createBuffer(1, RADIO_LENGTH * SAMPLE_RATE, SAMPLE_RATE);
    const data = buffer.getChannelData(0);
    const random = randomFor(0x13d71e);
    let bass = 0;
    let treble = 0;
    let crackle = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / SAMPLE_RATE;
      const noise = random();
      bass += (noise - bass) * 0.092;
      treble += (noise - treble) * 0.57;
      crackle = Math.abs(noise) > 0.997 ? noise * 0.44 : crackle * 0.88;
      const flutter = 0.064 + 0.064 * Math.sin(t * TAU * 0.73) ** 2;
      const squelch = 0.30 * Math.exp(-Math.abs(t - 0.24) / 0.115) + 0.24 * Math.exp(-Math.abs(t - 7.64) / 0.14);
      const dropout = 0.8 + 0.2 * Math.sin(t * 14) * Math.sin(t * 31);
      data[i] = (treble - bass) * (flutter + squelch) * dropout + crackle * 0.18;
      if (i % block === block - 1) yield;
    }

    const radii = [93, 125, 195].map(width => Math.exp(-Math.PI * width / SAMPLE_RATE));
    for (const [start, duration, fromPitch, toPitch, from, to, breath] of SYLLABLES) {
      const first = Math.round(start * SAMPLE_RATE);
      const length = Math.round(duration * SAMPLE_RATE);
      const last = [0, 0, 0];
      const prior = [0, 0, 0];
      const coefficients = [0, 0, 0];
      let phase = 0;
      for (let i = 0; i < length; i++) {
        const t = i / SAMPLE_RATE;
        const position = i / length;
        const glide = Math.min(1, position * 1.45);
        const pitch = fromPitch + (toPitch - fromPitch) * position + 4.1 * Math.sin(t * TAU * 6.6) + random() * 1.0;
        phase += pitch / SAMPLE_RATE;
        if (phase >= 1) phase -= 1;
        const pulse = phase < 0.35 ? Math.sin(Math.PI * phase / 0.35) ** 2 - 0.175 : -0.175;
        const air = random();
        const voicing = clamp((t - 0.025) * 24, 0, 1);
        const excitation = pulse * voicing + air * (0.024 + breath * 0.5 * (1 - voicing));
        if (i % 48 === 0) {
          for (let band = 0; band < 3; band++) {
            const formant = from[band] + (to[band] - from[band]) * glide;
            coefficients[band] = 2 * radii[band] * Math.cos(TAU * formant / SAMPLE_RATE);
          }
        }
        for (let band = 0; band < 3; band++) {
          const radius = radii[band];
          const current = excitation * (1 - radius) + coefficients[band] * last[band] - radius ** 2 * prior[band];
          prior[band] = last[band];
          last[band] = current;
        }
        const envelope = Math.min(1, t / 0.029, (duration - t) / 0.105) * (0.96 - 0.31 * position);
        const flutter = 0.87 + 0.13 * Math.sin(t * TAU * 9.5);
        data[first + i] += (last[0] * 0.34 + last[1] * 0.55 + last[2] * 0.37) * envelope * flutter;
      }
      yield;
    }

    for (let i = 0; i < data.length; i++) {
      const t = i / SAMPLE_RATE;
      const envelope = Math.min(1, t / 0.055, (RADIO_LENGTH - t) / 0.16);
      data[i] = Math.tanh(data[i] * 1.75) * 0.52 * envelope;
      if (i % block === block - 1) yield;
    }
    return buffer;
  }

  function target(parameter, value, now, smooth) {
    parameter.setTargetAtTime(value, now, smooth);
  }

  function fadeProgress(fade, now) {
    return now >= fade.end ? 1 : (now - fade.start) / (fade.end - fade.start);
  }

  function musicLevel(fade, progress) {
    // Exponential gain moves at a constant rate in decibels, including on direct file playback.
    return progress === 1 ? fade.level : fade.fromLevel * (fade.level / fade.fromLevel) ** progress;
  }

  class Voice {
    constructor(context, buffer, output) {
      this.source = context.createBufferSource();
      this.source.buffer = buffer;
      this.gate = context.createGain();
      this.gate.gain.value = 0;
      this.source.connect(this.gate);
      this.gate.connect(output);
      this.fade = { from: 0, to: 0, start: 0, end: 0 };
    }

    fadeTo(level, now, duration = FADE) {
      const { from, to, start, end } = this.fade;
      const value = now >= end ? to : from + (to - from) * clamp((now - start) / (end - start), 0, 1);
      const gain = this.gate.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(value, now);
      gain.linearRampToValueAtTime(level, now + duration);
      this.fade = { from: value, to: level, start: now, end: now + duration };
    }

    disconnect() {
      this.source.onended = null;
      this.source.disconnect();
      this.gate.disconnect();
    }
  }

  class Soundtrack {
    constructor() {
      this.context = null;
      this.mode = 'ready';
      this.speed = 32;
      this.musicTierFloor = 1;
      this.transmission = null;
      this.muted = false;
      this.hidden = false;
      this.disposed = false;
      this.bags = TIERS.map(() => []);
      this.unavailable = new Set();
      this.activeMusic = null;
      this.loadedTrack = null;
      this.wakeAttempt = null;
      this.musicAttempt = null;
      this.musicBlocked = false;
      this.voices = new Set();
      this.impactSpent = false;
      this.impactVoice = null;
      this.impactBuffers = new Map();
      this.impactDuck = null;
      this.radioVoice = null;
      this.radioTail = null;
      this.radioAnchor = null;
      this.spokenRadio = new Map();
      this.mix = null;
      this.cutoff = null;
    }

    async unlock() {
      if (this.disposed || this.hidden) return false;
      try {
        if (!this.context) {
          const Context = root.AudioContext || root.webkitAudioContext;
          if (!Context) return false;
          this.context = new Context();
        }
        return await this.wake(false, true);
      } catch {
        return false;
      }
    }

    async wake(forceResume = false, primeMusic = false) {
      const context = this.context;
      if (!context || this.disposed || this.hidden) return false;
      const attempt = this.wakeAttempt = { primeMusic };
      try {
        if (primeMusic && !this.master) this.connect(context);
        const resumed = forceResume || context.state !== 'running' ? context.resume() : null;
        if (primeMusic) {
          // Call media.play() in the gesture even when AudioContext resume is asynchronous.
          this.musicBlocked = false;
          this.play();
        }
        if (resumed) await resumed;
        if (this.wakeAttempt !== attempt || this.hidden || context.state !== 'running') return false;
        if (!this.master) this.connect(context);
        if (!primeMusic) this.musicBlocked = false;
        this.play();
        return true;
      } catch {
        return false;
      } finally {
        if (this.wakeAttempt === attempt) {
          this.wakeAttempt = null;
          if (context.state !== 'running' && this.media) this.pauseMusic();
        }
      }
    }

    connect(context) {
      this.master = context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.83;
      this.master.connect(context.destination);
      this.prepareSpokenRadio(context);
      if (typeof root.Audio !== 'function') return;
      const media = this.media = new root.Audio();
      media.preload = 'none';
      media.onloadedmetadata = media.onseeked = media.ontimeupdate = media.onended = () => this.play(false);
      media.onerror = () => {
        if (media.error && this.activeMusic) this.failMusic(this.activeMusic);
      };

      // Local files can play directly, but browsers may silence them through a media source node.
      if (root.location?.protocol === 'file:' || !context.createMediaElementSource) {
        media.muted = this.muted;
        return;
      }
      this.mediaSource = context.createMediaElementSource(media);
      this.musicGain = context.createGain();
      this.musicDuck = context.createGain();
      this.filter = context.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.Q.value = -3;
      this.mediaSource.connect(this.musicGain);
      this.musicGain.connect(this.filter);
      this.filter.connect(this.musicDuck);
      this.musicDuck.connect(this.master);
    }

    update({
      mode = this.mode, speed = this.speed, musicTierFloor = this.musicTierFloor,
      transmissionClue = 1, transmissionTime = null, transmissionDuration,
    } = {}) {
      if (this.disposed) return;
      const previousMode = this.mode;
      if (mode === 'ready' || mode === 'running' || mode === 'ended') {
        this.mode = mode;
      }
      if (Number.isFinite(speed)) this.speed = Math.max(0, speed);
      if (this.mode !== 'running') this.musicTierFloor = 1;
      else if (Number.isInteger(musicTierFloor)) this.musicTierFloor = clamp(musicTierFloor, 1, TIERS.length);
      if (this.mode !== previousMode) {
        if (this.mode !== 'ended') this.clearImpact();
        if (this.mode === 'running') this.impactSpent = false;
        if (this.activeMusic) {
          const advancedEntry = this.mode === 'running' && this.musicTierFloor > 1;
          const replace = advancedEntry ? this.activeMusic.tier !== this.musicTier() :
            previousMode === 'ready' || this.mode === 'ready';
          if (replace) this.stopMusic();
        }
      }
      const clue = transmissionClue;
      const knownClue = Number.isInteger(clue) && clue >= 1 && clue <= TRANSMISSION_LENGTHS.length;
      const duration = Number.isFinite(transmissionDuration) && transmissionDuration > 0 ?
        transmissionDuration : knownClue ? TRANSMISSION_LENGTHS[clue - 1] : 0;
      const elapsed = Number.isFinite(transmissionTime) ? Math.max(0, transmissionTime) : null;
      const previous = this.transmission;
      if (!knownClue || elapsed === null || elapsed >= duration) {
        this.transmission = null;
        this.clearRadio();
      } else if (this.mode !== previousMode || previous?.clue !== clue ||
        previous.duration !== duration || elapsed < previous.elapsed - 0.05) {
        this.transmission = { clue, elapsed, duration, radioAt: clue === 1 ? 0 : PULSE_LEAD, missed: false };
        this.clearRadio();
      } else {
        previous.elapsed = elapsed;
      }
      this.play();
    }

    play(syncCue = true) {
      if (!this.master || this.hidden || this.disposed) return;
      const now = this.context.currentTime;
      const awake = this.context.state === 'running';
      if (this.media && (awake || this.wakeAttempt?.primeMusic)) this.syncMusic(now);
      if (!awake || !syncCue) return;
      this.syncRadio(now);
      if (!this.radioBuffer) this.prepareRadio();
    }

    syncMusic(now) {
      if (!this.activeMusic) this.selectMusic();
      const music = this.activeMusic;
      if (!music) return;

      const media = this.media;
      const cue = this.transmission;
      const [closingStart, closingEnd] = music.track.closing;
      const ended = !media.seeking && media.ended;
      const reachedClosingEnd = !media.seeking && media.currentTime >= closingEnd;
      if (cue && (ended || reachedClosingEnd)) {
        music.holding = true;
        media.currentTime = closingStart;
      } else if (ended || (music.holding && reachedClosingEnd)) {
        this.finishMusic();
        return;
      }
      this.setMix(music, cue && cue.elapsed >= cue.radioAt ? cue.clue : null, now);
      if (media.paused && !this.musicBlocked && !this.musicAttempt) this.startMusic(music);
    }

    musicTier() {
      if (this.mode !== 'running') return 0;
      const speedTier = TIERS.findLastIndex(({ speed }) => this.speed >= speed);
      return Math.max(speedTier, this.musicTierFloor - 1);
    }

    selectMusic() {
      const tier = this.musicTier();
      const track = this.drawTrack(tier);
      if (!track) {
        this.clearMusicSource();
        return;
      }
      this.activeMusic = { track, tier, holding: false };
      if (this.loadedTrack === track) {
        this.media.currentTime = 0;
      } else {
        this.loadedTrack = track;
        this.media.src = `synth/${track.file}`;
      }
    }

    drawTrack(tier) {
      const bag = this.bags[tier];
      if (!bag.length) {
        bag.push(...TIERS[tier].tracks.filter(track => !this.unavailable.has(track)));
        if (bag.length === 2 && Math.random() < 0.5) bag.reverse();
      }
      return bag.shift();
    }

    setMix(music, cue, now) {
      const { mode, media } = this;
      const running = mode === 'running';
      const last = this.mix;
      if (!last || last.mode !== mode || last.cue !== cue) {
        const level = music.track.level * (running ? 0.88 : 0.27) * (cue === 4 ? 0.32 : cue ? 0.40 : 1);
        const rate = cue ? CUE_RATE : mode === 'ended' ? RESULTS_RATE : 1;
        const modeFade = running ? RUN_FADE : RESULTS_FADE;
        const duration = !last ? 0 : last.mode === mode ? CUE_FADE : modeFade;
        const gain = this.musicGain?.gain;
        const fromLevel = duration === 0 ? level : gain ? musicLevel(last, fadeProgress(last, now)) : last.nativeLevel;
        this.mix = { mode, cue, level, rate, fromLevel, fromRate: media.playbackRate, start: now, end: now + duration };
        if (gain) {
          gain.cancelScheduledValues(now);
          gain.setValueAtTime(fromLevel, now);
          if (duration > 0) gain.exponentialRampToValueAtTime(level, this.mix.end);
        }
      }
      const mix = this.mix;
      const progress = fadeProgress(mix, now);
      const eased = progress * progress * (3 - 2 * progress);
      const rate = progress === 1 ? mix.rate : mix.fromRate + (mix.rate - mix.fromRate) * eased;
      if (media.playbackRate !== rate) media.playbackRate = rate;
      if (!this.musicGain) this.syncNativeVolume(now);

      if (!this.filter) return;
      const intensity = 1 - 70 / (70 + this.speed);
      const cutoff = cue === 4 ? 1800 : cue ? 2100 : running ? 8200 + 7400 * intensity : 9400;
      if (this.cutoff === null) this.filter.frequency.value = cutoff;
      else if (Math.abs(this.cutoff - cutoff) < 36) return;
      else target(this.filter.frequency, cutoff, now, 0.075);
      this.cutoff = cutoff;
    }

    impact(type) {
      if (this.mode !== 'running' || this.impactSpent || this.disposed) return;
      this.impactSpent = true;
      const context = this.context;
      if (this.muted || this.hidden || root.document?.hidden || !this.master || context?.state !== 'running') return;
      if (this.impactVoice) this.retire(this.impactVoice, true);

      const profile = IMPACTS.get(type) ?? DEFAULT_IMPACT;
      let voice;
      try {
        if (!this.impactBuffers.has(profile)) this.impactBuffers.set(profile, renderImpact(context, profile));
        const now = context.currentTime;
        voice = this.makeVoice(this.impactBuffers.get(profile), this.master);
        // Reserve peak headroom when the native file player runs outside the master gain.
        voice.fadeTo(this.media && !this.musicGain ? 0.60 : 1, now, 0.003);
        voice.source.start(now);
        this.impactVoice = voice;
        this.setImpactDuck(now, true, IMPACT_RELEASE);
      } catch {
        if (voice && voice === this.impactVoice) this.clearImpact(true);
        else if (voice) this.release(voice);
      }
    }

    impactDuckLevel(now) {
      const duck = this.impactDuck;
      if (!duck || now >= duck.end) return 1;
      if (now < duck.dippedAt) {
        return duck.from * (duck.low / duck.from) ** ((now - duck.start) / (duck.dippedAt - duck.start));
      }
      const release = clamp((now - duck.releaseAt) / (duck.end - duck.releaseAt), 0, 1);
      return duck.low ** (1 - release);
    }

    setImpactDuck(now, attack, releaseDuration) {
      const from = !releaseDuration ? 1 : this.musicDuck ? this.impactDuckLevel(now) : this.mix?.nativeDuck ?? 1;
      const low = attack ? IMPACT_DUCK : from;
      const dippedAt = now + (attack ? IMPACT_ATTACK : 0);
      const releaseAt = now + (attack ? IMPACT_HOLD : 0);
      const end = releaseAt + releaseDuration;
      this.impactDuck = releaseDuration ? { from, low, start: now, dippedAt, releaseAt, end } : null;
      const gain = this.musicDuck?.gain;
      if (gain) {
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(from, now);
        if (attack) {
          gain.exponentialRampToValueAtTime(low, dippedAt);
          gain.setValueAtTime(low, releaseAt);
        }
        if (releaseDuration) gain.exponentialRampToValueAtTime(1, end);
      } else if (!releaseDuration && this.media && this.mix) {
        this.syncNativeVolume(now);
      }
    }

    syncNativeVolume(now) {
      const mix = this.mix;
      const base = mix.nativeLevel = musicLevel(mix, fadeProgress(mix, now));
      const duck = mix.nativeDuck = this.impactDuckLevel(now);
      const volume = base * duck;
      if (this.media.volume !== volume) this.media.volume = volume;
    }

    clearImpact(immediately = false) {
      const voice = this.impactVoice;
      if (voice && (immediately || !voice.stopAt)) this.retire(voice, immediately);
      if (this.impactDuck) this.setImpactDuck(this.context.currentTime, false, immediately ? 0 : FADE);
    }

    async startMusic(music) {
      const attempt = {};
      this.musicAttempt = attempt;
      try {
        await this.media.play();
      } catch (error) {
        if (this.musicAttempt !== attempt) return;
        if (this.media.error || error?.name === 'NotSupportedError') this.failMusic(music);
        else this.musicBlocked = true;
      } finally {
        if (this.musicAttempt === attempt) this.musicAttempt = null;
      }
    }

    pauseMusic() {
      this.musicAttempt = null;
      this.media.pause();
    }

    clearMusicSource() {
      if (!this.loadedTrack) return;
      this.loadedTrack = null;
      this.media.removeAttribute('src');
      this.media.load();
    }

    stopMusic() {
      this.pauseMusic();
      this.activeMusic = null;
      this.mix = null;
    }

    finishMusic() {
      this.stopMusic();
      this.play(false);
    }

    failMusic(music) {
      const track = music.track;
      this.unavailable.add(track);
      this.bags = this.bags.map(bag => bag.filter(item => item !== track));
      this.finishMusic();
    }

    makeVoice(buffer, output, onEnd) {
      const voice = new Voice(this.context, buffer, output);
      this.voices.add(voice);
      voice.source.onended = () => {
        this.release(voice);
        onEnd?.();
      };
      return voice;
    }

    release(voice) {
      voice.disconnect();
      this.voices.delete(voice);
      if (voice === this.impactVoice) this.impactVoice = null;
      if (voice === this.radioTail) this.radioTail = null;
    }

    retire(voice, immediately = false) {
      const now = this.context.currentTime;
      if (immediately) {
        voice.source.stop(now);
        this.release(voice);
      } else {
        voice.fadeTo(0, now, 0.022);
        voice.stopAt = now + 0.024;
        voice.source.stop(voice.stopAt);
      }
    }

    clearRadio(immediately = false) {
      if (immediately && this.radioTail) this.retire(this.radioTail, true);
      const voice = this.radioVoice;
      if (voice) {
        if (immediately || voice.startsAt > this.context.currentTime) {
          this.retire(voice, true);
        } else {
          if (this.radioTail) this.retire(this.radioTail, true);
          this.radioTail = voice;
          this.retire(voice);
        }
      }
      this.radioVoice = null;
      this.radioAnchor = null;
    }

    syncRadio(now) {
      const cue = this.transmission;
      if (!cue || cue.missed || cue.elapsed < cue.radioAt) return;
      const { clue, elapsed, duration, radioAt } = cue;
      const spoken = clue !== 1;
      const recording = this.spokenRadio.get(clue);
      if (spoken && !recording) {
        // Missing or late assets must not interrupt the cue clock or join the line midway.
        cue.missed = true;
        return;
      }
      if (this.muted) return;
      const anchor = this.radioAnchor;
      if (anchor && Math.abs(elapsed - (anchor.elapsed + now - anchor.at)) < 0.30) return;
      this.clearRadio();
      if (!spoken) this.prepareRadio(true);
      const buffer = spoken ? recording : this.radioBuffer;
      const rate = spoken ? 1 : clamp(RADIO_LENGTH / duration, 0.5, 2);
      const startsAt = Math.max(now, this.radioTail?.stopAt ?? now);
      const playhead = elapsed + (startsAt - now);
      const offset = (playhead - radioAt) * rate;
      if (playhead >= duration || offset >= buffer.duration - 0.015) return;
      const voice = this.makeVoice(buffer, this.master, () => {
        if (this.radioVoice === voice) this.radioVoice = null;
      });
      voice.source.playbackRate.value = rate;
      this.radioAnchor = { elapsed, at: now };
      voice.startsAt = startsAt;
      voice.fadeTo(1, startsAt, 0.024);
      voice.source.start(startsAt, offset);
      if (spoken) voice.source.stop(startsAt + duration - playhead);
      this.radioVoice = voice;
    }

    async prepareSpokenRadio(context) {
      if (!context.decodeAudioData) return;
      try {
        const clips = await loadRecordings();
        if (this.context !== context) return;
        clips.forEach(async (clip, index) => {
          try {
            const data = Uint8Array.from(root.atob(clip), character => character.charCodeAt(0));
            const buffer = await context.decodeAudioData(data.buffer);
            if (this.context === context) this.spokenRadio.set(index + 2, buffer);
          } catch {
            // A damaged recording affects only its own cue.
          }
        });
      } catch {
        // Music, the episode clock, and sky text work without the optional recording bundle.
      }
    }

    prepareRadio(neededNow = false) {
      if (this.radioBuffer) return;
      this.radioJob ||= renderRadio(this.context);
      do {
        const item = this.radioJob.next();
        if (item.done) {
          this.radioBuffer = item.value;
          this.radioJob = null;
          return;
        }
      } while (neededNow);
    }

    setMuted(muted) {
      const next = Boolean(muted);
      if (this.disposed || next === this.muted) return;
      this.muted = next;
      if (!this.master) return;
      target(this.master.gain, next ? 0 : 0.83, this.context.currentTime, 0.014);
      if (this.media && !this.musicGain) this.media.muted = next;
      if (next) {
        this.clearImpact(true);
        this.clearRadio();
      }
      else this.play();
    }

    suspend() {
      if (this.disposed || this.hidden) return Promise.resolve(false);
      this.hidden = true;
      this.wakeAttempt = null;
      if (this.media) this.pauseMusic();
      this.clearImpact(true);
      this.clearRadio(true);
      return this.context ? this.context.suspend().then(() => true, () => false) : Promise.resolve(false);
    }

    resume() {
      this.hidden = false;
      return this.wake(true);
    }

    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.wakeAttempt = null;
      this.clearImpact(true);
      for (const voice of this.voices) this.retire(voice, true);
      if (this.media) {
        this.media.onloadedmetadata = this.media.onseeked = this.media.ontimeupdate = this.media.onended = this.media.onerror = null;
        this.pauseMusic();
        this.clearMusicSource();
      }
      for (const node of [this.mediaSource, this.musicGain, this.filter, this.musicDuck, this.master]) node?.disconnect();
      this.activeMusic = this.mix = null;
      this.radioVoice = this.radioAnchor = this.radioBuffer = null;
      this.radioJob = null;
      this.impactBuffers.clear();
      this.spokenRadio.clear();
      if (this.context) this.context.close().catch(() => {});
      this.context = this.master = this.media = this.mediaSource = this.musicGain = this.filter = this.musicDuck = null;
    }
  }

  const api = { Soundtrack };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VoidAudio = api;
})(typeof globalThis === 'object' ? globalThis : window);
