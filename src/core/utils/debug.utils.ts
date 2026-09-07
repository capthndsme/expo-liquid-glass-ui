import { ExpoLiquidGlassModule } from "../modules";

/**
 * Turns on native diagnostics for the Android glass path.
 *
 * Logs provider-recording and glass-draw rates once a second to logcat under the
 * `ExpoLiquidGlass` tag, plus a warning whenever a glass view resolves no provider. Both counters
 * must stop moving when the screen is at rest — that is the instrument for confirming the backdrop
 * costs nothing at idle.
 *
 * No-ops on iOS and web, where the native module has no such function.
 */
function setGlassDebugLogging(enabled: boolean): void {
  ExpoLiquidGlassModule?.setDebugLogging?.(enabled);
}

export { setGlassDebugLogging };
