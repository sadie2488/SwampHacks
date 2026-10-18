// The Overture background as a three.js scene: one full-screen quad with the print shader (one draw call).
// Nothing is created per frame: draw() only copies numbers into the shader's uniforms.
import { Color, DataTexture, LinearFilter, Mesh, OrthographicCamera, PlaneGeometry, RGBFormat, Scene, ShaderMaterial, Texture, Vector2, Vector3, WebGLRenderer } from 'three';
import { FRAG, VERT } from './shader';

/** Everything the picture depends on, already smoothed by the controller. */
export interface Look {
  a: Color;
  b: Color;
  bg: Color;
  effect: number;
  ink: number;
  sat: number;
  tint: number;
  dim: number;
  vignette: number;
  grain: number;
  mis: number;
  level: number;
  low: number;
  high: number;
  pulse: number;
}

export interface OvertureScene {
  resize(width: number, height: number, pixelRatio: number): void;
  /** Use this camera picture (or none). Call `cameraFrame()` when the video has a new frame. */
  setCamera(video: HTMLVideoElement | null): void;
  cameraFrame(): void;
  ripple(x: number, y: number, at: number): void;
  draw(look: Look, time: number): void;
  dispose(): void;
}

export function createScene(canvas: HTMLCanvasElement, context: WebGLRenderingContext | WebGL2RenderingContext): OvertureScene {
  const renderer = new WebGLRenderer({ canvas, context: context as WebGLRenderingContext, antialias: false, powerPreference: 'low-power' });
  const black = new DataTexture(new Uint8Array([0, 0, 0]), 1, 1, RGBFormat);
  black.needsUpdate = true;
  let camTex: Texture | null = null;
  let video: HTMLVideoElement | null = null;
  const u = {
    uCam: { value: black as Texture },
    uHasCam: { value: 0 },
    uCamAspect: { value: 16 / 9 },
    uTime: { value: 0 },
    uLevel: { value: 0 },
    uLow: { value: 0 },
    uHigh: { value: 0 },
    uPulse: { value: 0 },
    uMis: { value: 1 },
    uDot: { value: 6 },
    uEffect: { value: 0.25 },
    uInk: { value: 1 },
    uSat: { value: 0.6 },
    uTint: { value: 0.3 },
    uDim: { value: 0.8 },
    uVignette: { value: 0.6 },
    uGrain: { value: 0.04 },
    uRes: { value: new Vector2(1, 1) },
    uA: { value: new Color() },
    uB: { value: new Color() },
    uBg: { value: new Color() },
    uClick: { value: new Vector3(0.5, 0.5, -99) },
  };
  const material = new ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false });
  const geometry = new PlaneGeometry(2, 2);
  const scene = new Scene();
  scene.add(new Mesh(geometry, material));
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let ratio = 1;

  return {
    resize(w, h, pixelRatio) {
      ratio = pixelRatio;
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(w, h, false);
      u.uRes.value.set(w * pixelRatio, h * pixelRatio);
      u.uDot.value = 4 * Math.max(1, pixelRatio);
    },
    setCamera(v) {
      camTex?.dispose();
      camTex = null;
      video = v;
      if (v) {
        camTex = new Texture(v);
        camTex.minFilter = LinearFilter;
        camTex.magFilter = LinearFilter;
        camTex.generateMipmaps = false;
      }
      u.uCam.value = camTex ?? black;
      u.uHasCam.value = 0;
    },
    cameraFrame() {
      if (!camTex || !video || video.readyState < 2 || !video.videoWidth) return;
      camTex.needsUpdate = true;
      u.uHasCam.value = 1;
      u.uCamAspect.value = video.videoWidth / video.videoHeight;
    },
    ripple(x, y, at) {
      u.uClick.value.set(x, 1 - y, at);
    },
    draw(look, time) {
      u.uTime.value = time;
      u.uA.value.copy(look.a);
      u.uB.value.copy(look.b);
      u.uBg.value.copy(look.bg);
      u.uEffect.value = look.effect;
      u.uInk.value = look.ink;
      u.uSat.value = look.sat;
      u.uTint.value = look.tint;
      u.uDim.value = look.dim;
      u.uVignette.value = look.vignette;
      u.uGrain.value = look.grain;
      u.uMis.value = look.mis * ratio;
      u.uLevel.value = look.level;
      u.uLow.value = look.low;
      u.uHigh.value = look.high;
      u.uPulse.value = look.pulse;
      renderer.render(scene, camera);
    },
    dispose() {
      camTex?.dispose();
      black.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
