import { LiquidGlassProvider } from "expo-liquid-glass-view";
import {
  LiquidGlassMorphGroup,
  LiquidGlassScrim,
  LiquidGlassSegmentedControl,
} from "expo-liquid-glass-ui";
import React, { useState } from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";

/**
 * The stretch-merge harness: a `LiquidGlassMorphGroup` riding a `LiquidGlassScrim` — drag a
 * capsule onto its neighbour and the two fuse; release there and the merge fires (logged into
 * the title line). The scrim underneath melts the stage's text into blur, so one screen
 * exercises both of this round's features.
 *
 * Stage children are absolute with explicit dp sizes — see MorphDemo for why.
 */
const WINDOW = Dimensions.get("window");
const ROWS = Math.ceil(WINDOW.height / 44);

export default function MergeDemo(): React.JSX.Element {
  const [lastMerge, setLastMerge] = useState<string>("drag a pill onto its neighbour");
  const [segment, setSegment] = useState(0);

  return (
    <View style={styles.root}>
      <LiquidGlassProvider providerId="merge-stage" style={StyleSheet.absoluteFill}>
        {/* Painted inside the provider on purpose — see BlurDemo. */}
        <View style={styles.stage}>
          {Array.from({ length: ROWS }, (_, i) => (
            <Text key={i} style={[styles.row, { top: i * 44 }]} numberOfLines={1}>
              {`${i} — sphinx of black quartz, judge my vow 0123456789 ▪▫▪▫▪▫`}
            </Text>
          ))}
          <View style={[styles.blob, styles.blobA]} />
          <View style={[styles.blob, styles.blobB]} />
        </View>
      </LiquidGlassProvider>

      <View style={styles.status} pointerEvents="none">
        <Text style={styles.statusText}>{lastMerge}</Text>
      </View>

      <LiquidGlassScrim
        edge="bottom"
        size={240}
        radius={26}
        providerId="merge-stage"
      >
        <View style={styles.dock}>
          <LiquidGlassSegmentedControl
            providerId="merge-stage"
            segments={["Day", "Week", "Month"]}
            selectedIndex={segment}
            onChange={setSegment}
            style={styles.segmented}
          />
          <LiquidGlassMorphGroup
            providerId="merge-stage"
            items={[
              { key: "copy", label: "Copy" },
              { key: "share", label: "Share" },
              { key: "pin", label: "Pin" },
            ]}
            onMerge={(from, to) => setLastMerge(`merged ${from} → ${to}`)}
            onItemPress={(key) => setLastMerge(`tapped ${key}`)}
          />
        </View>
      </LiquidGlassScrim>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#efe9db",
  },
  stage: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#efe9db",
  },
  row: {
    position: "absolute",
    left: 12,
    width: WINDOW.width - 24,
    height: 44,
    color: "#22262e",
    fontSize: 17,
    fontWeight: "500",
  },
  blob: {
    position: "absolute",
    borderRadius: 999,
  },
  blobA: {
    width: 190,
    height: 190,
    top: 200,
    right: -30,
    backgroundColor: "#ff5d3a",
  },
  blobB: {
    width: 140,
    height: 140,
    top: 520,
    left: -20,
    backgroundColor: "#2f86ff",
  },
  status: {
    position: "absolute",
    top: 90,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  statusText: {
    color: "#111",
    fontSize: 15,
    fontWeight: "700",
    backgroundColor: "rgba(255,255,255,0.85)",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    overflow: "hidden",
  },
  dock: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 56,
    gap: 20,
  },
  segmented: {
    alignSelf: "stretch",
    marginHorizontal: 40,
  },
});
