import { useCallback } from "react";
import type { SharedValue } from "react-native-reanimated";
import { useSharedValue, withSpring } from "react-native-reanimated";

import { PRESS_SPRING } from "../constants";

interface IPressProgress {
  progress: SharedValue<number>;
  pressIn: () => void;
  pressOut: () => void;
}

/**
 * A 0→1 spring shared by every control's press choreography. A Reanimated shared value, so
 * everything derived from it stays on the UI thread.
 */
function usePressProgress(): IPressProgress {
  const progress = useSharedValue(0);

  const pressIn = useCallback((): void => {
    progress.value = withSpring(1, PRESS_SPRING);
  }, [progress]);
  const pressOut = useCallback((): void => {
    progress.value = withSpring(0, PRESS_SPRING);
  }, [progress]);

  return { progress, pressIn, pressOut };
}

export { usePressProgress };
export type { IPressProgress };
