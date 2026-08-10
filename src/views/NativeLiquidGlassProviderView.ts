import type { ComponentType } from "react";

import { NATIVE_MODULE_NAME, NATIVE_VIEW_NAMES } from "../constants";
import type { ILiquidGlassProviderProps } from "../interfaces";
import { requireNativeViewOnce } from "../utils";

const NativeLiquidGlassProviderView: ComponentType<ILiquidGlassProviderProps> =
  requireNativeViewOnce<ILiquidGlassProviderProps>(
    NATIVE_MODULE_NAME,
    NATIVE_VIEW_NAMES.LIQUID_GLASS_PROVIDER_VIEW,
  );

export { NativeLiquidGlassProviderView };
