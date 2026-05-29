// voronoiPass.js — L4 voronoi (Unicorn type=voronoi, speed 0.12).
// The real layer distorts the image with an animated voronoi field in a radius
// around the cursor (observed behavior; reimplemented independently). With no
// cursor it can also apply a gentle full-frame voronoi warp (uGlobal).

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const VoronoiShader = {
  uniforms: {
    tDiffuse:    { value: null },
    uResolution: { value: [1, 1] },
    uTime:       { value: 0 },
    uMouse:      { value: [0.5, 0.5] },
    uActive:     { value: 0 },
    uScale:      { value: 18.0 },    // voronoi cell frequency
    uStrength:   { value: 0.5 },     // distortion amount
    uRadius:     { value: 0.45 },    // influence radius around cursor
    uSpeed:      { value: 0.12 },
    uGlobal:     { value: 0.0 },     // 0..1 full-frame warp regardless of cursor
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
    uniform vec2  uResolution, uMouse;
    uniform float uTime, uActive, uScale, uStrength, uRadius, uSpeed, uGlobal;

    vec2 random2(vec2 p){ return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453); }

    // Returns the offset toward the nearest animated cell point (the warp vector).
    vec2 voronoiOffset(vec2 st){
      vec2 i_st = floor(st), f_st = fract(st);
      float best = 8.0; vec2 bestDiff = vec2(0.0);
      for (int j=-1;j<=1;j++){
        for (int i=-1;i<=1;i++){
          vec2 nb = vec2(float(i), float(j));
          vec2 pt = random2(i_st + nb);
          pt = 0.5 + 0.5 * sin(uTime * uSpeed * 6.2831 + 6.2831 * pt);
          vec2 diff = nb + pt - f_st;
          float d = dot(diff, diff);
          if (d < best){ best = d; bestDiff = diff; }
        }
      }
      return bestDiff;
    }

    void main(){
      float ar = uResolution.x / uResolution.y;
      vec2 p = vec2(vUv.x * ar, vUv.y);
      vec2 m = vec2(uMouse.x * ar, uMouse.y);

      float infl = uGlobal;
      if (uActive > 0.5) {
        float d = distance(p, m);
        infl = max(infl, 1.0 - smoothstep(0.0, uRadius, d));
      }
      if (infl < 0.001) { outColor = vec4(texture(tDiffuse, vUv).rgb, 1.0); return; }

      vec2 off = voronoiOffset(p * uScale);
      vec2 uv = vUv + off * uStrength * 0.04 * infl;
      outColor = vec4(texture(tDiffuse, uv).rgb, 1.0);
    }
  `,
};

export function createVoronoiPass() {
  const pass = new ShaderPass(VoronoiShader);
  pass.material.glslVersion = THREE.GLSL3;
  return pass;
}
