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
  @Field var shape: GlassShapeOptions? = null
  @Field var morph: GlassMorphOptions? = null

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

  /**
   * How much of the fringe follows Kyant's quadrant weighting, `0..1`. Default 0 — an even rim
   * fringe the whole way round, which is what iOS does.
   *
   * At 1 the spread is scaled by `(cx * cy) / (hx * hy)`: nothing along either centre line, full
   * strength at the corners, and the sign — hence the hue order — flipping between neighbours. On
   * a capsule that puts all the colour at the two ends and none along the flanks. Android-only.
   */
  @Field var quadrant: Double? = null
}

/**
 * A press that happened somewhere else.
 *
 * [expo.modules.liquidglass.LiquidGlassView.isInteractive] handles a press on *this* view, driving
 * the same shader uniforms off its own touch stream. This record is for the other case: a control
 * choreographed by the app, whose press this glass should respond to. Kyant's `InteractiveHighlight`
 * is exactly that — it lives on the tab bar, but the finger is on the pill.
 *
 * Unlike `interactive` this never touches the view's transform, so it composes with an app-owned
 * `transform` style (a Reanimated one included) instead of fighting it.
 */
@OptimizedRecord
class GlassGlowOptions : Record {
  /** 0 = at rest and the shader's branch is off; 1 = fully lit. */
  @Field var progress: Double = 0.0

  /** Hotspot, view-local dp. Both default to the view's centre. */
  @Field var x: Double? = null
  @Field var y: Double? = null

  /**
   * Whether the press also bends the glass — the backdrop dent under the hotspot and the 1.35x
   * lens boost that `interactive` applies.
   *
   * Default false, which is Kyant's behaviour and the reason this defaults the way it does: a bar
   * hosting a grabbed pill should light up, not start refracting harder. Set it when the press
   * really is on this glass and you are only driving it by hand.
   */
  @Field var lens: Boolean = false
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
 * The primary shape as a sub-rect of the view — view-local dp, top-left origin. Absent (or
 * degenerate), the shape fills the view: the historical behaviour, bit for bit.
 *
 * This is what makes a *canvas* view possible: a view larger than its glass, inside which a
 * [GlassMorphOptions] partner has room to approach, neck and separate — both platforms clip
 * their draw at the view's bounds, so the extra room must come from the view itself. Shader
 * tiers only; the corner radii resolve against this rect, while the drawn border and the
 * content clipping still track the view (a canvas hosts its own chrome).
 */
@OptimizedRecord
class GlassShapeOptions : Record {
  @Field var x: Double? = null
  @Field var y: Double? = null
  @Field var width: Double? = null
  @Field var height: Double? = null
}

/**
 * The morph partner: a second rounded rect folded into this view's shape with a polynomial
 * smooth-min, so the two read as one connected pane of liquid — refraction, dispersion and the
 * border light all follow the merged silhouette. Shader tiers only (`agsl` here, the Metal
 * renderer on iOS); the BLUR/SCRIM tiers and iOS 26's native glass ignore it.
 *
 * View-local dp, top-left origin, RN layout style. All-or-nothing: [width], [height] and a
 * positive [smoothing] make it live; anything less and the shape is bit-identical to before.
 * Keep the partner inside the view's bounds — iOS clips the drawable at them — and pair it
 * with [GlassShapeOptions] when it needs room outside the primary shape.
 */
@OptimizedRecord
class GlassMorphOptions : Record {
  @Field var x: Double? = null
  @Field var y: Double? = null
  @Field var width: Double? = null
  @Field var height: Double? = null

  /** One radius for all four partner corners, clamped to half the partner's short side. */
  @Field var cornerRadius: Double? = null

  /** The distance at which the two shapes begin to merge, dp. 0 disables. */
  @Field var smoothing: Double? = null
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
