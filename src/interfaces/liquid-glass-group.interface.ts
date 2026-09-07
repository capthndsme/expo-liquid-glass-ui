import type { ReactNode } from "react";
import type { ColorValue, StyleProp, ViewStyle } from "react-native";

import type { GlassMetalOptions } from "../core";

interface ILiquidGlassGroupProps {
  /**
   * The distance at which a pressed member begins to fuse with its neighbour, dp —
   * `UIGlassContainerEffect.spacing`'s meaning, fed to the shader renderers' smooth-min. A
   * neighbour further away than this is left alone. Defaults to 28.
   */
  spacing?: number;
  /** Resting gap between members, dp. Defaults to 12. */
  gap?: number;
  /** Lay the members out along a row (default) or a column. */
  direction?: "row" | "column";
  /**
   * The canvas glass — the material the merged silhouette is drawn with. Defaults to the kit's
   * button recipe (border stripped, since a border would ring the whole canvas). Match it to the
   * members' `metal` if they wear something else.
   */
  metal?: GlassMetalOptions;
  /** Surface wash over the canvas. Members carry their own tint through a merge regardless. */
  tint?: ColorValue;
  /** Android only — which `LiquidGlassProvider` supplies the backdrop. */
  providerId?: string | string[];
  style?: StyleProp<ViewStyle>;
  /** The members — the kit's buttons, icon buttons and chips join automatically. */
  children?: ReactNode;
}

export type { ILiquidGlassGroupProps };
