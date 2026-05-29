// glyphDitherPass.js — the marquee effect.
// Bakes a monospace atlas of the Characters string into a CanvasTexture (rebakes on
// string change), then per fragment: identify its tile, compute the tile's mean
// luminance via a 4-tap box, index into the atlas by luminance, sample the glyph,
// composite with Mix / Color / Background, and optionally Screen-blend over the
// source (the Unicorn glyph layer uses a Screen-style blend).
//
// All glyphs are baked locally from Unicode characters — no third-party assets.

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// "Redacted" = Unicode block-shade ramp, reproducing the reference's look without
// bundling anyone else's atlas image.
export const GlyphPresets = {
  'Redacted':    '█▓▒░ ',
  'ASCII':       ' .:-=+*#%@',
  'Dense ASCII': ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
  'Dots':        ' .··•●',
  'Blocks':      ' ░▒▓█',
  'Code':        ' /\\<>{}[]()|;:.,',
};

// Cell tile size in atlas (px). Larger = sharper glyphs, more GPU memory.
const ATLAS_TILE = 64;

function bakeAtlas(chars) {
  const n = chars.length;
  const c = document.createElement('canvas');
  c.width  = ATLAS_TILE * n;
  c.height = ATLAS_TILE;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#fff';
  ctx.font = `${Math.round(ATLAS_TILE * 0.9)}px "Courier New", ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    ctx.fillText(chars[i], i * ATLAS_TILE + ATLAS_TILE / 2, ATLAS_TILE / 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export const GlyphDitherShader = {
  uniforms: {
    tDiffuse:    { value: null },
    uAtlas:      { value: null },
    uNumChars:   { value: 1 },
    uResolution: { value: [1, 1] },

    uPos:        { value: [0.5, 0.5] }, // sub-tile offset 0..1
    uScale:      { value: 12.0 },       // tile size in pixels
    uGamma:      { value: 0.53 },       // contrast curve
    uPhase:      { value: 0 },          // 0..1 atlas horiz shift
    uMix:        { value: 0.74 },       // 0..1 effect strength
    uColor:      { value: new THREE.Color('#2D4DFF') },
    uColorMode:  { value: 0 },          // 0 = Monochrome, 1 = Color
    uBackground: { value: 1 },          // 1 = solid bg behind glyph, 0 = source bg
    uInvert:     { value: 0 },          // invert luminance->glyph order
    uOpacity:    { value: 1.0 },        // overall layer opacity
    uBlend:      { value: 2 },          // 0 = Normal, 2 = Screen
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
    uniform sampler2D uAtlas;
    uniform float uNumChars;
    uniform vec2  uResolution;

    uniform vec2  uPos;
    uniform float uScale, uGamma, uPhase, uMix, uOpacity;
    uniform vec3  uColor;
    uniform int   uColorMode, uBackground, uInvert, uBlend;

    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    vec3 blendScreen(vec3 d, vec3 s) { return 1.0 - (1.0 - d) * (1.0 - s); }

    void main() {
      vec2 frag = vUv * uResolution;

      vec2 tileSize = vec2(max(2.0, uScale));
      vec2 offset = (uPos - 0.5) * tileSize;
      vec2 cell = floor((frag - offset) / tileSize);
      vec2 cellCenterPx = (cell + 0.5) * tileSize + offset;
      vec2 localPx = (frag - offset) - cell * tileSize;
      vec2 local = localPx / tileSize;

      vec2 cuv = cellCenterPx / uResolution;
      vec2 h = (tileSize * 0.25) / uResolution;
      vec3 src =
        ( texture(tDiffuse, cuv + vec2( h.x,  h.y)).rgb
        + texture(tDiffuse, cuv + vec2(-h.x,  h.y)).rgb
        + texture(tDiffuse, cuv + vec2( h.x, -h.y)).rgb
        + texture(tDiffuse, cuv + vec2(-h.x, -h.y)).rgb ) * 0.25;
      vec3 srcHere = texture(tDiffuse, vUv).rgb;

      float L = luma(src);
      L = pow(clamp(L, 0.0, 1.0), 1.0 / uGamma);
      if (uInvert == 1) L = 1.0 - L;

      float idx = clamp(floor(L * uNumChars), 0.0, uNumChars - 1.0);

      float u = (idx + fract(local.x + uPhase)) / uNumChars;
      float v = clamp(local.y, 0.0, 1.0);
      float g = texture(uAtlas, vec2(u, v)).r;     // grayscale glyph coverage

      vec3 fg = (uColorMode == 0) ? uColor : src;
      vec3 bg = (uBackground == 1) ? vec3(0.0) : srcHere;

      vec3 layer = mix(bg, fg, g);

      vec3 composited = (uBlend == 2) ? blendScreen(srcHere, layer) : layer;
      vec3 finalRGB = mix(srcHere, composited, uMix * uOpacity);

      outColor = vec4(finalRGB, 1.0);
    }
  `,
};

export function createGlyphDitherPass(initialChars = '█▓▒░ ') {
  const pass = new ShaderPass(GlyphDitherShader);
  pass.material.glslVersion = THREE.GLSL3;
  pass.uniforms.uAtlas.value = bakeAtlas(initialChars);
  pass.uniforms.uNumChars.value = initialChars.length;

  // Swap atlas when the Characters string changes from the GUI.
  pass.setCharacters = (chars) => {
    if (!chars || !chars.length) return;
    pass.uniforms.uAtlas.value?.dispose?.();
    pass.uniforms.uAtlas.value = bakeAtlas(chars);
    pass.uniforms.uNumChars.value = chars.length;
  };
  return pass;
}
