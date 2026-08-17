import * as React from "react";
import { memo, useEffect, useMemo, useRef } from "react";
import {
  Animated,
  I18nManager,
  PanResponder,
  StyleSheet,
  View,
} from "react-native";
import { LiquidGlassView } from "expo-liquid-glass-view";

import {
  ABSOLUTE_FILL,
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

/** Movement past this many dp counts as a drag; anything shorter is a tap that toggles. */
const DRAG_THRESHOLD = 2;

const springTo = (value: Animated.Value, toValue: number): void => {
  Animated.spring(value, {
    toValue,
    stiffness: 400,
    damping: 30,
    mass: 1,
    // The one value drives the track's color interpolation, so everything stays on the JS driver.
    useNativeDriver: false,
  }).start();
};

/**
 * The catalog's `LiquidToggle`: a colored capsule track under a glass thumb. At rest the thumb
 * wears an opaque white fill; pressing melts the fill away and scales the bare glass up 1.5× so
 * the track color refracts through it, exactly the iOS 26 gesture. Drag to the far side or tap to
 * toggle.
 *
 * The thumb's refraction comes from the base view sampling what is behind the *provider*, so the
 * lens bends the backdrop; the track color itself reaches the eye through the glass tint.
 */
const LiquidGlassSwitchBase: React.FC<ILiquidGlassSwitchProps> = ({
  value = false,
  onValueChange,
  disabled = false,
  accentColor,
  trackColor,
  providerId,
  style,
}: ILiquidGlassSwitchProps): React.ReactElement => {
  const { colors } = useGlassUITheme();
  const onColor = accentColor ?? colors.green;
  const offColor = trackColor ?? colors.switchTrack;
  const direction = I18nManager.isRTL ? -1 : 1;

  const fraction = useRef(new Animated.Value(value ? 1 : 0)).current;
  const pressProgress = useRef(new Animated.Value(0)).current;
  const fractionValue = useRef(value ? 1 : 0);
  const dragStart = useRef(0);
  const didDrag = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onValueChangeRef = useRef(onValueChange);
  onValueChangeRef.current = onValueChange;

  useEffect(() => {
    const id = fraction.addListener(({ value: v }) => {
      fractionValue.current = v;
    });
    return () => fraction.removeListener(id);
  }, [fraction]);

  useEffect(() => {
    springTo(fraction, value ? 1 : 0);
  }, [fraction, value]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        onPanResponderGrant: () => {
          dragStart.current = fractionValue.current;
          didDrag.current = false;
          springTo(pressProgress, 1);
        },
        onPanResponderMove: (_evt: unknown, gesture: { dx: number }) => {
          if (Math.abs(gesture.dx) > DRAG_THRESHOLD) didDrag.current = true;
          const next = Math.min(
            1,
            Math.max(
              0,
              dragStart.current +
                (direction * gesture.dx) / SWITCH_THUMB_TRAVEL,
            ),
          );
          fraction.setValue(next);
        },
        onPanResponderRelease: () => {
          const target = didDrag.current
            ? fractionValue.current >= 0.5
              ? 1
              : 0
            : valueRef.current
              ? 0
              : 1;
          springTo(fraction, target);
          springTo(pressProgress, 0);
          const nextValue = target === 1;
          if (nextValue !== valueRef.current) {
            onValueChangeRef.current?.(nextValue);
          }
        },
        onPanResponderTerminate: () => {
          springTo(fraction, valueRef.current ? 1 : 0);
          springTo(pressProgress, 0);
        },
      }),
    [disabled, direction, fraction, pressProgress],
  );

  const trackBackground = fraction.interpolate({
    inputRange: [0, 1],
    outputRange: [String(offColor), String(onColor)],
  });
  const translateX = fraction.interpolate({
    inputRange: [0, 1],
    outputRange: [
      direction * SWITCH_THUMB_INSET,
      direction * (SWITCH_THUMB_INSET + SWITCH_THUMB_TRAVEL),
    ],
  });
  const thumbScale = pressProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, SWITCH_THUMB_PRESSED_SCALE],
  });
  const fillOpacity = pressProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  return (
    <View
      accessible
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      style={[styles.root, disabled && styles.disabled, style]}
      {...panResponder.panHandlers}
    >
      <Animated.View
        style={[styles.track, { backgroundColor: trackBackground }]}
      />
      <Animated.View
        style={[
          styles.thumb,
          { transform: [{ translateX }, { scale: thumbScale }] },
        ]}
      >
        <LiquidGlassView
          providerId={providerId}
          cornerRadius={SWITCH_THUMB_HEIGHT / 2}
          style={styles.thumbGlass}
          containerStyle={styles.thumbContent}
        >
          <Animated.View style={[styles.thumbFill, { opacity: fillOpacity }]} />
        </LiquidGlassView>
      </Animated.View>
    </View>
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
    ...ABSOLUTE_FILL,
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
