import type { ReactNode } from "react";
import type { ColorValue, StyleProp, TextStyle, ViewStyle } from "react-native";

import type { GlassMetalOptions, LiquidGlassViewProps } from "../core";

interface ILiquidGlassToolbarProps {
  /**
   * The title. A string is set in a glass capsule of its own between the two ends; a node is
   * rendered as given.
   */
  title?: ReactNode;
  /** Controls at the leading end — a back button, a menu. They merge when pressed. */
  leading?: ReactNode;
  /** Controls at the trailing end — actions. They merge when pressed. */
  trailing?: ReactNode;
  /** The merge distance for each end's group, dp. Defaults to 28. */
  spacing?: number;
  /** Gap between controls at either end, dp. Defaults to 12. */
  gap?: number;
  /** Bar height, dp. Defaults to 48. */
  height?: number;
  /** The title capsule's wash. Defaults to the scheme's bar surface. */
  tint?: ColorValue;
  variant?: LiquidGlassViewProps["variant"];
  /** The title capsule's glass. Defaults to the kit's button recipe. */
  metal?: GlassMetalOptions;
  /** Android only — which `LiquidGlassProvider` supplies the backdrop. */
  providerId?: string | string[];
  style?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
}

export type { ILiquidGlassToolbarProps };
