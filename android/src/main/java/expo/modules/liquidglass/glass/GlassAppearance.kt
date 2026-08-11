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
  val refractionSwirl: Float,
  val curvePower: Float,
  val curveBias: Float,
  val dispersionAmountPx: Float,
  val dispersionReachPx: Float,
  val highlightIntensity: Float,
  val highlightAngleRadians: Float,
  val highlightWidthPx: Float,
  val highlightFalloff: Float,
  val borderWidthPx: Float,
  val borderOpacity: Float,
  val density: Float
) {
  /**
   * How far a **refracted** tap can land outside the view, in pixels. Two regimes:
   *
   * **Along the displacement axis** — usually zero. The shader computes
   * `base = pixels - amount * direction` where `direction` keeps a non-negative outward
   * component for `|swirl| <= 1` (its normal term dominates; `dot(radial, normal) >= 0`
   * everywhere), so a positive `amount` moves the sample inward. Only a negative `amount` flips
   * it outward, which needs a negative `refraction.amount` or a negative `curve.bias` — neither
   * of which any variant default produces. `amount = (profile + bias * (1 - t)) *
   * refractionAmount` with `profile` and `(1 - t)` both in `[0, 1]`, so the bracket is bounded
   * by `[min(0, bias), max(1, 1 + bias)]`.
   *
   * **Around corners, via the swirl** — the lean adds a tangential component of up to
   * `|swirl|` of the unit direction, and a tangential displacement `d` can exit the shape near
   * a corner of radius `r` by `sqrt(r^2 + d^2) - r`, which approaches `d` as `r -> 0`. The radii
   * are not known here, so the bound charged is the r-independent worst case,
   * `|swirl| * maxDisplacement` — 15 dp at `regular` defaults, and exactly zero at `swirl 0`,
   * which is what keeps the Metal-parity configuration's padding unchanged.
   */
  val refractionReachPx: Float
    get() {
      val lo = min(0f, curveBias) * refractionAmountPx
      val hi = max(1f, 1f + curveBias) * refractionAmountPx
      val alongAxis = max(0f, -min(lo, hi))
      val aroundCorners = abs(refractionSwirl) * max(0f, max(abs(lo), abs(hi)))
      return alongAxis + aroundCorners
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
        // Android-only field (iOS drops the key), unitless like `depth`; not variant-driven.
        // Clamped: [refractionReachPx]'s outward-excursion bound needs |swirl| <= 1, so unlike
        // `saturation` this one is not free to run wild.
        refractionSwirl =
          scalar(refraction?.swirl, DEFAULT_REFRACTION_SWIRL).coerceIn(-1f, 1f),
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
        // Android-only field (the iOS Record has no `width`, so the key is dropped there), for an
        // Android-only remodel: the depth of the glass border light. Not variant-driven.
        highlightWidthPx = dp(highlight?.width, DEFAULT_HIGHLIGHT_WIDTH_DP),
        // Android-only. Floored here, not per-pixel: pow(0, 0) in the shader is the alternative.
        highlightFalloff =
          scalar(highlight?.falloff, DEFAULT_HIGHLIGHT_FALLOFF).coerceAtLeast(0.01f),
        // Not variant-driven; hard `?? 1`. A width of 0 hides the border entirely.
        borderWidthPx = dp(border?.width, 1f),
        borderOpacity = scalar(border?.opacity, defaults.borderOpacity),
        density = density
      )
    }

    /**
     * 180 puts the lobe axis vertical: top and bottom edges lit, side rims fading to zero at the
     * midpoints. Measured off real iOS 26 (research/04): the dark-mode bars are perfectly
     * top/bottom symmetric with dead side extremes, and the icon's axis is within ~15 degrees of
     * vertical. The old 135 (top-left lobe) matched this project's Metal fallback, not Apple.
     */
    private const val DEFAULT_HIGHLIGHT_ANGLE_DEGREES = 180.0

    /**
     * The crisp line's depth. Shipped at 5 dp, then 3.5 (PLAN F35), then 1.5 (F48); pixel
     * measurement of real iOS 26 (research/04, C10) puts Apple's line at 2-3px on a 238px icon —
     * ~0.5-0.75 dp. The faint wide glow under the lit edges is not this line's job anymore; it is
     * the separate sheen band in the HIGHLIGHT fragment.
     */
    private const val DEFAULT_HIGHLIGHT_WIDTH_DP = 0.75f

    /**
     * Kyant's `falloff` default. 1 keeps the lobes broad; the thin band, not the exponent, is
     * what keeps the line crisp. Real iOS 26 bars measure at falloff ~1 (research/04, C2).
     */
    private const val DEFAULT_HIGHLIGHT_FALLOFF = 1f

    /**
     * How far the refraction direction leans toward the light axis before normalization. Default
     * 0 — dead. Shipped one round at 0.25 on the theory that the highlight angle steers the
     * "swirl" seen on real iOS 26; per-edge pixel solves of an actual icon falsified it
     * (research/04, C8: no constant-axis lean fits all four edges, and +0.25 is the worse fit on
     * three of them). The twist the eye sees is `depthEffect`'s radial term sweeping through the
     * corners. The knob stays for taste; the default tells the truth.
     */
    private const val DEFAULT_REFRACTION_SWIRL = 0f
  }
}
