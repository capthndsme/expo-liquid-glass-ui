package expo.modules.liquidglass

import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Display
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.types.Either
import expo.modules.liquidglass.enums.GlassBackend
import expo.modules.liquidglass.enums.GlassCornerStyle
import expo.modules.liquidglass.enums.GlassVariant
import expo.modules.liquidglass.glass.CornerRadii
import expo.modules.liquidglass.glass.GlassDebug
import expo.modules.liquidglass.glass.GlassHdr
import expo.modules.liquidglass.glass.GlassShaderCache
import expo.modules.liquidglass.glass.GlassTier
import expo.modules.liquidglass.records.GlassCornerRadii
import expo.modules.liquidglass.records.GlassGlowOptions
import expo.modules.liquidglass.records.GlassMetalOptions

class ExpoLiquidGlassModule : Module() {
  override fun definition() = ModuleDefinition {
    // Must match NATIVE_MODULE_NAME on the JS side.
    Name("ExpoLiquidGlass")

    // A capability flag, not a claim about Apple's material — Android has no equivalent of that
    // and never will. True from API 29, where `RenderNode` makes a live backdrop possible.
    Constant("supportsNativeGlass") { GlassTier.supported.hasLiveBackdrop }

    // Same value on Android; the split only matters on iOS, where "Apple's native glass" (26+)
    // and "any glass renderer" (all supported versions) genuinely differ. JS mounts on this one.
    Constant("supportsGlass") { GlassTier.supported.hasLiveBackdrop }

    // Diagnostics. Logs provider-recording and glass-draw rates to logcat under the
    // "ExpoLiquidGlass" tag, plus warnings when a glass view resolves no provider.
    Function("setDebugLogging") { enabled: Boolean ->
      GlassDebug.enabled = enabled
    }

    // The HDR opt-in. Window-level and never automatic: COLOR_MODE_HDR switches the *whole*
    // window to FP16 buffers (double the bandwidth), so the app owns the decision. The stored
    // request is re-applied on every foreground below, which is what makes it survive activity
    // recreation. Only the glass border light uses the headroom — see GlassHdr / the shader's
    // hdrHeadroom uniform. API 34+; below that (or on an SDR panel) it is an honest no-op and
    // the status says so.
    AsyncFunction("setHdrEnabled") { enabled: Boolean, promise: Promise ->
      Handler(Looper.getMainLooper()).post {
        GlassHdr.setRequested(enabled, appContext.currentActivity)
        promise.resolve(hdrStatus())
      }
    }

    Function("getHdrStatus") { hdrStatus() }

    OnActivityEntersForeground {
      GlassHdr.apply(appContext.currentActivity)
    }

    // Compile every AGSL quality tier once, here, rather than lazily at first draw. Each tier is a
    // separate source string, so a bad interpolation in a tier this dev device never selects would
    // otherwise stay invisible until it reached a user's phone. Construction is an SkSL parse only —
    // the driver's real compile still happens on the RenderThread at first draw.
    OnCreate {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) GlassShaderCache.warmUp()
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
      Events("onRendererChange", "onBackdropLuminance")

      Prop("providerId") { view: LiquidGlassView, id: String? ->
        view.providerId = id ?: DEFAULT_PROVIDER_ID
      }

      Prop("providerIds") { view: LiquidGlassView, ids: List<String>? ->
        view.providerIds = ids
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

      Prop("glow") { view: LiquidGlassView, value: GlassGlowOptions? ->
        view.glow = value
      }

      Prop("adaptive") { view: LiquidGlassView, value: Boolean? ->
        view.isAdaptive = value ?: false
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

  private fun currentDisplay(): Display? {
    val activity = appContext.currentActivity ?: return null
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      activity.display
    } else {
      @Suppress("DEPRECATION")
      activity.windowManager.defaultDisplay
    }
  }

  /** `supported` is about the panel + platform; `headroom` is live and 1.0 while disabled. */
  private fun hdrStatus(): Map<String, Any> {
    val display = currentDisplay()
    return mapOf(
      "supported" to GlassHdr.isSupported(display),
      "enabled" to GlassHdr.requested,
      "headroom" to GlassHdr.currentHeadroom(display).toDouble()
    )
  }
}
