/**
 * The glass view and everything around it — `LiquidGlassView`, `LiquidGlassProvider`,
 * `LiquidGlassContainer`, `LiquidGlassStack`, the `metal` types, the renderer and variant enums and
 * the capability flags. Formerly the separate `expo-liquid-glass-view` package; it lives in
 * `src/core` and keeps its own history there.
 */
export * from "./core";

export {
  LiquidGlassButton,
  LiquidGlassCard,
  LiquidGlassChip,
  LiquidGlassGroup,
  LiquidGlassIconButton,
  LiquidGlassMorphGroup,
  LiquidGlassScrim,
  LiquidGlassSegmentedControl,
  LiquidGlassSheet,
  LiquidGlassSlider,
  LiquidGlassStepper,
  LiquidGlassSwitch,
  LiquidGlassTabBar,
  LiquidGlassTextInput,
  LiquidGlassToast,
  LiquidGlassToolbar,
} from "./components";

export { GLASS_UI_PALETTE, useGlassUITheme } from "./theme";

/**
 * The reference's motion language, exported so app code can move in step with the controls.
 * `useDampedDrag` is the whole physics rig — follower, press, grab scales and the velocity jelly.
 * `useAdaptiveGlass` is the content half of adaptive glass; `useGravityHighlight` steers the
 * highlight with the accelerometer (the app supplies the samples). `useGlassGroupMember` lets a
 * control of your own join a `LiquidGlassGroup` and merge like the kit's.
 */
export {
  useAdaptiveGlass,
  useDampedDrag,
  useGlassGroupMember,
  useGravityHighlight,
  usePressProgress,
} from "./hooks";

/**
 * Blends two `metal` recipes on the UI thread — the primitive behind every control here whose
 * glass changes under the finger. `buttonPressTransform` is the button's press geometry as a
 * worklet, for a control that wants to move exactly like one.
 */
export { buttonPressTransform, lerpMetal } from "./utils";
/**
 * The kit's glass recipes, so an app can spread one and change a field — most usefully `tint`:
 * `{ ...GLASS_PILL_DRAGGED_METAL, tint: "#0088FFAA" }` is the tab pill going blue as it lifts.
 */
export {
  GLASS_ACCENT_STRIP_METAL,
  GLASS_ACCENT_STRIP_PRESSED_METAL,
  GLASS_BAR_CLEAR_METAL,
  GLASS_BAR_METAL,
  GLASS_BUTTON_METAL,
  GLASS_PANEL_METAL,
  GLASS_PILL_DRAGGED_METAL,
  GLASS_PILL_METAL,
  GLASS_SLIDER_THUMB_METAL,
  GLASS_SLIDER_THUMB_PRESSED_METAL,
  GLASS_THUMB_METAL,
  GLASS_THUMB_PRESSED_METAL,
  GLASS_TOAST_METAL,
} from "./constants";
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
  ILiquidGlassButtonIconState as LiquidGlassButtonIconState,
  TLiquidGlassButtonSize as LiquidGlassButtonSize,
  TLiquidGlassButtonShape as LiquidGlassButtonShape,
  ILiquidGlassCardProps as LiquidGlassCardProps,
  ILiquidGlassChipProps as LiquidGlassChipProps,
  ILiquidGlassGroupProps as LiquidGlassGroupProps,
  ILiquidGlassIconButtonProps as LiquidGlassIconButtonProps,
  ILiquidGlassMorphGroupProps as LiquidGlassMorphGroupProps,
  ILiquidGlassMorphItem as LiquidGlassMorphItem,
  ILiquidGlassScrimProps as LiquidGlassScrimProps,
  ILiquidGlassSegmentedControlProps as LiquidGlassSegmentedControlProps,
  ILiquidGlassSheetProps as LiquidGlassSheetProps,
  ILiquidGlassSliderProps as LiquidGlassSliderProps,
  ILiquidGlassStepperProps as LiquidGlassStepperProps,
  ILiquidGlassSwitchProps as LiquidGlassSwitchProps,
  ILiquidGlassTabBarProps as LiquidGlassTabBarProps,
  ILiquidGlassTabItem as LiquidGlassTabItem,
  ILiquidGlassTabIconState as LiquidGlassTabIconState,
  ILiquidGlassTextInputProps as LiquidGlassTextInputProps,
  ILiquidGlassToastProps as LiquidGlassToastProps,
  ILiquidGlassToolbarProps as LiquidGlassToolbarProps,
} from "./interfaces";
export type {
  IAdaptiveGlass as AdaptiveGlass,
  IAdaptiveGlassOptions as AdaptiveGlassOptions,
  IDampedDrag as DampedDrag,
  IDampedDragConfig as DampedDragConfig,
  IGlassGroupMembership as GlassGroupMembership,
  IGravityHighlight as GravityHighlight,
  IGravityHighlightOptions as GravityHighlightOptions,
} from "./hooks";
export type {
  IGlassGroupMember as GlassGroupMember,
  IGlassGroupRect as GlassGroupRect,
} from "./context";
export type { IButtonPressTransform as ButtonPressTransform } from "./utils";
export type {
  IGlassUIPalette as GlassUIPalette,
  IGlassUITheme as GlassUITheme,
} from "./theme";
