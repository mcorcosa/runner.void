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
  const installButton = byId('install');
  const installGuide = byId('install-guide');
  const installDone = byId('install-done');
  const installHostNote = byId('install-host-note');
  const installAppleSteps = byId('install-apple-steps');
  const installBrowserSteps = byId('install-browser-steps');
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
  const MAX_STEPS_PER_FRAME = 24;
  const INSTALLED_KEY = 'void-runner-installed';
  const appDisplayMode = matchMedia('(display-mode: standalone), (display-mode: fullscreen)');
  const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1);
  const gameKeys = ['ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD', 'ArrowDown', 'KeyS', 'Space', 'KeyX', 'KeyW', 'Enter'];
  let touchLayout = matchMedia('(pointer: coarse)').matches;
  let touchCues = touchLayout;
  let swipe = null;
  let dashPointer = null;
  let runTouchRelease = null;
  let fullscreenPending = false;
  let nativeInstallOffer = null;
  let offerSeen = false;
  let installPending = false;
  let guideOpen = false;
  let installedThisPage = false;
  let installedHint = readInstallHint();
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
    updateInstallButton();
  }

  function runningAsApp() {
    return navigator.standalone === true || appDisplayMode.matches;
  }

  function readInstallHint() {
    try { return window.localStorage?.getItem(INSTALLED_KEY) === 'yes'; }
    catch { return false; }
  }

  function rememberInstall(value) {
    installedHint = value;
    try {
      if (value) window.localStorage?.setItem(INSTALLED_KEY, 'yes');
      else window.localStorage?.removeItem(INSTALLED_KEY);
    } catch {
      // The current page can keep its install state when browser storage is unavailable.
    }
  }

  function updateInstallButton() {
    installButton.hidden = mode !== 'ready' || runningAsApp() || installedThisPage || installedHint ||
      !(appleMobile || touchLayout || offerSeen);
    installButton.setAttribute('aria-disabled', String(installPending));
    if (mode === 'ready' && installButton.hidden && document.activeElement === installButton) {
      startButton.focus({ preventScroll: true });
    }
  }

  function openInstallGuide() {
    if (guideOpen) return;
    guideOpen = true;
    installHostNote.hidden = location.protocol === 'http:' || location.protocol === 'https:';
    installAppleSteps.hidden = !appleMobile;
    installBrowserSteps.hidden = appleMobile;
    if (typeof installGuide.showModal === 'function') installGuide.showModal();
    else {
      intro.inert = true;
      installGuide.setAttribute('open', '');
    }
    installDone.focus({ preventScroll: true });
  }

  function dismissInstallGuide() {
    if (!guideOpen) return;
    guideOpen = false;
    if (typeof installGuide.close === 'function') installGuide.close();
    else {
      installGuide.removeAttribute('open');
      intro.inert = false;
    }
    if (mode === 'ready') (installButton.hidden ? startButton : installButton).focus({ preventScroll: true });
  }

  function captureInstallOffer(event) {
    if (typeof event.prompt !== 'function') return;
    event.preventDefault();
    if (installedThisPage || runningAsApp()) return;
    if (installedHint) rememberInstall(false);
    nativeInstallOffer = event;
    offerSeen = true;
    updateInstallButton();
  }

  function onInstalled() {
    installedThisPage = true;
    nativeInstallOffer = null;
    rememberInstall(true);
    updateInstallButton();
    dismissInstallGuide();
  }

  async function activateInstall() {
    if (installButton.hidden || guideOpen || installPending) return;
    const offer = nativeInstallOffer;
    if (!offer) {
      openInstallGuide();
      return;
    }

    // A browser offer can only be used once. Call it inside this click before awaiting its result.
    nativeInstallOffer = null;
    installPending = true;
    updateInstallButton();
    try {
      const response = await offer.prompt();
      const choice = response?.outcome ? response : await offer.userChoice;
      if (choice?.outcome === 'accepted') onInstalled();
    } catch {
      if (!installButton.hidden) openInstallGuide();
    } finally {
      installPending = false;
      updateInstallButton();
      if (!installButton.hidden && !guideOpen && document.activeElement === document.body) {
        installButton.focus({ preventScroll: true });
      }
    }
  }

  function markTouchInput() {
    touchCues = true;
    if (!touchLayout) {
      touchLayout = true;
      updateInputLayout();
    }
  }

  function useTouch(event) {
    if (event.pointerType === 'touch') markTouchInput();
  }

  function clearContacts() {
    swipe = null;
    runTouchRelease = null;
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
      if (y < 0) run.jump();
      else run.slide();
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

  function requestGameFullscreen() {
    if (fullscreenPending || runningAsApp() ||
        document.fullscreenElement || document.fullscreen || document.webkitFullscreenElement ||
        document.webkitCurrentFullScreenElement || document.webkitIsFullScreen) return;

    try {
      let request;
      if (document.fullscreenEnabled !== false && typeof game.requestFullscreen === 'function') {
        request = game.requestFullscreen({ navigationUI: 'hide' });
      } else if (document.webkitFullscreenEnabled !== false) {
        const webkitRequest = game.webkitRequestFullscreen || game.webkitRequestFullScreen;
        if (typeof webkitRequest === 'function') request = webkitRequest.call(game);
      }
      if (request?.then) {
        fullscreenPending = true;
        const finish = () => { fullscreenPending = false; };
        Promise.resolve(request).then(finish, finish);
      }
    } catch {
      // The run can begin in the browser viewport if a native request fails.
      fullscreenPending = false;
    }
  }

  function rememberRunTouch(event) {
    if (event.isTrusted && event.pointerType === 'touch') {
      // Some browsers follow a touch release with a click that carries no touch pointer type.
      runTouchRelease = { button: event.currentTarget, expires: Date.now() + 750 };
    }
  }

  function activateRunButton(event) {
    if (mode === 'running' || guideOpen || installPending) return;
    const touchClick = event?.isTrusted && (event.pointerType === 'touch' || event.sourceCapabilities?.firesTouchEvents ||
      (event.detail > 0 && runTouchRelease && runTouchRelease.button === event.currentTarget && Date.now() <= runTouchRelease.expires));
    if (touchClick) {
      markTouchInput();
      requestGameFullscreen();
    }
    start();
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
        message = { text: 'Power slide', tone: 'mint', until: run.boostUntil };
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
      if (run.slideWindowOpen) {
        cue = touchCues ? 'Power slide now · Swipe down' : 'Power slide now · ↓ / S';
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
      } else if (run.airborne && !run.queuedSlide) {
        cue = touchCues ? 'Swipe down at touchdown' : 'Slide at touchdown · ↓ / S';
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
      } else if (run.braking) {
        cue = 'Sliding';
        tone = 'violet';
      }
    }
    write(feedback, cue);
    if (feedback.dataset.tone !== tone) feedback.dataset.tone = tone;
  }

  function keyDown(event) {
    const key = event.code;
    if (guideOpen) {
      if (key === 'Escape') {
        event.preventDefault();
        dismissInstallGuide();
      } else if (key === 'Tab') {
        event.preventDefault();
        installDone.focus({ preventScroll: true });
      } else if (event.repeat && (key === 'Enter' || key === 'Space')) {
        event.preventDefault();
      }
      return;
    }
    if (installPending) return;
    if (!gameKeys.includes(key) || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.target === installButton && (key === 'Space' || key === 'Enter')) {
      if (event.repeat) event.preventDefault();
      return;
    }
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
    if (key === 'Space') run.jump();
    if (key === 'ArrowDown' || key === 'KeyS') run.slide();
    if (key === 'KeyX' || key === 'KeyW') run.dash();
  }

  function frame(now) {
    const elapsed = previousFrame === null ? 0 : (now - previousFrame) / 1000;
    previousFrame = now;
    if (mode === 'running') {
      lag += elapsed;
      // Preserve elapsed play time while limiting how much a delayed frame can process at once.
      for (let steps = 0; lag >= STEP && mode === 'running' && steps < MAX_STEPS_PER_FRAME; steps++) {
        lag -= STEP;
        run.tick();
      }
    }
    updateHud();
    scene.draw(run, now / 1000, Math.min(elapsed, 0.1), mode);
    requestAnimationFrame(frame);
  }

  for (const button of [startButton, restartButton]) {
    button.addEventListener('pointerdown', () => { runTouchRelease = null; });
    button.addEventListener('pointercancel', () => { runTouchRelease = null; });
    button.addEventListener('pointerup', rememberRunTouch);
    button.addEventListener('click', activateRunButton);
  }
  installButton.addEventListener('click', activateInstall);
  installDone.addEventListener('click', dismissInstallGuide);
  installGuide.addEventListener('click', (event) => {
    if (event.target === installGuide) dismissInstallGuide();
  });
  installGuide.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismissInstallGuide();
  });
  window.addEventListener('beforeinstallprompt', captureInstallOffer);
  window.addEventListener('appinstalled', onInstalled);
  appDisplayMode.addEventListener?.('change', () => {
    updateInstallButton();
    if (runningAsApp()) dismissInstallGuide();
  });
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
    lag = 0;
  }
  window.addEventListener('blur', resetInput);
  window.addEventListener('orientationchange', clearContacts);
  window.screen?.orientation?.addEventListener('change', clearContacts);
  window.visualViewport?.addEventListener('resize', clearContacts);
  document.addEventListener('visibilitychange', resetInput);
  function resizeGame() {
    clearContacts();
    scene.resize();
  }
  window.addEventListener('resize', resizeGame);
  document.addEventListener('fullscreenchange', resizeGame);
  document.addEventListener('webkitfullscreenchange', resizeGame);
  new ResizeObserver(() => {
    if (scene.resize()) clearContacts();
  }).observe(canvas);
  scene.resize();
  updateInputLayout();
  requestAnimationFrame(frame);
})();
