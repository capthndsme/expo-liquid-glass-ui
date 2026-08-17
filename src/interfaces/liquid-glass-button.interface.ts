import type { ReactNode } from "react";
import type { ColorValue, StyleProp, TextStyle, ViewStyle } from "react-native";
import type { LiquidGlassViewProps } from "expo-liquid-glass-view";

interface ILiquidGlassButtonProps {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /**
   * Press response. Where the base view owns it natively (iOS 26+, Android's AGSL tier) this is
   * passed straight through; on the iOS Metal renderer and Android fallback tiers a JS spring
   * reproduces the same grow-on-press. Defaults to `true`.
   */
  interactive?: boolean;
  /** Surface wash over the glass. String children default to white text when a tint is set. */
  tint?: ColorValue;
  variant?: LiquidGlassViewProps["variant"];
  /** Android only — which `LiquidGlassProvider` supplies the backdrop. */
  providerId?: string;
  /** Capsule height; the corner radius follows it. Defaults to 48. */
  height?: number;
  style?: StyleProp<ViewStyle>;
  /** The inner row (padding, gap, alignment). */
  contentStyle?: StyleProp<ViewStyle>;
  /** Applied to string children, which are wrapped in a styled `Text` automatically. */
  textStyle?: StyleProp<TextStyle>;
  children?: ReactNode;
}

export type { ILiquidGlassButtonProps };
