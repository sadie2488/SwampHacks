// The Paper Reef landscape: layered paper cut-outs (sun, teal hills, water, reeds, lily pads, paper dots) drawn with
// three.js. It only builds and draws; the controller decides when. The sheet music is NOT in here: the real sheet sits
// on a cream paper strip in the page, in front of this scene.
import {
  Color,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  Shape,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
} from 'three';

export interface ReefScene {
  resize(width: number, height: number): void;
  /** Draw one frame. kick (0 to 1) is how close we are to a beat; t is seconds, for a slow drift. */
  draw(kick: number, t: number): void;
  dispose(): void;
}

const CREAM = 0xfff0d6;
const FOV = 30;
const CAMERA_Z = 26;
const SUN_Z = -17;

interface Dot {
  mesh: Mesh;
  baseY: number;
  lift: number;
  phase: number;
}

export function createReefScene(canvas: HTMLCanvasElement, context: WebGLRenderingContext | WebGL2RenderingContext, pixelRatio: number): ReefScene {
  const renderer = new WebGLRenderer({ canvas, context: context as WebGLRenderingContext, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  // Only the paper dots move and they cast no shadow, so the shadows are worked out once, not every frame.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new Scene();
  scene.background = new Color(CREAM);
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 200);
  camera.position.set(0, 2.3, CAMERA_Z);
  camera.lookAt(0, 2.4, 0);

  scene.add(new HemisphereLight(0xfff4e0, 0xbfe6cf, 0.62));
  const light = new DirectionalLight(0xfff0d8, 0.62);
  light.position.set(-14, 18, 24);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  Object.assign(light.shadow.camera, { left: -34, right: 34, top: 22, bottom: -14, near: 1, far: 90 });
  light.shadow.bias = -0.0004;
  light.shadow.radius = 3;
  scene.add(light);

  // The same fixed "random" layout on every load.
  let seed = 5;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const materials = new Map<number, MeshStandardMaterial>();
  const paper = (color: number) => {
    let m = materials.get(color);
    if (!m) materials.set(color, (m = new MeshStandardMaterial({ color, roughness: 1, metalness: 0 })));
    return m;
  };
  const put = (geo: BufferGeometry, mat: Material, x: number, y: number, z: number, castShadow = true) => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = castShadow;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const ext = (shape: Shape, depth = 0.07) => new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 });
  const disc = (r: number) => new Shape().absarc(0, 0, r, 0, Math.PI * 2, false);

  // sun: a coral disc with a lighter disc on top (the inner one glows a little on each beat)
  const sunOuter = put(ext(disc(3.4)), paper(0xff7a59), 9, 9.4, SUN_Z);
  const sunInnerMat = new MeshStandardMaterial({ color: 0xffa07a, roughness: 1, metalness: 0 });
  const sunInner = put(ext(disc(2.5)), sunInnerMat, 9, 9.4, SUN_Z + 0.2);
  const sunCalm = new Color(0xffa07a);
  const sunGlow = new Color(0xffc4a3);

  // hills, far to near: paper layers with wavy top edges
  [0xd7ecd3, 0xa9dcc4, 0x74c1ae, 0x3fa597, 0x23857f, 0x176a68].forEach((color, k) => {
    const base = 2.2 - k * 0.55;
    const s = new Shape();
    s.moveTo(-40, -14);
    for (let x = -40; x <= 40; x += 0.6) s.lineTo(x, base + Math.sin(x * 0.16 + k * 1.7) * (1.4 - k * 0.1) + Math.sin(x * 0.41 + k) * 0.45 + (5 - k) * 0.9);
    s.lineTo(40, -14);
    s.closePath();
    put(ext(s, 0.08), paper(color), 0, -1.2, -14 + k * 2.3);
  });

  // water ribbons in front of the hills
  [0x2aa89a, 0x1f8f86, 0x167a74].forEach((color, k) => {
    const s = new Shape();
    s.moveTo(-40, -14);
    for (let x = -40; x <= 40; x += 0.5) s.lineTo(x, -1.35 - k * 0.55 + Math.sin(x * 0.5 + k * 2) * 0.18);
    s.lineTo(40, -14);
    s.closePath();
    put(ext(s, 0.06), paper(color), 0, 0, -2.3 + k * 0.55);
  });

  // reeds and leaves
  const leaf = (h: number, w: number, bend: number) => {
    const s = new Shape();
    s.moveTo(0, 0);
    s.quadraticCurveTo(w, h * 0.45, bend, h);
    s.quadraticCurveTo(-w * 0.4, h * 0.5, 0, 0);
    return ext(s, 0.03);
  };
  for (let i = 0; i < 34; i++) {
    const x = -24 + rnd() * 48;
    const h = 2 + rnd() * 3.4;
    const w = 0.25 + rnd() * 0.15;
    const bend = (rnd() - 0.5) * 1.2;
    const z = -0.8 - rnd() * 0.6;
    if (Math.abs(x) < 7) continue; // keep the middle open
    put(leaf(h, w, bend), paper([0x1f8f86, 0x2aa89a, 0x176a68][i % 3]), x, -1.3, z);
  }
  for (let i = 0; i < 9; i++) {
    const x = (i < 5 ? -1 : 1) * (10 + rnd() * 8);
    const m = put(leaf(4 + rnd() * 3, 0.55, (rnd() - 0.5) * 2), paper(i % 2 ? 0x0f4f4f : 0x14625e), x, -3.2, 3.5 + rnd() * 1.8);
    m.rotation.z = (rnd() - 0.5) * 0.5;
  }
  // big leaves in the bottom corners
  const corners: Array<{ mesh: Mesh; homeX: number }> = [];
  ([
    [-17, -3.5, 0.7],
    [16.5, -3.2, -0.65],
  ] as const).forEach(([x, y, r], k) => {
    const a = put(leaf(9, 1.6, k ? -2.4 : 2.4), paper(0x0d4547), x, y, 7);
    a.rotation.z = r * 0.6;
    const bx = x + (k ? -2.2 : 2.2);
    const b = put(leaf(7, 1.2, k ? -1.6 : 1.6), paper(0x136b66), bx, y, 6.2);
    b.rotation.z = r * 0.45;
    corners.push({ mesh: a, homeX: x }, { mesh: b, homeX: bx });
  });

  // lily pads with a few pink flowers
  for (let i = 0; i < 9; i++) {
    const x = -20 + rnd() * 40;
    const z = 1.5 + rnd() * 3.5;
    const r = 0.7 + rnd() * 0.7;
    const s = new Shape();
    s.moveTo(0, 0);
    s.absarc(0, 0, r, 0.3, Math.PI * 2 - 0.3, false);
    s.lineTo(0, 0);
    const g = ext(s, 0.04);
    g.rotateX(-Math.PI / 2);
    put(g, paper([0x4fb98a, 0x3a9a6a][i % 2]), x, -2.1 - rnd() * 0.5, z);
    if (rnd() < 0.55) {
      const f = ext(disc(0.22), 0.06);
      f.rotateX(-Math.PI / 2);
      put(f, paper(0xff9eb0), x + 0.1, -2.05, z);
    }
  }

  // paper dots floating in the air: they bob gently on the beat
  const dots: Dot[] = [];
  const dotMats = [0xffc23d, 0xff7a59, 0xfff4e0].map((color) => new MeshBasicMaterial({ color }));
  for (let i = 0; i < 40; i++) {
    const y = -0.5 + rnd() * 10;
    const x = -22 + rnd() * 44;
    const z = 2 + rnd() * 4;
    const r = 0.09 + rnd() * 0.08;
    const g = new CylinderGeometry(r, r, 0.04, 16);
    g.rotateX(Math.PI / 2);
    const mesh = put(g, dotMats[i % 3], x, y, z, false);
    dots.push({ mesh, baseY: y, lift: 0.08 + rnd() * 0.14, phase: rnd() * Math.PI * 2 });
  }

  const resize = (width: number, height: number) => {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // keep the sun in view on a narrow window
    const halfWidthAtSun = (CAMERA_Z - SUN_Z) * Math.tan(((FOV / 2) * Math.PI) / 180) * camera.aspect;
    const sunX = Math.min(9, Math.max(1.5, halfWidthAtSun * 0.5));
    sunOuter.position.x = sunX;
    sunInner.position.x = sunX;
    // on a narrow window the corner leaves move in so they still frame the water
    const pull = Math.max(0, 1 - camera.aspect) * 6;
    corners.forEach(({ mesh, homeX }) => {
      mesh.position.x = homeX + (homeX < 0 ? pull : -pull);
    });
    renderer.shadowMap.needsUpdate = true;
  };

  const draw = (kick: number, t: number) => {
    for (const d of dots) d.mesh.position.y = d.baseY + d.lift * kick + Math.sin(t * 0.8 + d.phase) * 0.04;
    sunInnerMat.color.copy(sunCalm).lerp(sunGlow, kick * 0.6);
    renderer.render(scene, camera);
  };

  const dispose = () => {
    scene.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    materials.forEach((m) => m.dispose());
    dotMats.forEach((m) => m.dispose());
    sunInnerMat.dispose();
    renderer.dispose();
  };

  return { resize, draw, dispose };
}
