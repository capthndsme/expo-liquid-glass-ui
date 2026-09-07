import * as React from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import {
  BUTTON_SIZES,
  GLASS_TOAST_METAL,
  GLOW_SPRING,
  TOAST_DURATION_MS,
  TOAST_EDGE_OFFSET,
  TOAST_HEIGHT,
  TOAST_PADDING_HORIZONTAL,
  TOAST_TRAVEL,
  VALUE_SPRING,
} from "../../constants";
import { LiquidGlassView } from "../../core";
import type { ILiquidGlassToastProps } from "../../interfaces";
import { useGlassUITheme } from "../../theme";

/**
 * A glass capsule that drops in from an edge with a message, waits, and leaves — the button's
 * glass under the bar's wash, on the button's bouncy spring in and the critically damped one
 * out. Controlled: the app owns `visible` and hears `onDismiss` when the toast has waited long
 * enough or been tapped; it stays mounted through its exit so the spring finishes.
 *
 * Positioned absolutely against its parent — render it last, above everything, as a sibling of
 * the provider on Android.
 */
const LiquidGlassToastBase: React.FC<ILiquidGlassToastProps> = ({
  visible,
  message,
  icon,
  onDismiss,
  duration = TOAST_DURATION_MS,
  edge = "top",
  offset = TOAST_EDGE_OFFSET,
  tint,
  variant,
  metal,
  providerId,
  style,
  textStyle,
}: ILiquidGlassToastProps): React.ReactElement | null => {
  const { colors } = useGlassUITheme();
  // Mounted while visible, and through the exit after that — the spring's completion unmounts.
  const [rendered, setRendered] = useState(visible);
  if (visible && !rendered) setRendered(true);
  const shown = useSharedValue(visible ? 1 : 0);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  const unmount = useCallback((): void => setRendered(false), []);

  useEffect(() => {
    if (visible) {
      shown.value = withSpring(1, GLOW_SPRING);
      return;
    }
    shown.value = withSpring(0, VALUE_SPRING, (finished) => {
      if (finished) runOnJS(unmount)();
    });
  }, [shown, unmount, visible]);

  useEffect(() => {
    if (!visible || duration <= 0) return undefined;
    const timer = setTimeout(() => dismissRef.current?.(), duration);
    return () => clearTimeout(timer);
  }, [duration, visible]);

  const travel = TOAST_HEIGHT + TOAST_TRAVEL + offset;
  const sign = edge === "top" ? -1 : 1;
  const moveStyle = useAnimatedStyle(() => {
    const s = shown.value;
    const clamped = Math.min(1, Math.max(0, s));
    return {
      opacity: clamped,
      transform: [
        { translateY: sign * (1 - s) * travel },
        { scale: 0.9 + 0.1 * clamped },
      ],
    };
  });

  if (!rendered) return null;

  const iconNode =
    typeof icon === "function"
      ? icon({ color: colors.label, size: BUTTON_SIZES.small.iconSize })
      : icon;

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.host,
        edge === "top" ? { top: offset } : { bottom: offset },
        style,
      ]}
    >
      <Animated.View style={moveStyle}>
        <Pressable
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          onPress={() => dismissRef.current?.()}
        >
          <LiquidGlassView
            variant={variant}
            providerId={providerId}
            cornerRadius={TOAST_HEIGHT / 2}
            cornerStyle="continuous"
            tint={tint ?? colors.tabBarSurface}
            metal={metal ?? GLASS_TOAST_METAL}
            style={styles.glass}
            containerStyle={styles.content}
          >
            {iconNode}
            <Text
              numberOfLines={2}
              style={[styles.label, { color: colors.label }, textStyle]}
            >
              {message}
            </Text>
          </LiquidGlassView>
        </Pressable>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: 16,
    right: 16,
    alignItems: "center",
  },
  glass: {
    minHeight: TOAST_HEIGHT,
    maxWidth: "100%",
  },
  content: {
    minHeight: TOAST_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: TOAST_PADDING_HORIZONTAL,
    paddingVertical: 8,
    gap: 8,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    flexShrink: 1,
  },
});

const LiquidGlassToast: React.NamedExoticComponent<ILiquidGlassToastProps> =
  memo<ILiquidGlassToastProps>(LiquidGlassToastBase);
LiquidGlassToast.displayName = "LiquidGlassToast";

export { LiquidGlassToast };
