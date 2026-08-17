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
  type SharedValue,
} from "react-native-reanimated";
import type { GlassMetalOptions } from "expo-liquid-glass-view";
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
import type {
  ILiquidGlassTabBarProps,
  ILiquidGlassTabItem,
} from "../../interfaces";
import { useGlassUITheme } from "../../theme";

/**
 * Horizontal movement past this turns the touch into a pill drag; the matching vertical failure
 * leaves vertical gestures to whoever owns them. Taps stay with the tab Pressables — a pan that
 * activates cancels the press underneath it.
 */
const DRAG_SLOP = 5;

/**
 * The reference lights the pill's rim with `Highlight(alpha = pressProgress)`. The base view's
 * rim light idles at 0.25 intensity, so 1.0 while dragged reads as the pill "lighting up"
 * without going HDR.
 */
const PRESSED_PILL_METAL: GlassMetalOptions = { highlight: { intensity: 1 } };

interface IBaseTabProps {
  tab: ILiquidGlassTabItem;
  index: number;
  selected: boolean;
  position: SharedValue<number>;
  color: string;
  labelStyle: ILiquidGlassTabBarProps["labelStyle"];
  onPress: (index: number) => void;
}

/**
 * One inactive tab. Its content fades out as the pill approaches — the accent copy in the reveal
 * window replaces it — so nothing "shines through" the pill on any renderer, including iOS where
 * the window capture would otherwise hand the pill the inactive icon to refract.
 */
const BaseTab: React.FC<IBaseTabProps> = ({
  tab,
  index,
  selected,
  position,
  color,
  labelStyle,
  onPress,
}: IBaseTabProps): React.ReactElement => {
  const fadeStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.abs(position.value - index)),
  }));
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={tab.title ?? tab.key}
      onPress={() => onPress(index)}
      style={styles.tab}
    >
      <Animated.View style={[styles.tabContent, fadeStyle]}>
        {tab.icon?.({ focused: false, color, size: 24 })}
        {tab.title != null ? (
          <Text style={[styles.label, { color }, labelStyle]}>{tab.title}</Text>
        ) : null}
      </Animated.View>
    </Pressable>
  );
};

/**
 * The catalog's `LiquidBottomTabs`:
 *
 * - **Nested layer.** An inner provider records the bar glass, and the pill reads that layer — so
 *   dragging the pill re-refracts the bar's finished glass (stacked glass; on iOS the window
 *   capture gives this for free and the inner provider is a plain View).
 * - **Accent under-glass.** The reference hides an accent-tinted copy of the row and lets only
 *   the pill's backdrop reveal it. Here that is a clip window riding the pill whose content
 *   counter-translates: accent icons through the pill, inactive ones outside, continuously
 *   during the drag — while the inactive copy fades away under the pill.
 * - **Pressed highlight.** The pill's rim light brightens while dragged, the reference's
 *   `Highlight.copy(alpha = progress)`. The pill deliberately does not use the base view's
 *   `interactive` — its native gesture handling fights the drag.
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
  const layerId = `glass-ui-tabs-${useId()}`;

  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
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
      runOnJS(setDragging)(true);
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
      runOnJS(setDragging)(false);
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

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        onLayout={handleLayout}
        style={[{ height }, barStyle, style]}
      >
        {/* The recorded layer: just the bar glass, deliberately without the icons — the pill
            covers the inactive copy instead of refracting it. The provider needs exactly one
            child and it must be a FLOW child (flex, not absolute) — the stack's F37 rule; an
            absolute child never lays out. */}
        <LiquidGlassProvider providerId={layerId} style={StyleSheet.absoluteFill}>
          <View style={styles.fill}>
            <LiquidGlassView
              providerId={providerId}
              cornerRadius={height / 2}
              tint={tint ?? colors.tabBarSurface}
              style={StyleSheet.absoluteFill}
            />
          </View>
        </LiquidGlassProvider>
        <View style={styles.row} pointerEvents="box-none">
          {tabs.map((tab, index) => (
            <BaseTab
              key={tab.key}
              tab={tab}
              index={index}
              selected={index === selectedIndex}
              position={position}
              color={inactive}
              labelStyle={labelStyle}
              onPress={handleTabPress}
            />
          ))}
        </View>
        {tabWidth > 0 ? (
          <>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.indicator,
                { width: tabWidth, height: indicatorHeight },
                indicatorStyle,
              ]}
            >
              <LiquidGlassView
                providerId={layerId}
                cornerRadius={indicatorHeight / 2}
                tint={colors.tabIndicatorSurface}
                metal={dragging ? PRESSED_PILL_METAL : undefined}
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
                <View style={styles.row} pointerEvents="none">
                  {tabs.map((tab) => (
                    <View key={tab.key} style={styles.tab}>
                      <View style={styles.tabContent}>
                        {tab.icon?.({ focused: true, color: accent, size: 24 })}
                        {tab.title != null ? (
                          <Text
                            style={[
                              styles.label,
                              { color: accent },
                              labelStyle,
                            ]}
                          >
                            {tab.title}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
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
  },
  tabContent: {
    alignItems: "center",
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
