import type { ColorValue, StyleProp, TextStyle, ViewStyle } from "react-native";
import type { GlassMetalOptions } from "expo-liquid-glass-view";

interface ILiquidGlassSegmentedControlProps {
  /** Segment labels, equal-width. */
  segments: string[];

  selectedIndex: number;

  onChange: (index: number) => void;

  /** Control height; the corner radius follows it. Defaults to 40. */
  height?: number;

  /** Track wash. Defaults to the palette's `tabBarSurface`. */
  tint?: ColorValue;

  /** Thumb wash. Defaults to the palette's `tabIndicatorSurface`. */
  thumbTint?: ColorValue;

  /** The thumb's glass. Defaults to the kit's thumb recipe. */
  thumbMetal?: GlassMetalOptions;

  /** Android only — which `LiquidGlassProvider` supplies the backdrop. */
  providerId?: string | string[];

  style?: StyleProp<ViewStyle>;

  textStyle?: StyleProp<TextStyle>;
}

export type { ILiquidGlassSegmentedControlProps };
