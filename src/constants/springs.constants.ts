import type { WithSpringConfig } from "react-native-reanimated";

/** Quick-in, small-settle — the press/toggle spring every control shares. */
const PRESS_SPRING: WithSpringConfig = {
  stiffness: 400,
  damping: 30,
  mass: 1,
};

/** Slightly looser — the tab indicator's travel between tabs. */
const TRAVEL_SPRING: WithSpringConfig = {
  stiffness: 300,
  damping: 28,
  mass: 1,
};

/**
 * The bloom's release. Deliberately stiffer than PRESS_SPRING: a symmetric
 * fall left the pill hanging inflated after it had already arrived, which
 * reads as lag rather than luxury.
 */
const BLOOM_FALL_SPRING: WithSpringConfig = {
  stiffness: 520,
  damping: 34,
  mass: 0.9,
};

/**
 * The bloom's rise on a TAP, as a duration rather than a spring.
 *
 * `withSequence` starts the next animation only once the previous one has
 * SETTLED, and PRESS_SPRING settles in ~267ms. Rising on it meant the fall did
 * not begin until the travel (~286ms) was practically over, so the pill sat
 * inflated for another ~200ms after arriving — measurably late, and it read as
 * the bloom not landing. 90ms up + a ~212ms fall tracks the travel instead.
 *
 * The drag is unaffected: it rises on PRESS_SPRING under the finger, where
 * there is no arrival to race.
 */
const BLOOM_RISE_DURATION_MS = 90;

export {
  BLOOM_FALL_SPRING,
  BLOOM_RISE_DURATION_MS,
  PRESS_SPRING,
  TRAVEL_SPRING,
};
