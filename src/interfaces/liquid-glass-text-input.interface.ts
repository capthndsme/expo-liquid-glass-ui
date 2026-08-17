import type { ReactNode } from "react";
import type {
  ColorValue,
  StyleProp,
  TextInputProps,
  TextStyle,
  ViewStyle,
} from "react-native";
import type { LiquidGlassViewProps } from "expo-liquid-glass-view";

interface ILiquidGlassTextInputProps
  extends Omit<TextInputProps, "style"> {
  /** Capsule height; the corner radius follows it. Defaults to 48. */
  height?: number;
  /** Surface wash over the glass. */
  tint?: ColorValue;
  variant?: LiquidGlassViewProps["variant"];
  /**
   * Native touch response on the glass frame. The inner `TextInput` consumes most touches, so
   * this mainly lights up the capsule's edges — and the whole field on iOS 26+. Defaults to
   * `true`.
   */
  interactive?: boolean;
  /** Android only — which `LiquidGlassProvider` supplies the backdrop. */
  providerId?: string;
  /** Rendered before the input inside the capsule — an icon, a prefix. */
  leading?: ReactNode;
  /** Rendered after the input inside the capsule — a clear button, a unit. */
  trailing?: ReactNode;
  /** Accent ring that springs in on focus. Defaults to `true`. */
  focusRing?: boolean;
  /** Ring color. Defaults to the scheme's system blue. */
  accentColor?: ColorValue;
  /** The outer glass frame. Give the field a width or `flex` when inside a row. */
  style?: StyleProp<ViewStyle>;
  /** The inner row (padding, gap). */
  contentStyle?: StyleProp<ViewStyle>;
  /** The `TextInput` itself. */
  inputStyle?: StyleProp<TextStyle>;
}

export type { ILiquidGlassTextInputProps };
