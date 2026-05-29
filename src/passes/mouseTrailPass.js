// mouseTrailPass.js — L5 mouse layer (Unicorn type=mouse, mouseMomentum 0.29).
// The real layer is a cursor-driven LIQUID distortion of the image with chromatic
// aberration (observed behavior; implemented independently — no Unicorn code copied).
// Here: displace the image toward the cursor's motion within a radius, and split
// R/B channels along the motion direction for the chromatic-aberration look.

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const MouseTrailShader = {
  uniforms: {
    tDiffuse:    { value: null },
    uResolution: { value: [1, 1] },
    uMouse:      { value: [0.5, 0.5] },
    uPrevMouse:  { value: [0.5, 0.5] },
    uActive:     { value: 0 },
    uStrength:   { value: 0.5 },     // displacement amount
    uRadius:     { value: 0.35 },    // UV radius of influence
    uChroma:     { value: 0.5 },     // chromatic aberration amount
  },

  vertexShader: /* glsl */`
    out vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
  `,

  fragmentShader: /* glsl */`
    precision highp float;
    in  vec2 vUv;
    out vec4 outColor;
    uniform sampler2D tDiffuse;
    uniform vec2  uResolution, uMouse, uPrevMouse;
    uniform float uActive, uStrength, uRadius, uChroma;

    void main() {
      if (uActive < 0.5) { outColor = vec4(texture(tDiffuse, vUv).rgb, 1.0); return; }

      float ar = uResolution.x / uResolution.y;
      vec2 p  = vec2(vUv.x * ar, vUv.y);
      vec2 m  = vec2(uMouse.x * ar, uMouse.y);
      vec2 mv = (uMouse - uPrevMouse);                 // motion this frame
      vec2 dir = length(mv) > 1e-5 ? normalize(mv) : vec2(0.0);

      float d = distance(p, m);
      float fall = 1.0 - smoothstep(0.0, uRadius, d);
      fall *= fall;

      vec2 disp = dir * fall * uStrength * 0.15;
      vec2 cab  = dir * fall * uChroma * 0.02;

      vec2 uv = vUv - disp;
      float r = texture(tDiffuse, uv - cab).r;
      float g = texture(tDiffuse, uv).g;
      float b = texture(tDiffuse, uv + cab).b;
      outColor = vec4(r, g, b, 1.0);
    }
  `,
};

export function createMouseTrailPass() {
  const pass = new ShaderPass(MouseTrailShader);
  pass.material.glslVersion = THREE.GLSL3;
  return pass;
}
