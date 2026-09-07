import * as React from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import {
  ABSOLUTE_FILL,
  GLASS_PANEL_METAL,
  PANEL_SPRING,
  SHEET_CORNER_RADIUS,
  SHEET_DIM_OPACITY,
  SHEET_DISMISS_FRACTION,
  SHEET_DISMISS_VELOCITY,
  SHEET_HANDLE_AREA_HEIGHT,
  SHEET_HANDLE_HEIGHT,
  SHEET_HANDLE_WIDTH,
  SHEET_OVERDRAG_RESISTANCE,
  VALUE_SPRING,
} from "../../constants";
import { LiquidGlassView } from "../../core";
import type { ILiquidGlassSheetProps } from "../../interfaces";
import { useGlassUITheme } from "../../theme";

/** How far the pane extends below its parent, so an upward overdrag never shows a gap. */
const BOTTOM_BLEED = 48;
const DEFAULT_HEIGHT = 420;

/**
 * A bottom sheet in glass: the bar's material with only its top corners rounded, a grab handle,
 * a dim behind it, and a drag that follows the finger — with resistance past the top — and
 * decides on release: dropped past 30 % of its height or flung down, the sheet asks to go;
 * anywhere else it springs back up on the panel spring.
 *
 * Controlled, like the toast: the app owns `visible` and hears `onDismiss`. It stays mounted
 * through its exit so the slide finishes, and the dim fades with the sheet's own travel rather
 * than on a clock of its own.
 *
 * Positioned absolutely at the bottom of its parent — render it last, as a sibling of the
 * provider on Android. Scrollable content inside should be short enough not to fight the drag,
 * or wrapped in a handler that yields vertical pans to it.
 */
const LiquidGlassSheetBase: React.FC<ILiquidGlassSheetProps> = ({
  visible,
  onDismiss,
  height = DEFAULT_HEIGHT,
  cornerRadius = SHEET_CORNER_RADIUS,
  handle = true,
  dim = SHEET_DIM_OPACITY,
  dismissOnTap = true,
  tint,
  variant,
  metal,
  providerId,
  style,
  contentStyle,
  children,
}: ILiquidGlassSheetProps): React.ReactElement | null => {
  const { colors } = useGlassUITheme();
  // Mounted while visible, and through the exit slide after that — the spring's completion
  // unmounts. Re-showing mid-exit is derived here rather than in an effect.
  const [rendered, setRendered] = useState(visible);
  if (visible && !rendered) setRendered(true);
  /** 0 fully up; `height` fully hidden. */
  const y = useSharedValue(visible ? 0 : height);
  const dragStart = useSharedValue(0);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  const unmount = useCallback((): void => setRendered(false), []);
  const requestDismiss = useCallback((): void => {
    dismissRef.current?.();
  }, []);

  useEffect(() => {
    if (visible) {
      y.value = withSpring(0, PANEL_SPRING);
      return;
    }
    y.value = withSpring(height, VALUE_SPRING, (finished) => {
      if (finished) runOnJS(unmount)();
    });
  }, [height, unmount, visible, y]);

  const pan = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .onBegin(() => {
      dragStart.value = y.value;
    })
    .onChange((event) => {
      const raw = dragStart.value + event.translationY;
      y.value = raw < 0 ? raw / SHEET_OVERDRAG_RESISTANCE : raw;
    })
    .onEnd((event) => {
      const leaving =
        y.value > height * SHEET_DISMISS_FRACTION ||
        event.velocityY > SHEET_DISMISS_VELOCITY;
      if (leaving) {
        y.value = withSpring(height, VALUE_SPRING);
        runOnJS(requestDismiss)();
      } else {
        y.value = withSpring(0, PANEL_SPRING);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
  }));
  const dimStyle = useAnimatedStyle(() => ({
    opacity: dim * Math.min(1, Math.max(0, 1 - y.value / height)),
  }));

  if (!rendered) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {dim > 0 ? (
        <Animated.View style={[styles.dim, dimStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            disabled={!dismissOnTap}
            onPress={requestDismiss}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            styles.sheet,
            { height: height + BOTTOM_BLEED, bottom: -BOTTOM_BLEED },
            sheetStyle,
            style,
          ]}
        >
          <LiquidGlassView
            variant={variant}
            providerId={providerId}
            cornerRadius={{
              topLeft: cornerRadius,
              topRight: cornerRadius,
              bottomLeft: 0,
              bottomRight: 0,
            }}
            cornerStyle="continuous"
            tint={tint ?? colors.tabBarSurface}
            metal={metal ?? GLASS_PANEL_METAL}
            style={styles.glass}
            containerStyle={styles.fill}
          >
            {handle ? (
              <View style={styles.handleArea}>
                <View
                  style={[styles.handle, { backgroundColor: colors.inactive }]}
                />
              </View>
            ) : null}
            <View
              style={[
                styles.content,
                { paddingBottom: BOTTOM_BLEED + 16 },
                contentStyle,
              ]}
            >
              {children}
            </View>
          </LiquidGlassView>
        </Animated.View>
      </GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create({
  dim: {
    ...ABSOLUTE_FILL,
    backgroundColor: "#000000",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  glass: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
  handleArea: {
    height: SHEET_HANDLE_AREA_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  handle: {
    width: SHEET_HANDLE_WIDTH,
    height: SHEET_HANDLE_HEIGHT,
    borderRadius: SHEET_HANDLE_HEIGHT / 2,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
});

const LiquidGlassSheet: React.NamedExoticComponent<ILiquidGlassSheetProps> =
  memo<ILiquidGlassSheetProps>(LiquidGlassSheetBase);
LiquidGlassSheet.displayName = "LiquidGlassSheet";

export { LiquidGlassSheet };
