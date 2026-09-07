import * as React from "react";
import { memo, useCallback, useEffect } from "react";
import type { LayoutChangeEvent } from "react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import type { GlassMetalOptions } from "../../core";
import { LiquidGlassView } from "../../core";

import {
  ABSOLUTE_FILL,
  GLASS_BAR_METAL,
  GLASS_THUMB_METAL,
  SEGMENTED_HEIGHT,
  SEGMENTED_INSET,
  SEGMENTED_SMOOTHING,
  SEGMENTED_STRETCH,
  VALUE_SPRING,
} from "../../constants";
import type { ILiquidGlassSegmentedControlProps } from "../../interfaces";
import { useGlassUITheme } from "../../theme";

/**
 * A segmented control whose thumb travels like liquid: on selection the thumb detaches and a
 * shrinking droplet stays behind for a beat, necked to the moving thumb by the smooth-min —
 * `metal.shape` is the traveller (stretched along its axis mid-flight), `metal.morph` the
 * droplet, both on one canvas glass view over the track. On renderers without the shader the
 * canvas degrades to a plain wash thumb that still slides.
 *
 * The track and the thumb sample the *backdrop*, not each other (Android's structural
 * exclusion), so the thumb reads as a wash-lifted pill over the track — the tab bar's resting
 * chip, not its lens. Deliberate: a segmented control is furniture, not a hero element.
 */
const AnimatedGlassView = Animated.createAnimatedComponent(LiquidGlassView);

const LiquidGlassSegmentedControlBase: React.FC<
  ILiquidGlassSegmentedControlProps
> = ({
  segments,
  selectedIndex,
  onChange,
  height = SEGMENTED_HEIGHT,
  tint,
  thumbTint,
  thumbMetal,
  providerId,
  style,
  textStyle,
}: ILiquidGlassSegmentedControlProps): React.ReactElement => {
  const { colors } = useGlassUITheme();
  const count = Math.max(segments.length, 1);

  const trackWidth = useSharedValue(0);
  const fromIdx = useSharedValue(selectedIndex);
  const toIdx = useSharedValue(selectedIndex);
  const progress = useSharedValue(1);

  useEffect(() => {
    if (toIdx.value === selectedIndex) return;
    // Mid-flight retarget: the traveller keeps its current position as the new origin — the
    // droplet respawns there, which reads as the liquid changing its mind rather than teleporting.
    fromIdx.value =
      progress.value >= 1
        ? toIdx.value
        : fromIdx.value + (toIdx.value - fromIdx.value) * Math.min(progress.value, 1);
    toIdx.value = selectedIndex;
    progress.value = 0;
    progress.value = withSpring(1, VALUE_SPRING);
  }, [selectedIndex, fromIdx, toIdx, progress]);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      trackWidth.value = event.nativeEvent.layout.width;
    },
    [trackWidth],
  );

  const resolvedThumbMetal = thumbMetal ?? GLASS_THUMB_METAL;

  const thumbProps = useAnimatedProps(() => {
    const w = trackWidth.value;
    const base: GlassMetalOptions = {
      ...resolvedThumbMetal,
      border: { width: 0, opacity: 0 },
    };
    if (w <= 0) {
      return { metal: { ...base, shape: { x: 0, y: 0, width: 0.01, height: 0.01 } } };
    }
    const segW = (w - 2 * SEGMENTED_INSET) / count;
    const thumbH = height - 2 * SEGMENTED_INSET;
    const t = progress.value;
    const tc = Math.min(Math.max(t, 0), 1);

    const centerAt = (idx: number): number =>
      SEGMENTED_INSET + (idx + 0.5) * segW;
    const fromCx = centerAt(fromIdx.value);
    const toCx = centerAt(toIdx.value);
    const cx = fromCx + (toCx - fromCx) * t;

    // Mid-flight the traveller stretches along its axis — the spring's overshoot rides on top,
    // which is most of what reads as "liquid" rather than "slides".
    const stretch =
      Math.abs(toCx - fromCx) * SEGMENTED_STRETCH * Math.sin(Math.PI * tc);
    const thumbW = segW + stretch;

    const shape = {
      x: cx - thumbW / 2,
      y: SEGMENTED_INSET,
      width: thumbW,
      height: thumbH,
    };

    // The droplet left behind: the origin pill shrinking to nothing, necked to the traveller
    // while the smooth-min still reaches it. Gone by 95% of the flight.
    const droplet = 1 - tc / 0.95;
    const morph =
      droplet <= 0
        ? undefined
        : {
            x: fromCx - (segW * droplet) / 2,
            y: SEGMENTED_INSET + (thumbH * (1 - droplet)) / 2,
            width: segW * droplet,
            height: thumbH * droplet,
            cornerRadius: (thumbH * droplet) / 2,
            smoothing: SEGMENTED_SMOOTHING,
          };

    return { metal: { ...base, shape, morph } };
  });

  const handlePress = useCallback(
    (index: number): void => {
      if (index !== selectedIndex) onChange(index);
    },
    [selectedIndex, onChange],
  );

  return (
    <View onLayout={handleLayout} style={[{ height }, style]}>
      <LiquidGlassView
        providerId={providerId}
        cornerRadius={height / 2}
        cornerStyle="continuous"
        tint={tint ?? colors.tabBarSurface}
        metal={GLASS_BAR_METAL}
        style={StyleSheet.absoluteFill}
      />
      <AnimatedGlassView
        renderer="metal"
        providerId={providerId}
        cornerRadius={(height - 2 * SEGMENTED_INSET) / 2}
        cornerStyle="continuous"
        tint={thumbTint ?? colors.tabIndicatorSurface}
        animatedProps={thumbProps}
        style={[StyleSheet.absoluteFill, styles.thumb]}
      />
      <View style={styles.row}>
        {segments.map((label, index) => (
          <Pressable
            key={`${index}-${label}`}
            accessibilityRole="button"
            accessibilityState={{ selected: index === selectedIndex }}
            onPress={() => handlePress(index)}
            style={styles.segment}
          >
            <Text
              style={[
                styles.label,
                { color: colors.label },
                index === selectedIndex && styles.labelSelected,
                textStyle,
              ]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  thumb: {
    pointerEvents: "none",
  },
  row: {
    ...ABSOLUTE_FILL,
    flexDirection: "row",
    paddingHorizontal: SEGMENTED_INSET,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
  },
  labelSelected: {
    fontWeight: "700",
  },
});

const LiquidGlassSegmentedControl: React.NamedExoticComponent<ILiquidGlassSegmentedControlProps> =
  memo<ILiquidGlassSegmentedControlProps>(LiquidGlassSegmentedControlBase);
LiquidGlassSegmentedControl.displayName = "LiquidGlassSegmentedControl";

export { LiquidGlassSegmentedControl };
