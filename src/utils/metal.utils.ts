import type { GlassMetalOptions } from "expo-liquid-glass-view";

/**
 * Blending between two glass recipes, on the UI thread.
 *
 * The reference animates its material directly — `lens(24dp * progress, 24dp * progress)`,
 * `Highlight.Default.copy(alpha = progress)` — recomposing the effect chain on every frame of a
 * press. Nothing in a React prop can follow that: a `useState` swap is one JS render behind the
 * gesture, and it lands at whatever moment the JS thread gets to it.
 *
 * {@link lerpMetal} is a worklet, so `useAnimatedProps` can rebuild the recipe from a shared value
 * each frame and hand it to the native view without JS ever waking up. The native side re-uploads
 * uniforms and redraws; it does not rebuild geometry, re-record the backdrop or resize the padded
 * render node, so this is genuinely cheap to run at display rate.
 */

/**
 * One field.
 *
 * Absent on both sides means "never mentioned" — it stays absent so the native default applies,
 * rather than being invented as 0 (which would be a real value for `saturation` and `opacity`, and
 * the wrong one). Absent on one side means "constant across the blend", which is what lets a recipe
 * name only the fields it actually animates.
 */
const blend = (
  from: number | undefined,
  to: number | undefined,
  t: number,
): number | undefined => {
  "worklet";
  if (from == null && to == null) return undefined;
  const a = from ?? (to as number);
  const b = to ?? (from as number);
  return a + (b - a) * t;
};

/**
 * `from` at `t = 0`, `to` at `t = 1`, linear in between. Every numeric field is blended; the
 * non-numeric ones (`android.quality`, `android.maxTier`) are taken from `to`, because a quality
 * tier has no midpoint and swapping it mid-gesture would recompile the shader.
 *
 * `t` is not clamped — an overshooting spring is allowed to overshoot the material with it, which
 * is the whole point of driving this from a spring rather than a timing curve.
 */
const lerpMetal = (
  from: GlassMetalOptions,
  to: GlassMetalOptions,
  t: number,
): GlassMetalOptions => {
  "worklet";
  return {
    blurRadius: blend(from.blurRadius, to.blurRadius, t),
    opacity: blend(from.opacity, to.opacity, t),
    frost: blend(from.frost, to.frost, t),
    saturation: blend(from.saturation, to.saturation, t),
    noise: blend(from.noise, to.noise, t),
    light: blend(from.light, to.light, t),
    refraction: {
      amount: blend(from.refraction?.amount, to.refraction?.amount, t),
      width: blend(from.refraction?.width, to.refraction?.width, t),
      height: blend(from.refraction?.height, to.refraction?.height, t),
      depth: blend(from.refraction?.depth, to.refraction?.depth, t),
      swirl: blend(from.refraction?.swirl, to.refraction?.swirl, t),
      // `curve` is all-or-nothing on the native side: supplying the object at all replaces the
      // variant's whole profile with the Record's defaults for anything left out. So a blend
      // between two recipes that never mentioned a curve must not invent one.
      curve:
        from.refraction?.curve == null && to.refraction?.curve == null
          ? undefined
          : {
              power: blend(
                from.refraction?.curve?.power,
                to.refraction?.curve?.power,
                t,
              ),
              bias: blend(
                from.refraction?.curve?.bias,
                to.refraction?.curve?.bias,
                t,
              ),
            },
    },
    dispersion: {
      amount: blend(from.dispersion?.amount, to.dispersion?.amount, t),
      reach: blend(from.dispersion?.reach, to.dispersion?.reach, t),
      quadrant: blend(from.dispersion?.quadrant, to.dispersion?.quadrant, t),
    },
    highlight: {
      intensity: blend(from.highlight?.intensity, to.highlight?.intensity, t),
      angle: blend(from.highlight?.angle, to.highlight?.angle, t),
      width: blend(from.highlight?.width, to.highlight?.width, t),
      falloff: blend(from.highlight?.falloff, to.highlight?.falloff, t),
    },
    border: {
      width: blend(from.border?.width, to.border?.width, t),
      opacity: blend(from.border?.opacity, to.border?.opacity, t),
    },
    android: to.android,
  };
};

export { lerpMetal };
