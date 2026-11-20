const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const episode = require('../../episode.js');

const ACTIONS = { left: [-1, 'ArrowLeft'], right: [1, 'ArrowRight'],
  jump: [-1, 'Space'], slide: [1, 'ArrowDown'], dash: [0, 'KeyX'] };

function appPlayer(runner, { seed, touch, discoveredClues = 0, swipeFrames = 2, scenario = '', pace = '' }) {
  class Target {
    events = {};
    dataset = {};
    style = {};
    captures = new Set();
    addEventListener(type, handler) { this.events[type] = handler; }
    setPointerCapture(id) { this.captures.add(id); }
    hasPointerCapture(id) { return this.captures.has(id); }
    releasePointerCapture(id) { this.captures.delete(id); }
    setAttribute() {}
    focus() {}
  }
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, new Target());
    return elements.get(id);
  }
  const document = Object.assign(new Target(), { body: element('body'), getElementById: element, querySelector: element });
  const window = new Target();
  const storage = {};
  if (discoveredClues) {
    const checkpoint = { version: 2, meters: episode.CLUES[discoveredClues - 1].meters, discoveredClues, bolts: 0 };
    storage[episode.SAVE_KEY + ':v2:checkpoint'] = JSON.stringify(checkpoint);
  }
  window.localStorage = Object.assign(storage, {
    getItem(key) { return this[key] ?? null; },
    setItem(key, value) { this[key] = value; },
    removeItem(key) { delete this[key]; },
  });
  let run;
  let latestClue;
  let nextFrame;
  let frames = 0;
  const environment = {
    document, window, HTMLButtonElement: Target, URLSearchParams, navigator: {},
    location: { search: `?${new URLSearchParams({ seed, scenario, pace })}`, protocol: 'http:' },
    matchMedia: (query) => ({ matches: touch && query === '(pointer: coarse)' }),
    requestAnimationFrame: (callback) => { nextFrame = callback; },
    ResizeObserver: class { observe() {} },
    VoidRunner: runner,
    VoidEpisode: episode,
    VoidScene: class {
      draw(activeRun, _time, _delta, _mode, discovered) {
        run = activeRun;
        latestClue = discovered;
      }
      resize() {}
      reset() {}
      scatter() {}
      pulseSpeed() {}
    },
  };
  vm.runInNewContext(readFileSync(join(__dirname, '../..', 'app.js'), 'utf8'), environment, { filename: 'app.js' });
  function step() { nextFrame(frames++ * 1000 / 60); }
  element('start').events.click();
  step();
  let pointerId = 0;
  const inputs = [];
  return {
    run, step, inputs, get frames() { return frames; },
    get latestClue() { return latestClue; },
    input(action) {
      inputs.push({ action, frame: frames });
      const [direction, code] = ACTIONS[action];
      if (!touch) {
        window.events.keydown({ code, preventDefault() {} });
        window.events.keyup({ code });
        return;
      }
      const vertical = action === 'jump' || action === 'slide';
      const field = element('swipe-field');
      const event = { pointerId: ++pointerId, pointerType: 'touch', clientX: 140, clientY: 240, preventDefault() {} };
      field.events.pointerdown(event);
      for (let frame = 0; frame < swipeFrames; frame++) step();
      const moved = { ...event, clientX: event.clientX + (vertical ? 0 : 42 * direction),
        clientY: event.clientY + (vertical ? 42 * direction : 0) };
      field.events.pointermove(moved);
      step();
      field.events.pointerup(moved);
      field.releasePointerCapture(event.pointerId);
    },
  };
}

module.exports = { appPlayer, ACTIONS };
