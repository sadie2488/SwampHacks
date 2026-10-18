// Ask for a WebGL context ourselves, so a browser without WebGL never reaches three.js (which would log an error).
const CONTEXT_OPTIONS: WebGLContextAttributes = {
  antialias: false,
  alpha: false,
  depth: false,
  stencil: false,
  powerPreference: 'low-power',
  // A computer with no graphics chip would draw this slowly in software and steal time from hand tracking: skip it.
  failIfMajorPerformanceCaveat: true,
};

export function getContext(canvas: HTMLCanvasElement): WebGLRenderingContext | WebGL2RenderingContext | null {
  try {
    return (canvas.getContext('webgl2', CONTEXT_OPTIONS) as WebGL2RenderingContext | null) ?? (canvas.getContext('webgl', CONTEXT_OPTIONS) as WebGLRenderingContext | null);
  } catch {
    return null;
  }
}
