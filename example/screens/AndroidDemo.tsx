import {
  LiquidGlassProvider,
  LiquidGlassView,
  setGlassDebugLogging,
  supportsGlass,
  type GlassActiveRenderer,
  type GlassAndroidQuality,
} from "expo-liquid-glass-view";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

/**
 * The Android test harness.
 *
 * Topology under test — the provider records the backdrop, and the glass panels are its
 * **siblings**, drawn after it. That is what keeps a glass view out of its own backdrop.
 */
export default function AndroidDemo(): React.JSX.Element {
  const [renderer, setRenderer] = useState<GlassActiveRenderer | null>(null);

  // Provider-recording and glass-draw rates land in logcat under `ExpoLiquidGlass`. Both counters
  // must stop moving when the screen is at rest.
  useEffect(() => {
    setGlassDebugLogging(true);
    return () => setGlassDebugLogging(false);
  }, []);

  // The case the recorded backdrop cannot see: the native driver mutates this view's transform on
  // the UI thread, so no React commit and no `dispatchDraw` happen. If the glass carries its
  // backdrop along instead of refracting what it is now over, this is where it shows.
  const [drifting, setDrifting] = useState(true);
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!drifting) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [drift, drifting]);

  return (
    <View style={styles.root}>
      <LiquidGlassProvider style={StyleSheet.absoluteFill}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {STRIPES.map((color, i) => (
            <View key={i} style={[styles.stripe, { backgroundColor: color }]}>
              <Text style={styles.stripeText}>{i}</Text>
            </View>
          ))}
        </ScrollView>
      </LiquidGlassProvider>

      <LiquidGlassView
        style={styles.panel}
        containerStyle={styles.panelInner}
        cornerRadius={32}
        tint="#3b82f622"
        metal={{ blurRadius: 40, frost: 0.28, saturation: 1.8 }}
        onRendererChange={setRenderer}
      >
        <Text style={styles.panelTitle}>Liquid glass</Text>
        <Text style={styles.panelSubtitle}>
          {Platform.OS} · API {Platform.Version} · {renderer ?? "…"}
        </Text>
      </LiquidGlassView>

      {/* The three compiled shader variants, side by side, with dispersion cranked well past the
          defaults so the tap count is actually visible. `low` drops dispersion, grain and the edge
          contour entirely — and with them five uniforms, which is the case that catches a drifted
          live-uniform set. */}
      <View style={styles.qualityRow}>
        {QUALITIES.map((quality) => (
          <View key={quality} style={styles.qualityCell}>
            <LiquidGlassView
              style={styles.chip}
              cornerRadius={20}
              metal={{
                dispersion: { amount: 24 },
                noise: 0.12,
                android: { quality },
              }}
            />
            <Text style={styles.qualityLabel}>{quality}</Text>
          </View>
        ))}
      </View>

      {/* The glass itself is static — its ANCESTOR moves. Nothing about the glass view is dirty,
          so its `dispatchDraw` never re-runs, yet its position in the window changes every frame.
          This is the shape of a FlatList of glass rows, and it is the case a recorded backdrop
          offset cannot see on its own. */}
      <Animated.View
        style={[
          styles.drifter,
          {
            transform: [
              {
                translateY: drift.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 150],
                }),
              },
            ],
          },
        ]}
      >
        <LiquidGlassView style={styles.drifterGlass} cornerRadius={24} />
      </Animated.View>
      <Pressable onPress={() => setDrifting((on) => !on)} style={styles.drifterLabel}>
        <Text style={styles.drifterLabelText}>
          ancestor translateY · tap to {drifting ? "stop" : "start"}
        </Text>
      </Pressable>

      {/* Per-corner radii, the `clear` variant, and `saturation: -5` — which the iOS demo also
          passes and iOS leaves unclamped, so it must not throw here either.

          The lurid red this produces over the dark stripes is CORRECT, not a bug. Saturation is
          `luma + s * (color - luma)`, so a negative `s` reflects each channel through the luma
          instead of draining it, and -5 amplifies the reflection fivefold: a blue-teal backdrop
          inverts to red. Over the near-neutral `#eaeaea` stripe there is no chroma to invert and
          the pill looks untouched. Measured (105.3, 27.9, 0.3) against a predicted
          (107.7, 27.8, 0.0) over `#0f2027`. `LiquidGlass.metal:234` does the same arithmetic and
          does not clamp until `:252`, so an iPhone renders the same thing. */}
      <LiquidGlassView
        style={styles.pill}
        variant="clear"
        cornerRadius={{
          topLeft: 32,
          topRight: 8,
          bottomRight: 32,
          bottomLeft: 8,
        }}
        metal={{ blurRadius: 24, saturation: -5, border: { width: 2 } }}
      />
      <Text style={styles.pillLabel}>
        clear · per-corner radii · saturation −5 (hue inverts — expected)
      </Text>

      {!supportsGlass ? (
        <Text style={styles.warning}>
          No hardware glass path on this device — components render as plain views.
        </Text>
      ) : null}
    </View>
  );
}

const QUALITIES: GlassAndroidQuality[] = ["low", "medium", "high"];

const STRIPES = [
  "#ff5f6d",
  "#ffc371",
  "#47cf73",
  "#12c2e9",
  "#c471ed",
  "#f64f59",
  "#0f2027",
  "#2c5364",
  "#eaeaea",
  "#111111",
];

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0d0d0d" },
  scrollContent: { paddingVertical: 24 },
  stripe: {
    height: 120,
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  stripeText: { fontSize: 40, fontWeight: "800", color: "#00000055" },
  panel: {
    position: "absolute",
    left: 24,
    right: 24,
    top: 140,
    height: 180,
  },
  panelInner: { flex: 1, alignItems: "center", justifyContent: "center" },
  panelTitle: { fontSize: 24, fontWeight: "700", color: "#ffffff" },
  panelSubtitle: { marginTop: 6, fontSize: 13, color: "#ffffffcc" },
  qualityRow: {
    position: "absolute",
    left: 24,
    right: 24,
    top: 360,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  qualityCell: { alignItems: "center" },
  chip: { width: 96, height: 96 },
  qualityLabel: {
    marginTop: 6,
    fontSize: 11,
    color: "#ffffffaa",
    textAlign: "center",
  },
  drifter: {
    position: "absolute",
    left: 24,
    // Overlaps the quality chips at rest, so the drift also answers "what does glass over glass
    // look like?" — the answer is that neither sees the other, because a glass view is never
    // inside the provider's recording.
    top: 400,
    width: 120,
    height: 120,
  },
  drifterGlass: { width: 120, height: 120 },
  drifterLabel: { position: "absolute", left: 24, top: 660 },
  drifterLabelText: { fontSize: 11, color: "#ffffffaa" },
  pill: {
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 60,
    height: 64,
  },
  pillLabel: {
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 40,
    fontSize: 11,
    color: "#ffffff99",
    textAlign: "center",
  },
  warning: {
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 12,
    fontSize: 12,
    color: "#ffb4b4",
    textAlign: "center",
  },
});
