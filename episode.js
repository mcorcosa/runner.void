(function () {
  'use strict';

  const SAVE_KEY = 'void-runner-episode-one';
  const LEGACY_JOURNAL = { checkpointKey: SAVE_KEY + ':checkpoint', entryPrefix: SAVE_KEY + ':entry:' };
  const JOURNAL = { checkpointKey: SAVE_KEY + ':v2:checkpoint', entryPrefix: SAVE_KEY + ':v2:entry:', version: 2 };
  const RESET_KEY = SAVE_KEY + ':reset';
  // Use a separate journal so builds still writing v2 cannot merge away a reset generation.
  const RESET_JOURNAL = {
    checkpointKey: SAVE_KEY + ':v3:checkpoint', entryPrefix: SAVE_KEY + ':v3:entry:', version: 3, resetScoped: true,
  };
  const HEARD_JOURNAL = {
    checkpointKey: SAVE_KEY + ':v4:checkpoint', entryPrefix: SAVE_KEY + ':v4:entry:', version: 4, resetScoped: true,
  };
  const COMPACT_BATCH = 16;
  const LEGACY_THRESHOLDS = [500, 2000, 5000, 9000];
  const PREVIOUS_THRESHOLDS = [5000, 20000, 50000, 90000];
  const LEGACY_IDS = ['hiss', 'question', 'sighting', 'beacon'];
  const PULSE_LEAD = 1.2;
  const CLUES = [
    { id: 'hiss', meters: 15000, duration: 8, line: '', presentationStage: 1, launchLevel: 1, audioKey: 1, radioAt: 0 },
    { id: 'question', meters: 35000, duration: 8, line: 'What is that?', presentationStage: 2, launchLevel: 2, audioKey: 2 },
    { id: 'sighting', meters: 65000, duration: 10, line: 'Saw the light again', presentationStage: 3, launchLevel: 3, audioKey: 3 },
    { id: 'pattern', meters: 95000, duration: 9, line: 'Those pauses. Always the same.',
      presentationStage: 3, launchLevel: 3, audioKey: 5 },
    { id: 'beacon', meters: 125000, duration: 12, line: 'Still there. Looks like a beacon. We need to reach it',
      presentationStage: 4, launchLevel: 4, audioKey: 4, invert: true },
    { id: 'purpose', meters: 160000, duration: 9, line: 'What was it built to guide?', presentationStage: 4, launchLevel: 4, audioKey: 6 },
    { id: 'warning', meters: 195000, duration: 10, line: 'Leave it alone.', followUp: 'Tell the others.',
      presentationStage: 4, launchLevel: 4, audioKey: 7 },
    { id: 'doubt', meters: 230000, duration: 9, line: 'What if it’s a warning?', presentationStage: 4, launchLevel: 4, audioKey: 8 },
    { id: 'reach', meters: 270000, duration: 11, line: 'We MUST reach it.', followUp: 'Find out who sent this.',
      presentationStage: 4, launchLevel: 4, audioKey: 9 },
  ].map((clue) => ({ radioAt: PULSE_LEAD, invert: false, ...clue }));
  const CLUE_IDS = new Set(CLUES.map(({ id }) => id));

  function parse(serialized) {
    try {
      const state = JSON.parse(serialized);
      return Number.isFinite(state?.meters) && state.meters >= 0 ? state : null;
    } catch {
      return null;
    }
  }

  function validLegacyDiscovery(count) {
    return Number.isInteger(count) && count >= 0 && count <= LEGACY_IDS.length;
  }

  function validBoltCount(count) {
    return Number.isSafeInteger(count) && count >= 0;
  }

  function addBolts(first, second) {
    return Math.min(Number.MAX_SAFE_INTEGER, first + second);
  }

  function parseEntry(serialized, journal) {
    const state = parse(serialized);
    if (!state || state.version !== journal.version) return null;
    if (journal === HEARD_JOURNAL) {
      if (!Array.isArray(state.heard) || !state.heard.every((id) => CLUE_IDS.has(id))) return null;
    } else if (!validLegacyDiscovery(state.discoveredClues)) return null;
    if (journal.version) state.bolts = validBoltCount(state.bolts) ? state.bolts : 0;
    return state;
  }

  function parseCheckpoint(serialized, journal) {
    const state = parseEntry(serialized, journal);
    if (!state) return null;
    if (Array.isArray(state.merging)) {
      state.merging = state.merging.filter((key) => typeof key === 'string' && key.startsWith(journal.entryPrefix));
    }
    else delete state.merging;
    return state;
  }

  function checkpointForGeneration(journal, checkpoint, generation) {
    const discovery = journal === HEARD_JOURNAL ? { heard: [] } : { discoveredClues: 0 };
    const total = checkpoint ?? { meters: 0, ...discovery };
    if (journal.version && !checkpoint) Object.assign(total, { version: journal.version, bolts: 0 });
    if (journal.resetScoped && generation !== total.generation) {
      Object.assign(total, { generation, meters: 0, ...discovery });
    }
    return total;
  }

  function mergeEntry(total, entry, journal) {
    if (!entry) return;
    // A reset retires the story fields of older generations. Every generation contributes to the bank.
    if (!journal.resetScoped || total.generation === entry.generation) {
      total.meters += entry.meters;
      if (journal === HEARD_JOURNAL) total.heard = [...new Set([...total.heard, ...entry.heard])];
      else total.discoveredClues = Math.max(total.discoveredClues, entry.discoveredClues);
    }
    if (journal.version) total.bolts = addBolts(total.bolts, entry.bolts);
  }

  function withStorageTransaction(databaseFactory, compact) {
    return new Promise((resolve, reject) => {
      const name = 'compaction';
      // Older tabs still use this database to serialize writes to their journal.
      const open = databaseFactory.open(LEGACY_JOURNAL.checkpointKey, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(name);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result;
        try {
          // Read-write transactions on this store serialize the localStorage merge across tabs on HTTP.
          const transaction = database.transaction(name, 'readwrite');
          transaction.oncomplete = () => { database.close(); resolve(); };
          transaction.onabort = () => { database.close(); reject(transaction.error); };
          transaction.objectStore(name).get('checkpoint').onsuccess = () => {
            try { compact(); }
            catch { transaction.abort(); }
          };
        } catch (error) {
          database.close();
          reject(error);
        }
      };
    });
  }

  class EpisodeProgress {
    constructor({ storage, databaseFactory = globalThis.indexedDB } = {}) {
      this.storage = storage;
      this.databaseFactory = databaseFactory;
      this.pageId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
      this.entryNumber = 0;
      this.resetNumber = 0;
      this.generation = null;
      this.sessionOnlyReset = false;
      this.runInvalidated = false;
      this.compacting = false;
      this.storedMeters = 0;
      this.storedBolts = 0;
      this.legacyPending = 0;
      this.heardIds = new Set();
      this.priorRunsDistance = 0;
      this.creditedDistance = 0;
      this.savedDistance = 0;
      this.priorRunsBolts = 0;
      this.creditedBolts = 0;
      this.savedBolts = 0;
      this.unsavedHeard = new Set();
      this.refresh();
      this.runInvalidated = false;
    }

    entries(journal, checkpoint, keys = Object.keys(this.storage)) {
      const merged = new Set(checkpoint?.merging);
      return keys.filter((key) => key.startsWith(journal.entryPrefix) && !merged.has(key));
    }

    readJournal(journal, serialized, keys, generation) {
      const checkpoint = parseCheckpoint(serialized, journal);
      const entries = this.entries(journal, checkpoint, keys);
      const total = checkpointForGeneration(journal, checkpoint, generation);
      for (const key of entries) mergeEntry(total, parseEntry(this.storage.getItem(key), journal), journal);
      return { total, needsCompaction: Boolean(checkpoint?.merging) || entries.length >= COMPACT_BATCH };
    }

    switchGeneration(generation) {
      const pendingBolts = this.unsavedBolts;
      this.generation = generation;
      this.runInvalidated = true;
      this.storedMeters = 0;
      this.legacyPending = 0;
      this.heardIds.clear();
      this.unsavedHeard.clear();
      this.priorRunsDistance = 0;
      this.creditedDistance = 0;
      this.savedDistance = 0;
      this.priorRunsBolts = pendingBolts;
      this.creditedBolts = 0;
      this.savedBolts = 0;
    }

    syncReset() {
      if (!this.storage || this.sessionOnlyReset) return false;
      try {
        const generation = this.storage.getItem(RESET_KEY);
        if (generation && generation !== this.generation) {
          this.switchGeneration(generation);
          return true;
        }
      } catch {
        // Keep the current generation while storage is inaccessible.
      }
      return false;
    }

    reset() {
      const generation = this.pageId + ':' + ++this.resetNumber;
      this.sessionOnlyReset = true;
      try {
        if (this.storage) {
          this.storage.setItem(RESET_KEY, generation);
          this.sessionOnlyReset = false;
        }
      } catch {
        // A failed marker write leaves the reset scoped to this page.
      }
      this.switchGeneration(generation);
      this.save();
      return !this.sessionOnlyReset;
    }

    refresh() {
      if (!this.storage) return;
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          this.syncReset();
          const legacy = this.generation === null ? parse(this.storage.getItem(SAVE_KEY)) : null;
          const legacyStatus = legacy?.status;
          const legacyMeters = ['locked', 'pending', 'discovered'].includes(legacyStatus) ? legacy.meters : 0;
          const legacySaved = this.generation === null ? this.storage.getItem(LEGACY_JOURNAL.checkpointKey) : null;
          const saved = this.storage.getItem(JOURNAL.checkpointKey);
          const resetSaved = this.storage.getItem(RESET_JOURNAL.checkpointKey);
          const heardSaved = this.storage.getItem(HEARD_JOURNAL.checkpointKey);
          const keys = Object.keys(this.storage);
          const previous = this.generation === null ? this.readJournal(LEGACY_JOURNAL, legacySaved, keys) : null;
          const current = this.readJournal(JOURNAL, saved, keys);
          const reset = this.readJournal(RESET_JOURNAL, resetSaved, keys, this.generation);
          const heard = this.readJournal(HEARD_JOURNAL, heardSaved, keys, this.generation);
          // A merge may have moved an entry into the checkpoint while this tab was reading it.
          if (this.syncReset() || (previous && legacySaved !== this.storage.getItem(LEGACY_JOURNAL.checkpointKey)) ||
              saved !== this.storage.getItem(JOURNAL.checkpointKey) ||
              resetSaved !== this.storage.getItem(RESET_JOURNAL.checkpointKey) ||
              heardSaved !== this.storage.getItem(HEARD_JOURNAL.checkpointKey)) continue;
          this.storedBolts = addBolts(addBolts(current.total.bolts, reset.total.bolts), heard.total.bolts);
          let legacyDistance = reset.total.meters;
          let legacyDiscovered = reset.total.discoveredClues;
          let legacyPending = 0;
          if (previous) {
            const previousMeters = legacyMeters + previous.total.meters;
            const legacyEntitlement = legacyStatus === 'pending' || legacyStatus === 'discovered' ? 1 : 0;
            legacyPending = Math.max(legacyEntitlement, LEGACY_THRESHOLDS.filter((limit) => previousMeters >= limit).length);
            legacyDistance += previousMeters + current.total.meters;
            legacyDiscovered = Math.max(legacyDiscovered, legacyStatus === 'discovered' ? 1 : 0,
              previous.total.discoveredClues, current.total.discoveredClues);
          }
          this.legacyPending = Math.max(legacyPending, PREVIOUS_THRESHOLDS.filter((limit) => legacyDistance >= limit).length);
          this.storedMeters = legacyDistance + heard.total.meters;
          for (const id of LEGACY_IDS.slice(0, legacyDiscovered)) this.heardIds.add(id);
          for (const id of heard.total.heard) this.heardIds.add(id);
          if ([previous, current, reset, heard].some((result) => result?.needsCompaction)) this.requestCompaction();
          return;
        }
      } catch {
        // Keep the latest known progress if storage is unavailable.
      }
    }

    requestCompaction() {
      if (!this.databaseFactory || this.compacting) return;
      this.compacting = true;
      let more = false;
      withStorageTransaction(this.databaseFactory, () => {
        // Keep old distances in their own journal so a stale tab cannot fold new deposits into old eligibility.
        const legacyMore = this.generation === null && this.compact(LEGACY_JOURNAL);
        const currentMore = this.compact(JOURNAL);
        const resetMore = this.compact(RESET_JOURNAL);
        const heardMore = this.compact(HEARD_JOURNAL);
        more = legacyMore || currentMore || resetMore || heardMore;
      }).catch(() => {
        // A pending merge can be finished at the next checkpoint.
      }).finally(() => {
        this.compacting = false;
        if (more) this.requestCompaction();
      });
    }

    compact(journal) {
      const checkpoint = parseCheckpoint(this.storage.getItem(journal.checkpointKey), journal);
      if (checkpoint?.merging) this.finishMerge(journal, checkpoint);
      const entries = this.entries(journal);
      if (entries.length < COMPACT_BATCH) return false;
      const keys = entries.slice(0, COMPACT_BATCH);
      // Select the batch first so it cannot include entries from a reset newer than the marker we read.
      const generation = journal.resetScoped ? this.storage.getItem(RESET_KEY) : undefined;
      const merged = { ...checkpointForGeneration(journal, checkpoint, generation), merging: keys };
      for (const key of keys) {
        mergeEntry(merged, parseEntry(this.storage.getItem(key), journal), journal);
      }
      // Publish the total and the included keys together before deleting any entries.
      this.storage.setItem(journal.checkpointKey, JSON.stringify(merged));
      this.finishMerge(journal, merged);
      return entries.length >= 2 * COMPACT_BATCH;
    }

    finishMerge(journal, { merging, ...checkpoint }) {
      for (const key of merging) this.storage.removeItem(key);
      this.storage.setItem(journal.checkpointKey, JSON.stringify(checkpoint));
    }

    get meters() {
      return this.storedMeters + (this.priorRunsDistance + this.creditedDistance - this.savedDistance);
    }

    // Discovery and eligibility are counts. Only pendingClue is a display ordinal.
    get discoveredClues() {
      return this.heardIds.size;
    }

    hasHeard(id) {
      return this.heardIds.has(id);
    }

    get launchLevel() {
      return Math.max(0, ...CLUES.filter(({ id }) => this.hasHeard(id)).map(({ launchLevel }) => launchLevel));
    }

    get presentationStage() {
      return Math.max(0, ...CLUES.filter(({ id }) => this.hasHeard(id)).map(({ presentationStage }) => presentationStage));
    }

    get latestHeardId() {
      return CLUES.findLast(({ id }) => this.hasHeard(id))?.id;
    }

    isEligible(clue, meters) {
      const legacyIndex = LEGACY_IDS.indexOf(clue.id);
      return meters >= clue.meters || (legacyIndex >= 0 && legacyIndex < this.legacyPending);
    }

    get eligibleClues() {
      const meters = this.meters;
      return CLUES.filter((clue) => this.hasHeard(clue.id) || this.isEligible(clue, meters)).length;
    }

    get pendingClue() {
      const meters = this.meters;
      return CLUES.findIndex((clue) => !this.hasHeard(clue.id) && this.isEligible(clue, meters)) + 1 || null;
    }

    get bankedBolts() {
      return this.storedBolts;
    }

    get unsavedBolts() {
      return this.priorRunsBolts + this.creditedBolts - this.savedBolts;
    }

    get hasUnsaved() {
      return this.unsavedBolts > 0 || (!this.sessionOnlyReset &&
        (this.unsavedHeard.size > 0 || this.priorRunsDistance + this.creditedDistance > this.savedDistance));
    }

    beginRun() {
      this.save();
      this.runInvalidated = false;
      this.priorRunsDistance += this.creditedDistance;
      this.creditedDistance = 0;
      this.priorRunsBolts += this.creditedBolts;
      this.creditedBolts = 0;
    }

    credit(distance, bolts = 0) {
      if (this.runInvalidated) return;
      const meters = this.meters;
      const nextThreshold = CLUES.find((clue) => !this.hasHeard(clue.id) && !this.isEligible(clue, meters))?.meters ?? Infinity;
      if (Number.isFinite(distance) && distance > this.creditedDistance) this.creditedDistance = distance;
      const pickedUp = validBoltCount(bolts) && bolts > this.creditedBolts;
      if (pickedUp) this.creditedBolts = bolts;
      if (pickedUp || this.meters >= nextThreshold) this.save();
    }

    discover(clueNumber) {
      if (this.syncReset() || this.runInvalidated || !Number.isInteger(clueNumber)) return;
      const clue = CLUES[clueNumber - 1];
      // The eligible cue that finished may differ from the next cue if progress arrived mid-playback.
      if (!clue || this.hasHeard(clue.id) || !this.isEligible(clue, this.meters)) return;
      this.heardIds.add(clue.id);
      this.unsavedHeard.add(clue.id);
      this.save();
    }

    save() {
      if (!this.storage) return;
      this.syncReset();
      const distance = this.priorRunsDistance + this.creditedDistance;
      const meters = this.sessionOnlyReset ? 0 : distance - this.savedDistance;
      const bolts = this.unsavedBolts;
      const heard = this.sessionOnlyReset ? [] : [...this.unsavedHeard];
      if (meters > 0 || bolts > 0 || heard.length > 0) {
        const journal = HEARD_JOURNAL;
        const key = journal.entryPrefix + this.pageId + ':' + ++this.entryNumber;
        const entry = { version: journal.version, generation: this.generation, meters, bolts, heard };
        try {
          this.storage.setItem(key, JSON.stringify(entry));
          if (!this.sessionOnlyReset) {
            this.savedDistance = distance;
            this.unsavedHeard.clear();
          }
          this.savedBolts += bolts;
          this.storedMeters += meters;
          this.storedBolts = addBolts(this.storedBolts, bolts);
        } catch {
          // Leave the latest state available for a later save attempt.
        }
      }
      this.refresh();
    }
  }

  const api = { EpisodeProgress, SAVE_KEY, CLUES, PULSE_LEAD };
  if (typeof module !== 'undefined') module.exports = api;
  else globalThis.VoidEpisode = api;
})();
