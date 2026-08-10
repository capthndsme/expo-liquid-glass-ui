import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import LiquidGlassDemo from "./screens/LiquidGlassDemo";
import ScrollDemo from "./screens/ScrollDemo";
import FlatListDemo from "./screens/FlatListDemo";
import AndroidDemo from "./screens/AndroidDemo";
import AndroidListDemo from "./screens/AndroidListDemo";
import AndroidVideoDemo from "./screens/AndroidVideoDemo";
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
  flatlist: FlatListDemo,
  android: AndroidDemo,
  androidList: AndroidListDemo,
  androidVideo: AndroidVideoDemo,
} as const;

type DemoKey = keyof typeof DEMOS;

// `drag` is built on SwiftUI primitives, so Android starts on its own harness instead.
const DEFAULT_DEMO: DemoKey = Platform.OS === "android" ? "android" : "drag";

// The Android screens are the only ones that run on Android; the other three are built on SwiftUI
// primitives or on `renderer="native"`.
const TABS: DemoKey[] =
  Platform.OS === "android"
    ? ["android", "androidList", "androidVideo"]
    : ["drag", "scroll", "flatlist"];

export default function App() {
  const [demo, setDemo] = useState<DemoKey>(DEFAULT_DEMO);
  const Current = DEMOS[demo];

  return (
    <KeyboardProvider enabled>
      <GestureHandlerRootView style={styles.container}>
        <Current />
        <View style={styles.switcher}>
          {TABS.map((key) => (
            <Pressable
              key={key}
              onPress={() => setDemo(key)}
              style={[styles.tab, key === demo && styles.tabActive]}
            >
              <Text
                style={[styles.tabText, key === demo && styles.tabTextActive]}
              >
                {key}
              </Text>
            </Pressable>
          ))}
        </View>
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
    top: 60,
    right: 16,
    flexDirection: "row",
    gap: 6,
    backgroundColor: "#00000066",
    borderRadius: 10,
    padding: 4,
  },
  tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 7 },
  tabActive: { backgroundColor: "#ffffff2e" },
  tabText: { color: "#c7cedb", fontSize: 12 },
  tabTextActive: { color: "#fff", fontWeight: "700" },
});
