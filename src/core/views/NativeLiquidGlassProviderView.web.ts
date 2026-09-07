import type { ComponentType } from "react";
import { View } from "react-native";

import type { ILiquidGlassProviderProps } from "../interfaces";

/** See `NativeLiquidGlassView.web.ts`. */
const NativeLiquidGlassProviderView =
  View as unknown as ComponentType<ILiquidGlassProviderProps>;

export { NativeLiquidGlassProviderView };
