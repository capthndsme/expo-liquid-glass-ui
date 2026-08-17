import * as React from "react";
import { memo, useCallback, useMemo } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import Animated, {
  interpolate,
  useAnimatedStyle,
} from "react-native-reanimated";
import { LiquidGlassView } from "expo-liquid-glass-view";

import { BUTTON_HEIGHT, BUTTON_PRESS_GROWTH } from "../../constants";
import { usePressProgress } from "../../hooks";
import type { ILiquidGlassButtonProps } from "../../interfaces";
import { useGlassUITheme } from "../../theme";

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
