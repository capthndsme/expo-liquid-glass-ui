package expo.modules.liquidglass

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.liquidglass.glass.GlassDebug
import expo.modules.liquidglass.glass.GlassTier

class ExpoLiquidGlassModule : Module() {
  override fun definition() = ModuleDefinition {
    // Must match NATIVE_MODULE_NAME on the JS side.
    Name("ExpoLiquidGlass")

    // A capability flag, not a claim about Apple's material — Android has no equivalent of that
    // and never will. True from API 29, where `RenderNode` makes a live backdrop possible.
    Constant("supportsNativeGlass") { GlassTier.supported.hasLiveBackdrop }

    // Diagnostics. Logs provider-recording and glass-draw rates to logcat under the
    // "ExpoLiquidGlass" tag, plus warnings when a glass view resolves no provider.
    Function("setDebugLogging") { enabled: Boolean ->
      GlassDebug.enabled = enabled
    }

    // Every `View {}` block needs an explicit `Name()`. Without it the component registers as
    // `ViewManagerAdapter_ExpoLiquidGlass` and `requireNativeView(module, name)` cannot find it.
    // Swift gets away with omitting this; Android does not.

    View(LiquidGlassProviderView::class) {
      Name("LiquidGlassProviderView")

      Prop("providerId") { view: LiquidGlassProviderView, id: String? ->
        view.providerId = id ?: DEFAULT_PROVIDER_ID
      }
    }

    View(LiquidGlassView::class) {
      Name("LiquidGlassView")
      Events("onRendererChange")

      Prop("providerId") { view: LiquidGlassView, id: String? ->
        view.providerId = id ?: DEFAULT_PROVIDER_ID
      }
    }

    View(LiquidGlassContainerView::class) {
      Name("LiquidGlassContainerView")

      // iOS-only; see LiquidGlassContainerView's docs for why it is not portable.
      Prop("spacing") { _: LiquidGlassContainerView, _: Double? -> }
    }
  }
}
