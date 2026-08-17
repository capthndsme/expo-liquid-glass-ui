import * as React from "react";
import { memo, useCallback, useMemo } from "react";
import type { LayoutChangeEvent } from "react-native";
import { Pressable, StyleSheet, Text } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { LiquidGlassView } from "expo-liquid-glass-view";

import {
  BUTTON_HEIGHT,
  BUTTON_PRESS_GROWTH,
  PRESS_SPRING,
} from "../../constants";
import { usePressProgress } from "../../hooks";
import type { ILiquidGlassButtonProps } from "../../interfaces";
import { useGlassUITheme } from "../../theme";

/**
 * The reference `InteractiveHighlight`'s initial derivative: at small offsets the button follows
 * 5% of the finger's travel, saturating (tanh) at one min-dimension of translation.
 */
const FOLLOW_DERIVATIVE = 0.05;

const LiquidGlassButtonBase: React.FC<ILiquidGlassButtonProps> = ({
  onPress,
  onLongPress,
  disabled = false,
  interactive = true,
  tint,
  variant,
  providerId,
  height = BUTTON_HEIGHT,
  style,
  contentStyle,
  textStyle,
  children,
}: ILiquidGlassButtonProps): React.ReactElement => {
  const { colors } = useGlassUITheme();
  const { progress, pressIn, pressOut } = usePressProgress();

  // The grow-on-press spring runs here on every renderer. The native `interactive` physics only
  // fire when the glass itself owns the touch, and under a Pressable it never does — relying on
  // it renderer-by-renderer left the button dead on the tiers that report native support.
  const jsPress = interactive && !disabled;

  const handlePressIn = useCallback((): void => {
    if (jsPress) pressIn();
  }, [jsPress, pressIn]);
  const handlePressOut = useCallback((): void => {
    if (jsPress) pressOut();
  }, [jsPress, pressOut]);

  // The reference's jelly: while pressed, the button rubber-bands toward the finger and
  // stretches along the drag axis. A Manual gesture observes the touch stream without ever
  // activating, so it can neither steal a scroll nor cancel the Pressable underneath.
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
          offsetX.value = withSpring(0, PRESS_SPRING);
          offsetY.value = withSpring(0, PRESS_SPRING);
        })
        .onTouchesCancelled(() => {
          offsetX.value = withSpring(0, PRESS_SPRING);
          offsetY.value = withSpring(0, PRESS_SPRING);
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
    const tx = minDim * Math.tanh((FOLLOW_DERIVATIVE * ox) / minDim);
    const ty = minDim * Math.tanh((FOLLOW_DERIVATIVE * oy) / minDim);

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
            interactive={interactive && !disabled}
            cornerRadius={height / 2}
            tint={tint}
            style={{ height }}
            containerStyle={[styles.content, { height }, contentStyle]}
          >
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
    paddingHorizontal: 16,
    gap: 8,
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
