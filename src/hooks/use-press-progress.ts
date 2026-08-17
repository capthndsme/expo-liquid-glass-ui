import { useCallback, useRef } from "react";
import { Animated } from "react-native";

interface IPressProgressOptions {
  /**
   * Whether the progress value may run on the native driver. Only when everything it feeds is
   * native-driver-compatible (transforms, opacity) — color interpolation needs the JS driver.
   */
  native?: boolean;
}

interface IPressProgress {
  progress: Animated.Value;
  pressIn: () => void;
  pressOut: () => void;
}

/**
 * A 0→1 spring shared by every control's press choreography. The stiffness/damping pair is tuned
 * to land close to the catalog's default `spring()` — quick in, small settle.
 */
function usePressProgress(options?: IPressProgressOptions): IPressProgress {
  const native = options?.native ?? true;
  const progress = useRef(new Animated.Value(0)).current;

  const animateTo = useCallback(
    (toValue: number): void => {
      Animated.spring(progress, {
        toValue,
        stiffness: 400,
        damping: 30,
        mass: 1,
        useNativeDriver: native,
      }).start();
    },
    [progress, native],
  );

  const pressIn = useCallback((): void => animateTo(1), [animateTo]);
  const pressOut = useCallback((): void => animateTo(0), [animateTo]);

  return { progress, pressIn, pressOut };
}

export { usePressProgress };
export type { IPressProgress, IPressProgressOptions };
