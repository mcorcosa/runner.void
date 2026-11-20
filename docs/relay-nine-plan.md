# Relay Nine · Episode One plan

All four clues, the soundtrack, and next-run progression are implemented for [local playtesting](../README.md#local-clue-playtest). The faction choice, shared service and standings, and both endings remain planned. Baseline `a422756` is a static browser game on GitHub Pages.

## Approved direction

The player is the runner. Runs are single-player, and the community contributes through the metagame. For ages 10–13, use short lines, synthwave, and controlled glitches to build unease and curiosity. Keep the Void unexplained.

The white star visible from the start is Relay Nine. After each discovery, its normal pulse matches the latest discovered clue’s pulse. Local cumulative distance makes all four clues eligible in order, even if one run crosses several thresholds. The distances below are the current tuning values.

1. **5,000 m** · Stop spawning obstacles and wait for fully clear track. An eight-second static vignette and radio transmission begin. The current track slows and drops in volume while continuing forward. Radio static muffles a voice until the words are unintelligible.
2. **20,000 m** · The star pulses with growing intensity, then the vignette, altered music, and radio static return. The muffled voice sounds roughly like “what is that?” The words blink in glitch lettering in the sky.
3. **50,000 m** · Repeat the pattern with a much stronger pulse and a longer transmission than clue 2. Sky text reads “Saw the light again” while the voice remains unclear through static.
4. **90,000 m** · Repeat the transmission effects with the strongest pulse yet. After the pulse, invert the colors and intensify the effects. A loud, clear voice and the sky text deliver the exact line “Still there. Looks like a beacon. We need to reach it”.

Every first listen happens live on fully clear track, with steering, jumping, sliding, and dashing available. Follow the bolt trail during the live transmission to refill dash charge and bank pickups toward future unlocks. Keep the sky text part of the scene and keep the controls readable. Use a single inversion in clue 4 and provide a low-flash, reduced-motion presentation that preserves the information and timing. If the runner crashes before the safe window, the clue stays pending for a later run. After discovery, the recording is available for replay from results.

For the planned faction choice, show the two continuations at the end of the run that completes Clue 4, before ordinary results. Repeat the exact Clue 4 line above both options. The player chooses how to continue the message. The intentions are approved and the following wording is for playtesting.

- **Warning** · “We need to warn the others. Tell them to hold course.”
- **Search** · “We need help finding the source. Ask ships that heard the signal to send their positions.”

Both teams seek Relay Nine and address the same spacefarers. Both teams’ episode meters carry everyone toward the relay. The team with more episode meters earns the broadcast, with finish and tie rules to be decided. Everyone sees the outcome in Episode Two. A proposed reward gives the winning team early access to incoming recordings with no scoring bonus.

## Local soundtrack

The local build plays the nine MP3s in `synth/`, ranked by estimated musical BPM. Tiers 1–4 contain two songs each, shuffled within each pair. Tier 5 contains the fastest song. The title menu uses Tier 1 at lower volume, and browsers require a player gesture before audio can start. The next ordinary run gains one launch tier for each completed discovery, from Tier 1 before discovery to Tier 5 after Clue 4. Songs play through during a run. Actual speed selects the next song’s tier with the launch tier as its minimum.

After a crash, the current song continues into results with a gradual fade to lower volume and a slight slowdown. **Run again** restores run volume and tempo from the moving playhead. A post-discovery start switches tracks if the new run calls for a different tier. If a song ends on the results screen, the next song comes from Tier 1. During a transmission, the same song continues forward at lower tempo and volume. Its closing phrase repeats if necessary to hold the song change until the transmission ends. The tempo and mix for the current screen then return from the current playhead.

## Delivery gates

1. **Clue 1 implemented locally.** The normal run queues it at 5,000 cumulative personal meters. The isolated `?preview=clue1` run queues it immediately on clear track. Reload the preview to repeat. Playtest the safe stretch, bolt trail, vignette, forward-playing slowed and quieter track, and unintelligible radio voice before tuning the full sequence.

   - **Scheduling and safety.** Stop adding hazards when the clue queues. Wait until the runner passes every queued collision boundary across all five lanes, including full spike tails and closure far lips. Keep controls and pace live. Resume generation from current position and speed with the normal visible warning horizon, including at 572 m/s with dash and power slide combined and after a delayed frame.
   - **Progress and recovery.** Credit actual simulated meters and ordinary-run bolt pickups exactly once, including the partial tick up to impact. Keep preview and scripted practice out of personal progress and the bolt bank. Eligibility queues the next clue, and live playback must finish to save its discovery. Saves retain discoveries and eligibility already earned under the previous thresholds. A new ordinary run starts at 0 m and uses completed discoveries to select its launch speed, opening pattern, and music tier. The five launch speeds are 48, 80, 112, 144, and 176 m/s. Verify reload with pending and completed clues and retry an unfinished transmission after reload.
   - **Presentation and replay.** Synchronize the vignette and audio on one foreground clock and pause it when backgrounded. Preserve the transmission cue with muted or unavailable audio and reduced motion. Test keyboard and touch, including rotation. Results replay earns no meters or bolts. A focused replay button accepts Enter and Space while the run stays ended. **Run again** stops replay and starts one fresh run.

2. **Playtest Clues 2–4 and add the message choice.** Verify the escalating pulses and transmissions, readable sky text, Clue 4’s inversion and exact line with a low-flash alternative, and the harder opening on each new run. The message choice is the remaining planned part of this gate. At the end of the Clue 4 run, repeat the line and offer the two continuations before ordinary results. On the first run after a local choice, show the runner’s reason and actual distance carried toward Relay Nine. The owner playtests this gate before service work.

3. **Connect the shared episode.** Add an anonymous service that records each eligible run once across retries and closes the episode once with an authoritative outcome, including concurrent finishes. Results show the service’s combined progress and distance remaining to Relay Nine, both team totals, personal meters for this run and episode, team rank, and Warning, Search, and Overall standings by episode meters. Label any sample progress in a local demo as simulated. Verify two independent clients on opposite sides see the same totals and outcome and can find their own contribution. Keep **Run again** available if the network fails.

4. **Stage approach, arrival, and both endings.** Reveal the mast and dish of the same beacon at shared approach milestones. At arrival, a safe transmission shows the dish turning toward the shipping lanes and sending the winning message. In Episode Two, Warning brings amber markers and acknowledgments, while Search brings reporting lights and position signals. Verify both branches and show the recorded outcome to returning players. Tune the shared finish distance before scoring opens.

## Ownership and open decisions

- **Gameplay Feel** leads safe-window scheduling in `game.js` and gameplay safety acceptance. **Lore** leads story and cue content and coordinates transmission and presentation work in `episode.js`, `app.js`, `scene.js`, `index.html`, and `style.css`.
- Route audio planning, audio assets, and audio acceptance through **run.void — Sound Manager**, chat `01a1f54c-44de-7233-8796-eedbb1c57f9e`, `gpt-6.2-astra` with `high` reasoning effort. Sound coordinates cue timing with Lore and Gameplay Feel.
- **Release** leads the service, deployment configuration, asset allowlist, and service acceptance. Proposed later paths are `service/` and `episode-api.js`. Release owns `.github/workflows/pages.yml` and needs to add `episode.js` and `audio.js` to Pages staging before publication. The shared **Project Librarian** owns documentation. The **Git operator** handles commits and pushes when authorized.
- These are path groupings for future named Sol handoffs. Serialize work on shared client files and `tests/runner.test.cjs`. Give parallel writers explicit disjoint paths. Preserve the integrated checks, including audio and episode behavior. Run them with `node --test`.

Before Phase 3, decide contribution eligibility and when team choice locks, score integrity, server finish and tie rules, late and offline submission handling, and the duration of winner access. Decide the anonymous identity, reset and retention policies, service provider, and API contract. Local prototype planning can proceed while these decisions are open.

## Sources

- **Owner’s revised direction and follow-up.** General Manager chat `01a1f4ee-e27e-72f3-ad39-7ed7a49c899f`, turn `01a1f54b-832b-7f20-9761-d8104ff1406c`, including owner reply `01a1f54e-055c-7273-8807-95fd3ca46c3b` on Relay Nine and the continuation intentions.
- **Owner’s playback direction.** Sound chat `01a1f54c-44de-7233-8796-eedbb1c57f9e`, turn `01a1f550-5cbf-7ca2-816b-25d46b498ad4`.
- **Clue 1 acceptance.** Gameplay Feel chat `01a1f4f2-ea95-7f80-84c8-a7bd23a8a441`, simulation report `01a1f554-456d-71f3-b30a-7856a6bff316`. Lore chat `01a1f508-51a9-7bc1-86dd-8474bbadd9aa`, client report `01a1f554-5177-7ab3-b1f9-405ee5c48479`.
- **Sound proposals.** Chat `01a1f54c-44de-7233-8796-eedbb1c57f9e`, final in turn `01a1f54c-45a8-76d2-9f6d-3a512a3b7f42`.
- **Earlier Lore direction and delivery plan.** Chat `01a1f508-51a9-7bc1-86dd-8474bbadd9aa`, turn `01a1f531-67ac-7cf1-9a63-27e633c790af`.
- **Gameplay Feel safety proposal.** Chat `01a1f4f2-ea95-7f80-84c8-a7bd23a8a441`, final in turn `01a1f532-b4c5-7933-bdac-56b90004ab8f`.
- **Release proposal.** Chat `01a1f4f0-b9e0-7ef3-af53-c00b9acd9b6b`, final in turn `01a1f532-c09e-7722-acd3-bdc4158ae3fd`.
