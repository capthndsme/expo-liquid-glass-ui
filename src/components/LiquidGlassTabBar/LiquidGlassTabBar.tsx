import * as React from "react";
import { memo, useEffect, useId, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { I18nManager, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { LiquidGlassProvider, LiquidGlassView } from "expo-liquid-glass-view";

import {
  ABSOLUTE_FILL,
  PRESS_SPRING,
  TAB_BAR_HEIGHT,
  TAB_BAR_PADDING,
  TAB_BAR_PRESSED_SCALE,
  TAB_INDICATOR_PRESSED_SCALE,
  TRAVEL_SPRING,
} from "../../constants";
import type { ILiquidGlassTabBarProps } from "../../interfaces";
import { useGlassUITheme } from "../../theme";

/**
 * Horizontal movement past this turns the touch into a pill drag; the matching vertical failure
 * leaves vertical gestures to whoever owns them. Taps stay with the tab Pressables — a pan that
 * activates cancels the press underneath it.
 */
const DRAG_SLOP = 5;

/**
 * The catalog's `LiquidBottomTabs`, all three of its tricks ported:
 *
 * - **Nested layer.** An inner provider records the bar glass *and* the tab row, and the pill
 *   reads that layer — so dragging the pill visibly bends the bar and icons under it (stacked
 *   glass; on iOS the window capture gives this for free and the inner provider is a plain View).
 * - **Interactive pill.** The pill draws over the row (as the reference pill does) and takes
 *   `interactive`, so the platform's own press physics fire on top of the drag spring.
 * - **Accent under-glass.** The reference hides an accent-tinted copy of the row and lets only
 *   the pill's backdrop reveal it. Here that is a sliding clip window riding the pill whose
 *   content counter-translates: through the pill you see the focused-accent icons, outside it the
 *   inactive ones, continuously during the drag.
 */
const LiquidGlassTabBarBase: React.FC<ILiquidGlassTabBarProps> = ({
  tabs,
  selectedIndex,
  onTabSelected,
  accentColor,
  inactiveColor,
  tint,
  height = TAB_BAR_HEIGHT,
  interactive = true,
  providerId,
  style,
  labelStyle,
}: ILiquidGlassTabBarProps): React.ReactElement => {
  const { colors } = useGlassUITheme();
  const accent = accentColor ?? colors.accent;
  const inactive = inactiveColor ?? colors.inactive;
  const count = Math.max(tabs.length, 1);
  const direction = I18nManager.isRTL ? -1 : 1;
  const layerId = `glass-ui-tabs-${useId()}`;

  const [width, setWidth] = useState(0);
  const tabWidth = width > 0 ? (width - TAB_BAR_PADDING * 2) / count : 0;
  const indicatorHeight = height - TAB_BAR_PADDING * 2;

  const position = useSharedValue(selectedIndex);
  const pressProgress = useSharedValue(0);
  const dragStart = useSharedValue(0);

  useEffect(() => {
    position.value = withSpring(selectedIndex, TRAVEL_SPRING);
  }, [position, selectedIndex]);

  const pan = Gesture.Pan()
    .enabled(count > 1)
    .activeOffsetX([-DRAG_SLOP, DRAG_SLOP])
    .failOffsetY([-DRAG_SLOP, DRAG_SLOP])
    .onStart(() => {
      dragStart.value = position.value;
      pressProgress.value = withSpring(1, PRESS_SPRING);
    })
    .onUpdate((event) => {
      if (tabWidth <= 0) return;
      const next =
        dragStart.value + (direction * event.translationX) / tabWidth;
      position.value = Math.min(count - 1, Math.max(0, next));
    })
    .onEnd(() => {
      const target = Math.round(position.value);
      position.value = withSpring(target, TRAVEL_SPRING);
      if (target !== selectedIndex) {
        runOnJS(onTabSelected)(target);
      }
    })
    .onFinalize(() => {
      pressProgress.value = withSpring(0, PRESS_SPRING);
    });

  const barStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: interpolate(
          pressProgress.value,
          [0, 1],
          [1, TAB_BAR_PRESSED_SCALE],
        ),
      },
    ],
  }));
  // Shared by the pill and its reveal window so they stay glued through drag and press.
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: direction * position.value * tabWidth },
      {
        scale: interpolate(
          pressProgress.value,
          [0, 1],
          [1, TAB_INDICATOR_PRESSED_SCALE],
        ),
      },
    ],
  }));
  const revealCounterStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -(direction * position.value * tabWidth) }],
  }));

  const handleLayout = (event: LayoutChangeEvent): void => {
    setWidth(event.nativeEvent.layout.width);
  };

  const handleTabPress = (index: number): void => {
    position.value = withSpring(index, TRAVEL_SPRING);
    if (index !== selectedIndex) {
      onTabSelected(index);
    }
  };

  const renderRow = (focusedCopy: boolean): React.ReactNode => (
    <View style={styles.row} pointerEvents={focusedCopy ? "none" : "box-none"}>
      {tabs.map((tab, index) => {
        const color = focusedCopy ? accent : inactive;
        const content = (
          <>
            {tab.icon?.({ focused: focusedCopy, color, size: 24 })}
            {tab.title != null ? (
              <Text style={[styles.label, { color }, labelStyle]}>
                {tab.title}
              </Text>
            ) : null}
          </>
        );
        if (focusedCopy) {
          return (
            <View key={tab.key} style={styles.tab}>
              {content}
            </View>
          );
        }
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: index === selectedIndex }}
            accessibilityLabel={tab.title ?? tab.key}
            onPress={() => handleTabPress(index)}
            style={styles.tab}
          >
            {content}
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        onLayout={handleLayout}
        style={[{ height }, barStyle, style]}
      >
        {/* The recorded layer: bar glass (reading the screen provider) plus the inactive row.
            One direct child — the provider lays out only its first. */}
        <LiquidGlassProvider providerId={layerId} style={StyleSheet.absoluteFill}>
          <View style={styles.fill}>
            <LiquidGlassView
              providerId={providerId}
              cornerRadius={height / 2}
              tint={tint ?? colors.tabBarSurface}
              style={StyleSheet.absoluteFill}
            />
            {renderRow(false)}
          </View>
        </LiquidGlassProvider>
        {tabWidth > 0 ? (
          <>
            <Animated.View
              pointerEvents={interactive ? "auto" : "none"}
              style={[
                styles.indicator,
                { width: tabWidth, height: indicatorHeight },
                indicatorStyle,
              ]}
            >
              <LiquidGlassView
                providerId={layerId}
                interactive={interactive}
                cornerRadius={indicatorHeight / 2}
                tint={colors.tabIndicatorSurface}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.indicator,
                styles.revealWindow,
                {
                  width: tabWidth,
                  height: indicatorHeight,
                  borderRadius: indicatorHeight / 2,
                },
                indicatorStyle,
              ]}
            >
              <Animated.View
                style={[
                  styles.revealContent,
                  { width, height },
                  revealCounterStyle,
                ]}
              >
                {renderRow(true)}
              </Animated.View>
            </Animated.View>
          </>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  indicator: {
    position: "absolute",
    start: TAB_BAR_PADDING,
    top: TAB_BAR_PADDING,
  },
  revealWindow: {
    overflow: "hidden",
  },
  revealContent: {
    position: "absolute",
    top: -TAB_BAR_PADDING,
    start: -TAB_BAR_PADDING,
  },
  row: {
    ...ABSOLUTE_FILL,
    flexDirection: "row",
    paddingHorizontal: TAB_BAR_PADDING,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  label: {
    fontSize: 11,
    fontWeight: "500",
  },
});

const LiquidGlassTabBar: React.NamedExoticComponent<ILiquidGlassTabBarProps> =
  memo<ILiquidGlassTabBarProps>(LiquidGlassTabBarBase);
LiquidGlassTabBar.displayName = "LiquidGlassTabBar";

export { LiquidGlassTabBar };
