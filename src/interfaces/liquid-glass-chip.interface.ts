import type { ReactNode } from "react";
import type { ColorValue, StyleProp, TextStyle, ViewStyle } from "react-native";

import type { GlassMetalOptions, LiquidGlassViewProps } from "../core";
import type { ILiquidGlassButtonIconState } from "./liquid-glass-button.interface";

interface ILiquidGlassChipProps {
  /** The chip's text. */
  label: string;
  /** Rendered before the label; a function receives the resolved colour and glyph size. */
  icon?: ReactNode | ((state: ILiquidGlassButtonIconState) => ReactNode);
  /** Selected chips wear the accent as their wash and a white label. */
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  /** The selected wash. Defaults to the scheme's system blue. */
  accentColor?: ColorValue;
  /** The unselected wash. Defaults to none — bare glass. */
  tint?: ColorValue;
  variant?: LiquidGlassViewProps["variant"];
  /** The chip's glass. Defaults to the kit's button recipe. */
  metal?: GlassMetalOptions;
  /** Android only — which `LiquidGlassProvider` supplies the backdrop. */
  providerId?: string | string[];
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export type { ILiquidGlassChipProps };
