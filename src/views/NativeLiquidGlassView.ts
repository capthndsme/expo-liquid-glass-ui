import type { ComponentType, RefAttributes } from "react";
import type { View } from "react-native";

import { NATIVE_MODULE_NAME, NATIVE_VIEW_NAMES } from "../constants";
import type { INativeLiquidGlassViewProps } from "../interfaces";
import { requireNativeViewOnce } from "../utils";

/**
 * The ref is declared because `LiquidGlassView` forwards one — Reanimated needs a handle on the
 * host view to write `metal` and `glow` from the UI thread.
 */
const NativeLiquidGlassView: ComponentType<
  INativeLiquidGlassViewProps & RefAttributes<View>
> = requireNativeViewOnce<INativeLiquidGlassViewProps & RefAttributes<View>>(
  NATIVE_MODULE_NAME,
  NATIVE_VIEW_NAMES.LIQUID_GLASS_VIEW,
);

export { NativeLiquidGlassView };
