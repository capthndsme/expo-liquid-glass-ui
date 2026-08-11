package expo.modules.liquidglass.records

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.types.OptimizedRecord
import expo.modules.liquidglass.enums.GlassQuality
import expo.modules.liquidglass.enums.GlassTierCeiling

/**
 * Mirrors `src/interfaces/glass-metal.interface.ts` and `ios/Records/GlassMetalOptions.swift`.
 *
 * Every field is nullable so that "not supplied" is distinguishable from a supplied value — the
 * per-variant defaults in [expo.modules.liquidglass.enums.MetalDefaults] only apply to fields the
 * caller left out. Keys the caller omits leave the initializer untouched, exactly as on Swift.
 *
 * Every Record in this file is [OptimizedRecord]. Without it `RecordTypeConverter` falls back to
 * **reflection** for each conversion and logs a warning per class — and `metal` is a four-deep
 * nest, so one prop commit converts up to eight Records. The annotation is what makes the
 * expo-module-gradle-plugin's KSP pass emit introspection metadata for the class; the runtime
 * warning names `Introspectable`, which is the capability, not the annotation.
 */
@OptimizedRecord
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

  /** Android-only. iOS drops the key, because its Record has no matching field. */
  @Field var android: GlassAndroidOptions? = null
}

@OptimizedRecord
class GlassAndroidOptions : Record {
  /** Which compiled shader variant to draw with. Defaults to the iOS-parity tier. */
  @Field var quality: GlassQuality? = null

  /**
   * A ceiling on the rendering ladder. Only ever lowers the tier — it cannot raise a device past
   * what its API level supports. Intended for capping the cost of very large glass surfaces, and
   * for exercising the fallbacks on a device that would otherwise never take them.
   */
  @Field var maxTier: GlassTierCeiling? = null
}

@OptimizedRecord
class GlassRefractionOptions : Record {
  @Field var amount: Double? = null
  @Field var width: Double? = null
  @Field var height: Double? = null
  @Field var depth: Double? = null

  /**
   * How far the edge refraction leans toward the highlight's light axis, unitless like [depth].
   * Default 0 (measured: real iOS 26 carries no lean — research/04). Android-only — the iOS Record has
   * no such field, so the key is silently dropped there.
   */
  @Field var swirl: Double? = null

  @Field var curve: GlassRefractionCurve? = null
}

/**
 * `curve` is **all-or-nothing** on iOS: `refraction?.curve?.simd ?? defaults.profile`. Supplying
 * `{ power: 2 }` therefore silently takes this Record's `bias` default rather than the variant's.
 * Reproduced deliberately — see PLAN.md Phase 2.
 */
@OptimizedRecord
class GlassRefractionCurve : Record {
  @Field var power: Double = 1.0
  @Field var bias: Double = 0.0
}

@OptimizedRecord
class GlassDispersionOptions : Record {
  @Field var amount: Double? = null
  @Field var reach: Double? = null
}

@OptimizedRecord
class GlassHighlightOptions : Record {
  @Field var intensity: Double? = null

  /** Degrees, screen-space with y increasing downward. Converted to radians during resolution. */
  @Field var angle: Double? = null

  /**
   * Depth of the glass border light, in dp. Defaults to 0.75. Android-only — the iOS Record has
   * no such field, so the key is silently dropped there, like `android.*`.
   */
  @Field var width: Double? = null

  /**
   * Angular falloff exponent of the two light lobes (Kyant's `falloff`). Default 1. Higher
   * concentrates the light at the lobes; floored at 0.01. Android-only, like `width`.
   */
  @Field var falloff: Double? = null
}

@OptimizedRecord
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
@OptimizedRecord
class GlassCornerRadii : Record {
  @Field var topLeft: Double = 0.0
  @Field var topRight: Double = 0.0
  @Field var bottomRight: Double = 0.0
  @Field var bottomLeft: Double = 0.0
}
