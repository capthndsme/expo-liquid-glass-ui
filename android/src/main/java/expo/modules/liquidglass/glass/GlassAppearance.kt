package expo.modules.liquidglass.glass

import expo.modules.liquidglass.enums.GlassVariant
import expo.modules.liquidglass.records.GlassMetalOptions
import kotlin.math.ceil
import kotlin.math.max

/**
 * A fully resolved appearance, in **pixels and radians**, ready to become shader uniforms.
 *
 * This is the Android analogue of `LiquidGlassView.applyAppearance()` (`LiquidGlassView.swift:240-274`)
 * and reproduces its two documented quirks deliberately rather than fixing them on one platform:
 *
 * 1. `dispersion.reach` falls back to the **refraction** height default — not to a dedicated value,
 *    and not to a caller-supplied `refraction.height`.
 * 2. `refraction.curve` is all-or-nothing; a partial object takes the Record defaults for the rest.
 */
internal data class GlassAppearance(
  val blurRadiusPx: Float,
  val opacity: Float,
  val frost: Float,
  val saturation: Float,
  val noise: Float,
  val light: Float,
  val refractionAmountPx: Float,
  val refractionWidthPx: Float,
  val refractionHeightPx: Float,
  val refractionDepth: Float,
  val curvePower: Float,
  val curveBias: Float,
  val dispersionAmountPx: Float,
  val dispersionReachPx: Float,
  val highlightIntensity: Float,
  val highlightAngleRadians: Float,
  val borderWidthPx: Float,
  val borderOpacity: Float,
  val density: Float
) {
  /**
   * How far outside the view we must sample, in pixels.
   *
   * Identical to `GlassSurfaceView.swift:133-137`, with the point constants converted to pixels:
   * `ceil(max(refraction + dispersion, blur > 0.01 ? max(blur * 1.5, 16dp) : 0) + 2dp)`.
   */
  val backdropPaddingPx: Int
    get() {
      val blurReach =
        if (blurRadiusPx > 0.01f) max(blurRadiusPx * 1.5f, 16f * density) else 0f
      val reach = max(refractionAmountPx + dispersionAmountPx, blurReach)
      return ceil(reach + 2f * density).toInt()
    }

  /** Whether the blur stage is worth running at all. Mirrors the iOS `radius <= 0.01` early-out. */
  val hasBlur: Boolean get() = blurRadiusPx > 1f

  /**
   * `createBlurEffect` takes a radius, and HWUI converts it internally as
   * `sigma = 0.57735 * R + 0.5`. iOS uses `sigma = 0.5 * blurRadiusPx`, so matching the two gives
   * `R = (0.5 * blurRadiusPx - 0.5) / 0.57735`.
   */
  val hwuiBlurRadius: Float get() = (0.5f * blurRadiusPx - 0.5f) / 0.57735f

  companion object {
    fun resolve(
      variant: GlassVariant,
      metal: GlassMetalOptions?,
      density: Float
    ): GlassAppearance {
      val defaults = variant.metalDefaults
      val refraction = metal?.refraction
      val dispersion = metal?.dispersion
      val highlight = metal?.highlight
      val border = metal?.border
      val curve = refraction?.curve

      fun dp(override: Double?, fallback: Float): Float =
        (override?.toFloat() ?: fallback) * density

      fun scalar(override: Double?, fallback: Float): Float =
        override?.toFloat() ?: fallback

      return GlassAppearance(
        blurRadiusPx = dp(metal?.blurRadius, defaults.blurRadius),
        // Not variant-driven, and deliberately unclamped, matching LiquidGlassView.swift:269.
        opacity = scalar(metal?.opacity, 1f),
        frost = scalar(metal?.frost, defaults.frost),
        // Unclamped: the iOS demo passes -5 and iOS does not object.
        saturation = scalar(metal?.saturation, defaults.saturation),
        noise = scalar(metal?.noise, defaults.noise),
        light = scalar(metal?.light, defaults.light),
        refractionAmountPx = dp(refraction?.amount, defaults.refractionAmount),
        refractionWidthPx = dp(refraction?.width, defaults.refractionWidth),
        refractionHeightPx = dp(refraction?.height, defaults.refractionHeight),
        refractionDepth = scalar(refraction?.depth, defaults.refractionDepth),
        // All-or-nothing, quirk (2) above.
        curvePower = if (curve != null) curve.power.toFloat() else defaults.curvePower,
        curveBias = if (curve != null) curve.bias.toFloat() else defaults.curveBias,
        dispersionAmountPx = dp(dispersion?.amount, defaults.dispersionAmount),
        // Quirk (1): the fallback is the *refraction* height default.
        dispersionReachPx = dp(dispersion?.reach, defaults.refractionHeight),
        highlightIntensity = scalar(highlight?.intensity, defaults.highlightIntensity),
        // Not variant-driven; hard `?? 135`, degrees in, radians out.
        highlightAngleRadians =
          Math.toRadians(highlight?.angle ?: DEFAULT_HIGHLIGHT_ANGLE_DEGREES).toFloat(),
        // Not variant-driven; hard `?? 1`. A width of 0 hides the border entirely.
        borderWidthPx = dp(border?.width, 1f),
        borderOpacity = scalar(border?.opacity, defaults.borderOpacity),
        density = density
      )
    }

    private const val DEFAULT_HIGHLIGHT_ANGLE_DEGREES = 135.0
  }
}
