import { useCallback, useMemo } from "react";
import type { SharedValue } from "react-native-reanimated";
import { useSharedValue } from "react-native-reanimated";

interface IGravityHighlightOptions {
  /**
   * Low-pass weight of each new sample, `0`–`1`. Kyant's demo uses `0.5` at `SENSOR_DELAY_UI`
   * (~60 Hz); lower is steadier, higher follows the hand faster.
   */
  smoothing?: number;
  /** The angle to report before the first sample. Defaults to `180`, the vertical light axis. */
  initialAngle?: number;
}

interface IGravityHighlight {
  /**
   * `highlight.angle` in the base view's degrees, on the UI thread — write it into `metal` from
   * `useAnimatedProps`.
   */
  angle: SharedValue<number>;
  /**
   * Feed an accelerometer sample: `x` positive toward the device's right edge, `y` positive
   * toward its top, in any unit — only the direction matters. `expo-sensors`'
   * `Accelerometer.addListener` hands you exactly this.
   */
  push: (x: number, y: number) => void;
}

/**
 * The highlight follows gravity: tilt the phone and the light on every glass edge slides with it,
 * as if the panes sat under one fixed lamp. The AndroidLiquidGlass catalog's control-centre demo
 * does this with the accelerometer (`UISensor`, Apache-2.0 — see NOTICE); this is the same
 * filter, without the sensor. The kit takes no dependency on `expo-sensors` — the app subscribes
 * and calls `push`.
 *
 * ```tsx
 * const gravity = useGravityHighlight();
 * useEffect(() => {
 *   Accelerometer.setUpdateInterval(16);
 *   const sub = Accelerometer.addListener(({ x, y }) => gravity.push(x, y));
 *   return () => sub.remove();
 * }, [gravity]);
 * const props = useAnimatedProps(() => ({
 *   metal: { ...GLASS_BAR_METAL, highlight: { ...GLASS_BAR_METAL.highlight, angle: gravity.angle.value } },
 * }));
 * ```
 *
 * Axis mapping: an upright phone reads gravity along `+y`, and the light should then sit on the
 * vertical axis — top and bottom edges lit — which in `highlight.angle`'s convention is `180`.
 * `atan2(y, x)` puts that at `90`, so the reported angle is Kyant's plus a quarter turn.
 */
function useGravityHighlight(
  options: IGravityHighlightOptions = {},
): IGravityHighlight {
  const smoothing = Math.min(1, Math.max(0.01, options.smoothing ?? 0.5));
  const angle = useSharedValue(options.initialAngle ?? 180);
  const filteredX = useSharedValue(0);
  const filteredY = useSharedValue(1);

  const push = useCallback(
    (x: number, y: number): void => {
      const norm = Math.hypot(x, y);
      if (!Number.isFinite(norm) || norm < 1e-3) return;
      // Filter the vector, not the angle: averaging angles across the ±180 seam would swing the
      // light through every other direction on the way.
      filteredX.value += (x / norm - filteredX.value) * smoothing;
      filteredY.value += (y / norm - filteredY.value) * smoothing;
      const gravity =
        (Math.atan2(filteredY.value, filteredX.value) * 180) / Math.PI;
      angle.value = gravity + 90;
    },
    [angle, filteredX, filteredY, smoothing],
  );

  return useMemo(() => ({ angle, push }), [angle, push]);
}

export { useGravityHighlight };
export type { IGravityHighlight, IGravityHighlightOptions };
