// Node 25 exposes a global `localStorage` property whose value is undefined
// unless --localstorage-file is supplied. That prevents Vitest/jsdom from
// installing its functional Storage implementation on globalThis.
const entries = new Map<string, string>();
const localStorageMock: Storage = {
  get length() { return entries.size; },
  clear() { entries.clear(); },
  getItem(key) { return entries.get(key) ?? null; },
  key(index) { return [...entries.keys()][index] ?? null; },
  removeItem(key) { entries.delete(key); },
  setItem(key, value) { entries.set(String(key), String(value)); },
};

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorageMock,
});
