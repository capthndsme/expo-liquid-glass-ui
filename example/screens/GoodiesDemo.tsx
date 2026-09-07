import {
  LiquidGlassButton,
  LiquidGlassProvider,
  LiquidGlassSlider,
  LiquidGlassSwitch,
  LiquidGlassTabBar,
  LiquidGlassView,
  useAdaptiveGlass,
  useGlassUITheme,
  type LiquidGlassTabIconState,
  type LiquidGlassTabItem,
} from "expo-liquid-glass-ui";
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Dimensions, ScrollView, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";

/**
 * The goodies from the inspiration repositories, on one stage:
 *
 * - **Adaptive glass** — the card and the tab bar read the backdrop under them and dress for it.
 *   Drag the card across the light/dark boundary, or scroll the bands under the bar, and the
 *   frost flips polarity natively while the label crossfades with it (Kyant's adaptive-luminance
 *   demo; iOS 26's own behaviour).
 * - **A magnifier** — a draggable capsule with `magnification: 1.5` and an inner shadow over the
 *   text column (Kyant's magnifier demo).
 * - **Inner shadow and drop shadow** on the held tab pill and thumbs, an edge click on the slider.
 *
 * Stage children are absolute with explicit dp sizes — see MorphDemo for why.
 */
const WINDOW = Dimensions.get("window");
const BANDS = 12;
const BAND_HEIGHT = 150;

const ion =
  (focused: string, outline: string) =>
  ({ focused: isFocused, color, size }: LiquidGlassTabIconState) => (
    <Ionicons
      name={(isFocused ? focused : outline) as never}
      color={color}
      size={size}
    />
  );

const TAB_ITEMS: LiquidGlassTabItem[] = [
  { key: "home", title: "Home", icon: ion("home", "home-outline") },
  { key: "search", title: "Search", icon: ion("search", "search-outline") },
  { key: "you", title: "You", icon: ion("person", "person-outline") },
];

const LOREM =
  "Sphinx of black quartz, judge my vow. The quick brown fox jumps over the lazy dog. " +
  "Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump. ";

export default function GoodiesDemo(): React.JSX.Element {
  const [tab, setTab] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [level, setLevel] = useState(0.4);
  const [edgeHits, setEdgeHits] = useState(0);
  const [reading, setReading] = useState("luminance —");

  return (
    <View style={styles.root}>
      <LiquidGlassProvider providerId="goodies" style={StyleSheet.absoluteFill}>
        {/* One flow child; the bands scroll so the bar's backdrop changes under it. */}
        <ScrollView
          style={styles.stage}
          contentContainerStyle={styles.bands}
          showsVerticalScrollIndicator={false}
          overScrollMode="never"
        >
          {Array.from({ length: BANDS }, (_, i) => {
            const light = i % 2 === 0;
            return (
              <View
                key={i}
                style={[
                  styles.band,
                  { backgroundColor: light ? "#f3ede1" : "#171a22" },
                ]}
              >
                <Text
                  style={[styles.bandText, { color: light ? "#22262e" : "#e9e4d6" }]}
                >
                  {`${i} — ${LOREM}${LOREM}`}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      </LiquidGlassProvider>

      <AdaptiveCard onReading={setReading} />
      <Magnifier />

      <View style={styles.status} pointerEvents="none">
        <Text style={styles.statusText}>{reading}</Text>
      </View>

      <View style={styles.controls} pointerEvents="box-none">
        <View style={styles.controlRow} pointerEvents="box-none">
          <LiquidGlassSlider
            providerId="goodies"
            value={level}
            onValueChange={setLevel}
            onEdgeReached={() => setEdgeHits((n) => n + 1)}
            style={styles.slider}
          />
          <Text style={styles.controlLabel}>{`edge ×${edgeHits}`}</Text>
          <LiquidGlassSwitch
            providerId="goodies"
            value={enabled}
            onValueChange={setEnabled}
          />
        </View>
        <LiquidGlassTabBar
          adaptive
          providerId="goodies"
          tabs={TAB_ITEMS}
          selectedIndex={tab}
          onTabSelected={setTab}
        />
      </View>
    </View>
  );
}

/** A draggable adaptive card: the frost flips polarity and the label crossfades with it. */
function AdaptiveCard({
  onReading,
}: {
  onReading: (text: string) => void;
}): React.JSX.Element {
  const adaptive = useAdaptiveGlass();
  const { colors } = useGlassUITheme(adaptive.scheme);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const pan = Gesture.Pan()
    .onBegin(() => {
      startX.value = x.value;
      startY.value = y.value;
    })
    .onUpdate((event) => {
      x.value = startX.value + event.translationX;
      y.value = startY.value + event.translationY;
    });

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(adaptive.progress.value, [0, 1], ["#111111", "#f4f4f4"]),
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.card, dragStyle]}>
        <LiquidGlassView
          {...adaptive.glassProps}
          onBackdropLuminance={(r) => {
            adaptive.glassProps.onBackdropLuminance(r);
            onReading(`luminance ${r.luminance.toFixed(2)} · ${r.dark ? "dark" : "light"}`);
          }}
          providerId="goodies"
          cornerRadius={28}
          cornerStyle="continuous"
          tint={colors.tabBarSurface}
          metal={{ blurRadius: 6, frost: 0.3, innerShadow: { radius: 10, opacity: 0.12 } }}
          style={styles.cardGlass}
          containerStyle={styles.cardContent}
        >
          <Animated.Text style={[styles.cardTitle, labelStyle]}>Adaptive</Animated.Text>
          <Animated.Text style={[styles.cardBody, labelStyle]}>
            drag me across the bands
          </Animated.Text>
        </LiquidGlassView>
      </Animated.View>
    </GestureDetector>
  );
}

/** Kyant's magnifier: a capsule lens at 1.5x with a thick inner lip, dragged over the text. */
function Magnifier(): React.JSX.Element {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const pan = Gesture.Pan()
    .onBegin(() => {
      startX.value = x.value;
      startY.value = y.value;
    })
    .onUpdate((event) => {
      x.value = startX.value + event.translationX;
      y.value = startY.value + event.translationY;
    });

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.magnifier, dragStyle]}>
        <LiquidGlassView
          providerId="goodies"
          variant="clear"
          cornerRadius={48}
          cornerStyle="continuous"
          metal={{
            magnification: 1.5,
            frost: 0,
            saturation: 1,
            blurRadius: 0,
            refraction: { amount: 24, width: 8, height: 8, depth: 1 },
            dispersion: { amount: 8, reach: 8, quadrant: 1 },
            innerShadow: { radius: 16, opacity: 0.18 },
            highlight: { intensity: 0.35, width: 0.75 },
          }}
          style={styles.magnifierGlass}
        />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#171a22",
  },
  stage: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  bands: {
    paddingTop: 96,
    paddingBottom: 260,
  },
  band: {
    height: BAND_HEIGHT,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  bandText: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "500",
  },
  card: {
    position: "absolute",
    top: 190,
    left: 24,
    width: 220,
    height: 120,
  },
  cardGlass: {
    width: 220,
    height: 120,
  },
  cardContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: "700",
  },
  cardBody: {
    fontSize: 13,
    fontWeight: "500",
    opacity: 0.85,
  },
  magnifier: {
    position: "absolute",
    top: 380,
    left: WINDOW.width - 24 - 128,
    width: 128,
    height: 96,
  },
  magnifierGlass: {
    width: 128,
    height: 96,
  },
  status: {
    position: "absolute",
    top: 100,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  statusText: {
    color: "#111",
    fontSize: 13,
    fontWeight: "700",
    backgroundColor: "rgba(255,255,255,0.85)",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    overflow: "hidden",
  },
  controls: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 32,
    gap: 18,
  },
  controlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  slider: {
    flex: 1,
  },
  controlLabel: {
    color: "#ffffffcc",
    fontSize: 12,
    fontWeight: "600",
    minWidth: 54,
  },
});
