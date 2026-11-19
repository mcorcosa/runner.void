# Void Runner

Open [index.html](index.html) in a browser and choose **Start run** or press **Enter**. On a phone, open the same page in its browser. The page works directly from disk in browsers that allow local pages to load neighboring files.

For a phone on the same Wi-Fi network, run `python -m http.server 8000` from this folder and open `http://<computer-LAN-IP>:8000/` in the phone browser.

- **Left / Right** or **A / D** moves one lane per press.
- **Space** jumps over amber hurdles and single red spike tiles. Release Space after takeoff, then tap it again as the cue turns mint for a brief speed boost.
- **W** or **X** dashes and can break one cracked purple barrier on contact in the lane your runner physically occupies. Jump first, then dash above long red spike patches to hold your height long enough to clear both tiles. Follow the **Jump now** and **Air dash now** cues.
- Change lanes before a striped yellow roadblock. The opening exposes deck walls and the deep sky. Reenter after the illuminated teal far lip.
- A hit ends the run. Choose **Run again** or press **Enter** to restart.

### Touch controls

- Swipe horizontally on the playfield to move one lane. Each swipe triggers as you move and ends after one action. Lift your finger before swiping again.
- Swipe up to jump. Lift and swipe up again when **Swipe up now** turns mint to trigger the landing boost. Over long spikes, wait for **Air dash now**, then press **Dash**. You can press it with your second finger while the first is still on the playfield.
- The Dash button shows **Ready**, **Active**, or **Recharging**. The playfield ignores taps and downward swipes. Two fingers on the playfield cancel an unfinished swipe. Rotating or resizing clears current touches and keeps the same run active.

## Acceptance scenarios

Paste `file:///D:/runner/index.html?scenario=landing` into the desktop browser address bar. Replace `landing` with any scenario below. Append `&pace=fast` to start a scenario at the 64 m/s base cap. Distances use the HUD reading. Open `index.html` without a scenario for the endless run, or add `?seed=42` to reproduce a course.

- `landing` clears the track so you can practice both speed effects. Dash with W or X to see blue edge streaks and a **Dash active** badge. A held or early Space press lands normally. A fresh press near touchdown displays **Landing boost**, adds mint speed lines, and increases the speed reading.
- `hurdle` places an amber hurdle at 42 m in the center lane. Jump around 28 m to clear it. Staying centered without jumping ends the run.
- `barrier` places cracked barriers in the center and immediately to its right at 42 m. Dash around 25 m, then press D around 30 m to break the right barrier as you reach it. With the runner centered, the center barrier breaks instead. Watch for **Barrier broken** at impact.
- `dash-first` puts two cracked barriers in the center at 42 and 50 m. Dash around 34 m to break the first at contact. Staying centered hits the second. Steer out as soon as the first breaks to clear the row.
- `dash-expiry` puts a cracked barrier at 76 m. Dash around 37 m and let it expire before you reach the barrier, then retry around 44 m to break it. At fast pace, use 18 m and 24 m respectively.
- `spike-short` places one red tile at 90 m. Jump around 85–87 m, or 78–83 m at fast pace.
- `spike-long` places two tiles at 90 m in the center and the next lane right. Stay centered, jump around 84–86 m (78–84 m at fast pace), then press W or X around 90–100 m. A jump alone fails. To try the boosted ground-dash boundary, jump at about 49 m (20 m fast), tap Space on the mint cue, then press W before Space once you land near 80 m (75 m fast). This attempt hits the patch while descending.
- `camera` gives you a clear runway to 1,180 m. Stay centered and watch the view widen as the speed climbs from 32 to 64 m/s over about 18 seconds. Dash and land a boost to see it widen further and ease back. Hit the final barrier and restart to check the starting lens. Enable system reduced motion to check fixed FOV.
- `gap` cuts the center lane from 66 to 386 m. Dodge left by 50 m. Around 180 m the cut should still show the deep sky and exposed walls, with its far lip still out of view. Steer right around 200 m to test side entry, or wait until 387 m to move back safely. A straight dash into the roadblock hits it.
- `gap-edge` cuts the far-left lane and its outside rail from 67 to 390 m. Stay one lane to its right and look for the exposed edge, then reenter after 391 m. Use `&pace=fast` to inspect either cut at the cap.
- `?seed=187` runs the actual endless generator. On a run without speed bursts, the first center closure spans **762–1,077 m**. This is a useful replay for comparing the cut before the illuminated far face enters view and as you approach it.
- `lanes` puts a blocker in the starting lane. Hold an arrow to confirm you move just one lane. Release and press again to move another lane.

On touch, try `lanes` for one move per swipe, `landing` for a fresh up-swipe and Dash charge, and `spike-long` for a jump followed by a second-finger Dash. Rotate during an unfinished swipe in `landing` and confirm that lifting the old touch does nothing. Try a fresh swipe in the new orientation, then check **Run again** after a collision in `hurdle`.

Run the simulation and page-wiring checks from this directory with `node --test tests/runner.test.cjs`. The page-wiring tests exercise the actual scripts with a simulated DOM and canvas.

## Tuning

- The runner starts at 32 m/s and accelerates at 1.8 m/s² to a base cap of 64 m/s. A landing tap can register from 130 ms before to 90 ms after touchdown and adds 15 m/s for 0.85 s. Dash lasts 0.7 s and is ready again 0.95 s after activation. An airborne dash holds jump height for 0.60 s. A dash started on the deck carries half its forward speed bonus after takeoff.
- The camera uses actual forward speed. On desktop, the focal length is 100% of the viewport's starting value at 32 m/s, 82% at 64 m/s, and a minimum of 70% at 101 m/s. Compact views use 80% of that widening, keeping their focal length at 85.6% at base cap and 76% at full burst. The exponential time constants are 0.14 s for widening and 0.32 s for recovery. Reduced motion fixes the lens and keeps the speed readout and **Dash active** badge.
- Generated closures are sized for 3.0–3.5 seconds at the maximum possible approach speed, rounded up to the next meter. At the late-game cap they span 303–354 m, about 4.7–5.5 seconds at 64 m/s. Interior obstacle rows preserve an adjacent lane for the entire span. The following closure becomes eligible another 360–540 m beyond the far lip, subject to regular reaction spacing.
