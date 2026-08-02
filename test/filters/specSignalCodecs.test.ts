import { describe, expect, it } from "vitest";
import {
  decodeFaxRuns,
  decodeHamming84,
  encodeFaxRuns,
  encodeHamming84,
  forward53,
  hasOddParity,
  inverse53,
  quantizeCoefficient,
  transmitFaxRows,
  withOddParity,
} from "filters/signalCodecs";
import { filterIndex } from "filters/index";
import { resolveFaxBitErrorRate, resolveFaxSampling } from "filters/faxMachine";
import { apolloFramesPerPicture, apolloTiming } from "filters/apolloSstv";
import { resolveTeletextGeometry } from "filters/teletext";
import { resolveGameboySensorGrid } from "filters/gameboyCamera";

describe("specification codec primitives", () => {
  it("round-trips T.4 bilevel scan lines through runs", () => {
    const source = Uint8Array.from([0, 0, 1, 1, 1, 0, 1, 0, 0, 0, 1]);
    const encoded = encodeFaxRuns(source);
    expect(encoded.runs).toEqual([2, 3, 1, 1, 3, 1]);
    expect(encoded.estimatedBits).toBeGreaterThan(12);
    expect(decodeFaxRuns(encoded, source.length)).toEqual(source);
    const black = encodeFaxRuns(Uint8Array.from([1, 1, 1]));
    expect(black).toEqual({ runs: [0, 3], startsBlack: false, estimatedBits: 22 });
    expect(decodeFaxRuns(black, 3)).toEqual(Uint8Array.from([1, 1, 1]));
    expect(encodeFaxRuns(new Uint8Array(64)).estimatedBits).toBe(25);
    expect(encodeFaxRuns(new Uint8Array(64).fill(1)).estimatedBits).toBe(40);
    expect(encodeFaxRuns(new Uint8Array())).toEqual({
      runs: [],
      startsBlack: false,
      estimatedBits: 12,
    });
    expect(decodeFaxRuns(encodeFaxRuns(new Uint8Array()), 0)).toEqual(new Uint8Array());
    expect(decodeFaxRuns(encoded, Number.NaN)).toEqual(new Uint8Array());
    expect(
      decodeFaxRuns({ runs: [Number.NaN, 2], startsBlack: false, estimatedBits: 0 }, 2),
    ).toEqual(Uint8Array.from([1, 1]));
  });

  it("preserves fax rows on a clean channel and deterministically conceals damage", () => {
    const rows = [
      Uint8Array.from([0, 1, 1, 0, 0, 1, 0, 1]),
      Uint8Array.from([1, 1, 0, 0, 1, 1, 0, 0]),
      Uint8Array.from([0, 0, 1, 1, 0, 0, 1, 1]),
    ];
    expect(transmitFaxRows(rows, "MR", 0, 4, "PREVIOUS").rows).toEqual(rows);
    const first = transmitFaxRows(rows, "MMR", 0.5, 99, "PREVIOUS");
    const again = transmitFaxRows(rows, "MMR", 0.5, 99, "PREVIOUS");
    expect(first).toEqual(again);
    expect(first.damagedRows.length).toBeGreaterThan(0);
    expect(transmitFaxRows(rows, "MH", Number.NaN, 5, "WHITE").rows).toEqual(rows);
    expect(transmitFaxRows([], "MH", 0.1, 1, "WHITE")).toEqual({ rows: [], damagedRows: [] });
  });

  it("deletes damaged fax rows by shifting later decoded rows upward", () => {
    const rows = [
      Uint8Array.from([0, 0, 0, 0]),
      Uint8Array.from([1, 1, 1, 1]),
      Uint8Array.from([0, 1, 0, 1]),
    ];
    let result = transmitFaxRows(rows, "MH", 0.01, 0, "DELETE");
    for (let seed = 1; seed < 10_000 && result.damagedRows.length !== 1; seed++) {
      result = transmitFaxRows(rows, "MH", 0.01, seed, "DELETE");
    }
    expect(result.damagedRows).toHaveLength(1);
    const damaged = result.damagedRows[0];
    expect(result.rows.slice(0, -1)).toEqual(rows.filter((_, index) => index !== damaged));
    expect(result.rows.at(-1)).toEqual(new Uint8Array(4));
  });

  it("migrates the old fax compression control without masking new BER values", () => {
    expect(resolveFaxBitErrorRate({ bitErrorRate: 0.001 })).toBe(0.001);
    expect(resolveFaxBitErrorRate({ bitErrorRate: 0.001, compression: 0.8 })).toBeCloseTo(0.00016);
    expect(resolveFaxBitErrorRate({ bitErrorRate: Number.NaN })).toBe(0.00008);
  });

  it("uses T.4 standard scan geometry while retaining old sample-count states", () => {
    expect(resolveFaxSampling(3456, { scanMode: "STANDARD" })).toEqual({
      scaleX: 2,
      scaleY: 4,
      mrK: 2,
      mode: "STANDARD",
    });
    expect(resolveFaxSampling(3456, { scanMode: "FINE" })).toEqual({
      scaleX: 2,
      scaleY: 2,
      mrK: 4,
      mode: "FINE",
    });
    expect(resolveFaxSampling(3456, { scanMode: "SUPERFINE" })).toEqual({
      scaleX: 1,
      scaleY: 1,
      mrK: 4,
      mode: "SUPERFINE",
    });
    expect(resolveFaxSampling(1000, { scanMode: "STANDARD", resolution: 100 })).toEqual({
      scaleX: 10,
      scaleY: 10,
      mrK: 2,
      mode: "LEGACY",
    });
  });

  it("derives Apollo picture holds from camera and preview rates", () => {
    expect(apolloFramesPerPicture("320_10", 30)).toBe(3);
    expect(apolloFramesPerPicture("320_10", 15)).toBe(1.5);
    expect(apolloFramesPerPicture("1280_0625", 30)).toBe(48);
    expect(apolloFramesPerPicture("1280_0625", 15)).toBe(24);
    expect(apolloFramesPerPicture("bad", Number.NaN)).toBe(3);

    const timing = Array.from({ length: 15 }, (_, frame) => apolloTiming("320_10", 15, frame));
    expect(timing.map((value) => value.pictureIndex)).toEqual([
      0, 0, 1, 2, 2, 3, 4, 4, 5, 6, 6, 7, 8, 8, 9,
    ]);
    expect(timing.filter((value) => value.newPicture)).toHaveLength(10);
    expect(timing[1].picturePhase).toBeCloseTo(2 / 3);
    expect(timing[2].picturePhase).toBeCloseTo(1 / 3);
  });

  it("keeps legacy Teletext custom-column states out of the new 24x40 lock", () => {
    expect(resolveTeletextGeometry(800, 480, { columns: 40, standardPage: true })).toMatchObject({
      columns: 40,
      rows: 24,
      cellW: 20,
      cellH: 20,
      blockW: 10,
      blockH: 20 / 3,
      standardPage: true,
    });
    expect(resolveTeletextGeometry(800, 480, { columns: 80, standardPage: true })).toMatchObject({
      columns: 80,
      standardPage: false,
    });
    expect(
      resolveTeletextGeometry(800, 480, { columns: 60, standardPage: undefined }),
    ).toMatchObject({ columns: 60, standardPage: false });
  });

  it("uses the Game Boy cartridge's 128x112 active sensor geometry", () => {
    expect(resolveGameboySensorGrid(128)).toEqual({ width: 128, height: 112 });
    expect(resolveGameboySensorGrid(64)).toEqual({ width: 64, height: 56 });
    expect(resolveGameboySensorGrid(256)).toEqual({ width: 256, height: 224 });
    expect(resolveGameboySensorGrid(Number.NaN)).toEqual({ width: 128, height: 112 });
  });

  it("corrects every Hamming 8/4 single-bit error and rejects double-bit errors", () => {
    const teletextCodewords = [
      0x15, 0x02, 0x49, 0x5e, 0x64, 0x73, 0x38, 0x2f, 0xd0, 0xc7, 0x8c, 0x9b, 0xa1, 0xb6, 0xfd,
      0xea,
    ];
    for (let nibble = 0; nibble < 16; nibble++) {
      const encoded = encodeHamming84(nibble);
      expect(encoded, `ETSI codeword for nibble ${nibble.toString(16)}`).toBe(
        teletextCodewords[nibble],
      );
      expect(decodeHamming84(encoded)).toEqual({
        value: nibble,
        corrected: false,
        uncorrectable: false,
      });
      for (let bit = 0; bit < 8; bit++) {
        expect(decodeHamming84(encoded ^ (1 << bit))).toEqual({
          value: nibble,
          corrected: true,
          uncorrectable: false,
        });
      }
      for (let first = 0; first < 8; first++) {
        for (let second = first + 1; second < 8; second++) {
          expect(decodeHamming84(encoded ^ (1 << first) ^ (1 << second)).uncorrectable).toBe(true);
        }
      }
    }
  });

  it("adds and validates odd parity for every seven-bit payload", () => {
    for (let value = 0; value < 128; value++) {
      const encoded = withOddParity(value);
      expect(hasOddParity(encoded)).toBe(true);
      expect(hasOddParity(encoded ^ 1)).toBe(false);
    }
  });

  it("round-trips the reversible JPEG 2000 5/3 transform exactly", () => {
    const fixtures = Array.from({ length: 65 }, (_, length) =>
      Array.from({ length }, (_, index) => ((index * 71 + length * 37) % 509) - 254),
    );
    for (const fixture of fixtures) {
      const source = Int32Array.from(fixture);
      expect(inverse53(forward53(source))).toEqual(source);
    }
  });

  it("quantizes and truncates coefficient bit-planes without non-finite output", () => {
    expect(quantizeCoefficient(13.2, 1, 0)).toBe(13);
    expect(quantizeCoefficient(13.2, 1, 2)).toBe(12);
    expect(quantizeCoefficient(-13.2, 1, 2)).toBe(-12);
    expect(quantizeCoefficient(Number.NaN, 1, 2)).toBe(0);
    expect(Number.isFinite(quantizeCoefficient(7, 0, 99))).toBe(true);
    expect(quantizeCoefficient(2 ** 35 + 3, 1, 2)).toBe(2 ** 35);
    expect(quantizeCoefficient(-7, -1, Number.NaN)).toBeLessThan(0);
  });
});

describe("specification simulation catalog", () => {
  it("registers both new systems and retains all upgraded display names", () => {
    for (const name of [
      "Apollo Slow-Scan TV",
      "PAL / SECAM",
      "Fax Machine",
      "Gameboy Camera",
      "Teletext",
      "Wavelet Codec",
    ]) {
      expect(filterIndex[name], name).toBeDefined();
      for (const [key, option] of Object.entries(filterIndex[name].optionTypes ?? {})) {
        expect(option.desc, `${name}.${key}`).toBeTypeOf("string");
        expect(option.desc?.trim().length, `${name}.${key}`).toBeGreaterThan(0);
      }
    }
    expect(filterIndex["Fax Machine"].optionTypes?.compression).toBeUndefined();
    expect(filterIndex["Fax Machine"].optionTypes?.resolution).toBeUndefined();
  });
});
