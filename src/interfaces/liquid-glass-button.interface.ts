import type { ReactNode } from "react";
import type {
  AccessibilityState,
  ColorValue,
  StyleProp,
  TextStyle,
  ViewStyle,
} from "react-native";

import type { GlassMetalOptions, LiquidGlassViewProps } from "../core";

type TLiquidGlassButtonSize = "small" | "regular" | "large";
type TLiquidGlassButtonShape = "capsule" | "circle";

interface ILiquidGlassButtonProps {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /**
   * Shows a spinner in place of the content and ignores presses; the capsule keeps its width.
   * Defaults to `false`.
   */
  loading?: boolean;
  /**
   * Press response: the reference's grow-on-press spring, rubber-band finger-follow, directional
   * stretch and the press light. Defaults to `true`.
   *
   * This does **not** enable the base view's native `interactive` — that animator writes the same
   * view properties React Native's `transform` style does, so the two would fight.
   */
  interactive?: boolean;
  /**
   * How much the glass lights up under the finger, 0..1 — the shader's press light (a flat
   * wash plus a lobe under the finger) scaled. `0` is no light at all: the press is carried by
   * the inflation, the rubber band and the dent alone. Defaults to 0.35; `1` is Kyant's
   * bar-sized highlight, which on a capsule reads as a flat pressed-state wash.
   */
  pressLight?: number;
  /**
   * Adaptive glass: the button reads the backdrop under it and dresses for it — a dark frost
   * with a light label over dark content, the reverse over light content, crossfading between
   * the two. Shader renderers (Android, iOS below 26); iOS 26's native glass adapts on its own.
   * Defaults to `false`. A `tint` still wins for the label colour.
   */
  adaptive?: boolean;
  /** Surface wash over the glass. String children default to white text when a tint is set. */
  tint?: ColorValue;
  variant?: LiquidGlassViewProps["variant"];
  /** The button's glass. Static by design; defaults to `vibrancy + blur(2dp) + lens(12dp, 24dp)`. */
  metal?: GlassMetalOptions;
  /** Android only — which `LiquidGlassProvider` supplies the backdrop. */
  providerId?: string | string[];
  /**
   * `small` (36dp), `regular` (48dp, the reference's) or `large` (56dp). Sets the height, the
   * side padding, the label size and the icon size together. Defaults to `regular`.
   */
  size?: TLiquidGlassButtonSize;
  /**
   * `capsule` (default) or `circle` — a circle is exactly as wide as it is tall with no side
   * padding, the shape of an icon button.
   */
  shape?: TLiquidGlassButtonShape;
  /** Capsule height; the corner radius follows it. Overrides `size`'s height. */
  height?: number;
  /**
   * Rendered before the label — an `Ionicons` glyph, an image. A function is handed the label
   * colour and the size's glyph size, so the icon dresses with the button (tint, adaptive).
   */
  icon?: ReactNode | ((state: ILiquidGlassButtonIconState) => ReactNode);
  accessibilityLabel?: string;
  /** Merged over the button's own `disabled` / `busy` state — a chip reports `selected` here. */
  accessibilityState?: AccessibilityState;
  /** The outer frame: margins, `flex`, `alignSelf`. The press transform lives inside it. */
  style?: StyleProp<ViewStyle>;
  /** The inner row (padding, gap, alignment). */
  contentStyle?: StyleProp<ViewStyle>;
  /** Applied to string children, which are wrapped in a styled `Text` automatically. */
  textStyle?: StyleProp<TextStyle>;
  children?: ReactNode;
}

interface ILiquidGlassButtonIconState {
  /** The label colour the button resolved: white when tinted, the scheme's label otherwise. */
  color: string;
  /** The glyph size for the button's `size`. */
  size: number;
}

export type {
  ILiquidGlassButtonProps,
  ILiquidGlassButtonIconState,
  TLiquidGlassButtonSize,
  TLiquidGlassButtonShape,
};
