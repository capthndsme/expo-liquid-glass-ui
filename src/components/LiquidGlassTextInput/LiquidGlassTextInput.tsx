import * as React from "react";
import { forwardRef, memo, useCallback } from "react";
import type { TextInputProps } from "react-native";
import { StyleSheet, TextInput, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { LiquidGlassView } from "expo-liquid-glass-view";

import {
  ABSOLUTE_FILL,
  PRESS_SPRING,
  TEXT_INPUT_HEIGHT,
} from "../../constants";
import type { ILiquidGlassTextInputProps } from "../../interfaces";
import { useGlassUITheme } from "../../theme";

/**
 * A capsule glass text field in the style of the other controls — there is no direct catalog
 * reference for this one, so it borrows the button's geometry (48pt capsule, 16pt side padding)
 * and signals focus with an accent ring that springs in over the glass edge.
 */
const LiquidGlassTextInputBase = forwardRef<
  TextInput,
  ILiquidGlassTextInputProps
>(function LiquidGlassTextInputBase(
  {
    height = TEXT_INPUT_HEIGHT,
    tint,
    variant,
    interactive = true,
    providerId,
    leading,
    trailing,
    focusRing = true,
    accentColor,
    style,
    contentStyle,
    inputStyle,
    placeholderTextColor,
    onFocus,
    onBlur,
    ...inputProps
  }: ILiquidGlassTextInputProps,
  ref,
): React.ReactElement {
  const { colors } = useGlassUITheme();
  const ringProgress = useSharedValue(0);

  const animateRing = useCallback(
    (toValue: number): void => {
      ringProgress.value = withSpring(toValue, PRESS_SPRING);
    },
    [ringProgress],
  );

  const ringStyle = useAnimatedStyle(() => ({
    opacity: ringProgress.value,
  }));

  const handleFocus = useCallback(
    (event: Parameters<NonNullable<TextInputProps["onFocus"]>>[0]): void => {
      if (focusRing) animateRing(1);
      onFocus?.(event);
    },
    [focusRing, animateRing, onFocus],
  );
  const handleBlur = useCallback(
    (event: Parameters<NonNullable<TextInputProps["onBlur"]>>[0]): void => {
      animateRing(0);
      onBlur?.(event);
    },
    [animateRing, onBlur],
  );

  return (
    <LiquidGlassView
      variant={variant}
      providerId={providerId}
      interactive={interactive}
      cornerRadius={height / 2}
      // Explicit, though it is also the native default, and at a full-capsule radius the
      // continuous family and the circular one coincide anyway — every other surface in the kit
      // states it, so this one should not be the odd one out.
      cornerStyle="continuous"
      tint={tint}
      style={[{ height }, styles.frame, style]}
      containerStyle={styles.fill}
    >
      {focusRing ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              borderRadius: height / 2,
              borderColor: accentColor ?? colors.accent,
            },
            ringStyle,
          ]}
        />
      ) : null}
      <View style={[styles.row, contentStyle]}>
        {leading}
        <TextInput
          ref={ref}
          {...inputProps}
          placeholderTextColor={placeholderTextColor ?? colors.placeholder}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={[styles.input, { color: colors.label }, inputStyle]}
        />
        {trailing}
      </View>
    </LiquidGlassView>
  );
});

const styles = StyleSheet.create({
  frame: {
    alignSelf: "stretch",
  },
  fill: {
    flex: 1,
  },
  ring: {
    ...ABSOLUTE_FILL,
    borderWidth: 1.5,
  },
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 17,
    paddingVertical: 0,
    textAlignVertical: "center",
    includeFontPadding: false,
  },
});

const LiquidGlassTextInput = memo(LiquidGlassTextInputBase);
LiquidGlassTextInput.displayName = "LiquidGlassTextInput";

export { LiquidGlassTextInput };
