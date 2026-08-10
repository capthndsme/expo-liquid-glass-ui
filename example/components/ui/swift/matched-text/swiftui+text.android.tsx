import { memo } from "react";
import { Text, StyleSheet } from "react-native";

import type { IContentTransition } from "./interface";

/**
 * Android stand-in for the SwiftUI `MatchedText`.
 *
 * The real one is built on `@expo/ui/swift-ui`, whose `Host` calls `requireNativeView('ExpoUI', …)`
 * at module scope — so importing it on Android throws before any component renders. Metro picks
 * this file up via the `.android.tsx` extension; there is no `Platform.OS` check to forget.
 *
 * The animated content transition is not reproduced — just the text.
 */
const MatchedText: React.MemoExoticComponent<React.FC<IContentTransition>> =
  memo(
    ({
      texts,
      index,
      fontSize = 17,
      color = "#ffffff",
      weight = "semibold",
      align = "center",
      maxLines,
    }: IContentTransition): React.ReactNode & React.JSX.Element => {
      return (
        <Text
          numberOfLines={maxLines}
          style={[
            styles.text,
            {
              fontSize,
              color,
              fontWeight: WEIGHTS[weight],
              textAlign: ALIGNMENTS[align],
            },
          ]}
        >
          {texts[index] ?? ""}
        </Text>
      );
    },
  );

const WEIGHTS = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

const ALIGNMENTS = {
  leading: "left",
  center: "center",
  trailing: "right",
} as const;

const styles = StyleSheet.create({
  text: {
    includeFontPadding: false,
  },
});

export { MatchedText };
