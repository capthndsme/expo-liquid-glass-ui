import * as React from "react";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { LayoutChangeEvent } from "react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import {
  GLASS_BAR_METAL,
  GLASS_THUMB_METAL,
  GLOW_SPRING,
  SEGMENTED_INSET,
  STEPPER_CELL_WIDTH,
  STEPPER_HEIGHT,
  STEPPER_REPEAT_DELAY_MS,
  STEPPER_REPEAT_INTERVAL_MS,
  STEPPER_VALUE_MIN_WIDTH,
  STEPPER_VALUE_POP_SCALE,
} from "../../constants";
import type { GlassMetalOptions } from "../../core";
import { LiquidGlassView } from "../../core";
import { usePressProgress } from "../../hooks";
import type { ILiquidGlassStepperProps } from "../../interfaces";
import { useGlassUITheme } from "../../theme";

const AnimatedGlassView = Animated.createAnimatedComponent(LiquidGlassView);

/**
 * The system stepper in glass: a capsule track with `−` and `+` ends around the value. Pressing
 * an end blooms a glass thumb over it — the segmented control's canvas thumb, lit by the press —
 * and the value pops as it changes. Hold an end and it keeps stepping, the way the system's
 * does. The track samples the backdrop; the thumb is the wash-lifted chip over it.
 */
const LiquidGlassStepperBase: React.FC<ILiquidGlassStepperProps> = ({
  value,
  onValueChange,
  minimumValue = 0,
  maximumValue = 100,
  step = 1,
  disabled = false,
  autoRepeat = true,
  formatValue,
  height = STEPPER_HEIGHT,
  tint,
  thumbTint,
  thumbMetal,
  providerId,
  style,
  textStyle,
}: ILiquidGlassStepperProps): React.ReactElement => {
  const { colors } = useGlassUITheme();
  const press = usePressProgress(GLOW_SPRING);
  /** -1 while the minus end is held, +1 for plus, 0 at rest. */
  const side = useSharedValue(0);
  const pop = useSharedValue(1);
  const trackWidth = useSharedValue(0);

  const valueRef = useRef(value);
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const firstValue = useRef(true);

  useEffect(() => {
    valueRef.current = value;
    if (firstValue.current) {
      firstValue.current = false;
      return;
    }
    // A change pops the number: an immediate lift, then the bouncy spring home.
    pop.value = STEPPER_VALUE_POP_SCALE;
    pop.value = withSpring(1, GLOW_SPRING);
  }, [pop, value]);

  const atMin = value <= minimumValue;
  const atMax = value >= maximumValue;

  const stepBy = useCallback(
    (direction: -1 | 1): void => {
      const next = Math.min(
        maximumValue,
        Math.max(minimumValue, valueRef.current + direction * step)
      );
      if (next === valueRef.current) return;
      valueRef.current = next;
      onValueChange(next);
    },
    [maximumValue, minimumValue, onValueChange, step]
  );

  const stopRepeat = useCallback((): void => {
    if (repeatTimer.current != null) {
      clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    }
  }, []);

  useEffect(() => stopRepeat, [stopRepeat]);

  const handlePressIn = useCallback(
    (direction: -1 | 1): void => {
      side.value = direction;
      press.pressIn();
    },
    [press, side]
  );
  const handlePressOut = useCallback((): void => {
    press.pressOut();
    stopRepeat();
  }, [press, stopRepeat]);
  const handleLongPress = useCallback(
    (direction: -1 | 1): void => {
      if (!autoRepeat) return;
      stepBy(direction);
      stopRepeat();
      repeatTimer.current = setInterval(
        () => stepBy(direction),
        STEPPER_REPEAT_INTERVAL_MS
      );
    },
    [autoRepeat, stepBy, stopRepeat]
  );

  const handleLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      trackWidth.value = event.nativeEvent.layout.width;
    },
    [trackWidth]
  );

  const baseThumbMetal = useMemo<GlassMetalOptions>(
    () => ({
      ...(thumbMetal ?? GLASS_THUMB_METAL),
      border: { width: 0, opacity: 0 },
    }),
    [thumbMetal]
  );

  // The thumb over the held end: the cell, inset by the segmented control's 3dp from the track's
  // edge, and lit by the press at the cell's centre.
  const thumbProps = useAnimatedProps(() => {
    const w = trackWidth.value;
    const s = side.value;
    if (w <= 0 || s === 0) {
      return {
        metal: {
          ...baseThumbMetal,
          shape: { x: 0, y: 0, width: 0.01, height: 0.01 },
        },
        glow: { progress: 0, x: 0, y: 0, lens: false },
      };
    }
    const cellW = STEPPER_CELL_WIDTH - SEGMENTED_INSET;
    const x = s < 0 ? SEGMENTED_INSET : w - SEGMENTED_INSET - cellW;
    const shape = {
      x,
      y: SEGMENTED_INSET,
      width: cellW,
      height: height - 2 * SEGMENTED_INSET,
    };
    return {
      metal: { ...baseThumbMetal, shape },
      glow: {
        progress: Math.min(1, Math.max(0, press.progress.value)),
        x: x + cellW / 2,
        y: height / 2,
        lens: false,
      },
    };
  });

  const thumbFade = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, press.progress.value)),
  }));
  const popStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pop.value }],
  }));

  const label = formatValue != null ? formatValue(value) : String(value);
  const glyphColor = colors.label;

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityValue={{
        min: minimumValue,
        max: maximumValue,
        now: value,
        text: label,
      }}
      accessibilityState={{ disabled }}
      onLayout={handleLayout}
      style={[
        styles.root,
        { height },
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      <LiquidGlassView
        providerId={providerId}
        cornerRadius={height / 2}
        cornerStyle="continuous"
        tint={tint ?? colors.tabBarSurface}
        metal={GLASS_BAR_METAL}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, thumbFade]}
      >
        <AnimatedGlassView
          renderer="metal"
          providerId={providerId}
          cornerRadius={(height - 2 * SEGMENTED_INSET) / 2}
          cornerStyle="continuous"
          tint={thumbTint ?? colors.tabIndicatorSurface}
          animatedProps={thumbProps}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Decrement"
        disabled={disabled || atMin}
        delayLongPress={STEPPER_REPEAT_DELAY_MS}
        onPressIn={() => handlePressIn(-1)}
        onPressOut={handlePressOut}
        onPress={() => stepBy(-1)}
        onLongPress={() => handleLongPress(-1)}
        style={styles.cell}
      >
        <Text
          style={[
            styles.glyph,
            { color: glyphColor },
            atMin ? styles.glyphDim : null,
          ]}
        >
          −
        </Text>
      </Pressable>
      <Animated.View style={[styles.value, popStyle]}>
        <Text
          numberOfLines={1}
          style={[styles.valueText, { color: colors.label }, textStyle]}
        >
          {label}
        </Text>
      </Animated.View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Increment"
        disabled={disabled || atMax}
        delayLongPress={STEPPER_REPEAT_DELAY_MS}
        onPressIn={() => handlePressIn(1)}
        onPressOut={handlePressOut}
        onPress={() => stepBy(1)}
        onLongPress={() => handleLongPress(1)}
        style={styles.cell}
      >
        <Text
          style={[
            styles.glyph,
            { color: glyphColor },
            atMax ? styles.glyphDim : null,
          ]}
        >
          +
        </Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  // The cells lay out in normal flow so the capsule takes its width from them; the glass
  // layers are absolute underneath. (Absolute cells left the root 0 wide and the track invisible.)
  root: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "stretch",
  },
  disabled: {
    opacity: 0.5,
  },
  cell: {
    width: STEPPER_CELL_WIDTH,
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: {
    fontSize: 20,
    fontWeight: "500",
    includeFontPadding: false,
  },
  glyphDim: {
    opacity: 0.35,
  },
  value: {
    minWidth: STEPPER_VALUE_MIN_WIDTH,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  valueText: {
    fontSize: 16,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    includeFontPadding: false,
  },
});

const LiquidGlassStepper: React.NamedExoticComponent<ILiquidGlassStepperProps> =
  memo<ILiquidGlassStepperProps>(LiquidGlassStepperBase);
LiquidGlassStepper.displayName = "LiquidGlassStepper";

export { LiquidGlassStepper };
