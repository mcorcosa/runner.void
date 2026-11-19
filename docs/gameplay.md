# run.void first playable

The owner approved the first-playable scope below, including all three proposed defaults, and authorized implementation on 19 November 2026.

## First-playable rules

- The browser game takes place in a simple, blocky 3D void with five discrete lanes. The runner accelerates automatically.
- Left Arrow or A moves one lane left per press. Right Arrow or D moves one lane right per press. Space jumps. Down Arrow or S slides. W or X dashes forward.
- A ground slide briefly slows the runner. A fresh slide input near touchdown triggers a power slide that briefly increases forward speed.
- An unavoided hit ends the run. Choose **Run again** or press Enter to restart.

## Mobile touch controls

- Swipe left or right on the playfield to move one lane in that direction. Swipe up to jump and down to slide. Lift your finger after jumping, then swipe down near touchdown for a power slide.
- Tap the dedicated **Dash** button to dash on the ground or in midair. You can tap it with a second finger while your first finger is still on the playfield.
- Play in portrait or landscape. Rotating the device during a run keeps that run going.

The PM verified both orientations, mid-run rotation, and clearing a long spike patch with a second-finger dash in Edge touch emulation.

## Mobile fullscreen and Home Screen launch

- Tapping **Start run** or **Run again** requests native fullscreen for the complete game, including the HUD and touch controls, on supporting browsers. If fullscreen is unavailable or denied, the run starts in the browser viewport.
- Rotating the device preserves the active run. If you exit fullscreen manually, the current run continues in the browser viewport and fullscreen stays off for the rest of that run.
- For Home Screen launches, the manifest prefers fullscreen and falls back to standalone. Browsers without support for `display_override` use the `display` setting of `standalone`.

The PM verified fullscreen on touch start and restart, rotation, manual exit, and rejected-request fallback in Edge mobile emulation.

## Speed and camera

- In normal play, base speed starts at 32 m/s and increases by 1.8 m/s every second throughout the active run, with no designed ceiling. Slides temporarily reduce running speed. Power slides and dashes temporarily increase it. Restarting resets speed to 32 m/s.
- Deck-edge reflectors pass from the start. As the runner speeds up, their trails lengthen, the runner’s stride quickens, and lavender streaks at the screen edges grow more visible. A regular slide shortens the reflector trails. Power slides add mint streaks, and dashes add blue edge streaks.
- The camera’s field of view widens as actual running speed rises and eases back as the runner slows. Reduced motion fixes the field of view and suppresses the animated speed effects while keeping the HUD speed and **Dash active** badge.
- At each speed, obstacles, track, and lane gaps share the same forward scale in the camera view. Collisions use world distances in meters.
- During an active forward dash, the first cracked barrier the runner physically contacts shatters. Each dash can break one barrier.

## Endless course progression

- The opening teaches hurdles and cracked barriers. The course then introduces single red tiles, longer two-tile patches, wider patches that cover two lanes, and lane closures on separate rows. Later hurdle and barrier rows cover more lanes, with difficulty increasing from 1,800 m and again from 3,600 m. Longer and wider spike patches become more common.
- After you clear a row in an open lane, the next row has a clear route in that lane or one lane over. You can also jump hurdles and single red tiles, dash into a cracked barrier, or jump and then dash in midair over a two-tile patch.
- When a lane closes, the deck is missing from the striped roadblock to the far lip, and one adjacent lane stays open through the closure. Move over before the roadblock and reenter only after the floor resumes. Entering the gap early ends the run, even during a jump or dash.

Playtesting will guide further tuning of speed, slides, dashes, and when late-run hazards appear.
