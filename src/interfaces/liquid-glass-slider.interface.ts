import type { StyleProp, ViewStyle } from "react-native";
import type { GlassMetalOptions } from "expo-liquid-glass-view";

interface ILiquidGlassSliderProps {
  value?: number;
  onValueChange?: (value: number) => void;
  /** Fires once when the gesture ends, after the thumb has been released. */
  onSlidingComplete?: (value: number) => void;
  minimumValue?: number;
  maximumValue?: number;
  disabled?: boolean;
  /**
   * Filled-track colour. A parseable colour string — it feeds `Animated` interpolation. Defaults
   * to the scheme's system blue.
   */
  accentColor?: string;
  /** Unfilled-track colour. Same string constraint. */
  trackColor?: string;
  /** The thumb's glass at rest — an 8dp frost under an opaque white fill. */
  thumbMetal?: GlassMetalOptions;
  /** The thumb's glass while held: bare `lens(10dp, 14dp)` with dispersion, and no blur. */
  thumbPressedMetal?: GlassMetalOptions;
  /**
   * Android only — which `LiquidGlassProvider` supplies the screen behind the slider; the thumb
   * combines it with the internal track layer. Defaults to `"default"`.
   */
  providerId?: string;
  style?: StyleProp<ViewStyle>;
}

export type { ILiquidGlassSliderProps };
