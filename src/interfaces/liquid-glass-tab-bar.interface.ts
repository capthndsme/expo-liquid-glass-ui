import type { ReactNode } from "react";
import type { ColorValue, StyleProp, TextStyle, ViewStyle } from "react-native";
import type { GlassMetalOptions } from "../core";

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
  /**
   * Adaptive glass: the bar reads the backdrop under it and switches its whole dress — surface
   * wash, accent, inactive colour, the pill's lift — to the palette that reads over it, with the
   * frost crossfading natively and the labels crossfading with it. Over a light card in a dark
   * app the bar goes light with dark labels, and back. Shader renderers only; explicit `tint`,
   * `accentColor`, `inactiveColor` and `pillTint` still win. Defaults to `false`.
   */
  adaptive?: boolean;

  /**
   * How much material the bar wears. Defaults to `"regular"`.
   *
   * `"regular"` is the catalog's bar: a 42% container fill under the lens, which is what keeps a
   * label readable over *anything* behind it. `"clear"` pulls that fill back to a hint and lets
   * the glass carry the look — the right choice over photos and video, where a scrim reads as a
   * grey slab, and the wrong one over dense or high-contrast content, where the labels go with it.
   *
   * It switches the whole dress at once: the bar's material, the surface wash, and the accent
   * strip behind the pill. `barMetal` and `tint` still override either.
   */
  variant?: "regular" | "clear";
  /** Bar height. Defaults to 64. */
  height?: number;
  /**
   * The bar's own glass. The reference runs `vibrancy -> blur(8dp) -> lens(24dp, 24dp)` here
   * **permanently**, and that is the whole reason its pill reads as "extra clear": the pill is an
   * undistorted window cut into a distorted panel. Flatten this and the pill has nothing to
   * contrast against.
   */
  barMetal?: GlassMetalOptions;
  /**
   * The bar's blur, dp — the one dial most apps want without rewriting `barMetal`. Applied to
   * the bar **and** to the accent strip the pill reads through, so the resting pill stays the
   * same frost as the bar around it (the strip is the only glass in the pill's stack, so a bar
   * at 4 over a strip at 8 would put a blurrier window in a sharper bar). Defaults to the
   * reference's 8. An explicit `barMetal` still wins for the bar; the strip follows its
   * `blurRadius`, or this.
   */
  blurRadius?: number;
  /**
   * The pill's glass at rest. The reference attaches *no render effect at all* here — its
   * `lens()` early-returns at zero — leaving a flat 10% wash over a pin-sharp backdrop.
   */
  pillMetal?: GlassMetalOptions;
  /**
   * The pill's glass while grabbed: `lens(10dp, 14dp, chromaticAberration = true)` and nothing
   * else. No blur, no saturation boost — those belong to the bar.
   */
  pillDraggedMetal?: GlassMetalOptions;
  /** Wash over the pill. Defaults to the scheme's indicator surface (black/white at 0.1). */
  pillTint?: ColorValue;
  /** Pill height. Defaults to 56 — the reference's, in a 64 bar. */
  pillHeight?: number;
  /** Pill scale while dragged. Defaults to the reference's `78 / 56`. */
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
