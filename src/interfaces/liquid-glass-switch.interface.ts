import type { StyleProp, ViewStyle } from "react-native";
import type { GlassMetalOptions } from "expo-liquid-glass-view";

interface ILiquidGlassSwitchProps {
  value?: boolean;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
  /**
   * Track color when on. A parseable color string (hex/rgba) — it feeds `Animated` color
   * interpolation. Defaults to the scheme's system green.
   */
  accentColor?: string;
  /** Track color when off. Same string constraint. */
  trackColor?: string;
  /** The thumb's glass at rest — an 8dp frost under an opaque white fill. */
  thumbMetal?: GlassMetalOptions;
  /** The thumb's glass while held: bare `lens(5dp, 10dp)` with dispersion, and no blur at all. */
  thumbPressedMetal?: GlassMetalOptions;
  /**
   * Android only — which `LiquidGlassProvider` supplies the screen behind the switch; the thumb
   * combines it with the internal track layer. Defaults to `"default"`.
   */
  providerId?: string;
  style?: StyleProp<ViewStyle>;
}

export type { ILiquidGlassSwitchProps };
