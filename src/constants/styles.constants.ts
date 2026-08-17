import type { ViewStyle } from "react-native";

/** RN 0.80+'s strict types dropped `StyleSheet.absoluteFillObject`; this is that object. */
const ABSOLUTE_FILL = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
} as const satisfies ViewStyle;

export { ABSOLUTE_FILL };
