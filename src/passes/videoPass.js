// videoPass.js — first pass in the chain. Reads the shared video texture (NOT tDiffuse),
// applies Position/Scale/Rotation/Opacity/Displace + Exposure/Saturation/Contrast.
// Output is RGBA in [0,1].

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const VideoShader = {
  uniforms: {
    tVideo:        { value: null },
    uVideoAspect:  { value: 1 },        // videoWidth / videoHeight
    uOutAspect:    { value: 1 },        // canvasWidth / canvasHeight
    uFit:          { value: 1 },        // 1 = fit-to-canvas (stretch fill), 0 = contain
    uPos:          { value: [0.5, 0.5] },// 0..1
    uScale:        { value: 1.4 },      // unicorn UI uses 140 → here 1.4
    uRot:          { value: 0 },        // radians
    uOpacity:      { value: 1 },
    uDisplace:     { value: 0 },        // 0..1, simple radial wobble
    uTime:         { value: 0 },
    uExposure:     { value: 2.0 },      // linear multiplier (Unicorn "Exposure")
    uSat:          { value: 1.72 },
    uContrast:     { value: 2.0 },
    uFlipX:        { value: 0 },        // 0 = normal, 1 = horizontal flip
    uFlipY:        { value: 0 },        // 0 = normal, 1 = vertical flip

    // Mouse interactivity — smoothed cursor in UV space + warp strength/radius
    uMouse:        { value: [0.5, 0.5] },
    uMouseActive:  { value: 0 },        // 1 = cursor over canvas, 0 = off
    uMouseStrength:{ value: 0.0 },      // 0..1, radial displacement amount
    uMouseRadius:  { value: 0.25 },     // UV radius of influence
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

    uniform sampler2D tVideo;
    uniform float uVideoAspect, uOutAspect, uFit;
    uniform vec2  uPos;
    uniform float uScale, uRot, uOpacity, uDisplace, uTime;
    uniform float uExposure, uSat, uContrast;
    uniform float uFlipX, uFlipY;
    uniform vec2  uMouse;
    uniform float uMouseActive, uMouseStrength, uMouseRadius;

    vec2 rotate(vec2 p, float a) {
      float s = sin(a), c = cos(a);
      return mat2(c, -s, s, c) * p;
    }

    void main() {
      // Centered UV in [-0.5, 0.5]
      vec2 uv = vUv - 0.5;

      // Aspect-correct: when not "fit", crop/letterbox to preserve video aspect.
      // Otherwise stretch (do nothing extra).
      if (uFit < 0.5) {
        float ratio = uVideoAspect / uOutAspect;
        if (ratio > 1.0) uv.y *= ratio; else uv.x /= ratio;
      }

      // Transform: scale around center, rotate, then offset.
      uv /= uScale;
      uv  = rotate(uv, uRot);
      uv += vec2(uPos.x - 0.5, 0.5 - uPos.y);
      uv += 0.5;

      // Displace (subtle radial wobble; sourced from time)
      if (uDisplace > 0.0001) {
        float w = sin(uv.y * 50.0 + uTime * 2.0) * uDisplace * 0.02;
        uv.x += w;
      }

      // Mouse warp: push pixels away from / toward cursor with smooth falloff.
      // Positive Strength = pull pixels INTO cursor (suction); negative = push AWAY.
      if (uMouseActive > 0.5 && abs(uMouseStrength) > 0.0001) {
        vec2 toMouse = uv - uMouse;
        float d = length(toMouse);
        float falloff = 1.0 - smoothstep(0.0, uMouseRadius, d);
        // Quadratic ease for a more "magnetic" feel near the cursor.
        falloff *= falloff;
        uv -= normalize(toMouse + 1e-6) * falloff * uMouseStrength * uMouseRadius;
      }

      // Optional flips (GUI toggles)
      float sx = (uFlipX > 0.5) ? (1.0 - uv.x) : uv.x;
      float sy = (uFlipY > 0.5) ? (1.0 - uv.y) : uv.y;

      // Outside the frame → black
      vec3 rgb;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        rgb = vec3(0.0);
      } else {
        // VideoTexture has flipY=true by default — sample directly, no extra flip.
        rgb = texture(tVideo, vec2(sx, sy)).rgb;
      }

      // Exposure (linear multiplier)
      rgb *= uExposure;

      // Saturation around luma
      float luma = dot(rgb, vec3(0.299, 0.587, 0.114));
      rgb = mix(vec3(luma), rgb, uSat);

      // Contrast around 0.5
      rgb = (rgb - 0.5) * uContrast + 0.5;

      rgb = clamp(rgb, 0.0, 1.0);
      outColor = vec4(rgb * uOpacity, 1.0);
    }
  `,
};

export function createVideoPass() {
  const pass = new ShaderPass(VideoShader);
  pass.material.glslVersion = THREE.GLSL3;
  // ShaderPass auto-binds tDiffuse from prior pass — we ignore it.
  return pass;
}
