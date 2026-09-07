import type { ReactNode } from "react";
import type { ColorValue, StyleProp, TextStyle, ViewStyle } from "react-native";
import type {
  GlassMetalOptions,
  LiquidGlassViewProps,
} from "expo-liquid-glass-view";

interface ILiquidGlassMorphItem {
  key: string;
  /** Wrapped in a styled `Text`. */
  label?: string;
  /** Rendered before the label. */
  icon?: ReactNode;
  onPress?: () => void;
}

interface ILiquidGlassMorphGroupProps {
  /** The capsules, laid out in a row. Two or more make the morph reachable. */
  items: ILiquidGlassMorphItem[];

  /**
   * A capsule was dragged onto a neighbour and released there. What that *means* — combining
   * actions, stacking items, a folder — is the app's; the group only springs everything home.
   */
  onMerge?: (fromKey: string, toKey: string) => void;

  /** A plain tap, forwarded alongside the item's own `onPress`. */
  onItemPress?: (key: string) => void;

  /**
   * The distance at which two capsules begin to fuse, dp — `UIGlassContainerEffect.spacing`'s
   * meaning, fed to the shader renderers' smooth-min. Defaults to 28.
   */
  spacing?: number;

  /** Gap between capsules at rest, dp. Defaults to 12. */
  gap?: number;

  /** Capsule height; corner radius follows it. Defaults to 48. */
  height?: number;

  /** Surface wash over every capsule's glass. */
  tint?: ColorValue;

  variant?: LiquidGlassViewProps["variant"];

  /** The capsule glass. Defaults to the kit's button recipe (border stripped on the canvas). */
  metal?: GlassMetalOptions;

  /** Android only — which `LiquidGlassProvider` supplies the backdrop. */
  providerId?: string | string[];

  style?: StyleProp<ViewStyle>;

  /** Applied to item labels. */
  textStyle?: StyleProp<TextStyle>;
}

export type { ILiquidGlassMorphGroupProps, ILiquidGlassMorphItem };
