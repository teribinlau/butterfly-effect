// gradientPass.js — L0 background (Unicorn type=gradient, isBackground, speed 0.25).
// Animated flowing multi-color gradient. Ignores tDiffuse (it IS the base layer).
// Exact gradient colors weren't recoverable from the project JSON in this session,
// so defaults use the project's blue palette and are fully adjustable in the GUI.

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const GradientShader = {
  uniforms: {
    tDiffuse:    { value: null },        // ignored
    uResolution: { value: [1, 1] },
    uTime:       { value: 0 },
    uSpeed:      { value: 0.25 },
    uColorA:     { value: new THREE.Color('#070b1e') },  // deep
    uColorB:     { value: new THREE.Color('#2D4DFF') },  // mid (project blue)
    uColorC:     { value: new THREE.Color('#7E90FF') },  // light
    uScale:      { value: 1.4 },
  },

  vertexShader: /* glsl */`
    out vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
  `,

  fragmentShader: /* glsl */`
    precision highp float;
    in  vec2 vUv;
    out vec4 outColor;
    uniform vec2 uResolution;
    uniform float uTime, uSpeed, uScale;
    uniform vec3 uColorA, uColorB, uColorC;

    vec2 hash2(vec2 p){ p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))); return -1.+2.*fract(sin(p)*43758.5453); }
    float noise(vec2 p){ vec2 i=floor(p),f=fract(p); vec2 u=f*f*(3.-2.*f);
      return mix(mix(dot(hash2(i),f),dot(hash2(i+vec2(1,0)),f-vec2(1,0)),u.x),
                 mix(dot(hash2(i+vec2(0,1)),f-vec2(0,1)),dot(hash2(i+vec2(1,1)),f-vec2(1,1)),u.x),u.y); }
    float fbm(vec2 p){ float v=0.,a=.5; for(int i=0;i<4;i++){v+=a*noise(p);p*=2.;a*=.5;} return v; }

    void main(){
      float ar = uResolution.x / uResolution.y;
      vec2 p = vec2(vUv.x*ar, vUv.y) * uScale;
      float t = uTime * uSpeed;
      float n1 = fbm(p + vec2(0.0, t));
      float n2 = fbm(p*0.7 + vec2(t*0.6, -t*0.4) + 4.0);
      float a = clamp(n1*0.5 + 0.5, 0.0, 1.0);
      float b = clamp(n2*0.5 + 0.5, 0.0, 1.0);
      vec3 col = mix(uColorA, uColorB, smoothstep(0.2, 0.8, a));
      col = mix(col, uColorC, smoothstep(0.5, 1.0, b) * 0.6);
      outColor = vec4(col, 1.0);
    }
  `,
};

export function createGradientPass() {
  const pass = new ShaderPass(GradientShader);
  pass.material.glslVersion = THREE.GLSL3;
  return pass;
}
