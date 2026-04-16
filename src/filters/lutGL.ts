import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Preset IDs — must match the JS side.
export const LUT_PRESET = {
  ACES: 0,
  REINHARD: 1,
  UNCHARTED2: 2,
  TEAL_ORANGE: 3,
  BLEACH_BYPASS: 4,
  CROSS_PROCESS: 5,
  KODACHROME: 6,
  FADED_FILM: 7,
  TECHNICOLOR: 8,
  MATRIX_GREEN: 9,
  AMBER_NOIR: 10,
  COLD_WINTER: 11,
  LOMO: 12,
  VELVIA: 13,
  PORTRA: 14,
  TRIX_BW: 15,
  DUNE: 16,
  MOONRISE: 17,
  CLARENDON: 18,
  NASHVILLE: 19,
  MAGIC_HOUR: 20,
  JOHN_WICK: 21,
  WES_ANDERSON: 22,
  FURY_ROAD: 23,
  NEGATIVE: 24,
  KODAK_GOLD: 25,
  FUJI_PRO_400H: 26,
  CINESTILL_800T: 27,
  ILFORD_HP5: 28,
  EKTACHROME: 29,
  AGFA_VISTA: 30,
  DEAKINS: 31,
  AMELIE: 32,
  SAVING_RYAN: 33,
  THREE_HUNDRED: 34,
  BLADE_RUNNER: 35,
  SIN_CITY: 36,
  BREAKING_BAD: 37,
  MR_ROBOT: 38,
  REVENANT: 39,
  INCEPTION: 40,
  DRIVE: 41,
  STRANGER_THINGS: 42,
  JOKER_2019: 43,
} as const;

// Each branch is an analytic colour transform. Exposure multiplier is
// applied before grading; strength mixes back toward the source so 0 = no
// effect and 1 = fully graded.
const LUT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform int   u_preset;
uniform float u_strength;
uniform float u_exposure;   // stops

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// ACES filmic, Narkowicz 2015 approximation — widely used real-time tonemap.
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// Simple Reinhard — cheap dynamic-range compression.
vec3 reinhard(vec3 x) { return x / (1.0 + x); }

// Uncharted 2 / Hable — a classic game-engine filmic curve.
vec3 _hable(vec3 x) {
  const float A = 0.15, B = 0.50, C = 0.10, D = 0.20, E = 0.02, F = 0.30;
  return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}
vec3 uncharted2(vec3 x) {
  const float W = 11.2;
  return _hable(x * 2.0) / _hable(vec3(W));
}

// Teal & Orange — pushes shadows cool, highlights warm, with sat boost.
vec3 tealOrange(vec3 x) {
  float l = luma(x);
  vec3 y = x;
  y.r += (l - 0.4) * 0.22;
  y.g += (l - 0.5) * 0.05;
  y.b -= (l - 0.5) * 0.28;
  y.b = max(y.b, x.b * 0.7);       // don't crush shadows' blue entirely
  vec3 gray = vec3(luma(y));
  return mix(gray, y, 1.25);
}

// Bleach Bypass — film chem skip: washed, contrasty, low-sat.
vec3 bleachBypass(vec3 x) {
  float l = luma(x);
  vec3 desat = mix(vec3(l), x, 0.4);
  return (desat - 0.5) * 1.35 + 0.5;
}

// Cross Process — per-channel S-curves, different offsets.
vec3 crossProcess(vec3 x) {
  vec3 y;
  y.r = pow(clamp(x.r, 0.0, 1.0), 0.85) * 1.05;
  y.g = smoothstep(0.05, 0.95, x.g);
  y.b = mix(0.05, 0.95, pow(clamp(x.b, 0.0, 1.0), 1.25));
  return y;
}

// Kodachrome — warm saturated vintage.
vec3 kodachrome(vec3 x) {
  vec3 y = pow(x, vec3(0.92));
  y.r *= 1.08; y.g *= 1.02; y.b *= 0.92;
  float l = luma(y);
  return mix(vec3(l), y, 1.3);
}

// Faded Film — lifted blacks, reduced contrast, slight warm shadows.
vec3 fadedFilm(vec3 x) {
  vec3 y = x * 0.82 + 0.12;
  y.r += max(0.0, 0.12 - x.r) * 0.6;
  y.b -= max(0.0, 0.12 - x.b) * 0.3;
  return y;
}

// Technicolor — 3-strip saturation pump with slight warm tint.
vec3 technicolor(vec3 x) {
  float l = luma(x);
  vec3 sat = mix(vec3(l), x, 1.5);
  sat.r *= 1.05; sat.g *= 0.98; sat.b *= 1.02;
  return sat;
}

// Matrix — heavy green cast and crushed shadows.
vec3 matrixGreen(vec3 x) {
  float l = luma(x);
  vec3 y = vec3(l * 0.35, l * 1.15, l * 0.4);
  y = (y - 0.5) * 1.2 + 0.5;
  return y;
}

// Amber Noir — Blade Runner 2049 style amber/orange neutral.
vec3 amberNoir(vec3 x) {
  float l = luma(x);
  vec3 amber = vec3(1.0, 0.75, 0.35);
  vec3 shadow = vec3(0.1, 0.08, 0.05);
  vec3 y = mix(shadow, amber, smoothstep(0.0, 1.0, l));
  return mix(vec3(l), y, 0.85);
}

// Cold Winter — desaturated, blue-shifted, lifted blacks.
vec3 coldWinter(vec3 x) {
  float l = luma(x);
  vec3 cool = vec3(0.75, 0.9, 1.05);
  vec3 y = x * cool;
  y = mix(vec3(l), y, 0.55);
  y = y * 0.88 + 0.08;
  return y;
}

// Lomo — punchy saturation + lifted warm shadows. No vignette (that's a
// separate filter); this is pure colour.
vec3 lomo(vec3 x) {
  float l = luma(x);
  vec3 y = mix(vec3(l), x, 1.45);
  y.r = pow(clamp(y.r, 0.0, 1.0), 0.9);
  y.b = pow(clamp(y.b, 0.0, 1.0), 1.15);
  y += vec3(0.04, 0.02, -0.02);     // warm cast
  y = (y - 0.5) * 1.15 + 0.5;        // contrast
  return y;
}

// Velvia (Fuji) — ultra-saturated, slight blue-green shift. Landscapes.
vec3 velvia(vec3 x) {
  float l = luma(x);
  vec3 y = mix(vec3(l), x, 1.7);
  y.g *= 1.05;
  y.b *= 1.08;
  return pow(clamp(y, 0.0, 1.0), vec3(0.95));
}

// Portra (Kodak) — soft skin tones, muted saturation, warm lift.
vec3 portra(vec3 x) {
  float l = luma(x);
  vec3 y = mix(vec3(l), x, 0.82);
  y = y * 0.92 + 0.06;
  y.r *= 1.06;
  y.g *= 1.02;
  y.b *= 0.95;
  return y;
}

// Tri-X B&W — punchy classic film monochrome.
vec3 trixBW(vec3 x) {
  float l = luma(x);
  l = (l - 0.5) * 1.25 + 0.5;
  // Slight mid-tone lift (a mild S-curve).
  l = l + sin(l * 3.14159) * 0.04;
  return vec3(l);
}

// Dune — deep orange desert with crushed shadows.
vec3 dune(vec3 x) {
  float l = luma(x);
  vec3 orange = vec3(1.05, 0.55, 0.15);
  vec3 shadow = vec3(0.12, 0.05, 0.0);
  float t = smoothstep(0.0, 1.0, l);
  vec3 y = mix(shadow, orange, t);
  return mix(vec3(l), y, 0.9);
}

// Moonrise — cool desaturated with slight teal cast.
vec3 moonrise(vec3 x) {
  float l = luma(x);
  vec3 y = mix(vec3(l), x, 0.55);
  y.r *= 0.92;
  y.g *= 0.98;
  y.b *= 1.08;
  y = y * 0.9 + 0.08;
  return y;
}

// Clarendon — bright punch: cyan shadows, cool highlights, high sat.
vec3 clarendon(vec3 x) {
  float l = luma(x);
  vec3 y = mix(vec3(l), x, 1.3);
  // Lift shadows toward cyan.
  y += vec3(-0.05, 0.05, 0.08) * (1.0 - l);
  // Brighten highlights slightly.
  y += vec3(0.04, 0.04, 0.06) * l;
  return y;
}

// Nashville — warm pink cast with faded contrast.
vec3 nashville(vec3 x) {
  vec3 y = x * 0.9 + vec3(0.08, 0.02, 0.0);
  y.r = pow(clamp(y.r, 0.0, 1.0), 0.9);
  y.b = pow(clamp(y.b, 0.0, 1.0), 1.1);
  return y;
}

// Magic Hour — golden/magenta sunset wash.
vec3 magicHour(vec3 x) {
  float l = luma(x);
  vec3 y = x;
  y.r += (1.0 - l) * 0.05 + l * 0.1;
  y.g += l * 0.03;
  y.b -= l * 0.08;
  y += vec3(0.03, -0.01, 0.02);      // slight magenta lift in shadows
  return mix(vec3(l), y, 1.1);
}

// John Wick — cool dark teal, heavy contrast, desaturated reds.
vec3 johnWick(vec3 x) {
  float l = luma(x);
  vec3 y = mix(vec3(l), x, 0.7);
  y.r *= 0.85;
  y.b *= 1.1;
  y.g *= 1.02;
  y = (y - 0.5) * 1.25 + 0.5;
  return y * 0.88;
}

// Wes Anderson — symmetric pastel palette with warm mids.
vec3 wesAnderson(vec3 x) {
  float l = luma(x);
  vec3 y = mix(vec3(l), x, 0.75);    // desaturate
  y = y * 0.85 + 0.15;                // lift blacks, compress whites
  y.r += 0.03;
  y.b -= 0.02;
  return pow(clamp(y, 0.0, 1.0), vec3(0.92));
}

// Fury Road — extreme teal/orange crunch with crushed blacks.
vec3 furyRoad(vec3 x) {
  float l = luma(x);
  vec3 y = x;
  y.r += (l - 0.4) * 0.35;
  y.b -= (l - 0.5) * 0.4;
  y.b = max(y.b, x.b * 0.5);
  vec3 gray = vec3(luma(y));
  y = mix(gray, y, 1.55);
  y = (y - 0.5) * 1.3 + 0.5;
  return y;
}

// Negative — colour inversion, clipped.
vec3 negativ(vec3 x) {
  return 1.0 - clamp(x, 0.0, 1.0);
}

// Kodak Gold 200 — warm amateur colour negative, amber shadows.
vec3 kodakGold(vec3 x) {
  float l = luma(x);
  vec3 y = x;
  y.r *= 1.08; y.g *= 1.02; y.b *= 0.88;
  y += vec3(0.03, 0.01, -0.02) * (1.0 - l);
  return mix(vec3(luma(y)), y, 1.1);
}

// Fuji Pro 400H — pastel wedding film, lifted blacks, gentle cyan cast.
vec3 fujiPro400H(vec3 x) {
  float l = luma(x);
  vec3 y = mix(vec3(l), x, 0.7);
  y = y * 0.85 + 0.14;
  y.r *= 0.98; y.g *= 1.01; y.b *= 1.04;
  return y;
}

// CineStill 800T — tungsten-balanced, pink halation in highlights,
// cool shadows. Real halation is spatial; this fakes just the colour shift.
vec3 cinestill800T(vec3 x) {
  float l = luma(x);
  vec3 y = x;
  y.b += (1.0 - l) * 0.08;
  y.r -= (1.0 - l) * 0.02;
  y.r += l * l * 0.12;
  y.b += l * l * 0.05;
  return mix(vec3(luma(y)), y, 1.15);
}

// Ilford HP5+ — grainy classic B&W, contrastier than Tri-X.
vec3 ilfordHP5(vec3 x) {
  float l = luma(x);
  l = pow(clamp(l, 0.0, 1.0), 0.9);
  l = (l - 0.5) * 1.18 + 0.5;
  return vec3(l);
}

// Ektachrome — cool saturated slide film, cyan shadows.
vec3 ektachrome(vec3 x) {
  float l = luma(x);
  vec3 y = mix(vec3(l), x, 1.3);
  y.r *= 0.98; y.b *= 1.07;
  return (y - 0.5) * 1.05 + 0.5;
}

// Agfa Vista — red-shifted warm consumer film.
vec3 agfaVista(vec3 x) {
  float l = luma(x);
  vec3 y = x;
  y.r *= 1.12; y.g *= 1.02; y.b *= 0.92;
  y = mix(vec3(l), y, 1.15);
  return y * 0.92 + 0.06;
}

// Deakins — Roger-Deakins-style moody cool desaturation.
vec3 deakins(vec3 x) {
  float l = luma(x);
  vec3 y = mix(vec3(l), x, 0.5);
  y.r *= 0.96; y.b *= 1.05;
  return (y - 0.5) * 1.1 + 0.5 - 0.03;
}

// Amelie — warm storybook green-red, muted blues.
vec3 amelie(vec3 x) {
  float l = luma(x);
  vec3 y = x;
  y.r *= 1.15; y.g *= 1.1; y.b *= 0.82;
  y += vec3(0.02, 0.03, -0.02);
  return mix(vec3(luma(y)), y, 1.2);
}

// Saving Private Ryan — heavy bleach-bypass war grade: desaturated with
// punched mid contrast, slight warm yellow cast.
vec3 savingRyan(vec3 x) {
  float l = luma(x);
  vec3 y = mix(vec3(l), x, 0.22);
  y = (y - 0.5) * 1.45 + 0.5;
  y.r *= 1.05; y.g *= 1.02; y.b *= 0.88;
  return y;
}

// 300 — gritty orange-brown with crushed teal-shadow, saturated mids.
vec3 threeHundred(vec3 x) {
  float l = luma(x);
  vec3 y = x;
  y.r += (l - 0.3) * 0.25;
  y.g *= 0.85;
  y.b -= l * 0.25;
  y.b = max(y.b, 0.02);
  y = mix(vec3(luma(y)), y, 1.4);
  return (y - 0.5) * 1.15 + 0.5;
}

// Blade Runner (1982) — smoky blue shadows with neon amber highlights.
vec3 bladeRunner(vec3 x) {
  float l = luma(x);
  vec3 y = x;
  y.b += (1.0 - l) * 0.18;
  y.r += l * l * 0.2;
  y.g += (1.0 - l) * 0.05;
  y = mix(vec3(luma(y)), y, 0.9);
  return y * 0.92 + 0.04;
}

// Sin City — brutal high-contrast B&W with crushed blacks.
vec3 sinCity(vec3 x) {
  float l = luma(x);
  l = (l - 0.5) * 1.8 + 0.5;
  l = smoothstep(0.05, 0.95, l);
  return vec3(l);
}

// Breaking Bad — Albuquerque desert yellow tint, low cyan.
vec3 breakingBad(vec3 x) {
  float l = luma(x);
  vec3 y = x;
  y.r *= 1.08;
  y.g *= 1.06;
  y.b *= 0.78;
  y += vec3(0.03, 0.02, -0.02);
  return mix(vec3(luma(y)), y, 1.15);
}

// Mr. Robot — desaturated warm-green hacker grade, crushed cyan.
vec3 mrRobot(vec3 x) {
  float l = luma(x);
  vec3 y = mix(vec3(l), x, 0.55);
  y.r *= 0.95;
  y.g *= 1.08;
  y.b *= 0.88;
  return (y - 0.5) * 1.08 + 0.5;
}

// The Revenant — cold muted blue-gray, lifted blacks, natural-light feel.
vec3 revenant(vec3 x) {
  float l = luma(x);
  vec3 y = mix(vec3(l), x, 0.55);
  y.r *= 0.92;
  y.g *= 0.96;
  y.b *= 1.08;
  return y * 0.92 + 0.08;
}

// Inception — steel-blue shadows, vivid orange highlights.
vec3 inception(vec3 x) {
  float l = luma(x);
  vec3 y = x;
  y.r += (l - 0.4) * 0.25;
  y.b += (0.5 - l) * 0.25;
  y.b = max(y.b, x.b * 0.6);
  y.g *= 0.98;
  y = mix(vec3(luma(y)), y, 1.3);
  return y;
}

// Drive — neon magenta-pink over teal, low mid-sat.
vec3 drive(vec3 x) {
  float l = luma(x);
  vec3 y = x;
  y.r += l * 0.1;
  y.b += l * 0.08 + (1.0 - l) * 0.1;
  y.g *= 0.88;
  y += vec3(0.03, -0.02, 0.03);
  return mix(vec3(luma(y)), y, 1.15);
}

// Stranger Things — 80s teal shadows with red highlights.
vec3 strangerThings(vec3 x) {
  float l = luma(x);
  vec3 y = x;
  y.b += (1.0 - l) * 0.12;
  y.g += (1.0 - l) * 0.04;
  y.r += l * l * 0.18;
  y.r = max(y.r, x.r);
  return mix(vec3(luma(y)), y, 1.2);
}

// Joker (2019) — sickly green-yellow cast, crushed shadows.
vec3 joker2019(vec3 x) {
  float l = luma(x);
  vec3 y = x;
  y.r *= 1.05;
  y.g *= 1.1;
  y.b *= 0.75;
  y += vec3(-0.02, 0.04, -0.03);
  y = mix(vec3(luma(y)), y, 1.25);
  return (y - 0.5) * 1.1 + 0.5;
}

void main() {
  vec4 s = texture(u_source, v_uv);
  vec3 rgb = s.rgb * exp2(u_exposure);
  vec3 g;
  if      (u_preset == 0)  g = aces(rgb);
  else if (u_preset == 1)  g = reinhard(rgb);
  else if (u_preset == 2)  g = uncharted2(rgb);
  else if (u_preset == 3)  g = tealOrange(rgb);
  else if (u_preset == 4)  g = bleachBypass(rgb);
  else if (u_preset == 5)  g = crossProcess(rgb);
  else if (u_preset == 6)  g = kodachrome(rgb);
  else if (u_preset == 7)  g = fadedFilm(rgb);
  else if (u_preset == 8)  g = technicolor(rgb);
  else if (u_preset == 9)  g = matrixGreen(rgb);
  else if (u_preset == 10) g = amberNoir(rgb);
  else if (u_preset == 11) g = coldWinter(rgb);
  else if (u_preset == 12) g = lomo(rgb);
  else if (u_preset == 13) g = velvia(rgb);
  else if (u_preset == 14) g = portra(rgb);
  else if (u_preset == 15) g = trixBW(rgb);
  else if (u_preset == 16) g = dune(rgb);
  else if (u_preset == 17) g = moonrise(rgb);
  else if (u_preset == 18) g = clarendon(rgb);
  else if (u_preset == 19) g = nashville(rgb);
  else if (u_preset == 20) g = magicHour(rgb);
  else if (u_preset == 21) g = johnWick(rgb);
  else if (u_preset == 22) g = wesAnderson(rgb);
  else if (u_preset == 23) g = furyRoad(rgb);
  else if (u_preset == 24) g = negativ(rgb);
  else if (u_preset == 25) g = kodakGold(rgb);
  else if (u_preset == 26) g = fujiPro400H(rgb);
  else if (u_preset == 27) g = cinestill800T(rgb);
  else if (u_preset == 28) g = ilfordHP5(rgb);
  else if (u_preset == 29) g = ektachrome(rgb);
  else if (u_preset == 30) g = agfaVista(rgb);
  else if (u_preset == 31) g = deakins(rgb);
  else if (u_preset == 32) g = amelie(rgb);
  else if (u_preset == 33) g = savingRyan(rgb);
  else if (u_preset == 34) g = threeHundred(rgb);
  else if (u_preset == 35) g = bladeRunner(rgb);
  else if (u_preset == 36) g = sinCity(rgb);
  else if (u_preset == 37) g = breakingBad(rgb);
  else if (u_preset == 38) g = mrRobot(rgb);
  else if (u_preset == 39) g = revenant(rgb);
  else if (u_preset == 40) g = inception(rgb);
  else if (u_preset == 41) g = drive(rgb);
  else if (u_preset == 42) g = strangerThings(rgb);
  else                     g = joker2019(rgb);

  vec3 o = mix(s.rgb, g, u_strength);
  fragColor = vec4(clamp(o, 0.0, 1.0), s.a);
}
`;

type Cache = { lut: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    lut: linkProgram(gl, LUT_FS, ["u_source", "u_preset", "u_strength", "u_exposure"] as const),
  };
  return _cache;
};

export const lutGLAvailable = (): boolean => glAvailable();

export const renderLUTGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  preset: number,
  strength: number,
  exposure: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "lut:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  drawPass(gl, null, width, height, cache.lut, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.lut.uniforms.u_source, 0);
    gl.uniform1i(cache.lut.uniforms.u_preset, preset);
    gl.uniform1f(cache.lut.uniforms.u_strength, strength);
    gl.uniform1f(cache.lut.uniforms.u_exposure, exposure);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
