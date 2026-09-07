import { useCallback, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import { useSharedValue, withTiming } from "react-native-reanimated";
import type { GlassLuminanceReading } from "../core";

/** The native frost crossfade is 350 ms; the content follows on the same clock. */
const ADAPTIVE_CROSSFADE_MS = 350;

interface IAdaptiveGlassOptions {
  /**
   * Which polarity to assume before the first reading arrives. Defaults to the colour scheme's
   * — dark scheme, dark polarity — which is also what the native side starts from.
   */
  initialDark?: boolean;
  /** Crossfade of `progress`, ms. Defaults to the native frost's 350. */
  duration?: number;
}

interface IAdaptiveGlass {
  /** Spread onto a `LiquidGlassView`: turns the sensor on and listens to it. */
  glassProps: {
    adaptive: true;
    onBackdropLuminance: (reading: GlassLuminanceReading) => void;
  };
  /** Whether the glass has settled on the dark polarity. React state — a flip is a rare event. */
  dark: boolean;
  /**
   * The scheme the content *on* the glass should dress for. The dark polarity is a dark frost,
   * which wants the dark palette's light label; the light polarity the reverse — the kit-wide
   * contrast pairing, driven by the backdrop instead of the OS setting.
   */
  scheme: "light" | "dark";
  /**
   * `0` at the light polarity, `1` at the dark one, timing between the two on the UI thread in
   * step with the native frost — feed it to `interpolateColor` for a label that crossfades rather
   * than snaps.
   */
  progress: SharedValue<number>;
  /** The latest raw reading, `0`–`1`, on the UI thread. */
  luminance: SharedValue<number>;
}

/**
 * Adaptive glass, the kit's half: the native `adaptive` sensor reports the backdrop's luminance
 * and settles on a polarity with hysteresis; this hook turns that into a scheme for the content
 * on the glass and a crossfade to get there. Modeled on the AndroidLiquidGlass catalog's
 * adaptive-luminance demo, which tweens its content colour to black over light backdrops and
 * white over dark ones — the behaviour iOS 26's own glass has by default.
 *
 * ```tsx
 * const adaptive = useAdaptiveGlass();
 * const { colors } = useGlassUITheme(adaptive.scheme);
 * <LiquidGlassView {...adaptive.glassProps} tint={colors.tabBarSurface} />
 * ```
 */
function useAdaptiveGlass(options: IAdaptiveGlassOptions = {}): IAdaptiveGlass {
  const schemeIsDark = useColorScheme() === "dark";
  const initialDark = options.initialDark ?? schemeIsDark;
  const duration = options.duration ?? ADAPTIVE_CROSSFADE_MS;

  const [dark, setDark] = useState(initialDark);
  const progress = useSharedValue(initialDark ? 1 : 0);
  const luminance = useSharedValue(0.5);

  const onBackdropLuminance = useCallback(
    (reading: GlassLuminanceReading): void => {
      luminance.value = reading.luminance;
      setDark((current) => {
        if (current === reading.dark) return current;
        progress.value = withTiming(reading.dark ? 1 : 0, { duration });
        return reading.dark;
      });
    },
    [duration, luminance, progress],
  );

  return useMemo<IAdaptiveGlass>(
    () => ({
      glassProps: { adaptive: true, onBackdropLuminance },
      dark,
      scheme: dark ? "dark" : "light",
      progress,
      luminance,
    }),
    [dark, luminance, onBackdropLuminance, progress],
  );
}

export { useAdaptiveGlass, ADAPTIVE_CROSSFADE_MS };
export type { IAdaptiveGlass, IAdaptiveGlassOptions };
