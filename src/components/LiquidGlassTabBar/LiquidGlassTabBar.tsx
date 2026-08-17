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
  withSequence,
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
  TAB_INDICATOR_INSET,
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
 * Both pill states, tuned on device and written out in full — no field left to a variant default,
 * because an unset one silently picks up `regular`'s (frost 0.36, rim 0.25, border 0.28) and that
 * is exactly how the rest state stopped being silent once before.
 *
 * At rest the pill is a pure scrim — every effect off, the reference exactly: its lens, highlight
 * and shadows all scale by `pressProgress`, so the resting pill is just the tint wash and the
 * accent icon reads crisply through it.
 */
const PILL_METAL: GlassMetalOptions = {
  refraction: {
    amount: 0,
    width: 24,
    height: 24,
    depth: 1,
    swirl: 0,
    curve: { power: 1, bias: 0 },
  },
  dispersion: { amount: 0, reach: 20 },
  blurRadius: 0,
  frost: 0,
  saturation: 1,
  noise: 0,
  light: 0,
  opacity: 1,
  highlight: { intensity: 0, angle: 180, width: 0.75, falloff: 1 },
  border: { width: 1, opacity: 0 },
  android: { quality: "high" },
};

/**
 * The drag brings the liquid — and it is spread, not bend: a shallow lens (35) in a band only
 * 12×6 dp deep hugs the rim, while the dispersion runs to 30 over a 50 dp reach, so the accent
 * row underneath fans into colour instead of merely warping. The rim lights to 0.4 rather than
 * blowing out, and a touch of body light (0.2) lifts the glass itself.
 *
 * `dispersion.reach` matters here: left unset it falls back to the *variant's* refraction height
 * (20), not to this metal's 6, which would decay the spread far too fast to see.
 */
const PRESSED_PILL_METAL: GlassMetalOptions = {
  refraction: {
    amount: 35,
    width: 12,
    height: 6,
    depth: 1,
    swirl: 0,
    curve: { power: 1, bias: 0 },
  },
  dispersion: { amount: 30, reach: 50 },
  blurRadius: 0,
  frost: 0.4,
  saturation: 1.8,
  noise: 0.05,
  light: 0.2,
  opacity: 1,
  highlight: { intensity: 0.4, angle: 180, width: 0.75, falloff: 1 },
  border: { width: 1, opacity: 0.28 },
  android: { quality: "high" },
};

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
 * - **Accent under-glass.** The reference's trick, done for real: an accent-colored copy of the
 *   row lives in a screen-invisible provider (2% wrapper opacity — recording ignores it), and
 *   the pill's combined backdrop stacks it on top. The accent icons reach the eye only through
 *   the pill's glass, lens, dispersion and all — while the inactive copy fades away under it.
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
  pillMetal,
  pillDraggedMetal,
  pillTint,
  pillInset = TAB_INDICATOR_INSET,
  pillPressedScale = TAB_INDICATOR_PRESSED_SCALE,
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
  const accentLayerId = `${layerId}-accent`;

  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const tabWidth = width > 0 ? (width - TAB_BAR_PADDING * 2) / count : 0;
  const indicatorHeight = height - pillInset * 2;
  // Wider than the tab slot by the inset difference on each side, still centred on the tab.
  const indicatorWidth = tabWidth + (TAB_BAR_PADDING - pillInset) * 2;

  const position = useSharedValue(selectedIndex);
  const pressProgress = useSharedValue(0);
  const dragStart = useSharedValue(0);
  /** Where the pill is already flying. See the effect below. */
  const travelTarget = useSharedValue(selectedIndex);

  useEffect(() => {
    // A tap and a drag-release both start the travel spring themselves and
    // THEN report the new index, so by the time this runs the pill is usually
    // already on its way to `selectedIndex`. Re-springing it would restart the
    // animation mid-flight from ZERO velocity — a visible hitch on landing,
    // and worse under a controlled parent that reports the index optimistically
    // (the restart cancels the travel spring, stranding any callback attached
    // to it). Only drive the pill from here when something else moved the
    // selection: a deep link, a passive route change, a programmatic set.
    if (travelTarget.value === selectedIndex) return;
    travelTarget.value = selectedIndex;
    position.value = withSpring(selectedIndex, TRAVEL_SPRING);
  }, [position, selectedIndex, travelTarget]);

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
      travelTarget.value = target;
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
          [1, pillPressedScale],
        ),
      },
    ],
  }));
  const handleLayout = (event: LayoutChangeEvent): void => {
    setWidth(event.nativeEvent.layout.width);
  };

  const handleTabPress = (index: number): void => {
    // The drag carries the liquid — and so should the tap. Without this the
    // pill only translated: `pressProgress` was raised by the pan gesture
    // alone, so a tapped pill travelled as a flat capsule with none of the
    // lens it wears under the finger. Bloom it for the length of the journey
    // and let it settle back into the silent resting state on arrival, so the
    // rest state stays untouched.
    setDragging(true);
    // A self-contained rise-and-settle. Hanging the release off the travel
    // spring's callback looked tidier but stranded the pill mid-bloom the
    // moment anything interrupted the travel — the callback reports
    // finished === false and there is no second chance to lower it.
    pressProgress.value = withSequence(
      withSpring(1, PRESS_SPRING),
      withSpring(0, PRESS_SPRING, (finished) => {
        // A fresh tap replaces this sequence and owns the reset from here.
        if (finished) runOnJS(setDragging)(false);
      }),
    );
    travelTarget.value = index;
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
        {/* The accent under-glass layer: screen-invisible (the wrapper's 2% opacity applies at
            composite time, after the provider records its children at full strength), touch-inert,
            and stacked on top of the pill's combined backdrop — so the accent icons only reach
            the eye through the pill's glass. */}
        <View pointerEvents="none" style={styles.accentLayer}>
          <LiquidGlassProvider
            providerId={accentLayerId}
            style={styles.fill}
          >
            <View style={styles.fill}>
              <View style={styles.row}>
                {tabs.map((tab) => (
                  <View key={tab.key} style={styles.tab}>
                    <View style={styles.tabContent}>
                      {tab.icon?.({ focused: true, color: accent, size: 24 })}
                      {tab.title != null ? (
                        <Text
                          style={[styles.label, { color: accent }, labelStyle]}
                        >
                          {tab.title}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </LiquidGlassProvider>
        </View>
        {tabWidth > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.indicator,
              {
                start: pillInset,
                top: pillInset,
                width: indicatorWidth,
                height: indicatorHeight,
              },
              indicatorStyle,
            ]}
          >
            <LiquidGlassView
              // Combined backdrop, the reference's CombinedBackdrop: screen content at the
              // bottom, the bar's recorded glass over it, the accent row on top — the pill
              // filters all three through one lens.
              providerId={[providerId ?? "default", layerId, accentLayerId]}
              cornerRadius={indicatorHeight / 2}
              tint={pillTint ?? colors.tabIndicatorSurface}
              metal={
                dragging
                  ? (pillDraggedMetal ?? PRESSED_PILL_METAL)
                  : (pillMetal ?? PILL_METAL)
              }
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
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
  },
  accentLayer: {
    ...ABSOLUTE_FILL,
    opacity: 0.02,
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
