use wasm_bindgen::prelude::*;

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
