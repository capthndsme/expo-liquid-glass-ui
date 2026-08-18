import { useCallback } from "react";
import type { SharedValue, WithSpringConfig } from "react-native-reanimated";
import { useSharedValue, withSpring } from "react-native-reanimated";

import { GLOW_SPRING } from "../constants";

interface IPressProgress {
  progress: SharedValue<number>;
  pressIn: () => void;
  pressOut: () => void;
}

/**
 * A 0→1 press spring, on the reference's `InteractiveHighlight` spec by default:
 * `spring(0.5f, 300f)`, the bouncy one.
 *
 * That is deliberately *not* the spec a dragged control presses with. `DampedDragAnimation` uses
 * `spring(1f, 1000f)`, critically damped, and holds it up through the entire snap — so on the tab
 * bar the two run side by side and disagree on purpose: the pill's lens is still fully dialled in
 * while it flies home, and the light the bar throws under it has already begun to fade, because
 * `InteractiveHighlight` releases on finger-up and waits for nothing.
 *
 * Both callbacks are worklets, so a gesture handler can drive them on the UI thread; calling them
 * from JS still works, which is what the tap-only controls do.
 */
function usePressProgress(
  spring: WithSpringConfig = GLOW_SPRING,
): IPressProgress {
  const progress = useSharedValue(0);

  const pressIn = useCallback((): void => {
    "worklet";
    progress.value = withSpring(1, spring);
  }, [progress, spring]);
  const pressOut = useCallback((): void => {
    "worklet";
    progress.value = withSpring(0, spring);
  }, [progress, spring]);

  return { progress, pressIn, pressOut };
}

export { usePressProgress };
export type { IPressProgress };
