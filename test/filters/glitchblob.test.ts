import { describe, expect, it, vi } from "vitest";

import {
  computeCrc, getU32, setU32,
  transformRepeat, transformSubstitute, transformTranspose,
} from "filters/glitchblob";

// glitchblob corrupts an encoded image's bitstream — 475 lines, noGL + noWASM,
// covered only by the smoke sweep's "doesn't throw / alpha > 100".
//
// Randomness is the whole point of a glitch filter, so there's no output to pin.
// What IS a contract:
//
//  - The PNG CRC it recomputes must be a real CRC-32. If it isn't, the browser
//    rejects the image, `isExpectedGlitchFailure` swallows the error (it matches
//    on "crc"/"decode"/"image"), and the filter silently does nothing — while
//    every existing test still passes. CRC-32 has published check values, so
//    this is an oracle rather than a guess.
//  - The transforms must never corrupt the header. Everything below `header`
//    is the part that keeps the file decodable at all; corrupt it and you get
//    the same silent no-op.
//  - The transforms must stay inside the buffer.
//
// The full filter needs a real browser (canvas.toBlob + createImageBitmap), so
// the byte-level core is what's reachable here.

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

const crcOf = (data: Uint8Array) => {
  const out = new Uint8Array(4);
  computeCrc(data, out);
  return getU32(out) >>> 0;
};

describe("CRC-32 matches the published check values", () => {
  // Standard CRC-32 (poly 0xedb88320, init 0xffffffff, final xor) — the one PNG
  // uses. These constants are from the spec, not from this implementation.
  it("the classic check value: CRC32('123456789') === 0xcbf43926", () => {
    expect(crcOf(bytes("123456789"))).toBe(0xcbf43926);
  });

  it("CRC32('') === 0", () => {
    expect(crcOf(new Uint8Array(0))).toBe(0);
  });

  it("CRC32('a') === 0xe8b7be43", () => {
    expect(crcOf(bytes("a"))).toBe(0xe8b7be43);
  });

  it("CRC32('IEND') === 0xae426082 — the constant every PNG ends with", () => {
    // If this is wrong, every PNG the filter emits is rejected by the decoder
    // and the glitch silently degrades to a no-op.
    expect(crcOf(bytes("IEND"))).toBe(0xae426082);
  });

  it("is sensitive to a single flipped bit", () => {
    const a = bytes("123456789");
    const b = bytes("123456789");
    b[0] ^= 0x01;
    expect(crcOf(a)).not.toBe(crcOf(b));
  });
});

describe("u32 round-trip", () => {
  it.each([0, 1, 255, 256, 0x12345678, 0xffffffff])("survives %i", (value) => {
    const buf = new Uint8Array(4);
    setU32(buf, value);
    expect(getU32(buf) >>> 0).toBe(value >>> 0);
  });

  it("is big-endian, as PNG requires", () => {
    const buf = new Uint8Array(4);
    setU32(buf, 0x01020304);
    expect(Array.from(buf)).toEqual([1, 2, 3, 4]);
  });
});

describe("transforms never touch the header", () => {
  // The header is what keeps the file decodable. Corrupting it doesn't produce a
  // glitchier image — it produces no image, which this filter swallows into a
  // silent no-op.
  const HEADER = 16;
  const makeInput = () => {
    const buf = new Uint8Array(128);
    for (let i = 0; i < buf.length; i++) buf[i] = (i * 7) & 0xff;
    return buf;
  };

  const TRANSFORMS: [string, (h: number, i: Uint8Array) => Uint8Array][] = [
    ["transpose", transformTranspose],
    ["substitute", transformSubstitute],
    ["repeat", transformRepeat],
  ];

  it.each(TRANSFORMS)("%s leaves the first `header` bytes alone", (_name, fn) => {
    // Random placement, so hammer it rather than trusting one roll.
    for (let trial = 0; trial < 300; trial++) {
      const input = makeInput();
      const before = input.slice(0, HEADER);
      const out = fn(HEADER, input);
      expect(Array.from(out.slice(0, HEADER))).toEqual(Array.from(before));
    }
  });

  it.each(TRANSFORMS)("%s stays inside the buffer", (_name, fn) => {
    // A Uint8Array write past the end is silently dropped rather than throwing,
    // so an out-of-range index would corrupt nothing and look fine — assert the
    // output length instead, which is the observable consequence.
    for (let trial = 0; trial < 300; trial++) {
      const input = makeInput();
      const out = fn(HEADER, input);
      expect(out.length).toBeGreaterThan(HEADER);
      expect(out.length).toBeLessThanOrEqual(input.length + 9);
    }
  });

  it("transpose swaps a pair and preserves the multiset", () => {
    // A swap moves bytes; it must not create or destroy any.
    const input = makeInput();
    const before = Array.from(input).sort((a, b) => a - b);
    const out = transformTranspose(HEADER, input);
    expect(Array.from(out).sort((a, b) => a - b)).toEqual(before);
    expect(out.length).toBe(128);
  });

  it("substitute changes exactly one byte, or none if it rolls the same value", () => {
    const input = makeInput();
    const before = Array.from(input);
    const out = transformSubstitute(HEADER, input);
    const diffs = Array.from(out).filter((v, i) => v !== before[i]).length;
    expect(diffs).toBeLessThanOrEqual(1);
    expect(out.length).toBe(128);
  });
});

describe("transformRepeat length behaviour", () => {
  it("can shrink the buffer by one when it rolls a zero-length run", () => {
    // Documenting real behaviour rather than asserting it's right: the run
    // length is `floor(random() * 10)`, so ~10% of the time it's 0 and the
    // "repeat" deletes the byte instead of duplicating it — output is
    // input.length - 1. Harmless for a glitch filter, surprising if you're
    // reading the name. Any length in [len-1, len+8] is reachable.
    const lengths = new Set<number>();
    for (let trial = 0; trial < 500; trial++) {
      const input = new Uint8Array(64);
      lengths.add(transformRepeat(8, input).length);
    }
    for (const l of lengths) {
      expect(l).toBeGreaterThanOrEqual(63);
      expect(l).toBeLessThanOrEqual(72);
    }
  });

  it("repeats the byte it landed on", () => {
    // With the RNG pinned, the run is a known length of a known byte.
    const input = new Uint8Array(32);
    for (let i = 0; i < input.length; i++) input[i] = i;
    // idx = 8 + floor(0.5 * 24) = 20 -> byte 20; run length = floor(0.5*10) = 5
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const out = transformRepeat(8, input);
      expect(out.length).toBe(32 + 5 - 1);
      expect(Array.from(out.slice(20, 25))).toEqual([20, 20, 20, 20, 20]);
      // Everything before the splice is untouched...
      expect(Array.from(out.slice(0, 20))).toEqual(
        Array.from({ length: 20 }, (_, i) => i),
      );
      // ...and the tail after the replaced byte follows the run.
      expect(Array.from(out.slice(25, 30))).toEqual([21, 22, 23, 24, 25]);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
