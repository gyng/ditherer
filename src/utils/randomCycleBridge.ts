const randomCycleEventTarget = new EventTarget();
const screensaverCycleEventTarget = new EventTarget();

let currentRandomCycleSeconds: number | null = null;
let lastRandomCycleSeconds: number | null = null;
let currentScreensaverCycleSeconds: number | null = null;
let lastScreensaverCycleSeconds: number | null = null;

export const getCurrentRandomCycleSeconds = () => currentRandomCycleSeconds;

export const getLastRandomCycleSeconds = () => lastRandomCycleSeconds;

export const getCurrentScreensaverCycleSeconds = () => currentScreensaverCycleSeconds;

export const getLastScreensaverCycleSeconds = () => lastScreensaverCycleSeconds;

export const setRememberedRandomCycleSeconds = (seconds: number | null) => {
  if (seconds != null && seconds > 0) {
    lastRandomCycleSeconds = seconds;
  }
};

export const setRememberedScreensaverCycleSeconds = (seconds: number | null) => {
  if (seconds != null && seconds > 0) {
    lastScreensaverCycleSeconds = seconds;
  }
};

export const syncRandomCycleSeconds = (seconds: number | null) => {
  currentRandomCycleSeconds = seconds != null && seconds > 0 ? seconds : null;
  setRememberedRandomCycleSeconds(currentRandomCycleSeconds);
};

export const syncScreensaverCycleSeconds = (seconds: number | null) => {
  currentScreensaverCycleSeconds = seconds != null && seconds > 0 ? seconds : null;
  setRememberedScreensaverCycleSeconds(currentScreensaverCycleSeconds);
};

export const dispatchRandomCycleSeconds = (seconds: number | null) => {
  syncRandomCycleSeconds(seconds);
  randomCycleEventTarget.dispatchEvent(new CustomEvent<number | null>("change", {
    detail: currentRandomCycleSeconds,
  }));
};

export const dispatchScreensaverCycleSeconds = (seconds: number | null) => {
  syncScreensaverCycleSeconds(seconds);
  screensaverCycleEventTarget.dispatchEvent(new CustomEvent<number | null>("change", {
    detail: currentScreensaverCycleSeconds,
  }));
};

export const subscribeRandomCycleSeconds = (listener: (seconds: number | null) => void) => {
  const handleChange = (event: Event) => {
    listener((event as CustomEvent<number | null>).detail ?? null);
  };
  randomCycleEventTarget.addEventListener("change", handleChange);
  return () => randomCycleEventTarget.removeEventListener("change", handleChange);
};

export const subscribeScreensaverCycleSeconds = (listener: (seconds: number | null) => void) => {
  const handleChange = (event: Event) => {
    listener((event as CustomEvent<number | null>).detail ?? null);
  };
  screensaverCycleEventTarget.addEventListener("change", handleChange);
  return () => screensaverCycleEventTarget.removeEventListener("change", handleChange);
};
