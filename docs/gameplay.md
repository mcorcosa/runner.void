# 3D Void Runner first playable

The owner approved the first-playable scope below, including all three proposed defaults, and authorized implementation on 19 November 2026.

## First-playable rules

- The browser game takes place in a simple, blocky 3D void with five discrete lanes. Low hurdles and cracked barriers approach as the runner accelerates automatically.
- Left Arrow or A moves one lane left per press. Right Arrow or D moves one lane right per press. Space jumps and is also used for the landing tap. W or X dashes forward.
- A fresh Space press near touchdown earns a short speed burst that adds to the current forward speed. Holding Space or missing the timing window results in a normal landing.
- An unavoided hit ends the run. Choose **Run again** or press Enter to restart.

## Mobile touch controls

- Swipe left or right on the playfield to move one lane in that direction. Swipe up to jump, then make a fresh upward swipe near touchdown to earn the landing speed boost.
- Tap the dedicated **Dash** button to dash on the ground or in midair. You can tap it with a second finger while your first finger is still on the playfield.
- Play in portrait or landscape. Rotating the device during a run keeps that run going.

The PM verified both orientations, mid-run rotation, and clearing a long spike patch with a second-finger dash in Edge touch emulation.

## Mobile fullscreen and Home Screen launch

- Tapping **Start run** or **Run again** requests native fullscreen for the complete game, including the HUD and touch controls, on supporting browsers. If fullscreen is unavailable or denied, the run starts in the browser viewport.
- Rotating the device preserves the active run. If you exit fullscreen manually, the current run continues in the browser viewport and fullscreen stays off for the rest of that run.
- For Home Screen launches, the manifest prefers fullscreen and falls back to standalone. Browsers without support for `display_override` use the `display` setting of `standalone`.

The PM verified fullscreen on touch start and restart, rotation, manual exit, and rejected-request fallback in Edge mobile emulation.

## Speed, camera, and late-run hazards

- In normal play, base speed starts at 32 m/s and increases by 1.8 m/s every second throughout the active run, with no designed ceiling. Landing boosts and dashes temporarily add to base speed. Restarting resets speed to 32 m/s.
- The camera’s field of view widens as actual running speed rises, including during landing boosts and dashes, and eases back as the runner slows. Reduced motion disables speed-based widening.
- At each speed, obstacles, track, and lane gaps share the same forward scale in the camera view. Collisions use world distances in meters.
- During an active forward dash, the first cracked barrier the runner physically contacts shatters. Each dash can break one barrier. A **Dash active** badge appears during the dash, and blue edge streaks appear when reduced motion is off.
- Later in the run, spike patches can span two adjacent lanes and extend two tiles along the track. To cross a two-tile patch, jump and then dash in midair.
- In endless runs, a lane can close for several seconds of travel. The deck is missing from the roadblock to the reopened floor, exposing the cut edges of the remaining deck. Move over before the roadblock and reenter only once you reach the far lip where the floor resumes. Entering the gap early ends the run, even during a jump or dash.

Playtesting will guide further tuning of speed, the landing tap, the dash, and when late-run hazards appear.
