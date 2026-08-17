import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import LiquidGlassDemo from "./screens/LiquidGlassDemo";
import PlaygroundDemo from "./screens/PlaygroundDemo";
import ScrollDemo from "./screens/ScrollDemo";
import StackingDemo from "./screens/StackingDemo";
import FlatListDemo from "./screens/FlatListDemo";
import AndroidDemo from "./screens/AndroidDemo";
import AndroidListDemo from "./screens/AndroidListDemo";
import AndroidVideoDemo from "./screens/AndroidVideoDemo";
import AndroidPropsDemo from "./screens/AndroidPropsDemo";
import AndroidTierDemo from "./screens/AndroidTierDemo";
import AndroidModalDemo from "./screens/AndroidModalDemo";
import GlassUIDemo from "./screens/GlassUIDemo";
import { KeyboardProvider } from "react-native-keyboard-controller";
import {
  configureReanimatedLogger,
  ReanimatedLogLevel,
} from "react-native-reanimated";

configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false,
});

const DEMOS = {
  scroll: ScrollDemo,
  drag: LiquidGlassDemo,
  playground: PlaygroundDemo,
  stacking: StackingDemo,
  flatlist: FlatListDemo,
  android: AndroidDemo,
  androidProps: AndroidPropsDemo,
  androidTiers: AndroidTierDemo,
  androidList: AndroidListDemo,
  androidVideo: AndroidVideoDemo,
  androidModal: AndroidModalDemo,
  glassUi: GlassUIDemo,
} as const;

type DemoKey = keyof typeof DEMOS;

// `drag` is built on SwiftUI primitives, so Android starts on its own harness instead.
const DEFAULT_DEMO: DemoKey = Platform.OS === "android" ? "android" : "drag";

// `drag` is the only screen Android cannot run — it is built on SwiftUI primitives. `scroll` and
// `flatlist` are cross-platform as of Phase 6: each gained a `LiquidGlassProvider`, which is a plain
// `View` on iOS, and nothing else changed.
const TABS: DemoKey[] =
  Platform.OS === "android"
    ? [
        "android",
        "glassUi",
        "playground",
        "stacking",
        "androidProps",
        "androidTiers",
        "androidList",
        "androidVideo",
        "androidModal",
        "scroll",
        "flatlist",
      ]
    : ["drag", "glassUi", "playground", "scroll", "flatlist"];

// The `android` prefix is noise once most tabs have it.
const TAB_LABELS: Partial<Record<DemoKey, string>> = {
  android: "main",
  playground: "play",
  stacking: "stack",
  androidProps: "props",
  androidTiers: "tiers",
  androidList: "list",
  androidVideo: "video",
  androidModal: "modal",
  glassUi: "ui kit",
};

export default function App() {
  const [demo, setDemo] = useState<DemoKey>(DEFAULT_DEMO);
  const Current = DEMOS[demo];

  return (
    <KeyboardProvider enabled>
      <GestureHandlerRootView style={styles.container}>
        <Current />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.switcher}
          contentContainerStyle={styles.switcherContent}
        >
          {TABS.map((key) => (
            <Pressable
              key={key}
              onPress={() => setDemo(key)}
              style={[styles.tab, key === demo && styles.tabActive]}
            >
              <Text
                style={[styles.tabText, key === demo && styles.tabTextActive]}
              >
                {TAB_LABELS[key] ?? key}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </GestureHandlerRootView>
    </KeyboardProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#0d0d0d",
    flex: 1,
  },
  switcher: {
    position: "absolute",
    top: 48,
    left: 12,
    right: 12,
    maxHeight: 40,
    flexGrow: 0,
    backgroundColor: "#00000066",
    borderRadius: 10,
  },
  switcherContent: { alignItems: "center", gap: 4, padding: 4 },
  tab: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7 },
  tabActive: { backgroundColor: "#ffffff2e" },
  tabText: { color: "#c7cedb", fontSize: 12 },
  tabTextActive: { color: "#fff", fontWeight: "700" },
});
