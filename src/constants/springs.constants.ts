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

export { BLOOM_FALL_SPRING, PRESS_SPRING, TRAVEL_SPRING };
