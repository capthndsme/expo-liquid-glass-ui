const GLASS_VARIANTS = ["regular", "clear"] as const;
const GLASS_RENDERERS = ["auto", "native", "metal"] as const;

/**
 * What `onRendererChange` can report.
 *
 * - `native` — Apple's `UIGlassEffect`. iOS 26+ only; Android has no equivalent.
 * - `metal` — the custom Metal renderer on iOS.
 * - `agsl` — the custom AGSL renderer on Android. API 33+.
 * - `fallback-blur` — blur without refraction (`UIBlurEffect` on iOS, `RenderEffect` on Android 31–32).
 * - `scrim` — Android 29–30: a live backdrop with a translucent scrim, no blur and no shader.
 * - `none` — no hardware path; the component renders as a plain view.
 */
const GLASS_ACTIVE_RENDERERS = [
  "native",
  "metal",
  "agsl",
  "fallback-blur",
  "scrim",
  "none",
] as const;
const GLASS_CORNER_STYLES = ["continuous", "circular"] as const;

const DEFAULT_GLASS_VARIANT = "regular";
const DEFAULT_GLASS_RENDERER = "auto";
const DEFAULT_GLASS_CORNER_STYLE = "continuous";

const DEFAULT_HIGHLIGHT_ANGLE = 180;
const DEFAULT_BORDER_WIDTH = 1;
const DEFAULT_GLASS_OPACITY = 1;

const MIN_IOS_VERSION_FOR_NATIVE_GLASS = 26;

/** `RenderNode` — the floor for a live backdrop, and so for any glass at all on Android. */
const MIN_ANDROID_SDK_FOR_NATIVE_GLASS = 29;

/**
 * Pairs a `LiquidGlassView` with the `LiquidGlassProvider` that supplies its backdrop.
 * Android-only; ignored on iOS, which captures what lies beneath each glass in the window.
 */
const DEFAULT_PROVIDER_ID = "default";

export {
  GLASS_VARIANTS,
  GLASS_RENDERERS,
  GLASS_ACTIVE_RENDERERS,
  GLASS_CORNER_STYLES,
  DEFAULT_GLASS_VARIANT,
  DEFAULT_GLASS_RENDERER,
  DEFAULT_GLASS_CORNER_STYLE,
  DEFAULT_HIGHLIGHT_ANGLE,
  DEFAULT_BORDER_WIDTH,
  DEFAULT_GLASS_OPACITY,
  MIN_IOS_VERSION_FOR_NATIVE_GLASS,
  MIN_ANDROID_SDK_FOR_NATIVE_GLASS,
  DEFAULT_PROVIDER_ID,
};
