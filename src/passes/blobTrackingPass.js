// blobTrackingPass.js — analyzes the raw video on CPU (downsampled), tracks N brightest
// connected components frame-to-frame with EMA smoothing, then draws dots + connectors
// in the fragment shader.

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BlendModes } from './blocksPass.js';

const MAX_BLOBS = 16;
const ANALYSIS_SIZE = 96;

// — Simplified 2-pass connected-component labeling on a binary 96×96 grid —
// Returns array of { x, y, area } in 0..1 UV space.
function detectBlobs(binary, w, h, maxOut) {
  const labels = new Int32Array(w * h);
  const parent = [0];
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };

  let next = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!binary[i]) continue;
      const left = x > 0 ? labels[i - 1] : 0;
      const up   = y > 0 ? labels[i - w] : 0;
      if (left === 0 && up === 0) {
        labels[i] = next;
        parent[next] = next;
        next++;
      } else if (left !== 0 && up !== 0) {
        const m = Math.min(left, up);
        labels[i] = m;
        union(left, up);
      } else {
        labels[i] = left || up;
      }
    }
  }

  // Resolve and accumulate
  const acc = new Map();   // root → { sx, sy, n }
  for (let i = 0; i < labels.length; i++) {
    const L = labels[i];
    if (!L) continue;
    const r = find(L);
    const x = i % w, y = Math.floor(i / w);
    let b = acc.get(r);
    if (!b) { b = { sx: 0, sy: 0, n: 0 }; acc.set(r, b); }
    b.sx += x; b.sy += y; b.n++;
  }

  // Filter by area: drop single-pixel noise, drop sky-sized regions that swallow the frame.
  // Sort by area desc, keep top N.
  const total = w * h;
  const minArea = 8;                  // ≥ 8 px to count as a blob (kills speckle)
  const maxArea = total * 0.20;       // ≤ 20% of frame (kills sky/wall fills)
  const blobs = [];
  for (const b of acc.values()) {
    if (b.n < minArea || b.n > maxArea) continue;
    blobs.push({ x: (b.sx / b.n) / w, y: (b.sy / b.n) / h, area: b.n });
  }
  blobs.sort((a, b) => b.area - a.area);
  return blobs.slice(0, maxOut);
}

// Greedy nearest-neighbor matching from current → tracked.
function trackBlobs(tracked, current, smoothing01, persistence) {
  // smoothing01: 0 = no smoothing, 1 = no movement
  const used = new Array(current.length).fill(false);
  // Match each tracked blob to nearest unused current blob.
  for (const t of tracked) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < current.length; i++) {
      if (used[i]) continue;
      const dx = current[i].x - t.x, dy = current[i].y - t.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0 && bestD < 0.04) {     // ~20% screen radius cap
      used[best] = true;
      const c = current[best];
      t.x = t.x * smoothing01 + c.x * (1 - smoothing01);
      t.y = t.y * smoothing01 + c.y * (1 - smoothing01);
      t.area = t.area * smoothing01 + c.area * (1 - smoothing01);
      t.missed = 0;
      t.alive = true;
    } else {
      t.missed = (t.missed || 0) + 1;
      if (t.missed > persistence) t.alive = false;
    }
  }
  // Append unmatched current blobs as new tracks (if room).
  let id = tracked.length;
  for (let i = 0; i < current.length; i++) {
    if (used[i]) continue;
    tracked.push({ id: id++, x: current[i].x, y: current[i].y, area: current[i].area, missed: 0, alive: true });
  }
  // Filter dead.
  return tracked.filter(t => t.alive);
}

export const ConnectorTypes = ['None', 'Loop Straight'];
export const ConnectorStrokes = ['Solid', 'Dashed', 'Dotted'];

export const BlobTrackingShader = {
  uniforms: {
    tDiffuse:      { value: null },
    uResolution:   { value: [1, 1] },

    uBlobs:        { value: new Array(MAX_BLOBS).fill(0).map(() => new THREE.Vector4(0, 0, 0, 0)) },
    uNumBlobs:     { value: 0 },

    uMix:          { value: 1.0 },
    uBlend:        { value: 4 },                     // default Soft Light
    uHasBackground:{ value: 1 },                     // background tint
    uBgColor:      { value: new THREE.Color('#7E90FF') },
    uColor:        { value: new THREE.Color('#FFFFFF') },
    uSize:         { value: 0.04 },                  // dot radius in UV
    uFill:         { value: 0.99 },                  // 0..1, 1 = filled, 0 = ring
    uLineWidth:    { value: 0.005 },                 // UV
    uConnectorType:{ value: 1 },                     // 0 none, 1 loop
    uStrokeStyle:  { value: 2 },                     // 0 solid 1 dashed 2 dotted
    uMaxDistance:  { value: 0.4 },                   // UV
  },

  vertexShader: /* glsl */`
    out vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */`
    precision highp float;
    in  vec2 vUv;
    out vec4 outColor;

    #define MAX_BLOBS 16

    uniform sampler2D tDiffuse;
    uniform vec2  uResolution;
    uniform vec4  uBlobs[MAX_BLOBS];   // xy = pos UV, z = area (0..1), w = alive
    uniform int   uNumBlobs;

    uniform float uMix, uSize, uFill, uLineWidth, uMaxDistance;
    uniform int   uBlend, uHasBackground, uConnectorType, uStrokeStyle;
    uniform vec3  uBgColor, uColor;

    vec3 blendNormal     (vec3 d, vec3 s) { return s; }
    vec3 blendDifference (vec3 d, vec3 s) { return abs(d - s); }
    vec3 blendMultiply   (vec3 d, vec3 s) { return d * s; }
    vec3 blendScreen     (vec3 d, vec3 s) { return 1.0 - (1.0 - d) * (1.0 - s); }
    vec3 blendSoftLight  (vec3 d, vec3 s) {
      return mix(2.0 * d * s + d * d * (1.0 - 2.0 * s),
                 sqrt(d) * (2.0 * s - 1.0) + 2.0 * d * (1.0 - s),
                 step(0.5, s));
    }

    // Distance from p to segment ab
    float sdSegment(vec2 p, vec2 a, vec2 b) {
      vec2 pa = p - a, ba = b - a;
      float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
      return length(pa - ba * h);
    }

    // Project p onto segment ab → returns t in [0,1]
    float projT(vec2 p, vec2 a, vec2 b) {
      vec2 pa = p - a, ba = b - a;
      return clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    }

    void main() {
      vec3 prev = texture(tDiffuse, vUv).rgb;

      // Aspect-corrected fragment position (so circles stay circular)
      float ar = uResolution.x / uResolution.y;
      vec2 p = vec2(vUv.x * ar, vUv.y);

      float alpha = 0.0;

      // Dots
      float aa = 1.0 / uResolution.y;
      for (int i = 0; i < MAX_BLOBS; i++) {
        if (i >= uNumBlobs) break;
        vec4 B = uBlobs[i];
        if (B.w < 0.5) continue;
        vec2 bp = vec2(B.x * ar, B.y);
        float r = uSize * (0.7 + 0.6 * B.z);          // bigger blob → modestly larger dot
        float d = length(p - bp);
        float outerEdge = smoothstep(r + aa, r - aa, d);
        float innerEdge = smoothstep(r * (1.0 - uFill) + aa, r * (1.0 - uFill) - aa, d);
        // Fill==1 → solid disk; Fill==0 → ring of width uFill (here approximated)
        float dot_ = mix(outerEdge - innerEdge, outerEdge, uFill);
        alpha = max(alpha, dot_);
      }

      // Connectors (Loop Straight): connect i → i+1, wrap last → first.
      if (uConnectorType == 1) {
        for (int i = 0; i < MAX_BLOBS; i++) {
          if (i >= uNumBlobs) break;
          int j = (i + 1) >= uNumBlobs ? 0 : (i + 1);
          vec4 A = uBlobs[i];
          vec4 Bv = uBlobs[j];
          if (A.w < 0.5 || Bv.w < 0.5) continue;
          vec2 a = vec2(A.x * ar, A.y);
          vec2 b = vec2(Bv.x * ar, Bv.y);
          if (distance(a, b) > uMaxDistance * ar) continue;
          float d = sdSegment(p, a, b);
          float line = smoothstep(uLineWidth + aa, uLineWidth - aa, d);
          if (line > 0.0) {
            float t = projT(p, a, b);
            float L = distance(a, b);
            float pat = 1.0;
            if (uStrokeStyle == 1) {       // Dashed
              pat = step(0.5, fract(t * L * 40.0));
            } else if (uStrokeStyle == 2) {// Dotted
              pat = smoothstep(0.4, 0.5, sin(t * L * 80.0) * 0.5 + 0.5);
            }
            alpha = max(alpha, line * pat);
          }
        }
      }

      // Layer color: optional background tint mixed under the dots/lines
      vec3 layerCol = uColor;
      vec3 src = (uHasBackground == 1) ? mix(prev, prev * uBgColor * 1.6, 0.25) : prev;

      vec3 painted = mix(src, layerCol, alpha);

      vec3 blended;
      if      (uBlend == 0) blended = blendNormal     (prev, painted);
      else if (uBlend == 1) blended = blendDifference (prev, painted);
      else if (uBlend == 2) blended = blendMultiply   (prev, painted);
      else if (uBlend == 3) blended = blendScreen     (prev, painted);
      else                  blended = blendSoftLight  (prev, painted);

      outColor = vec4(mix(prev, blended, uMix), 1.0);
    }
  `,
};

export function createBlobTrackingPass(videoEl) {
  const pass = new ShaderPass(BlobTrackingShader);
  pass.material.glslVersion = THREE.GLSL3;

  // Scratch canvas for downsampled analysis
  const analysisCanvas = document.createElement('canvas');
  analysisCanvas.width = ANALYSIS_SIZE;
  analysisCanvas.height = ANALYSIS_SIZE;
  const actx = analysisCanvas.getContext('2d', { willReadFrequently: true });

  let tracked = [];
  let frameSkip = 0;

  // Tunable knobs piped in from GUI (the shader uniforms are direct, but these affect detection)
  pass.detectParams = {
    threshold: 0.36,    // 0..1
    smoothing: 0.66,    // 0..1
    persistence: 1,     // frames
    maxBlobs: MAX_BLOBS,
    skipFrames: 0,      // run every Nth frame; 0 = every frame
  };

  pass.tick = () => {
    if (!videoEl || videoEl.readyState < 2) return;
    if (pass.detectParams.skipFrames > 0) {
      if (++frameSkip % (pass.detectParams.skipFrames + 1) !== 0) return;
    }

    // Downsample video → grayscale → threshold
    actx.drawImage(videoEl, 0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
    const data = actx.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE).data;
    const binary = new Uint8Array(ANALYSIS_SIZE * ANALYSIS_SIZE);
    const T = pass.detectParams.threshold * 255;
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      // luminance
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      binary[j] = lum > T ? 1 : 0;
    }
    const found = detectBlobs(binary, ANALYSIS_SIZE, ANALYSIS_SIZE, pass.detectParams.maxBlobs);
    tracked = trackBlobs(tracked, found, pass.detectParams.smoothing, pass.detectParams.persistence);

    // Push to uniform
    const uBlobs = pass.uniforms.uBlobs.value;
    const N = Math.min(tracked.length, MAX_BLOBS);
    for (let i = 0; i < MAX_BLOBS; i++) {
      if (i < N) {
        const t = tracked[i];
        // Normalize area so a ~200 px blob → 1.0 (typical mid-size feature).
        // Keeps dot scaling sensible across small and large blobs.
        uBlobs[i].set(t.x, 1 - t.y, Math.min(1, t.area / 200), 1);
      } else {
        uBlobs[i].set(0, 0, 0, 0);
      }
    }
    pass.uniforms.uNumBlobs.value = N;
  };

  return pass;
}

export { BlendModes };
