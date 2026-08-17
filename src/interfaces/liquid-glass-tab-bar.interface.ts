import type { ReactNode } from "react";
import type { ColorValue, StyleProp, TextStyle, ViewStyle } from "react-native";
import type { GlassMetalOptions } from "expo-liquid-glass-view";

interface ILiquidGlassTabIconState {
  focused: boolean;
  /** The resolved accent (focused) or inactive color, ready to pass to an icon component. */
  color: string;
  size: number;
}

interface ILiquidGlassTabItem {
  key: string;
  /** Label under the icon, and the accessibility label. Omit for icon-only tabs. */
  title?: string;
  icon?: (state: ILiquidGlassTabIconState) => ReactNode;
}

interface ILiquidGlassTabBarProps {
  tabs: ILiquidGlassTabItem[];
  selectedIndex: number;
  /** Fires on tap, and on drag-release when the pill lands on a new tab. */
  onTabSelected: (index: number) => void;
  /** Focused item color. Defaults to the scheme's system blue. */
  accentColor?: string;
  inactiveColor?: string;
  /** Wash over the bar's glass. Defaults to the scheme's bar surface. */
  tint?: ColorValue;
  /** Bar height; the indicator and corner radii follow it. Defaults to 64. */
  height?: number;
  /**
   * Full `metal` control over the pill's glass at rest. Replaces (not merges with) the kit
   * default `{ refraction: { width: 24, height: 24, amount: 80 } }`. The example app's
   * playground tab exposes every one of these on a slider with a JSON readout that pastes
   * straight in here.
   */
  pillMetal?: GlassMetalOptions;
  /**
   * The pill's glass while dragged. Replaces the kit default
   * `{ refraction: { width: 24, height: 24, amount: 104 }, highlight: { intensity: 1 } }`.
   */
  pillDraggedMetal?: GlassMetalOptions;
  /** Wash over the pill. Defaults to the scheme's indicator surface (black/white at 0.1). */
  pillTint?: ColorValue;
  /**
   * Pill inset from the bar's edge; smaller = bigger pill, and the pill is also wider than its
   * tab slot by `2 × (4 − inset)`. Defaults to 2 (60 tall in the 64 bar, 4dp wider than a slot).
   */
  pillInset?: number;
  /** Pill scale while dragged. Defaults to the reference's 78/56 ≈ 1.39. */
  pillPressedScale?: number;
  /** Android only — which `LiquidGlassProvider` supplies the backdrop. */
  providerId?: string;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}

export type {
  ILiquidGlassTabBarProps,
  ILiquidGlassTabItem,
  ILiquidGlassTabIconState,
};
