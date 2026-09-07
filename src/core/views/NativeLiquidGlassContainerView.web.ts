import type { ComponentType } from "react";
import { View } from "react-native";

import type { ILiquidGlassContainerProps } from "../interfaces";

/** See `NativeLiquidGlassView.web.ts`. */
const NativeLiquidGlassContainerView =
  View as unknown as ComponentType<ILiquidGlassContainerProps>;

export { NativeLiquidGlassContainerView };
