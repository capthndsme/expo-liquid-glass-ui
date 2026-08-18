export {
  LiquidGlassButton,
  LiquidGlassSlider,
  LiquidGlassSwitch,
  LiquidGlassTabBar,
  LiquidGlassTextInput,
} from "./components";

export { GLASS_UI_PALETTE, useGlassUITheme } from "./theme";

/**
 * The reference's motion language, exported so app code can move in step with the controls.
 * `useDampedDrag` is the whole physics rig — follower, press, grab scales and the velocity jelly.
 */
export { useDampedDrag, usePressProgress } from "./hooks";

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
  ILiquidGlassSliderProps as LiquidGlassSliderProps,
  ILiquidGlassSwitchProps as LiquidGlassSwitchProps,
  ILiquidGlassTabBarProps as LiquidGlassTabBarProps,
  ILiquidGlassTabItem as LiquidGlassTabItem,
  ILiquidGlassTabIconState as LiquidGlassTabIconState,
  ILiquidGlassTextInputProps as LiquidGlassTextInputProps,
} from "./interfaces";
export type {
  IDampedDrag as DampedDrag,
  IDampedDragConfig as DampedDragConfig,
} from "./hooks";
export type {
  IGlassUIPalette as GlassUIPalette,
  IGlassUITheme as GlassUITheme,
} from "./theme";
