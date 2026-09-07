import type { ReactNode } from "react";
import type { ColorValue, StyleProp, ViewStyle } from "react-native";

import type { GlassMetalOptions, LiquidGlassViewProps } from "../core";

interface ILiquidGlassSheetProps {
  /** Up while `true`; slides away when it turns `false`. */
  visible: boolean;
  /**
   * Called when the sheet wants to go — dragged down past 30 % of its height, flung down, or the
   * dim behind it tapped. The app flips `visible`; the sheet never hides itself.
   */
  onDismiss?: () => void;
  /** The sheet's height, dp. Defaults to 420. */
  height?: number;
  /** Top corner radius, continuous. Defaults to 28. */
  cornerRadius?: number;
  /** Shows the grab handle. Defaults to `true`. */
  handle?: boolean;
  /** Opacity of the black dim behind the sheet at full height; `0` for none. Defaults to 0.25. */
  dim?: number;
  /** A tap on the dim dismisses. Defaults to `true`. */
  dismissOnTap?: boolean;
  /** Surface wash. Defaults to the scheme's bar surface. */
  tint?: ColorValue;
  variant?: LiquidGlassViewProps["variant"];
  /** The sheet's glass. Defaults to the kit's panel recipe (the bar's material). */
  metal?: GlassMetalOptions;
  /** Android only — which `LiquidGlassProvider` supplies the backdrop. */
  providerId?: string | string[];
  /** The sheet frame — positioned absolutely at the bottom of its parent. */
  style?: StyleProp<ViewStyle>;
  /** The content view, under the handle. */
  contentStyle?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

export type { ILiquidGlassSheetProps };
