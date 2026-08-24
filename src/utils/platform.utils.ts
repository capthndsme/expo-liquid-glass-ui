import { Platform } from "react-native";

import { ExpoLiquidGlassModule } from "../modules";

/**
 * Whether this device has Apple's *native* glass material (`UIGlassEffect`, iOS 26+).
 *
 * This is a layout question, not a rendering one: consumers switch tab-bar strategies on it
 * (system NativeTabs vs a floating glass pill). It says nothing about whether `LiquidGlassView`
 * will draw glass — below iOS 26 it will, via the Metal renderer. Use {@link supportsGlass} for
 * that. On Android the two flags are identical (API 29+, where `RenderNode` makes a live
 * backdrop possible); Apple's material never exists there.
 */
const supportsNativeGlass: boolean =
  (Platform.OS === "ios" || Platform.OS === "android") &&
  ExpoLiquidGlassModule?.supportsNativeGlass === true;

/**
 * Whether `LiquidGlassView` renders glass at all — native, Metal, or AGSL.
 *
 * This is the mount gate. On iOS it is true on every supported version: the view picks
 * `UIGlassEffect` on 26+, the Metal renderer below, and a blur if Metal itself is inoperable.
 * Gating the mount on {@link supportsNativeGlass} was the bug that left iOS 18–25 with plain
 * transparent `View`s — an invisible tab bar with floating icons.
 *
 * Natives older than the `supportsGlass` constant fall back to the strict flag, which restores
 * the old behaviour instead of crashing on an unregistered view manager.
 */
const supportsGlass: boolean =
  (Platform.OS === "ios" || Platform.OS === "android") &&
  (ExpoLiquidGlassModule?.supportsGlass ??
    ExpoLiquidGlassModule?.supportsNativeGlass) === true;

export { supportsNativeGlass, supportsGlass };
