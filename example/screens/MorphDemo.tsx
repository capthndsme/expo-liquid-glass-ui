import {
  LiquidGlassProvider,
  LiquidGlassView,
} from "expo-liquid-glass-view";
import React, { useState } from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedProps,
  useSharedValue,
} from "react-native-reanimated";

/**
 * The morph harness: one CANVAS glass view (`metal.shape` insets the bar from the view, which is
 * what gives the partner room to exist), and a draggable partner circle (`metal.morph`) driven at
 * display rate through `useAnimatedProps`. Drag the puck out of the bar and the two silhouettes
 * neck, stretch and separate — refraction, dispersion and the rim all follow the merged SDF, so
 * the joint reads as one pane of liquid, never two overlapping panes.
 *
 * The stage behind is deliberately busy: stripes for refraction, hot patches for dispersion.
 */
const CANVAS_W = 344;
const CANVAS_H = 320;
const BAR = { x: 12, y: CANVAS_H - 96, width: CANVAS_W - 24, height: 84 };
const PUCK = 72;

const SMOOTHINGS = [8, 24, 48] as const;

// Absolute dp anchors, not flex: normal-flow children inside the provider's subtree resolve to
// zero on Android (the same family as the "provider lays out only its first direct child"
// quirk — the working demos all use ScrollViews or absolute children there). The stage is not
// the thing under test, so it takes the pattern that provably works.
const STRIPE_COUNT = 14;
const STRIPE_W = Dimensions.get("window").width / STRIPE_COUNT;
// Explicit height too: parent-height-derived dimensions (top+bottom stretch, "100%") resolve to
// zero inside the provider subtree on device, while width-derived ones work. Same quirk family.
const STRIPE_H = Dimensions.get("window").height;

const AnimatedGlassView = Animated.createAnimatedComponent(LiquidGlassView);

export default function MorphDemo(): React.JSX.Element {
  const [smoothing, setSmoothing] = useState<number>(24);

  // Partner top-left, canvas-local dp. Rest position: sunk into the bar.
  const px = useSharedValue((CANVAS_W - PUCK) / 2);
  const py = useSharedValue(BAR.y + (BAR.height - PUCK) / 2);
  const grabPx = useSharedValue(0);
  const grabPy = useSharedValue(0);

  const pan = Gesture.Pan()
    .onStart(() => {
      grabPx.value = px.value;
      grabPy.value = py.value;
    })
    .onChange((event) => {
      px.value = Math.min(
        CANVAS_W - PUCK,
        Math.max(0, grabPx.value + event.translationX),
      );
      py.value = Math.min(
        CANVAS_H - PUCK,
        Math.max(0, grabPy.value + event.translationY),
      );
    });

  const morphProps = useAnimatedProps(() => ({
    metal: {
      // The canvas hosts no chrome of its own: the SDF draws the bar, so the CALayer border —
      // which would ring the whole canvas — stays off.
      border: { width: 0 },
      shape: BAR,
      morph: {
        x: px.value,
        y: py.value,
        width: PUCK,
        height: PUCK,
        cornerRadius: PUCK / 2,
        smoothing,
      },
    },
  }));

  return (
    <View style={styles.root}>
      <LiquidGlassProvider providerId="morph-stage" style={StyleSheet.absoluteFill}>
        <View style={styles.stage}>
          {Array.from({ length: STRIPE_COUNT }, (_, i) => (
            <View
              key={i}
              style={[
                styles.stripe,
                {
                  left: i * STRIPE_W,
                  width: STRIPE_W,
                  height: STRIPE_H,
                  backgroundColor: i % 2 === 0 ? "#101418" : "#e8e2d6",
                },
              ]}
            />
          ))}
          <View style={[styles.blob, styles.blobA]} />
          <View style={[styles.blob, styles.blobB]} />
          <View style={[styles.blob, styles.blobC]} />
          <Text style={styles.stageText}>drag the puck out of the bar</Text>
        </View>
      </LiquidGlassProvider>

      <GestureDetector gesture={pan}>
        <View style={styles.canvas}>
          <AnimatedGlassView
            renderer="metal"
            providerId="morph-stage"
            cornerRadius={BAR.height / 2}
            cornerStyle="continuous"
            animatedProps={morphProps}
            style={StyleSheet.absoluteFill}
          />
        </View>
      </GestureDetector>

      <View style={styles.controls}>
        {SMOOTHINGS.map((value) => (
          <Pressable
            key={value}
            onPress={() => setSmoothing(value)}
            style={[
              styles.control,
              smoothing === value && styles.controlActive,
            ]}
          >
            <Text style={styles.controlText}>{`smin ${value}`}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#1c2026",
  },
  fill: {
    flex: 1,
  },
  stage: {
    // Spelled out: RN 0.85's strict types dropped `StyleSheet.absoluteFillObject`.
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    overflow: "hidden",
  },
  stripe: {
    position: "absolute",
    top: 0,
  },
  blob: {
    position: "absolute",
    borderRadius: 999,
  },
  blobA: {
    width: 180,
    height: 180,
    top: 90,
    left: 30,
    backgroundColor: "#ff5d3a",
  },
  blobB: {
    width: 130,
    height: 130,
    top: 320,
    right: 40,
    backgroundColor: "#2f86ff",
  },
  blobC: {
    width: 90,
    height: 90,
    top: 210,
    right: 120,
    backgroundColor: "#ffd23f",
  },
  stageText: {
    position: "absolute",
    top: 48,
    left: 0,
    right: 0,
    textAlign: "center",
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  canvas: {
    position: "absolute",
    bottom: 90,
    alignSelf: "center",
    width: CANVAS_W,
    height: CANVAS_H,
  },
  controls: {
    position: "absolute",
    bottom: 34,
    alignSelf: "center",
    flexDirection: "row",
    gap: 10,
  },
  control: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  controlActive: {
    backgroundColor: "rgba(255,255,255,0.38)",
  },
  controlText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
});
