import {
  LiquidGlassProvider,
  LiquidGlassView,
  type GlassMetalOptions,
} from "expo-liquid-glass-ui";
import React, { useEffect, useState } from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

/**
 * The progressive-blur harness: two pure-blur scrims over a text-heavy stage — text is the
 * sharpest evidence a blur ramp can have. The bottom scrim blurs downward (the classic tab-bar
 * melt), the top one upward, and everything else in the glass is zeroed so what you see is the
 * ramp and nothing but the ramp. A marker drifts down the right margin so the scrims re-evaluate
 * every frame — that makes `dumpsys gfxinfo` an honest per-frame cost for the blur.
 *
 * Stage children are absolute with explicit dp sizes throughout — inside a provider's subtree,
 * height-derived layout resolves to zero on Android (see the MorphDemo note).
 */
const WINDOW = Dimensions.get("window");
const ROWS = Math.ceil(WINDOW.height / 44);

/** Everything off except the ramp: a scrim, not a lens. */
const scrimMetal = (
  progressiveBlur: GlassMetalOptions["progressiveBlur"],
): GlassMetalOptions => ({
  frost: 0,
  saturation: 1,
  noise: 0,
  light: 0,
  refraction: { amount: 0 },
  dispersion: { amount: 0 },
  highlight: { intensity: 0 },
  border: { width: 0 },
  progressiveBlur,
});

const RADII = [12, 28, 56] as const;

export default function BlurDemo(): React.JSX.Element {
  const [radius, setRadius] = useState<number>(28);

  // A marker drifting the full height of the stage keeps the backdrop changing every frame, so
  // both scrims re-evaluate every frame: the perf harness for the blur (read `dumpsys gfxinfo`).
  // It rides the right margin, clear of the text the measurements sample.
  const drift = useSharedValue(0);
  useEffect(() => {
    drift.value = withRepeat(
      withTiming(1, { duration: 4000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [drift]);
  const moverStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: drift.value * (WINDOW.height - 140) }],
  }));

  return (
    <View style={styles.root}>
      <LiquidGlassProvider providerId="blur-stage" style={StyleSheet.absoluteFill}>
        {/* The stage paints its own background. The provider records only its subtree, so a
            transparent stage blurs into a translucent haze and the crisp content drawn
            underneath the scrim shows straight through it (seen on the API 37 emulator). */}
        <View style={styles.stage}>
          {Array.from({ length: ROWS }, (_, i) => (
            <Text
              key={i}
              style={[styles.row, { top: i * 44 }]}
              numberOfLines={1}
            >
              {i % 2 === 0
                ? `${i} — the quick brown fox jumps over the lazy dog 0123456789`
                : `${i} ▪▫▪▫▪▫▪▫ sharp text is the sharpest evidence ▪▫▪▫▪▫▪▫`}
            </Text>
          ))}
          <View style={[styles.blob, styles.blobA]} />
          <View style={[styles.blob, styles.blobB]} />
          <Animated.View style={[styles.mover, moverStyle]} />
        </View>
      </LiquidGlassProvider>

      {/* Top scrim: blur increases upward — sharp where it meets the content. */}
      <LiquidGlassView
        renderer="metal"
        providerId="blur-stage"
        cornerRadius={0}
        metal={scrimMetal({
          direction: "up",
          startRadius: 0,
          endRadius: radius,
        })}
        style={styles.topScrim}
      />

      {/* Bottom scrim: the classic tab-bar melt, ramp confined to the upper 70%. */}
      <LiquidGlassView
        renderer="metal"
        providerId="blur-stage"
        cornerRadius={0}
        metal={scrimMetal({
          direction: "down",
          startRadius: 0,
          endRadius: radius,
          end: 0.7,
        })}
        style={styles.bottomScrim}
      />

      <View style={styles.controls}>
        {RADII.map((value) => (
          <Pressable
            key={value}
            onPress={() => setRadius(value)}
            style={[styles.control, radius === value && styles.controlActive]}
          >
            <Text style={styles.controlText}>{`r ${value}`}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#f4efe4",
  },
  stage: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#f4efe4",
  },
  row: {
    position: "absolute",
    left: 12,
    width: WINDOW.width - 24,
    height: 44,
    color: "#1a1d24",
    fontSize: 17,
    fontWeight: "500",
  },
  blob: {
    position: "absolute",
    borderRadius: 999,
  },
  blobA: {
    width: 200,
    height: 200,
    top: 240,
    right: -40,
    backgroundColor: "#ff5d3a",
  },
  blobB: {
    width: 150,
    height: 150,
    top: 560,
    left: -30,
    backgroundColor: "#2f86ff",
  },
  mover: {
    position: "absolute",
    top: 70,
    right: 6,
    width: 22,
    height: 70,
    borderRadius: 11,
    backgroundColor: "#ffd23f",
  },
  topScrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 180,
  },
  bottomScrim: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 260,
  },
  controls: {
    position: "absolute",
    bottom: 40,
    alignSelf: "center",
    flexDirection: "row",
    gap: 10,
  },
  control: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  controlActive: {
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  controlText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
});
