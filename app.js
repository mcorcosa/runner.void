(function () {
  'use strict';

  const { Run, STEP, SPIKE_HEIGHT } = globalThis.VoidRunner;
  const query = new URLSearchParams(location.search);
  const scenario = query.get('scenario') || '';
  const pace = query.get('pace') || '';
  const seed = query.has('seed') && Number.isFinite(Number(query.get('seed'))) ? Number(query.get('seed')) : Date.now();
  const byId = (id) => document.getElementById(id);
  const game = byId('game');
  const swipeField = byId('swipe-field');
  const touchControls = byId('touch-controls');
  const touchDash = byId('touch-dash');
  const touchDashLabel = byId('touch-dash-label');
  const touchCharge = byId('touch-charge');
  const intro = document.querySelector('.intro');
  const results = document.querySelector('.results');
  const startButton = byId('start');
  const restartButton = byId('restart');
  const distance = byId('distance');
  const speed = byId('speed');
  const feedback = byId('feedback');
  const dashStatus = byId('dash-status');
  const charge = byId('charge');
  const dashLabel = byId('dash-label');
  const canvas = byId('scene');
  const scene = new globalThis.VoidScene(canvas);
  const held = new Set();
  const swipeContacts = new Set();
  const SWIPE_DISTANCE = 24;
  const SWIPE_DOMINANCE = 1.2;
  const gameKeys = ['ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD', 'Space', 'KeyX', 'KeyW', 'Enter'];
  let touchLayout = matchMedia('(pointer: coarse)').matches;
  let touchCues = touchLayout;
  let swipe = null;
  let dashPointer = null;
  let mode = 'ready';
  let message = null;
  let lag = 0;
  let previousFrame = null;
  let run = new Run({ seed, scenario, pace, onEvent });

  function write(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }

  function updateInputLayout() {
    document.body.dataset.touch = String(touchLayout);
    swipeField.hidden = mode !== 'running';
    touchControls.hidden = !touchLayout || mode !== 'running';
  }

  function useTouch(event) {
    if (event.pointerType !== 'touch') return;
    touchCues = true;
    if (!touchLayout) {
      touchLayout = true;
      updateInputLayout();
    }
  }

  function clearContacts() {
    swipe = null;
    for (const id of swipeContacts) {
      if (swipeField.hasPointerCapture(id)) swipeField.releasePointerCapture(id);
    }
    swipeContacts.clear();
    if (dashPointer !== null && touchDash.hasPointerCapture(dashPointer)) touchDash.releasePointerCapture(dashPointer);
    dashPointer = null;
  }

  function beginSwipe(event) {
    if (mode !== 'running' || event.pointerType !== 'touch') return;
    event.preventDefault();
    useTouch(event);
    if (swipeContacts.has(event.pointerId)) return;
    swipeContacts.add(event.pointerId);
    swipeField.setPointerCapture(event.pointerId);
    // Two touches on the playfield invalidate its swipe. The Dash button has its own contact.
    swipe = swipeContacts.size === 1 ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
  }

  function moveSwipe(event) {
    if (mode !== 'running' || swipe?.id !== event.pointerId) return;
    const x = event.clientX - swipe.x;
    const y = event.clientY - swipe.y;
    const horizontal = Math.abs(x);
    const vertical = Math.abs(y);
    if (horizontal >= SWIPE_DISTANCE && horizontal >= vertical * SWIPE_DOMINANCE) {
      swipe = null;
      run.move(Math.sign(x));
    } else if (vertical >= SWIPE_DISTANCE && vertical >= horizontal * SWIPE_DOMINANCE) {
      swipe = null;
      if (y < 0) run.jumpOrTap();
    }
  }

  function endSwipe(event) {
    swipeContacts.delete(event.pointerId);
    if (swipe?.id === event.pointerId) swipe = null;
  }

  function pressTouchDash(event) {
    if (mode !== 'running' || event.button !== 0) return;
    event.preventDefault();
    if (dashPointer !== null) return;
    useTouch(event);
    dashPointer = event.pointerId;
    touchDash.setPointerCapture(event.pointerId);
    run.dash();
  }

  function endTouchDash(event) {
    if (dashPointer === event.pointerId) dashPointer = null;
  }

  function start() {
    if (mode === 'running') return;
    clearContacts();
    run = new Run({ seed, scenario, pace, onEvent });
    scene.reset(run.speed);
    message = null;
    lag = 0;
    previousFrame = null;
    mode = 'running';
    document.body.dataset.mode = mode;
    updateInputLayout();
    intro.hidden = true;
    results.hidden = true;
    if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
    updateHud();
  }

  function onEvent(type, detail) {
    if (type === 'land' || type === 'boost' || type === 'break' || type === 'crash') {
      scene.scatter(type, run, detail);
    }
    switch (type) {
      case 'boost':
        scene.pulseSpeed();
        message = { text: 'Landing boost', tone: 'mint', until: run.time + 0.85 };
        break;
      case 'break':
        message = { text: 'Barrier broken', tone: 'violet', until: run.time + 0.92 };
        break;
      case 'crash':
        mode = 'ended';
        document.body.dataset.mode = mode;
        clearContacts();
        updateInputLayout();
        write(byId('impact'), {
          hurdle: 'You hit a hurdle.',
          barrier: 'You hit a cracked barrier.',
          spikes: detail.tiles === 2 ? 'You hit long spikes. Jump, then dash in the air.' : 'You hit a spike patch.',
          roadblock: 'You hit a roadblock. Change lanes before the gap.',
          gap: 'You entered a closed lane before the track resumed.',
        }[detail.type]);
        write(byId('final-distance'), Math.floor(run.distance).toLocaleString('en-US'));
        results.hidden = false;
        restartButton.focus({ preventScroll: true });
        break;
    }
  }

  function updateHud() {
    write(distance, String(Math.floor(run.distance)).padStart(4, '0'));
    write(speed, String(Math.round(run.speed)));
    const boosting = String(mode === 'running' && run.boosting);
    if (document.body.dataset.boost !== boosting) document.body.dataset.boost = boosting;
    const dashing = mode === 'running' && run.dashing;
    if (document.body.dataset.dash !== String(dashing)) document.body.dataset.dash = String(dashing);
    write(dashStatus, dashing ? 'Dash active' : '');
    const dashReady = run.dashCharge >= 1;
    const chargeTransform = `scaleX(${run.dashCharge.toFixed(3)})`;
    if (charge.style.transform !== chargeTransform) charge.style.transform = chargeTransform;
    if (touchCharge.style.transform !== chargeTransform) touchCharge.style.transform = chargeTransform;
    const dashState = dashing ? 'active' : dashReady ? 'ready' : 'charging';
    if (touchDash.dataset.state !== dashState) touchDash.dataset.state = dashState;
    write(dashLabel, dashReady ? 'Dash ready' : 'Recharging');
    write(touchDashLabel, dashing ? 'Active' : dashReady ? 'Ready' : 'Recharging');

    let cue = '';
    let tone = '';
    if (mode === 'running') {
      const hazard = run.obstacles.find((obstacle) => (obstacle.type === 'spikes' || obstacle.type === 'gap') &&
        obstacle.end > run.distance && obstacle.z - run.distance <= run.speed * 1.3 &&
        run.lane >= obstacle.lane && run.lane < obstacle.lane + (obstacle.lanes ?? 1));
      const hazardDistance = hazard ? hazard.z - run.distance : Infinity;
      const needsAirDash = run.airborne && !run.airDashed && hazard?.type === 'spikes' && hazard.tiles === 2;
      const dashNow = needsAirDash && run.height >= SPIKE_HEIGHT + 0.18 && hazardDistance <= run.speed * 0.13;
      if (run.tapOpen) {
        cue = touchCues ? 'Swipe up now · Landing boost' : 'Tap Space now';
        tone = 'mint';
      } else if (dashNow && dashReady) {
        cue = touchCues ? 'Air dash now · Tap Dash' : 'Air dash now · W / X';
        tone = 'hazard';
      } else if (message && run.time < message.until) {
        cue = message.text;
        tone = message.tone;
      } else if (needsAirDash) {
        if (touchCues) cue = dashReady ? 'Air dash next · Tap Dash' : 'Air dash recharging';
        else cue = dashReady ? 'Air dash next · W / X' : 'Air dash recharging · W / X';
        tone = 'hazard';
      } else if (run.airborne && !run.queuedTap) {
        cue = touchCues ? 'Swipe up again at landing' : 'Tap Space at landing';
        tone = 'violet';
      } else if (!run.airborne && hazard?.type === 'gap') {
        cue = touchCues ? 'Lane closing · Swipe sideways' : 'Lane closing · Move over';
        tone = 'hazard';
      } else if (!run.airborne && hazard?.type === 'spikes') {
        if (hazardDistance <= run.spikeJumpLead(hazard)) {
          const jumpNow = touchCues ? 'Swipe up now' : 'Jump now';
          if (hazard.tiles === 1) cue = `${jumpNow} · Short spikes`;
          else if (dashReady) cue = `${jumpNow} · Air dash next`;
          else cue = touchCues ? 'Air dash recharging · Swipe sideways' : 'Air dash recharging · Move over';
        } else {
          cue = hazard.tiles === 2 ? 'Long spikes ahead' : 'Short spikes ahead';
        }
        tone = 'hazard';
      }
    }
    write(feedback, cue);
    if (feedback.dataset.tone !== tone) feedback.dataset.tone = tone;
  }

  function keyDown(event) {
    const key = event.code;
    if (!gameKeys.includes(key) || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.target === touchDash && (key === 'Space' || key === 'Enter')) return;
    // Allow native keyboard activation of buttons outside a run.
    if (mode !== 'running' && key === 'Space' && event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    if (event.repeat || held.has(key)) return;
    held.add(key);
    touchCues = false;

    if (key === 'Enter') start();
    if (mode !== 'running') return;
    if (key === 'ArrowLeft' || key === 'KeyA') run.move(-1);
    if (key === 'ArrowRight' || key === 'KeyD') run.move(1);
    if (key === 'Space') run.jumpOrTap();
    if (key === 'KeyX' || key === 'KeyW') run.dash();
  }

  function frame(now) {
    const dt = previousFrame === null ? 0 : Math.min((now - previousFrame) / 1000, 0.1);
    previousFrame = now;
    if (mode === 'running') {
      lag += dt;
      while (lag >= STEP && mode === 'running') {
        lag -= STEP;
        run.tick();
      }
    }
    updateHud();
    scene.draw(run, now / 1000, dt, mode);
    requestAnimationFrame(frame);
  }

  startButton.addEventListener('click', start);
  restartButton.addEventListener('click', start);
  game.addEventListener('pointerdown', useTouch);
  swipeField.addEventListener('pointerdown', beginSwipe);
  swipeField.addEventListener('pointermove', moveSwipe);
  touchDash.addEventListener('pointerdown', pressTouchDash);
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    swipeField.addEventListener(event, endSwipe);
    touchDash.addEventListener(event, endTouchDash);
  }
  touchDash.addEventListener('click', (event) => {
    // Native keyboard and assistive activation have no pointer. Physical presses fire on pointerdown.
    if (mode === 'running' && event.detail === 0 && !event.pointerType) run.dash();
  });
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', (event) => held.delete(event.code));
  function resetInput() {
    held.clear();
    clearContacts();
    previousFrame = null;
  }
  window.addEventListener('blur', resetInput);
  window.addEventListener('orientationchange', clearContacts);
  window.screen?.orientation?.addEventListener('change', clearContacts);
  window.visualViewport?.addEventListener('resize', clearContacts);
  document.addEventListener('visibilitychange', resetInput);
  window.addEventListener('resize', () => {
    clearContacts();
    scene.resize();
  });
  new ResizeObserver(() => {
    if (scene.resize()) clearContacts();
  }).observe(canvas);
  scene.resize();
  updateInputLayout();
  requestAnimationFrame(frame);
})();
