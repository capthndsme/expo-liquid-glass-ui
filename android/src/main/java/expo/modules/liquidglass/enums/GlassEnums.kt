package expo.modules.liquidglass.enums

import expo.modules.kotlin.types.Enumerable
import expo.modules.liquidglass.glass.GlassTier

/**
 * Entry names are matched against the JS string literals verbatim, so they are lowercase and
 * intentionally do not follow Kotlin enum-naming convention. 1:1 with `ios/Enums/GlassVariant.swift`.
 */
@Suppress("EnumEntryName")
enum class GlassVariant : Enumerable {
  regular,
  clear;

  val metalDefaults: MetalDefaults
    get() = when (this) {
      regular -> REGULAR_DEFAULTS
      clear -> CLEAR_DEFAULTS
    }

  private companion object {
    // ios/Enums/GlassVariant.swift:32-67. Do NOT copy the stored-property defaults in
    // GlassSurfaceView.swift:16-42 — those are dead code, overwritten by applyAppearance() in
    // init before any frame is drawn, and they differ from these.
    val REGULAR_DEFAULTS = MetalDefaults(
      blurRadius = 0f,
      refractionWidth = 20f,
      refractionHeight = 20f,
      refractionAmount = 60f,
      refractionDepth = 1f,
      curvePower = 1f,
      curveBias = 0f,
      dispersionAmount = 6f,
      light = 0f,
      frost = 0.36f,
      saturation = 1.8f,
      highlightIntensity = 0.25f,
      noise = 0.05f,
      borderOpacity = 0.28f
    )

    val CLEAR_DEFAULTS = MetalDefaults(
      blurRadius = 0f,
      refractionWidth = 10f,
      refractionHeight = 10f,
      refractionAmount = 30f,
      refractionDepth = 0f,
      curvePower = 1f,
      curveBias = 0f,
      dispersionAmount = 10f,
      light = 0f,
      frost = 0.06f,
      saturation = 1.15f,
      highlightIntensity = 0.35f,
      noise = 0.06f,
      borderOpacity = 0.4f
    )
  }
}

/**
 * Per-variant fallbacks for every `metal` field that has one. Lengths are in **dp**, matching iOS
 * points; they are converted to pixels during resolution.
 *
 * Note there is no `dispersionReach`: iOS falls back to [refractionHeight] for it. See
 * `GlassAppearance.resolve`.
 */
data class MetalDefaults(
  val blurRadius: Float,
  val refractionWidth: Float,
  val refractionHeight: Float,
  val refractionAmount: Float,
  val refractionDepth: Float,
  val curvePower: Float,
  val curveBias: Float,
  val dispersionAmount: Float,
  val light: Float,
  val frost: Float,
  val saturation: Float,
  val highlightIntensity: Float,
  val noise: Float,
  val borderOpacity: Float
)

/**
 * The `renderer` prop. `native` has no Android meaning — there is no Apple material to ask for —
 * so it resolves to the shader path exactly as it does on iOS below 26.
 */
@Suppress("EnumEntryName")
enum class GlassBackend : Enumerable {
  auto,
  native,
  metal
}

/**
 * Accepted for API parity and ignored. Android has no continuous-corner primitive — and the iOS
 * *Metal* renderer we are porting is already circular-only, so ignoring this is full parity with
 * it rather than a gap.
 */
@Suppress("EnumEntryName")
enum class GlassCornerStyle : Enumerable {
  continuous,
  circular
}

/**
 * `metal.android.quality`. Android-only; iOS silently drops the key.
 *
 * Selects which compiled AGSL variant the view draws with. The dispersion loop needs a
 * compile-time-constant bound to unroll, so the tiers cannot be one shader driven by a uniform.
 */
@Suppress("EnumEntryName")
enum class GlassQuality : Enumerable {
  low,
  medium,
  high
}

/**
 * `metal.android.maxTier`. Android-only; iOS silently drops the key.
 *
 * Caps how far up [expo.modules.liquidglass.glass.GlassTier] a view is allowed to go. It can only
 * ever *lower* the tier — asking for `agsl` on an API-31 device still gets `fallback-blur`, because
 * this is a ceiling and not an override.
 *
 * The entry names are the same strings `onRendererChange` reports, so a caller can compare what it
 * asked for against what it got without a second vocabulary. That is why `fallback-blur` is
 * backtick-quoted rather than renamed: [expo.modules.kotlin.types.EnumTypeConverter] matches the JS
 * string against `Enum.name` verbatim.
 *
 * **Do not give this enum a constructor parameter or a backing field.** The converter switches to
 * matching on the single declared field the moment one exists, and the name matching above would
 * stop working. [tier] is a getter, so it has no backing field.
 */
@Suppress("EnumEntryName")
enum class GlassTierCeiling : Enumerable {
  agsl,
  `fallback-blur`,
  scrim,
  none;

  val tier: GlassTier
    get() = when (this) {
      agsl -> GlassTier.FULL
      `fallback-blur` -> GlassTier.BLUR
      scrim -> GlassTier.SCRIM
      none -> GlassTier.NONE
    }
}
