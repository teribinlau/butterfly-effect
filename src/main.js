// main.js — wires renderer, composer, passes, GUI.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import GUI from 'lil-gui';

import { createVideo } from './ui/uploader.js';
import { createVideoPass } from './passes/videoPass.js';
import { createBlocksPass, BlendModes } from './passes/blocksPass.js';
import { createGlyphDitherPass, GlyphPresets } from './passes/glyphDitherPass.js';
import {
  createBlobTrackingPass,
  ConnectorTypes, ConnectorStrokes,
} from './passes/blobTrackingPass.js';

const DEFAULT_VIDEO = 'https://firebasestorage.googleapis.com/v0/b/unicorn-studio.appspot.com/o/Kv99pomh5sZiukPlOYkhXn2Ct6l2%2Fremix_grok-video-392f6cc9-cd51-4cd7-b78f-f9ff2c873fc2%20(1).mp4?alt=media';

// ─── Renderer ───────────────────────────────────────────────────────────────
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// EffectComposer needs *something* renderable on the first pass; we use a no-op
// RenderPass that just clears.  Subsequent ShaderPasses build the picture.
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
renderPass.clear = true;
composer.addPass(renderPass);

// ─── Video ──────────────────────────────────────────────────────────────────
let videoAspect = 1;
const video = createVideo(DEFAULT_VIDEO, (v) => {
  videoAspect = v.videoWidth / v.videoHeight || 1;
  videoPass.uniforms.uVideoAspect.value = videoAspect;
});
const videoTex = new THREE.VideoTexture(video);
// Mark video as sRGB so three's GLSL3 path auto-decodes texture() reads to linear.
// OutputPass at the end re-encodes back to sRGB for the screen.
videoTex.colorSpace = THREE.SRGBColorSpace;
videoTex.minFilter = THREE.LinearFilter;
videoTex.magFilter = THREE.LinearFilter;
videoTex.generateMipmaps = false;

// ─── Passes ─────────────────────────────────────────────────────────────────
const videoPass = createVideoPass();
videoPass.uniforms.tVideo.value = videoTex;
composer.addPass(videoPass);

const blocksPass = createBlocksPass();
composer.addPass(blocksPass);

const glyphPass = createGlyphDitherPass('█▓▒░ ');
composer.addPass(glyphPass);

const blobPass = createBlobTrackingPass(video);
composer.addPass(blobPass);

const bloomPass = new UnrealBloomPass(new THREE.Vector2(1024, 1024), 0.9, 0.5, 0.4);
composer.addPass(bloomPass);

// Final sRGB conversion + tone-map. Without this, the linear-space chain renders dark.
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
  videoPass.uniforms.uOutAspect.value = res[0] / res[1];
  blocksPass.uniforms.uResolution.value = res;
  glyphPass.uniforms.uResolution.value = res;
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

// — Video folder
{
  const f = gui.addFolder('Video');
  const u = videoPass.uniforms;
  const proxy = {
    'Fit to canvas': true,
    'Position X':    u.uPos.value[0] * 100,
    'Position Y':    u.uPos.value[1] * 100,
    'Scale':         140,
    'Rotation':      0,
    'Opacity':       100,
    'Displace':      0,
    'Exposure':      0,    // stops
    'Saturation':    172,
    'Contrast':      200,
    'Speed':         100,
    'Loop':          true,
    'Flip X':        false,
    'Flip Y':        false,
  };
  f.add(proxy, 'Fit to canvas').onChange(v => u.uFit.value = v ? 1 : 0);
  f.add(proxy, 'Flip X').onChange(v => u.uFlipX.value = v ? 1 : 0);
  f.add(proxy, 'Flip Y').onChange(v => u.uFlipY.value = v ? 1 : 0);
  f.add(proxy, 'Position X', 0, 100, 0.1).onChange(v => u.uPos.value[0] = v / 100);
  f.add(proxy, 'Position Y', 0, 100, 0.1).onChange(v => u.uPos.value[1] = v / 100);
  f.add(proxy, 'Scale',     10, 300, 1).onChange(v => u.uScale.value = v / 100);
  f.add(proxy, 'Rotation', -180, 180, 1).onChange(v => u.uRot.value = v * Math.PI / 180);
  f.add(proxy, 'Opacity',     0, 100, 1).onChange(v => u.uOpacity.value = v / 100);
  f.add(proxy, 'Displace',    0, 100, 1).onChange(v => u.uDisplace.value = v / 100);
  f.add(proxy, 'Exposure',   -3,   3, 0.05).onChange(v => u.uExposureStops.value = v);
  f.add(proxy, 'Saturation',  0, 300, 1).onChange(v => u.uSat.value = v / 100);
  f.add(proxy, 'Contrast',    0, 400, 1).onChange(v => u.uContrast.value = v / 100);
  f.add(proxy, 'Speed',      10, 300, 1).onChange(v => video.playbackRate = v / 100);
  f.add(proxy, 'Loop').onChange(v => video.loop = v);
}

// — Blocks folder
{
  const f = gui.addFolder('Blocks');
  const u = blocksPass.uniforms;
  const proxy = {
    'Color 1': '#7E90FF',
    'Color 2': '#D9F4FF',
    'Depth blur':  45,    // not wired (Flat-only mode) but kept for parity
    'Density':     17,
    'Size':       -10,
    'Spread':      64,
    'Variance':    58,
    'Skew':       100,
    'Angle':        0,
    'Opacity':     61,
    'Speed':       50,
    'Blend mode': 'Difference',
  };
  f.addColor(proxy, 'Color 1').onChange(v => u.uColor1.value.set(v));
  f.addColor(proxy, 'Color 2').onChange(v => u.uColor2.value.set(v));
  f.add(proxy, 'Depth blur', 0, 100, 1);            // placeholder (Flat mode ignores)
  f.add(proxy, 'Density',    2, 200, 1).onChange(v => u.uDensity.value  = v);
  f.add(proxy, 'Size',    -100, 100, 1).onChange(v => u.uSize.value     = v);
  f.add(proxy, 'Spread',     0, 100, 1).onChange(v => u.uSpread.value   = v);
  f.add(proxy, 'Variance',   0, 100, 1).onChange(v => u.uVariance.value = v);
  f.add(proxy, 'Skew',    -200, 200, 1).onChange(v => u.uSkew.value     = v);
  f.add(proxy, 'Angle',   -180, 180, 1).onChange(v => u.uAngle.value    = v);
  f.add(proxy, 'Opacity',    0, 100, 1).onChange(v => u.uOpacity.value  = v / 100);
  f.add(proxy, 'Speed',      0, 200, 1).onChange(v => u.uSpeed.value    = v / 100);
  f.add(proxy, 'Blend mode', BlendModes).onChange(v => u.uBlend.value = BlendModes.indexOf(v));
  // Set defaults
  u.uColor1.value.set(proxy['Color 1']);
  u.uColor2.value.set(proxy['Color 2']);
  u.uDensity.value  = proxy.Density;
  u.uSize.value     = proxy.Size;
  u.uSpread.value   = proxy.Spread;
  u.uVariance.value = proxy.Variance;
  u.uSkew.value     = proxy.Skew;
  u.uAngle.value    = proxy.Angle;
  u.uOpacity.value  = proxy.Opacity / 100;
  u.uSpeed.value    = proxy.Speed / 100;
  u.uBlend.value    = BlendModes.indexOf(proxy['Blend mode']);
}

// Base sub-tile pos for the glyph grid (mouse drift is added in tick()).
// Hoisted out of the GUI block so the Position sliders and the cursor handler
// both write here — tick() is the single writer of glyphPass.uniforms.uPos.
const glyphBasePos = [0.5, 0.5];

// — Glyph Dither folder
{
  const f = gui.addFolder('Glyph Dither');
  const u = glyphPass.uniforms;
  const proxy = {
    'Position X': 50,
    'Position Y': 50,
    'Preset':     'Redacted',
    'Characters': '█▓▒░ ',
    'Scale':      100,    // → mapped to 6..80 px tile
    'Gamma':      53,     // → mapped to 0.3..3
    'Phase':      0,      // 0..100
    'Mix':        74,
    'Color mode': 'Monochrome',
    'Background': true,
    'Color':      '#2D4DFF',
    'Opacity':    100,
    'Invert order': false,
  };
  // Helpers
  //  - Scale: 0→4px (ultra-dense, ~270 cells across 1080), 50→52px (~21 cells), 100→100px (~11 cells, very chunky)
  //  - Gamma: 0→0.4 (push toward dark glyphs), 50→1.0 (linear), 100→2.0 (push toward light glyphs)
  const scaleMap = (v) => 4 + (v / 100) * 96;
  const gammaMap = (v) => 0.4 + (v / 100) * 1.6;

  f.add(proxy, 'Position X', 0, 100, 0.1).onChange(v => glyphBasePos[0] = v / 100);
  f.add(proxy, 'Position Y', 0, 100, 0.1).onChange(v => glyphBasePos[1] = v / 100);
  f.add(proxy, 'Preset', Object.keys(GlyphPresets)).onChange(v => {
    proxy.Characters = GlyphPresets[v];
    charCtrl.updateDisplay();
    glyphPass.setCharacters(proxy.Characters);
  });
  const charCtrl = f.add(proxy, 'Characters').onChange(v => glyphPass.setCharacters(v));
  f.add(proxy, 'Scale',    0, 100, 1).onChange(v => u.uScale.value = scaleMap(v));
  f.add(proxy, 'Gamma',    0, 100, 1).onChange(v => u.uGamma.value = gammaMap(v));
  f.add(proxy, 'Phase',    0, 100, 1).onChange(v => u.uPhase.value = v / 100);
  f.add(proxy, 'Mix',      0, 100, 1).onChange(v => u.uMix.value   = v / 100);
  f.add(proxy, 'Color mode', ['Monochrome', 'Color']).onChange(v => u.uColorMode.value = v === 'Monochrome' ? 0 : 1);
  f.add(proxy, 'Background').onChange(v => u.uBackground.value = v ? 1 : 0);
  f.addColor(proxy, 'Color').onChange(v => u.uColor.value.set(v));
  f.add(proxy, 'Opacity',  0, 100, 1).onChange(v => u.uOpacity.value = v / 100);
  f.add(proxy, 'Invert order').onChange(v => u.uInvert.value = v ? 1 : 0);
  // Apply defaults
  u.uScale.value     = scaleMap(proxy.Scale);
  u.uGamma.value     = gammaMap(proxy.Gamma);
  u.uMix.value       = proxy.Mix / 100;
  u.uColor.value.set(proxy.Color);
  u.uBackground.value = proxy.Background ? 1 : 0;
}

// — Blob Tracking folder
{
  const f = gui.addFolder('Blob Tracking');
  const u = blobPass.uniforms;
  const p = blobPass.detectParams;
  const proxy = {
    'Max blobs': 16,
    'Mix': 100,
    'Blend mode': 'SoftLight',
    'Background': true,
    'Smoothing':  66,
    'Threshold':  36,
    'Persistence': 1,
    'Size': 62,            // 0..100 → 0..0.08 UV
    'Fill': 99,            // 0..100
    'Color': '#FFFFFF',
    'Line width': 29,      // 0..100 → 0..0.02 UV
    'Connector': 'Loop Straight',
    'Stroke':    'Dotted',
    'Max distance': 150,   // 0..300 → 0..1 UV
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
  f.add(proxy, 'Stroke',    ConnectorStrokes).onChange(v => u.uStrokeStyle.value = ConnectorStrokes.indexOf(v));
  f.add(proxy, 'Max distance', 0, 300, 1).onChange(v => u.uMaxDistance.value = v / 300);
  // Apply defaults
  p.maxBlobs = proxy['Max blobs'];
  p.smoothing = proxy.Smoothing / 100;
  p.threshold = proxy.Threshold / 100;
  p.persistence = proxy.Persistence;
  u.uMix.value = proxy.Mix / 100;
  u.uBlend.value = BlendModes.indexOf(proxy['Blend mode']);
  u.uHasBackground.value = proxy.Background ? 1 : 0;
  u.uSize.value = proxy.Size / 100 * 0.08;
  u.uFill.value = proxy.Fill / 100;
  u.uColor.value.set(proxy.Color);
  u.uLineWidth.value = proxy['Line width'] / 100 * 0.02;
  u.uConnectorType.value = ConnectorTypes.indexOf(proxy.Connector);
  u.uStrokeStyle.value = ConnectorStrokes.indexOf(proxy.Stroke);
  u.uMaxDistance.value = proxy['Max distance'] / 300;
  f.close();
}

// — Interactivity folder (mouse) ──────────────────────────────────────────────
// Tracks the cursor over the canvas, smooths with a critically-damped spring,
// and pushes the smoothed position to two uniforms:
//   • videoPass.uMouse      → radial UV warp around cursor (suction/push)
//   • glyphPass.uMousePos   → optional sub-tile drift of the glyph grid
const mouseState = {
  enabled: true,        // master toggle
  target: [0.5, 0.5],   // raw cursor in UV space
  smooth: [0.5, 0.5],   // EMA-smoothed
  active: 0,            // 1 while cursor is over canvas
  spring: 0.18,         // 0..1, higher = snappier (less lag)
  videoStrength: 0.35,  // radial warp amount on videoPass
  videoRadius: 0.30,    // UV radius of warp
  glyphDrift: 0.40,     // 0..1, how much cursor offsets the glyph sub-tile pos
};
function setMousePosFromEvent(e) {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top)  / r.height;
  mouseState.target[0] = Math.max(0, Math.min(1, x));
  mouseState.target[1] = Math.max(0, Math.min(1, y));
}
canvas.addEventListener('pointermove', (e) => {
  setMousePosFromEvent(e);
  mouseState.active = 1;
});
canvas.addEventListener('pointerenter', () => { mouseState.active = 1; });
canvas.addEventListener('pointerleave', () => { mouseState.active = 0; });
{
  const f = gui.addFolder('Interactivity');
  f.add(mouseState, 'enabled').name('Track mouse');
  f.add(mouseState, 'spring',         0, 1, 0.01).name('Spring (snap)');
  f.add(mouseState, 'videoStrength', -1, 1, 0.01).name('Video warp');
  f.add(mouseState, 'videoRadius',    0.05, 1, 0.01).name('Warp radius');
  f.add(mouseState, 'glyphDrift',     0, 1, 0.01).name('Glyph drift');
}

// — Fast Bloom folder
{
  const f = gui.addFolder('Fast Bloom');
  const proxy = { Strength: 0.9, Radius: 0.5, Threshold: 0.4 };
  f.add(proxy, 'Strength',  0, 3,    0.01).onChange(v => bloomPass.strength = v);
  f.add(proxy, 'Radius',    0, 1.5,  0.01).onChange(v => bloomPass.radius   = v);
  f.add(proxy, 'Threshold', 0, 1.0,  0.01).onChange(v => bloomPass.threshold = v);
}

// ─── Loop ───────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
// Visibility-resilient loop: requestAnimationFrame when visible (60fps, vsync-aligned),
// setTimeout fallback when hidden (15fps, so background tabs still process the video).
let rafId = null, intervalId = null;
function rafLoop() {
  rafId = requestAnimationFrame(rafLoop);
  tick();
}
function tick() {
  const t = clock.getElapsedTime();
  videoPass.uniforms.uTime.value = t;
  blocksPass.uniforms.uTime.value = t;

  // Spring-smooth the cursor (EMA) and push to the relevant uniforms.
  const a = mouseState.enabled ? mouseState.spring : 0;
  mouseState.smooth[0] += (mouseState.target[0] - mouseState.smooth[0]) * a;
  mouseState.smooth[1] += (mouseState.target[1] - mouseState.smooth[1]) * a;

  // Video warp uniforms
  videoPass.uniforms.uMouse.value[0]    = mouseState.smooth[0];
  videoPass.uniforms.uMouse.value[1]    = mouseState.smooth[1];
  videoPass.uniforms.uMouseActive.value = (mouseState.enabled && mouseState.active) ? 1 : 0;
  videoPass.uniforms.uMouseStrength.value = mouseState.enabled ? mouseState.videoStrength : 0;
  videoPass.uniforms.uMouseRadius.value   = mouseState.videoRadius;

  // Glyph sub-tile drift — offset from base 0.5,0.5 by smoothed cursor offset.
  if (mouseState.enabled && mouseState.glyphDrift > 0) {
    const dx = (mouseState.smooth[0] - 0.5) * mouseState.glyphDrift;
    const dy = (mouseState.smooth[1] - 0.5) * mouseState.glyphDrift;
    glyphPass.uniforms.uPos.value[0] = glyphBasePos[0] + dx;
    glyphPass.uniforms.uPos.value[1] = glyphBasePos[1] + dy;
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
