/**
 * Final colour grade: gentle warm split-toning, contrast curve, vignette,
 * film grain and a red "danger" tint used when the demons are close.
 */
export const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.035 },
    uDanger: { value: 0 },
    uSaturation: { value: 1.08 },
    uFade: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uDanger;
    uniform float uSaturation;
    uniform float uFade;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p.yx + 19.19);
      return fract((p.x + p.y) * p.x);
    }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;

      // Saturation
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);

      // Split toning: warm highlights, teal-ish shadows
      vec3 shadowTint = vec3(0.92, 1.0, 1.04);
      vec3 highTint = vec3(1.05, 1.0, 0.92);
      c *= mix(shadowTint, highTint, smoothstep(0.1, 0.8, l));

      // Soft S-curve contrast
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.25);

      // Vignette
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * (uVignette * 3.2 + uDanger * 2.0);
      c *= clamp(v, 0.0, 1.0);

      // Danger tint at the edges
      float edge = smoothstep(0.15, 0.75, length(d) * 1.4);
      c = mix(c, c * vec3(1.35, 0.45, 0.35), edge * uDanger);

      // Film grain
      float g = hash(vUv * 1000.0 + fract(uTime * 7.0) * 100.0) - 0.5;
      c += g * uGrain;

      c = mix(c, vec3(0.0), uFade);
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};
