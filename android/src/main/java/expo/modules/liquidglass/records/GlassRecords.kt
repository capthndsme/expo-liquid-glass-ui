package expo.modules.liquidglass.records

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * Mirrors `src/interfaces/glass-metal.interface.ts` and `ios/Records/GlassMetalOptions.swift`.
 *
 * Every field is nullable so that "not supplied" is distinguishable from a supplied value — the
 * per-variant defaults in [expo.modules.liquidglass.enums.MetalDefaults] only apply to fields the
 * caller left out. Keys the caller omits leave the initializer untouched, exactly as on Swift.
 */
class GlassMetalOptions : Record {
  @Field var blurRadius: Double? = null

  /**
   * Accepted and ignored on Android. On iOS this scales the rasterized backdrop capture; the
   * Android path records a display list rather than pixels, so there is nothing to scale.
   */
  @Field var captureQuality: Double? = null

  @Field var opacity: Double? = null
  @Field var frost: Double? = null
  @Field var saturation: Double? = null
  @Field var noise: Double? = null
  @Field var light: Double? = null

  @Field var refraction: GlassRefractionOptions? = null
  @Field var dispersion: GlassDispersionOptions? = null
  @Field var highlight: GlassHighlightOptions? = null
  @Field var border: GlassBorderOptions? = null
}

class GlassRefractionOptions : Record {
  @Field var amount: Double? = null
  @Field var width: Double? = null
  @Field var height: Double? = null
  @Field var depth: Double? = null
  @Field var curve: GlassRefractionCurve? = null
}

/**
 * `curve` is **all-or-nothing** on iOS: `refraction?.curve?.simd ?? defaults.profile`. Supplying
 * `{ power: 2 }` therefore silently takes this Record's `bias` default rather than the variant's.
 * Reproduced deliberately — see PLAN.md Phase 2.
 */
class GlassRefractionCurve : Record {
  @Field var power: Double = 1.0
  @Field var bias: Double = 0.0
}

class GlassDispersionOptions : Record {
  @Field var amount: Double? = null
  @Field var reach: Double? = null
}

class GlassHighlightOptions : Record {
  @Field var intensity: Double? = null

  /** Degrees, screen-space with y increasing downward. Converted to radians during resolution. */
  @Field var angle: Double? = null
}

class GlassBorderOptions : Record {
  @Field var width: Double? = null
  @Field var opacity: Double? = null
}

/**
 * The object form of `cornerRadius`.
 *
 * Mind the swizzle contract shared with the shader: `.x` = bottom-left, `.y` = bottom-right,
 * `.z` = top-right, `.w` = top-left, with y increasing downward.
 */
class GlassCornerRadii : Record {
  @Field var topLeft: Double = 0.0
  @Field var topRight: Double = 0.0
  @Field var bottomRight: Double = 0.0
  @Field var bottomLeft: Double = 0.0
}
