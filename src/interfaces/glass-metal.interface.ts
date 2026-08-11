interface IGlassRefractionCurve {
  power?: number;
  bias?: number;
}
interface IGlassRefraction {
  amount?: number;
  width?: number;
  height?: number;
  depth?: number;
  /**
   * How far the edge refraction leans toward `highlight.angle`'s light axis, unitless like
   * `depth`. Default 0.25; 0 disables the lean; negative flips it. Clamped to [-1, 1].
   * Android only — iOS ignores it.
   *
   * Real iOS 26 glass twists its edge refraction toward the highlight angle (the "swirl"), and a
   * larger `amount` visibly twists further. This is that twist.
   */
  swirl?: number;
  curve?: IGlassRefractionCurve;
}

interface IGlassDispersion {
  amount?: number;
  reach?: number;
}
interface IGlassHighlight {
  intensity?: number;
  angle?: number;
  /**
   * Depth of the glass border light, in dp. Default 1.5. Android only — iOS ignores it.
   *
   * Android draws the highlight as a thin additive two-lobe rim hugging the edge (matching real
   * iOS 26 glass) rather than iOS's Metal-fallback wash, and this is that rim's fade-out depth.
   */
  width?: number;
  /**
   * Angular falloff exponent of the rim's two lobes. Default 1; higher concentrates the light at
   * the lobes and darkens the perpendicular corners sooner. Android only — iOS ignores it.
   */
  falloff?: number;
}
interface IGlassBorder {
  width?: number;
  opacity?: number;
}
/**
 * How much of the shader to run. Android only — iOS ignores it.
 *
 * The chromatic-dispersion loop must have a compile-time-constant bound to unroll, so each tier is
 * a separately compiled shader rather than a uniform.
 *
 * - `high` — 16 dispersion taps, one per device pixel. Finer than iOS.
 * - `medium` — 8 taps, one per point. What iOS resolves to at the built-in defaults, so this is the
 *   parity setting and the default.
 * - `low` — no dispersion, no film grain. Roughly a fifth of `high`'s cost. Use it for glass that
 *   covers a large fraction of the screen.
 */
type TGlassAndroidQuality = "low" | "medium" | "high";

/**
 * A ceiling on Android's rendering ladder. Android only — iOS ignores it.
 *
 * The values are the same strings `onRendererChange` reports, so what you ask for is directly
 * comparable with what you get. It can only ever *lower* the tier: `"agsl"` on an API-31 device
 * still resolves to `"fallback-blur"`, because the device's own ceiling always applies first.
 *
 * - `agsl` — no cap. The default.
 * - `fallback-blur` — blur, saturation, frost and tint, clipped to the outline. No refraction.
 * - `scrim` — the live backdrop drawn straight through under a translucent scrim. No blur.
 * - `none` — no backdrop at all; frost, tint and border only.
 *
 * Two uses: capping the cost of glass that covers a large fraction of the screen, and exercising
 * the fallbacks on a device that would otherwise never take them.
 *
 * Note that `"none"` is the *native* floor, which is not quite the sub-API-29 experience — there,
 * JS never mounts the native view at all and you get a bare `<View>`.
 */
type TGlassAndroidTier = "agsl" | "fallback-blur" | "scrim" | "none";

interface IGlassAndroidOptions {
  quality?: TGlassAndroidQuality;
  maxTier?: TGlassAndroidTier;
}

interface IGlassMetalOptions {
  blurRadius?: number;
  captureQuality?: number;
  opacity?: number;
  frost?: number;
  saturation?: number;
  noise?: number;
  light?: number;
  refraction?: IGlassRefraction;
  dispersion?: IGlassDispersion;
  highlight?: IGlassHighlight;
  border?: IGlassBorder;
  /** Android-only escape hatch; ignored everywhere else. */
  android?: IGlassAndroidOptions;
}
export type {
  IGlassMetalOptions,
  IGlassRefraction,
  IGlassRefractionCurve,
  IGlassDispersion,
  IGlassHighlight,
  IGlassBorder,
  IGlassAndroidOptions,
  TGlassAndroidQuality,
  TGlassAndroidTier,
};
