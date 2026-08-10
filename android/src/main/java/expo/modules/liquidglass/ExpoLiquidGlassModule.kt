package expo.modules.liquidglass

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.types.Either
import expo.modules.liquidglass.enums.GlassBackend
import expo.modules.liquidglass.enums.GlassCornerStyle
import expo.modules.liquidglass.enums.GlassVariant
import expo.modules.liquidglass.glass.CornerRadii
import expo.modules.liquidglass.glass.GlassDebug
import expo.modules.liquidglass.glass.GlassTier
import expo.modules.liquidglass.records.GlassCornerRadii
import expo.modules.liquidglass.records.GlassMetalOptions

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

      OnViewDestroys { view: LiquidGlassProviderView ->
        view.release()
      }
    }

    View(LiquidGlassView::class) {
      Name("LiquidGlassView")
      Events("onRendererChange")

      Prop("providerId") { view: LiquidGlassView, id: String? ->
        view.providerId = id ?: DEFAULT_PROVIDER_ID
      }

      Prop("variant") { view: LiquidGlassView, value: GlassVariant? ->
        view.variant = value ?: GlassVariant.regular
      }

      Prop("renderer") { view: LiquidGlassView, value: GlassBackend? ->
        view.backend = value ?: GlassBackend.auto
      }

      Prop("cornerStyle") { view: LiquidGlassView, value: GlassCornerStyle? ->
        view.cornerStyle = value ?: GlassCornerStyle.continuous
      }

      Prop("cornerRadius") { view: LiquidGlassView, value: Either<Double, GlassCornerRadii>? ->
        view.rawCornerRadii =
          CornerRadii.from(value, view.resources.displayMetrics.density)
      }

      // Declared as Int, not Color: the built-in Color converter rejects `rgba()` and
      // `PlatformColor`, and mis-parses `#RRGGBBAA` as `#AARRGGBB`. JS sends `processColor(tint)`.
      Prop("tint") { view: LiquidGlassView, value: Int? ->
        view.tint = value
      }

      Prop("interactive") { view: LiquidGlassView, value: Boolean? ->
        view.isInteractive = value ?: false
      }

      Prop("metal") { view: LiquidGlassView, value: GlassMetalOptions? ->
        view.metal = value
      }

      // Prop setters run in JS-map order, not DSL order, so none of them may depend on another
      // having landed. Everything cross-cutting is resolved once, here.
      OnViewDidUpdateProps { view: LiquidGlassView ->
        view.onPropsUpdated()
      }

      OnViewDestroys { view: LiquidGlassView ->
        view.release()
      }
    }

    View(LiquidGlassContainerView::class) {
      Name("LiquidGlassContainerView")

      // iOS-only; see LiquidGlassContainerView's docs for why it is not portable.
      Prop("spacing") { _: LiquidGlassContainerView, _: Double? -> }
    }
  }
}
