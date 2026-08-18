import type { GlassMetalOptions } from "expo-liquid-glass-view";

/**
 * The reference's glass recipes, one per surface, in the base view's `metal` vocabulary.
 *
 * Translation table between the two APIs:
 *
 * | Kyant `backdrop`                  | `expo-liquid-glass-view`                     |
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
  refraction: { amount: 24, width: 24, height: 24, depth: 0, swirl: 0, curve: CURVE },
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
  refraction: { amount: 24, width: 12, height: 12, depth: 0, swirl: 0, curve: CURVE },
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
  refraction: { amount: 24, width: 24, height: 24, depth: 0, swirl: 0, curve: CURVE },
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
  refraction: { amount: 0, width: 0, height: 0, depth: 0, swirl: 0, curve: CURVE },
  dispersion: { amount: 0, reach: 10, quadrant: 1 },
  blurRadius: 0,
  frost: 0,
  saturation: 1,
  noise: 0,
  light: 0,
  opacity: 1,
  highlight: { intensity: 0, angle: 45, width: 0.5, falloff: 1 },
  border: { width: 1, opacity: 0 },
  android: { quality: "high" },
};

/**
 * The tab pill fully grabbed: `lens(10dp, 14dp, chromaticAberration = true)` and nothing else.
 * No blur and no saturation boost — those belong to the bar, and withholding them here keeps the
 * pill sharper than its surroundings even while it refracts.
 *
 * The reference's aberration is not a separate effect with its own size: the split is the
 * *refraction displacement itself*, quadrant-weighted. So `dispersion.reach` matches
 * `refraction.height` and the amount is scaled off `refraction.amount` — the fringe then lives on
 * exactly the band the lens bends, which is why it reads as one material rather than as a lens
 * with a coloured outline stuck on.
 *
 * `quality: "high"` earns its cost here and nowhere else: 16 taps one pixel apart keep a 12dp
 * spread continuous, where `"medium"`'s 8 would step it. The pill is small, and it is the only
 * surface in the kit whose fringe is ever this wide.
 */
const GLASS_PILL_DRAGGED_METAL: GlassMetalOptions = {
  refraction: { amount: 14, width: 10, height: 10, depth: 0, swirl: 0, curve: CURVE },
  dispersion: { amount: 12, reach: 10, quadrant: 1 },
  blurRadius: 0,
  frost: 0,
  saturation: 1,
  noise: 0,
  light: 0,
  opacity: 1,
  highlight: { intensity: 0.5, angle: 45, width: 0.5, falloff: 1 },
  border: { width: 1, opacity: 0.28 },
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
  // The bar's own lens, at rest as well as under the grab — a deliberate departure from the
  // reference's `lens(24 * progress, ...)`, and the one place measurement beat the source.
  //
  // The strip is what a resting pill shows. Give it no lens and the pill displays the *local*
  // backdrop while the bar beside it displays a 24dp-refracted one, and on any backdrop with a
  // strong gradient behind the bar the two disagree violently: the pill reads as a hole punched
  // through the bar's shade. Measured against the catalog on its own hardware, its resting pill
  // sits +19 to +22 *brighter* than its bar; ours sat 87 darker. Matching the lens is what closes
  // that, and it costs nothing — the pill's own `lens(10, 14)` still supplies the whole grab.
  refraction: { amount: 24, width: 24, height: 24, depth: 0, swirl: 0, curve: CURVE },
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
  refraction: { amount: 24, width: 24, height: 24, depth: 0, swirl: 0, curve: CURVE },
  highlight: { intensity: 0.3, angle: 45, width: 0.5, falloff: 1 },
  border: { width: 1, opacity: 0.28 },
};

/** The toggle thumb at rest: an 8dp frost under an opaque white fill — `blur(8dp * (1 - p))`. */
const GLASS_THUMB_METAL: GlassMetalOptions = {
  refraction: { amount: 0, width: 5, height: 5, depth: 0, swirl: 0, curve: CURVE },
  dispersion: { amount: 0, reach: 5 },
  blurRadius: 8,
  frost: 0,
  saturation: 1,
  noise: 0,
  light: 0,
  opacity: 1,
  highlight: { intensity: 0, angle: 45, width: 0.33, falloff: 1 },
  border: { width: 1, opacity: 0 },
  android: { quality: "medium" },
};

/**
 * The toggle thumb held: `lens(5dp, 10dp, chromaticAberration = true)` with **zero** blur.
 *
 * That inversion — the moving element being the *least*-processed surface — is a deliberate,
 * repeated rule in the reference. The pill does it, the slider thumb does it, this does it.
 */
const GLASS_THUMB_PRESSED_METAL: GlassMetalOptions = {
  refraction: { amount: 10, width: 5, height: 5, depth: 0, swirl: 0, curve: CURVE },
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
  android: { quality: "medium" },
};

/** The slider thumb at rest — identical frost, deeper lens waiting behind it. */
const GLASS_SLIDER_THUMB_METAL: GlassMetalOptions = {
  ...GLASS_THUMB_METAL,
  refraction: { amount: 0, width: 10, height: 10, depth: 0, swirl: 0, curve: CURVE },
  dispersion: { amount: 0, reach: 10 },
};

/**
 * The slider thumb held: `lens(10dp, 14dp)` — it bends harder than the toggle's 5/10 because it
 * has a whole track's worth of colour to pull through.
 */
const GLASS_SLIDER_THUMB_PRESSED_METAL: GlassMetalOptions = {
  ...GLASS_THUMB_PRESSED_METAL,
  refraction: { amount: 14, width: 10, height: 10, depth: 0, swirl: 0, curve: CURVE },
  dispersion: { amount: 5, reach: 10 },
};

export {
  GLASS_ACCENT_STRIP_METAL,
  GLASS_BAR_CLEAR_METAL,
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
