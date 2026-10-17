import { useEffect, useRef, useState } from 'react';
import { bus, isFakeMode } from '@/bus';
import { drawLandmarks } from './camera-overlay';
import { useBusValue, useModuleStatus } from './hooks';

// The "see yourself" picture, shown under the Devices panel on every tab while the camera is on.
// The camera stream is the plain, unflipped picture: only the <video> is mirrored (in styles.css).
// The tracking canvas on top is never flipped, because the vision module already publishes the landmarks mirrored.
// If the camera cannot start, the reason shows in the Devices panel just above ("Camera: Problem: ...").
export function CameraPreview() {
  const stream = useBusValue('cameraStream') ?? null;
  const status = useModuleStatus('vision');
  const cameraOn = status?.state === 'starting' || status?.state === 'running';
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [aspect, setAspect] = useState(4 / 3);

  // Attach the stream to the picture; let go of it when it goes away or changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!stream || !video) return;
    video.srcObject = stream;
    drawLandmarks(canvasRef.current, null);
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  // Follow the tracking while there is a picture. Replay draws the latest points right away after a remount.
  const live = stream !== null;
  useEffect(() => {
    if (!live) return;
    return bus.on(
      'landmarks',
      (lm) => {
        if (lm.width > 0 && lm.height > 0) setAspect(lm.width / lm.height);
        drawLandmarks(canvasRef.current, lm);
      },
      { replay: true },
    );
  }, [live]);

  if (!stream) {
    if (!cameraOn) return null;
    return (
      <p className="muted camera-preview-waiting" data-testid="camera-preview-waiting">
        {isFakeMode() ? 'Practice mode: there is no real camera picture, only made-up movements.' : 'Waiting for the camera...'}
      </p>
    );
  }

  return (
    <figure className="camera-preview" data-testid="camera-preview">
      <div className="camera-preview-frame" style={{ aspectRatio: String(aspect) }}>
        <video
          ref={videoRef}
          className="camera-preview-video"
          data-testid="camera-preview-video"
          autoPlay
          playsInline
          muted
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth > 0 && v.videoHeight > 0) setAspect(v.videoWidth / v.videoHeight);
          }}
        />
        <canvas ref={canvasRef} className="camera-preview-overlay" data-testid="camera-preview-overlay" aria-label="Tracking drawn over the camera picture" />
      </div>
      <figcaption className="muted">You (mirrored). Dots show what the camera tracks.</figcaption>
    </figure>
  );
}
