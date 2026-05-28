// blocksPass.js — procedural grid layer blended OVER the incoming pass (tDiffuse).
// Flat mode only (Circular/3D deferred). Default blend = Difference.

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Blend mode enum (must match GUI dropdown order)
export const BlendModes = ['Normal', 'Difference', 'Multiply', 'Screen', 'SoftLight'];

export const BlocksShader = {
  uniforms: {
    tDiffuse:    { value: null },
    uResolution: { value: [1, 1] },
    uTime:       { value: 0 },

    uColor1:     { value: new THREE.Color('#7E90FF') },
    uColor2:     { value: new THREE.Color('#D9F4FF') },
    uDensity:    { value: 17 },       // ≈ grid cells across the short axis
    uSize:       { value: -10 },      // -100..100; negative shrinks tile, positive grows
    uSpread:     { value: 64 },       // 0..100, falloff softness
    uVariance:   { value: 58 },       // 0..100, color/size jitter per cell
    uSkew:       { value: 100 },      // -200..200, shears the grid
    uAngle:      { value: 0 },        // degrees
    uOpacity:    { value: 0.61 },
    uSpeed:      { value: 0.5 },      // 0..1, animation speed
    uBlend:      { value: 1 },        // index into BlendModes
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

    uniform sampler2D tDiffuse;
    uniform vec2  uResolution;
    uniform float uTime;
    uniform vec3  uColor1, uColor2;
    uniform float uDensity, uSize, uSpread, uVariance, uSkew, uAngle, uOpacity, uSpeed;
    uniform int   uBlend;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 78.233);
      return fract(p.x * p.y);
    }

    // Blend helpers (s = source/blocks, d = destination/prev)
    vec3 blendNormal     (vec3 d, vec3 s) { return s; }
    vec3 blendDifference (vec3 d, vec3 s) { return abs(d - s); }
    vec3 blendMultiply   (vec3 d, vec3 s) { return d * s; }
    vec3 blendScreen     (vec3 d, vec3 s) { return 1.0 - (1.0 - d) * (1.0 - s); }
    vec3 blendSoftLight  (vec3 d, vec3 s) {
      return mix(2.0 * d * s + d * d * (1.0 - 2.0 * s),
                 sqrt(d) * (2.0 * s - 1.0) + 2.0 * d * (1.0 - s),
                 step(0.5, s));
    }

    void main() {
      vec3 prev = texture(tDiffuse, vUv).rgb;

      // Centered, aspect-correct UV
      vec2 uv = vUv - 0.5;
      uv.x *= uResolution.x / uResolution.y;

      // Rotate + skew
      float ang = radians(uAngle);
      mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
      uv = R * uv;
      uv.x += uv.y * (uSkew / 200.0);

      // Grid: density cells across.
      float density = max(2.0, uDensity);
      vec2 cell = floor(uv * density);
      vec2 inCell = fract(uv * density) - 0.5;

      // Per-cell randomness
      float r = hash(cell + floor(uTime * uSpeed));
      float r2 = hash(cell + 19.0);

      // Variance pushes some cells off and recolors them.
      float live = step(uVariance / 100.0, r2 * 0.9 + 0.1);

      // Tile shape: square SDF inflated by uSize, softened by uSpread.
      float halfSide = 0.5 + (uSize / 200.0);     // -1..1.5 range
      halfSide = clamp(halfSide, 0.05, 1.5);
      vec2 d2 = abs(inCell) - vec2(halfSide);
      float sd = max(d2.x, d2.y);                  // <0 inside
      // Spread = soft-edge width in cell-fraction units, capped to keep tiles square-shaped
      // not blobby. At 100, edge fades over ~10% of a cell — visible but still readable as a grid.
      float aa = max(0.002, uSpread / 100.0 * 0.1);
      float mask = 1.0 - smoothstep(-aa, aa, sd);

      // Color: lerp Color1↔Color2 by per-cell random (Variance-driven)
      vec3 col = mix(uColor1, uColor2, r);
      vec3 blocks = col * mask * live;

      // Blend
      vec3 blended;
      if      (uBlend == 0) blended = blendNormal     (prev, blocks);
      else if (uBlend == 1) blended = blendDifference (prev, blocks);
      else if (uBlend == 2) blended = blendMultiply   (prev, blocks);
      else if (uBlend == 3) blended = blendScreen     (prev, blocks);
      else                  blended = blendSoftLight  (prev, blocks);

      // Mix-back by opacity
      outColor = vec4(mix(prev, blended, uOpacity), 1.0);
    }
  `,
};

export function createBlocksPass() {
  const pass = new ShaderPass(BlocksShader);
  pass.material.glslVersion = THREE.GLSL3;
  return pass;
}
