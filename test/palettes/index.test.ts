import { describe, it, expect } from "vitest";
import { paletteList, serializePalette, deserializePalette, nearest, user } from "palettes";

// Covers the small (de)serialization shim that ships palettes across the
// worker boundary and the postMessage wire format. Without these, palettes
// chosen in the UI would silently revert to `nearest` after postMessage.

describe("palettes index", () => {
  it("exposes both built-in palettes in the list", () => {
    const names = paletteList.map((entry) => entry.palette.name);
    expect(names).toContain(nearest.name);
    expect(names).toContain(user.name);
  });

  it("serialises a palette to a plain object with the _serialized tag", () => {
    const payload = serializePalette({ ...nearest, options: { levels: 4 } });
    expect(payload._serialized).toBe(true);
    expect(payload.name).toBe(nearest.name);
    expect(payload.options).toEqual({ levels: 4 });
    expect(typeof (payload as Record<string, unknown>).func).toBe("undefined");
  });

  it("deserialises back to a full PaletteDefinition with options preserved", () => {
    const payload = serializePalette({ ...user, options: { theme: "custom" } });
    const restored = deserializePalette(payload);
    expect(restored.name).toBe(user.name);
    expect(restored.options).toEqual({ theme: "custom" });
  });

  it("falls back to the first palette when the name is unknown", () => {
    const restored = deserializePalette({ _serialized: true, name: "ghost", options: {} });
    expect(restored.name).toBe(paletteList[0].palette.name);
  });

  it("tolerates null/undefined serialized input", () => {
    const a = deserializePalette(null);
    const b = deserializePalette(undefined);
    const c = deserializePalette({});
    expect(a.name).toBe(paletteList[0].palette.name);
    expect(b.name).toBe(paletteList[0].palette.name);
    expect(c.name).toBe(paletteList[0].palette.name);
    // Options default to an empty object rather than undefined so downstream
    // consumers can spread safely.
    expect(a.options).toEqual({});
  });
});
