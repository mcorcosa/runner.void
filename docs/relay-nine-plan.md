# Relay Nine · Episode One plan

All nine Episode One clues, the soundtrack, and next-run progression are implemented for [local playtesting](../README.md#local-clue-playtest). The faction choice, shared service and standings, and both endings remain planned. Baseline `a422756` is a static browser game on GitHub Pages.

## Approved direction

The player is the runner. Runs are single-player, and the community contributes through the metagame. For ages 10–13, use short lines, synthwave, and controlled glitches to build unease and curiosity. Keep the Void unexplained.

The white star visible from the start is Relay Nine. Its persistent pulse uses the highest presentation stage among recordings heard. The nine milestones use cumulative meters from ordinary runs. Display numbers and numeric previews follow the order below. Each recording keeps its own identity and audio key.

1. **15,000 m · 8 s** · Hiss (`hiss`, audio key 1). Radio starts immediately. A voice is unintelligible through the static, and the sky stays free of words.
2. **35,000 m · 8 s** · Question (`question`, audio key 2). A puzzled observer asks “What is that?” through static.
3. **65,000 m · 10 s** · Sighting (`sighting`, audio key 3). A muffled voice says “Saw the light again”. The observer recognizes it.
4. **95,000 m · 9 s** · Pattern (`pattern`, audio key 5). “Those pauses. Always the same.” A partly muffled listener thinks they recognize a rhythm.
5. **125,000 m · 12 s** · Beacon (`beacon`, audio key 4). The original clear recording and sky line read “Still there. Looks like a beacon. We need to reach it”. The speaker guesses what it is and urges others to approach.
6. **160,000 m · 9 s** · Purpose (`purpose`, audio key 6). “What was it built to guide?” The speaker wonders aloud about its purpose.
7. **195,000 m · 10 s** · Warning (`warning`, audio key 7). “Leave it alone.” A cautious second speaker follows with “Tell the others.”
8. **230,000 m · 9 s** · Doubt (`doubt`, audio key 8). “What if it’s a warning?” A speaker voices a hesitant guess.
9. **270,000 m · 11 s** · Reach (`reach`, audio key 9). “We MUST reach it.” The first speaker is determined to approach and follows with “Find out who sent this.”

Hiss opens immediately with generated radio noise. The other cues start their bundled voice and sky text after the 1.2-second lead. Warning and Reach show both spoken lines in the sky so players can read the full message with sound off. If a new voice clip is unavailable, a short burst of static accompanies its caption. Beacon alone uses a single color inversion after the lead, and system reduced motion uses a steady, readable presentation. Presentation stages cap at four, and later recordings share existing stages.

A first discovery happens live on fully clear track, with steering, jumping, sliding, and dashing available. Follow the bolt trail during play to refill dash charge and bank pickups toward future unlocks. The earliest eligible unheard clue queues first. A crash or reload before completion leaves it pending. Results replays use the recordings actually heard. The nine local previews accept numeric ordinals (`?preview=1` through `?preview=9`) or stable IDs (`?preview=pattern`, for example). The original `?preview=clue4` link still opens Beacon, and `?preview=4` opens Pattern.

Existing saves retain cumulative distance, banked bolts, earned eligibility, and heard recordings. Legacy completed counts map to Hiss, Question, Sighting, and Beacon in order. Beacon may be eligible or complete before Pattern on a migrated save. The new save journal records heard IDs and merges them by union. It reads prior journals in place and counts each distance and bolt deposit once. Launch tier and presentation stage use the highest levels earned from heard IDs.

The crash sequence has 80 thoughts, eight in the opening set and eight for each of the nine recordings. At impact, the game fixes the line from the set for the highest-numbered recording heard, including after an older save fills gaps earlier in the order. Practice and previews use the opening set, and only crashes advance each set’s session rotation.

For the planned faction choice, show the two continuations at the end of the run that completes Reach at the 270,000 m milestone, before ordinary results. Repeat the Reach caption above both options. The player chooses how to continue the message. The intentions are approved and the following wording is for playtesting.

- **Warning** · “We need to warn the others. Tell them to hold course.”
- **Search** · “We need help finding the source. Ask ships that heard the signal to send their positions.”

Both teams seek Relay Nine and address the same spacefarers. Both teams’ episode meters carry everyone toward the relay. The team with more episode meters earns the broadcast, with finish and tie rules to be decided. Everyone sees the outcome in Episode Two. A proposed reward gives the winning team early access to incoming recordings with no scoring bonus.

## Local soundtrack

The local build plays the nine MP3s in `synth/`, ranked by estimated musical BPM. Tiers 1–4 contain two songs each, shuffled within each pair. Tier 5 contains the fastest song. The title menu uses Tier 1 at lower volume, and browsers require a player gesture before audio can start. The five launch speeds are 48, 80, 112, 144, and 176 m/s. Hiss, Question, and Sighting earn Tiers 2, 3, and 4. Pattern shares Tier 4. Beacon and the remaining recordings use Tier 5. Songs play through during a run. Actual speed selects the next song’s tier with the launch tier as its minimum.

After a crash, the current song continues into results with a gradual fade to lower volume and a slight slowdown. **Run again** restores run volume and tempo from the moving playhead. A post-discovery start switches tracks if the new run calls for a different tier. If a song ends on the results screen, the next song comes from Tier 1. During a transmission, the same song continues forward at lower tempo and volume. Its closing phrase repeats if necessary to hold the song change until the transmission ends. The tempo and mix for the current screen then return from the current playhead.

## Delivery gates

1. **Playtest the nine local clues.** Verify each eligible live transmission, the safe stretch, bolt trail, sky text, and forward-playing slowed and quieter track. Compare each cue through the isolated preview and results replay.

   - **Scheduling and safety.** Stop adding hazards when the clue queues. Wait until the runner passes every queued collision boundary across all five lanes, including full spike tails and closure far lips. Keep controls and pace live. Resume generation from current position and speed with the normal visible warning horizon, including at 572 m/s with dash and power slide combined and after a delayed frame.
   - **Progress and recovery.** Credit actual simulated meters and ordinary-run bolt pickups exactly once, including the partial tick up to impact. Keep preview and scripted practice out of personal progress and the bolt bank. Eligibility queues the next clue, and live playback must finish to save its discovery. Saves retain discoveries and eligibility already earned under the previous thresholds. A new ordinary run starts at 0 m and uses completed discoveries to select its launch speed, opening pattern, and music tier. The five launch speeds are 48, 80, 112, 144, and 176 m/s. Verify reload with pending and completed clues and retry an unfinished transmission after reload.
   - **Presentation and replay.** Synchronize the vignette and audio on one foreground clock and pause it when backgrounded. Preserve the transmission cue with muted or unavailable audio and reduced motion. Test keyboard and touch, including rotation. Results replay earns no meters or bolts. A focused replay button accepts Enter and Space while the run stays ended. **Run again** stops replay and starts one fresh run.

2. **Add the planned message choice.** At the end of the run that completes Reach, repeat its caption and offer the two continuations before ordinary results. On the first run after a local choice, show the runner’s reason and actual distance carried toward Relay Nine. The owner playtests this gate before service work.

3. **Connect the shared episode.** Add an anonymous service that records each eligible run once across retries and closes the episode once with an authoritative outcome, including concurrent finishes. Results show the service’s combined progress and distance remaining to Relay Nine, both team totals, personal meters for this run and episode, team rank, and Warning, Search, and Overall standings by episode meters. Label any sample progress in a local demo as simulated. Verify two independent clients on opposite sides see the same totals and outcome and can find their own contribution. Keep **Run again** available if the network fails.

4. **Stage approach, arrival, and both endings.** Reveal the mast and dish of the same beacon at shared approach milestones. At arrival, a safe transmission shows the dish turning toward the shipping lanes and sending the winning message. In Episode Two, Warning brings amber markers and acknowledgments, while Search brings reporting lights and position signals. Verify both branches and show the recorded outcome to returning players. Tune the shared finish distance before scoring opens.

## Ownership and open decisions

- **Gameplay Feel** leads safe-window scheduling in `game.js` and gameplay safety acceptance. **Lore** leads story and cue content and coordinates transmission and presentation work in `episode.js`, `app.js`, `scene.js`, `index.html`, and `style.css`.
- Route audio planning, audio assets, and audio acceptance through **run.void — Sound Manager**, chat `01a1f54c-44de-7233-8796-eedbb1c57f9e`, `gpt-6.2-sol` with `high` reasoning effort. Sound coordinates cue timing with Lore and Gameplay Feel.
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
