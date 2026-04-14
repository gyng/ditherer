import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  dispatchRandomCycleSeconds,
  dispatchScreensaverCycleSeconds,
  getCurrentRandomCycleSeconds,
  getCurrentScreensaverCycleSeconds,
  getLastRandomCycleSeconds,
  getLastScreensaverChainSwapAt,
  getLastScreensaverCycleSeconds,
  getLastScreensaverVideoSwapAt,
  notifyScreensaverChainSwap,
  notifyScreensaverVideoSwap,
  resetScreensaverSwapMarkers,
  setRememberedRandomCycleSeconds,
  setRememberedScreensaverCycleSeconds,
  subscribeRandomCycleSeconds,
  subscribeScreensaverCycleSeconds,
  syncRandomCycleSeconds,
  syncScreensaverCycleSeconds,
} from "utils/randomCycleBridge";

beforeEach(() => {
  dispatchRandomCycleSeconds(null);
  dispatchScreensaverCycleSeconds(null);
  resetScreensaverSwapMarkers();
});

afterEach(() => {
  dispatchRandomCycleSeconds(null);
  dispatchScreensaverCycleSeconds(null);
  resetScreensaverSwapMarkers();
});

describe("random cycle seconds", () => {
  it("dispatch sets current and remembered", () => {
    dispatchRandomCycleSeconds(5);
    expect(getCurrentRandomCycleSeconds()).toBe(5);
    expect(getLastRandomCycleSeconds()).toBe(5);
  });

  it("dispatching null clears current but preserves remembered", () => {
    dispatchRandomCycleSeconds(5);
    dispatchRandomCycleSeconds(null);
    expect(getCurrentRandomCycleSeconds()).toBeNull();
    expect(getLastRandomCycleSeconds()).toBe(5);
  });

  it("dispatching zero or negative clears current", () => {
    dispatchRandomCycleSeconds(0);
    expect(getCurrentRandomCycleSeconds()).toBeNull();
    dispatchRandomCycleSeconds(-2);
    expect(getCurrentRandomCycleSeconds()).toBeNull();
  });

  it("subscribers fire with the current value, including null", () => {
    const values: Array<number | null> = [];
    const unsubscribe = subscribeRandomCycleSeconds((v) => values.push(v));
    dispatchRandomCycleSeconds(4);
    dispatchRandomCycleSeconds(null);
    unsubscribe();
    dispatchRandomCycleSeconds(3); // should not arrive
    expect(values).toEqual([4, null]);
  });

  it("setRememberedRandomCycleSeconds ignores nullish and non-positive values", () => {
    setRememberedRandomCycleSeconds(9);
    setRememberedRandomCycleSeconds(null);
    setRememberedRandomCycleSeconds(0);
    setRememberedRandomCycleSeconds(-1);
    expect(getLastRandomCycleSeconds()).toBe(9);
  });

  it("syncRandomCycleSeconds mirrors dispatch without event emission", () => {
    const values: Array<number | null> = [];
    const unsubscribe = subscribeRandomCycleSeconds((v) => values.push(v));
    syncRandomCycleSeconds(6);
    unsubscribe();
    expect(values).toEqual([]);
    expect(getCurrentRandomCycleSeconds()).toBe(6);
    expect(getLastRandomCycleSeconds()).toBe(6);
  });
});

describe("screensaver cycle seconds", () => {
  it("dispatches separately from random cycle", () => {
    dispatchRandomCycleSeconds(5);
    dispatchScreensaverCycleSeconds(2);
    expect(getCurrentRandomCycleSeconds()).toBe(5);
    expect(getCurrentScreensaverCycleSeconds()).toBe(2);
    expect(getLastScreensaverCycleSeconds()).toBe(2);
  });

  it("subscribers receive screensaver changes only", () => {
    const random: Array<number | null> = [];
    const saver: Array<number | null> = [];
    const unsubR = subscribeRandomCycleSeconds((v) => random.push(v));
    const unsubS = subscribeScreensaverCycleSeconds((v) => saver.push(v));
    dispatchScreensaverCycleSeconds(7);
    dispatchRandomCycleSeconds(8);
    unsubR();
    unsubS();
    expect(saver).toEqual([7]);
    expect(random).toEqual([8]);
  });

  it("syncScreensaverCycleSeconds and setRememberedScreensaverCycleSeconds behave symmetrically with random", () => {
    syncScreensaverCycleSeconds(4);
    expect(getCurrentScreensaverCycleSeconds()).toBe(4);
    expect(getLastScreensaverCycleSeconds()).toBe(4);
    setRememberedScreensaverCycleSeconds(null);
    expect(getLastScreensaverCycleSeconds()).toBe(4);
    setRememberedScreensaverCycleSeconds(12);
    expect(getLastScreensaverCycleSeconds()).toBe(12);
  });
});

describe("screensaver swap markers", () => {
  it("notifyScreensaverChainSwap records performance.now()", () => {
    const spy = vi.spyOn(performance, "now").mockReturnValueOnce(42);
    notifyScreensaverChainSwap();
    expect(getLastScreensaverChainSwapAt()).toBe(42);
    spy.mockRestore();
  });

  it("notifyScreensaverVideoSwap records performance.now() independently", () => {
    const spy = vi.spyOn(performance, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(200);
    notifyScreensaverChainSwap();
    notifyScreensaverVideoSwap();
    expect(getLastScreensaverChainSwapAt()).toBe(100);
    expect(getLastScreensaverVideoSwapAt()).toBe(200);
    spy.mockRestore();
  });

  it("resetScreensaverSwapMarkers clears both timestamps", () => {
    notifyScreensaverChainSwap();
    notifyScreensaverVideoSwap();
    resetScreensaverSwapMarkers();
    expect(getLastScreensaverChainSwapAt()).toBeNull();
    expect(getLastScreensaverVideoSwapAt()).toBeNull();
  });
});
