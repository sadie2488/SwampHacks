// One record in the menu: four pictures drawn once (vinyl and frosted face, in colour and in gray). The vinyl turns
// while the record is chosen (one composited layer); colour and gray fade into each other with opacity only.
// The small hole marker is where the entrance's flower centre lands (the shared-element hand-over).
import { useEffect, useRef, useState } from 'react';
import type { ModeLook } from './modes';
import { drawRecord } from './recordImages';

export function Record({ m, index, px }: { m: ModeLook; index: number; px: number }) {
  const vinyl = useRef<HTMLCanvasElement>(null);
  const vinylGray = useRef<HTMLCanvasElement>(null);
  const face = useRef<HTMLCanvasElement>(null);
  const faceGray = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const c = { vinyl: vinyl.current, vinylGray: vinylGray.current, face: face.current, faceGray: faceGray.current };
    if (!c.vinyl || !c.vinylGray || !c.face || !c.faceGray || px < 8) return;
    let alive = true;
    drawRecord(c as Parameters<typeof drawRecord>[0], m, index, px).then(
      () => alive && setReady(true),
      () => alive && setReady(true),
    );
    return () => {
      alive = false;
    };
  }, [m, index, px]);

  return (
    <span className="record-art" data-ready={ready}>
      <span className="record-spin">
        <canvas ref={vinyl} className="record-layer record-color" />
        <canvas ref={vinylGray} className="record-layer record-gray" />
      </span>
      <canvas ref={face} className="record-layer record-color" />
      <canvas ref={faceGray} className="record-layer record-gray" />
      <span className="record-hole" />
    </span>
  );
}
