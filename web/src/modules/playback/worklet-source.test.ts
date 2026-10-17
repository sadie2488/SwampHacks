// The worklet script as it is really shipped: one block of text built from the library, the engine and the message
// logic. It is run here against pretend worklet globals and must behave exactly like the same code run directly.
import { describe, expect, it } from 'vitest';
import { StretchEngine } from './stretch-engine';
import { noise } from './test-utils';
import { buildWorkletSource, runWorkletSource, selfTestWorkletSource, WORKLET_NAME } from './worklet-source';

const SR = 48000;

describe('the worklet script text', () => {
  const source = buildWorkletSource();

  it('registers one processor with the expected name and carries no module syntax', () => {
    expect(source).toContain(`registerProcessor('${WORKLET_NAME}'`);
    expect(source).not.toMatch(/^export\s/m);
    expect(source).not.toMatch(/^import\s/m);
    expect(source).not.toContain('sourceMappingURL');
  });

  it('passes its own dry run', () => {
    expect(selfTestWorkletSource(source)).toBeNull();
  });

  it('plays exactly what the same code plays when it is run directly (straight route, then stretched)', () => {
    const left = noise(SR * 6, 31, 0.4);
    const right = noise(SR * 6, 32, 0.4);
    const scope = runWorkletSource(source, SR);
    scope.send({ type: 'load', epoch: 1, sampleRate: SR, left, right });
    scope.send({ type: 'play' });
    const direct = new StretchEngine({ sampleRate: SR, channels: [left, right] }, SR);
    direct.play();
    const dl = new Float32Array(128);
    const dr = new Float32Array(128);
    let different = 0;
    for (let b = 0; b < 1200; b++) {
      if (b === 300) {
        scope.send({ type: 'tempo', value: 0.8 });
        direct.setTempo(0.8);
      }
      if (b === 700) {
        scope.send({ type: 'tempo', value: 1 });
        direct.setTempo(1);
      }
      if (b === 900) {
        scope.send({ type: 'pitch', value: 4 });
        direct.setPitchSemitones(4);
      }
      const w = scope.render(128);
      direct.render(dl, dr, 128);
      for (let i = 0; i < 128; i++) if (w.left[i] !== dl[i] || w.right[i] !== dr[i]) different++;
    }
    expect(different).toBe(0);
    expect(direct.route).toBe('stretch');
  });

  it('the dry run notices a script that is broken', () => {
    const broken = source.replace('const __createCore = __coreFactory(__createEngine);', 'const __createCore = __coreFactory(__missingName);');
    expect(selfTestWorkletSource(broken)).toMatch(/does not run|failed its test|made no sound/);
    expect(selfTestWorkletSource('this is not javascript (')).toMatch(/does not run/);
    expect(selfTestWorkletSource('registerProcessor("other", class {});')).toMatch(/does not run/);
  });
});
