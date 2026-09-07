import { Platform } from "react-native";

import type { GlassMetalOptions } from "../core";

/**
 * The reference's glass recipes, one per surface, in the base view's `metal` vocabulary.
 *
 * Translation table between the two APIs:
 *
 * | Kyant `backdrop`                  | `expo-liquid-glass-ui`                       |
 * |-----------------------------------|----------------------------------------------|
 * | `vibrancy()`                      | `saturation: 1.5` (it *is* `saturation=1.5`)  |
 * | `blur(Ndp)`                       | `blurRadius: N`                               |
 * | `lens(height, amount)`            | `refraction: { width: h, height: h, amount }` |
 * | `chromaticAberration = true`      | `dispersion: { amount, reach, quadrant: 1 }`  |
 * | `Highlight.Default`               | `highlight: { intensity, angle, width, falloff }` |
 *
 * Three constraints have no counterpart in the reference and bite if ignored:
 *
 * - **Effect order is fixed** in the shader as colour filter → blur → lens, which happens to be
 *   the order the reference declares them in anyway.
 * - **Dispersion is a magnitude here, not a boolean.** Below ~2dp of spread the shader skips it
 *   entirely; above the tap budget it bands. `quality: "medium"` spaces its 8 taps one *point*
 *   apart (clean to ~8dp) while `"high"` spaces its 16 one *pixel* apart, so a wide fringe wants
 *   the expensive tier and a narrow one does not care.
 * - **`quadrant` is what makes it read as the reference's aberration rather than a rim fringe.**
 *   Kyant scales the split by `(cx·cy)/(hx·hy)`: nothing along either centre line, everything at
 *   the corners, and the sign flipping between neighbours so the hue order reverses with it. On a
 *   capsule that puts all the colour at the two rounded ends and leaves the long flanks clean —
 *   which is exactly the "edge dispersion" the bar is recognised for. At `quadrant: 0` (the
 *   default, and iOS's behaviour) the same amount rings the whole rim evenly and reads as a
 *   chromatic *defect* instead.
 *
 * `dispersion.reach` is always set explicitly: left unset it falls back to the *variant's* default
 * refraction height (20), not to the height in the same object.
 */

const CURVE = { power: 1, bias: 0 } as const;

/**
 * The bottom bar: `vibrancy() -> blur(8dp) -> lens(24dp, 24dp)`, permanently on.
 *
 * `refractionAmount == refractionHeight` is deliberate — where they are equal the band samples the
 * same source range twice, mirrored, which is the inverted sliver seen at a thick glass rim. This
 * ratio is the single biggest driver of the look.
 *
 * Keeping this material *on* is also what makes a resting pill read as "extra clear": the clarity
 * is relative. Flatten the bar and the pill has nothing to contrast against.
 */
const GLASS_BAR_METAL: GlassMetalOptions = {
  refraction: {
    amount: 24,
    width: 24,
    height: 24,
    depth: 0,
    swirl: 0,
    curve: CURVE,
  },
  dispersion: { amount: 0, reach: 24 },
  blurRadius: 8,
  frost: 0,
  saturation: 1.5,
  noise: 0,
  light: 0,
  opacity: 1,
  highlight: { intensity: 0.3, angle: 45, width: 0.5, falloff: 1 },
  border: { width: 1, opacity: 0.28 },
  android: { quality: "medium" },
};

/** `LiquidButton`: `vibrancy() -> blur(2dp) -> lens(12dp, 24dp)`. Static — nothing here animates. */
const GLASS_BUTTON_METAL: GlassMetalOptions = {
  refraction: {
    amount: 24,
    width: 12,
    height: 12,
    depth: 0,
    swirl: 0,
    curve: CURVE,
  },
  dispersion: { amount: 0, reach: 12 },
  blurRadius: 2,
  frost: 0,
  saturation: 1.5,
  noise: 0,
  light: 0,
  opacity: 1,
  highlight: { intensity: 0.3, angle: 45, width: 0.5, falloff: 1 },
  border: { width: 1, opacity: 0.28 },
  android: { quality: "medium" },
};

/**
 * The bar in **clear** dress: the scrim mostly gone, the glass doing the work.
 *
 * The regular bar reads through a 42% container fill, which is what guarantees a label stays
 * legible over anything. Take that away and legibility has to come from the material itself, so
 * this leans the other way from `GLASS_BAR_METAL` on every axis the base library's own
 * `CLEAR_DEFAULTS` does: a whisper of frost instead of none, saturation pulled back toward life,
 * dispersion raised so the rim actually reads, and a brighter border and highlight because with no
 * fill behind it the edge is the only thing left saying "this is a surface".
 *
 * The blur stays low on purpose. Blurring hard is how you fake a scrim; a clear bar that blurs its
 * backdrop into mush is just a scrim with extra steps.
 */
const GLASS_BAR_CLEAR_METAL: GlassMetalOptions = {
  // The lens is unchanged from the regular bar, including the 1:1 amount-to-depth ratio that
  // drives its look. Borrowing `CLEAR_DEFAULTS`' 30-over-10 was a mistake: that ratio is tuned for
  // a small control, and on a 64dp bar a 30dp pull over a 10dp band drags the dark gap above the
  // bar into a hard stripe across its top edge. Clear means less scrim, not a different lens.
  refraction: {
    amount: 24,
    width: 24,
    height: 24,
    depth: 0,
    swirl: 0,
    curve: CURVE,
  },
  dispersion: { amount: 10, reach: 24, quadrant: 0 },
  blurRadius: 3,
  frost: 0.06,
  saturation: 1.15,
  noise: 0,
  light: 0,
  opacity: 1,
  highlight: { intensity: 0.35, angle: 45, width: 0.75, falloff: 1 },
  border: { width: 1, opacity: 0.4 },
  android: { quality: "medium" },
};

/**
 * The tab pill at rest: every effect off. The reference's `lens()` early-returns when both
 * arguments are zero, so no render effect is attached at all and the pill becomes a literal
 * clipped window onto its backdrop.
 *
 * This is the `from` end of a blend, not a state to be swapped to — see {@link lerpMetal} and the
 * tab bar's `pillProps`. Every field it names is a field the grab animates, and it names them at
 * their resting value rather than omitting them, so the blend has both ends of every channel.
 */
const GLASS_PILL_METAL: GlassMetalOptions = {
  refraction: {
    amount: 0,
    width: 0,
    height: 0,
    depth: 0,
    swirl: 0,
    curve: CURVE,
  },
  dispersion: { amount: 0, reach: 10, quadrant: 0 },
  // No refraction at rest, ever — but the resting pill may blur. On Android the strip it reads
  // through is already `vibrancy + blur(8dp)`, so the pill adds nothing; on iOS the window
  // capture excludes every glass view, so the pill would otherwise be a sharp, unwashed hole in
  // a blurred bar. There it carries the bar's own material and melts it away as the grab lands.
  blurRadius: Platform.OS === "ios" ? 8 : 0,
  frost: 0,
  saturation: Platform.OS === "ios" ? 1.5 : 1,
  noise: 0,
  light: 0,
  opacity: 1,
  highlight: { intensity: 0, angle: 45, width: 0.5, falloff: 1 },
  border: { width: 1, opacity: 0 },
  innerShadow: { radius: 0, opacity: 0 },
  android: { quality: "high" },
};

/**
 * The tab pill fully grabbed: a lens across its whole face, with the colour split riding it.
 * No blur and no saturation boost — those belong to the bar, and withholding them here keeps the
 * pill sharper than its surroundings even while it refracts.
 *
 * The reference's `lens(10dp, 14dp, chromaticAberration = true)` is a rim band: 14dp of bend
 * over the outer 10dp, the fringe quadrant-weighted onto the capsule's ends. iOS 26's grabbed
 * pill is not that — held beside it on an iPhone 14 Pro Max (2026-09-07), the glyph at the
 * pill's *centre* is displaced and colour-split, and the fringe runs evenly all the way round.
 * So the band here reaches 40dp in from every edge, past the held pill's 39dp half-height, and
 * the split runs 12dp over a 42dp reach — about 4dp left at the centre — with `quadrant` 0
 * (Kyant's weighting dies along both centre lines, which is exactly where iOS shows it most).
 * The split walks the lens's own displacement, so the two must widen together — the shader
 * disperses nothing outside the band. Two things keep a band that wide from wrecking the face:
 * a cubic profile (`curve.power: 3`), so the bend is the reference's at the rim and gone by
 * the centre — with the linear profile the nearest-edge direction flipping across the centre
 * line tore the glyph in two and swirled the ends — and `depth: 1`, the radial direction, so
 * what bend remains reads as one lens ball. `pillDraggedMetal` is the dial if an app wants the
 * reference's quieter rim instead.
 *
 * `quality: "high"` earns its cost here and nowhere else: 16 taps one pixel apart keep a 12dp
 * spread continuous, where `"medium"`'s 8 would step it. The pill is small, and it is the only
 * surface in the kit whose fringe is ever this wide.
 */
const GLASS_PILL_DRAGGED_METAL: GlassMetalOptions = {
  refraction: {
    amount: 14,
    width: 40,
    height: 40,
    depth: 1,
    swirl: 0,
    curve: { power: 3, bias: 0 },
  },
  dispersion: { amount: 12, reach: 42, quadrant: 0 },
  blurRadius: 0,
  frost: 0,
  saturation: 1,
  noise: 0,
  light: 0,
  opacity: 1,
  highlight: { intensity: 0.5, angle: 45, width: 0.5, falloff: 1 },
  border: { width: 1, opacity: 0.28 },
  // The reference's `InnerShadow(radius = 8dp * progress, alpha = progress)`: the lifted pill
  // gains thickness as it lifts. Both fields ramp from the resting recipe's zeros.
  innerShadow: { radius: 8, opacity: 0.15 },
  android: { quality: "high" },
};

/**
 * The accent strip — the screen-invisible second bar, and the **only** glass the pill reads.
 *
 * The reference's pill samples `combined(screenBackdrop, tabsBackdrop)`: the screen, and this
 * layer. Not the visible bar. That matters for more than tidiness — the visible bar carries its own
 * container fill, so putting it in the pill's stack scrims everything the pill shows a second time,
 * and the pill goes darker and flatter than the bar beside it.
 *
 * Being the only glass in that stack is also why this layer has to carry the whole material:
 * `vibrancy() -> blur(8dp) -> lens(24dp * progress, 24dp * progress)` plus the container fill. Drop
 * the blur here and the pill looks through raw, unfrosted screen.
 */
const GLASS_ACCENT_STRIP_METAL: GlassMetalOptions = {
  // The reference's `lens(24dp * progress, 24dp * progress)`: NO lens at rest, the bar's full
  // lens under the grab. The strip is what a resting pill shows, so this is what decides whether
  // the resting pill refracts — and it must not: the pill at rest is a frosted window, not a
  // lens (the bar's 24dp band was bending the backdrop's edges inside the pill while the pill's
  // own recipe was innocent). A previous round kept the lens on at rest to match the pill's
  // brightness to the bar's; that mismatch turned out to be the three-layer stack's, since fixed,
  // and the user's call on 2026-09-07 is the reference's: blur, no refraction, until grabbed.
  refraction: {
    amount: 0,
    width: 24,
    height: 24,
    depth: 0,
    swirl: 0,
    curve: CURVE,
  },
  dispersion: { amount: 0, reach: 24 },
  blurRadius: 8,
  frost: 0,
  saturation: 1.5,
  noise: 0,
  light: 0,
  opacity: 1,
  highlight: { intensity: 0, angle: 45, width: 0.5, falloff: 1 },
  border: { width: 1, opacity: 0 },
  android: { quality: "medium" },
};

/** The accent strip at full grab: the bar's own `lens(24dp, 24dp)`, dialled all the way in. */
const GLASS_ACCENT_STRIP_PRESSED_METAL: GlassMetalOptions = {
  ...GLASS_ACCENT_STRIP_METAL,
  refraction: {
    amount: 24,
    width: 24,
    height: 24,
    depth: 0,
    swirl: 0,
    curve: CURVE,
  },
  highlight: { intensity: 0.3, angle: 45, width: 0.5, falloff: 1 },
  border: { width: 1, opacity: 0.28 },
};

/** The toggle thumb at rest: an 8dp frost under an opaque white fill — `blur(8dp * (1 - p))`. */
const GLASS_THUMB_METAL: GlassMetalOptions = {
  refraction: {
    amount: 0,
    width: 5,
    height: 5,
    depth: 0,
    swirl: 0,
    curve: CURVE,
  },
  dispersion: { amount: 0, reach: 5 },
  blurRadius: 8,
  frost: 0,
  saturation: 1,
  noise: 0,
  light: 0,
  opacity: 1,
  highlight: { intensity: 0, angle: 45, width: 0.33, falloff: 1 },
  border: { width: 1, opacity: 0 },
  innerShadow: { radius: 0, opacity: 0 },
  android: { quality: "medium" },
};

/**
 * The toggle thumb held: `lens(5dp, 10dp, chromaticAberration = true)` with **zero** blur.
 *
 * That inversion — the moving element being the *least*-processed surface — is a deliberate,
 * repeated rule in the reference. The pill does it, the slider thumb does it, this does it.
 */
const GLASS_THUMB_PRESSED_METAL: GlassMetalOptions = {
  refraction: {
    amount: 10,
    width: 5,
    height: 5,
    depth: 0,
    swirl: 0,
    curve: CURVE,
  },
  dispersion: { amount: 4, reach: 5 },
  blurRadius: 0,
  frost: 0,
  saturation: 1,
  noise: 0,
  light: 0,
  opacity: 1,
  // `Highlight.Ambient` scaled to 1/1.5 for the small thumb.
  highlight: { intensity: 0.38, angle: 45, width: 0.33, falloff: 1 },
  border: { width: 1, opacity: 0.28 },
  // `InnerShadow(radius = 4dp * progress, alpha = progress)` — the thumbs' thinner lip.
  innerShadow: { radius: 4, opacity: 0.15 },
  android: { quality: "medium" },
};

/** The slider thumb at rest — identical frost, deeper lens waiting behind it. */
const GLASS_SLIDER_THUMB_METAL: GlassMetalOptions = {
  ...GLASS_THUMB_METAL,
  refraction: {
    amount: 0,
    width: 10,
    height: 10,
    depth: 0,
    swirl: 0,
    curve: CURVE,
  },
  dispersion: { amount: 0, reach: 10 },
};

/**
 * The slider thumb held: `lens(10dp, 14dp)` — it bends harder than the toggle's 5/10 because it
 * has a whole track's worth of colour to pull through.
 */
const GLASS_SLIDER_THUMB_PRESSED_METAL: GlassMetalOptions = {
  ...GLASS_THUMB_PRESSED_METAL,
  refraction: {
    amount: 14,
    width: 10,
    height: 10,
    depth: 0,
    swirl: 0,
    curve: CURVE,
  },
  dispersion: { amount: 5, reach: 10 },
};

/**
 * A panel — `LiquidGlassCard`, `LiquidGlassSheet`: the bar's material, permanently on. A big
 * pane wants the bar's 24dp band rather than the button's 12dp — the rim reads at the scale of
 * the surface, and iOS 26's sheets carry a thick lip for the same reason.
 */
const GLASS_PANEL_METAL: GlassMetalOptions = GLASS_BAR_METAL;

/** A toast is a button-sized capsule and wears the button's glass. */
const GLASS_TOAST_METAL: GlassMetalOptions = GLASS_BUTTON_METAL;

export {
  GLASS_ACCENT_STRIP_METAL,
  GLASS_BAR_CLEAR_METAL,
  GLASS_PANEL_METAL,
  GLASS_TOAST_METAL,
  GLASS_ACCENT_STRIP_PRESSED_METAL,
  GLASS_BAR_METAL,
  GLASS_BUTTON_METAL,
  GLASS_PILL_METAL,
  GLASS_PILL_DRAGGED_METAL,
  GLASS_THUMB_METAL,
  GLASS_THUMB_PRESSED_METAL,
  GLASS_SLIDER_THUMB_METAL,
  GLASS_SLIDER_THUMB_PRESSED_METAL,
};
