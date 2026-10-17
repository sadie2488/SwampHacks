// Where are we inside the current beat? 0 means right on a beat, 0.5 halfway to the next one.
// Works in song seconds, so it does not depend on how fast the song is being played.

const wrap01 = (x: number) => ((x % 1) + 1) % 1;

export function beatPhaseAt(positionSec: number, beats: number[] | undefined, tempoBpm: number | undefined): number | undefined {
  if (beats && beats.length >= 2) {
    const last = beats.length - 1;
    // the last beat at or before this moment
    let lo = 0;
    let hi = last;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (beats[mid] <= positionSec) lo = mid;
      else hi = mid - 1;
    }
    if (positionSec < beats[0]) {
      const len = beats[1] - beats[0];
      if (len > 0) return wrap01((positionSec - beats[0]) / len);
    } else if (lo < last) {
      const len = beats[lo + 1] - beats[lo];
      if (len > 0) return Math.min(1, Math.max(0, (positionSec - beats[lo]) / len));
    } else {
      const len = beats[last] - beats[last - 1];
      if (len > 0) return wrap01((positionSec - beats[last]) / len);
    }
  }
  if (tempoBpm && tempoBpm > 0) return wrap01((positionSec * tempoBpm) / 60);
  return undefined;
}
