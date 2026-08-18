import { useMemo } from "react";
import type { FrameInfo, SharedValue } from "react-native-reanimated";
import { useFrameCallback, useSharedValue } from "react-native-reanimated";

import {
  SCALE_X_SPEC,
  SCALE_Y_SPEC,
  VALUE_SPEC,
  VELOCITY_SPEC,
} from "../constants";

/**
 * The catalog's `DampedDragAnimation`, ported whole.
 *
 * Five spring channels advance together every frame: the value follower, press progress, the two
 * grab scales, and a low-passed velocity. They are integrated here rather than driven by
 * `withSpring` for one reason — Compose's `Animatable.animateTo` **inherits the current velocity**
 * when it is re-targeted mid-flight, and `withSpring` does not. A drag re-targets the follower on
 * every touch move, so without inherited velocity the pill visibly notches at each event. A
 * semi-implicit Euler integrator gets that continuity for free: retargeting only changes where the
 * spring is pulling, never the state it carries.
 *
 * The frame callback stays registered and cheaply early-outs when everything is at rest, rather
 * than being toggled with `setActive`. Toggling would route gesture start through `runOnJS`, and a
 * busy JS thread could then delay the first frame of the animation — exactly the failure this kit
 * exists to avoid.
 */

/** Semi-implicit Euler is stable here well past this, but substepping keeps k=1000 honest. */
const MAX_STEP_SECONDS = 1 / 60;

/** The reference's release gate: deflate once the follower is within 2.5% of the span. */
const CONVERGENCE_FRACTION = 0.025;

/** Velocity below this is treated as zero when deciding whether the system has settled. */
const VELOCITY_REST = 0.01;

/**
 * The window the follower's velocity is averaged over before it reaches its spring, matching the
 * span a Compose `VelocityTracker` least-squares-fits. See the integrator.
 */
const VELOCITY_WINDOW_SECONDS = 0.1;

interface IDampedDragConfig {
  /** Inclusive range the follower is clamped to, e.g. `[0, tabCount - 1]`. */
  range: [number, number];
  initialValue: number;
  /** Scale at rest. The reference always uses 1. */
  initialScale?: number;
  /** Scale while grabbed — `78/56` for the tab pill, `1.5` for the thumbs. */
  pressedScale: number;
  /**
   * Velocity is divided by this before it reaches the jelly. The reference uses 10 for
   * full-width controls (tab pill, slider) and 50 for short-throw ones (toggle).
   */
  velocityDivisor: number;
}

interface IDampedDrag {
  /** The damped follower — read this for position. */
  value: SharedValue<number>;
  /** The spring's goal. A drag moves this; `value` chases it. */
  targetValue: SharedValue<number>;
  pressProgress: SharedValue<number>;
  scaleX: SharedValue<number>;
  scaleY: SharedValue<number>;
  /** Smoothed follower velocity, in range-fractions per second. */
  velocity: SharedValue<number>;
  /** Inflate and light up. Call on touch-down, with no slop. */
  press: () => void;
  /** Deflate — but only once the follower has essentially arrived. */
  release: () => void;
  /** Add to the target, clamped to the range. */
  dragBy: (delta: number) => void;
  /** The full grab choreography for a programmatic move: press, fly, release on arrival. */
  animateTo: (next: number) => void;
  /** The velocity-driven squash/stretch, ready to spread into a transform. */
  jelly: () => { scaleX: number; scaleY: number };
}

function useDampedDrag(config: IDampedDragConfig): IDampedDrag {
  const {
    range,
    initialValue,
    initialScale = 1,
    pressedScale,
    velocityDivisor,
  } = config;

  const value = useSharedValue(initialValue);
  const targetValue = useSharedValue(initialValue);
  const pressProgress = useSharedValue(0);
  const scaleX = useSharedValue(initialScale);
  const scaleY = useSharedValue(initialScale);
  const velocity = useSharedValue(0);

  // Integrator state, one velocity per channel.
  const valueRate = useSharedValue(0);
  const pressRate = useSharedValue(0);
  const scaleXRate = useSharedValue(0);
  const scaleYRate = useSharedValue(0);
  const velocityRate = useSharedValue(0);

  const pressTarget = useSharedValue(0);
  const scaleTarget = useSharedValue(initialScale);
  const rawVelocity = useSharedValue(0);
  const previousValue = useSharedValue(initialValue);
  /** Set by `release()`; the integrator honours it once the follower converges. */
  const releasePending = useSharedValue(false);
  /** False during a programmatic snap — the reference stops sampling velocity there. */
  const trackVelocity = useSharedValue(true);

  const lower = range[0];
  const upper = range[1];
  const span = Math.max(upper - lower, 1e-6);

  useFrameCallback((frame: FrameInfo): void => {
    "worklet";
    const elapsed = frame.timeSincePreviousFrame;
    if (elapsed == null || elapsed <= 0) return;

    const settled =
      Math.abs(value.value - targetValue.value) < 1e-4 &&
      Math.abs(valueRate.value) < 1e-3 &&
      Math.abs(pressProgress.value - pressTarget.value) < 1e-4 &&
      Math.abs(pressRate.value) < 1e-3 &&
      Math.abs(scaleX.value - scaleTarget.value) < 1e-5 &&
      Math.abs(scaleY.value - scaleTarget.value) < 1e-5 &&
      Math.abs(velocity.value) < 1e-4 &&
      !releasePending.value;
    if (settled) return;

    let remaining = Math.min(elapsed / 1000, 0.1);
    while (remaining > 0) {
      const dt = Math.min(remaining, MAX_STEP_SECONDS);
      remaining -= dt;

      // Follower. Clamped after integrating so a drag past the end dead-stops, as the reference
      // does — the rubber band there is a separate, whole-panel affair.
      const valueAccel =
        VALUE_SPEC.stiffness * (targetValue.value - value.value) -
        VALUE_SPEC.damping * valueRate.value;
      valueRate.value += valueAccel * dt;
      value.value = Math.min(
        upper,
        Math.max(lower, value.value + valueRate.value * dt),
      );

      const pressAccel =
        VALUE_SPEC.stiffness * (pressTarget.value - pressProgress.value) -
        VALUE_SPEC.damping * pressRate.value;
      pressRate.value += pressAccel * dt;
      pressProgress.value += pressRate.value * dt;

      const scaleXAccel =
        SCALE_X_SPEC.stiffness * (scaleTarget.value - scaleX.value) -
        SCALE_X_SPEC.damping * scaleXRate.value;
      scaleXRate.value += scaleXAccel * dt;
      scaleX.value += scaleXRate.value * dt;

      const scaleYAccel =
        SCALE_Y_SPEC.stiffness * (scaleTarget.value - scaleY.value) -
        SCALE_Y_SPEC.damping * scaleYRate.value;
      scaleYRate.value += scaleYAccel * dt;
      scaleY.value += scaleYRate.value * dt;

      // Velocity is measured off the *follower*, not the finger, then low-passed by its own
      // underdamped spring. That double filter is what makes the stretch wobble instead of
      // tracking the touch instantly.
      //
      // The instantaneous derivative is only half of it. The reference reads a Compose
      // `VelocityTracker`, which least-squares-fits the last ~100 ms of samples — so what reaches
      // its spring is already a windowed average, not a per-frame difference. Feeding the raw
      // difference straight in makes the channel far peakier than the reference's, and on a *flick*
      // that difference is the whole story: the peak slams the jelly's +/-0.2 clamp and holds it
      // there, so the pill wears its widest stretch on top of the grab scale for most of the
      // throw. A tap never shows it, because `animateTo` stops sampling velocity altogether.
      //
      // One pole at the tracker's own window reproduces the smoothing without touching any of the
      // reference's constants.
      if (trackVelocity.value) {
        const instant = (value.value - previousValue.value) / dt / span;
        const alpha = 1 - Math.exp(-dt / VELOCITY_WINDOW_SECONDS);
        rawVelocity.value += (instant - rawVelocity.value) * alpha;
      }
      previousValue.value = value.value;

      const velocityAccel =
        VELOCITY_SPEC.stiffness * (rawVelocity.value - velocity.value) -
        VELOCITY_SPEC.damping * velocityRate.value;
      velocityRate.value += velocityAccel * dt;
      velocity.value += velocityRate.value * dt;
    }

    // The single most important detail of the choreography: the control stays inflated and glassy
    // through the entire snap, deflating only once it has essentially arrived. Deflating on
    // finger-up instead is the usual way this is got wrong.
    if (
      releasePending.value &&
      Math.abs(value.value - targetValue.value) < span * CONVERGENCE_FRACTION &&
      Math.abs(velocity.value) < VELOCITY_REST
    ) {
      releasePending.value = false;
      trackVelocity.value = true;
      pressTarget.value = 0;
      scaleTarget.value = initialScale;
    }
  }, true);

  return useMemo<IDampedDrag>(() => {
    const press = (): void => {
      "worklet";
      releasePending.value = false;
      trackVelocity.value = true;
      rawVelocity.value = 0;
      previousValue.value = value.value;
      pressTarget.value = 1;
      scaleTarget.value = pressedScale;
    };

    const release = (): void => {
      "worklet";
      releasePending.value = true;
    };

    const dragBy = (delta: number): void => {
      "worklet";
      targetValue.value = Math.min(
        upper,
        Math.max(lower, targetValue.value + delta),
      );
    };

    const animateTo = (next: number): void => {
      "worklet";
      press();
      targetValue.value = Math.min(upper, Math.max(lower, next));
      // The reference stops sampling velocity during a programmatic snap and springs the existing
      // velocity to zero instead; that unwind is the settle wobble.
      trackVelocity.value = false;
      rawVelocity.value = 0;
      release();
    };

    const jelly = (): { scaleX: number; scaleY: number } => {
      "worklet";
      const v = velocity.value / velocityDivisor;
      const stretch = Math.min(0.2, Math.max(-0.2, v * 0.75));
      const squash = Math.min(0.2, Math.max(-0.2, v * 0.25));
      // Division on X, multiplication on Y — volume-preserving, and signed, so it inverts on
      // reverse motion. Do not "fix" this to abs(); it changes the character.
      return {
        scaleX: scaleX.value / (1 - stretch),
        scaleY: scaleY.value * (1 - squash),
      };
    };

    return {
      value,
      targetValue,
      pressProgress,
      scaleX,
      scaleY,
      velocity,
      press,
      release,
      dragBy,
      animateTo,
      jelly,
    };
  }, [
    value,
    targetValue,
    pressProgress,
    scaleX,
    scaleY,
    velocity,
    pressTarget,
    scaleTarget,
    rawVelocity,
    previousValue,
    releasePending,
    trackVelocity,
    lower,
    upper,
    initialScale,
    pressedScale,
    velocityDivisor,
  ]);
}

export { useDampedDrag };
export type { IDampedDrag, IDampedDragConfig };
