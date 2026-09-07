import * as React from "react";
import { memo, useCallback, useMemo, useRef } from "react";
import type { LayoutChangeEvent, View as RNView } from "react-native";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import {
  ABSOLUTE_FILL,
  BUTTON_CONTENT_GAP,
  BUTTON_PRESS_GROWTH,
  BUTTON_PRESS_LIGHT,
  BUTTON_SIZES,
  GLASS_BUTTON_METAL,
  GLOW_SPRING,
} from "../../constants";
import {
  LiquidGlassView,
  supportsGlass,
  supportsNativeGlass,
} from "../../core";
import {
  useAdaptiveGlass,
  useGlassGroupMember,
  usePressProgress,
} from "../../hooks";
import type { ILiquidGlassButtonProps } from "../../interfaces";
import { GLASS_UI_PALETTE, useGlassUITheme } from "../../theme";
import { buttonPressTransform } from "../../utils";

const AnimatedGlassView = Animated.createAnimatedComponent(LiquidGlassView);

/**
 * The press light. The reference lights a pressed button with two additive passes — a flat
 * `White a0.08 * p` and a finger-centred radial `White a0.15 * p` over `1.5 x minDimension` —
 * and both already live in the shader renderers behind the base view's `glow` prop. The button
 * hands it the press progress and the finger, and Android and the iOS Metal renderer draw the
 * reference's light: additive, inside the glass, under the rim.
 *
 * Two renderers have no such uniform — iOS 26's native glass, which ignores `glow` because the
 * OS owns its material, and the no-glass degrade. There the reference's own declared fallback
 * for devices without runtime shaders stands in: a single flat `White a0.25 * p`. A degraded
 * path from the source, not a guess — and no longer what Android shows, where that flat wash
 * over refracting glass read as a Material tap highlight.
 */
const FALLBACK_GLOW_ALPHA = 0.25;
const NATIVE_GLOW =
  supportsGlass && !(Platform.OS === "ios" && supportsNativeGlass);

const LiquidGlassButtonBase: React.FC<ILiquidGlassButtonProps> = ({
  onPress,
  onLongPress,
  disabled = false,
  loading = false,
  interactive = true,
  pressLight = BUTTON_PRESS_LIGHT,
  adaptive = false,
  tint,
  variant,
  metal,
  providerId,
  size = "regular",
  shape = "capsule",
  height: heightProp,
  icon,
  accessibilityLabel,
  accessibilityState,
  style,
  contentStyle,
  textStyle,
  children,
}: ILiquidGlassButtonProps): React.ReactElement => {
  const sizing = BUTTON_SIZES[size];
  const height = heightProp ?? sizing.height;
  const circular = shape === "circle";
  const radius = height / 2;

  // Adaptive: the label dresses for the polarity the glass settled on, crossfading between the
  // two palettes' labels in step with the native frost. Not adaptive: the scheme's label, as
  // before — the hook still mounts (hooks cannot be conditional) but its props stay unused.
  const adaptiveGlass = useAdaptiveGlass();
  const { colors } = useGlassUITheme(
    adaptive ? adaptiveGlass.scheme : undefined
  );
  const { progress, pressIn, pressOut } = usePressProgress(GLOW_SPRING);
  const labelColor = tint != null ? "#FFFFFF" : colors.label;

  const inert = disabled || loading;
  const jsPress = interactive && !inert;

  const handlePressIn = useCallback((): void => {
    if (jsPress) pressIn();
  }, [jsPress, pressIn]);
  const handlePressOut = useCallback((): void => {
    if (jsPress) pressOut();
  }, [jsPress, pressOut]);

  // The reference's jelly: while pressed, the button rubber-bands toward the finger and stretches
  // along the drag axis. A Manual gesture observes the touch stream without ever activating, so it
  // can neither steal a scroll nor cancel the Pressable underneath. The same channels feed the
  // press light's hotspot and — inside a `LiquidGlassGroup` — the group's canvas.
  const layoutWidth = useSharedValue(0);
  const layoutHeight = useSharedValue(height);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const pressX = useSharedValue(0);
  const pressY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const frameRef = useRef<RNView>(null);
  const membership = useGlassGroupMember(
    {
      progress,
      offsetX,
      offsetY,
      pressX,
      pressY,
      height,
      growth: BUTTON_PRESS_GROWTH,
      light: pressLight,
    },
    frameRef
  );
  const reportLayout = membership.onLayout;
  const handleLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      layoutWidth.value = event.nativeEvent.layout.width;
      layoutHeight.value = event.nativeEvent.layout.height;
      reportLayout(event, frameRef.current);
    },
    [layoutWidth, layoutHeight, reportLayout]
  );

  const jelly = useMemo(
    () =>
      Gesture.Manual()
        .enabled(jsPress)
        .onTouchesDown((event) => {
          const touch = event.allTouches[0];
          if (touch == null) return;
          startX.value = touch.absoluteX;
          startY.value = touch.absoluteY;
          pressX.value = touch.x;
          pressY.value = touch.y;
          offsetX.value = 0;
          offsetY.value = 0;
        })
        .onTouchesMove((event) => {
          const touch = event.allTouches[0];
          if (touch == null) return;
          offsetX.value = touch.absoluteX - startX.value;
          offsetY.value = touch.absoluteY - startY.value;
          pressX.value = touch.x;
          pressY.value = touch.y;
        })
        .onTouchesUp(() => {
          offsetX.value = withSpring(0, GLOW_SPRING);
          offsetY.value = withSpring(0, GLOW_SPRING);
        })
        .onTouchesCancelled(() => {
          offsetX.value = withSpring(0, GLOW_SPRING);
          offsetY.value = withSpring(0, GLOW_SPRING);
        }),
    [jsPress, startX, startY, offsetX, offsetY, pressX, pressY]
  );

  const pressStyle = useAnimatedStyle(() => {
    const t = buttonPressTransform(
      layoutWidth.value,
      layoutHeight.value,
      BUTTON_PRESS_GROWTH,
      progress.value,
      offsetX.value,
      offsetY.value
    );
    return {
      transform: [
        { translateX: t.translateX },
        { translateY: t.translateY },
        { scaleX: t.scaleX },
        { scaleY: t.scaleY },
      ],
    };
  });

  // `lens: true`: the finger dents the glass and boosts the lens under it — the press reads as
  // the pane bending, which is what makes it liquid rather than lit. The light itself is scaled
  // by `pressLight` (see the constant) so a capsule does not wash out flat.
  const glowProps = useAnimatedProps(() => ({
    glow: {
      progress: Math.max(0, progress.value) * pressLight,
      x: pressX.value,
      y: pressY.value,
      lens: true,
    },
  }));

  const fallbackGlowStyle = useAnimatedStyle(() => ({
    opacity: FALLBACK_GLOW_ALPHA * Math.max(0, progress.value) * pressLight,
  }));

  const paneStyle = useAnimatedStyle(() => ({
    opacity: membership.paneOpacity.value,
  }));

  /**
   * Inside a group, the pane hands its silhouette to the group's canvas for the duration of a
   * merge (see `useGlassGroupMember`). The canvas draws bare glass, so a tinted member would
   * lose its colour mid-press — this ghost is the tint as a flat wash, fading in exactly as the
   * pane fades out, so the colour stays on the merged pane. Only mounted where it can matter.
   */
  const ghostTint = tint != null && membership.inGroup && !membership.keepsPane;
  const ghostStyle = useAnimatedStyle(() => ({
    opacity: 1 - membership.paneOpacity.value,
  }));

  /**
   * The label's crossfade: the light palette's label at progress 0, the dark palette's at 1.
   * Only mounted on the adaptive path — a plain button keeps its static colour.
   */
  const adaptiveLabelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      adaptiveGlass.progress.value,
      [0, 1],
      [GLASS_UI_PALETTE.light.label, GLASS_UI_PALETTE.dark.label]
    ),
  }));

  const iconNode: React.ReactNode =
    typeof icon === "function"
      ? icon({ color: labelColor, size: sizing.iconSize })
      : icon;

  const content: React.ReactNode = useMemo(
    () =>
      React.Children.map(children, (child) =>
        typeof child === "string" || typeof child === "number" ? (
          adaptive && tint == null ? (
            <Animated.Text
              numberOfLines={1}
              style={[
                styles.label,
                { fontSize: sizing.fontSize },
                adaptiveLabelStyle,
                textStyle,
              ]}
            >
              {child}
            </Animated.Text>
          ) : (
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                { fontSize: sizing.fontSize, color: labelColor },
                textStyle,
              ]}
            >
              {child}
            </Text>
          )
        ) : (
          child
        )
      ),
    [
      adaptive,
      adaptiveLabelStyle,
      children,
      tint,
      labelColor,
      sizing.fontSize,
      textStyle,
    ]
  );

  return (
    <GestureDetector gesture={jelly}>
      <Pressable
        ref={frameRef}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{
          disabled: inert,
          busy: loading,
          ...accessibilityState,
        }}
        disabled={inert}
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onLayout={handleLayout}
        style={[
          circular ? { width: height } : null,
          disabled ? styles.disabled : null,
          style,
        ]}
      >
        <Animated.View style={pressStyle}>
          {/* The pane is its own layer under the content so a merge can fade it without touching
              the label — which stays legible on top of whichever pane is drawing. */}
          <Animated.View pointerEvents="none" style={[styles.pane, paneStyle]}>
            <AnimatedGlassView
              variant={variant}
              providerId={providerId}
              // The base view's own `interactive` is deliberately not used. Its press animator
              // read-modify-writes scaleX/scaleY/translationX/translationY — the exact properties
              // React Native's `transform` style writes — so it would fight the springs above, and
              // its geometry is its own (1.035x, tanh slope 0.12) rather than the reference's.
              cornerRadius={radius}
              cornerStyle="continuous"
              tint={tint}
              metal={metal ?? GLASS_BUTTON_METAL}
              {...(adaptive ? adaptiveGlass.glassProps : null)}
              animatedProps={NATIVE_GLOW ? glowProps : undefined}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          {ghostTint ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.ghost,
                { borderRadius: radius, backgroundColor: tint },
                ghostStyle,
              ]}
            />
          ) : null}
          {!NATIVE_GLOW ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.fallbackGlow,
                { borderRadius: radius },
                fallbackGlowStyle,
              ]}
            />
          ) : null}
          <View
            style={[
              styles.content,
              {
                height,
                paddingHorizontal: circular ? 0 : sizing.paddingHorizontal,
                width: circular ? height : undefined,
              },
              contentStyle,
            ]}
          >
            <View style={[styles.row, loading ? styles.hidden : null]}>
              {iconNode}
              {content}
            </View>
            {loading ? (
              <View style={styles.spinner} pointerEvents="none">
                <ActivityIndicator color={labelColor} />
              </View>
            ) : null}
          </View>
        </Animated.View>
      </Pressable>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  pane: {
    ...ABSOLUTE_FILL,
  },
  ghost: {
    ...ABSOLUTE_FILL,
  },
  fallbackGlow: {
    ...ABSOLUTE_FILL,
    backgroundColor: "#FFFFFF",
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: BUTTON_CONTENT_GAP,
  },
  hidden: {
    opacity: 0,
  },
  spinner: {
    ...ABSOLUTE_FILL,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontWeight: "600",
  },
  disabled: {
    opacity: 0.5,
  },
});

const LiquidGlassButton: React.NamedExoticComponent<ILiquidGlassButtonProps> =
  memo<ILiquidGlassButtonProps>(LiquidGlassButtonBase);
LiquidGlassButton.displayName = "LiquidGlassButton";

export { LiquidGlassButton };
