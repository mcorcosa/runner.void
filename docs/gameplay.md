# run.void first playable

The owner approved the first-playable scope below, including all three proposed defaults, and authorized implementation on 19 November 2026.

## First-playable rules

- The browser game takes place in a simple, blocky 3D void with five discrete lanes. The runner accelerates automatically.
- Left Arrow or A moves one lane left per press. Right Arrow or D moves one lane right per press. Space jumps. Down Arrow or S slides. W or X dashes forward.
- Ground slides and power slides keep you low for 14 m. A ground slide slows you over that distance. If you slide on the gate cue or reach the gate’s approach while sliding, you stay low until clear.
- For a power slide, make a fresh slide input on the mint cue. As you descend within 1 m of a solid landing surface, the input queues a boost for touchdown. A fresh input in the first 3 m after landing boosts immediately while you’re still on that surface. After an air dash, wait for the mint cue and make a fresh input.
- A crash ends the run at impact. The runner’s reaction depends on the hazard, then the scene darkens and a thought appears in the sky. The sequence lasts about 3.75 seconds with the game in view. At results, choose **Run again** or press Enter to restart.
- In standard motion, the thought appears with slightly separated colored edges that rejoin once before the text holds steady. System reduced motion shows each hazard’s own frozen silhouette and steady text for the same reading time.
- The number of completed clues at impact determines which set of thoughts can appear. Practice and clue previews use the opening set and stay separate from saved clue progress and the bolt bank. In ordinary runs, distance and bolt pickups through impact count toward saved progress.

## Mobile touch controls

- Swipe left or right on the playfield to move one lane in that direction. Swipe up to jump and down to slide. Lift your finger after jumping, then swipe down on **Power slide now · Swipe down**.
- Tap the dedicated **Dash** button to dash on the ground or in midair. You can tap it with a second finger while your first finger is still on the playfield.
- Play in portrait or landscape. Rotating the device during a run keeps that run going.

The PM verified both orientations, mid-run rotation, and clearing a long spike patch with a second-finger dash in Edge touch emulation.

## Mobile fullscreen and Home Screen launch

- Tapping **Start run** or **Run again** requests native fullscreen for the complete game, including the HUD and touch controls, on supporting browsers. If fullscreen is unavailable or denied, the run starts in the browser viewport.
- Rotating the device preserves the active run. If you exit fullscreen manually, the current run continues in the browser viewport and fullscreen stays off for the rest of that run.
- For Home Screen launches, the manifest prefers fullscreen and falls back to standalone. Browsers without support for `display_override` use the `display` setting of `standalone`.

The PM verified fullscreen on touch start and restart, rotation, manual exit, and rejected-request fallback in Edge mobile emulation.

## Speed and camera

- Ordinary endless runs start at 48 m/s before any clue is discovered. Each completed clue sets a faster launch for the next run, in order at 80, 112, 144, and 176 m/s. Base speed increases by 1.8 m/s every second throughout the active run, with no designed ceiling. Slides temporarily reduce running speed. Power slides and dashes temporarily increase it. Most scripted practice starts at 32 m/s or 64 m/s with `&pace=fast`. The `challenge` scenario starts at 144 or 176 m/s, and `high-speed` defaults to 572 m/s.
- Deck-edge reflectors pass from the start. As the runner speeds up, their trails lengthen, the runner’s stride quickens, and lavender streaks at the screen edges grow more visible. A regular slide shortens the reflector trails. Power slides add mint streaks, and dashes add blue edge streaks. The dark sky drifts around Relay Nine, and reduced motion keeps its background steady.
- The camera’s field of view widens as actual running speed rises above the 32 m/s reference and eases back as the runner slows. Faster openings start with a wider view. Reduced motion fixes the field of view and suppresses the animated speed effects while keeping the HUD speed and **Dash active** badge.
- At each speed, obstacles, track, and lane gaps share the same forward scale in the camera view. Collisions use world distances in meters.
- During an active forward dash, the first cracked barrier the runner physically contacts shatters, including a moving barrier. Each dash can break one. Dash recharges over four seconds from activation, and a bolt restores 25% of the full charge, capped at full.

## Endless course progression

- The 48 m/s opening starts with a center hurdle, a center barrier, and side-lane obstacles that can mirror with the seed. Completed clues raise the starting tier and change the opening rows. Clue 2 adds spikes to the opening, Clue 3 introduces two-lane patches there, and Clue 4 opens with long two-lane patches.
- Read the next entrance before leaving the current section. Some walls narrow the route to a single lane with a hurdle or gate, then move the route to a different lane for the next action. Jump hurdles and single red tiles. Time a jump to clear a cracked barrier or land on its top, or dash into it to break it. Jump and then dash in midair over a two-tile spike patch.
- A red warning triangle marks a gap. Jump straight across a short gap on the jump cue. Move beside an ordinary single-lane closure or jump sideways to solid track. A funnel can close four lanes at once. Entering a missing lane on the ground or touching down over it ends the run.

## Later obstacle tiers

The obstacle tier starts at the tier earned from clue discoveries and can rise as you survive. Mixed sections often follow one another with a short stretch to line up for the next entrance. The seed can change the order of sections and which way their routes turn.

- **Tier 2** mixes hurdles and low gates in either order. Line up for the first action, then change lanes for the second. After jumping, land and make a fresh slide input on the gate cue.
- **Tier 3** adds raised-platform routes. Land on the platform, run off its end, then move into the next lane to slide through the gate.
- **Tier 4** adds moving barriers and black-hole pulls to these combinations. Look for the inside slide route beside a moving barrier. After a pull, steer back toward the original lane for the gate.
- **Tier 5** adds cross-lane jumps between gates and forks that merge into a one-lane funnel. At a cross-lane jump cue, jump first and move twice toward solid track before landing, then slide through the full-width gate. At a fork, jump the hurdle or slide through the other entrance, then merge into the remaining lane for the gate.

The local `?scenario=challenge` practice opens with three authored sections. After the last gate, the endless course generator continues at your current speed and tier with the usual warning distance. The entire route runs in practice mode. [Challenge controls and route](../README.md#acceptance-scenarios)

Ordinary bolts are sparse, and later tiers can place them beside hazards. Live transmissions have longer trails across clear track. Pickups from ordinary runs are saved to the local bolt bank for future unlocks. The HUD shows the current run’s count, and results show the total banked.

## Local clues and soundtrack

- Relay Nine is visible from the start. Ordinary runs save actual distance in the browser. The four clues become eligible at 5,000, 20,000, 50,000, and 90,000 cumulative personal meters. They play in order after existing hazards clear, with steering, jumping, sliding, and dashing still available. A crash or reload leaves an unfinished clue pending.
- Completing a signal updates Relay Nine’s persistent pulse and adds that clue to the recordings on results. Reduced motion shows a steady glow. Only live completion promotes the next ordinary run. That run starts at 0 m, earns meters through play, and uses the latest completed discovery. Replay earns no meters or bolts. [Local previews](../README.md#local-clue-playtest) queue the selected clue immediately on clear track at 48 m/s. Preview and scripted practice stay separate from personal progress and the bolt bank.
- The local soundtrack uses nine recordings from `synth/`, ordered by estimated BPM into four shuffled pairs and a one-song fifth tier. The title menu plays Tier 1 quietly. The launch tier and minimum tier for the next song rise by one per completed clue, up to Tier 5. Actual runner speed can select a higher tier when a song ends. After a crash, the current song fades down and slows while continuing to play. **Run again** brings it back up from the current playhead, with a track switch if a post-discovery start calls for a different tier. A new song on results comes from Tier 1. Audio starts after a player gesture. During a signal, the current song continues forward at lower tempo and volume. Its closing phrase can repeat until the signal ends, then the tempo and mix return to normal for the current screen.

Playtesting will guide further tuning of speed, slides, dashes, and when late-run hazards appear.
