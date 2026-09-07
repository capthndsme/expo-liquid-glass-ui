import type { ReactNode } from "react";
import type { ColorValue, StyleProp, ViewStyle } from "react-native";

interface ILiquidGlassScrimProps {
  /**
   * Which screen edge the scrim hugs — and therefore which way the blur ramps: the side facing
   * the content stays sharp, the outer edge is fully blurred. Default `"bottom"`.
   */
  edge?: "top" | "bottom" | "left" | "right";

  /** Thickness of the scrim along its axis, dp. Default 160. */
  size?: number;

  /** Blur radius at the outer edge, dp. Default 24. */
  radius?: number;

  /**
   * Fraction of the scrim over which the ramp completes, measured from the content side.
   * Past it the blur holds at full `radius`. Default 0.7.
   */
  reach?: number;

  /** Optional wash over the blur — e.g. the bar surface colour at low alpha. Default none. */
  tint?: ColorValue;

  /** Android: which provider(s) to read. Same semantics as `LiquidGlassView`. */
  providerId?: string | string[];

  /** Extra positioning/size overrides, applied after the edge placement. */
  style?: StyleProp<ViewStyle>;

  /** Content over the scrim — a tab bar, a toolbar. Laid out edge-aligned, untouched. */
  children?: ReactNode;
}

export type { ILiquidGlassScrimProps };
