import { useEffect, useRef, useState } from "react";

export const SLOW_FRAME_ENTER_MS = 50;
export const SLOW_FRAME_EXIT_MS = 40;
export const SLOW_FRAME_SHOW_DELAY_MS = 1500;
export const SLOW_FRAME_HIDE_DELAY_MS = 3000;
// Weight of the newest frame in the running average.
const SMOOTHING = 0.2;

/**
 * Whether to warn about slow rendering. Raw frame times jitter around the
 * threshold, so the warning follows a running average with separate enter and
 * exit thresholds, and only changes after the new state has held for a while.
 */
const useSlowFrameWarning = (frameTime: number | null | undefined): boolean => {
  const averageRef = useRef<number | null>(null);
  const [wantsWarning, setWantsWarning] = useState(false);
  const [warning, setWarning] = useState(false);
  // The threshold depends on what is shown, not on the pending change.
  const warningRef = useRef(warning);
  warningRef.current = warning;

  useEffect(() => {
    if (frameTime == null) {
      averageRef.current = null;
      setWantsWarning(false);
      return;
    }
    const previous = averageRef.current;
    const average = previous == null ? frameTime : previous + (frameTime - previous) * SMOOTHING;
    averageRef.current = average;
    setWantsWarning(average > (warningRef.current ? SLOW_FRAME_EXIT_MS : SLOW_FRAME_ENTER_MS));
  }, [frameTime]);

  useEffect(() => {
    if (wantsWarning === warning) return;
    const timer = setTimeout(
      () => setWarning(wantsWarning),
      wantsWarning ? SLOW_FRAME_SHOW_DELAY_MS : SLOW_FRAME_HIDE_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [wantsWarning, warning]);

  return warning;
};

export default useSlowFrameWarning;
