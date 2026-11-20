# run.void

**[Play run.void](https://mcorcosa.github.io/runner.void/)**

Open [index.html](index.html) in a browser and choose **Start run** or press **Enter**. On a phone, open the same page in its browser. The page works directly from disk in browsers that allow local pages to load neighboring files.

For a phone on the same Wi-Fi network, run `python -m http.server 8000` from this folder and open `http://<computer-LAN-IP>:8000/` in the phone browser.

- **Left / Right** or **A / D** moves one lane per press.
- **Space** jumps over amber hurdles and single red spike tiles. Jump onto a raised platform or time your jump to clear a cracked barrier or land on its top.
- **Down Arrow** or **S** slides under low gates and briefly slows the runner. Slide on the gate cue to stay low through the beam. Make a fresh press on the mint **Power slide now** cue for a speed boost on landing.
- **W** or **X** dashes and can break one cracked purple barrier on contact in the lane your runner physically occupies. Jump first, then dash above long red spike patches to hold your height long enough to clear both tiles. Follow the **Jump now** and **Air dash now** cues.
- Red warning triangles painted on the track mark gaps. Jump across a short gap or move around a long closure. You can cross a missing lane while airborne. Entering it on the ground or landing in it ends the run.
- A crash ends the run at impact. After a short animation, a thought appears over the frozen track and sky in muted colors. Results follow over the same scene after about 3.75 seconds with the game in view. System reduced motion shows a frozen silhouette specific to the hazard and steady text for the same reading time. Choose **Run again** or press **Enter** from results.

### Touch controls

- Swipe horizontally on the playfield to move one lane. Each swipe triggers as you move and ends after one action. Lift your finger before swiping again.
- Swipe up to jump and down to slide. Lift after jumping, then make a fresh downward swipe on **Power slide now · Swipe down**. Over long spikes, wait for **Air dash now**, then press **Dash**. You can press it with your second finger while the first is still on the playfield.
- The Dash button shows **Ready**, **Active**, or **Recharging**. The playfield ignores taps. Two fingers on the playfield cancel an unfinished swipe. Rotating or resizing clears current touches and keeps the same run active.

### Fullscreen and Home Screen

On touch, **Start run** and **Run again** ask the browser to fullscreen the game and its controls. Play starts immediately in the available viewport. Rotate freely or use the browser’s fullscreen exit gesture. The current run continues, and the next touch on **Run again** can try fullscreen again. Keyboard and mouse starts work as before. [Fullscreen API Standard](https://fullscreen.spec.whatwg.org/)

Installed launches prefer fullscreen on supporting devices and fall back to standalone. On iPhone, tap **Install** on the start screen for the Safari steps. Tap **Share** (inside the Page Menu on some layouts), choose **Add to Home Screen**, turn on **Open as Web App** if shown, and tap **Add**. Open **run.void** from its Home Screen icon. Use **Done** or Escape to dismiss the in-game instructions. [Apple’s Home Screen guide](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)

When the browser offers a native install prompt, **Install** opens it directly. Each prompt offer can be used once. After dismissal, **Install** shows browser-menu guidance until a fresh offer arrives. The button is available on the start screen and hides in the installed app or when the browser confirms installation. Serve this folder over HTTPS for browsers that require a secure origin. LAN and direct-file launch remain available for ordinary play. [Chrome’s install guidance](https://developer.chrome.com/docs/modern-web-guidance/guides/pwa/install-web-app)

## Endless runs

The violet reflectors along the deck edges show forward motion from the start. Their trails grow as you gain speed and shorten when you slide. The darker sky drifts behind Relay Nine. System reduced motion keeps the sky steady.

Before completing Clue 1, the center hurdle arrives about 1.6 seconds into an endless run. Jump or move aside, then watch for the cracked barrier and the side-lane obstacles that follow. Mixed sections soon ask you to jump, change lanes, and slide in quick succession. Higher earned tiers bring harder openings and more demanding combinations earlier in the next run.

Longer runs reach higher tiers between clue discoveries. Silhouettes on the distant runway show upcoming obstacles. Read the next entrance as you leave each section. A wall can leave just one route, and the lane for the next action can shift. Later combinations add raised platforms, moving barriers, black-hole pulls, single-lane funnels, and sideways jumps between solid lanes. [See the tier progression and controls](docs/gameplay.md#later-obstacle-tiers).

Bolts bob and sway within their lanes. Run through low bolts, or jump over a hurdle or onto a platform to reach some higher ones in later tiers. System reduced motion holds them steady. Follow the longer bolt trails on clear track during live clue transmissions. Each pickup removes up to one second of dash recharge. Results show the bolts collected that run and the total banked for future unlocks.

## Local clue playtest

Run `python -m http.server 8000` from this folder and open the [ordinary local game](http://127.0.0.1:8000/). Choose **Start run** or press **Enter**. Audio waits for a player gesture, such as starting a run or pressing **Mute**. Use **Mute** to toggle sound.

Relay Nine is visible from the start. Cumulative meters across ordinary runs make nine recordings eligible. The next eligible unheard recording queues in clue order and waits for the last hazards to clear. If several clues are ready, ordinary play resumes between transmissions. The current track slows and softens, and all movement controls stay active. A crash or reload before completion leaves the clue pending. The star keeps the strongest pulse you’ve earned across runs and reloads. Results let you replay any recording you’ve heard.

Your highest earned tier sets the launch speed, opening difficulty, and minimum music tier for the **next** ordinary endless run. Each run starts at 0 m and credits the distance you cover. Replay earns zero meters. Existing saves keep their completed recordings, earned eligibility, and bolt bank. The original Beacon recording now appears as Clue 5 and can already be available on a migrated save.

- **Before any discovery** · 48 m/s and Tier 1.
- **Clue 1, eligible at 15,000 m** · Tier 2 at 80 m/s.
- **Clue 2, eligible at 35,000 m** · Tier 3 at 112 m/s.
- **Clue 3, eligible at 65,000 m** · Tier 4 at 144 m/s.
- **Clue 4, eligible at 95,000 m** · Tier 4.
- **Clue 5, eligible at 125,000 m** · Tier 5 at 176 m/s.
- **Clue 6, eligible at 160,000 m** · Tier 5.
- **Clue 7, eligible at 195,000 m** · Tier 5.
- **Clue 8, eligible at 230,000 m** · Tier 5.
- **Clue 9, eligible at 270,000 m** · Tier 5.

Clue progress is saved per browser origin. In the ordinary game over HTTP or HTTPS at `localhost`, `127.0.0.1`, or `[::1]`, select **Reset clue progress** on the start or results screen. This resets cumulative distance to 0 m, clears pending and discovered clues and their recordings, and restores the 48 m/s start with Tier 1 music. You keep your banked bolts and settings. If the browser blocks the save, the reset applies only to the current tab.

Use `?preview=1` through `?preview=9` or a recording’s stable ID, such as `?preview=pattern`. Choose **Start run** to play the selected transmission on clear track. [Clue 4’s numeric preview](http://127.0.0.1:8000/?preview=4) opens Pattern. The [original Clue 4 preview link](http://127.0.0.1:8000/?preview=clue4) still opens Beacon, now Clue 5. Preview and scripted practice are separate from personal progress and the bolt bank. Reload a preview to repeat it.

## Acceptance scenarios

Open the game in your browser and append `?scenario=landing` to its address. Replace `landing` with any scenario below. Scripted practice starts at 32 m/s, or 64 m/s with `&pace=fast`, unless noted below. Distances use the HUD reading. Open `index.html` without a scenario for the endless run. Add `?seed=42` to reuse a course seed.

- `landing` clears the track so you can practice changes in speed. Press Down Arrow or S while on the ground to see **Sliding** and a lower speed reading. Jump with Space, then press Down Arrow or S on the mint cue to see **Power slide**, mint speed lines, and a higher speed reading. Dash with W or X to see blue edge streaks and a **Dash active** badge.
- `hurdle` places an amber hurdle at 42 m in the center lane. Jump around 28 m to clear it. Staying centered without jumping ends the run.
- `barrier` places cracked barriers in the center lane and one lane right at 42 m. To land on top, stay centered and jump around 23 m, or 5 m at fast pace. To break a barrier at default pace, dash around 25 m. Stay centered to break the center barrier, or move right around 30 m to break the right one. Watch for **Barrier broken** at impact.
- `dash-first` puts two cracked barriers in the center at 42 and 50 m. Dash around 34 m to break the first at contact. Staying centered hits the second. Steer out as soon as the first breaks to clear the row.
- `dash-expiry` puts a cracked barrier at 76 m. Dash around 37 m and let it expire before you reach the barrier, then retry around 44 m to break it. At fast pace, use 18 m and 24 m respectively.
- `spike-short` places one red tile at 90 m. Jump around 85–87 m, or 78–83 m at fast pace.
- `spike-long` places two tiles at 90 m in the center and the next lane right. Stay centered, jump around 84–86 m (78–84 m at fast pace), then press W or X around 90–100 m. A jump alone fails. To see where a ground dash falls short even with a power slide, jump around 49 m (20 m at fast pace) and press Down Arrow or S on the mint cue. Once **Power slide** appears at touchdown around 80 m (76 m at fast pace), press W, then immediately press Space. The runner hits the patch while descending.
- `camera` gives you a clear runway to 1,180 m. At the default practice pace, watch the reflector trails grow and the view widen as you reach 64 m/s about 18 seconds into the run. Try a regular slide to see the trails shorten. Dash or time a power slide to see the view widen further and ease back. Hit the final barrier and restart to check the starting lens. Enable system reduced motion to check fixed FOV and that the animated speed effects disappear.
- `gap-short` cuts the center lane from 66 to 82 m. Stay centered and jump on **Jump now · Short gap** or **Swipe up now · Short gap**. You should land beyond the far lip without changing lanes.
- `gap` cuts the center lane from 66 to 386 m. Move one lane left by 50 m. Around 150 m, when the cut exposes the deck walls and deep sky, jump and move right toward the center. On **Land on solid track**, move right again while airborne to land one lane right of center. To return to the center on the ground, wait until 387 m. A ground dash straight into the gap still falls.
- `gap-edge` cuts the far-left lane and its outside rail from 67 to 390 m. Stay one lane to its right and look for the exposed edge, then reenter after 391 m.
- `high-speed` starts at 572 m/s for a quick render check. The center hurdle is at 620 m. Steer right early and watch it grow steadily through contact and pass below the runner. View the far-left cut from 1,240 to 3,240 m as its lip comes into view. Stay right of center to see the center barrier at 2,350 m and the long spike patch starting at 3,920 m on the center and next lane left. Add `&pace=fast` to start this layout at 64 m/s.
- [`platform`](http://127.0.0.1:8000/?scenario=platform) puts a runnable platform in the center lane. Stay centered and jump around 54 m, or 106 m at fast pace. Land on top and run off the far end.
- [`slide-gate`](http://127.0.0.1:8000/?scenario=slide-gate) puts a low beam in the center lane. Stay centered and use **Down Arrow / S** or swipe down when the gate cue appears, around 52 m at default pace or 108 m at fast pace. The runner stays low until clear, even after braking ends.
- [`moving-barrier`](http://127.0.0.1:8000/?scenario=moving-barrier) puts a cracked barrier on a sweep between the center and the lane immediately to its right. Move one lane left by 50 m, or 100 m at fast pace, and watch the barrier cross.
- [`black-hole`](http://127.0.0.1:8000/?scenario=black-hole) puts a one-lane pull in the center. Stay centered until it pulls you left, then move right to return to center.
- [`jump-slide`](http://127.0.0.1:8000/?scenario=jump-slide) starts with a wall. Move one lane left before it. Jump the hurdle around 54 m (107 m at fast pace), then land and press Down Arrow or S on **Slide gate · ↓ / S now**. On touch, swipe up to jump and down on **Slide gate · Swipe down now**.
- [`lane-jump`](http://127.0.0.1:8000/?scenario=lane-jump) starts with a wall. Move one lane left before it. On **Space now, then → twice**, jump and press Right Arrow twice with a release between presses. On **Swipe up now, then right twice**, swipe up and then swipe right twice. Make both lane changes while airborne to land one lane right of center.
- [`challenge`](http://127.0.0.1:8000/?scenario=challenge) starts at 144 m/s, or 176 m/s with `&pace=fast`. Start one lane left of center and jump the hurdle around 252 m (308 m at fast pace). Move to center and slide past the sweep, then move one lane right for the next two gates. On the gap cue, jump and move left twice in the air. Slide through the full-width gate on the far side. Jump the last hurdle around 1,701 m (1,994 m at fast pace), then steer back left after the pull and slide through the final gate of the authored opening.

  After the three opening sections, the endless course generator adds obstacles at your current speed with the usual warning distance. The generated course begins at Tier 4, or Tier 5 at fast pace. The entire route runs in practice mode, separate from saved clue progress and the bolt bank.
- `?seed=187` gives a repeatable endless opening at the same earned launch level. Once you’ve heard Beacon, the 176 m/s opening has a two-lane, two-tile spike patch in its first row at **287 m**. Use the practice scenarios above to rehearse the moves needed in the later sections.
- `lanes` puts a blocker in the starting lane. Hold an arrow to confirm you move just one lane. Release and press again to move another lane.

On touch, try `lanes` for one move per swipe. Use `landing` to try a ground slide, a jump into a power slide, and Dash charge. Use `spike-long` to try a jump followed by a second-finger Dash. Rotate during an unfinished swipe in `landing` and confirm that lifting the old touch does nothing. Try a fresh swipe in the new orientation, then check **Run again** after a collision in `hurdle`.

For a native fullscreen check, tap **Start run** in `landing`, rotate, then exit fullscreen and verify that the distance keeps increasing and the swipe controls still work. Use `hurdle` to check **Run again**. Repeat from the Home Screen icon to verify the installed fullscreen or standalone launch and inset layout.

Run `node --test` from this directory for audio, episode, runner, and page-wiring checks. The page-wiring tests exercise the actual scripts with a simulated DOM and canvas.

## Tuning

- Ordinary endless runs use the launch speed earned through completed discoveries. Base speed accelerates at 1.8 m/s² indefinitely. Ground slides and power slides keep the runner low for 14 m. A ground slide subtracts 8% of base speed, capped at 12 m/s, over those 14 m.
- A fresh slide input while descending within 1 m of the surface you’re about to land on queues a power slide for touchdown. You can also trigger it immediately within the first 3 m after landing, while still on that surface. The boost adds 15 m/s for 0.85 s. An air dash clears a queued slide. Make a fresh input when the mint cue returns.
- A slide that reaches a gate’s approach extends the crouch until the runner’s body clears the gate. The approach starts 16 m or three beam lengths before the first point of contact, whichever is farther.
- Cracked barriers are 1.88 m high. A descending jump can catch the top lip from up to 0.06 m below it.
- Dash adds up to 22 m/s for 0.7 s. The charge refills over 4 seconds from activation, and each bolt restores 1 second of recharge. An airborne dash holds jump height for 0.60 s. A dash started on the deck carries half its forward speed bonus after takeoff.
- The optical widening is 32% × `excess / (36 + excess)`, where `excess` is the amount by which actual speed exceeds the 32 m/s camera reference. Relative to that reference, desktop focal length is about 90% at 48 m/s, 85% at 64 m/s, 82% at 80 m/s, 79% at 101 m/s, 76% at 140 m/s, and 70% at 572 m/s. It approaches 68% as speed increases. Compact views use 80% of the widening. It eases with time constants of 0.14 s when widening and 0.32 s when recovering. Reduced motion fixes the lens and keeps the speed readout and **Dash active** badge.
- The course plans from current base speed, the speed increases from a power slide and dash, and continuing acceleration. It maintains 0.86 seconds of reaction time plus a 3 m buffer and plans at least 2.6 seconds ahead, with a 186 m minimum view. One longitudinal scale applies to geometry ahead of and behind the runner. The camera holds the framing depth at one meter behind the runner to keep the outer lanes readable. Actual speed affects FOV, and the depth scale follows base speed. Track markings crossfade between detail levels, and spike tiles keep a fixed number of rows. At 572 m/s, the planned view is about 1,590 m ahead and 186 m behind. A hurdle at the worst-case reaction horizon projects to about 9.9 × 3.6 CSS pixels in 320 × 568 portrait. At that speed in 1280 × 720 with a settled FOV, a hurdle’s foot advances about 2.38, 5.65, 7.72, and 10.63 pixels per 1/60 second at 0.50, 0.20, 0.12, and 0.05 seconds before contact.
- Generated short gaps span roughly 55% of normal jump travel at their approach base speed. Long closures span 3.0–3.5 seconds at their conservative approach speed. The course reserves an adjacent lane throughout each long closure and scales the spacing after its far lip before allowing another. Collision uses world distances. Long spikes scale from the maximum travel of a normal jump, including speed carried from a prior power slide and an earlier ground dash.
