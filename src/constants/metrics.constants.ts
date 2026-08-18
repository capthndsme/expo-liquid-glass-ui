/**
 * Geometry lifted from the AndroidLiquidGlass catalog components (all in dp/pt).
 *
 * These are the reference's own numbers, not approximations of them. Where this kit used to
 * deviate the deviation is called out, because each one was tuned against a bug that has since
 * been fixed.
 */

/** `LiquidToggle`: 64x28 track, 40x24 thumb, 2 of inset — exactly 20 of thumb travel. */
const SWITCH_TRACK_WIDTH = 64;
const SWITCH_TRACK_HEIGHT = 28;
const SWITCH_THUMB_WIDTH = 40;
const SWITCH_THUMB_HEIGHT = 24;
const SWITCH_THUMB_INSET = 2;
const SWITCH_THUMB_TRAVEL =
  SWITCH_TRACK_WIDTH - SWITCH_THUMB_WIDTH - SWITCH_THUMB_INSET * 2;
/** The reference's `pressedScale` — the bare thumb balloons to a lens ball while held. */
const SWITCH_THUMB_PRESSED_SCALE = 1.5;
/**
 * How far the track is shrunk in the copy the thumb reads, `[at rest, fully grabbed]` —
 * `LiquidToggle`'s `lerp(2/3, 0.75)` on X and `lerp(0, 0.75)` on Y.
 *
 * The zero is the interesting end: a resting thumb reads a track squashed to no height at all, so
 * it sees only the screen and reads as a plain frosted lozenge. Grab it and the green body swells
 * out of nothing underneath the glass.
 */
const SWITCH_TRACK_COPY_SCALE_X: readonly [number, number] = [2 / 3, 0.75];
const SWITCH_TRACK_COPY_SCALE_Y: readonly [number, number] = [0, 0.75];
/**
 * Short-throw controls divide velocity by 50 before it reaches the jelly; full-width ones use 10.
 * The toggle is the short-throw case, so its squash is 5x gentler than the slider's.
 */
const SWITCH_VELOCITY_DIVISOR = 50;

/** `LiquidSlider`: a 6dp track under the same 40x24 thumb. */
const SLIDER_TRACK_HEIGHT = 6;
const SLIDER_THUMB_WIDTH = 40;
const SLIDER_THUMB_HEIGHT = 24;
const SLIDER_THUMB_PRESSED_SCALE = 1.5;
const SLIDER_VELOCITY_DIVISOR = 10;

/** `LiquidButton`: 48dp tall, 16dp of horizontal padding, 8dp between icon and label. */
const BUTTON_HEIGHT = 48;
const BUTTON_PADDING_HORIZONTAL = 16;
const BUTTON_CONTENT_GAP = 8;
/** Pressed button inflates by 4dp of its height, the reference's `lerp(1, 1 + 4dp/h)`. */
const BUTTON_PRESS_GROWTH = 4;
/** `InteractiveHighlight`'s initial derivative: the button follows 5% of the finger's travel. */
const BUTTON_FOLLOW_DERIVATIVE = 0.05;

/** `LiquidBottomTabs`: a 64dp bar with 4dp of padding on every side. */
const TAB_BAR_HEIGHT = 64;
const TAB_BAR_PADDING = 4;
/**
 * The pill is 56dp tall and exactly one tab cell wide — **zero inset**. This kit previously ran
 * it at 60dp and 4dp wider than a cell, which is why it never sat right against the row.
 */
const TAB_PILL_HEIGHT = 56;
/** The reference's `78f / 56f`: the pill inflates to 78dp tall while grabbed. */
const TAB_PILL_PRESSED_SCALE = 78 / 56;
/**
 * How much *wider* the grabbed pill gets, in dp — the same 22dp its height gains (56 → 78), rather
 * than the same 1.393x ratio.
 *
 * The reference applies `pressedScale` to both axes, which is fine on its own bar and wrong on a
 * wide one: the number is a *height* ratio, so a 4-tab pill 86dp across grows to 120dp and hangs
 * ~17dp past its cell on each side with the finger held still. Blooming by a fixed amount keeps the
 * swell obvious on a narrow pill and proportionate on a wide one, which is what the ratio was
 * standing in for.
 */
const TAB_PILL_BLOOM_WIDTH = 78 - 56;
/** The bar grows exactly 16dp in total width on grab — `lerp(1, 1 + 16dp/width)`, both axes. */
const TAB_BAR_PRESS_GROWTH = 16;
/** The accent copy of the tab under the pill swells to 1.2x while grabbed; neighbours hold still. */
const TAB_ACCENT_PRESSED_SCALE = 1.2;
/**
 * The accent strip is a **56dp** capsule inside the 64dp bar — the reference's
 * `.height(56.dp).fillMaxWidth()` against the visible row's `.height(64.dp)`.
 *
 * This 8dp difference is the whole of the "the bar looks smaller through the pill" effect. The pill
 * samples the bar and this strip stacked, so its lens has *two* capsule rims to bend: the visible
 * bar's, 4dp outside the pill and dragged inward into view by the refraction, and the strip's own,
 * running along the pill's edge. Give the accent layer nothing of its own — just tinted icons, as
 * this kit did — and there is only one rim, the pill shows the bar at its true size, and the depth
 * goes with it.
 *
 * The strip carries the whole material — vibrancy, blur, and a lens that ramps with the grab —
 * because it is the *only* glass the pill reads. The visible bar is deliberately not in the pill's
 * stack; see the `providerId` comment at the pill.
 */
const TAB_ACCENT_STRIP_HEIGHT = 56;
/** The pill is a full-width control as far as the jelly is concerned. */
const TAB_VELOCITY_DIVISOR = 10;
/** Whole-panel rubber band: `4dp * sign(f) * EaseOut(|f|)`, `f` = accumulated drag / bar width. */
const TAB_PANEL_MAX_OFFSET = 4;
/** Icon glyphs render 24dp inside a 28dp slot; label is 12sp with a 2dp gap above it. */
const TAB_ICON_SIZE = 24;
const TAB_ICON_SLOT = 28;
const TAB_LABEL_SIZE = 12;
const TAB_CONTENT_GAP = 2;

const TEXT_INPUT_HEIGHT = 48;

export {
  SWITCH_TRACK_WIDTH,
  SWITCH_TRACK_HEIGHT,
  SWITCH_THUMB_WIDTH,
  SWITCH_THUMB_HEIGHT,
  SWITCH_THUMB_INSET,
  SWITCH_THUMB_TRAVEL,
  SWITCH_THUMB_PRESSED_SCALE,
  SWITCH_TRACK_COPY_SCALE_X,
  SWITCH_TRACK_COPY_SCALE_Y,
  SWITCH_VELOCITY_DIVISOR,
  SLIDER_TRACK_HEIGHT,
  SLIDER_THUMB_WIDTH,
  SLIDER_THUMB_HEIGHT,
  SLIDER_THUMB_PRESSED_SCALE,
  SLIDER_VELOCITY_DIVISOR,
  BUTTON_HEIGHT,
  BUTTON_PADDING_HORIZONTAL,
  BUTTON_CONTENT_GAP,
  BUTTON_PRESS_GROWTH,
  BUTTON_FOLLOW_DERIVATIVE,
  TAB_BAR_HEIGHT,
  TAB_BAR_PADDING,
  TAB_PILL_HEIGHT,
  TAB_PILL_PRESSED_SCALE,
  TAB_PILL_BLOOM_WIDTH,
  TAB_BAR_PRESS_GROWTH,
  TAB_ACCENT_PRESSED_SCALE,
  TAB_ACCENT_STRIP_HEIGHT,
  TAB_VELOCITY_DIVISOR,
  TAB_PANEL_MAX_OFFSET,
  TAB_ICON_SIZE,
  TAB_ICON_SLOT,
  TAB_LABEL_SIZE,
  TAB_CONTENT_GAP,
  TEXT_INPUT_HEIGHT,
};
