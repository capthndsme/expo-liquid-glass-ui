import type { WithSpringConfig } from "react-native-reanimated";

/**
 * The reference's motion language, ported spec for spec.
 *
 * Compose writes `spring(dampingRatio, stiffness, visibilityThreshold)` and always uses mass 1,
 * so the conversion to Reanimated is exact:
 *
 *     damping = dampingRatio * 2 * sqrt(stiffness)
 *
 * Do **not** carry a Compose stiffness across with a hand-picked damping — that is how this kit
 * ended up near-critically damped (zeta 0.75-0.81) against a reference that deliberately
 * overshoots. The bounce is not incidental; it is most of what reads as "liquid".
 *
 * Each spec is exported twice: as a `{stiffness, damping}` pair for the hand-integrated springs in
 * `useDampedDrag`, and as a `WithSpringConfig` for the places a plain `withSpring` will do.
 */

/** Damping for a unit-mass spring at the given ratio and stiffness. */
const dampingFor = (dampingRatio: number, stiffness: number): number =>
  dampingRatio * 2 * Math.sqrt(stiffness);

interface ISpringSpec {
  stiffness: number;
  damping: number;
}

const spec = (dampingRatio: number, stiffness: number): ISpringSpec => ({
  stiffness,
  damping: dampingFor(dampingRatio, stiffness),
});

const asConfig = (s: ISpringSpec): WithSpringConfig => ({
  mass: 1,
  stiffness: s.stiffness,
  damping: s.damping,
});

/**
 * `spring(1f, 1000f)` — critically damped, no overshoot, ~0.29 s to settle. Drives anything that
 * must land on a definite value: the tab indicator's position, a control's own value, and every
 * dragged control's press progress.
 */
const VALUE_SPEC: ISpringSpec = spec(1, 1000);

/**
 * `spring(0.6f, 250f)` — 9.5% overshoot. The grab swell on X.
 *
 * X and Y use deliberately different ratios (0.6 vs 0.7); that 0.1 asymmetry is the wobble. Keep
 * them apart.
 */
const SCALE_X_SPEC: ISpringSpec = spec(0.6, 250);

/** `spring(0.7f, 250f)` — 4.6% overshoot. The grab swell on Y. */
const SCALE_Y_SPEC: ISpringSpec = spec(0.7, 250);

/**
 * `spring(0.5f, 300f)` — 16.3% overshoot, damped period ~0.42 s. Low-passes the velocity that
 * drives the jelly, and springs it back to 0 on release: that decay *is* the settle wobble.
 */
const VELOCITY_SPEC: ISpringSpec = spec(0.5, 300);

/** `spring(1f, 300f)` — recentres the whole-panel rubber band when a drag stops. */
const PANEL_SPEC: ISpringSpec = spec(1, 300);

/**
 * `spring(0.5f, 300f)` — the button's `InteractiveHighlight`: the white grab glow fading in and
 * out, and the rubber-band return to origin.
 */
const GLOW_SPEC: ISpringSpec = spec(0.5, 300);

const VALUE_SPRING: WithSpringConfig = asConfig(VALUE_SPEC);
/** The same spec, named for its other job: `pressProgress` 0<->1. */
const PRESS_SPRING: WithSpringConfig = asConfig(VALUE_SPEC);
const SCALE_X_SPRING: WithSpringConfig = asConfig(SCALE_X_SPEC);
const SCALE_Y_SPRING: WithSpringConfig = asConfig(SCALE_Y_SPEC);
const VELOCITY_SPRING: WithSpringConfig = asConfig(VELOCITY_SPEC);
const PANEL_SPRING: WithSpringConfig = asConfig(PANEL_SPEC);
const GLOW_SPRING: WithSpringConfig = asConfig(GLOW_SPEC);

export {
  dampingFor,
  VALUE_SPEC,
  SCALE_X_SPEC,
  SCALE_Y_SPEC,
  VELOCITY_SPEC,
  PANEL_SPEC,
  GLOW_SPEC,
  VALUE_SPRING,
  PRESS_SPRING,
  SCALE_X_SPRING,
  SCALE_Y_SPRING,
  VELOCITY_SPRING,
  PANEL_SPRING,
  GLOW_SPRING,
};
export type { ISpringSpec };
