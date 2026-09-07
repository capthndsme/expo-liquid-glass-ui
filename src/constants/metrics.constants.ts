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
/**
 * How far the thumb can be carried past either end of the track, dp, through a saturating tanh
 * — the rubber band iOS 26's slider shows when you keep pulling at the stop. The reference's
 * slider dead-stops; this is the one place the kit borrows a behaviour from the system slider
 * rather than the catalog.
 */
const SLIDER_OVERSHOOT_MAX = 10;
/** The thumbs' resting drop shadow: `Shadow(radius = 4dp, Black a0.05)`. */
const THUMB_SHADOW = "0 1px 4px rgba(0,0,0,0.05)";

/** `LiquidButton`: 48dp tall, 16dp of horizontal padding, 8dp between icon and label. */
const BUTTON_HEIGHT = 48;
const BUTTON_PADDING_HORIZONTAL = 16;
const BUTTON_CONTENT_GAP = 8;
/** Pressed button inflates by 4dp of its height, the reference's `lerp(1, 1 + 4dp/h)`. */
const BUTTON_PRESS_GROWTH = 4;
/** `InteractiveHighlight`'s initial derivative: the button follows 5% of the finger's travel. */
const BUTTON_FOLLOW_DERIVATIVE = 0.05;
/**
 * How much of the shader's press light a button shows at full press, 0..1. The shader's light
 * is Kyant's bar-sized `InteractiveHighlight` — a flat 0.08 wash plus a 0.15 lobe reaching
 * 1.5x the view's short side — and on a 48dp capsule that lobe covers the whole pane, so at 1
 * the press reads as a flat lightening, the Material pressed-state look. A third of it keeps
 * the finger's glint and lets the dent (`lens`) and the inflation carry the press instead.
 */
const BUTTON_PRESS_LIGHT = 0.35;
/**
 * The button's three sizes — height, side padding and label size. `regular` is the reference's
 * `LiquidButton`; `small` is the chip / compact-toolbar size and `large` the sheet-footer size.
 * `height` on the button still overrides.
 */
const BUTTON_SIZES = {
  small: { height: 36, paddingHorizontal: 14, fontSize: 15, iconSize: 18 },
  regular: {
    height: BUTTON_HEIGHT,
    paddingHorizontal: BUTTON_PADDING_HORIZONTAL,
    fontSize: 17,
    iconSize: 22,
  },
  large: { height: 56, paddingHorizontal: 22, fontSize: 17, iconSize: 24 },
} as const;

/**
 * `LiquidGlassGroup`: `spacing` is the smooth-min reach — `UIGlassContainerEffect.spacing`'s
 * meaning, the distance at which two members begin to fuse; the gap is the row's resting gap;
 * the overhang is how far past the row the canvas extends, which bounds how far a pressed member
 * can be carried by its rubber band while still rendering.
 */
const GROUP_SPACING = 28;
const GROUP_GAP = 12;
const GROUP_OVERHANG = 72;

/** `LiquidGlassCard`: a 24dp continuous corner and 16dp of padding by default. */
const CARD_CORNER_RADIUS = 24;
const CARD_PADDING = 16;
/** A tappable card presses to 98% — a whisper, since a card is furniture rather than a control. */
const CARD_PRESSED_SCALE = 0.98;

/**
 * `LiquidGlassStepper`: the segmented control's 40dp track, its 3dp-inset thumb, and the
 * auto-repeat a held end runs at — iOS's stepper repeats while held.
 */
const STEPPER_HEIGHT = 40;
const STEPPER_CELL_WIDTH = 44;
const STEPPER_VALUE_MIN_WIDTH = 44;
const STEPPER_REPEAT_DELAY_MS = 400;
const STEPPER_REPEAT_INTERVAL_MS = 110;
/** The value pops to 1.18 on each change and springs back. */
const STEPPER_VALUE_POP_SCALE = 1.18;

/** `LiquidGlassToast`: a 44dp capsule, 24dp of side padding, 60dp in from the screen edge. */
const TOAST_HEIGHT = 44;
const TOAST_PADDING_HORIZONTAL = 20;
const TOAST_EDGE_OFFSET = 60;
const TOAST_DURATION_MS = 2600;
/** How far off-screen the toast starts, past its own height. */
const TOAST_TRAVEL = 24;

/**
 * `LiquidGlassSheet`: 28dp top corners, a 36x5 grab handle, and the release rule — dismissed
 * past 30% of its height, or flung down faster than 900dp/s. Upward drag past the top is met
 * with 4:1 resistance.
 */
const SHEET_CORNER_RADIUS = 28;
const SHEET_HANDLE_WIDTH = 36;
const SHEET_HANDLE_HEIGHT = 5;
const SHEET_HANDLE_AREA_HEIGHT = 24;
const SHEET_DISMISS_FRACTION = 0.3;
const SHEET_DISMISS_VELOCITY = 900;
const SHEET_OVERDRAG_RESISTANCE = 4;
const SHEET_DIM_OPACITY = 0.25;

/** `LiquidGlassToolbar`: a 48dp row; the title capsule is a regular button's height. */
const TOOLBAR_HEIGHT = 48;

/** `LiquidGlassChip`: the small button, with a 6dp icon gap. */
const CHIP_CONTENT_GAP = 6;

/**
 * `LiquidGlassMorphGroup`: the merge distance is `UIGlassContainerEffect.spacing`'s meaning fed
 * to the smooth-min; the bloom is the grabbed capsule's inflation (the tab pill's 22dp read too
 * heavy on a free-floating capsule); the overhang is how far past the row the canvas extends,
 * bounding how far a capsule can be carried while still rendering.
 */
const MORPH_GROUP_SPACING = 28;
const MORPH_GROUP_GAP = 12;
const MORPH_GROUP_BLOOM = 10;
const MORPH_GROUP_OVERHANG = 72;

/**
 * `LiquidGlassSegmentedControl`: a 40dp track with a 3dp-inset thumb. The stretch is how much of
 * the travel distance the mid-flight thumb elongates by; the smoothing is the neck to the
 * droplet it leaves behind.
 */
const SEGMENTED_HEIGHT = 40;
const SEGMENTED_INSET = 3;
const SEGMENTED_SMOOTHING = 18;
const SEGMENTED_STRETCH = 0.22;

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
/**
 * The grab scales the **whole bar** — glass, both rows, the pill riding in it — so its total
 * width grows by exactly this, `lerp(1, 1 + 16dp/width)` on both axes. Icons included: iOS 26
 * grows the entire bar under the finger and shrinks nothing, the active and inactive glyphs
 * staying the same size as each other throughout (checked against an iPhone 14 Pro Max,
 * 2026-09-07). The kit once scaled only the bar's glass and minified the active copy to the
 * strip's 56/64 under the lifted pill; that read as the icon shrinking while the bar stood
 * still, and is gone.
 */
const TAB_BAR_PRESS_GROWTH = 16;
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
/**
 * The grabbed pill's drop shadow — the reference's default `Shadow(alpha = progress)`: a 24dp
 * blur, offset a sixth of that, black at 10 %. It fades in with the grab, under the glass.
 */
const TAB_PILL_SHADOW = "0 4px 24px rgba(0,0,0,0.10)";
/**
 * How far the *held* pill wash — a `pillDraggedMetal.tint` — overhangs the pill's rect in the
 * accent layer, dp. The grabbed pill's lens pulls the backdrop inward from outside its rim
 * (`GLASS_PILL_DRAGGED_METAL`: 14dp of displacement over a 10dp band), so a wash cut exactly to
 * the pill would show a clear ring where the lens reaches past it; painted this much larger it
 * fills the pill edge to edge, like a tinted button. The overhang is invisible on screen — the
 * accent layer composites at 2% — and only ever reaches the eye through the pill.
 */
const TAB_PILL_WASH_BLEED = 16;
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
  SLIDER_OVERSHOOT_MAX,
  THUMB_SHADOW,
  BUTTON_HEIGHT,
  BUTTON_PADDING_HORIZONTAL,
  BUTTON_CONTENT_GAP,
  BUTTON_PRESS_GROWTH,
  BUTTON_FOLLOW_DERIVATIVE,
  BUTTON_PRESS_LIGHT,
  BUTTON_SIZES,
  GROUP_SPACING,
  GROUP_GAP,
  GROUP_OVERHANG,
  CARD_CORNER_RADIUS,
  CARD_PADDING,
  CARD_PRESSED_SCALE,
  STEPPER_HEIGHT,
  STEPPER_CELL_WIDTH,
  STEPPER_VALUE_MIN_WIDTH,
  STEPPER_REPEAT_DELAY_MS,
  STEPPER_REPEAT_INTERVAL_MS,
  STEPPER_VALUE_POP_SCALE,
  TOAST_HEIGHT,
  TOAST_PADDING_HORIZONTAL,
  TOAST_EDGE_OFFSET,
  TOAST_DURATION_MS,
  TOAST_TRAVEL,
  SHEET_CORNER_RADIUS,
  SHEET_HANDLE_WIDTH,
  SHEET_HANDLE_HEIGHT,
  SHEET_HANDLE_AREA_HEIGHT,
  SHEET_DISMISS_FRACTION,
  SHEET_DISMISS_VELOCITY,
  SHEET_OVERDRAG_RESISTANCE,
  SHEET_DIM_OPACITY,
  TOOLBAR_HEIGHT,
  CHIP_CONTENT_GAP,
  MORPH_GROUP_SPACING,
  MORPH_GROUP_GAP,
  MORPH_GROUP_BLOOM,
  MORPH_GROUP_OVERHANG,
  SEGMENTED_HEIGHT,
  SEGMENTED_INSET,
  SEGMENTED_SMOOTHING,
  SEGMENTED_STRETCH,
  TAB_BAR_HEIGHT,
  TAB_BAR_PADDING,
  TAB_PILL_HEIGHT,
  TAB_PILL_PRESSED_SCALE,
  TAB_PILL_BLOOM_WIDTH,
  TAB_BAR_PRESS_GROWTH,
  TAB_ACCENT_STRIP_HEIGHT,
  TAB_VELOCITY_DIVISOR,
  TAB_PILL_SHADOW,
  TAB_PILL_WASH_BLEED,
  TAB_PANEL_MAX_OFFSET,
  TAB_ICON_SIZE,
  TAB_ICON_SLOT,
  TAB_LABEL_SIZE,
  TAB_CONTENT_GAP,
  TEXT_INPUT_HEIGHT,
};
