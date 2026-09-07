const NATIVE_MODULE_NAME = "ExpoLiquidGlass";

const NATIVE_VIEW_NAMES = {
  LIQUID_GLASS_VIEW: "LiquidGlassView",
  LIQUID_GLASS_CONTAINER_VIEW: "LiquidGlassContainerView",
  LIQUID_GLASS_PROVIDER_VIEW: "LiquidGlassProviderView",
} as const;

const COMPONENT_NAMES = {
  LIQUID_GLASS_VIEW: "LiquidGlassView",
  LIQUID_GLASS_CONTAINER: "LiquidGlassContainer",
  LIQUID_GLASS_PROVIDER: "LiquidGlassProvider",
  LIQUID_GLASS_STACK: "LiquidGlassStack",
} as const;

export { NATIVE_MODULE_NAME, NATIVE_VIEW_NAMES, COMPONENT_NAMES };
