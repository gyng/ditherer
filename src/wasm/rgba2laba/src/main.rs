#[macro_use]
extern crate stdweb;

// use stdweb::unstable::TryFrom;
// use stdweb::unstable::TryInto;

fn rgba2laba_inner(r: f64, g: f64, b: f64, a: f64, ref_x: f64, ref_y: f64, ref_z: f64) -> (f64, f64, f64, f64) {
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

    (out_l, out_a, out_b, a)
}

fn rgba2laba(r: f64, g: f64, b: f64, a: f64, ref_x: f64, ref_y: f64, ref_z: f64) -> stdweb::Value {
    let tuple = rgba2laba_inner(r, g, b, a, ref_x, ref_y, ref_z);
    vec![tuple.0, tuple.1, tuple.2, tuple.3].into()
}

fn rgba_laba_distance(r1: f64, g1: f64, b1: f64, a1: f64, r2: f64, g2: f64, b2: f64, a2: f64, ref_x: f64, ref_y: f64, ref_z: f64) -> stdweb::Number {
    let left = rgba2laba_inner(r1, g1, b1, a1, ref_x, ref_y, ref_z);
    let right = rgba2laba_inner(r2, g2, b2, a2, ref_x, ref_y, ref_z);
    let dist = (right.0 - left.0).abs() + (right.1 - left.1).abs() + (right.2 - left.2).abs();

    stdweb::Number::from(dist)
}

fn main() {
    stdweb::initialize();

    js! {
        Module.exports.rgba2laba = @{rgba2laba};
        Module.exports.rgbaLabaDistance = @{rgba_laba_distance};
    }
}
