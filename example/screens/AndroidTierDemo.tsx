import {
  LiquidGlassProvider,
  LiquidGlassView,
  type GlassActiveRenderer,
  type GlassAndroidTier,
} from "expo-liquid-glass-ui";
import React, { useCallback, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";

/**
 * The degradation ladder, all four rungs at once.
 *
 * `metal.android.maxTier` is a **ceiling**, never an override — the device's own limit always
 * applies first. So on an API-33 device every tile below shows what it asked for, and on an API-31
 * device the top two tiles both report `fallback-blur`. That asymmetry is the point: the label under
 * each tile is what `onRendererChange` actually reported, not what was requested, so a mismatch is
 * visible rather than inferred.
 *
 * All four tiles sit over the same backdrop, at the same size, with the same appearance props. The
 * only difference between them is how much of the pipeline runs.
 */
export default function AndroidTierDemo(): React.JSX.Element {
  const [reported, setReported] = useState<
    Partial<Record<GlassAndroidTier, GlassActiveRenderer>>
  >({});

  return (
    <View style={styles.root}>
      <LiquidGlassProvider style={StyleSheet.absoluteFill}>
        <View style={styles.backdrop}>
          {BANDS.map((color, i) => (
            <View key={i} style={[styles.band, { backgroundColor: color }]}>
              <Text style={styles.bandText}>{i}</Text>
            </View>
          ))}
        </View>
      </LiquidGlassProvider>

      <ScrollView contentContainerStyle={styles.list}>
        <Text style={styles.heading}>
          degradation ladder · API {String(Platform.Version)}
        </Text>

        {TIERS.map(({ tier, blurb }) => (
          <TierTile
            key={tier}
            tier={tier}
            blurb={blurb}
            actual={reported[tier]}
            onReport={setReported}
          />
        ))}

        <Text style={styles.footnote}>
          `none` is the native floor — frost, tint and border with no backdrop.
          It is not quite the sub-API-29 experience: below 29 the JS layer never
          mounts the native view at all and you get a bare {"<View>"}.
        </Text>
      </ScrollView>
    </View>
  );
}

function TierTile({
  tier,
  blurb,
  actual,
  onReport,
}: {
  tier: GlassAndroidTier;
  blurb: string;
  actual: GlassActiveRenderer | undefined;
  onReport: React.Dispatch<
    React.SetStateAction<Partial<Record<GlassAndroidTier, GlassActiveRenderer>>>
  >;
}): React.JSX.Element {
  const handle = useCallback(
    (renderer: GlassActiveRenderer) =>
      onReport((prev) => ({ ...prev, [tier]: renderer })),
    [onReport, tier]
  );

  // A mismatch here is not a bug — it is the device's ceiling winning, which is exactly what the
  // screen exists to make visible.
  const capped = actual !== undefined && actual !== tier;

  return (
    <View style={styles.tile}>
      <LiquidGlassView
        style={styles.glass}
        cornerRadius={24}
        metal={{ blurRadius: 24, android: { maxTier: tier } }}
        onRendererChange={handle}
      />
      <View style={styles.caption}>
        <Text style={styles.tierName}>
          maxTier: {tier}
          {capped ? ` → ${actual}` : ""}
        </Text>
        <Text style={styles.blurb}>{blurb}</Text>
        {capped ? (
          <Text style={styles.capped}>
            capped by this device's API level — not a failure
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const TIERS: { tier: GlassAndroidTier; blurb: string }[] = [
  {
    tier: "agsl",
    blurb: "refraction, dispersion, highlight, frost, tint, grain — API 33+",
  },
  {
    tier: "fallback-blur",
    blurb: "blur + saturation + frost + tint, clipped. No refraction — API 31+",
  },
  {
    tier: "scrim",
    blurb: "the backdrop straight through, under frost and tint — API 29+",
  },
  { tier: "none", blurb: "no backdrop at all; frost, tint and border only" },
];

// Deliberately high-contrast and diagonal-free: refraction bends straight edges, so a banded
// backdrop makes the difference between `agsl` and `fallback-blur` obvious at the tile's rim.
const BANDS = [
  "#ff5f6d",
  "#0d0d0d",
  "#ffc371",
  "#0d0d0d",
  "#47cf73",
  "#0d0d0d",
  "#12c2e9",
  "#0d0d0d",
  "#c471ed",
  "#0d0d0d",
  "#eaeaea",
  "#0d0d0d",
];

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0d0d0d" },
  backdrop: { flex: 1 },
  band: { flex: 1, justifyContent: "center", paddingLeft: 14 },
  bandText: { fontSize: 28, fontWeight: "800", color: "#00000055" },
  list: { paddingTop: 110, paddingBottom: 120, paddingHorizontal: 20 },
  heading: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 14,
  },
  tile: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  glass: { width: 108, height: 108 },
  caption: { flex: 1, marginLeft: 14 },
  tierName: { color: "#ffffff", fontSize: 14, fontWeight: "700" },
  blurb: { color: "#ffffffaa", fontSize: 11, marginTop: 3, lineHeight: 15 },
  capped: { color: "#ffd18a", fontSize: 11, marginTop: 4 },
  footnote: {
    color: "#ffffff88",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
});
