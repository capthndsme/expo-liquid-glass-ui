import {
  LiquidGlassStack,
  LiquidGlassView,
  setGlassDebugLogging,
} from "expo-liquid-glass-view";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

/**
 * Stacked glass on the public API. The manual nested-provider spike this replaces is in git
 * history (3c29122); the topology is identical — `LiquidGlassStack` now builds it, and no view
 * in this file names a `providerId`:
 *
 * ```
 * Layer 2 ── sheet (stacked mode)     reads layers 0+1 — the pill's FINISHED glass included
 * Layer 1 ── pill, puck [, sheet]     read layer 0
 * Layer 0 ── stage content
 * ```
 *
 * The toggle moves the sheet's content between the static layer slots. In layer 2 ("stacked")
 * the sheet must show the pill's frost, rim and refraction re-refracted through its own lens,
 * updating live while the pill drags. In layer 1 ("flat") the sheet and pill read the same
 * backdrop, so the pill simply does not exist in the sheet's world and its image stops dead at
 * the sheet's edge. Layer 2 is then an empty slot — which is exactly the supported way to
 * toggle: content moves, the layer list never changes.
 *
 * Expected in dev logcat, once: `Stacked glass: …` at INFO, naming the stack's auto ids.
 */
export default function StackingDemo(): React.JSX.Element {
  const [stacked, setStacked] = useState(true);

  useEffect(() => {
    setGlassDebugLogging(true);
    return () => setGlassDebugLogging(false);
  }, []);

  const pan = useRef(new Animated.ValueXY()).current;
  const panOffset = useRef({ x: 0, y: 0 });
  const drag = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pan.setOffset(panOffset.current);
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: (_e, g) => {
        panOffset.current = {
          x: panOffset.current.x + g.dx,
          y: panOffset.current.y + g.dy,
        };
        pan.flattenOffset();
      },
    })
  ).current;

  // One sheet element, rendered in layer 2 or layer 1 — `clear`, so what it refracts is plainly
  // visible; a frosty sheet would blur the evidence.
  const sheet = (
    <LiquidGlassView
      variant="clear"
      cornerRadius={{ topLeft: 28, topRight: 28, bottomRight: 0, bottomLeft: 0 }}
      style={styles.sheet}
    >
      <Text style={styles.sheetTitle}>
        {stacked ? "stacked — sheet in layer 2" : "flat — sheet in layer 1"}
      </Text>
      <Text style={styles.sheetBody}>
        {stacked
          ? "The pill's glass shows through: frost, rim and refraction, re-refracted."
          : "Sheet and pill read the same backdrop — lower glass does not exist here."}
      </Text>
      <Pressable style={styles.toggle} onPress={() => setStacked((s) => !s)}>
        <Text style={styles.toggleText}>{stacked ? "switch to flat" : "switch to stacked"}</Text>
      </Pressable>
    </LiquidGlassView>
  );

  return (
    <LiquidGlassStack style={styles.root}>
      <LiquidGlassStack.Layer>
        <Stage />
      </LiquidGlassStack.Layer>

      <LiquidGlassStack.Layer>
        {/* The lower glass layer. Draggable, so the sheet's picture of it must update live. */}
        <Animated.View
          {...drag.panHandlers}
          style={[styles.pillWrap, { transform: pan.getTranslateTransform() }]}
        >
          <LiquidGlassView cornerRadius={32} style={styles.pill}>
            <Text style={styles.pillText}>drag me under the sheet</Text>
          </LiquidGlassView>
        </Animated.View>

        <LiquidGlassView variant="clear" cornerRadius={45} style={styles.puck} />

        {!stacked && sheet}
      </LiquidGlassStack.Layer>

      <LiquidGlassStack.Layer>{stacked && sheet}</LiquidGlassStack.Layer>
    </LiquidGlassStack>
  );
}

function Stage(): React.JSX.Element {
  return (
    <View style={styles.stage}>
      <LinearGradient
        colors={["#14224e", "#5b2a86", "#d6536d", "#f5a04a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.stripes}>
        {Array.from({ length: 14 }, (_, i) => (
          <View key={i} style={styles.stripe} />
        ))}
      </View>
      <Text style={styles.stageTitle}>Stacked{"\n"}glass</Text>
      <View style={[styles.patch, styles.patchDark]} />
      <View style={[styles.patch, styles.patchLight]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0d0d0d" },
  stage: { flex: 1 },
  stripes: {
    position: "absolute",
    top: "10%",
    right: 18,
    width: 140,
    height: "70%",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  stripe: { width: 3, backgroundColor: "#ffffffc4" },
  stageTitle: {
    position: "absolute",
    top: "12%",
    left: 24,
    color: "#ffffff",
    fontSize: 52,
    fontWeight: "800",
    lineHeight: 56,
  },
  patch: { position: "absolute", width: 120, height: 150, borderRadius: 12 },
  patchDark: { top: "38%", left: 24, backgroundColor: "#08080c" },
  patchLight: { top: "34%", left: "44%", backgroundColor: "#f4f2ee" },

  pillWrap: { position: "absolute", top: "56%", alignSelf: "center" },
  pill: { width: 270, height: 64, alignItems: "center", justifyContent: "center" },
  pillText: { color: "#ffffffd9", fontSize: 13, fontWeight: "600" },
  puck: { position: "absolute", top: "27%", left: "38%", width: 90, height: 90 },

  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "34%",
    padding: 22,
    paddingTop: 26,
  },
  sheetTitle: { color: "#ffffff", fontSize: 15, fontWeight: "800" },
  sheetBody: { color: "#ffffffcc", fontSize: 13, lineHeight: 19, marginTop: 6, width: 260 },
  toggle: {
    alignSelf: "flex-start",
    marginTop: 14,
    backgroundColor: "#000000a8",
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  toggleText: { color: "#ffffff", fontSize: 13, fontWeight: "700" },
});
