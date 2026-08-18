import * as React from "react";
import { memo, useCallback, useMemo } from "react";
import type { LayoutChangeEvent } from "react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { LiquidGlassView } from "expo-liquid-glass-view";

import {
  ABSOLUTE_FILL,
  BUTTON_CONTENT_GAP,
  BUTTON_FOLLOW_DERIVATIVE,
  BUTTON_HEIGHT,
  BUTTON_PADDING_HORIZONTAL,
  BUTTON_PRESS_GROWTH,
  GLASS_BUTTON_METAL,
  GLOW_SPRING,
} from "../../constants";
import { usePressProgress } from "../../hooks";
import type { ILiquidGlassButtonProps } from "../../interfaces";
import { useGlassUITheme } from "../../theme";

/**
 * The reference lights a pressed button with two additive passes: a flat `White a0.08 * p` and a
 * finger-centred radial `White a0.15 * p` over `1.5 x minDimension`. React Native has no additive
 * blend and no radial gradient, and the base view's touch-glow uniforms are driven only by real
 * `MotionEvent`s — there is no prop or worklet entry point.
 *
 * So this uses the reference's *own* declared fallback for devices without runtime shaders: a
 * single flat `White a0.25 * p`. A degraded path from the source, not a guess.
 */
const GLOW_ALPHA = 0.25;

const LiquidGlassButtonBase: React.FC<ILiquidGlassButtonProps> = ({
  onPress,
  onLongPress,
  disabled = false,
  interactive = true,
  tint,
  variant,
  metal,
  providerId,
  height = BUTTON_HEIGHT,
  style,
  contentStyle,
  textStyle,
  children,
}: ILiquidGlassButtonProps): React.ReactElement => {
  const { colors } = useGlassUITheme();
  const { progress, pressIn, pressOut } = usePressProgress(GLOW_SPRING);

  const jsPress = interactive && !disabled;

  const handlePressIn = useCallback((): void => {
    if (jsPress) pressIn();
  }, [jsPress, pressIn]);
  const handlePressOut = useCallback((): void => {
    if (jsPress) pressOut();
  }, [jsPress, pressOut]);

  // The reference's jelly: while pressed, the button rubber-bands toward the finger and stretches
  // along the drag axis. A Manual gesture observes the touch stream without ever activating, so it
  // can neither steal a scroll nor cancel the Pressable underneath.
  const layoutWidth = useSharedValue(0);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      layoutWidth.value = event.nativeEvent.layout.width;
    },
    [layoutWidth],
  );

  const jelly = useMemo(
    () =>
      Gesture.Manual()
        .enabled(jsPress)
        .onTouchesDown((event) => {
          const touch = event.allTouches[0];
          if (touch == null) return;
          startX.value = touch.absoluteX;
          startY.value = touch.absoluteY;
        })
        .onTouchesMove((event) => {
          const touch = event.allTouches[0];
          if (touch == null) return;
          offsetX.value = touch.absoluteX - startX.value;
          offsetY.value = touch.absoluteY - startY.value;
        })
        .onTouchesUp(() => {
          offsetX.value = withSpring(0, GLOW_SPRING);
          offsetY.value = withSpring(0, GLOW_SPRING);
        })
        .onTouchesCancelled(() => {
          offsetX.value = withSpring(0, GLOW_SPRING);
          offsetY.value = withSpring(0, GLOW_SPRING);
        }),
    [jsPress, startX, startY, offsetX, offsetY],
  );

  const pressStyle = useAnimatedStyle(() => {
    const w = Math.max(layoutWidth.value, 1);
    const h = height;
    const minDim = Math.min(w, h);
    const maxDim = Math.max(w, h);
    const scale = 1 + (BUTTON_PRESS_GROWTH / h) * progress.value;

    const ox = offsetX.value;
    const oy = offsetY.value;
    // Slope 0.05 near zero, saturating at one min-dimension of travel.
    const tx = minDim * Math.tanh((BUTTON_FOLLOW_DERIVATIVE * ox) / minDim);
    const ty = minDim * Math.tanh((BUTTON_FOLLOW_DERIVATIVE * oy) / minDim);

    // On a wide button X takes full weight and Y is attenuated by h/w, so it spreads along the
    // drag axis instead of ballooning.
    const angle = Math.atan2(oy, ox);
    const maxDragScale = BUTTON_PRESS_GROWTH / h;
    const sx =
      scale +
      maxDragScale *
        Math.abs((Math.cos(angle) * ox) / maxDim) *
        Math.min(w / h, 1);
    const sy =
      scale +
      maxDragScale *
        Math.abs((Math.sin(angle) * oy) / maxDim) *
        Math.min(h / w, 1);

    return {
      transform: [
        { translateX: tx },
        { translateY: ty },
        { scaleX: sx },
        { scaleY: sy },
      ],
    };
  });

  const glowStyle = useAnimatedStyle(() => ({
    opacity: GLOW_ALPHA * progress.value,
  }));

  const content: React.ReactNode = useMemo(
    () =>
      React.Children.map(children, (child) =>
        typeof child === "string" || typeof child === "number" ? (
          <Text
            style={[
              styles.label,
              { color: tint != null ? "#FFFFFF" : colors.label },
              textStyle,
            ]}
          >
            {child}
          </Text>
        ) : (
          child
        ),
      ),
    [children, tint, colors.label, textStyle],
  );

  return (
    <GestureDetector gesture={jelly}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={disabled ? styles.disabled : undefined}
      >
        <Animated.View onLayout={handleLayout} style={[pressStyle, style]}>
          <LiquidGlassView
            variant={variant}
            providerId={providerId}
            // The base view's own `interactive` is deliberately not used. Its press animator
            // read-modify-writes scaleX/scaleY/translationX/translationY — the exact properties
            // React Native's `transform` style writes — so it would fight the springs above, and
            // its geometry is its own (1.035x, tanh slope 0.12) rather than the reference's.
            cornerRadius={height / 2}
            cornerStyle="continuous"
            tint={tint}
            metal={metal ?? GLASS_BUTTON_METAL}
            style={{ height }}
            containerStyle={[styles.content, { height }, contentStyle]}
          >
            {/* Absolute, so it washes the glass without disturbing the content row, and first,
                so the label stays legible on top of it. */}
            <Animated.View
              pointerEvents="none"
              style={[styles.glow, glowStyle]}
            />
            {content}
          </LiquidGlassView>
        </Animated.View>
      </Pressable>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: BUTTON_PADDING_HORIZONTAL,
    gap: BUTTON_CONTENT_GAP,
  },
  glow: {
    ...ABSOLUTE_FILL,
    backgroundColor: "#FFFFFF",
  },
  label: {
    fontSize: 17,
    fontWeight: "600",
  },
  disabled: {
    opacity: 0.5,
  },
});

const LiquidGlassButton: React.NamedExoticComponent<ILiquidGlassButtonProps> =
  memo<ILiquidGlassButtonProps>(LiquidGlassButtonBase);
LiquidGlassButton.displayName = "LiquidGlassButton";

export { LiquidGlassButton };
