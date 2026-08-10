import { Platform } from "react-native";

import { ExpoLiquidGlassModule } from "../modules";

/**
 * Whether this device has a hardware glass path.
 *
 * The `Constant` exported by the native module is the real gate — it already encodes the iOS
 * version check and, on Android, the API-level ladder (a live backdrop needs `RenderNode`, API 29).
 * The `Platform.OS` test is only here so that web and any future platform without a native module
 * short-circuit before touching it.
 *
 * Note the name is historical: Android never has Apple's *native* material, and never will. Read
 * this as "glass is supported", which is what {@link supportsGlass} says more plainly.
 */
const supportsNativeGlass: boolean =
  (Platform.OS === "ios" || Platform.OS === "android") &&
  ExpoLiquidGlassModule?.supportsNativeGlass === true;

/** Clearer alias for {@link supportsNativeGlass}. Prefer this in new code. */
const supportsGlass: boolean = supportsNativeGlass;

export { supportsNativeGlass, supportsGlass };
