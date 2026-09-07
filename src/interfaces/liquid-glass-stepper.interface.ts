import type { ColorValue, StyleProp, TextStyle, ViewStyle } from "react-native";

import type { GlassMetalOptions } from "../core";

interface ILiquidGlassStepperProps {
  value: number;
  onValueChange: (value: number) => void;
  minimumValue?: number;
  maximumValue?: number;
  /** Increment per tap. Defaults to 1. */
  step?: number;
  disabled?: boolean;
  /**
   * Holding an end keeps stepping, the way the system stepper does — every 110 ms after a
   * 400 ms hold. Defaults to `true`.
   */
  autoRepeat?: boolean;
  /** Formats the value for display. Defaults to `String(value)`. */
  formatValue?: (value: number) => string;
  /** Control height; the corner radius follows it. Defaults to 40. */
  height?: number;
  /** Track wash. Defaults to the scheme's bar surface. */
  tint?: ColorValue;
  /** The pressed end's wash. Defaults to the scheme's indicator surface. */
  thumbTint?: ColorValue;
  /** The pressed end's glass. Defaults to the kit's thumb recipe. */
  thumbMetal?: GlassMetalOptions;
  /** Android only — which `LiquidGlassProvider` supplies the backdrop. */
  providerId?: string | string[];
  style?: StyleProp<ViewStyle>;
  /** The value's text. */
  textStyle?: StyleProp<TextStyle>;
}

export type { ILiquidGlassStepperProps };
