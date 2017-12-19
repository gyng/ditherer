#[macro_use]
extern crate stdweb;

use stdweb::unstable::TryFrom;
use stdweb::unstable::TryInto;

fn rgba2laba(r: f64, g: f64, b: f64, a: f64, ref_x: f64, ref_y: f64, ref_z: f64, outarr: stdweb::Array) -> stdweb::Array {
    let mut r = r / 255.0;
    let mut g = g / 255.0;
    let mut b = b / 255.0;

    // TODO: powf causes linkerrors? $env.pow in output wasm

    // r = if r > 0.04045 { ((r + 0.055) / 1.055).powf(2.4) } else { r / 12.92 };
    // g = if g > 0.04045 { ((g + 0.055) / 1.055).powf(2.4) } else { g / 12.92 };
    // b = if b > 0.04045 { ((b + 0.055) / 1.055).powf(2.4) } else { b / 12.92 };

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

    // x = if x > 0.008856 { x.powf(1.0 / 3.0) } else { x * 7.787 + 16.0 / 116.0 };
    // y = if y > 0.008856 { y.powf(1.0 / 3.0) } else { y * 7.787 + 16.0 / 116.0 };
    // z = if z > 0.008856 { z.powf(1.0 / 3.0) } else { z * 7.787 + 16.0 / 116.0 };

    let out_l = 116.0 * y - 16.0;
    let out_a = 500.0 * (x - y);
    let out_b = 200.0 * (y - z);

    let vec = [out_l, out_a, out_b, a].to_vec();
    let out: stdweb::Array = stdweb::Array::try_from(vec).unwrap();
    out
}

fn main() {
    stdweb::initialize();

    js! {
        Module.exports.rgba2laba = @{rgba2laba};
    }
}
