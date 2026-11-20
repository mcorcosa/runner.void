const { observeCourse, play } = require('./encounter-player.cjs');

const { courses, direct, runner } = observeCourse(process.argv[2]);
console.log('Launch m/s | Seed | Reached 572 at s | First mixed at s | First 60s | 60s from 572');
console.log('Windows list authored sections / mixed sections / median seconds between sections / route inputs');
for (const discoveredClues of [0, 1, 2, 3, 4]) {
  for (const seed of [42, 187]) {
    const player = direct({ seed, discoveredClues });
    const launchSpeed = player.run.baseSpeed;
    const { passed, fastAt, actionLog } = play(player, courses, (572 - launchSpeed) / 1.8 + 60, runner);
    function summary(start) {
      const inside = ({ time }) => start <= time && time < start + 60;
      const window = passed.filter((beat) => inside({ time: beat.start }));
      const seams = window.map((beat) => beat.seam).filter((seam) => seam !== null).sort((a, b) => a - b);
      const lower = seams[Math.floor((seams.length - 1) / 2)];
      const upper = seams[Math.floor(seams.length / 2)];
      const median = seams.length ? (lower + upper) / 2 : undefined;
      return [window.length, window.filter((beat) => beat.committed).length, median?.toFixed(2) ?? '-',
        actionLog.filter(inside).length].join('/');
    }
    const first = passed.find((beat) => beat.committed);
    console.log([launchSpeed, seed, fastAt.toFixed(1), first.start.toFixed(1),
      summary(0), summary(fastAt)].join(' | '));
  }
}
