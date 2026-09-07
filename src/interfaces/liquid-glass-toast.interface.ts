import type { ReactNode } from "react";
import type { ColorValue, StyleProp, TextStyle, ViewStyle } from "react-native";

import type { GlassMetalOptions, LiquidGlassViewProps } from "../core";
import type { ILiquidGlassButtonIconState } from "./liquid-glass-button.interface";

interface ILiquidGlassToastProps {
  /** Shown while `true`; springs out when it turns `false`. */
  visible: boolean;
  /** The text. */
  message: string;
  /** Rendered before the message; a function receives the label colour and a glyph size. */
  icon?: ReactNode | ((state: ILiquidGlassButtonIconState) => ReactNode);
  /**
   * Called when the toast wants to go — after `duration`, or on a tap. The app flips `visible`;
   * the toast never hides itself.
   */
  onDismiss?: () => void;
  /** Auto-dismiss after this many ms of being visible. `0` keeps it up. Defaults to 2600. */
  duration?: number;
  /** Which screen edge it slides in from. Defaults to `"top"`. */
  edge?: "top" | "bottom";
  /** Distance from that edge, dp. Defaults to 60. */
  offset?: number;
  /** Surface wash. Defaults to the scheme's bar surface. */
  tint?: ColorValue;
  variant?: LiquidGlassViewProps["variant"];
  /** The toast's glass. Defaults to the kit's button recipe. */
  metal?: GlassMetalOptions;
  /** Android only — which `LiquidGlassProvider` supplies the backdrop. */
  providerId?: string | string[];
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export type { ILiquidGlassToastProps };
