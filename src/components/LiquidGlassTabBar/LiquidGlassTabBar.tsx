import * as React from "react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import {
  Animated,
  I18nManager,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
} from "react-native";
import { LiquidGlassView } from "expo-liquid-glass-view";

import {
  ABSOLUTE_FILL,
  TAB_BAR_HEIGHT,
  TAB_BAR_PADDING,
  TAB_BAR_PRESSED_SCALE,
  TAB_INDICATOR_PRESSED_SCALE,
} from "../../constants";
import type { ILiquidGlassTabBarProps } from "../../interfaces";
import { useGlassUITheme } from "../../theme";

/** Movement past this many dp counts as a drag; anything shorter reads as a tap. */
const DRAG_THRESHOLD = 2;

const spring = (
  value: Animated.Value,
  toValue: number,
  native: boolean,
): void => {
  Animated.spring(value, {
    toValue,
    stiffness: 300,
    damping: 28,
    mass: 1,
    useNativeDriver: native,
  }).start();
};

/**
 * The catalog's `LiquidBottomTabs`: a capsule glass bar with a glass indicator pill that springs
 * between tabs. Tap a tab to select it, or grab the pill and drag it — it scales up while held
 * (the reference's 78/56) and snaps to the nearest tab on release, growing the whole bar a touch
 * while in flight.
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

  const position = useRef(new Animated.Value(selectedIndex)).current;
  const pressProgress = useRef(new Animated.Value(0)).current;
  const positionValue = useRef(selectedIndex);
  const dragStart = useRef(0);
  const selectedRef = useRef(selectedIndex);
  selectedRef.current = selectedIndex;
  const onTabSelectedRef = useRef(onTabSelected);
  onTabSelectedRef.current = onTabSelected;
  const tabWidthRef = useRef(tabWidth);
  tabWidthRef.current = tabWidth;
  const countRef = useRef(count);
  countRef.current = count;

  useEffect(() => {
    const id = position.addListener(({ value: v }) => {
      positionValue.current = v;
    });
    return () => position.removeListener(id);
  }, [position]);

  useEffect(() => {
    spring(position, selectedIndex, true);
  }, [position, selectedIndex]);

  // Taps belong to the tab Pressables; the bar steals the responder only once the finger moves
  // horizontally, which turns the gesture into a pill drag from wherever the pill currently is.
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (_evt, gesture) =>
          tabWidthRef.current > 0 && Math.abs(gesture.dx) > DRAG_THRESHOLD,
        onPanResponderGrant: () => {
          dragStart.current = positionValue.current;
          spring(pressProgress, 1, true);
        },
        onPanResponderMove: (_evt: unknown, gesture: { dx: number }) => {
          if (tabWidthRef.current <= 0) return;
          const max = countRef.current - 1;
          const next = Math.min(
            max,
            Math.max(
              0,
              dragStart.current +
                (direction * gesture.dx) / tabWidthRef.current,
            ),
          );
          position.setValue(next);
        },
        onPanResponderRelease: () => {
          spring(pressProgress, 0, true);
          const target = Math.round(positionValue.current);
          spring(position, target, true);
          if (target !== selectedRef.current) {
            onTabSelectedRef.current(target);
          }
        },
        onPanResponderTerminate: () => {
          spring(pressProgress, 0, true);
          spring(position, selectedRef.current, true);
        },
      }),
    [direction, position, pressProgress],
  );

  const translateX =
    count > 1
      ? position.interpolate({
          inputRange: [0, count - 1],
          outputRange: [0, direction * (count - 1) * tabWidth],
        })
      : 0;
  const indicatorScale = pressProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, TAB_INDICATOR_PRESSED_SCALE],
  });
  const barScale = pressProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, TAB_BAR_PRESSED_SCALE],
  });

  const handleLayout = (event: LayoutChangeEvent): void => {
    setWidth(event.nativeEvent.layout.width);
  };

  const handleTabPress = (index: number): void => {
    spring(position, index, true);
    if (index !== selectedRef.current) {
      onTabSelectedRef.current(index);
    }
  };

  return (
    <Animated.View
      onLayout={handleLayout}
      {...panResponder.panHandlers}
      style={[{ height, transform: [{ scale: barScale }] }, style]}
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
              transform: [{ translateX }, { scale: indicatorScale }],
            },
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
