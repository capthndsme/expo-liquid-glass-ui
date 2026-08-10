import {
  LiquidGlassProvider,
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
 * The nested-provider stacking spike: can glass refract glass?
 *
 * Topology under test — the widget glass lives INSIDE the outer provider while reading the base
 * one, so the outer provider's recording contains the widget's *finished* glass (its
 * effect-carrying RenderNode is referenced by display list, live):
 *
 * ```
 * outer provider ──┬── base provider ── stage content
 *                  ├── pill   (glass, reads base)      ← recorded into outer
 *                  └── puck   (glass, reads base)      ← recorded into outer
 * sheet (glass, reads outer — or base, on the toggle)  ← sibling, drawn last
 * ```
 *
 * "stacked" points the sheet at the outer provider: where it overlaps the pill it must show the
 * pill's frost, rim and refraction, re-refracted. "flat" points it at the base provider — today's
 * documented behaviour, where lower glass simply does not exist in the sheet's world. Drag the
 * pill under the sheet and the sheet's picture of it must follow live: that is the
 * onDescendantInvalidated -> contentGeneration chain being exercised through two provider levels.
 *
 * Expected in dev logcat, once: the "glass inside a different provider" warning — this screen is
 * the topology that warning calls "rarely what you want", used on purpose.
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

  return (
    <View style={styles.root}>
      {/* Children of the native provider view at index >= 1 that are absolutely positioned get
          broken frames (measured: x = parent width, width 0 — even for absoluteFill, while their
          own subtrees lay out correctly). So the provider gets exactly ONE normal-flow child, the
          same shape every working screen uses, and everything positions inside that. */}
      <LiquidGlassProvider providerId="stack-outer" style={StyleSheet.absoluteFill}>
        <View style={styles.stackInner}>
          <LiquidGlassProvider providerId="stack-base" style={StyleSheet.absoluteFill}>
            <Stage />
          </LiquidGlassProvider>

          {/* The lower glass layer. Draggable, so the sheet's picture of it must update live. */}
          <Animated.View
            {...drag.panHandlers}
            style={[styles.pillWrap, { transform: pan.getTranslateTransform() }]}
          >
            <LiquidGlassView
              providerId="stack-base"
              cornerRadius={32}
              style={styles.pill}
            >
              <Text style={styles.pillText}>drag me under the sheet</Text>
            </LiquidGlassView>
          </Animated.View>

          <LiquidGlassView
            providerId="stack-base"
            variant="clear"
            cornerRadius={45}
            style={styles.puck}
          />
        </View>
      </LiquidGlassProvider>

      {/* The upper glass layer — the only glass OUTSIDE the outer provider. `clear`, so what it
          refracts is plainly visible; a frosty sheet would blur the evidence. */}
      <LiquidGlassView
        providerId={stacked ? "stack-outer" : "stack-base"}
        variant="clear"
        cornerRadius={{ topLeft: 28, topRight: 28, bottomRight: 0, bottomLeft: 0 }}
        style={styles.sheet}
      >
        <Text style={styles.sheetTitle}>
          {stacked ? "stacked — sheet reads the outer provider" : "flat — sheet reads the base provider"}
        </Text>
        <Text style={styles.sheetBody}>
          {stacked
            ? "The pill's glass shows through: frost, rim and refraction, re-refracted."
            : "Lower glass does not exist in this sheet's backdrop — today's default."}
        </Text>
        <Pressable style={styles.toggle} onPress={() => setStacked((s) => !s)}>
          <Text style={styles.toggleText}>{stacked ? "switch to flat" : "switch to stacked"}</Text>
        </Pressable>
      </LiquidGlassView>
    </View>
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
  stackInner: { flex: 1 },
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
