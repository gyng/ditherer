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
