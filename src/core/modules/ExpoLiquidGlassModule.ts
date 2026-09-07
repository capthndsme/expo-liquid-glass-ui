import { requireOptionalNativeModule } from "expo";

import { NATIVE_MODULE_NAME } from "../constants";
import type { IGlassHdrStatus } from "../interfaces";

interface IExpoLiquidGlassModule {
  supportsNativeGlass: boolean;
  /**
   * Whether any glass renderer is available, native or not. Optional because natives built
   * before this constant existed don't export it — readers must fall back to
   * {@link supportsNativeGlass}, which restores the old (over-strict on iOS) behaviour.
   */
  supportsGlass?: boolean;
  /** Android only — absent on iOS and web. See {@link setGlassDebugLogging}. */
  setDebugLogging?: (enabled: boolean) => void;
  /** Android only — absent on iOS and web. See {@link setGlassHdrEnabled}. */
  setHdrEnabled?: (enabled: boolean) => Promise<IGlassHdrStatus>;
  /** Android only — absent on iOS and web. See {@link getGlassHdrStatus}. */
  getHdrStatus?: () => IGlassHdrStatus;
}

const ExpoLiquidGlassModule =
  requireOptionalNativeModule<IExpoLiquidGlassModule>(NATIVE_MODULE_NAME);

export { ExpoLiquidGlassModule };
export type { IExpoLiquidGlassModule };
