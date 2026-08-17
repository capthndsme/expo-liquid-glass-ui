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

export { PRESS_SPRING, TRAVEL_SPRING };
