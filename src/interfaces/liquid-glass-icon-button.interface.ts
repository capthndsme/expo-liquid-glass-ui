import type { ReactNode } from "react";

import type {
  ILiquidGlassButtonIconState,
  ILiquidGlassButtonProps,
} from "./liquid-glass-button.interface";

interface ILiquidGlassIconButtonProps
  extends Omit<ILiquidGlassButtonProps, "children" | "shape" | "icon"> {
  /**
   * The glyph. A function is handed the resolved label colour and the glyph size for the
   * button's `size`, so an `Ionicons` element can dress with the button.
   */
  icon: ReactNode | ((state: ILiquidGlassButtonIconState) => ReactNode);
  /** Required — a circle of glass has no label to read out. */
  accessibilityLabel: string;
}

export type { ILiquidGlassIconButtonProps };
