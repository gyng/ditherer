use wasm_bindgen::prelude::*;
use core::arch::wasm32::*;

// Persistent f32 scratch buffer for filters that need an intermediate RGBA
// float representation (Gaussian blur horizontal + input conversion). Reused
// across calls so we don't re-alloc every frame.
static mut F32_SCRATCH_A: Vec<f32> = Vec::new();
static mut F32_SCRATCH_B: Vec<f32> = Vec::new();

fn ensure_scratch<'a>(scratch: &'a mut Vec<f32>, len: usize) -> &'a mut [f32] {
    if scratch.len() < len { scratch.resize(len, 0.0); }
    &mut scratch[..len]
}

#[rustfmt::skip]
#[wasm_bindgen]
pub fn rgba2laba(
    r: f64,
    g: f64,
    b: f64,
    a: f64,
    ref_x: f64,
    ref_y: f64,
    ref_z: f64,
) -> Vec<f64> {
    let mut r = r / 255.0;
    let mut g = g / 255.0;
    let mut b = b / 255.0;

    // Need lto = true in Cargo.toml to link pow
    r = if r > 0.04045 { ((r + 0.055) / 1.055).powf(2.4) } else { r / 12.92 };
    g = if g > 0.04045 { ((g + 0.055) / 1.055).powf(2.4) } else { g / 12.92 };
    b = if b > 0.04045 { ((b + 0.055) / 1.055).powf(2.4) } else { b / 12.92 };

    r *= 100.0;
    g *= 100.0;
    b *= 100.0;

    // Observer= 2° (Only use CIE 1931!)
    let mut x = r * 0.4124 + g * 0.3576 + b * 0.1805;
    let mut y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    let mut z = r * 0.0193 + g * 0.1192 + b * 0.9505;

    x /= ref_x;
    y /= ref_y;
    z /= ref_z;

    x = if x > 0.008856 { x.powf(1.0 / 3.0) } else { x * 7.787 + 16.0 / 116.0 };
    y = if y > 0.008856 { y.powf(1.0 / 3.0) } else { y * 7.787 + 16.0 / 116.0 };
    z = if z > 0.008856 { z.powf(1.0 / 3.0) } else { z * 7.787 + 16.0 / 116.0 };

    let out_l = 116.0 * y - 16.0;
    let out_a = 500.0 * (x - y);
    let out_b = 200.0 * (y - z);

    vec![out_l, out_a, out_b, a]
}

#[wasm_bindgen]
pub fn rgba_laba_distance(
    r1: f64,
    g1: f64,
    b1: f64,
    a1: f64,
    r2: f64,
    g2: f64,
    b2: f64,
    a2: f64,
    ref_x: f64,
    ref_y: f64,
    ref_z: f64,
) -> f64 {
    let left = rgba2laba(r1, g1, b1, a1, ref_x, ref_y, ref_z);
    let right = rgba2laba(r2, g2, b2, a2, ref_x, ref_y, ref_z);
    let dist = ((right[0] - left[0]).powf(2.0) + (right[1] - left[1]).powf(2.0) + (right[2] - left[2]).powf(2.0)).sqrt();

    dist
}

/// Find the index of the nearest palette colour in Lab space.
/// `palette` is a flat [r0,g0,b0,a0, r1,g1,b1,a1, …] slice.
/// Returns the 0-based index of the nearest entry.
#[wasm_bindgen]
pub fn rgba_nearest_lab_index(
    r: f64, g: f64, b: f64, a: f64,
    palette: &[f64],
    ref_x: f64, ref_y: f64, ref_z: f64,
) -> usize {
    let pixel = rgba2laba(r, g, b, a, ref_x, ref_y, ref_z);
    let n = palette.len() / 4;
    let mut best_idx: usize = 0;
    let mut best_dist = f64::MAX;
    for i in 0..n {
        let pal = rgba2laba(
            palette[i * 4], palette[i * 4 + 1], palette[i * 4 + 2], palette[i * 4 + 3],
            ref_x, ref_y, ref_z,
        );
        let d = (pixel[0] - pal[0]).powi(2)
              + (pixel[1] - pal[1]).powi(2)
              + (pixel[2] - pal[2]).powi(2);
        if d < best_dist {
            best_dist = d;
            best_idx = i;
        }
    }
    best_idx
}

// --- Internal helper for Lab conversion without Vec allocation ---

fn rgba2lab_inline(r: f64, g: f64, b: f64, ref_x: f64, ref_y: f64, ref_z: f64) -> [f64; 3] {
    let mut r = r / 255.0;
    let mut g = g / 255.0;
    let mut b = b / 255.0;

    r = if r > 0.04045 { ((r + 0.055) / 1.055).powf(2.4) } else { r / 12.92 };
    g = if g > 0.04045 { ((g + 0.055) / 1.055).powf(2.4) } else { g / 12.92 };
    b = if b > 0.04045 { ((b + 0.055) / 1.055).powf(2.4) } else { b / 12.92 };

    r *= 100.0; g *= 100.0; b *= 100.0;

    let mut x = r * 0.4124 + g * 0.3576 + b * 0.1805;
    let mut y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    let mut z = r * 0.0193 + g * 0.1192 + b * 0.9505;

    x /= ref_x; y /= ref_y; z /= ref_z;

    x = if x > 0.008856 { x.powf(1.0 / 3.0) } else { x * 7.787 + 16.0 / 116.0 };
    y = if y > 0.008856 { y.powf(1.0 / 3.0) } else { y * 7.787 + 16.0 / 116.0 };
    z = if z > 0.008856 { z.powf(1.0 / 3.0) } else { z * 7.787 + 16.0 / 116.0 };

    [116.0 * y - 16.0, 500.0 * (x - y), 200.0 * (y - z)]
}

fn nearest_in_lab(pixel_lab: &[f64; 3], pal_lab: &[[f64; 3]]) -> usize {
    let mut best = 0;
    let mut best_d = f64::MAX;
    for (i, pl) in pal_lab.iter().enumerate() {
        let d = (pixel_lab[0] - pl[0]).powi(2)
              + (pixel_lab[1] - pl[1]).powi(2)
              + (pixel_lab[2] - pl[2]).powi(2);
        if d < best_d { best_d = d; best = i; }
    }
    best
}

/// Per-pixel nearest with pre-converted Lab palette.
/// `palette_lab` is [L0,a0,b0, L1,a1,b1, …] (already in Lab space).
#[wasm_bindgen]
pub fn nearest_lab_precomputed(
    r: f64, g: f64, b: f64,
    palette_lab: &[f64],
    ref_x: f64, ref_y: f64, ref_z: f64,
) -> usize {
    let pixel = rgba2lab_inline(r, g, b, ref_x, ref_y, ref_z);
    let n = palette_lab.len() / 3;
    let mut best = 0usize;
    let mut best_d = f64::MAX;
    for i in 0..n {
        let d = (pixel[0] - palette_lab[i * 3]).powi(2)
              + (pixel[1] - palette_lab[i * 3 + 1]).powi(2)
              + (pixel[2] - palette_lab[i * 3 + 2]).powi(2);
        if d < best_d { best_d = d; best = i; }
    }
    best
}

/// Quantize an entire RGBA u8 buffer in one call.
/// Converts palette to Lab once, then finds nearest for every pixel.
/// `buffer` is [r,g,b,a, r,g,b,a, …] u8 values.
/// `palette` is [r,g,b,a, …] f64 values (0-255).
/// Returns a new u8 buffer with matched palette colours (alpha preserved).
#[wasm_bindgen]
pub fn quantize_buffer_lab(
    buffer: &[u8],
    palette: &[f64],
    ref_x: f64, ref_y: f64, ref_z: f64,
) -> Vec<u8> {
    let n_colors = palette.len() / 4;

    // Pre-convert palette to Lab + cache RGBA bytes
    let mut pal_lab: Vec<[f64; 3]> = Vec::with_capacity(n_colors);
    let mut pal_rgba: Vec<[u8; 4]> = Vec::with_capacity(n_colors);
    for i in 0..n_colors {
        let lab = rgba2lab_inline(palette[i * 4], palette[i * 4 + 1], palette[i * 4 + 2],
                                  ref_x, ref_y, ref_z);
        pal_lab.push(lab);
        pal_rgba.push([
            palette[i * 4] as u8, palette[i * 4 + 1] as u8,
            palette[i * 4 + 2] as u8, palette[i * 4 + 3] as u8,
        ]);
    }

    let n_pixels = buffer.len() / 4;
    let mut out = vec![0u8; buffer.len()];

    for p in 0..n_pixels {
        let i = p * 4;
        let pixel_lab = rgba2lab_inline(
            buffer[i] as f64, buffer[i + 1] as f64, buffer[i + 2] as f64,
            ref_x, ref_y, ref_z,
        );
        let best = nearest_in_lab(&pixel_lab, &pal_lab);
        out[i]     = pal_rgba[best][0];
        out[i + 1] = pal_rgba[best][1];
        out[i + 2] = pal_rgba[best][2];
        out[i + 3] = buffer[i + 3]; // preserve alpha
    }

    out
}

// --- RGB / RGB_APPROX / HSV buffer quantization ---

fn rgb_to_hsv(r: f64, g: f64, b: f64) -> [f64; 3] {
    let r = r / 255.0;
    let g = g / 255.0;
    let b = b / 255.0;

    let min = r.min(g).min(b);
    let max = r.max(g).max(b);
    let delta = max - min;

    let v = max;
    if delta == 0.0 {
        return [0.0, 0.0, v];
    }
    let s = delta / max;
    let h = if r == max {
        (g - b) / delta
    } else if g == max {
        2.0 + (b - r) / delta
    } else {
        4.0 + (r - g) / delta
    };
    let h = h * 60.0;
    let h = if h < 0.0 { h + 360.0 } else { h };
    [h, s, v]
}

/// Quantize buffer using squared Euclidean RGB distance.
#[wasm_bindgen]
pub fn quantize_buffer_rgb(buffer: &[u8], palette: &[f64]) -> Vec<u8> {
    let n_colors = palette.len() / 4;
    let mut pal: Vec<[u8; 4]> = Vec::with_capacity(n_colors);
    for i in 0..n_colors {
        pal.push([palette[i*4] as u8, palette[i*4+1] as u8,
                  palette[i*4+2] as u8, palette[i*4+3] as u8]);
    }

    let n_pixels = buffer.len() / 4;
    let mut out = vec![0u8; buffer.len()];
    for p in 0..n_pixels {
        let i = p * 4;
        let pr = buffer[i] as i32;
        let pg = buffer[i+1] as i32;
        let pb = buffer[i+2] as i32;

        let mut best = 0;
        let mut best_d = i32::MAX;
        for (j, c) in pal.iter().enumerate() {
            let dr = pr - c[0] as i32;
            let dg = pg - c[1] as i32;
            let db = pb - c[2] as i32;
            let d = dr*dr + dg*dg + db*db;
            if d < best_d { best_d = d; best = j; }
        }
        out[i]   = pal[best][0];
        out[i+1] = pal[best][1];
        out[i+2] = pal[best][2];
        out[i+3] = buffer[i+3];
    }
    out
}

/// Quantize buffer using red-mean perceptual RGB approximation.
#[wasm_bindgen]
pub fn quantize_buffer_rgb_approx(buffer: &[u8], palette: &[f64]) -> Vec<u8> {
    let n_colors = palette.len() / 4;
    let mut pal: Vec<[u8; 4]> = Vec::with_capacity(n_colors);
    for i in 0..n_colors {
        pal.push([palette[i*4] as u8, palette[i*4+1] as u8,
                  palette[i*4+2] as u8, palette[i*4+3] as u8]);
    }

    let n_pixels = buffer.len() / 4;
    let mut out = vec![0u8; buffer.len()];
    for p in 0..n_pixels {
        let i = p * 4;
        let pr = buffer[i] as f64;
        let pg = buffer[i+1] as f64;
        let pb = buffer[i+2] as f64;

        let mut best = 0;
        let mut best_d = f64::MAX;
        for (j, c) in pal.iter().enumerate() {
            let r_mean = (pr + c[0] as f64) / 2.0;
            let dr = pr - c[0] as f64;
            let dg = pg - c[1] as f64;
            let db = pb - c[2] as f64;
            let d = (2.0 + r_mean / 256.0) * dr * dr
                  + 4.0 * dg * dg
                  + (2.0 + (255.0 - r_mean) / 256.0) * db * db;
            if d < best_d { best_d = d; best = j; }
        }
        out[i]   = pal[best][0];
        out[i+1] = pal[best][1];
        out[i+2] = pal[best][2];
        out[i+3] = buffer[i+3];
    }
    out
}

// === Error-diffusion fast path ===
// Mirrors the JS factory's sRGB horizontal serpentine loop:
// - f32 error buffer (RGB only; alpha copied straight through)
// - kernel stored dense row-major (length = kernel_height * kernel_width);
//   0.0 means "skip" (matches the JS `null` entries)
// - reverse rows mirror the kernel via kx = kernel_width-1-w, tx = x + (kx+offset_x)*(-1)
//   matching the exact JS formula so serpentine output stays identical
// - levels palette uses JS Math.round semantics ((x+0.5).floor()) for parity
// - clamp to u8 when writing to output; feedback uses pre-clamp quant value

const PAL_MODE_LEVELS: u32 = 0;
const PAL_MODE_RGB: u32 = 1;
const PAL_MODE_RGB_APPROX: u32 = 2;
const PAL_MODE_HSV: u32 = 3;
const PAL_MODE_LAB: u32 = 4;

// Row-alternation modes for the row-major scan. Must agree with WASM_ROW_ALT
// in src/utils/index.ts and the JS-side ROW_ALT constants in
// src/filters/errorDiffusingFilterFactory.ts.
const ROW_ALT_BOUSTROPHEDON: u32 = 0;
const ROW_ALT_REVERSE: u32 = 1;
const ROW_ALT_BLOCK2: u32 = 2;
const ROW_ALT_BLOCK3: u32 = 3;
const ROW_ALT_BLOCK4: u32 = 4;
const ROW_ALT_BLOCK8: u32 = 5;
const ROW_ALT_TRIANGULAR: u32 = 6;
const ROW_ALT_GRAYCODE: u32 = 7;
const ROW_ALT_BITREVERSE: u32 = 8;
const ROW_ALT_PRIME: u32 = 9;
const ROW_ALT_RANDOM: u32 = 10;

#[inline]
fn is_prime(n: i32) -> bool {
    if n < 2 { return false; }
    if n < 4 { return true; }
    if (n & 1) == 0 { return false; }
    let mut i: i32 = 3;
    while i.saturating_mul(i) <= n {
        if n % i == 0 { return false; }
        i += 2;
    }
    true
}

#[inline]
fn bit_reverse_parity(y: i32, h: i32) -> i32 {
    let mut bits: i32 = 1;
    while (1i32 << bits) < h { bits += 1; }
    let mut r: i32 = 0;
    for b in 0..bits {
        if (y & (1 << b)) != 0 { r |= 1 << (bits - 1 - b); }
    }
    r & 1
}

#[inline]
fn triangular_segment(y: i32) -> i32 {
    ((-1.0 + (1.0_f64 + 8.0 * y as f64).sqrt()) / 2.0).floor() as i32
}

#[inline]
fn row_reverse(y: i32, h: i32, alt: u32) -> bool {
    match alt {
        ROW_ALT_REVERSE    => (y & 1) == 0,
        ROW_ALT_BLOCK2     => ((y >> 1) & 1) == 1,
        ROW_ALT_BLOCK3     => (((y / 3) as i32) & 1) == 1,
        ROW_ALT_BLOCK4     => ((y >> 2) & 1) == 1,
        ROW_ALT_BLOCK8     => ((y >> 3) & 1) == 1,
        ROW_ALT_TRIANGULAR => (triangular_segment(y) & 1) == 1,
        ROW_ALT_GRAYCODE   => ((y ^ (y >> 1)) & 1) == 1,
        ROW_ALT_BITREVERSE => bit_reverse_parity(y, h) == 1,
        ROW_ALT_PRIME      => is_prime(y),
        ROW_ALT_RANDOM     => ((y as u32).wrapping_mul(2654435761) & 1) == 1,
        ROW_ALT_BOUSTROPHEDON | _ => (y & 1) == 1,
    }
}

#[inline] fn js_round_f32(x: f32) -> f32 { (x + 0.5).floor() }

#[inline] fn clamp_u8_f32(x: f32) -> u8 {
    if x < 0.0 { 0 } else if x > 255.0 { 255 } else { x as u8 }
}

#[inline] fn quant_levels_channel(p: f32, step: f32) -> f32 {
    js_round_f32(js_round_f32(p / step) * step)
}

// Precomputed kernel entry. offset_fwd/offset_rev are signed pixel-index deltas
// from the current pixel in the error buffer (3 channels per pixel), so the
// hot loop can skip multiplying by x_step and just branch on direction.
struct KEntry {
    weight: f32,
    // Relative (dx, dy) already accounting for kernel offset, for the forward scan.
    dx_fwd: i32,
    // Relative dx for the reverse scan (kx = kernel_width-1-w, then inverted x_step).
    dx_rev: i32,
    dy: i32,
}

// Persistent error buffer so repeated calls at the same size don't re-alloc.
// WASM is single-threaded, so a `static mut` is sound; `#[allow]` silences the lint.
static mut ERR_BUF: Vec<f32> = Vec::new();

// sRGB→linear LUT, matches SRGB_TO_LINEAR_F in src/utils/index.ts.
// OnceLock would need std::sync; for single-threaded WASM a plain static mut is fine.
static mut SRGB_TO_LIN: [f32; 256] = [0.0; 256];
static mut SRGB_TO_LIN_INIT: bool = false;

#[inline]
fn srgb_to_lin_lut() -> &'static [f32; 256] {
    unsafe {
        #[allow(static_mut_refs)]
        {
            if !SRGB_TO_LIN_INIT {
                for i in 0..256 {
                    let s = i as f32 / 255.0;
                    SRGB_TO_LIN[i] = if s <= 0.04045 { s / 12.92 } else { ((s + 0.055) / 1.055).powf(2.4) };
                }
                SRGB_TO_LIN_INIT = true;
            }
            &SRGB_TO_LIN
        }
    }
}

// Linear→sRGB u8 via a direct LUT + up to two threshold corrections.
//
// We index a 4096-entry LUT by floor(l * 4096). Bucket size is 1/4096 ≈ 2.4e-4.
// Most buckets fall entirely within one u8 region, so the LUT center gives the
// exact u8. A bucket can only straddle a u8 transition when its width exceeds
// the u8 region's width — which happens for the first few u8 values near black
// where u8 regions are as narrow as ≈1.5e-4. In those cases the LUT is off by
// at most ±1, which we fix with one cheap threshold compare per direction.
//
// `LIN_THRESHOLDS[i]` is the linear value where the JS curve rounds up from
// u8=i to u8=i+1, i.e. `inverseCurve((i + 0.5) / 255)`. Built in f64 to match
// JS Math.pow precision, stored in f32 to match the hot-path data type.

const LIN_LUT_SIZE: usize = 4096;
static mut LIN_TO_SRGB_LUT: [u8; LIN_LUT_SIZE] = [0; LIN_LUT_SIZE];
static mut LIN_THRESHOLDS: [f32; 255] = [0.0; 255];
static mut LIN_LUT_INIT: bool = false;

fn init_lin_luts() -> (&'static [u8; LIN_LUT_SIZE], &'static [f32; 255]) {
    unsafe {
        #[allow(static_mut_refs)]
        {
            if !LIN_LUT_INIT {
                for i in 0..255 {
                    let s = (i as f64 + 0.5) / 255.0;
                    let l = if s <= 0.04045 { s / 12.92 } else { ((s + 0.055) / 1.055).powf(2.4) };
                    LIN_THRESHOLDS[i] = l as f32;
                }
                for i in 0..LIN_LUT_SIZE {
                    let l = (i as f64 + 0.5) / LIN_LUT_SIZE as f64;
                    let s = if l <= 0.0031308 { l * 12.92 } else { 1.055 * l.powf(1.0 / 2.4) - 0.055 };
                    LIN_TO_SRGB_LUT[i] = (s.clamp(0.0, 1.0) * 255.0).round().clamp(0.0, 255.0) as u8;
                }
                LIN_LUT_INIT = true;
            }
            (&LIN_TO_SRGB_LUT, &LIN_THRESHOLDS)
        }
    }
}

#[inline]
fn lin_to_srgb_u8(l: f32, lut: &[u8; LIN_LUT_SIZE], thresholds: &[f32; 255]) -> u8 {
    if l <= 0.0 { return 0; }
    if l >= 1.0 { return 255; }
    let idx = (l * LIN_LUT_SIZE as f32) as usize;
    // SAFETY: l in (0, 1) → idx in [0, LIN_LUT_SIZE-1].
    let mut u = unsafe { *lut.get_unchecked(idx.min(LIN_LUT_SIZE - 1)) };
    // Correct off-by-one from a straddling bucket. Only possible for small u
    // where the u8 region is narrower than one bucket; for larger u this never
    // triggers but the branches are cheap and well-predicted.
    if u < 255 && unsafe { *thresholds.get_unchecked(u as usize) } <= l { u += 1; }
    if u > 0 && unsafe { *thresholds.get_unchecked((u - 1) as usize) } > l { u -= 1; }
    u
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn error_diffuse_buffer(
    input: &[u8],
    output: &mut [u8],
    width: u32,
    height: u32,
    kernel: &[f64],
    kernel_width: u32,
    kernel_height: u32,
    offset_x: i32,
    offset_y: i32,
    serpentine: bool,
    row_alt: u32,
    linearize: bool,
    // Temporal bleed: when `temporal_bleed > 0` and both prev buffers are the
    // same length as `input`, the WASM path seeds the error buffer with
    // `(prev_input - prev_output) * temporal_bleed` — in linear space when
    // `linearize` is true — matching the JS factory's BLEED mode.
    prev_input: &[u8],
    prev_output: &[u8],
    temporal_bleed: f32,
    palette_mode: u32,
    levels: u32,
    palette: &[f64],
    ref_x: f64,
    ref_y: f64,
    ref_z: f64,
) {
    let w = width as usize;
    let h = height as usize;
    let kw = kernel_width as i32;
    let w_i = w as i32;
    let h_i = h as i32;

    // Precompute kernel entries, both directions.
    let mut entries: Vec<KEntry> = Vec::with_capacity((kernel_width * kernel_height) as usize);
    for eh in 0..kernel_height as i32 {
        for ew in 0..kernel_width as i32 {
            let v = kernel[(eh * kernel_width as i32 + ew) as usize];
            if v == 0.0 { continue; }
            let dx_fwd = ew + offset_x;
            // Reverse: kx = kw-1-w, tx = x + (kx+ox)*(-1), so effective dx is -(kw-1-w+ox).
            let dx_rev = -(kw - 1 - ew + offset_x);
            entries.push(KEntry { weight: v as f32, dx_fwd, dx_rev, dy: eh + offset_y });
        }
    }

    // Palette tables.
    let n_colors = palette.len() / 4;
    let mut pal_rgba: Vec<[u8; 4]> = Vec::with_capacity(n_colors);
    let mut pal_lab: Vec<[f64; 3]> = Vec::new();
    let mut pal_hsv: Vec<[f64; 3]> = Vec::new();
    for i in 0..n_colors {
        let r = palette[i*4]; let g = palette[i*4+1]; let b = palette[i*4+2]; let a = palette[i*4+3];
        pal_rgba.push([r as u8, g as u8, b as u8, a as u8]);
        match palette_mode {
            PAL_MODE_LAB => pal_lab.push(rgba2lab_inline(r, g, b, ref_x, ref_y, ref_z)),
            PAL_MODE_HSV => pal_hsv.push(rgb_to_hsv(r, g, b)),
            _ => {}
        }
    }

    // Reuse the persistent error buffer; only re-init the contents.
    let n_pixels = w * h;
    let err_len = n_pixels * 3;
    // SAFETY: WASM is single-threaded, so no concurrent access to ERR_BUF.
    let err: &mut [f32] = unsafe {
        #[allow(static_mut_refs)]
        {
            if ERR_BUF.len() < err_len {
                ERR_BUF.resize(err_len, 0.0);
            }
            &mut ERR_BUF[..err_len]
        }
    };
    let lut = srgb_to_lin_lut();
    let (lin_lut, lin_thresholds) = init_lin_luts();
    let has_bleed = temporal_bleed > 0.0
        && prev_input.len() == input.len()
        && prev_output.len() == input.len();
    for p in 0..n_pixels {
        // SAFETY: input.len() == n_pixels*4; err slice is n_pixels*3.
        unsafe {
            if linearize {
                let mut r = *lut.get_unchecked(*input.get_unchecked(p*4)     as usize);
                let mut g = *lut.get_unchecked(*input.get_unchecked(p*4 + 1) as usize);
                let mut b = *lut.get_unchecked(*input.get_unchecked(p*4 + 2) as usize);
                if has_bleed {
                    // Linear-space bleed: convert both prev frames through the LUT
                    // so deltas are measured in linear-light, matching the JS branch.
                    let pir = *lut.get_unchecked(*prev_input.get_unchecked(p*4)     as usize);
                    let pig = *lut.get_unchecked(*prev_input.get_unchecked(p*4 + 1) as usize);
                    let pib = *lut.get_unchecked(*prev_input.get_unchecked(p*4 + 2) as usize);
                    let por = *lut.get_unchecked(*prev_output.get_unchecked(p*4)     as usize);
                    let pog = *lut.get_unchecked(*prev_output.get_unchecked(p*4 + 1) as usize);
                    let pob = *lut.get_unchecked(*prev_output.get_unchecked(p*4 + 2) as usize);
                    r += (pir - por) * temporal_bleed;
                    g += (pig - pog) * temporal_bleed;
                    b += (pib - pob) * temporal_bleed;
                }
                *err.get_unchecked_mut(p*3)     = r;
                *err.get_unchecked_mut(p*3 + 1) = g;
                *err.get_unchecked_mut(p*3 + 2) = b;
            } else {
                let mut r = *input.get_unchecked(p*4)     as f32;
                let mut g = *input.get_unchecked(p*4 + 1) as f32;
                let mut b = *input.get_unchecked(p*4 + 2) as f32;
                if has_bleed {
                    let pir = *prev_input.get_unchecked(p*4)     as f32;
                    let pig = *prev_input.get_unchecked(p*4 + 1) as f32;
                    let pib = *prev_input.get_unchecked(p*4 + 2) as f32;
                    let por = *prev_output.get_unchecked(p*4)     as f32;
                    let pog = *prev_output.get_unchecked(p*4 + 1) as f32;
                    let pob = *prev_output.get_unchecked(p*4 + 2) as f32;
                    r += (pir - por) * temporal_bleed;
                    g += (pig - pog) * temporal_bleed;
                    b += (pib - pob) * temporal_bleed;
                }
                *err.get_unchecked_mut(p*3)     = r;
                *err.get_unchecked_mut(p*3 + 1) = g;
                *err.get_unchecked_mut(p*3 + 2) = b;
            }
        }
    }

    let step_f32 = if levels > 1 { 255.0 / (levels as f32 - 1.0) } else { 255.0 };

    for y in 0..h_i {
        let reverse = serpentine && row_reverse(y, h_i, row_alt);
        let (x_start, x_end, x_step): (i32, i32, i32) =
            if reverse { (w_i - 1, -1, -1) } else { (0, w_i, 1) };
        let mut x = x_start;
        while x != x_end {
            let pi = (y as usize) * w + (x as usize);
            let ei = pi * 3;
            // SAFETY: ei + 2 < err.len() by construction.
            let (pr, pg, pb) = unsafe {
                (*err.get_unchecked(ei), *err.get_unchecked(ei + 1), *err.get_unchecked(ei + 2))
            };

            // In linearize mode, feed the palette match an sRGB-u8-rounded pixel
            // (looked up through a 4K LUT so we avoid `powf` on the hot path),
            // then recover the linear-space quantized value via the sRGB→linear LUT.
            // Mirrors delinearizeColorF → getColor → linearizeColorF.
            let (sr, sg, sb) = if linearize {
                (
                    lin_to_srgb_u8(pr, lin_lut, lin_thresholds) as f32,
                    lin_to_srgb_u8(pg, lin_lut, lin_thresholds) as f32,
                    lin_to_srgb_u8(pb, lin_lut, lin_thresholds) as f32,
                )
            } else {
                (pr, pg, pb)
            };

            let (mut qr_f, mut qg_f, mut qb_f, qr_u8, qg_u8, qb_u8): (f32, f32, f32, u8, u8, u8) = match palette_mode {
                PAL_MODE_LEVELS => {
                    let qr = quant_levels_channel(sr, step_f32);
                    let qg = quant_levels_channel(sg, step_f32);
                    let qb = quant_levels_channel(sb, step_f32);
                    (qr, qg, qb, clamp_u8_f32(qr), clamp_u8_f32(qg), clamp_u8_f32(qb))
                }
                PAL_MODE_RGB => {
                    let mut best = 0usize;
                    let mut best_d = f32::MAX;
                    for (j, c) in pal_rgba.iter().enumerate() {
                        let dr = sr - c[0] as f32;
                        let dg = sg - c[1] as f32;
                        let db = sb - c[2] as f32;
                        let d = dr*dr + dg*dg + db*db;
                        if d < best_d { best_d = d; best = j; }
                    }
                    let c = pal_rgba[best];
                    (c[0] as f32, c[1] as f32, c[2] as f32, c[0], c[1], c[2])
                }
                PAL_MODE_RGB_APPROX => {
                    let mut best = 0usize;
                    let mut best_d = f32::MAX;
                    for (j, c) in pal_rgba.iter().enumerate() {
                        let rm = (sr + c[0] as f32) / 2.0;
                        let dr = sr - c[0] as f32;
                        let dg = sg - c[1] as f32;
                        let db = sb - c[2] as f32;
                        let d = (2.0 + rm / 256.0) * dr * dr
                              + 4.0 * dg * dg
                              + (2.0 + (255.0 - rm) / 256.0) * db * db;
                        if d < best_d { best_d = d; best = j; }
                    }
                    let c = pal_rgba[best];
                    (c[0] as f32, c[1] as f32, c[2] as f32, c[0], c[1], c[2])
                }
                PAL_MODE_HSV => {
                    let px = rgb_to_hsv(sr as f64, sg as f64, sb as f64);
                    let mut best = 0usize;
                    let mut best_d = f64::MAX;
                    for (j, ph) in pal_hsv.iter().enumerate() {
                        let dh_abs = (px[0] - ph[0]).abs();
                        let dh = dh_abs.min(360.0 - dh_abs) / 180.0;
                        let ds = (px[1] - ph[1]).abs();
                        let dv = (px[2] - ph[2]).abs();
                        let d = dh*dh + ds*ds + dv*dv;
                        if d < best_d { best_d = d; best = j; }
                    }
                    let c = pal_rgba[best];
                    (c[0] as f32, c[1] as f32, c[2] as f32, c[0], c[1], c[2])
                }
                PAL_MODE_LAB => {
                    let px = rgba2lab_inline(sr as f64, sg as f64, sb as f64, ref_x, ref_y, ref_z);
                    let mut best = 0usize;
                    let mut best_d = f64::MAX;
                    for (j, pl) in pal_lab.iter().enumerate() {
                        let d = (px[0]-pl[0]).powi(2)+(px[1]-pl[1]).powi(2)+(px[2]-pl[2]).powi(2);
                        if d < best_d { best_d = d; best = j; }
                    }
                    let c = pal_rgba[best];
                    (c[0] as f32, c[1] as f32, c[2] as f32, c[0], c[1], c[2])
                }
                _ => (0.0, 0.0, 0.0, 0, 0, 0),
            };

            // In linear mode, the error-feedback values must be in linear space.
            // JS linearizeColorF does `SRGB_TO_LINEAR_F[u8] ?? 0`, which treats
            // out-of-range lookups as 0. The LEVELS palette match stays in [0,255]
            // for any levels >= 1, so the u8 cast is safe here.
            if linearize {
                qr_f = lut[qr_u8 as usize];
                qg_f = lut[qg_u8 as usize];
                qb_f = lut[qb_u8 as usize];
            }

            // SAFETY: output.len() == input.len() == n_pixels*4.
            unsafe {
                *output.get_unchecked_mut(pi*4)     = qr_u8;
                *output.get_unchecked_mut(pi*4 + 1) = qg_u8;
                *output.get_unchecked_mut(pi*4 + 2) = qb_u8;
                *output.get_unchecked_mut(pi*4 + 3) = *input.get_unchecked(pi*4 + 3);
            }

            let er = pr - qr_f;
            let eg = pg - qg_f;
            let eb = pb - qb_f;

            for k in &entries {
                let dx = if reverse { k.dx_rev } else { k.dx_fwd };
                let tx = x + dx;
                let ty = y + k.dy;
                if tx < 0 || tx >= w_i || ty < 0 || ty >= h_i { continue; }
                let ti = ((ty as usize) * w + (tx as usize)) * 3;
                // SAFETY: tx/ty bounds-checked above, so ti+2 < err.len().
                unsafe {
                    *err.get_unchecked_mut(ti)     += er * k.weight;
                    *err.get_unchecked_mut(ti + 1) += eg * k.weight;
                    *err.get_unchecked_mut(ti + 2) += eb * k.weight;
                }
            }

            x += x_step;
        }
    }
}

// Custom-order error diffusion (Hilbert / Spiral / Diagonal / Random Pixel).
//
// Mirrors the `isCustomOrder` branch of errorDiffusingFilterFactory.ts. The JS
// side builds the visit order once per frame and pre-rotates the kernel for the
// ROTATE strategy; this WASM function consumes those buffers and runs the
// per-step palette-match + error-distribute hot loop, including the
// unvisited-weight scaling logic for RENORMALIZE / CLAMPED / DROP / ROTATE
// / SYMMETRIC.
//
// Tuple layout: `tuples` is a flat list of (dx_f32, dy_f32, weight_f32) triples
// for one or more kernels concatenated end-to-end. `kernel_starts` and
// `kernel_lens` (lengths in triples, not floats) describe where each kernel
// begins. For non-ROTATE strategies there's a single kernel; for ROTATE there
// are exactly four (one per cardinal direction, in the order forward, down,
// left, up).
// Strategy constants. RENORMALIZE (0) and SYMMETRIC (4) aren't matched by name
// in the hot loop — RENORMALIZE is the unscaled-not-clamped default arm and
// SYMMETRIC just means the JS side passed in the 8-neighbor tuple set as
// kernel 0; both flow through the same scaling path.
#[allow(dead_code)] const ERR_STRATEGY_RENORMALIZE: u32 = 0;
const ERR_STRATEGY_CLAMPED: u32 = 1;
const ERR_STRATEGY_DROP: u32 = 2;
const ERR_STRATEGY_ROTATE: u32 = 3;
#[allow(dead_code)] const ERR_STRATEGY_SYMMETRIC: u32 = 4;

const CLAMP_MAX_SCALE: f32 = 2.0;

#[inline]
fn snap_direction(dx: i32, dy: i32) -> u32 {
    let adx = dx.unsigned_abs() as i32;
    let ady = dy.unsigned_abs() as i32;
    if adx + ady == 0 || adx + ady > 2 { return 0; }
    if adx >= ady { return if dx >= 0 { 0 } else { 2 }; }
    if dy >= 0 { 1 } else { 3 }
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn error_diffuse_custom_order(
    input: &[u8],
    output: &mut [u8],
    width: u32,
    height: u32,
    visit_order: &[u32],
    tuples: &[f32],          // flat (dx, dy, weight) triples for all kernels
    kernel_starts: &[u32],   // start index per kernel, in triples
    kernel_lens: &[u32],     // length per kernel, in triples
    kernel_totals: &[f32],   // sum of weights per kernel
    err_strategy: u32,
    linearize: bool,
    prev_input: &[u8],
    prev_output: &[u8],
    temporal_bleed: f32,
    palette_mode: u32,
    levels: u32,
    palette: &[f64],
    ref_x: f64,
    ref_y: f64,
    ref_z: f64,
) {
    let w = width as usize;
    let h = height as usize;
    let w_i = w as i32;
    let h_i = h as i32;

    let lut = srgb_to_lin_lut();
    let (lin_lut, lin_thresholds) = init_lin_luts();

    let n_colors = palette.len() / 4;
    let mut pal_rgba: Vec<[u8; 4]> = Vec::with_capacity(n_colors);
    let mut pal_lab: Vec<[f64; 3]> = Vec::new();
    let mut pal_hsv: Vec<[f64; 3]> = Vec::new();
    for i in 0..n_colors {
        let r = palette[i*4]; let g = palette[i*4+1]; let b = palette[i*4+2]; let a = palette[i*4+3];
        pal_rgba.push([r as u8, g as u8, b as u8, a as u8]);
        match palette_mode {
            PAL_MODE_LAB => pal_lab.push(rgba2lab_inline(r, g, b, ref_x, ref_y, ref_z)),
            PAL_MODE_HSV => pal_hsv.push(rgb_to_hsv(r, g, b)),
            _ => {}
        }
    }

    // Reuse the persistent error buffer; resize if needed.
    let n_pixels = w * h;
    let err_len = n_pixels * 3;
    let err: &mut [f32] = unsafe {
        #[allow(static_mut_refs)]
        {
            if ERR_BUF.len() < err_len { ERR_BUF.resize(err_len, 0.0); }
            &mut ERR_BUF[..err_len]
        }
    };

    let has_bleed = temporal_bleed > 0.0
        && prev_input.len() == input.len()
        && prev_output.len() == input.len();
    for p in 0..n_pixels {
        unsafe {
            if linearize {
                let mut r = *lut.get_unchecked(*input.get_unchecked(p*4)     as usize);
                let mut g = *lut.get_unchecked(*input.get_unchecked(p*4 + 1) as usize);
                let mut b = *lut.get_unchecked(*input.get_unchecked(p*4 + 2) as usize);
                if has_bleed {
                    let pir = *lut.get_unchecked(*prev_input.get_unchecked(p*4)     as usize);
                    let pig = *lut.get_unchecked(*prev_input.get_unchecked(p*4 + 1) as usize);
                    let pib = *lut.get_unchecked(*prev_input.get_unchecked(p*4 + 2) as usize);
                    let por = *lut.get_unchecked(*prev_output.get_unchecked(p*4)     as usize);
                    let pog = *lut.get_unchecked(*prev_output.get_unchecked(p*4 + 1) as usize);
                    let pob = *lut.get_unchecked(*prev_output.get_unchecked(p*4 + 2) as usize);
                    r += (pir - por) * temporal_bleed;
                    g += (pig - pog) * temporal_bleed;
                    b += (pib - pob) * temporal_bleed;
                }
                *err.get_unchecked_mut(p*3)     = r;
                *err.get_unchecked_mut(p*3 + 1) = g;
                *err.get_unchecked_mut(p*3 + 2) = b;
            } else {
                let mut r = *input.get_unchecked(p*4)     as f32;
                let mut g = *input.get_unchecked(p*4 + 1) as f32;
                let mut b = *input.get_unchecked(p*4 + 2) as f32;
                if has_bleed {
                    let pir = *prev_input.get_unchecked(p*4)     as f32;
                    let pig = *prev_input.get_unchecked(p*4 + 1) as f32;
                    let pib = *prev_input.get_unchecked(p*4 + 2) as f32;
                    let por = *prev_output.get_unchecked(p*4)     as f32;
                    let pog = *prev_output.get_unchecked(p*4 + 1) as f32;
                    let pob = *prev_output.get_unchecked(p*4 + 2) as f32;
                    r += (pir - por) * temporal_bleed;
                    g += (pig - pog) * temporal_bleed;
                    b += (pib - pob) * temporal_bleed;
                }
                *err.get_unchecked_mut(p*3)     = r;
                *err.get_unchecked_mut(p*3 + 1) = g;
                *err.get_unchecked_mut(p*3 + 2) = b;
            }
        }
    }

    let mut visited = vec![0u8; n_pixels];

    let step_levels = if levels > 1 { 255.0 / (levels as f32 - 1.0) } else { 255.0 };

    for step in 0..visit_order.len() {
        let linear_idx = visit_order[step] as usize;
        if linear_idx >= n_pixels { continue; }
        visited[linear_idx] = 1;
        let x = (linear_idx % w) as i32;
        let y = (linear_idx / w) as i32;
        let ei = linear_idx * 3;
        let pr = err[ei];
        let pg = err[ei + 1];
        let pb = err[ei + 2];

        // Choose the active kernel for this step.
        let kernel_index: usize = if err_strategy == ERR_STRATEGY_ROTATE && step + 1 < visit_order.len() {
            let next_idx = visit_order[step + 1] as usize;
            let nx = (next_idx % w) as i32;
            let ny = (next_idx / w) as i32;
            snap_direction(nx - x, ny - y) as usize
        } else {
            0
        };
        let k_start = kernel_starts[kernel_index] as usize;
        let k_len = kernel_lens[kernel_index] as usize;
        let k_total = kernel_totals[kernel_index];

        // Palette match — same five palette modes as the row-major path.
        let (sr, sg, sb) = if linearize {
            (
                lin_to_srgb_u8(pr, lin_lut, lin_thresholds) as f32,
                lin_to_srgb_u8(pg, lin_lut, lin_thresholds) as f32,
                lin_to_srgb_u8(pb, lin_lut, lin_thresholds) as f32,
            )
        } else { (pr, pg, pb) };

        let (mut qr_f, mut qg_f, mut qb_f, qr_u8, qg_u8, qb_u8): (f32, f32, f32, u8, u8, u8) = match palette_mode {
            PAL_MODE_LEVELS => {
                let qr = quant_levels_channel(sr, step_levels);
                let qg = quant_levels_channel(sg, step_levels);
                let qb = quant_levels_channel(sb, step_levels);
                (qr, qg, qb, clamp_u8_f32(qr), clamp_u8_f32(qg), clamp_u8_f32(qb))
            }
            PAL_MODE_RGB => {
                let mut best = 0usize; let mut best_d = f32::MAX;
                for (j, c) in pal_rgba.iter().enumerate() {
                    let dr = sr - c[0] as f32;
                    let dg = sg - c[1] as f32;
                    let db = sb - c[2] as f32;
                    let d = dr*dr + dg*dg + db*db;
                    if d < best_d { best_d = d; best = j; }
                }
                let c = pal_rgba[best];
                (c[0] as f32, c[1] as f32, c[2] as f32, c[0], c[1], c[2])
            }
            PAL_MODE_RGB_APPROX => {
                let mut best = 0usize; let mut best_d = f32::MAX;
                for (j, c) in pal_rgba.iter().enumerate() {
                    let rm = (sr + c[0] as f32) / 2.0;
                    let dr = sr - c[0] as f32;
                    let dg = sg - c[1] as f32;
                    let db = sb - c[2] as f32;
                    let d = (2.0 + rm / 256.0) * dr * dr
                          + 4.0 * dg * dg
                          + (2.0 + (255.0 - rm) / 256.0) * db * db;
                    if d < best_d { best_d = d; best = j; }
                }
                let c = pal_rgba[best];
                (c[0] as f32, c[1] as f32, c[2] as f32, c[0], c[1], c[2])
            }
            PAL_MODE_HSV => {
                let px = rgb_to_hsv(sr as f64, sg as f64, sb as f64);
                let mut best = 0usize; let mut best_d = f64::MAX;
                for (j, ph) in pal_hsv.iter().enumerate() {
                    let dh_abs = (px[0] - ph[0]).abs();
                    let dh = dh_abs.min(360.0 - dh_abs) / 180.0;
                    let ds = (px[1] - ph[1]).abs();
                    let dv = (px[2] - ph[2]).abs();
                    let d = dh*dh + ds*ds + dv*dv;
                    if d < best_d { best_d = d; best = j; }
                }
                let c = pal_rgba[best];
                (c[0] as f32, c[1] as f32, c[2] as f32, c[0], c[1], c[2])
            }
            PAL_MODE_LAB => {
                let px = rgba2lab_inline(sr as f64, sg as f64, sb as f64, ref_x, ref_y, ref_z);
                let mut best = 0usize; let mut best_d = f64::MAX;
                for (j, pl) in pal_lab.iter().enumerate() {
                    let d = (px[0]-pl[0]).powi(2)+(px[1]-pl[1]).powi(2)+(px[2]-pl[2]).powi(2);
                    if d < best_d { best_d = d; best = j; }
                }
                let c = pal_rgba[best];
                (c[0] as f32, c[1] as f32, c[2] as f32, c[0], c[1], c[2])
            }
            _ => (0.0, 0.0, 0.0, 0, 0, 0),
        };

        if linearize {
            qr_f = lut[qr_u8 as usize];
            qg_f = lut[qg_u8 as usize];
            qb_f = lut[qb_u8 as usize];
        }

        // SAFETY: linear_idx < n_pixels so linear_idx*4 + 3 < input.len().
        unsafe {
            *output.get_unchecked_mut(linear_idx*4)     = qr_u8;
            *output.get_unchecked_mut(linear_idx*4 + 1) = qg_u8;
            *output.get_unchecked_mut(linear_idx*4 + 2) = qb_u8;
            *output.get_unchecked_mut(linear_idx*4 + 3) = *input.get_unchecked(linear_idx*4 + 3);
        }

        let er = pr - qr_f;
        let eg = pg - qg_f;
        let eb = pb - qb_f;

        // Compute scale factor (skipped for DROP, since DROP keeps weights as-is).
        let mut scale: f32 = 1.0;
        if err_strategy != ERR_STRATEGY_DROP {
            let mut unvisited_weight: f32 = 0.0;
            for k in 0..k_len {
                let base = (k_start + k) * 3;
                let dx = tuples[base] as i32;
                let dy = tuples[base + 1] as i32;
                let weight = tuples[base + 2];
                let tx = x + dx; let ty = y + dy;
                if tx < 0 || tx >= w_i || ty < 0 || ty >= h_i { continue; }
                if visited[ty as usize * w + tx as usize] != 0 { continue; }
                unvisited_weight += weight;
            }
            if unvisited_weight == 0.0 { continue; }
            scale = k_total / unvisited_weight;
            if err_strategy == ERR_STRATEGY_CLAMPED && scale > CLAMP_MAX_SCALE {
                scale = CLAMP_MAX_SCALE;
            }
        }

        for k in 0..k_len {
            let base = (k_start + k) * 3;
            let dx = tuples[base] as i32;
            let dy = tuples[base + 1] as i32;
            let weight = tuples[base + 2];
            let tx = x + dx; let ty = y + dy;
            if tx < 0 || tx >= w_i || ty < 0 || ty >= h_i { continue; }
            let target = ty as usize * w + tx as usize;
            if visited[target] != 0 { continue; }
            let ti = target * 3;
            let w_eff = weight * scale;
            unsafe {
                *err.get_unchecked_mut(ti)     += er * w_eff;
                *err.get_unchecked_mut(ti + 1) += eg * w_eff;
                *err.get_unchecked_mut(ti + 2) += eb * w_eff;
            }
        }
    }
}

// Ordered dither in linear-light space in a single WASM call.
//
// Mirrors the linearize branch of src/filters/ordered.ts: linearize the input
// via the sRGB→linear LUT, apply `bias = step * (t - 0.5)` quantization per
// channel (including the `round(x * 1e6) / 1e6` bit-precision trick the JS
// path uses), then convert the dithered linear value back to an sRGB u8 via
// our linear→sRGB LUT + threshold correction. Finally does the palette match
// (same five palette modes as error_diffuse_buffer).
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn ordered_dither_linear_buffer(
    input: &[u8],
    output: &mut [u8],
    width: u32,
    height: u32,
    threshold_map: &[f64],
    threshold_w: u32,
    threshold_h: u32,
    temporal_ox: u32,
    temporal_oy: u32,
    ordered_levels: u32,
    palette_mode: u32,
    levels: u32,
    palette: &[f64],
    ref_x: f64,
    ref_y: f64,
    ref_z: f64,
) {
    let w = width as usize;
    let h = height as usize;
    let tw = threshold_w as usize;
    let th = threshold_h as usize;
    let tox = temporal_ox as usize;
    let toy = temporal_oy as usize;

    let srgb_lin = srgb_to_lin_lut();
    let (lin_lut, lin_thresholds) = init_lin_luts();

    let n_colors = palette.len() / 4;
    let mut pal_rgba: Vec<[u8; 4]> = Vec::with_capacity(n_colors);
    let mut pal_lab: Vec<[f64; 3]> = Vec::new();
    let mut pal_hsv: Vec<[f64; 3]> = Vec::new();
    for i in 0..n_colors {
        let r = palette[i*4]; let g = palette[i*4+1]; let b = palette[i*4+2]; let a = palette[i*4+3];
        pal_rgba.push([r as u8, g as u8, b as u8, a as u8]);
        match palette_mode {
            PAL_MODE_LAB => pal_lab.push(rgba2lab_inline(r, g, b, ref_x, ref_y, ref_z)),
            PAL_MODE_HSV => pal_hsv.push(rgb_to_hsv(r, g, b)),
            _ => {}
        }
    }

    let step_f = if ordered_levels > 1 { 1.0 / (ordered_levels as f32 - 1.0) } else { 1.0 };
    let step_levels = if levels > 1 { 255.0 / (levels as f32 - 1.0) } else { 255.0 };

    for y in 0..h {
        let ty = (y + toy) % th;
        for x in 0..w {
            let pi = y * w + x;
            let tx = (x + tox) % tw;
            // SAFETY: (tx, ty) in bounds by modulo.
            let t = unsafe { *threshold_map.get_unchecked(ty * tw + tx) } as f32;
            let bias = step_f * (t - 0.5);

            // Linearize each channel through the LUT, apply the ordered-dither
            // quantization, and round-trip to sRGB u8.
            let r_u8 = unsafe { *input.get_unchecked(pi * 4) } as usize;
            let g_u8 = unsafe { *input.get_unchecked(pi * 4 + 1) } as usize;
            let b_u8 = unsafe { *input.get_unchecked(pi * 4 + 2) } as usize;
            let lr = unsafe { *srgb_lin.get_unchecked(r_u8) };
            let lg = unsafe { *srgb_lin.get_unchecked(g_u8) };
            let lb = unsafe { *srgb_lin.get_unchecked(b_u8) };

            let q = |l: f32| -> f32 {
                let v = ((l + bias) / step_f).round() * step_f;
                (v * 1e6).round() / 1e6
            };
            let ldr = q(lr);
            let ldg = q(lg);
            let ldb = q(lb);

            let mut sr = lin_to_srgb_u8(ldr, lin_lut, lin_thresholds) as f32;
            let mut sg = lin_to_srgb_u8(ldg, lin_lut, lin_thresholds) as f32;
            let mut sb = lin_to_srgb_u8(ldb, lin_lut, lin_thresholds) as f32;

            let (qr_u8, qg_u8, qb_u8): (u8, u8, u8) = match palette_mode {
                PAL_MODE_LEVELS => {
                    let qr = js_round_f32(js_round_f32(sr / step_levels) * step_levels);
                    let qg = js_round_f32(js_round_f32(sg / step_levels) * step_levels);
                    let qb = js_round_f32(js_round_f32(sb / step_levels) * step_levels);
                    (clamp_u8_f32(qr), clamp_u8_f32(qg), clamp_u8_f32(qb))
                }
                PAL_MODE_RGB => {
                    let mut best = 0usize;
                    let mut best_d = f32::MAX;
                    for (j, c) in pal_rgba.iter().enumerate() {
                        let dr = sr - c[0] as f32;
                        let dg = sg - c[1] as f32;
                        let db = sb - c[2] as f32;
                        let d = dr*dr + dg*dg + db*db;
                        if d < best_d { best_d = d; best = j; }
                    }
                    let c = pal_rgba[best]; (c[0], c[1], c[2])
                }
                PAL_MODE_RGB_APPROX => {
                    let mut best = 0usize;
                    let mut best_d = f32::MAX;
                    for (j, c) in pal_rgba.iter().enumerate() {
                        let rm = (sr + c[0] as f32) / 2.0;
                        let dr = sr - c[0] as f32;
                        let dg = sg - c[1] as f32;
                        let db = sb - c[2] as f32;
                        let d = (2.0 + rm / 256.0) * dr * dr
                              + 4.0 * dg * dg
                              + (2.0 + (255.0 - rm) / 256.0) * db * db;
                        if d < best_d { best_d = d; best = j; }
                    }
                    let c = pal_rgba[best]; (c[0], c[1], c[2])
                }
                PAL_MODE_HSV => {
                    let px = rgb_to_hsv(sr as f64, sg as f64, sb as f64);
                    let mut best = 0usize;
                    let mut best_d = f64::MAX;
                    for (j, ph) in pal_hsv.iter().enumerate() {
                        let dh_abs = (px[0] - ph[0]).abs();
                        let dh = dh_abs.min(360.0 - dh_abs) / 180.0;
                        let ds = (px[1] - ph[1]).abs();
                        let dv = (px[2] - ph[2]).abs();
                        let d = dh*dh + ds*ds + dv*dv;
                        if d < best_d { best_d = d; best = j; }
                    }
                    let c = pal_rgba[best]; (c[0], c[1], c[2])
                }
                PAL_MODE_LAB => {
                    let px = rgba2lab_inline(sr as f64, sg as f64, sb as f64, ref_x, ref_y, ref_z);
                    let mut best = 0usize;
                    let mut best_d = f64::MAX;
                    for (j, pl) in pal_lab.iter().enumerate() {
                        let d = (px[0]-pl[0]).powi(2)+(px[1]-pl[1]).powi(2)+(px[2]-pl[2]).powi(2);
                        if d < best_d { best_d = d; best = j; }
                    }
                    let c = pal_rgba[best]; (c[0], c[1], c[2])
                }
                _ => { sr = 0.0; sg = 0.0; sb = 0.0; (0, 0, 0) }
            };
            let _ = (sr, sg, sb);

            // SAFETY: pi*4 + 3 < output.len() by construction.
            unsafe {
                *output.get_unchecked_mut(pi * 4)     = qr_u8;
                *output.get_unchecked_mut(pi * 4 + 1) = qg_u8;
                *output.get_unchecked_mut(pi * 4 + 2) = qb_u8;
                *output.get_unchecked_mut(pi * 4 + 3) = *input.get_unchecked(pi * 4 + 3);
            }
        }
    }
}

/// Quantize buffer using HSV distance with circular hue.
#[wasm_bindgen]
pub fn quantize_buffer_hsv(buffer: &[u8], palette: &[f64]) -> Vec<u8> {
    let n_colors = palette.len() / 4;
    let mut pal_hsv: Vec<[f64; 3]> = Vec::with_capacity(n_colors);
    let mut pal_rgba: Vec<[u8; 4]> = Vec::with_capacity(n_colors);
    for i in 0..n_colors {
        pal_hsv.push(rgb_to_hsv(palette[i*4], palette[i*4+1], palette[i*4+2]));
        pal_rgba.push([palette[i*4] as u8, palette[i*4+1] as u8,
                       palette[i*4+2] as u8, palette[i*4+3] as u8]);
    }

    let n_pixels = buffer.len() / 4;
    let mut out = vec![0u8; buffer.len()];
    for p in 0..n_pixels {
        let i = p * 4;
        let px = rgb_to_hsv(buffer[i] as f64, buffer[i+1] as f64, buffer[i+2] as f64);

        let mut best = 0;
        let mut best_d = f64::MAX;
        for (j, ph) in pal_hsv.iter().enumerate() {
            let dh_abs = (px[0] - ph[0]).abs();
            let dh = dh_abs.min(360.0 - dh_abs) / 180.0;
            let ds = (px[1] - ph[1]).abs();
            let dv = (px[2] - ph[2]).abs();
            let d = dh * dh + ds * ds + dv * dv;
            if d < best_d { best_d = d; best = j; }
        }
        out[i]   = pal_rgba[best][0];
        out[i+1] = pal_rgba[best][1];
        out[i+2] = pal_rgba[best][2];
        out[i+3] = buffer[i+3];
    }
    out
}

// === Anime Color Grade ===
//
// Port of src/filters/animeColorGrade.ts: per-pixel tone curve (black/white
// points, contrast, midtone lift) → luminance-weighted cool/warm tint blend
// → partial luminance restore → vibrance boost → mix with source. Pure
// per-pixel (no neighborhood), which lets us walk the RGBA buffer linearly.
// All math is in f64 to match the JS semantics; the intermediate clamps and
// Math.round/Math.pow calls are reproduced faithfully.

#[inline]
fn smoothstep_f64(edge0: f64, edge1: f64, value: f64) -> f64 {
    let t = ((value - edge0) / (edge1 - edge0).max(1e-6)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[inline]
fn lerp_f64(a: f64, b: f64, t: f64) -> f64 { a + (b - a) * t }

#[inline]
fn clamp_round_u8(x: f64) -> u8 { x.round().clamp(0.0, 255.0) as u8 }

#[inline]
fn apply_tone(value: f64, black_point: f64, white_point: f64, contrast: f64, midtone_lift: f64) -> f64 {
    let mut n = ((value - black_point) / (white_point - black_point).max(1.0)).clamp(0.0, 1.0);
    if contrast != 0.0 {
        n = (0.5 + (n - 0.5) * (1.0 + contrast)).clamp(0.0, 1.0);
    }
    let gamma = (1.0 - midtone_lift).clamp(0.25, 3.0);
    n = n.powf(gamma);
    (n * 255.0).round().clamp(0.0, 255.0)
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn anime_color_grade_buffer(
    input: &[u8],
    output: &mut [u8],
    shadow_cool: f64,
    highlight_warm: f64,
    black_point: f64,
    white_point: f64,
    contrast: f64,
    midtone_lift: f64,
    vibrance: f64,
    mix: f64,
) {
    // apply_tone only depends on the per-channel byte value plus the four
    // option scalars, so precompute a 256-entry f64 LUT once to spare every
    // pixel the contrast + powf round-trip.
    let mut tone_lut = [0.0f64; 256];
    for v in 0..256 {
        tone_lut[v] = apply_tone(v as f64, black_point, white_point, contrast, midtone_lift);
    }

    let n_pixels = input.len() / 4;
    for p in 0..n_pixels {
        let i = p * 4;
        let (sr_u, sg_u, sb_u, sa) = unsafe {
            (
                *input.get_unchecked(i) as usize,
                *input.get_unchecked(i + 1) as usize,
                *input.get_unchecked(i + 2) as usize,
                *input.get_unchecked(i + 3),
            )
        };

        // SAFETY: each s*_u is a u8 → always < 256.
        let (base_r, base_g, base_b) = unsafe {
            (
                *tone_lut.get_unchecked(sr_u),
                *tone_lut.get_unchecked(sg_u),
                *tone_lut.get_unchecked(sb_u),
            )
        };

        let tone_luma = (0.2126 * base_r + 0.7152 * base_g + 0.0722 * base_b) / 255.0;
        let shadow_weight = 1.0 - smoothstep_f64(0.24, 0.72, tone_luma);
        let highlight_weight = smoothstep_f64(0.34, 0.84, tone_luma);

        let mut graded_r = base_r - shadow_weight * shadow_cool * 28.0 + highlight_weight * highlight_warm * 36.0;
        let mut graded_g = base_g + shadow_weight * shadow_cool * 16.0 + highlight_weight * highlight_warm * 12.0;
        let mut graded_b = base_b + shadow_weight * shadow_cool * 44.0 - highlight_weight * highlight_warm * 16.0;

        let cool_strength = shadow_weight * shadow_cool;
        let warm_strength = highlight_weight * highlight_warm;

        let cool_tint_r = base_r * (1.0 - 0.22 * cool_strength);
        let cool_tint_g = base_g * (1.0 + 0.05 * cool_strength);
        let cool_tint_b = base_b * (1.0 + 0.22 * cool_strength);

        let warm_tint_r = base_r * (1.0 + 0.18 * warm_strength);
        let warm_tint_g = base_g * (1.0 + 0.07 * warm_strength);
        let warm_tint_b = base_b * (1.0 - 0.16 * warm_strength);

        graded_r = lerp_f64(graded_r, cool_tint_r, 0.65 * cool_strength);
        graded_g = lerp_f64(graded_g, cool_tint_g, 0.65 * cool_strength);
        graded_b = lerp_f64(graded_b, cool_tint_b, 0.65 * cool_strength);

        graded_r = lerp_f64(graded_r, warm_tint_r, 0.75 * warm_strength);
        graded_g = lerp_f64(graded_g, warm_tint_g, 0.75 * warm_strength);
        graded_b = lerp_f64(graded_b, warm_tint_b, 0.75 * warm_strength);

        let base_lum = 0.2126 * base_r + 0.7152 * base_g + 0.0722 * base_b;
        let graded_lum = 0.2126 * graded_r + 0.7152 * graded_g + 0.0722 * graded_b;
        let lum_delta = base_lum - graded_lum;
        let lum_restore = 0.45;
        let mut gr = clamp_round_u8(lerp_f64(graded_r, graded_r + lum_delta, lum_restore)) as f64;
        let mut gg = clamp_round_u8(lerp_f64(graded_g, graded_g + lum_delta, lum_restore)) as f64;
        let mut gb = clamp_round_u8(lerp_f64(graded_b, graded_b + lum_delta, lum_restore)) as f64;

        // Vibrance boost (skip when <= 0, matching the JS short-circuit).
        if vibrance > 0.0 {
            let avg = (gr + gg + gb) / 3.0;
            let max_c = gr.max(gg).max(gb);
            let min_c = gr.min(gg).min(gb);
            let saturation = (max_c - min_c) / 255.0;
            let boost = 1.0 + vibrance * (1.0 - saturation);
            gr = (avg + (gr - avg) * boost).round().clamp(0.0, 255.0);
            gg = (avg + (gg - avg) * boost).round().clamp(0.0, 255.0);
            gb = (avg + (gb - avg) * boost).round().clamp(0.0, 255.0);
        }

        let final_r = clamp_round_u8(base_r + (gr - base_r) * mix);
        let final_g = clamp_round_u8(base_g + (gg - base_g) * mix);
        let final_b = clamp_round_u8(base_b + (gb - base_b) * mix);

        unsafe {
            *output.get_unchecked_mut(i)     = final_r;
            *output.get_unchecked_mut(i + 1) = final_g;
            *output.get_unchecked_mut(i + 2) = final_b;
            *output.get_unchecked_mut(i + 3) = sa;
        }
    }
}

// === Median filter (circular neighborhood) ===
//
// Mirrors src/filters/medianFilter.ts: for each pixel, collect samples from a
// circular neighborhood (dx² + dy² ≤ r²) with clamp-to-edge, sort each RGB
// channel, pick the middle sample. The outer (dy, dx) pattern is fixed for a
// given radius so we precompute it once. Sort is insertion-sort (same as JS,
// and fast for the < 300 samples the largest supported radius gives).

#[wasm_bindgen]
pub fn median_filter_buffer(
    input: &[u8],
    output: &mut [u8],
    width: u32,
    height: u32,
    radius: u32,
) {
    let w = width as usize;
    let h = height as usize;
    let r = radius as i32;
    if w == 0 || h == 0 { return; }

    // Precompute the (dy, dx) offset list that passes the circular test.
    let r_sq = r * r;
    let mut offsets: Vec<(i32, i32)> = Vec::new();
    for dy in -r..=r {
        for dx in -r..=r {
            if dx * dx + dy * dy <= r_sq {
                offsets.push((dy, dx));
            }
        }
    }
    let k = offsets.len();
    let mid = k / 2;

    // Counting-sort median. For u8 inputs this is O(256 + k) per channel per
    // pixel, which beats insertion sort once k is ~40+. Below that the 256-
    // bucket pass dominates and insertion sort's tight inner loop wins, so we
    // fall back to it for small neighborhoods (radius ≤ 3).
    //
    // `k` is bounded by (2r+1)² which is ≤ 289 at the filter's max radius (8)
    // so the per-bucket counter fits in u16.
    fn median_counting(vals: &[u8], mid: usize) -> u8 {
        let mut hist = [0u16; 256];
        for &v in vals {
            unsafe { *hist.get_unchecked_mut(v as usize) += 1; }
        }
        let mut accum: usize = 0;
        for (i, &c) in hist.iter().enumerate() {
            accum += c as usize;
            if accum > mid { return i as u8; }
        }
        255
    }

    fn median_insertion(arr: &mut [u8], mid: usize) -> u8 {
        for i in 1..arr.len() {
            let key = unsafe { *arr.get_unchecked(i) };
            let mut j = i;
            while j > 0 && unsafe { *arr.get_unchecked(j - 1) } > key {
                unsafe { *arr.get_unchecked_mut(j) = *arr.get_unchecked(j - 1); }
                j -= 1;
            }
            unsafe { *arr.get_unchecked_mut(j) = key; }
        }
        unsafe { *arr.get_unchecked(mid) }
    }

    // Scratch buffers for per-pixel sample collection.
    let mut r_arr = vec![0u8; k];
    let mut g_arr = vec![0u8; k];
    let mut b_arr = vec![0u8; k];
    let use_counting = k >= 40;

    let w_i = w as i32;
    let h_i = h as i32;
    for y in 0..h_i {
        for x in 0..w_i {
            // Gather samples from the circular neighborhood with clamp-to-edge.
            for (idx, (dy, dx)) in offsets.iter().enumerate() {
                let nx = (x + dx).clamp(0, w_i - 1) as usize;
                let ny = (y + dy).clamp(0, h_i - 1) as usize;
                let ni = (ny * w + nx) * 4;
                unsafe {
                    *r_arr.get_unchecked_mut(idx) = *input.get_unchecked(ni);
                    *g_arr.get_unchecked_mut(idx) = *input.get_unchecked(ni + 1);
                    *b_arr.get_unchecked_mut(idx) = *input.get_unchecked(ni + 2);
                }
            }
            let (rm, gm, bm) = if use_counting {
                (median_counting(&r_arr, mid), median_counting(&g_arr, mid), median_counting(&b_arr, mid))
            } else {
                (median_insertion(&mut r_arr, mid), median_insertion(&mut g_arr, mid), median_insertion(&mut b_arr, mid))
            };
            let i = ((y as usize) * w + (x as usize)) * 4;
            unsafe {
                *output.get_unchecked_mut(i)     = rm;
                *output.get_unchecked_mut(i + 1) = gm;
                *output.get_unchecked_mut(i + 2) = bm;
                *output.get_unchecked_mut(i + 3) = *input.get_unchecked(i + 3);
            }
        }
    }
}

// === Bloom (threshold → separable box blur → additive composite) ===
//
// Matches src/filters/bloom.ts. The relative-vs-absolute threshold choice
// happens JS-side (needs a full-buffer max-luminance scan anyway); WASM just
// receives the resolved threshold along with strength and radius. We do the
// two separable box-blur passes via f32 running sums with clamp-to-edge
// (not integral images, because JS's per-pixel `sr/count` normalisation
// includes trimmed counts at the edges — this matches it bit-for-bit).

#[wasm_bindgen]
pub fn bloom_buffer(
    input: &[u8],
    output: &mut [u8],
    width: u32,
    height: u32,
    threshold: f32,
    strength: f32,
    radius: u32,
) {
    let w = width as usize;
    let h = height as usize;
    let r = radius as usize;
    if w == 0 || h == 0 { return; }
    let n = w * h;

    // Bright buffer: max(0, channel - threshold). Alpha is passed through as-is.
    let mut bright_r = vec![0.0f32; n];
    let mut bright_g = vec![0.0f32; n];
    let mut bright_b = vec![0.0f32; n];
    for p in 0..n {
        let si = p * 4;
        unsafe {
            bright_r[p] = (*input.get_unchecked(si)     as f32 - threshold).max(0.0);
            bright_g[p] = (*input.get_unchecked(si + 1) as f32 - threshold).max(0.0);
            bright_b[p] = (*input.get_unchecked(si + 2) as f32 - threshold).max(0.0);
        }
    }

    // Horizontal box blur via a running sum. For each row we prime the window
    // with clamp-to-edge left side, then slide: add the right neighbour's value,
    // subtract the left neighbour's value. `count` always equals 2r+1 at the
    // interior and grows/shrinks at the edges to match JS's trimmed behaviour
    // (which keeps a smaller count near the borders — see `count += 1` in the
    // JS loop skipping nothing).
    //
    // Actually the JS path uses a fixed `count += 1` inside the loop so at the
    // edges `count = 2r+1` regardless — the clamp just duplicates an edge
    // sample. Running sum handles that naturally: we add the clamped sample at
    // every step.

    let mut blur_h_r = vec![0.0f32; n];
    let mut blur_h_g = vec![0.0f32; n];
    let mut blur_h_b = vec![0.0f32; n];
    let k_size = 2 * r + 1;
    let count = k_size as f32;
    for y in 0..h {
        let row = y * w;
        // Prime the window: sum over clamped-left samples for x=0.
        let mut sr = 0.0f32;
        let mut sg = 0.0f32;
        let mut sb = 0.0f32;
        for k in 0..k_size {
            let raw = k as i32 - r as i32;
            let nx = raw.clamp(0, w as i32 - 1) as usize;
            sr += bright_r[row + nx];
            sg += bright_g[row + nx];
            sb += bright_b[row + nx];
        }
        blur_h_r[row] = sr / count;
        blur_h_g[row] = sg / count;
        blur_h_b[row] = sb / count;
        // Slide for x = 1 .. w-1.
        for x in 1..w {
            let add_x = (x as i32 + r as i32).clamp(0, w as i32 - 1) as usize;
            let sub_x = (x as i32 - 1 - r as i32).clamp(0, w as i32 - 1) as usize;
            sr += bright_r[row + add_x] - bright_r[row + sub_x];
            sg += bright_g[row + add_x] - bright_g[row + sub_x];
            sb += bright_b[row + add_x] - bright_b[row + sub_x];
            blur_h_r[row + x] = sr / count;
            blur_h_g[row + x] = sg / count;
            blur_h_b[row + x] = sb / count;
        }
    }

    // Vertical box blur, same running-sum pattern over columns.
    let mut blur_hv_r = vec![0.0f32; n];
    let mut blur_hv_g = vec![0.0f32; n];
    let mut blur_hv_b = vec![0.0f32; n];
    for x in 0..w {
        let mut sr = 0.0f32;
        let mut sg = 0.0f32;
        let mut sb = 0.0f32;
        for k in 0..k_size {
            let raw = k as i32 - r as i32;
            let ny = raw.clamp(0, h as i32 - 1) as usize;
            sr += blur_h_r[ny * w + x];
            sg += blur_h_g[ny * w + x];
            sb += blur_h_b[ny * w + x];
        }
        blur_hv_r[x] = sr / count;
        blur_hv_g[x] = sg / count;
        blur_hv_b[x] = sb / count;
        for y in 1..h {
            let add_y = (y as i32 + r as i32).clamp(0, h as i32 - 1) as usize;
            let sub_y = (y as i32 - 1 - r as i32).clamp(0, h as i32 - 1) as usize;
            sr += blur_h_r[add_y * w + x] - blur_h_r[sub_y * w + x];
            sg += blur_h_g[add_y * w + x] - blur_h_g[sub_y * w + x];
            sb += blur_h_b[add_y * w + x] - blur_h_b[sub_y * w + x];
            blur_hv_r[y * w + x] = sr / count;
            blur_hv_g[y * w + x] = sg / count;
            blur_hv_b[y * w + x] = sb / count;
        }
    }

    // Composite: original + blur * strength, clamped to 255. Alpha passes through.
    for p in 0..n {
        let i = p * 4;
        unsafe {
            let ir = *input.get_unchecked(i)     as f32;
            let ig = *input.get_unchecked(i + 1) as f32;
            let ib = *input.get_unchecked(i + 2) as f32;
            let ia = *input.get_unchecked(i + 3);
            let nr = (ir + blur_hv_r[p] * strength).min(255.0);
            let ng = (ig + blur_hv_g[p] * strength).min(255.0);
            let nb = (ib + blur_hv_b[p] * strength).min(255.0);
            *output.get_unchecked_mut(i)     = nr as u8;
            *output.get_unchecked_mut(i + 1) = ng as u8;
            *output.get_unchecked_mut(i + 2) = nb as u8;
            *output.get_unchecked_mut(i + 3) = ia;
        }
    }
}

// === Gaussian blur (separable 1D) ===
//
// Mirrors src/filters/gaussianBlur.ts: build a 1D Gaussian kernel of radius
// ceil(sigma * 3), normalize, then run horizontal + vertical passes with
// clamp-to-edge edges. The horizontal pass accumulates into an f32 scratch
// buffer and the vertical pass writes u8 output rounded via JS Math.round
// semantics so parity is preserved.

#[wasm_bindgen]
pub fn gaussian_blur_buffer(
    input: &[u8],
    output: &mut [u8],
    width: u32,
    height: u32,
    sigma: f64,
) {
    let w = width as usize;
    let h = height as usize;
    if w == 0 || h == 0 { return; }

    // Kernel.
    let radius = (sigma * 3.0).ceil() as usize;
    let k_size = radius * 2 + 1;
    let two_sigma_sq = 2.0 * sigma * sigma;
    let mut kernel = vec![0.0f32; k_size];
    let mut sum = 0.0f64;
    for i in 0..k_size {
        let x = i as f64 - radius as f64;
        let v = (-(x * x) / two_sigma_sq).exp();
        kernel[i] = v as f32;
        sum += v;
    }
    for k in kernel.iter_mut() { *k = (*k as f64 / sum) as f32; }

    // Pre-convert input u8 -> f32 so the horizontal pass's interior inner loop
    // is a clean `v128_load` per neighbour. Both scratch buffers are pooled
    // across calls (see F32_SCRATCH_A/B) so there's no per-frame alloc.
    let n_floats = w * h * 4;
    let (input_f32, temp) = unsafe {
        #[allow(static_mut_refs)]
        (
            ensure_scratch(&mut F32_SCRATCH_A, n_floats) as *mut [f32],
            ensure_scratch(&mut F32_SCRATCH_B, n_floats) as *mut [f32],
        )
    };
    // SAFETY: the two buffers are distinct pool entries; we never alias reads
    // and writes of them after this point.
    let input_f32: &mut [f32] = unsafe { &mut *input_f32 };
    let temp: &mut [f32] = unsafe { &mut *temp };
    for i in 0..n_floats {
        // SAFETY: input.len() == n_floats.
        unsafe { *input_f32.get_unchecked_mut(i) = *input.get_unchecked(i) as f32; }
    }

    // Horizontal pass. The inner accumulation is split into three regions:
    // - Left edge (x < radius): per-sample clamp, can't auto-vectorise.
    // - Interior (radius ≤ x < w-radius): contiguous stride-1 reads through
    //   input, which LLVM auto-vectorises to v128 f32 multiply-adds.
    // - Right edge (x ≥ w-radius): per-sample clamp.
    //
    // When w ≤ 2*radius the whole row is "edge" and we only use the clamped path.
    //
    // We accumulate R/G/B/A together because the packed RGBA layout gives good
    // memory locality — SIMD still helps inside the k loop even though the
    // four channels aren't vectorised together.
    let interior_x_start = radius.min(w);
    let interior_x_end = if w > radius { w - radius } else { 0 };

    for y in 0..h {
        let row_base = y * w;
        let row_px_base = row_base * 4;

        // --- Left edge (and entire row when narrow) ---
        for x in 0..interior_x_start.min(interior_x_end.max(interior_x_start)) {
            let mut acc = f32x4_splat(0.0);
            for k in 0..k_size {
                let raw = x as i32 + k as i32 - radius as i32;
                let nx = raw.clamp(0, w as i32 - 1) as usize;
                let si = (row_base + nx) * 4;
                // SAFETY: si + 3 < input_f32.len().
                let pix = unsafe { v128_load(input_f32.as_ptr().add(si) as *const v128) };
                let wk = f32x4_splat(unsafe { *kernel.get_unchecked(k) });
                acc = f32x4_add(acc, f32x4_mul(pix, wk));
            }
            let ti = (row_base + x) * 4;
            // SAFETY: ti + 3 < temp.len().
            unsafe { v128_store(temp.as_mut_ptr().add(ti) as *mut v128, acc); }
        }

        // --- Interior: stride-1 neighbour access (explicit v128 FMA) ---
        if interior_x_end > interior_x_start {
            for x in interior_x_start..interior_x_end {
                let window_base = row_px_base + (x - radius) * 4;
                let mut acc = f32x4_splat(0.0);
                for k in 0..k_size {
                    let si = window_base + k * 4;
                    let pix = unsafe { v128_load(input_f32.as_ptr().add(si) as *const v128) };
                    let wk = f32x4_splat(unsafe { *kernel.get_unchecked(k) });
                    acc = f32x4_add(acc, f32x4_mul(pix, wk));
                }
                let ti = (row_base + x) * 4;
                unsafe { v128_store(temp.as_mut_ptr().add(ti) as *mut v128, acc); }
            }
        }

        // --- Right edge (only when there was an interior range) ---
        if interior_x_end > interior_x_start {
            for x in interior_x_end..w {
                let mut acc = f32x4_splat(0.0);
                for k in 0..k_size {
                    let raw = x as i32 + k as i32 - radius as i32;
                    let nx = raw.clamp(0, w as i32 - 1) as usize;
                    let si = (row_base + nx) * 4;
                    let pix = unsafe { v128_load(input_f32.as_ptr().add(si) as *const v128) };
                    let wk = f32x4_splat(unsafe { *kernel.get_unchecked(k) });
                    acc = f32x4_add(acc, f32x4_mul(pix, wk));
                }
                let ti = (row_base + x) * 4;
                unsafe { v128_store(temp.as_mut_ptr().add(ti) as *mut v128, acc); }
            }
        }
    }

    // Vertical pass — final u8 write. Same left/interior/right split; the
    // interior case is stride-w through temp, which LLVM also vectorises
    // because w is loop-invariant.
    let interior_y_start = radius.min(h);
    let interior_y_end = if h > radius { h - radius } else { 0 };

    // Helper — convert an f32x4 accumulator to four u8 output bytes using
    // JS Math.round semantics ((x + 0.5).floor(), clamped to [0, 255]).
    #[inline]
    fn write_pixel_from_v128(output: &mut [u8], i: usize, acc: v128) {
        let r_f = f32x4_extract_lane::<0>(acc);
        let g_f = f32x4_extract_lane::<1>(acc);
        let b_f = f32x4_extract_lane::<2>(acc);
        let a_f = f32x4_extract_lane::<3>(acc);
        unsafe {
            *output.get_unchecked_mut(i)     = js_round_f32(r_f).clamp(0.0, 255.0) as u8;
            *output.get_unchecked_mut(i + 1) = js_round_f32(g_f).clamp(0.0, 255.0) as u8;
            *output.get_unchecked_mut(i + 2) = js_round_f32(b_f).clamp(0.0, 255.0) as u8;
            *output.get_unchecked_mut(i + 3) = js_round_f32(a_f).clamp(0.0, 255.0) as u8;
        }
    }

    // Top edge (and entire image when short).
    for y in 0..interior_y_start.min(interior_y_end.max(interior_y_start)) {
        for x in 0..w {
            let mut acc = f32x4_splat(0.0);
            for k in 0..k_size {
                let raw = y as i32 + k as i32 - radius as i32;
                let ny = raw.clamp(0, h as i32 - 1) as usize;
                let ti = (ny * w + x) * 4;
                let tp = unsafe { v128_load(temp.as_ptr().add(ti) as *const v128) };
                let wk = f32x4_splat(unsafe { *kernel.get_unchecked(k) });
                acc = f32x4_add(acc, f32x4_mul(tp, wk));
            }
            write_pixel_from_v128(output, (y * w + x) * 4, acc);
        }
    }

    // Interior rows — known-safe stride-w access, explicit v128 FMA.
    if interior_y_end > interior_y_start {
        for y in interior_y_start..interior_y_end {
            let top_row_base = (y - radius) * w * 4;
            for x in 0..w {
                let col_base = top_row_base + x * 4;
                let mut acc = f32x4_splat(0.0);
                for k in 0..k_size {
                    let ti = col_base + k * (w * 4);
                    let tp = unsafe { v128_load(temp.as_ptr().add(ti) as *const v128) };
                    let wk = f32x4_splat(unsafe { *kernel.get_unchecked(k) });
                    acc = f32x4_add(acc, f32x4_mul(tp, wk));
                }
                write_pixel_from_v128(output, (y * w + x) * 4, acc);
            }
        }
    }

    // Bottom edge.
    if interior_y_end > interior_y_start {
        for y in interior_y_end..h {
            for x in 0..w {
                let mut acc = f32x4_splat(0.0);
                for k in 0..k_size {
                    let raw = y as i32 + k as i32 - radius as i32;
                    let ny = raw.clamp(0, h as i32 - 1) as usize;
                    let ti = (ny * w + x) * 4;
                    let tp = unsafe { v128_load(temp.as_ptr().add(ti) as *const v128) };
                    let wk = f32x4_splat(unsafe { *kernel.get_unchecked(k) });
                    acc = f32x4_add(acc, f32x4_mul(tp, wk));
                }
                write_pixel_from_v128(output, (y * w + x) * 4, acc);
            }
        }
    }
}

// === Grain merge (box blur high-pass + mix) ===
//
// Replaces src/filters/grainMerge.ts's two-pass per-pixel JS loop. We compute
// a box blur with clamp-to-edge semantics — matching the JS filter, where
// every kernel position clamps to the nearest edge pixel and `cnt` is always
// `(2r+1)^2`. To keep the blur step cheap we precompute the clamp indices per
// row and column once and reuse them. Then subtract to get the high-pass, mix
// with the input, and clamp to u8. Alpha passes through unchanged. Parity is
// bit-exact with the JS impl (`sr / cnt` in f64, stored as f32).

#[wasm_bindgen]
pub fn grain_merge_buffer(
    input: &[u8],
    output: &mut [u8],
    width: u32,
    height: u32,
    radius: u32,
    strength: f32,
) {
    let w = width as usize;
    let h = height as usize;
    let r = radius as usize;
    if w == 0 || h == 0 { return; }

    // Precomputed clamp-to-edge column/row indices for each offset. k_size =
    // 2r+1. col_clamp[x * k_size + k] is the clamped x-index for the k-th
    // kernel column at pixel column x.
    let k_size = 2 * r + 1;
    let mut col_clamp = vec![0usize; w * k_size];
    for x in 0..w {
        for k in 0..k_size {
            let raw = x as i32 + k as i32 - r as i32;
            let clamped = if raw < 0 { 0 } else if raw >= w as i32 { w - 1 } else { raw as usize };
            col_clamp[x * k_size + k] = clamped;
        }
    }
    let mut row_clamp = vec![0usize; h * k_size];
    for y in 0..h {
        for k in 0..k_size {
            let raw = y as i32 + k as i32 - r as i32;
            let clamped = if raw < 0 { 0 } else if raw >= h as i32 { h - 1 } else { raw as usize };
            row_clamp[y * k_size + k] = clamped;
        }
    }
    let cnt = (k_size * k_size) as f32;

    for y in 0..h {
        let row_base = y * k_size;
        for x in 0..w {
            let col_base = x * k_size;
            let mut sr: u32 = 0;
            let mut sg: u32 = 0;
            let mut sb: u32 = 0;
            for ky in 0..k_size {
                let ny = unsafe { *row_clamp.get_unchecked(row_base + ky) };
                let row_px = ny * w;
                for kx in 0..k_size {
                    let nx = unsafe { *col_clamp.get_unchecked(col_base + kx) };
                    let ni = (row_px + nx) * 4;
                    // SAFETY: nx < w, ny < h → ni + 2 < input.len().
                    unsafe {
                        sr += *input.get_unchecked(ni) as u32;
                        sg += *input.get_unchecked(ni + 1) as u32;
                        sb += *input.get_unchecked(ni + 2) as u32;
                    }
                }
            }
            // Divide in f64 then narrow to f32 so we match JS's `sr / cnt`
            // (f64 division) followed by Float32Array storage (f32 narrow).
            let cnt_f64 = cnt as f64;
            let blur_r = ((sr as f64) / cnt_f64) as f32;
            let blur_g = ((sg as f64) / cnt_f64) as f32;
            let blur_b = ((sb as f64) / cnt_f64) as f32;

            let i = (y * w + x) * 4;
            let (ir_u, ig_u, ib_u, ia) = unsafe {
                (
                    *input.get_unchecked(i),
                    *input.get_unchecked(i + 1),
                    *input.get_unchecked(i + 2),
                    *input.get_unchecked(i + 3),
                )
            };
            // Mix in f64 to match JS's u8 - f32 → f64 promotion semantics, so
            // per-pixel rounding agrees to the bit.
            let strength_f64 = strength as f64;
            let nr = ((ir_u as f64 + (ir_u as f64 - blur_r as f64) * strength_f64).round()).clamp(0.0, 255.0) as u8;
            let ng = ((ig_u as f64 + (ig_u as f64 - blur_g as f64) * strength_f64).round()).clamp(0.0, 255.0) as u8;
            let nb = ((ib_u as f64 + (ib_u as f64 - blur_b as f64) * strength_f64).round()).clamp(0.0, 255.0) as u8;
            unsafe {
                *output.get_unchecked_mut(i)     = nr;
                *output.get_unchecked_mut(i + 1) = ng;
                *output.get_unchecked_mut(i + 2) = nb;
                *output.get_unchecked_mut(i + 3) = ia;
            }
        }
    }
}

// === Triangle dither ===
//
// Port of src/filters/triangleDither.ts: add TPDF noise (triangular
// probability density function, ±127.5) to each RGB channel then snap to
// levels. The JS path uses `Math.random()` so its output already varies per
// run — we don't need bit-exact parity, just the same statistical behaviour.
// Caller passes a `seed` (any non-zero u32); we drive an xorshift32 PRNG
// from there, so output is stable for a given seed but varies across calls
// when the JS side seeds with a fresh random.

#[inline]
fn xorshift32(state: &mut u32) -> u32 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    x
}

#[inline]
fn rand_unit_f32(state: &mut u32) -> f32 {
    xorshift32(state) as f32 / u32::MAX as f32
}

#[wasm_bindgen]
pub fn triangle_dither_buffer(
    input: &[u8],
    output: &mut [u8],
    levels: u32,
    seed: u32,
) {
    let step = if levels > 1 { 255.0 / (levels as f32 - 1.0) } else { 255.0 };
    let mut rng = if seed == 0 { 0x12345678u32 } else { seed };
    let n = input.len() / 4;
    for p in 0..n {
        let i = p * 4;
        // SAFETY: p < n → i + 3 < input.len().
        let (ir, ig, ib, ia) = unsafe {
            (
                *input.get_unchecked(i) as f32,
                *input.get_unchecked(i + 1) as f32,
                *input.get_unchecked(i + 2) as f32,
                *input.get_unchecked(i + 3),
            )
        };
        // TPDF noise in (-1, 1) scaled by 127.5 (matches JS: tpdf() * 255 * 0.5).
        let nr = (rand_unit_f32(&mut rng) - rand_unit_f32(&mut rng)) * 127.5;
        let ng = (rand_unit_f32(&mut rng) - rand_unit_f32(&mut rng)) * 127.5;
        let nb = (rand_unit_f32(&mut rng) - rand_unit_f32(&mut rng)) * 127.5;
        let qr = js_round_f32(js_round_f32((ir + nr) / step) * step).clamp(0.0, 255.0) as u8;
        let qg = js_round_f32(js_round_f32((ig + ng) / step) * step).clamp(0.0, 255.0) as u8;
        let qb = js_round_f32(js_round_f32((ib + nb) / step) * step).clamp(0.0, 255.0) as u8;
        unsafe {
            *output.get_unchecked_mut(i)     = qr;
            *output.get_unchecked_mut(i + 1) = qg;
            *output.get_unchecked_mut(i + 2) = qb;
            *output.get_unchecked_mut(i + 3) = ia;
        }
    }
}

// === HSV shift ===
//
// Rotate hue by `hue_shift` degrees and offset saturation/value by `sat_shift` /
// `val_shift` (each in [-1, 1], clamped to [0, 1] after the offset). Matches
// src/filters/colorShift.ts's hsva2rgba/rgba2hsva semantics: JS operates in
// f64 and rounds to u8 at the end, so we do the same.

#[inline]
fn hsv_to_rgb_u8(h: f64, s: f64, v: f64) -> (u8, u8, u8) {
    if s == 0.0 {
        let c = (v * 255.0).round().clamp(0.0, 255.0) as u8;
        return (c, c, c);
    }
    let hh_full = ((h % 360.0 + 360.0) % 360.0) / 60.0;
    let sector = hh_full.floor();
    let f = hh_full - sector;
    let p = v * (1.0 - s);
    let q = v * (1.0 - s * f);
    let t = v * (1.0 - s * (1.0 - f));
    let (r, g, b) = match sector as i32 {
        0 => (v, t, p),
        1 => (q, v, p),
        2 => (p, v, t),
        3 => (p, q, v),
        4 => (t, p, v),
        _ => (v, p, q),
    };
    (
        (r * 255.0).round().clamp(0.0, 255.0) as u8,
        (g * 255.0).round().clamp(0.0, 255.0) as u8,
        (b * 255.0).round().clamp(0.0, 255.0) as u8,
    )
}

#[wasm_bindgen]
pub fn hsv_shift_buffer(
    input: &[u8],
    output: &mut [u8],
    hue_shift: f64,
    sat_shift: f64,
    val_shift: f64,
) {
    let n_pixels = input.len() / 4;
    for p in 0..n_pixels {
        let i = p * 4;
        // SAFETY: p < n_pixels → i + 3 < input.len() == output.len().
        let (ir, ig, ib, ia) = unsafe {
            (
                *input.get_unchecked(i) as f64,
                *input.get_unchecked(i + 1) as f64,
                *input.get_unchecked(i + 2) as f64,
                *input.get_unchecked(i + 3),
            )
        };
        // Match JS rgba2hsva exactly: /255 first, then max/min/delta, h in degrees.
        let r = ir / 255.0;
        let g = ig / 255.0;
        let b = ib / 255.0;
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let delta = max - min;
        let v = max;
        let (h, s) = if delta > 0.0 {
            let s = delta / max;
            let h_raw = if r == max {
                (g - b) / delta
            } else if g == max {
                2.0 + (b - r) / delta
            } else {
                4.0 + (r - g) / delta
            };
            let mut h_deg = h_raw * 60.0;
            if h_deg < 0.0 { h_deg += 360.0; }
            (h_deg, s)
        } else {
            (0.0, 0.0)
        };
        let h_out = h + hue_shift;
        let s_out = (s + sat_shift).clamp(0.0, 1.0);
        let v_out = (v + val_shift).clamp(0.0, 1.0);
        let (or, og, ob) = hsv_to_rgb_u8(h_out, s_out, v_out);
        unsafe {
            *output.get_unchecked_mut(i)     = or;
            *output.get_unchecked_mut(i + 1) = og;
            *output.get_unchecked_mut(i + 2) = ob;
            *output.get_unchecked_mut(i + 3) = ia;
        }
    }
}

// === Per-channel LUT apply ===
//
// Reusable primitive for any filter that reduces to "remap each channel
// through an 8-bit LUT": Curves (RGB / R / G / B modes), Smooth Posterize,
// Levels (when added), etc. The caller is responsible for building the LUT;
// WASM just does the tight per-pixel dispatch.
//
// Each `lut_*` must be exactly 256 bytes. Alpha is copied straight through.

#[wasm_bindgen]
pub fn apply_channel_lut(
    input: &[u8],
    output: &mut [u8],
    lut_r: &[u8],
    lut_g: &[u8],
    lut_b: &[u8],
) {
    // The slice-index guarantees (len == 256, caller-enforced) let the compiler
    // elide bounds checks in the hot loop. We still gate once at entry so a
    // mis-sized LUT fails loudly instead of reading garbage.
    if lut_r.len() < 256 || lut_g.len() < 256 || lut_b.len() < 256 { return; }
    let n_pixels = input.len() / 4;
    for p in 0..n_pixels {
        let i = p * 4;
        // SAFETY: p < n_pixels → i + 3 < input.len() == output.len(); LUT indices
        // are u8 values < 256 and we checked len above.
        unsafe {
            *output.get_unchecked_mut(i)     = *lut_r.get_unchecked(*input.get_unchecked(i)     as usize);
            *output.get_unchecked_mut(i + 1) = *lut_g.get_unchecked(*input.get_unchecked(i + 1) as usize);
            *output.get_unchecked_mut(i + 2) = *lut_b.get_unchecked(*input.get_unchecked(i + 2) as usize);
            *output.get_unchecked_mut(i + 3) = *input.get_unchecked(i + 3);
        }
    }
}
