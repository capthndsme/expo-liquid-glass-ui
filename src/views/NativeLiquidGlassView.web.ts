import type { ComponentType } from "react";
import { View } from "react-native";

import type { INativeLiquidGlassViewProps } from "../interfaces";

/**
 * There is no native module on web, and `requireNativeView` *throws* when asked for one — at
 * module scope, so merely importing the package used to crash the bundle. This shim is what makes
 * the README's "on web the components render as plain views" actually true.
 */
const NativeLiquidGlassView =
  View as unknown as ComponentType<INativeLiquidGlassViewProps>;

export { NativeLiquidGlassView };
