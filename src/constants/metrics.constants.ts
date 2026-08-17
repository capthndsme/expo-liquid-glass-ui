/**
 * Geometry lifted from the AndroidLiquidGlass catalog components (all in dp/pt).
 *
 * The switch is fixed-size like the system one: 64×28 track, 40×24 thumb, 2 of inset — leaving
 * exactly 20 of thumb travel, which is also the drag distance that maps to a full toggle.
 */
const SWITCH_TRACK_WIDTH = 64;
const SWITCH_TRACK_HEIGHT = 28;
const SWITCH_THUMB_WIDTH = 44;
const SWITCH_THUMB_HEIGHT = 26;
const SWITCH_THUMB_INSET = 1;
const SWITCH_THUMB_TRAVEL =
  SWITCH_TRACK_WIDTH - SWITCH_THUMB_WIDTH - SWITCH_THUMB_INSET * 2;
/**
 * Pressed thumb grows and sheds its white fill, becoming a lens over the track. The reference's
 * 1.5 was tuned for a 24dp thumb; 1.4 on the chunkier 26dp thumb lands at the same absolute size.
 */
const SWITCH_THUMB_PRESSED_SCALE = 1.4;

const BUTTON_HEIGHT = 48;
/** Pressed button inflates by 4dp of its height, matching the reference `lerp(1, 1 + 4dp/h)`. */
const BUTTON_PRESS_GROWTH = 4;

const TAB_BAR_HEIGHT = 64;
const TAB_BAR_PADDING = 4;
/**
 * The pill sits this far inside the bar — tighter than the row padding, so the pill reads a
 * touch larger than one tab slot (60 tall in the 64 bar, 4dp wider than the slot).
 */
const TAB_INDICATOR_INSET = 2;
/** Indicator scale while dragged — the reference's `78f / 56f`. */
const TAB_INDICATOR_PRESSED_SCALE = 78 / 56;
/** Whole-bar scale while the indicator is held, approximating `1 + 16dp/width`. */
const TAB_BAR_PRESSED_SCALE = 1.045;

const TEXT_INPUT_HEIGHT = 48;

export {
  SWITCH_TRACK_WIDTH,
  SWITCH_TRACK_HEIGHT,
  SWITCH_THUMB_WIDTH,
  SWITCH_THUMB_HEIGHT,
  SWITCH_THUMB_INSET,
  SWITCH_THUMB_TRAVEL,
  SWITCH_THUMB_PRESSED_SCALE,
  BUTTON_HEIGHT,
  BUTTON_PRESS_GROWTH,
  TAB_BAR_HEIGHT,
  TAB_BAR_PADDING,
  TAB_INDICATOR_INSET,
  TAB_INDICATOR_PRESSED_SCALE,
  TAB_BAR_PRESSED_SCALE,
  TEXT_INPUT_HEIGHT,
};
