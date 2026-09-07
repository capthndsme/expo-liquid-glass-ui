/**
 * The glass view and everything around it — `LiquidGlassView`, `LiquidGlassProvider`,
 * `LiquidGlassContainer`, `LiquidGlassStack`, the `metal` types, the renderer and variant enums and
 * the capability flags. Formerly the separate `expo-liquid-glass-view` package; it lives in
 * `src/core` and keeps its own history there.
 */
export * from "./core";

export {
  LiquidGlassButton,
  LiquidGlassMorphGroup,
  LiquidGlassScrim,
  LiquidGlassSegmentedControl,
  LiquidGlassSlider,
  LiquidGlassSwitch,
  LiquidGlassTabBar,
  LiquidGlassTextInput,
} from "./components";

export { GLASS_UI_PALETTE, useGlassUITheme } from "./theme";

/**
 * The reference's motion language, exported so app code can move in step with the controls.
 * `useDampedDrag` is the whole physics rig — follower, press, grab scales and the velocity jelly.
 * `useAdaptiveGlass` is the content half of adaptive glass; `useGravityHighlight` steers the
 * highlight with the accelerometer (the app supplies the samples).
 */
export {
  useAdaptiveGlass,
  useDampedDrag,
  useGravityHighlight,
  usePressProgress,
} from "./hooks";

/**
 * Blends two `metal` recipes on the UI thread — the primitive behind every control here whose
 * glass changes under the finger.
 */
export { lerpMetal } from "./utils";
export {
  GLOW_SPRING,
  PANEL_SPRING,
  PRESS_SPRING,
  SCALE_X_SPRING,
  SCALE_Y_SPRING,
  VALUE_SPRING,
  VELOCITY_SPRING,
} from "./constants";

export type {
  ILiquidGlassButtonProps as LiquidGlassButtonProps,
  ILiquidGlassMorphGroupProps as LiquidGlassMorphGroupProps,
  ILiquidGlassMorphItem as LiquidGlassMorphItem,
  ILiquidGlassScrimProps as LiquidGlassScrimProps,
  ILiquidGlassSegmentedControlProps as LiquidGlassSegmentedControlProps,
  ILiquidGlassSliderProps as LiquidGlassSliderProps,
  ILiquidGlassSwitchProps as LiquidGlassSwitchProps,
  ILiquidGlassTabBarProps as LiquidGlassTabBarProps,
  ILiquidGlassTabItem as LiquidGlassTabItem,
  ILiquidGlassTabIconState as LiquidGlassTabIconState,
  ILiquidGlassTextInputProps as LiquidGlassTextInputProps,
} from "./interfaces";
export type {
  IAdaptiveGlass as AdaptiveGlass,
  IAdaptiveGlassOptions as AdaptiveGlassOptions,
  IDampedDrag as DampedDrag,
  IDampedDragConfig as DampedDragConfig,
  IGravityHighlight as GravityHighlight,
  IGravityHighlightOptions as GravityHighlightOptions,
} from "./hooks";
export type {
  IGlassUIPalette as GlassUIPalette,
  IGlassUITheme as GlassUITheme,
} from "./theme";
