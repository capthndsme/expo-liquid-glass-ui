import * as React from "react";
import { memo } from "react";
import { Pressable, StyleSheet } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import {
  CARD_CORNER_RADIUS,
  CARD_PADDING,
  CARD_PRESSED_SCALE,
  GLASS_PANEL_METAL,
  GLOW_SPRING,
} from "../../constants";
import { LiquidGlassView } from "../../core";
import { useAdaptiveGlass, usePressProgress } from "../../hooks";
import type { ILiquidGlassCardProps } from "../../interfaces";
import { useGlassUITheme } from "../../theme";

/**
 * A pane of glass to put things on: the bar's material under a scheme wash, a continuous 24dp
 * corner, 16dp of padding. Give it an `onPress` and it becomes a control — pressing it to 98%
 * on the button's spring — otherwise it is a surface and touches pass to its children.
 *
 * `adaptive` flips the frost with the backdrop; the content is yours to dress (pair with
 * `useAdaptiveGlass`), since a card's children are anything.
 */
const LiquidGlassCardBase: React.FC<ILiquidGlassCardProps> = ({
  onPress,
  onLongPress,
  disabled = false,
  cornerRadius = CARD_CORNER_RADIUS,
  padding = CARD_PADDING,
  adaptive = false,
  tint,
  variant,
  metal,
  providerId,
  accessibilityLabel,
  style,
  contentStyle,
  children,
}: ILiquidGlassCardProps): React.ReactElement => {
  const adaptiveGlass = useAdaptiveGlass();
  const { colors } = useGlassUITheme(
    adaptive ? adaptiveGlass.scheme : undefined
  );
  const { progress, pressIn, pressOut } = usePressProgress(GLOW_SPRING);
  const pressable = onPress != null || onLongPress != null;

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - CARD_PRESSED_SCALE) * progress.value }],
  }));

  const glass = (
    <LiquidGlassView
      variant={variant}
      providerId={providerId}
      cornerRadius={cornerRadius}
      cornerStyle="continuous"
      tint={tint ?? colors.tabBarSurface}
      metal={metal ?? GLASS_PANEL_METAL}
      {...(adaptive ? adaptiveGlass.glassProps : null)}
      style={pressable ? undefined : style}
      containerStyle={[{ padding }, contentStyle]}
    >
      {children}
    </LiquidGlassView>
  );

  if (!pressable) return glass;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      style={[disabled ? styles.disabled : null, style]}
    >
      <Animated.View style={pressStyle}>{glass}</Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  disabled: {
    opacity: 0.5,
  },
});

const LiquidGlassCard: React.NamedExoticComponent<ILiquidGlassCardProps> =
  memo<ILiquidGlassCardProps>(LiquidGlassCardBase);
LiquidGlassCard.displayName = "LiquidGlassCard";

export { LiquidGlassCard };
