import type { StyleProp, ViewStyle } from "react-native";

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
  /** Android only — which `LiquidGlassProvider` supplies the thumb's backdrop. */
  providerId?: string;
  style?: StyleProp<ViewStyle>;
}

export type { ILiquidGlassSwitchProps };
