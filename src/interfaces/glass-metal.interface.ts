interface IGlassRefractionCurve {
  power?: number;
  bias?: number;
}
interface IGlassRefraction {
  amount?: number;
  width?: number;
  height?: number;
  depth?: number;
  curve?: IGlassRefractionCurve;
}

interface IGlassDispersion {
  amount?: number;
  reach?: number;
}
interface IGlassHighlight {
  intensity?: number;
  angle?: number;
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
 * - `low` — no dispersion, no film grain, no edge contour. Roughly a fifth of `high`'s cost. Use it
 *   for glass that covers a large fraction of the screen.
 */
type TGlassAndroidQuality = "low" | "medium" | "high";

interface IGlassAndroidOptions {
  quality?: TGlassAndroidQuality;
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
};
