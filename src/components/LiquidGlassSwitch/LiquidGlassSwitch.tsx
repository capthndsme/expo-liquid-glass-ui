import * as React from "react";
import { memo, useCallback, useEffect, useId, useRef } from "react";
import { I18nManager, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolateColor,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
} from "react-native-reanimated";
import { LiquidGlassProvider, LiquidGlassView } from "expo-liquid-glass-view";

import {
  ABSOLUTE_FILL,
  GLASS_THUMB_METAL,
  GLASS_THUMB_PRESSED_METAL,
  SWITCH_THUMB_HEIGHT,
  SWITCH_THUMB_INSET,
  SWITCH_THUMB_PRESSED_SCALE,
  SWITCH_THUMB_TRAVEL,
  SWITCH_THUMB_WIDTH,
  SWITCH_TRACK_COPY_SCALE_X,
  SWITCH_TRACK_COPY_SCALE_Y,
  SWITCH_TRACK_HEIGHT,
  SWITCH_TRACK_WIDTH,
  SWITCH_VELOCITY_DIVISOR,
} from "../../constants";
import { useDampedDrag } from "../../hooks";
import type { ILiquidGlassSwitchProps } from "../../interfaces";
import { useGlassUITheme } from "../../theme";
import { lerpMetal } from "../../utils";

const AnimatedGlassView = Animated.createAnimatedComponent(LiquidGlassView);

/**
 * The catalog's `LiquidToggle`: a colour-crossfading capsule track under a 40x24 glass thumb.
 *
 * The whole gesture runs on `DampedDragAnimation`, so the thumb inherits the jelly and — more
 * importantly — the convergence-gated release: it stays ballooned and refractive until the value
 * has essentially landed, then deflates. A tap gets the identical swell-and-settle, because the
 * reference routes programmatic changes through the same press/animate/release path.
 *
 * The track is recorded into its own provider layer that the thumb reads, so the pressed lens
 * bends the green body *and* the world behind the switch.
 */
const LiquidGlassSwitchBase: React.FC<ILiquidGlassSwitchProps> = ({
  value = false,
  onValueChange,
  disabled = false,
  accentColor,
  trackColor,
  thumbMetal,
  thumbPressedMetal,
  providerId,
  style,
}: ILiquidGlassSwitchProps): React.ReactElement => {
  const layerId = `glass-ui-switch-${useId()}`;
  const copyLayerId = `${layerId}-copy`;
  const { colors } = useGlassUITheme();
  const onColor = accentColor ?? colors.green;
  const offColor = trackColor ?? colors.switchTrack;
  const direction = I18nManager.isRTL ? -1 : 1;

  const lastReported = useRef(value);
  const restMetal = thumbMetal ?? GLASS_THUMB_METAL;
  const heldMetal = thumbPressedMetal ?? GLASS_THUMB_PRESSED_METAL;

  const drag = useDampedDrag({
    range: [0, 1],
    initialValue: value ? 1 : 0,
    pressedScale: SWITCH_THUMB_PRESSED_SCALE,
    velocityDivisor: SWITCH_VELOCITY_DIVISOR,
  });

  useEffect(() => {
    if (lastReported.current === value) return;
    lastReported.current = value;
    drag.animateTo(value ? 1 : 0);
  }, [drag, value]);

  const emitChange = useCallback(
    (next: boolean): void => {
      lastReported.current = next;
      onValueChange?.(next);
    },
    [onValueChange],
  );

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .minDistance(0)
    .shouldCancelWhenOutside(false)
    .onBegin(() => {
      drag.press();
    })
    .onChange((event) => {
      drag.dragBy((direction * event.changeX) / SWITCH_THUMB_TRAVEL);
    })
    .onEnd((event) => {
      // A real drag lands on whichever side it ended nearest; one that activated but barely moved
      // inverts, same as a tap.
      const moved = Math.abs(event.translationX) > 1;
      const next = moved ? drag.targetValue.value >= 0.5 : drag.value.value < 0.5;
      const target = next ? 1 : 0;
      drag.animateTo(target);
      if ((target === 1) !== value) runOnJS(emitChange)(target === 1);
    })
    .onFinalize(() => {
      drag.release();
    });

  /**
   * A tap toggles. It needs its own recogniser because a pan that never *activates* never reaches
   * `onEnd`, so a press-and-release with no movement would otherwise inflate the thumb, deflate it
   * again and change nothing. Same pairing the slider uses for tap-to-seek.
   */
  const tap = Gesture.Tap()
    .enabled(!disabled)
    .maxDuration(10000)
    .onEnd(() => {
      const target = drag.value.value < 0.5 ? 1 : 0;
      drag.animateTo(target);
      if ((target === 1) !== value) runOnJS(emitChange)(target === 1);
    });

  // Pan first: a real drag wins, and the tap only gets its chance when the pan never activated.
  const gesture = Gesture.Exclusive(pan, tap);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      drag.value.value,
      [0, 1],
      [offColor, onColor],
    ),
  }));
  const thumbStyle = useAnimatedStyle(() => {
    const { scaleX, scaleY } = drag.jelly();
    return {
      transform: [
        {
          translateX:
            direction *
            (SWITCH_THUMB_INSET + drag.value.value * SWITCH_THUMB_TRAVEL),
        },
        { scaleX },
        { scaleY },
      ],
    };
  });
  const fillStyle = useAnimatedStyle(() => ({
    opacity: 1 - drag.pressProgress.value,
  }));
  /**
   * The frost lifting as the lens comes in, continuously — the reference animates the effect chain
   * itself, and it holds the pressed material through the whole snap rather than dropping it on
   * finger-up. A React state swap can do neither: it lands a render late and it lands at release.
   */
  const thumbProps = useAnimatedProps(() => ({
    metal: lerpMetal(restMetal, heldMetal, drag.pressProgress.value),
  }));

  /**
   * The track, redrawn *shrunk* into the layer the thumb reads — the toggle's version of the tab
   * bar's inset strip, and the reference's own trick:
   *
   * ```kotlin
   * rememberBackdrop(trackBackdrop) {
   *     val scaleX = lerp(2f / 3f, 0.75f, progress)
   *     val scaleY = lerp(0f, 0.75f, progress)
   *     scale(scaleX, scaleY) { drawBackdrop() }
   * }
   * ```
   *
   * `scaleY` starting at **zero** is the part that matters: a resting thumb sees no track at all,
   * so it is a plain frosted lozenge, and the green body swells into view out of nothing as the
   * grab lands. Kyant scales the layer at draw time; there is no per-layer transform on a
   * `providerId` list, so the copy is scaled here instead and recorded from a provider of its own.
   */
  const trackCopyStyle = useAnimatedStyle(() => {
    const p = drag.pressProgress.value;
    return {
      transform: [
        { scaleX: SWITCH_TRACK_COPY_SCALE_X[0] + (SWITCH_TRACK_COPY_SCALE_X[1] - SWITCH_TRACK_COPY_SCALE_X[0]) * p },
        { scaleY: SWITCH_TRACK_COPY_SCALE_Y[0] + (SWITCH_TRACK_COPY_SCALE_Y[1] - SWITCH_TRACK_COPY_SCALE_Y[0]) * p },
      ],
    };
  });

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
        {/* Screen-invisible, and the only layer the thumb reads besides the screen. */}
        <View pointerEvents="none" style={styles.trackCopyLayer}>
          <LiquidGlassProvider
            providerId={copyLayerId}
            style={StyleSheet.absoluteFill}
          >
            <Animated.View style={[styles.track, trackStyle, trackCopyStyle]} />
          </LiquidGlassProvider>
        </View>

        <Animated.View style={[styles.thumb, thumbStyle]}>
          <AnimatedGlassView
            // The reference's `rememberCombinedBackdrop(backdrop, scaled(trackBackdrop))`: the
            // screen, then the *shrunk* copy of the track — never the track at its real size.
            providerId={[providerId ?? "default", copyLayerId]}
            cornerRadius={SWITCH_THUMB_HEIGHT / 2}
            cornerStyle="continuous"
            animatedProps={thumbProps}
            style={styles.thumbGlass}
            containerStyle={styles.thumbContent}
          >
            <Animated.View style={[styles.thumbFill, fillStyle]} />
          </AnimatedGlassView>
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
  trackCopyLayer: {
    ...ABSOLUTE_FILL,
    opacity: 0.02,
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
