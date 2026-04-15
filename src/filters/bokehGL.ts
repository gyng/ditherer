import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  glAvailable,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "gl";

const BOKEH_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;   // Blurred image
uniform sampler2D u_source;  // Original image
uniform vec2  u_res;
uniform float u_radius;
uniform float u_threshold;
uniform float u_intensity;
uniform int   u_shape; // 0:circle 1:hexagon 2:triangle 3:pentagon 4:octagon 5:star
uniform float u_softness;
uniform float u_edgeFringe;
uniform float u_rotation;
uniform float u_catsEye;
uniform float u_edgeRing;
uniform float u_bubble;
uniform float u_localDetect;

const float PI = 3.14159265;

float getLuminance(vec3 color) {
    return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

// Smoothstep falloff so softness feathers more naturally than linear clamp.
// Shapes: 0=circle 1=hexagon 2=triangle 3=pentagon 4=octagon 5=star
float getInShape(float d, float r, float s, int sh, vec2 delta) {
    float t;
    if (sh == 0) { // CIRCLE
        t = clamp((d - r) / (s * r + 0.1), 0.0, 1.0);
    } else if (sh == 5) { // STAR — 6-pointed diffraction star
        // Fold angle into one spoke sector; radius alternates outer↔inner.
        float b = PI / 6.0;
        float fa = abs(mod(atan(delta.y, delta.x) + b, 2.0 * b) - b); // 0=point, b=valley
        float ri = mix(r, r * 0.42, (fa / b) * (fa / b));
        t = clamp((d - ri) / (s * r + 0.1), 0.0, 1.0);
    } else { // N-GON via folded-angle SDF: HEXAGON(1)=6, TRIANGLE(2)=3, PENTAGON(3)=5, OCTAGON(4)=8
        float n = sh == 1 ? 6.0 : (sh == 2 ? 3.0 : (sh == 3 ? 5.0 : 8.0));
        float sector = 6.28318530 / n;
        float fa = mod(atan(delta.y, delta.x) + PI / n, sector) - PI / n;
        float cs = cos(PI / n); // apothem / circumradius
        float poly_d = d * cos(fa) - r * cs;
        t = clamp(poly_d / (s * r * cs + 0.1), 0.0, 1.0);
    }
    return 1.0 - t * t * (3.0 - 2.0 * t);
}

void main() {
    vec4 baseColor = texture(u_input, v_uv);
    vec3 highlightAcc = vec3(0.0);

    float stepSize = max(1.0, floor(u_radius / 2.0));
    vec2 pixelPos = v_uv * u_res;
    vec2 center = u_res * 0.5;

    float startI = floor((pixelPos.x - u_radius * 1.5) / stepSize);
    float endI = ceil((pixelPos.x + u_radius * 1.5) / stepSize);
    float startJ = floor((pixelPos.y - u_radius * 1.5) / stepSize);
    float endJ = ceil((pixelPos.y + u_radius * 1.5) / stepSize);

    float rotRad = u_rotation * PI / 180.0;
    mat2 rotMat = mat2(cos(rotRad), sin(rotRad), -sin(rotRad), cos(rotRad));

    for (float i = startI; i <= endI; i++) {
        for (float j = startJ; j <= endJ; j++) {
            vec2 gridPos = vec2(i * stepSize, j * stepSize);
            if (gridPos.x < 0.0 || gridPos.x >= u_res.x || gridPos.y < 0.0 || gridPos.y >= u_res.y) continue;

            vec2 gridUV = (gridPos + vec2(0.5)) / u_res;
            vec4 sourceColor = texture(u_source, gridUV);
            float lum = getLuminance(sourceColor.rgb) * 255.0;

            // Local-contrast detection: blend between global threshold and local excess
            // over the blurred neighbourhood. At localDetect=1 only real light sources
            // (specular highlights, lamps) produce bokeh — a large uniform bright area won't.
            float blurLumG = getLuminance(texture(u_input, gridUV).rgb) * 255.0;
            float baseline = blurLumG * u_localDetect;
            float adjThreshold = u_threshold * (1.0 - u_localDetect * 0.85);
            float bokehStrength = max(0.0, (lum - baseline - adjThreshold) / max(1.0, 255.0 - baseline - adjThreshold));

            if (bokehStrength > 0.0) {
                vec2 delta = pixelPos - gridPos;

                // Rotation
                delta = rotMat * delta;

                float dist = length(delta);
                float inShapeVal = getInShape(dist, u_radius, u_softness, u_shape, delta);

                // Cat's eye: two-disc intersection produces crescent shapes near frame edges.
                // The second disc is offset toward the frame center, so shapes near corners
                // are clipped into almond/crescent forms — matching real mechanical vignetting.
                if (u_catsEye > 0.0) {
                    vec2 toCenter = center - gridPos;
                    float distToCenter = length(toCenter);
                    float normDist = clamp(distToCenter / (length(center) + 0.001), 0.0, 1.0);
                    vec2 radialDir = toCenter / max(distToCenter, 0.001);
                    // Rotate the radial direction to match the shape's rotated frame.
                    vec2 radialRot = rotMat * radialDir;
                    vec2 catsOffset = radialRot * u_catsEye * normDist * u_radius * 0.6;
                    vec2 delta2 = delta - catsOffset;
                    float inShape2 = getInShape(length(delta2), u_radius, u_softness, u_shape, delta2);
                    inShapeVal = min(inShapeVal, inShape2);
                }

                if (inShapeVal > 0.0) {
                    // Bubble: hollow out the disc interior so only the rim glows.
                    if (u_bubble > 0.0) {
                        float innerFade = smoothstep(0.0, u_radius * 0.75, dist);
                        inShapeVal *= mix(1.0, innerFade, u_bubble);
                    }

                    float ringFade = inShapeVal;
                    if (u_edgeRing > 0.0 && dist > u_radius * 0.7) {
                        float ringT = clamp((dist - u_radius * 0.7) / (u_radius * 0.3), 0.0, 1.0);
                        ringFade = 1.0 + u_edgeRing * ringT * 2.0;
                    }

                    float bokehIntensity = bokehStrength * u_intensity;
                    float addBase = bokehIntensity * ringFade * 80.0;

                    vec3 colorAdd;
                    if (u_edgeFringe != 0.0) {
                        // Shape-size fringe: R disc slightly smaller, B disc slightly larger.
                        float scaleFringe = u_edgeFringe * 0.05;
                        float rDist = dist / (1.0 + scaleFringe);
                        float bDist = dist / (1.0 - scaleFringe);
                        float rFringe = getInShape(rDist, u_radius, u_softness, u_shape, delta / (1.0 + scaleFringe));
                        float bFringe = getInShape(bDist, u_radius, u_softness, u_shape, delta / (1.0 - scaleFringe));
                        // Lateral UV shift: R and B source samples displaced radially from centre,
                        // producing visible color fringing on high-contrast edges.
                        vec2 fringeShift = (gridUV - vec2(0.5)) * u_edgeFringe * 0.012;
                        float rSrc = texture(u_source, clamp(gridUV + fringeShift, vec2(0.0), vec2(1.0))).r;
                        float bSrc = texture(u_source, clamp(gridUV - fringeShift, vec2(0.0), vec2(1.0))).b;
                        colorAdd = vec3(rFringe * rSrc, inShapeVal * sourceColor.g, bFringe * bSrc) * addBase / 255.0;
                    } else {
                        colorAdd = vec3(inShapeVal) * addBase * sourceColor.rgb / 255.0;
                    }

                    highlightAcc += colorAdd;
                }
            }
        }
    }

    fragColor = vec4(clamp(baseColor.rgb + highlightAcc, 0.0, 1.0), baseColor.a);
}
`;

const GAUSS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_res;
uniform vec2  u_dir;
uniform float u_sigma;
uniform int   u_radius;

void main() {
  float twoSigmaSq = 2.0 * u_sigma * u_sigma;
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int k = -64; k <= 64; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float fk = float(k);
    float w = exp(-(fk * fk) / twoSigmaSq);
    vec2 uv = clamp(v_uv + u_dir * fk,
                    vec2(0.5) / u_res,
                    vec2(1.0) - vec2(0.5) / u_res);
    acc += texture(u_input, uv) * w;
    wsum += w;
  }
  fragColor = acc / wsum;
}
`;

type Cache = {
    gaussProg: Program;
    bokehProg: Program;
};
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    gaussProg: linkProgram(gl, GAUSS_FS, ["u_input", "u_res", "u_dir", "u_sigma", "u_radius"] as const),
    bokehProg: linkProgram(gl, BOKEH_FS, ["u_input", "u_source", "u_res", "u_radius", "u_threshold", "u_intensity", "u_shape", "u_softness", "u_edgeFringe", "u_rotation", "u_catsEye", "u_edgeRing", "u_bubble", "u_localDetect"] as const),
  };
  return _cache;
};

export const bokehGLAvailable = (): boolean => glAvailable();

export const renderBokehGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  radius: number,
  threshold: number,
  intensity: number,
  shape: number,
  localDetect: number,
  softness: number,
  edgeFringe: number,
  rotation: number,
  catsEye: number,
  edgeRing: number,
  bubble: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  
  const sigma = radius / 2.0;
  const gRadius = Math.min(64, Math.ceil(sigma * 3));

  resizeGLCanvas(canvas, width, height);

  const sourceTex = ensureTexture(gl, "bokeh:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  // 1. Gaussian blur base
  const temp1 = ensureTexture(gl, "bokeh:temp1", width, height);
  drawPass(gl, temp1, width, height, cache.gaussProg, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.gaussProg.uniforms.u_input, 0);
    gl.uniform2f(cache.gaussProg.uniforms.u_res, width, height);
    gl.uniform2f(cache.gaussProg.uniforms.u_dir, 1 / width, 0);
    gl.uniform1f(cache.gaussProg.uniforms.u_sigma, sigma);
    gl.uniform1i(cache.gaussProg.uniforms.u_radius, gRadius);
  }, vao);

  const temp2 = ensureTexture(gl, "bokeh:temp2", width, height);
  drawPass(gl, temp2, width, height, cache.gaussProg, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, temp1.tex);
    gl.uniform1i(cache.gaussProg.uniforms.u_input, 0);
    gl.uniform2f(cache.gaussProg.uniforms.u_res, width, height);
    gl.uniform2f(cache.gaussProg.uniforms.u_dir, 0, 1 / height);
    gl.uniform1f(cache.gaussProg.uniforms.u_sigma, sigma);
    gl.uniform1i(cache.gaussProg.uniforms.u_radius, gRadius);
  }, vao);

  // 2. Bokeh highlights pass → gl canvas.
  drawPass(gl, null, width, height, cache.bokehProg, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, temp2.tex);
    gl.uniform1i(cache.bokehProg.uniforms.u_input, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.bokehProg.uniforms.u_source, 1);

    gl.uniform2f(cache.bokehProg.uniforms.u_res, width, height);
    gl.uniform1f(cache.bokehProg.uniforms.u_radius, radius);
    gl.uniform1f(cache.bokehProg.uniforms.u_threshold, threshold);
    gl.uniform1f(cache.bokehProg.uniforms.u_intensity, intensity);
    gl.uniform1i(cache.bokehProg.uniforms.u_shape, shape);
    gl.uniform1f(cache.bokehProg.uniforms.u_softness, softness);
    gl.uniform1f(cache.bokehProg.uniforms.u_edgeFringe, edgeFringe);
    gl.uniform1f(cache.bokehProg.uniforms.u_rotation, rotation);
    gl.uniform1f(cache.bokehProg.uniforms.u_catsEye, catsEye);
    gl.uniform1f(cache.bokehProg.uniforms.u_edgeRing, edgeRing);
    gl.uniform1f(cache.bokehProg.uniforms.u_bubble, bubble);
    gl.uniform1f(cache.bokehProg.uniforms.u_localDetect, localDetect);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
