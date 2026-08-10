package expo.modules.liquidglass.glass

import expo.modules.liquidglass.enums.GlassVariant
import expo.modules.liquidglass.records.GlassMetalOptions
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

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
   * How far a **refracted** tap can land outside the view, in pixels.
   *
   * Usually zero, and that is the whole point. The shader computes
   * `base = pixels - amount * direction` where `direction` is the *outward* SDF gradient
   * (`gradSdRoundedRect` returns `sign(c) * …`), so a positive `amount` moves the sample **inward**
   * and reads nothing outside the view at all. Only a negative `amount` flips it outward, which
   * needs a negative `refraction.amount` or a negative `curve.bias` — neither of which any variant
   * default produces.
   *
   * `amount = (profile + bias * (1 - t)) * refractionAmount` with `profile` and `(1 - t)` both in
   * `[0, 1]`, so the bracket is bounded by `[min(0, bias), max(1, 1 + bias)]` and the outward
   * extreme is whichever end goes negative once multiplied out.
   */
  val refractionReachPx: Float
    get() {
      val lo = min(0f, curveBias) * refractionAmountPx
      val hi = max(1f, 1f + curveBias) * refractionAmountPx
      return max(0f, -min(lo, hi))
    }

  /**
   * How far a **dispersion** tap can land outside the view, in pixels.
   *
   * The taps walk along `tangent`, the perpendicular of the refraction direction — *along* the
   * edge rather than across it — by `(u - 0.5) * spread` with `u` in `[0, 1]`, so at most half the
   * spread either way. On a straight edge that never leaves the shape; only near a corner does it
   * carry a tap past the boundary, and never by more than this.
   *
   * `spread = circleMap(1 - dispersionT) * dispersionAmount` peaks at `dispersionAmount` on the
   * boundary itself, so half of that is the bound. Not to be confused with [dispersionReachPx],
   * which is the `dispersion.reach` prop — the depth over which the spread decays.
   */
  val dispersionOutwardReachPx: Float get() = 0.5f * abs(dispersionAmountPx)

  /** How far `createBlurEffect` smears, in pixels. Zero when the blur stage is skipped. */
  val blurReachPx: Float
    get() = if (blurRadiusPx > 0.01f) max(blurRadiusPx * 1.5f, 16f * density) else 0f

  /**
   * How far outside the view the backdrop node must extend, in pixels.
   *
   * iOS uses `max(refraction + dispersion, blurExtent)` (`GlassSurfaceView.swift:133-137`).
   * **Android must add them instead**, and the difference is not cosmetic: on iOS the blur pass
   * reads from the whole-window capture, which itself extends up to 220 pt beyond the region, and
   * only *writes* the padded rect — so blur contamination never reaches the padded rect's interior.
   * Here the blur's input is the padded node itself, so `TileMode.CLAMP` fabricates the outer
   * ~1.5x-blur-radius ring out of edge pixels. If a refracted tap lands in that ring it reads a
   * smear. Taking the max would put the refraction band exactly there.
   *
   * The tier matters because the reaches it has to cover differ: only the shader refracts, and only
   * API 31+ blurs.
   *
   * Note how little the shader itself contributes — see [refractionReachPx] and
   * [dispersionOutwardReachPx]. At every variant default the refraction term is **zero**, because
   * the refracted sample moves inward, and the padding is the blur's alone.
   */
  fun backdropPaddingPx(tier: GlassTier): Int {
    val reach = when (tier) {
      GlassTier.FULL -> refractionReachPx + dispersionOutwardReachPx + blurReachPx
      GlassTier.BLUR -> blurReachPx
      // A scrim draws the backdrop untouched — it samples nothing outside the view.
      GlassTier.SCRIM, GlassTier.NONE -> return 0
    }
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

  /**
   * `(cos angle, sin angle)`, so the shader's angular highlight costs no transcendentals per pixel.
   *
   * Metal computes `sin(atan2(n.y, n.x) - highlightAngle)`; expanding by the sine difference
   * identity gives `n.y * cos - n.x * sin`, which is exact.
   */
  val highlightCos: Float get() = cos(highlightAngleRadians)
  val highlightSin: Float get() = sin(highlightAngleRadians)

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
