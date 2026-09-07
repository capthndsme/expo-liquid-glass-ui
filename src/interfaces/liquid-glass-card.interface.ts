import type { ReactNode } from "react";
import type { ColorValue, StyleProp, ViewStyle } from "react-native";

import type {
  GlassCornerRadius,
  GlassMetalOptions,
  LiquidGlassViewProps,
} from "../core";

interface ILiquidGlassCardProps {
  /** Makes the card a control: it presses to 98% and fires on release. */
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** Corner radius, continuous. A per-corner object is accepted. Defaults to 24. */
  cornerRadius?: GlassCornerRadius;
  /** Inner padding, dp. Defaults to 16. */
  padding?: number;
  /**
   * Adaptive glass: the frost flips polarity with the backdrop under the card. The card's
   * `children` are yours to dress — pair with `useAdaptiveGlass` for a label that follows.
   * Defaults to `false`.
   */
  adaptive?: boolean;
  /** Surface wash. Defaults to the scheme's bar surface. */
  tint?: ColorValue;
  variant?: LiquidGlassViewProps["variant"];
  /** The card's glass. Defaults to the kit's panel recipe (the bar's material). */
  metal?: GlassMetalOptions;
  /** Android only — which `LiquidGlassProvider` supplies the backdrop. */
  providerId?: string | string[];
  accessibilityLabel?: string;
  /** The outer frame — size it here. */
  style?: StyleProp<ViewStyle>;
  /** The inner content view. */
  contentStyle?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

export type { ILiquidGlassCardProps };
