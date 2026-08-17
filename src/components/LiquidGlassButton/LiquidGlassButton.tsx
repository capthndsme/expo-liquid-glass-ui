import * as React from "react";
import { memo, useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import Animated, {
  interpolate,
  useAnimatedStyle,
} from "react-native-reanimated";
import type { GlassActiveRenderer } from "expo-liquid-glass-view";
import { LiquidGlassView } from "expo-liquid-glass-view";

import { BUTTON_HEIGHT, BUTTON_PRESS_GROWTH } from "../../constants";
import { usePressProgress } from "../../hooks";
import type { ILiquidGlassButtonProps } from "../../interfaces";
import { useGlassUITheme } from "../../theme";

/**
 * Renderers whose press response already lives in native code — `UIGlassEffect.isInteractive` on
 * iOS 26+, the AGSL port's spring stage on Android 13+. Everything else (iOS Metal, the Android
 * fallback tiers) gets the JS spring below instead, so a press reads the same everywhere.
 */
const NATIVE_PRESS_RENDERERS: ReadonlySet<GlassActiveRenderer> = new Set([
  "native",
  "agsl",
]);

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
  const [renderer, setRenderer] = useState<GlassActiveRenderer | null>(null);
  const { progress, pressIn, pressOut } = usePressProgress();

  const nativePress = renderer !== null && NATIVE_PRESS_RENDERERS.has(renderer);
  const jsPress = interactive && !disabled && !nativePress;

  const handlePressIn = useCallback((): void => {
    if (jsPress) pressIn();
  }, [jsPress, pressIn]);
  const handlePressOut = useCallback((): void => {
    if (jsPress) pressOut();
  }, [jsPress, pressOut]);

  const pressStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: interpolate(
          progress.value,
          [0, 1],
          [1, 1 + BUTTON_PRESS_GROWTH / height],
        ),
      },
    ],
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
      <Animated.View style={[pressStyle, style]}>
        <LiquidGlassView
          variant={variant}
          providerId={providerId}
          interactive={interactive && !disabled}
          cornerRadius={height / 2}
          tint={tint}
          style={{ height }}
          containerStyle={[styles.content, { height }, contentStyle]}
          onRendererChange={setRenderer}
        >
          {content}
        </LiquidGlassView>
      </Animated.View>
    </Pressable>
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
