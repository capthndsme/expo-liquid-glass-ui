import type { ReactNode } from "react";
import type { ColorValue, StyleProp, TextStyle, ViewStyle } from "react-native";
import type {
  GlassMetalOptions,
  LiquidGlassViewProps,
} from "expo-liquid-glass-view";

interface ILiquidGlassButtonProps {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /**
   * Press response: the reference's grow-on-press spring, rubber-band finger-follow, directional
   * stretch and additive white. Defaults to `true`.
   *
   * This does **not** enable the base view's native `interactive` — that animator writes the same
   * view properties React Native's `transform` style does, so the two would fight.
   */
  interactive?: boolean;
  /** Surface wash over the glass. String children default to white text when a tint is set. */
  tint?: ColorValue;
  variant?: LiquidGlassViewProps["variant"];
  /** The button's glass. Static by design; defaults to `vibrancy + blur(2dp) + lens(12dp, 24dp)`. */
  metal?: GlassMetalOptions;
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
