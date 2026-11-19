# run.void

**[Play run.void](https://mcorcosa.github.io/runner.void/)**

Open [index.html](index.html) in a browser and choose **Start run** or press **Enter**. On a phone, open the same page in its browser. The page works directly from disk in browsers that allow local pages to load neighboring files.

For a phone on the same Wi-Fi network, run `python -m http.server 8000` from this folder and open `http://<computer-LAN-IP>:8000/` in the phone browser.

- **Left / Right** or **A / D** moves one lane per press.
- **Space** jumps over amber hurdles and single red spike tiles.
- **Down Arrow** or **S** slides and briefly slows the runner. Press it on the mint **Power slide now** cue near touchdown for a brief speed increase.
- **W** or **X** dashes and can break one cracked purple barrier on contact in the lane your runner physically occupies. Jump first, then dash above long red spike patches to hold your height long enough to clear both tiles. Follow the **Jump now** and **Air dash now** cues.
- Change lanes before a striped yellow roadblock. The opening exposes deck walls and the deep sky. Reenter after the illuminated teal far lip.
- A hit ends the run. Choose **Run again** or press **Enter** to restart.

### Touch controls

- Swipe horizontally on the playfield to move one lane. Each swipe triggers as you move and ends after one action. Lift your finger before swiping again.
- Swipe up to jump and down to slide. Lift after jumping, then swipe down on **Power slide now · Swipe down** near touchdown. Over long spikes, wait for **Air dash now**, then press **Dash**. You can press it with your second finger while the first is still on the playfield.
- The Dash button shows **Ready**, **Active**, or **Recharging**. The playfield ignores taps. Two fingers on the playfield cancel an unfinished swipe. Rotating or resizing clears current touches and keeps the same run active.

### Fullscreen and Home Screen

On touch, **Start run** and **Run again** ask the browser to fullscreen the game and its controls. Play starts immediately in the available viewport. Rotate freely or use the browser’s fullscreen exit gesture. The current run continues, and the next touch on **Run again** can try fullscreen again. Keyboard and mouse starts work as before. [Fullscreen API Standard](https://fullscreen.spec.whatwg.org/)

Installed launches prefer fullscreen on supporting devices and fall back to standalone. On iPhone, tap **Install** on the start screen for the Safari steps. Tap **Share** (inside the Page Menu on some layouts), choose **Add to Home Screen**, turn on **Open as Web App** if shown, and tap **Add**. Open **run.void** from its Home Screen icon. Use **Done** or Escape to dismiss the in-game instructions. [Apple’s Home Screen guide](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)

When the browser offers a native install prompt, **Install** opens it directly. Each prompt offer can be used once. After dismissal, **Install** shows browser-menu guidance until a fresh offer arrives. The button is available on the start screen and hides in the installed app or when the browser confirms installation. Serve this folder over HTTPS for browsers that require a secure origin. LAN and direct-file launch remain available for ordinary play. [Chrome’s install guidance](https://developer.chrome.com/docs/modern-web-guidance/guides/pwa/install-web-app)

## Endless runs

The violet reflectors along the deck edges show forward motion from the start. Their trails grow as you gain speed and shorten when you slide.

The course opens with a hurdle and a cracked barrier. It introduces short, long, and wide spike patches in that order, then lane closures. Later rows cover more lanes, and long and wide spike patches become more common. Follow clear lanes and move one lane at a time to bypass obstacles.

## Acceptance scenarios

Open the game in your browser and append `?scenario=landing` to its address. Replace `landing` with any scenario below. Append `&pace=fast` to start a scripted run at 64 m/s with normal acceleration. Distances use the HUD reading. Open `index.html` without a scenario for the endless run, or add `?seed=42` to reproduce a course.

- `landing` clears the track so you can practice changes in speed. Press Down Arrow or S while on the ground to see **Sliding** and a lower speed reading. Jump with Space, then press Down Arrow or S on the mint cue to see **Power slide**, mint speed lines, and a higher speed reading. Dash with W or X to see blue edge streaks and a **Dash active** badge.
- `hurdle` places an amber hurdle at 42 m in the center lane. Jump around 28 m to clear it. Staying centered without jumping ends the run.
- `barrier` places cracked barriers in the center and immediately to its right at 42 m. Dash around 25 m, then press D around 30 m to break the right barrier as you reach it. With the runner centered, the center barrier breaks instead. Watch for **Barrier broken** at impact.
- `dash-first` puts two cracked barriers in the center at 42 and 50 m. Dash around 34 m to break the first at contact. Staying centered hits the second. Steer out as soon as the first breaks to clear the row.
- `dash-expiry` puts a cracked barrier at 76 m. Dash around 37 m and let it expire before you reach the barrier, then retry around 44 m to break it. At fast pace, use 18 m and 24 m respectively.
- `spike-short` places one red tile at 90 m. Jump around 85–87 m, or 78–83 m at fast pace.
- `spike-long` places two tiles at 90 m in the center and the next lane right. Stay centered, jump around 84–86 m (78–84 m at fast pace), then press W or X around 90–100 m. A jump alone fails. To see where a ground dash falls short even with a power slide, jump around 49 m (20 m at fast pace) and press Down Arrow or S on the mint cue. Once **Power slide** appears at touchdown around 80 m (76 m at fast pace), press W, then immediately press Space. The runner hits the patch while descending.
- `camera` gives you a clear runway to 1,180 m. Watch the reflector trails grow and the view widen as you reach 64 m/s, about 18 seconds into the run. Try a regular slide to see the trails shorten. Dash or time a power slide to see the view widen further and ease back. Hit the final barrier and restart to check the starting lens. Enable system reduced motion to check fixed FOV and that the animated speed effects disappear.
- `gap` cuts the center lane from 66 to 386 m. Dodge left by 50 m. Around 150 m the cut shows the deep sky and exposed walls before the far lip enters view. Steer right around 200 m to test side entry, or wait until 387 m to move back safely. A straight dash into the roadblock hits it.
- `gap-edge` cuts the far-left lane and its outside rail from 67 to 390 m. Stay one lane to its right and look for the exposed edge, then reenter after 391 m.
- `high-speed` starts at 572 m/s for a quick render check. The center hurdle is at 620 m. Steer right early and watch it grow steadily through contact and pass below the runner. View the far-left cut from 1,240 to 3,240 m as its lip comes into view. Stay right of center to see the center barrier at 2,350 m and the long spike patch starting at 3,920 m on the center and next lane left. Add `&pace=fast` to start this layout at 64 m/s.
- `?seed=187` runs the endless generator. Steer around the hazards using lane changes alone. The first short, long, and wide spike patches begin at **390 m**, **672 m**, and **924 m**. The first center closure spans **1,247–1,600 m**. Base speed reaches 140 m/s at 60 seconds and 572 m/s at five minutes of active play.
- `lanes` puts a blocker in the starting lane. Hold an arrow to confirm you move just one lane. Release and press again to move another lane.

On touch, try `lanes` for one move per swipe. Use `landing` to try a ground slide, a jump into a power slide, and Dash charge. Use `spike-long` to try a jump followed by a second-finger Dash. Rotate during an unfinished swipe in `landing` and confirm that lifting the old touch does nothing. Try a fresh swipe in the new orientation, then check **Run again** after a collision in `hurdle`.

For a native fullscreen check, tap **Start run** in `landing`, rotate, then exit fullscreen and verify that the distance keeps increasing and the swipe controls still work. Use `hurdle` to check **Run again**. Repeat from the Home Screen icon to verify the installed fullscreen or standalone launch and inset layout.

Run the simulation and page-wiring checks from this directory with `node --test tests/runner.test.cjs`. The page-wiring tests exercise the actual scripts with a simulated DOM and canvas.

## Tuning

- Base speed starts at 32 m/s, accelerates at 1.8 m/s² indefinitely, and resets on restart. A ground slide subtracts 8% of base speed, capped at 12 m/s, for up to 0.34 s. A fresh slide input from 130 ms before to 90 ms after touchdown triggers a power slide that adds 15 m/s for 0.85 s.
- Dash adds up to 22 m/s for 0.7 s and is ready again 0.95 s after activation. An airborne dash holds jump height for 0.60 s. A dash started on the deck carries half its forward speed bonus after takeoff.
- The optical widening is 32% × `excess / (36 + excess)`, where `excess` is actual speed above 32 m/s. Desktop focal length is about 85% of its starting value at 64 m/s, 79% at 101 m/s, 76% at 140 m/s, and 70% at 572 m/s. It approaches 68% as speed increases. Compact views use 80% of the widening. It eases with time constants of 0.14 s when widening and 0.32 s when recovering. Reduced motion fixes the lens and keeps the speed readout and **Dash active** badge.
- The course plans from current base speed, the speed increases from a power slide and dash, and continuing acceleration. It maintains 0.86 seconds of reaction time plus a 3 m buffer and plans at least 2.6 seconds ahead, with a 186 m minimum view. One longitudinal scale applies to geometry ahead of and behind the runner. The camera holds the framing depth at one meter behind the runner to keep the outer lanes readable. Actual speed affects FOV, and the depth scale follows base speed. Track markings crossfade between detail levels, and spike tiles keep a fixed number of rows. At 572 m/s, the planned view is about 1,590 m ahead and 186 m behind. A hurdle at the worst-case reaction horizon projects to about 9.9 × 3.6 CSS pixels in 320 × 568 portrait. In 1280 × 720 with a settled FOV, a hurdle’s foot advances about 2.38, 5.65, 7.72, and 10.63 pixels per 1/60 second at 0.50, 0.20, 0.12, and 0.05 seconds before contact.
- Generated closures span 3.0–3.5 seconds at their conservative approach speed. The course reserves an adjacent lane throughout and scales the spacing after the far lip before allowing another closure. Collision uses world distances. Long spikes scale from the maximum travel of a normal jump, including speed carried from a prior power slide and an earlier ground dash.
