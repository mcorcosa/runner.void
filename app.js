(function () {
  'use strict';

  const { Run, STEP, LANE_COUNT, SPIKE_HEIGHT, slideGateBounds } = globalThis.VoidRunner;
  const { EpisodeProgress, SAVE_KEY, CLUES } = globalThis.VoidEpisode;
  const query = new URLSearchParams(location.search);
  const previewQuery = query.get('preview');
  // The original clue4 preview link is a permalink for the beacon recording.
  const preview = CLUES.findIndex(({ id }, index) => previewQuery === id || previewQuery === String(index + 1) ||
    (previewQuery === 'clue4' ? id === 'beacon' : previewQuery === `clue${index + 1}`)) + 1;
  const scenario = preview ? '' : query.get('scenario') || '';
  const pace = preview ? '' : query.get('pace') || '';
  const requestedSeed = Number(query.get('seed'));
  const courseSeed = query.has('seed') && Number.isFinite(requestedSeed) ? requestedSeed : Date.now();
  const seed = preview ? 187 : courseSeed;
  const byId = (id) => document.getElementById(id);
  const game = byId('game');
  const swipeField = byId('swipe-field');
  const touchControls = byId('touch-controls');
  const touchDash = byId('touch-dash');
  const touchDashLabel = byId('touch-dash-label');
  const touchCharge = byId('touch-charge');
  const intro = document.querySelector('.intro');
  const results = document.querySelector('.results');
  const hud = byId('hud');
  const deathShade = byId('death-shade');
  const deathThought = byId('death-thought');
  const startButton = byId('start');
  const restartButton = byId('restart');
  const resetCluesButton = byId('reset-clues');
  const resetResultsCluesButton = byId('reset-results-clues');
  const clueResetStatus = byId('clue-reset-status');
  const replayGroup = byId('recordings');
  const replayButtons = CLUES.map((_, index) => byId(`replay-${index + 1}`));
  const muteButton = byId('mute');
  const signalStatus = byId('signal-status');
  const skySignal = byId('sky-signal');
  const installButton = byId('install');
  const installGuide = byId('install-guide');
  const installDone = byId('install-done');
  const installHostNote = byId('install-host-note');
  const installAppleSteps = byId('install-apple-steps');
  const installBrowserSteps = byId('install-browser-steps');
  const distance = byId('distance');
  const speed = byId('speed');
  const bolts = byId('bolts');
  const finalBolts = byId('final-bolts');
  const bankedBolts = byId('banked-bolts');
  const boltBank = byId('bolt-bank');
  const boltSaveStatus = byId('bolt-save-status');
  const feedback = byId('feedback');
  const charge = byId('charge');
  const dashLabel = byId('dash-label');
  const canvas = byId('scene');
  const scene = new globalThis.VoidScene(canvas);
  const held = new Set();
  const swipeContacts = new Set();
  const SWIPE_DISTANCE = 24;
  const SWIPE_DOMINANCE = 1.2;
  const MAX_STEPS_PER_FRAME = 24;
  const SAVE_INTERVAL = 1;
  const DEATH_DARKEN = 1.05;
  const DEATH_ECHO = 1.37;
  const DEATH_REVEAL = 1.55;
  const DEATH_END = 3.75;
  const DEATH_THOUGHTS = {
    none: [
      'One white dot.',
      'I can still picture it.',
      'Five lanes. One dot.',
      'I could cover it with my thumb.',
      'My eyes went there first.',
      'I watched it instead of my feet.',
      'Where does the track end?',
      'Even when I blink.',
    ],
    hiss: [
      'A voice in all that hiss?',
      'Almost made out a word.',
      'Was that a breath?',
      'Static. Then something softer.',
      'I leaned in to listen.',
      'I almost said it back.',
      'Where did the hiss end?',
      'I caught the shape of a word.',
    ],
    question: [
      'Who was asking?',
      'I had the same question.',
      'What did they mean by “that”?',
      'Funny. I nearly answered.',
      'They sounded as lost as me.',
      'Did they see it too?',
      'I could hear the question mark.',
      'Who did they expect to answer?',
    ],
    sighting: [
      'They said “again.”',
      'How many times have they seen it?',
      'Same light. A different run.',
      'Which time did they mean?',
      'I remember where I was looking.',
      'Did it look familiar to them?',
      'Maybe they looked away too.',
      'I keep coming back to that word.',
    ],
    pattern: [
      'I started counting the pauses.',
      'Were they always that long?',
      'What did I miss in the quiet?',
      'I held my breath for the next.',
      'How many pauses did I hear?',
      'Was I hearing a pattern too?',
      'Could I tap out those pauses?',
      'I keep waiting for the next one.',
    ],
    beacon: [
      'How far to the beacon?',
      'Who did they mean by “we”?',
      'They sounded so sure this time.',
      'Could my thumb still hide it?',
      'Did they have a way to get there?',
      'A light to steer by. For whom?',
      'I heard every word this time.',
      'Would I stop if I reached it?',
    ],
    purpose: [
      'Could it be meant to guide me?',
      'Built by whom?',
      'Where would I end up?',
      'I never asked who built it.',
      'What would I use it to find?',
      'Was it even built to guide?',
      'Could I follow it from here?',
      'I wondered the same thing.',
    ],
    warning: [
      'Could I leave it alone?',
      'Who else needs to hear that?',
      'Do I know who “the others” are?',
      'Would I have said the same?',
      'I keep hearing “leave it.”',
      'Would I pass on those words?',
      'I can still hear that voice.',
      'What made them say that?',
    ],
    doubt: [
      'What would I be warned about?',
      'Would I know it was a warning?',
      'What if they guessed right?',
      'I heard them hesitate.',
      'Would that make me turn back?',
      'I can’t shake that question.',
      'Could the warning be for me?',
      'What would I do if it was?',
    ],
    reach: [
      'Could I find who sent it?',
      'I heard the weight on “must.”',
      'What would I ask the sender?',
      'Would they let me come along?',
      'How would I know I was there?',
      'Could I get there first?',
      'I wanted to hear one more word.',
      'Would the sender answer me?',
    ],
  };
  const deathVisits = new Map();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
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
  let death = null;
  let pageSuspended = false;
  let message = null;
  let lateralGap = null;
  let lag = 0;
  let previousFrame = null;
  const episode = preview || scenario || pace ? null : new EpisodeProgress({ storage: episodeStorage() });
  const allowClueReset = episode && /^https?:$/.test(location.protocol) &&
    ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  let shownGeneration = episode?.generation;
  let resetNotice = '';
  let run = createRun();
  let soundtrack = createSoundtrack();
  let muted = false;
  let previewCaptured = false;
  let liveClue = null;
  let nextClueAfterDistance = 0;
  let replay = null;
  let signal = null;
  let nextSave = SAVE_INTERVAL;
  let nextIdleSave = 0;
  let sceneTime = 0;

  function write(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }

  function episodeStorage() {
    try { return window.localStorage; }
    catch { return null; }
  }

  function createRun() {
    const fresh = new Run({
      seed, scenario, pace, launchLevel: episode?.launchLevel ?? 0, transmissionCount: CLUES.length, onEvent,
    });
    fresh.reducedMotion = reducedMotion.matches;
    return fresh;
  }

  function createSoundtrack() {
    try { return new globalThis.VoidAudio.Soundtrack(); }
    catch { return null; }
  }

  function audio(action, ...args) {
    try { soundtrack?.[action]?.(...args)?.catch?.(() => {}); }
    catch { soundtrack = null; }
  }

  function updateDeathPresentation() {
    const darkening = death !== null && death.elapsed >= DEATH_DARKEN;
    const shadeHidden = !darkening && (mode !== 'ended' || replay !== null);
    if (deathShade.hidden !== shadeHidden) deathShade.hidden = shadeHidden;
    const shadeProgress = darkening && !reducedMotion.matches ?
      Math.min(1, (death.elapsed - DEATH_DARKEN) / (DEATH_ECHO - DEATH_DARKEN)) : 1;
    const shadeOpacity = shadeProgress ** 2 * (3 - 2 * shadeProgress);
    if (deathShade.style.opacity !== String(shadeOpacity)) deathShade.style.opacity = String(shadeOpacity);
    const echo = death?.revealed && !death.steady && !reducedMotion.matches;
    const offset = echo ? 2 * (DEATH_REVEAL - death.elapsed) / (DEATH_REVEAL - DEATH_ECHO) : 0;
    const shadow = echo ? `-${offset.toFixed(2)}px 0 #a575f4, ${offset.toFixed(2)}px 0 #67d6d6` : '';
    if (deathThought.style.textShadow !== shadow) deathThought.style.textShadow = shadow;
    write(deathThought, death?.revealed ? death.line : '');
  }

  function updatePresentation() {
    const transmission = run.transmission;
    const live = mode === 'running' && liveClue !== null && transmission?.phase === 'playing';
    const cue = live ? { clueNumber: liveClue, elapsed: transmission.elapsed } : replay;
    const clue = cue ? CLUES[cue.clueNumber - 1] : null;
    signal = cue ? { ...cue, presentationStage: clue.presentationStage, radioAt: clue.radioAt } : null;
    const transmissionTime = cue?.elapsed ?? null;
    const afterLead = cue !== null && transmissionTime >= clue.radioAt;
    const line = afterLead ? (clue.followUp ? `${clue.line}\n${clue.followUp}` : clue.line) : '';
    const { dataset } = document.body;
    const strength = String(clue?.presentationStage ?? 0);
    if (dataset.signal !== strength) dataset.signal = strength;
    const noise = String(afterLead);
    if (dataset.signalNoise !== noise) dataset.signalNoise = noise;
    const inverted = String(afterLead && clue.invert && !reducedMotion.matches);
    if (dataset.signalInvert !== inverted) dataset.signalInvert = inverted;
    write(signalStatus, live ? 'Receiving a signal' : replay ? 'Playing transmission' : '');
    write(skySignal, line);
    updateDeathPresentation();
    const replayGroupHidden = mode !== 'ended' || !(previewCaptured || episode?.discoveredClues);
    if (replayGroup.hidden !== replayGroupHidden) replayGroup.hidden = replayGroupHidden;
    if (!replayGroupHidden) {
      for (const [index, button] of replayButtons.entries()) {
        const ordinal = index + 1;
        const hidden = !canReplay(ordinal);
        if (button.hidden !== hidden) button.hidden = hidden;
        const active = replay?.clueNumber === ordinal;
        const pressed = String(active);
        if (button.dataset.active !== pressed) {
          button.dataset.active = pressed;
          button.setAttribute('aria-pressed', pressed);
          write(button, active ? `Stop ${ordinal}` : `Clue ${ordinal}`);
        }
      }
    }
    audio('update', {
      mode: mode === 'dying' ? 'ended' : mode,
      speed: run.speed,
      musicTierFloor: run.musicTierFloor,
      transmissionTime,
      transmissionDuration: clue?.duration ?? CLUES[0].duration,
      transmissionClue: clue?.audioKey ?? null,
      transmissionRadioAt: clue?.radioAt ?? null,
    });
  }

  function updateInputLayout() {
    document.body.dataset.touch = String(touchLayout);
    hud.inert = mode === 'dying';
    swipeField.hidden = mode !== 'running';
    touchControls.hidden = !touchLayout || mode !== 'running';
    updateInstallButton();
    if (resetCluesButton) resetCluesButton.hidden = !allowClueReset || mode !== 'ready';
    if (resetResultsCluesButton) resetResultsCluesButton.hidden = !allowClueReset || mode !== 'ended';
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
    if (canStart() && event.isTrusted && event.pointerType === 'touch') {
      // Some browsers follow a touch release with a click that carries no touch pointer type.
      runTouchRelease = { button: event.currentTarget, expires: Date.now() + 750 };
    }
  }

  function canStart() {
    return (mode === 'ready' || mode === 'ended') && !pageSuspended && !document.hidden;
  }

  function activateRunButton(event) {
    if (!canStart() || guideOpen || installPending) return;
    if (event?.isTrusted) audio('unlock');
    const touchClick = event?.isTrusted && (event.pointerType === 'touch' || event.sourceCapabilities?.firesTouchEvents ||
      (event.detail > 0 && runTouchRelease && runTouchRelease.button === event.currentTarget && Date.now() <= runTouchRelease.expires));
    if (touchClick) {
      markTouchInput();
      requestGameFullscreen();
    }
    start();
  }

  function start() {
    clearContacts();
    replay = null;
    episode?.beginRun();
    shownGeneration = episode?.generation;
    resetNotice = '';
    if (clueResetStatus) write(clueResetStatus, '');
    run = createRun();
    liveClue = null;
    nextClueAfterDistance = 0;
    nextSave = SAVE_INTERVAL;
    if (preview && !previewCaptured) {
      // Start this isolated run with clear track. The regular scheduler resumes generation.
      run.obstacles.length = 0;
    }
    queueTransmission();
    scene.reset(run.speed);
    message = null;
    lateralGap = null;
    lag = 0;
    previousFrame = null;
    mode = 'running';
    document.body.dataset.mode = mode;
    updateInputLayout();
    intro.hidden = true;
    results.hidden = true;
    if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
    updateHud();
    updatePresentation();
  }

  function showFreshEpisode(notice, moveFocus = false) {
    const wasReady = mode === 'ready';
    shownGeneration = episode.generation;
    resetNotice = notice;
    resetInput();
    run = createRun();
    replay = null;
    liveClue = null;
    nextClueAfterDistance = 0;
    nextIdleSave = 0;
    message = null;
    lateralGap = null;
    mode = 'ready';
    document.body.dataset.mode = mode;
    results.hidden = true;
    intro.hidden = false;
    scene.reset(run.speed);
    updateInputLayout();
    updateHud();
    updatePresentation();
    if (!guideOpen && (!wasReady || moveFocus)) startButton.focus({ preventScroll: true });
  }

  function showPeerReset() {
    if (mode === 'dying' || episode?.generation === shownGeneration) return false;
    showFreshEpisode(allowClueReset ? 'Clue progress reset in another tab.' : '');
    return true;
  }

  function activateClueReset() {
    if (!allowClueReset || !canStart() || guideOpen || installPending) return;
    const saved = episode.reset();
    showFreshEpisode(saved ? 'Clue progress reset.' : 'Clue progress reset for this page only.', true);
  }

  function queueTransmission() {
    if (liveClue !== null || run.distance < nextClueAfterDistance) return;
    const clueNumber = preview && !previewCaptured ? preview : episode?.pendingClue;
    if (clueNumber && run.requestTransmission(CLUES[clueNumber - 1].duration, clueNumber)) liveClue = clueNumber;
  }

  function advanceRun() {
    const phase = run.transmission?.phase;
    run.tick();
    episode?.credit(run.distance, run.boltsCollected);
    if (showPeerReset()) return;
    const nextPhase = run.transmission?.phase;
    if (liveClue !== null && phase !== nextPhase && (nextPhase === 'playing' || nextPhase === 'complete')) {
      if (nextPhase === 'complete') {
        if (preview) previewCaptured = true;
        else episode.discover(liveClue);
        if (showPeerReset()) return;
        liveClue = null;
        // Generation has resumed. Let the first returning row reach the runner before queuing another clue.
        const firstRow = run.obstacles.find(({ z }) => z > run.distance);
        nextClueAfterDistance = firstRow ? firstRow.z + 2 : run.distance + run.viewDistance;
      }
      // Render the start and end of the safe window before spending any more frame time.
      lag = 0;
    }
    if (run.crash || run.time >= nextSave) {
      episode?.save();
      if (showPeerReset()) return;
      nextSave = run.time + SAVE_INTERVAL;
    }
    if (!run.crash) queueTransmission();
  }

  function latestPresentationStage() {
    return previewCaptured ? CLUES[preview - 1].presentationStage : episode?.presentationStage ?? 0;
  }

  function canReplay(clueNumber) {
    return preview ? previewCaptured && clueNumber === preview : episode?.hasHeard(CLUES[clueNumber - 1].id);
  }

  function toggleReplay(event, clueNumber) {
    if (mode !== 'ended' || pageSuspended || document.hidden) return;
    episode?.syncReset();
    if (showPeerReset()) return;
    if (!canReplay(clueNumber)) return;
    if (event.isTrusted) audio('unlock');
    replay = replay?.clueNumber === clueNumber ? null : { clueNumber, elapsed: 0 };
    previousFrame = null;
    updatePresentation();
  }

  function toggleMute(event) {
    if (mode === 'dying') return;
    muted = !muted;
    muteButton.setAttribute('aria-pressed', String(muted));
    audio('setMuted', muted);
    if (event.isTrusted) audio('unlock');
  }

  function onEvent(type, detail) {
    if (type === 'land' || type === 'boost' || type === 'break') {
      scene.scatter(type, run, detail);
    }
    switch (type) {
      case 'boost':
        scene.pulseSpeed();
        message = { text: 'Power slide', tone: 'mint', until: run.boostUntil };
        break;
      case 'break':
        message = { text: detail.type === 'movingBarrier' ? 'Moving barrier broken' : 'Barrier broken',
          tone: 'violet', until: run.time + 0.92 };
        break;
      case 'black-hole':
        message = { text: `Black hole · Pulled ${detail.direction < 0 ? 'left' : 'right'}`,
          tone: 'hazard', until: run.time + 0.84 };
        break;
      case 'crash':
        beginDeath(detail);
        break;
    }
  }

  function beginDeath(impact) {
    const knowledge = episode?.latestHeardId ?? 'none';
    const thoughts = DEATH_THOUGHTS[knowledge];
    const visit = deathVisits.get(knowledge) ?? 0;
    const line = thoughts[visit];
    deathVisits.set(knowledge, (visit + 1) % thoughts.length);
    death = { impact, elapsed: 0, line, presentationStage: latestPresentationStage(), revealed: false, steady: false };
    mode = 'dying';
    document.body.dataset.mode = mode;
    lag = 0;
    nextIdleSave = previousFrame + SAVE_INTERVAL * 1000;
    clearContacts();
    if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
    updateInputLayout();
    audio('impact', impact.type);
  }

  function advanceDeath(elapsed) {
    death.elapsed += elapsed;
    // Render the reveal and the full reading hold even if a foreground frame arrives late.
    if (!death.revealed && !reducedMotion.matches && death.elapsed >= DEATH_ECHO) {
      death.elapsed = DEATH_ECHO;
      death.revealed = true;
    } else if (!death.steady && death.elapsed >= DEATH_REVEAL) {
      death.elapsed = DEATH_REVEAL;
      death.revealed = true;
      death.steady = true;
    }
    if (death.elapsed >= DEATH_END) endRun();
  }

  function endRun() {
    death = null;
    mode = 'ended';
    document.body.dataset.mode = mode;
    if (showPeerReset()) return;
    updateInputLayout();
    const { type, tiles, lateralExit } = run.crash;
    write(byId('impact'), {
      hurdle: 'You hit a hurdle.',
      barrier: 'You hit a cracked barrier.',
      spikes: tiles === 2 ? 'You hit long spikes. Jump, then dash in the air.' : 'You hit a spike patch.',
      gap: lateralExit !== undefined ? 'You fell through a gap. Jump across to the solid lane.' :
        'You fell through a gap. Land on solid track.',
      platform: 'You hit the platform’s edge. Jump onto the deck.',
      slideGate: 'You hit a slide gate. Slide under the beam.',
      movingBarrier: 'You hit a moving barrier. Dodge it or dash through.',
    }[type] ?? 'You hit an obstacle.');
    write(byId('final-distance'), Math.floor(run.distance).toLocaleString('en-US'));
    write(finalBolts, run.boltsCollected.toLocaleString('en-US'));
    boltBank.hidden = !episode?.storage;
    results.hidden = false;
    restartButton.focus({ preventScroll: true });
  }

  function approachingHazard() {
    if (lateralGap && run.distance < lateralGap.end && run.lane !== lateralGap.lateralExit &&
        (run.lane === lateralGap.lane || run.airborne)) return lateralGap;
    lateralGap = null;
    const hazard = run.obstacles.find((obstacle) => {
      const { type, end, z, lane, lanes = 1, toLane, triggered } = obstacle;
      if (type === 'slideGate') {
        const { approach, front, back, left, right } = slideGateBounds(obstacle);
        return run.distance >= approach - (front - approach) && run.distance < back &&
          (run.lane === lane || (run.x > left && run.x < right));
      }
      if (z - run.distance > run.speed * 1.3 || (end ?? z) <= run.distance) return false;
      if (type === 'movingBarrier') return run.lane >= Math.min(lane, toLane) && run.lane <= Math.max(lane, toLane);
      if (type === 'blackHole' && triggered) return false;
      return ['spikes', 'gap', 'platform', 'blackHole'].includes(type) &&
        run.lane >= lane && run.lane < lane + lanes;
    });
    if (hazard?.lateralExit !== undefined) lateralGap = hazard;
    return hazard;
  }

  function obstacleCue(hazard, hazardDistance, canDash) {
    const seconds = hazardDistance / run.speed;
    const jump = touchCues ? 'Swipe up' : 'Space to jump';
    switch (hazard?.type) {
      case 'platform':
        if (hazardDistance <= 0 || run.airborne) return '';
        return seconds <= 0.24 ? `Jump onto the platform · ${jump}` : 'Raised platform ahead';
      case 'slideGate': {
        const { approach, left, right } = slideGateBounds(hazard);
        if (run.distance < approach || run.x <= left || run.x >= right) return 'Slide gate ahead';
        if (run.sliding) return 'Stay low · Slide gate';
        return touchCues ? 'Slide gate · Swipe down now' : 'Slide gate · ↓ / S now';
      }
      case 'movingBarrier':
        if (!canDash) return touchCues ? 'Moving barrier · Swipe aside' : 'Moving barrier · Dodge with ← / →';
        return touchCues ? 'Moving barrier · Swipe aside or tap Dash' : 'Moving barrier · Dodge or dash (W / X)';
      case 'blackHole':
        return `Black hole ahead · Pulls ${hazard.direction < 0 ? 'left' : 'right'}`;
      case 'gap':
        if (hazard.lateralExit !== undefined) {
          const direction = hazard.lateralExit < run.lane ? 'left' : 'right';
          const arrow = direction === 'left' ? '←' : '→';
          const twice = Math.abs(hazard.lateralExit - run.lane) === 2 ? ' twice' : '';
          if (run.airborne) return touchCues ? `Swipe ${direction}${twice} to solid track` : `Press ${arrow}${twice} to solid track`;
          if (seconds > 0.22) return touchCues ? `Gap ahead · Jump, then swipe ${direction}${twice}` :
            `Gap ahead · Jump, then press ${arrow}${twice}`;
          return touchCues ? `Swipe up now, then ${direction}${twice}` : `Space now, then ${arrow}${twice}`;
        }
        if (hazard.short) return '';
        const gaps = run.obstacles.filter(({ type, z, end }) => type === 'gap' && z === hazard.z && end === hazard.end);
        const open = Array.from({ length: LANE_COUNT }, (_, lane) => lane).filter((lane) =>
          !gaps.some((gap) => lane >= gap.lane && lane < gap.lane + (gap.lanes ?? 1)));
        if (open.length === 1) {
          const direction = open[0] < run.lane ? 'left' : 'right';
          return touchCues ? `Wide gap · Swipe ${direction} to solid track` : `Wide gap · Solid track on the ${direction}`;
        }
        if (run.airborne && hazardDistance <= 0 && run.distance + run.speed * run.touchdownIn() < hazard.end) {
          return touchCues ? 'Land on solid track · Swipe sideways' : 'Land on solid track · Move over';
        }
        return touchCues ? 'Long gap · Swipe to solid track' : 'Long gap · Move to solid track';
      default:
        return '';
    }
  }

  function updateHud() {
    write(distance, String(Math.floor(run.distance)).padStart(4, '0'));
    write(speed, String(Math.round(run.speed)));
    write(bolts, String(run.boltsCollected));
    if (clueResetStatus && mode === 'ready' && resetNotice) {
      const pending = episode.unsavedBolts > 0;
      const boltNotice = !pending ? '' : episode.storage ? ' Bolt pickups are waiting to save.' :
        ' Bolt pickups are available for this session.';
      write(clueResetStatus, resetNotice + boltNotice);
    }
    if (mode === 'ended' && episode) {
      write(bankedBolts, episode.bankedBolts.toLocaleString('en-US'));
      write(boltSaveStatus, episode.storage ? (episode.unsavedBolts ? ' · Saving…' : '') : ' · Session only');
    }
    const boosting = String(mode === 'running' && run.boosting);
    if (document.body.dataset.boost !== boosting) document.body.dataset.boost = boosting;
    const dashing = mode === 'running' && run.dashing;
    if (document.body.dataset.dash !== String(dashing)) document.body.dataset.dash = String(dashing);
    const dashReady = run.dashCharge >= 1;
    const chargeTransform = `scaleX(${run.dashCharge.toFixed(3)})`;
    if (charge.style.transform !== chargeTransform) charge.style.transform = chargeTransform;
    if (touchCharge.style.transform !== chargeTransform) touchCharge.style.transform = chargeTransform;
    const dashState = dashing ? 'active' : dashReady ? 'ready' : 'charging';
    if (touchDash.dataset.state !== dashState) touchDash.dataset.state = dashState;
    write(dashLabel, dashing ? 'Dash active' : dashReady ? 'Dash ready' : 'Dash recharging');
    write(touchDashLabel, dashing ? 'Active' : dashReady ? 'Ready' : 'Recharging');

    let cue = '';
    let tone = '';
    if (mode === 'running') {
      const hazard = approachingHazard();
      const hazardDistance = hazard ? hazard.z - run.distance : Infinity;
      const hint = obstacleCue(hazard, hazardDistance, dashReady && !dashing);
      const needsAirDash = run.airborne && !run.airDashed && hazard?.type === 'spikes' && hazard.tiles === 2;
      const dashNow = needsAirDash && run.height >= SPIKE_HEIGHT + 0.18 && hazardDistance <= run.speed * 0.13;
      if (run.slideWindowOpen) {
        cue = touchCues ? 'Power slide now · Swipe down' : 'Power slide now · ↓ / S';
        tone = 'mint';
      } else if (hint && hazard?.type === 'gap' && (hazard.lateralExit !== undefined || run.airborne)) {
        cue = hint;
        tone = 'hazard';
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
      } else if (hint) {
        cue = hint;
        tone = 'hazard';
      } else if (run.airborne && !run.queuedSlide) {
        cue = touchCues ? 'Swipe down at touchdown' : 'Slide at touchdown · ↓ / S';
        tone = 'violet';
      } else if (!run.airborne && hazard?.type === 'gap') {
        if (hazardDistance > run.speed * 0.22) cue = 'Short gap ahead';
        else cue = touchCues ? 'Swipe up now · Short gap' : 'Jump now · Short gap';
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
    if (mode === 'dying' || pageSuspended || document.hidden) {
      event.preventDefault();
      return;
    }
    if ((key === 'Space' || key === 'Enter') && event.target instanceof HTMLButtonElement) {
      if (event.repeat) event.preventDefault();
      return;
    }
    event.preventDefault();
    if (event.repeat || held.has(key)) return;
    held.add(key);
    touchCues = false;

    if (key === 'Enter' && canStart()) {
      if (event.isTrusted) audio('unlock');
      start();
    }
    if (mode !== 'running') return;
    if (key === 'ArrowLeft' || key === 'KeyA') run.move(-1);
    if (key === 'ArrowRight' || key === 'KeyD') run.move(1);
    if (key === 'Space') run.jump();
    if (key === 'ArrowDown' || key === 'KeyS') run.slide();
    if (key === 'KeyX' || key === 'KeyW') run.dash();
  }

  function frame(now) {
    if (document.hidden || pageSuspended) {
      requestAnimationFrame(frame);
      return;
    }
    const elapsed = previousFrame === null ? 0 : (now - previousFrame) / 1000;
    previousFrame = now;
    run.reducedMotion = reducedMotion.matches;
    if (mode === 'running') {
      lag += elapsed;
      // Preserve elapsed play time while limiting how much a delayed frame can process at once.
      for (let steps = 0; lag >= STEP && mode === 'running' && steps < MAX_STEPS_PER_FRAME; steps++) {
        lag -= STEP;
        advanceRun();
      }
    } else {
      if (death) advanceDeath(elapsed);
      const needsSave = mode === 'ready' ? episode?.unsavedBolts > 0 : episode?.hasUnsaved;
      if (episode?.storage && needsSave && now >= nextIdleSave) {
        episode.save();
        showPeerReset();
        nextIdleSave = now + SAVE_INTERVAL * 1000;
      }
      if (replay) {
        replay.elapsed += elapsed;
        if (replay.elapsed >= CLUES[replay.clueNumber - 1].duration) replay = null;
      }
    }
    updatePresentation();
    updateHud();
    const frozen = death || (mode === 'ended' && !replay);
    const visualDelta = frozen ? 0 : Math.min(elapsed, 0.1);
    sceneTime += visualDelta;
    scene.draw(run, sceneTime, visualDelta, mode, death?.presentationStage ?? latestPresentationStage(), signal, death);
    if (death?.revealed && Number.isFinite(scene.horizon)) {
      const bottom = `calc(100% - ${Math.floor(scene.horizon) - 8}px)`;
      if (deathThought.style.bottom !== bottom) deathThought.style.bottom = bottom;
    }
    requestAnimationFrame(frame);
  }
  replayButtons.forEach((button, index) => button.addEventListener('click', (event) => toggleReplay(event, index + 1)));
  resetCluesButton?.addEventListener('click', activateClueReset);
  resetResultsCluesButton?.addEventListener('click', activateClueReset);
  muteButton.addEventListener('click', toggleMute);

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
  function pausePage() {
    resetInput();
    episode?.save();
    showPeerReset();
    audio('suspend');
  }
  function resumePage() {
    resetInput();
    episode?.save();
    if (!showPeerReset() && mode === 'ready') run = createRun();
    updatePresentation();
    audio('resume');
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pausePage();
    else if (!pageSuspended) resumePage();
  });
  window.addEventListener('pagehide', () => {
    pageSuspended = true;
    pausePage();
  });
  window.addEventListener('storage', ({ key }) => {
    if (key === null || key === SAVE_KEY || key?.startsWith(SAVE_KEY + ':')) {
      episode?.refresh();
      showPeerReset();
    }
  });
  window.addEventListener('pageshow', () => {
    pageSuspended = false;
    if (!document.hidden) resumePage();
  });
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
