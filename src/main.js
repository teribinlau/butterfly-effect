// main.js — wires renderer, composer, passes, GUI.
//
// Pipeline order mirrors the real Unicorn layer stack (bottom layer first):
//   Gradient(bg) -> Video -> Blocks -> Glyph Dither -> Voronoi -> Mouse
//     -> Blob Tracking -> Fast Bloom -> Output
// (Layer 9 in the project is the watermark compositing pass — intentionally omitted.)
//
// Voronoi and Mouse are both cursor-driven image-distortion layers in the real
// embed; reimplemented here from observed behavior (no Unicorn shader copied).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import GUI from 'lil-gui';

import { createVideo } from './ui/uploader.js';
import { createGradientPass } from './passes/gradientPass.js';
import { createVideoPass } from './passes/videoPass.js';
import { createBlocksPass, BlendModes } from './passes/blocksPass.js';
import { createGlyphDitherPass, GlyphPresets } from './passes/glyphDitherPass.js';
import { createVoronoiPass } from './passes/voronoiPass.js';
import { createMouseTrailPass } from './passes/mouseTrailPass.js';
import { createBlobTrackingPass, ConnectorTypes, ConnectorStrokes } from './passes/blobTrackingPass.js';

const DEFAULT_VIDEO = 'https://firebasestorage.googleapis.com/v0/b/unicorn-studio.appspot.com/o/Kv99pomh5sZiukPlOYkhXn2Ct6l2%2Fremix_grok-video-392f6cc9-cd51-4cd7-b78f-f9ff2c873fc2%20(1).mp4?alt=media';

// ─── Renderer ───────────────────────────────────────────────────────────────
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
renderPass.clear = true;
composer.addPass(renderPass);

// ─── Video element + texture ──────────────────────────────────────────────────
let videoAspect = 1;
const video = createVideo(DEFAULT_VIDEO, (v) => {
  videoAspect = v.videoWidth / v.videoHeight || 1;
  videoPass.uniforms.uVideoAspect.value = videoAspect;
});
const videoTex = new THREE.VideoTexture(video);
videoTex.colorSpace = THREE.SRGBColorSpace;
videoTex.minFilter = THREE.LinearFilter;
videoTex.magFilter = THREE.LinearFilter;
videoTex.generateMipmaps = false;

// ─── Passes (render order) ─────────────────────────────────────────────────────
const gradientPass = createGradientPass();
composer.addPass(gradientPass);

const videoPass = createVideoPass();
videoPass.uniforms.tVideo.value = videoTex;
composer.addPass(videoPass);

const blocksPass = createBlocksPass();
composer.addPass(blocksPass);

const glyphPass = createGlyphDitherPass();   // real redacted.png atlas
composer.addPass(glyphPass);

const voronoiPass = createVoronoiPass();
composer.addPass(voronoiPass);

const mousePass = createMouseTrailPass();
composer.addPass(mousePass);

const blobPass = createBlobTrackingPass(video);
composer.addPass(blobPass);

const bloomPass = new UnrealBloomPass(new THREE.Vector2(1024, 1024), 0.55, 0.6, 0.2);
composer.addPass(bloomPass);

const outputPass = new OutputPass();
composer.addPass(outputPass);

// ─── Resize ─────────────────────────────────────────────────────────────────
function fit() {
  const r = canvas.getBoundingClientRect();
  const w = Math.max(2, Math.round(r.width));
  const h = Math.max(2, Math.round(r.height));
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  const res = [w * renderer.getPixelRatio(), h * renderer.getPixelRatio()];
  gradientPass.uniforms.uResolution.value = res;
  videoPass.uniforms.uOutAspect.value = res[0] / res[1];
  blocksPass.uniforms.uResolution.value = res;
  glyphPass.uniforms.uResolution.value = res;
  voronoiPass.uniforms.uResolution.value = res;
  mousePass.uniforms.uResolution.value = res;
  blobPass.uniforms.uResolution.value = res;
  bloomPass.resolution.set(res[0], res[1]);
}
fit();
new ResizeObserver(fit).observe(canvas);

// ─── GUI ────────────────────────────────────────────────────────────────────
const gui = new GUI({ title: 'Effect Params' });
gui.domElement.style.position = 'fixed';
gui.domElement.style.top = '70px';
gui.domElement.style.right = '12px';
gui.domElement.style.maxHeight = '85vh';
gui.domElement.style.overflowY = 'auto';

// — Gradient (background)
{
  const f = gui.addFolder('Gradient (bg)');
  const u = gradientPass.uniforms;
  const proxy = { 'Color A': '#070b1e', 'Color B': '#2D4DFF', 'Color C': '#7E90FF', 'Speed': 25, 'Scale': 140 };
  f.addColor(proxy, 'Color A').onChange(v => u.uColorA.value.set(v));
  f.addColor(proxy, 'Color B').onChange(v => u.uColorB.value.set(v));
  f.addColor(proxy, 'Color C').onChange(v => u.uColorC.value.set(v));
  f.add(proxy, 'Speed', 0, 100, 1).onChange(v => u.uSpeed.value = v / 100);
  f.add(proxy, 'Scale', 20, 400, 1).onChange(v => u.uScale.value = v / 100);
  u.uSpeed.value = 0.25;
  f.close();
}

// — Video
{
  const f = gui.addFolder('Video');
  const u = videoPass.uniforms;
  const proxy = {
    'Fit to canvas': true, 'Flip X': false, 'Flip Y': false,
    'Scale': 140, 'Rotation': 0, 'Opacity': 100, 'Displace': 0,
    'Exposure': 2.0, 'Saturation': 172, 'Contrast': 200, 'Speed': 100, 'Loop': true,
  };
  f.add(proxy, 'Fit to canvas').onChange(v => u.uFit.value = v ? 1 : 0);
  f.add(proxy, 'Flip X').onChange(v => u.uFlipX.value = v ? 1 : 0);
  f.add(proxy, 'Flip Y').onChange(v => u.uFlipY.value = v ? 1 : 0);
  f.add(proxy, 'Scale', 10, 300, 1).onChange(v => u.uScale.value = v / 100);
  f.add(proxy, 'Rotation', -180, 180, 1).onChange(v => u.uRot.value = v * Math.PI / 180);
  f.add(proxy, 'Opacity', 0, 100, 1).onChange(v => u.uOpacity.value = v / 100);
  f.add(proxy, 'Displace', 0, 100, 1).onChange(v => u.uDisplace.value = v / 100);
  f.add(proxy, 'Exposure', 0, 4, 0.05).onChange(v => u.uExposure.value = v);
  f.add(proxy, 'Saturation', 0, 300, 1).onChange(v => u.uSat.value = v / 100);
  f.add(proxy, 'Contrast', 0, 400, 1).onChange(v => u.uContrast.value = v / 100);
  f.add(proxy, 'Speed', 10, 300, 1).onChange(v => video.playbackRate = v / 100);
  f.add(proxy, 'Loop').onChange(v => video.loop = v);
  u.uScale.value = 1.4; u.uExposure.value = 2.0; u.uSat.value = 1.72; u.uContrast.value = 2.0;
  f.close();
}

// — Blocks (procedural grid; real type=blocks, speed 0.08, blend Difference)
{
  const f = gui.addFolder('Blocks');
  const u = blocksPass.uniforms;
  const proxy = {
    'Color 1': '#7E90FF', 'Color 2': '#D9F4FF', 'Density': 17, 'Size': -10,
    'Spread': 64, 'Variance': 58, 'Skew': 100, 'Angle': 0, 'Opacity': 61,
    'Speed': 8, 'Blend mode': 'Difference',
  };
  f.addColor(proxy, 'Color 1').onChange(v => u.uColor1.value.set(v));
  f.addColor(proxy, 'Color 2').onChange(v => u.uColor2.value.set(v));
  f.add(proxy, 'Density', 2, 200, 1).onChange(v => u.uDensity.value = v);
  f.add(proxy, 'Size', -100, 100, 1).onChange(v => u.uSize.value = v);
  f.add(proxy, 'Spread', 0, 100, 1).onChange(v => u.uSpread.value = v);
  f.add(proxy, 'Variance', 0, 100, 1).onChange(v => u.uVariance.value = v);
  f.add(proxy, 'Skew', -200, 200, 1).onChange(v => u.uSkew.value = v);
  f.add(proxy, 'Angle', -180, 180, 1).onChange(v => u.uAngle.value = v);
  f.add(proxy, 'Opacity', 0, 100, 1).onChange(v => u.uOpacity.value = v / 100);
  f.add(proxy, 'Speed', 0, 100, 1).onChange(v => u.uSpeed.value = v / 100);
  f.add(proxy, 'Blend mode', BlendModes).onChange(v => u.uBlend.value = BlendModes.indexOf(v));
  u.uColor1.value.set(proxy['Color 1']); u.uColor2.value.set(proxy['Color 2']);
  u.uDensity.value = 17; u.uSize.value = -10; u.uSpread.value = 64; u.uVariance.value = 58;
  u.uSkew.value = 100; u.uAngle.value = 0; u.uOpacity.value = 0.61; u.uSpeed.value = 0.08;
  u.uBlend.value = BlendModes.indexOf('Difference');
  f.close();
}

// Base sub-tile pos for the glyph grid (mouse drift added in tick()).
const glyphBasePos = [0.5, 0.5];

// — Glyph Dither (real redacted atlas)
{
  const f = gui.addFolder('Glyph Dither');
  const u = glyphPass.uniforms;
  const proxy = {
    'Position X': 50, 'Position Y': 50, 'Preset': 'Redacted', 'Characters': '█▓▒░ ',
    'Scale': 12, 'Gamma': 53, 'Phase': 0, 'Mix': 74, 'Color mode': 'Monochrome',
    'Background': true, 'Color': '#2D4DFF', 'Opacity': 100, 'Invert order': false, 'Blend': 'Screen',
  };
  f.add(proxy, 'Position X', 0, 100, 0.1).onChange(v => glyphBasePos[0] = v / 100);
  f.add(proxy, 'Position Y', 0, 100, 0.1).onChange(v => glyphBasePos[1] = v / 100);
  f.add(proxy, 'Preset', Object.keys(GlyphPresets)).onChange(v => {
    const chars = GlyphPresets[v]; proxy.Characters = chars ?? proxy.Characters;
    charCtrl.updateDisplay(); glyphPass.setCharacters(chars);
  });
  const charCtrl = f.add(proxy, 'Characters').onChange(v => glyphPass.setCharacters(v));
  f.add(proxy, 'Scale', 4, 80, 1).onChange(v => u.uScale.value = v);
  f.add(proxy, 'Gamma', 0, 100, 1).onChange(v => u.uGamma.value = 0.3 + (v / 100) * 1.7);
  f.add(proxy, 'Phase', 0, 100, 1).onChange(v => u.uPhase.value = v / 100);
  f.add(proxy, 'Mix', 0, 100, 1).onChange(v => u.uMix.value = v / 100);
  f.add(proxy, 'Color mode', ['Monochrome', 'Color']).onChange(v => u.uColorMode.value = v === 'Monochrome' ? 0 : 1);
  f.add(proxy, 'Background').onChange(v => u.uBackground.value = v ? 1 : 0);
  f.addColor(proxy, 'Color').onChange(v => u.uColor.value.set(v));
  f.add(proxy, 'Opacity', 0, 100, 1).onChange(v => u.uOpacity.value = v / 100);
  f.add(proxy, 'Invert order').onChange(v => u.uInvert.value = v ? 1 : 0);
  f.add(proxy, 'Blend', ['Normal', 'Screen']).onChange(v => u.uBlend.value = v === 'Screen' ? 2 : 0);
  u.uScale.value = 12; u.uGamma.value = 0.53; u.uMix.value = 0.74;
  u.uColor.value.set('#2D4DFF'); u.uBackground.value = 1; u.uBlend.value = 2;
  f.close();
}

// — Voronoi (cursor-driven image distortion)
{
  const f = gui.addFolder('Voronoi');
  const u = voronoiPass.uniforms;
  const proxy = { 'Cell scale': 18, 'Strength': 50, 'Radius': 45, 'Speed': 12, 'Global warp': 0 };
  f.add(proxy, 'Cell scale', 2, 60, 1).onChange(v => u.uScale.value = v);
  f.add(proxy, 'Strength', 0, 100, 1).onChange(v => u.uStrength.value = v / 100);
  f.add(proxy, 'Radius', 5, 100, 1).onChange(v => u.uRadius.value = v / 100);
  f.add(proxy, 'Speed', 0, 100, 1).onChange(v => u.uSpeed.value = v / 100);
  f.add(proxy, 'Global warp', 0, 100, 1).onChange(v => u.uGlobal.value = v / 100);
  u.uScale.value = 18; u.uStrength.value = 0.5; u.uRadius.value = 0.45; u.uSpeed.value = 0.12; u.uGlobal.value = 0;
  f.close();
}

// — Mouse layer (cursor-driven liquid distortion + chromatic aberration) + cursor state
const mouseState = {
  enabled: true,
  target: [0.5, 0.5], smooth: [0.5, 0.5], prev: [0.5, 0.5], active: 0,
  momentum: 0.29,         // higher = more lag (Unicorn mouseMomentum)
  glyphDrift: 0.0,        // optional: cursor offsets the glyph grid (off by default)
};
function setMousePos(e) {
  const r = canvas.getBoundingClientRect();
  mouseState.target[0] = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  mouseState.target[1] = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
}
canvas.addEventListener('pointermove', (e) => { setMousePos(e); mouseState.active = 1; });
canvas.addEventListener('pointerenter', () => { mouseState.active = 1; });
canvas.addEventListener('pointerleave', () => { mouseState.active = 0; });
{
  const f = gui.addFolder('Mouse Distortion');
  const u = mousePass.uniforms;
  const proxy = { 'Enabled': true, 'Momentum': 29, 'Strength': 50, 'Radius': 35, 'Chromatic': 50, 'Glyph drift': 0 };
  f.add(proxy, 'Enabled').onChange(v => { mouseState.enabled = v; });
  f.add(proxy, 'Momentum', 0, 95, 1).onChange(v => mouseState.momentum = v / 100);
  f.add(proxy, 'Strength', 0, 100, 1).onChange(v => u.uStrength.value = v / 100);
  f.add(proxy, 'Radius', 5, 100, 1).onChange(v => u.uRadius.value = v / 100);
  f.add(proxy, 'Chromatic', 0, 100, 1).onChange(v => u.uChroma.value = v / 100);
  f.add(proxy, 'Glyph drift', 0, 100, 1).onChange(v => mouseState.glyphDrift = v / 100);
  u.uStrength.value = 0.5; u.uRadius.value = 0.35; u.uChroma.value = 0.5;
}

// — Blob Tracking
{
  const f = gui.addFolder('Blob Tracking');
  const u = blobPass.uniforms;
  const p = blobPass.detectParams;
  const proxy = {
    'Max blobs': 16, 'Mix': 100, 'Blend mode': 'SoftLight', 'Background': true,
    'Smoothing': 66, 'Threshold': 36, 'Persistence': 1, 'Size': 62, 'Fill': 99,
    'Color': '#FFFFFF', 'Line width': 29, 'Connector': 'Loop Straight', 'Stroke': 'Dotted', 'Max distance': 150,
  };
  f.add(proxy, 'Max blobs', 1, 16, 1).onChange(v => p.maxBlobs = v);
  f.add(proxy, 'Mix', 0, 100, 1).onChange(v => u.uMix.value = v / 100);
  f.add(proxy, 'Blend mode', BlendModes).onChange(v => u.uBlend.value = BlendModes.indexOf(v));
  f.add(proxy, 'Background').onChange(v => u.uHasBackground.value = v ? 1 : 0);
  f.add(proxy, 'Smoothing', 0, 100, 1).onChange(v => p.smoothing = v / 100);
  f.add(proxy, 'Threshold', 0, 100, 1).onChange(v => p.threshold = v / 100);
  f.add(proxy, 'Persistence', 0, 30, 1).onChange(v => p.persistence = v);
  f.add(proxy, 'Size', 0, 100, 1).onChange(v => u.uSize.value = v / 100 * 0.08);
  f.add(proxy, 'Fill', 0, 100, 1).onChange(v => u.uFill.value = v / 100);
  f.addColor(proxy, 'Color').onChange(v => u.uColor.value.set(v));
  f.add(proxy, 'Line width', 0, 100, 1).onChange(v => u.uLineWidth.value = v / 100 * 0.02);
  f.add(proxy, 'Connector', ConnectorTypes).onChange(v => u.uConnectorType.value = ConnectorTypes.indexOf(v));
  f.add(proxy, 'Stroke', ConnectorStrokes).onChange(v => u.uStrokeStyle.value = ConnectorStrokes.indexOf(v));
  f.add(proxy, 'Max distance', 0, 300, 1).onChange(v => u.uMaxDistance.value = v / 300);
  p.maxBlobs = 16; p.smoothing = 0.66; p.threshold = 0.36; p.persistence = 1;
  u.uMix.value = 1; u.uBlend.value = BlendModes.indexOf('SoftLight'); u.uHasBackground.value = 1;
  u.uSize.value = 0.62 / 100 * 0.08; u.uFill.value = 0.99; u.uColor.value.set('#FFFFFF');
  u.uLineWidth.value = 29 / 100 * 0.02; u.uConnectorType.value = ConnectorTypes.indexOf('Loop Straight');
  u.uStrokeStyle.value = ConnectorStrokes.indexOf('Dotted'); u.uMaxDistance.value = 150 / 300;
  f.close();
}

// — Fast Bloom (real intensity ~0.24 / amount ~0.11 → subtle)
{
  const f = gui.addFolder('Fast Bloom');
  const proxy = { Strength: 0.55, Radius: 0.6, Threshold: 0.2 };
  f.add(proxy, 'Strength', 0, 3, 0.01).onChange(v => bloomPass.strength = v);
  f.add(proxy, 'Radius', 0, 1.5, 0.01).onChange(v => bloomPass.radius = v);
  f.add(proxy, 'Threshold', 0, 1.0, 0.01).onChange(v => bloomPass.threshold = v);
  f.close();
}

// ─── Loop ───────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
let rafId = null, intervalId = null;
function rafLoop() { rafId = requestAnimationFrame(rafLoop); tick(); }
function tick() {
  const t = clock.getElapsedTime();
  gradientPass.uniforms.uTime.value = t;
  videoPass.uniforms.uTime.value = t;
  blocksPass.uniforms.uTime.value = t;
  voronoiPass.uniforms.uTime.value = t;

  // Smooth cursor with momentum; remember previous for motion direction.
  mouseState.prev[0] = mouseState.smooth[0];
  mouseState.prev[1] = mouseState.smooth[1];
  const resp = mouseState.enabled ? (1 - mouseState.momentum) * 0.6 + 0.05 : 0;
  mouseState.smooth[0] += (mouseState.target[0] - mouseState.smooth[0]) * resp;
  mouseState.smooth[1] += (mouseState.target[1] - mouseState.smooth[1]) * resp;

  const act = (mouseState.enabled && mouseState.active) ? 1 : 0;
  // Shaders use UV space (y up); canvas y is down → flip y.
  const mx = mouseState.smooth[0], my = 1 - mouseState.smooth[1];
  const pmx = mouseState.prev[0], pmy = 1 - mouseState.prev[1];
  mousePass.uniforms.uActive.value = act;
  mousePass.uniforms.uMouse.value[0] = mx;     mousePass.uniforms.uMouse.value[1] = my;
  mousePass.uniforms.uPrevMouse.value[0] = pmx; mousePass.uniforms.uPrevMouse.value[1] = pmy;
  voronoiPass.uniforms.uActive.value = act;
  voronoiPass.uniforms.uMouse.value[0] = mx;   voronoiPass.uniforms.uMouse.value[1] = my;

  // Optional glyph grid drift from cursor.
  if (mouseState.enabled && mouseState.glyphDrift > 0) {
    glyphPass.uniforms.uPos.value[0] = glyphBasePos[0] + (mouseState.smooth[0] - 0.5) * mouseState.glyphDrift;
    glyphPass.uniforms.uPos.value[1] = glyphBasePos[1] + (mouseState.smooth[1] - 0.5) * mouseState.glyphDrift;
  } else {
    glyphPass.uniforms.uPos.value[0] = glyphBasePos[0];
    glyphPass.uniforms.uPos.value[1] = glyphBasePos[1];
  }

  blobPass.tick();
  composer.render();
}
function startLoop() {
  if (document.hidden) {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    if (intervalId === null) intervalId = setInterval(tick, 66);
  } else {
    if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
    if (rafId === null) rafLoop();
  }
}
document.addEventListener('visibilitychange', startLoop);
startLoop();
