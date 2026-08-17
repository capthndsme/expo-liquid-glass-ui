import * as React from "react";
import { memo, useEffect, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { I18nManager, Pressable, StyleSheet, Text } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { LiquidGlassView } from "expo-liquid-glass-view";

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
 * The catalog's `LiquidBottomTabs`: a capsule glass bar with a glass indicator pill that springs
 * between tabs. Tap a tab to select it, or drag horizontally anywhere on the bar to slide the
 * pill — it scales up while held (the reference's 78/56), grows the bar a touch, and snaps to
 * the nearest tab on release. Gestures and springs are Reanimated worklets: no JS per frame.
 *
 * The indicator sits *under* the tab content, so icons stay crisp and pressable on every
 * renderer; selection is communicated by the pill plus the accent tint on the focused item.
 */
const LiquidGlassTabBarBase: React.FC<ILiquidGlassTabBarProps> = ({
  tabs,
  selectedIndex,
  onTabSelected,
  accentColor,
  inactiveColor,
  tint,
  height = TAB_BAR_HEIGHT,
  providerId,
  style,
  labelStyle,
}: ILiquidGlassTabBarProps): React.ReactElement => {
  const { colors } = useGlassUITheme();
  const accent = accentColor ?? colors.accent;
  const inactive = inactiveColor ?? colors.inactive;
  const count = Math.max(tabs.length, 1);
  const direction = I18nManager.isRTL ? -1 : 1;

  const [width, setWidth] = useState(0);
  const tabWidth = width > 0 ? (width - TAB_BAR_PADDING * 2) / count : 0;

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

  const handleLayout = (event: LayoutChangeEvent): void => {
    setWidth(event.nativeEvent.layout.width);
  };

  const handleTabPress = (index: number): void => {
    position.value = withSpring(index, TRAVEL_SPRING);
    if (index !== selectedIndex) {
      onTabSelected(index);
    }
  };

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        onLayout={handleLayout}
        style={[{ height }, barStyle, style]}
      >
        <LiquidGlassView
          providerId={providerId}
          cornerRadius={height / 2}
          tint={tint ?? colors.tabBarSurface}
          style={StyleSheet.absoluteFill}
        />
        {tabWidth > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.indicator,
              {
                width: tabWidth,
                height: height - TAB_BAR_PADDING * 2,
              },
              indicatorStyle,
            ]}
          >
            <LiquidGlassView
              providerId={providerId}
              cornerRadius={(height - TAB_BAR_PADDING * 2) / 2}
              tint={colors.tabIndicatorSurface}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        ) : null}
        <Animated.View style={styles.row} pointerEvents="box-none">
          {tabs.map((tab, index) => {
            const focused = index === selectedIndex;
            const color = focused ? accent : inactive;
            return (
              <Pressable
                key={tab.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={tab.title ?? tab.key}
                onPress={() => handleTabPress(index)}
                style={styles.tab}
              >
                {tab.icon?.({ focused, color, size: 24 })}
                {tab.title != null ? (
                  <Text style={[styles.label, { color }, labelStyle]}>
                    {tab.title}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  indicator: {
    position: "absolute",
    start: TAB_BAR_PADDING,
    top: TAB_BAR_PADDING,
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
