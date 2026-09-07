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
   * **permanently**. On Android the accent clone the pill reads through wears this exact recipe
   * and the bar's shape, so whatever lens the bar carries runs on under the pill rather than
   * stopping at its edge — a strong `refraction` here is just as strong through the pill. May
   * carry `tint` — a recipe's own wash wins over the bar's `tint` prop.
   */
  barMetal?: GlassMetalOptions;
  /**
   * The bar's blur, dp — the one dial most apps want without rewriting `barMetal`. The accent
   * clone the pill reads through takes the bar's whole recipe, this included, so the resting
   * pill stays the same frost as the bar around it. Defaults to the reference's 8. An explicit
   * `barMetal` still wins.
   */
  blurRadius?: number;
  /**
   * The pill's glass at rest. The reference attaches *no render effect at all* here — its
   * `lens()` early-returns at zero — leaving a flat wash over the bar exactly as it renders.
   *
   * May carry `tint`: the pill's own wash, in place of `pillTint`, crossfaded to
   * `pillDraggedMetal.tint` (or to nothing) as the pill lifts. The bar does **not** put a pill
   * tint on the pill's glass — the active glyph reaches the eye *through* that glass, and a
   * wash on it dims the glyph — but paints it beneath the glyphs, where the resting chip lives.
   * `{ ...GLASS_PILL_METAL, tint: "#0088FFB3" }` with `accentColor="#FFFFFF"` is a blue pill.
   */
  pillMetal?: GlassMetalOptions;
  /**
   * The pill's glass while grabbed: a lens across its whole face with the colour split riding it
   * (iOS 26's, wider than the reference's rim band — see `GLASS_PILL_DRAGGED_METAL`). No blur, no
   * saturation boost — those belong to the bar. Its `tint`, if any, is the
   * wash the pill takes on in the hand — `{ ...GLASS_PILL_DRAGGED_METAL, tint: "#0088FFAA" }`
   * is a pill that goes blue as it lifts — painted under the glyphs like the resting one.
   */
  pillDraggedMetal?: GlassMetalOptions;
  /**
   * The resting pill's wash — the chip. Defaults to the scheme's indicator surface (white at
   * 0.55 light / 0.30 dark: a light pill in either scheme). A `pillMetal` with its own `tint`
   * wins over this.
   */
  pillTint?: ColorValue;
  /** Pill height. Defaults to 56 — the reference's, in a 64 bar. */
  pillHeight?: number;
  /** Pill scale while dragged. Defaults to the reference's `78 / 56`. */
  pillPressedScale?: number;
  /**
   * How much the bar lights up under the grabbed pill, 0..1 — the reference's
   * `InteractiveHighlight` (a flat additive wash over the bar plus a soft lobe centred on the
   * pill, on its own bouncier spring) scaled. Defaults to **0.1**: iOS 26 lightens the bar under
   * the grab only faintly (iPhone 14 Pro Max, 2026-09-07), and the full wash spent the bar's
   * headroom — a light bar pushed toward white leaves the chip and the lifted pill nowhere
   * lighter to go. `1` is Kyant's highlight at full strength; `0` is none.
   */
  pressLight?: number;
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
