import * as React from "react";
import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { I18nManager, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { LiquidGlassProvider, LiquidGlassView } from "expo-liquid-glass-view";

import {
  ABSOLUTE_FILL,
  GLASS_SLIDER_THUMB_METAL,
  GLASS_SLIDER_THUMB_PRESSED_METAL,
  SLIDER_THUMB_HEIGHT,
  SLIDER_THUMB_PRESSED_SCALE,
  SLIDER_THUMB_WIDTH,
  SLIDER_TRACK_HEIGHT,
  SLIDER_VELOCITY_DIVISOR,
} from "../../constants";
import { useDampedDrag } from "../../hooks";
import type { ILiquidGlassSliderProps } from "../../interfaces";
import { useGlassUITheme } from "../../theme";
import { lerpMetal } from "../../utils";

const AnimatedGlassView = Animated.createAnimatedComponent(LiquidGlassView);

/**
 * The catalog's `LiquidSlider`: a 6dp track under the same 40x24 glass thumb the toggle uses.
 *
 * Two things separate it from an ordinary slider. Its velocity divisor is **10** rather than the
 * toggle's 50, so the same jelly reads five times stronger — this is the control the effect was
 * tuned on. And a tap on the track does not jump: it routes through the full press/animate/release
 * choreography, so seeking looks exactly like grabbing.
 */
const LiquidGlassSliderBase: React.FC<ILiquidGlassSliderProps> = ({
  value = 0,
  onValueChange,
  onSlidingComplete,
  minimumValue = 0,
  maximumValue = 1,
  disabled = false,
  accentColor,
  trackColor,
  thumbMetal,
  thumbPressedMetal,
  providerId,
  style,
}: ILiquidGlassSliderProps): React.ReactElement => {
  const layerId = `glass-ui-slider-${useId()}`;
  const { colors } = useGlassUITheme();
  const accent = accentColor ?? colors.accent;
  const track = trackColor ?? colors.switchTrack;
  const direction = I18nManager.isRTL ? -1 : 1;

  const span = Math.max(maximumValue - minimumValue, 1e-6);
  const [width, setWidth] = useState(0);
  const trackWidth = useSharedValue(0);
  const restMetal = thumbMetal ?? GLASS_SLIDER_THUMB_METAL;
  const heldMetal = thumbPressedMetal ?? GLASS_SLIDER_THUMB_PRESSED_METAL;
  const lastReported = useRef(value);

  const drag = useDampedDrag({
    range: [minimumValue, maximumValue],
    initialValue: value,
    pressedScale: SLIDER_THUMB_PRESSED_SCALE,
    velocityDivisor: SLIDER_VELOCITY_DIVISOR,
  });

  useEffect(() => {
    trackWidth.value = width;
  }, [trackWidth, width]);

  useEffect(() => {
    if (lastReported.current === value) return;
    lastReported.current = value;
    drag.animateTo(value);
  }, [drag, value]);

  const emit = useCallback(
    (next: number): void => {
      lastReported.current = next;
      onValueChange?.(next);
    },
    [onValueChange],
  );
  const emitComplete = useCallback(
    (next: number): void => {
      onSlidingComplete?.(next);
    },
    [onSlidingComplete],
  );

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .minDistance(0)
    .shouldCancelWhenOutside(false)
    .onBegin(() => {
      drag.press();
    })
    .onChange((event) => {
      if (trackWidth.value <= 0) return;
      // Track width maps 1:1 onto the full range.
      drag.dragBy((direction * event.changeX * span) / trackWidth.value);
      runOnJS(emit)(drag.targetValue.value);
    })
    .onFinalize(() => {
      drag.release();
      runOnJS(emitComplete)(drag.targetValue.value);
    });

  // A tap seeks, but plays the whole grab rather than jumping.
  const tap = Gesture.Tap()
    .enabled(!disabled)
    .maxDuration(10000)
    .onEnd((event) => {
      if (trackWidth.value <= 0) return;
      const fraction = Math.min(1, Math.max(0, event.x / trackWidth.value));
      const next =
        minimumValue + (direction > 0 ? fraction : 1 - fraction) * span;
      drag.animateTo(next);
      runOnJS(emit)(next);
      runOnJS(emitComplete)(next);
    });

  const gesture = Gesture.Exclusive(pan, tap);

  /**
   * The frost lifting as the lens comes in, on the UI thread — see the toggle. It matters more
   * here: a slider thumb is dragged for seconds at a time, and a material that only arrives on the
   * next React render arrives after the gesture has already told the eye what to expect.
   */
  const thumbProps = useAnimatedProps(() => ({
    metal: lerpMetal(restMetal, heldMetal, drag.pressProgress.value),
  }));

  const fillStyle = useAnimatedStyle(() => ({
    width:
      trackWidth.value *
      Math.min(1, Math.max(0, (drag.value.value - minimumValue) / span)),
  }));
  const thumbStyle = useAnimatedStyle(() => {
    const { scaleX, scaleY } = drag.jelly();
    const fraction = Math.min(
      1,
      Math.max(0, (drag.value.value - minimumValue) / span),
    );
    const w = SLIDER_THUMB_WIDTH;
    // The reference lets the thumb hang exactly a quarter of its width off each end.
    const x = Math.min(
      trackWidth.value - (3 * w) / 4,
      Math.max(-w / 4, -w / 2 + trackWidth.value * fraction),
    );
    return {
      transform: [
        { translateX: direction > 0 ? x : trackWidth.value - w - x },
        { scaleX },
        { scaleY },
      ],
    };
  });
  const thumbFillStyle = useAnimatedStyle(() => ({
    opacity: 1 - drag.pressProgress.value,
  }));

  const handleLayout = (event: LayoutChangeEvent): void => {
    setWidth(event.nativeEvent.layout.width);
  };

  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityState={{ disabled }}
        accessibilityValue={{ min: minimumValue, max: maximumValue, now: value }}
        onLayout={handleLayout}
        style={[styles.root, disabled && styles.disabled, style]}
      >
        {/* One direct child — the provider lays out only its first. */}
        <LiquidGlassProvider
          providerId={layerId}
          style={StyleSheet.absoluteFill}
        >
          <View style={styles.trackRow}>
            <View style={[styles.track, { backgroundColor: track }]} />
            <Animated.View
              style={[styles.fill, { backgroundColor: accent }, fillStyle]}
            />
          </View>
        </LiquidGlassProvider>
        {width > 0 ? (
          <Animated.View style={[styles.thumb, thumbStyle]}>
            <AnimatedGlassView
              providerId={[providerId ?? "default", layerId]}
              cornerRadius={SLIDER_THUMB_HEIGHT / 2}
              cornerStyle="continuous"
              animatedProps={thumbProps}
              style={styles.thumbGlass}
              containerStyle={styles.thumbContent}
            >
              <Animated.View style={[styles.thumbFill, thumbFillStyle]} />
            </AnimatedGlassView>
          </Animated.View>
        ) : null}
      </View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  root: {
    height: SLIDER_THUMB_HEIGHT,
    justifyContent: "center",
  },
  disabled: {
    opacity: 0.5,
  },
  trackRow: {
    ...ABSOLUTE_FILL,
    justifyContent: "center",
  },
  track: {
    height: SLIDER_TRACK_HEIGHT,
    borderRadius: SLIDER_TRACK_HEIGHT / 2,
  },
  fill: {
    position: "absolute",
    left: 0,
    height: SLIDER_TRACK_HEIGHT,
    borderRadius: SLIDER_TRACK_HEIGHT / 2,
  },
  thumb: {
    position: "absolute",
    left: 0,
    width: SLIDER_THUMB_WIDTH,
    height: SLIDER_THUMB_HEIGHT,
    shadowColor: "#000000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  thumbGlass: {
    width: SLIDER_THUMB_WIDTH,
    height: SLIDER_THUMB_HEIGHT,
  },
  thumbContent: {
    ...ABSOLUTE_FILL,
  },
  thumbFill: {
    ...ABSOLUTE_FILL,
    borderRadius: SLIDER_THUMB_HEIGHT / 2,
    backgroundColor: "#FFFFFF",
  },
});

const LiquidGlassSlider: React.NamedExoticComponent<ILiquidGlassSliderProps> =
  memo<ILiquidGlassSliderProps>(LiquidGlassSliderBase);
LiquidGlassSlider.displayName = "LiquidGlassSlider";

export { LiquidGlassSlider };
