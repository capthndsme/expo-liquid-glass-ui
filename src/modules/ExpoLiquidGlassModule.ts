import { requireOptionalNativeModule } from "expo";

import { NATIVE_MODULE_NAME } from "../constants";

interface IExpoLiquidGlassModule {
  supportsNativeGlass: boolean;
  /** Android only — absent on iOS and web. See {@link setGlassDebugLogging}. */
  setDebugLogging?: (enabled: boolean) => void;
}

const ExpoLiquidGlassModule =
  requireOptionalNativeModule<IExpoLiquidGlassModule>(NATIVE_MODULE_NAME);

export { ExpoLiquidGlassModule };
export type { IExpoLiquidGlassModule };
