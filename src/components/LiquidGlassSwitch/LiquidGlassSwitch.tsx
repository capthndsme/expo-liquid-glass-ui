import * as React from "react";
import { memo, useCallback, useEffect, useId } from "react";
import { I18nManager, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { LiquidGlassProvider, LiquidGlassView } from "expo-liquid-glass-view";

import {
  ABSOLUTE_FILL,
  PRESS_SPRING,
  SWITCH_THUMB_HEIGHT,
  SWITCH_THUMB_INSET,
  SWITCH_THUMB_PRESSED_SCALE,
  SWITCH_THUMB_TRAVEL,
  SWITCH_THUMB_WIDTH,
  SWITCH_TRACK_HEIGHT,
  SWITCH_TRACK_WIDTH,
} from "../../constants";
import type { ILiquidGlassSwitchProps } from "../../interfaces";
import { useGlassUITheme } from "../../theme";

/**
 * Horizontal movement past this activates the drag; the matching vertical failure hands the
 * gesture to an ancestor scroller, so a switch in a settings list never eats the scroll.
 */
const DRAG_SLOP = 5;

/**
 * The catalog's `LiquidToggle`: a colored capsule track under a glass thumb. At rest the thumb
 * wears an opaque white fill; pressing melts the fill away and scales the bare glass up 1.5× so
 * the backdrop refracts through it, exactly the iOS 26 gesture. Drag to the far side or tap to
 * toggle.
 *
 * Gestures and springs are Reanimated worklets — track color, thumb travel and the press bloom
 * all run on the UI thread with no JS per frame.
 *
 * The track is recorded into its own provider layer that the thumb reads — the reference's
 * `trackBackdrop` — so the pressed lens shows the green (or gray) body through the glass instead
 * of whatever happens to be behind the whole switch.
 */
const LiquidGlassSwitchBase: React.FC<ILiquidGlassSwitchProps> = ({
  value = false,
  onValueChange,
  disabled = false,
  accentColor,
  trackColor,
  style,
}: ILiquidGlassSwitchProps): React.ReactElement => {
  const layerId = `glass-ui-switch-${useId()}`;
  const { colors } = useGlassUITheme();
  const onColor = accentColor ?? colors.green;
  const offColor = trackColor ?? colors.switchTrack;
  const direction = I18nManager.isRTL ? -1 : 1;

  const fraction = useSharedValue(value ? 1 : 0);
  const pressProgress = useSharedValue(0);
  const dragStart = useSharedValue(0);

  useEffect(() => {
    fraction.value = withSpring(value ? 1 : 0, PRESS_SPRING);
  }, [fraction, value]);

  const emitChange = useCallback(
    (next: boolean): void => {
      onValueChange?.(next);
    },
    [onValueChange],
  );

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .activeOffsetX([-DRAG_SLOP, DRAG_SLOP])
    .failOffsetY([-DRAG_SLOP, DRAG_SLOP])
    .onBegin(() => {
      dragStart.value = fraction.value;
      pressProgress.value = withSpring(1, PRESS_SPRING);
    })
    .onUpdate((event) => {
      const next =
        dragStart.value +
        (direction * event.translationX) / SWITCH_THUMB_TRAVEL;
      fraction.value = Math.min(1, Math.max(0, next));
    })
    .onEnd(() => {
      const target = fraction.value >= 0.5 ? 1 : 0;
      fraction.value = withSpring(target, PRESS_SPRING);
      const next = target === 1;
      if (next !== value) {
        runOnJS(emitChange)(next);
      }
    })
    .onFinalize(() => {
      pressProgress.value = withSpring(0, PRESS_SPRING);
    });

  // Runs only after the pan fails (released without horizontal movement) — a plain toggle. The
  // long maxDuration keeps a slow press-and-release behaving like the system switch.
  const tap = Gesture.Tap()
    .enabled(!disabled)
    .maxDuration(10000)
    .onEnd(() => {
      fraction.value = withSpring(value ? 0 : 1, PRESS_SPRING);
      runOnJS(emitChange)(!value);
    });

  const gesture = Gesture.Exclusive(pan, tap);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      fraction.value,
      [0, 1],
      [offColor, onColor],
    ),
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          fraction.value,
          [0, 1],
          [
            direction * SWITCH_THUMB_INSET,
            direction * (SWITCH_THUMB_INSET + SWITCH_THUMB_TRAVEL),
          ],
        ),
      },
      {
        scale: interpolate(
          pressProgress.value,
          [0, 1],
          [1, SWITCH_THUMB_PRESSED_SCALE],
        ),
      },
    ],
  }));
  const fillStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pressProgress.value, [0, 1], [1, 0]),
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="switch"
        accessibilityState={{ checked: value, disabled }}
        style={[styles.root, disabled && styles.disabled, style]}
      >
        {/* One direct child — the provider lays out only its first. */}
        <LiquidGlassProvider
          providerId={layerId}
          style={StyleSheet.absoluteFill}
        >
          <Animated.View style={[styles.track, trackStyle]} />
        </LiquidGlassProvider>
        <Animated.View style={[styles.thumb, thumbStyle]}>
          <LiquidGlassView
            providerId={layerId}
            cornerRadius={SWITCH_THUMB_HEIGHT / 2}
            style={styles.thumbGlass}
            containerStyle={styles.thumbContent}
          >
            <Animated.View style={[styles.thumbFill, fillStyle]} />
          </LiquidGlassView>
        </Animated.View>
      </View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  root: {
    width: SWITCH_TRACK_WIDTH,
    height: SWITCH_TRACK_HEIGHT,
    justifyContent: "center",
  },
  disabled: {
    opacity: 0.5,
  },
  track: {
    flex: 1,
    borderRadius: SWITCH_TRACK_HEIGHT / 2,
  },
  thumb: {
    position: "absolute",
    top: (SWITCH_TRACK_HEIGHT - SWITCH_THUMB_HEIGHT) / 2,
    left: 0,
    width: SWITCH_THUMB_WIDTH,
    height: SWITCH_THUMB_HEIGHT,
    shadowColor: "#000000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  thumbGlass: {
    width: SWITCH_THUMB_WIDTH,
    height: SWITCH_THUMB_HEIGHT,
  },
  thumbContent: {
    ...ABSOLUTE_FILL,
  },
  thumbFill: {
    ...ABSOLUTE_FILL,
    borderRadius: SWITCH_THUMB_HEIGHT / 2,
    backgroundColor: "#FFFFFF",
  },
});

const LiquidGlassSwitch: React.NamedExoticComponent<ILiquidGlassSwitchProps> =
  memo<ILiquidGlassSwitchProps>(LiquidGlassSwitchBase);
LiquidGlassSwitch.displayName = "LiquidGlassSwitch";

export { LiquidGlassSwitch };
