import {
  LiquidGlassProvider,
  LiquidGlassView,
  supportsGlass,
  type GlassActiveRenderer,
  type GlassAndroidQuality,
} from "expo-liquid-glass-view";
import React, { useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";

/**
 * The Android test harness.
 *
 * Topology under test — the provider records the backdrop, and the glass panels are its
 * **siblings**, drawn after it. That is what keeps a glass view out of its own backdrop.
 */
export default function AndroidDemo(): React.JSX.Element {
  const [renderer, setRenderer] = useState<GlassActiveRenderer | null>(null);

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

      {/* Per-corner radii, the `clear` variant, and `saturation: -5` — which the iOS demo also
          passes and iOS leaves unclamped, so it must not throw here either. */}
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
  pill: {
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 60,
    height: 64,
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
