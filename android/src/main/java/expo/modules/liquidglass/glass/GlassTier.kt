package expo.modules.liquidglass.glass

import android.os.Build

/**
 * The Android rendering ladder.
 *
 * Android has no equivalent of Apple's `UIGlassEffect` — no primitive lets an in-app view sample
 * the pixels of its siblings. Everything here comes from the capture-and-refract route, which is
 * the *fallback* path on iOS. What we can do is bounded purely by the API level:
 *
 * | API   | Tier    | Primitive that gates it                                    |
 * |-------|---------|------------------------------------------------------------|
 * | 33+   | [FULL]  | `RuntimeShader` / `RenderEffect.createRuntimeShaderEffect` |
 * | 31–32 | [BLUR]  | `RenderEffect.createBlurEffect`                            |
 * | 29–30 | [SCRIM] | `RenderNode`                                               |
 * | < 29  | [NONE]  | — nothing; a plain tinted view                             |
 *
 * A view's *effective* tier is the minimum of [supported] and whatever degradation the view has
 * applied to itself (shader compile failure, screen-coverage budget, an explicit prop). The name
 * carried by each constant is what crosses the bridge in `onRendererChange`.
 */
enum class GlassTier(val rendererName: String) {
  /** Blur, refraction, chromatic dispersion, angular highlight, tint, frost, noise. */
  FULL("agsl"),

  /** Blur, saturation, tint and frost, clipped to the view outline. No refraction. */
  BLUR("fallback-blur"),

  /** The live backdrop drawn straight through, plus a translucent scrim. No blur, no shader. */
  SCRIM("scrim"),

  /** No hardware path at all. JS degrades to a plain view. */
  NONE("none");

  /** True when this tier still draws a live copy of the content behind the view. */
  val hasLiveBackdrop: Boolean
    get() = this != NONE

  companion object {
    /** The ceiling for this device, resolved once from the API level. */
    @JvmStatic
    val supported: GlassTier by lazy { forApiLevel(Build.VERSION.SDK_INT) }

    /**
     * The weaker of two tiers.
     *
     * Entries are declared strongest-first, so "weaker" is the higher ordinal — which is what makes
     * a ceiling composable with the device's own ceiling without either one needing to know about
     * the other.
     */
    @JvmStatic
    fun weakest(a: GlassTier, b: GlassTier): GlassTier = if (a.ordinal >= b.ordinal) a else b

    @JvmStatic
    fun forApiLevel(sdkInt: Int): GlassTier = when {
      sdkInt >= Build.VERSION_CODES.TIRAMISU -> FULL // 33 — RuntimeShader
      sdkInt >= Build.VERSION_CODES.S -> BLUR // 31 — RenderEffect
      sdkInt >= Build.VERSION_CODES.Q -> SCRIM // 29 — RenderNode
      else -> NONE
    }
  }
}
