import * as React from "react";
import { memo, useCallback, useMemo } from "react";
import type { LayoutChangeEvent } from "react-native";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import type { GlassMetalOptions } from "../../core";
import {
  LiquidGlassContainer,
  LiquidGlassView,
  supportsNativeGlass,
} from "../../core";

import {
  ABSOLUTE_FILL,
  GLASS_BUTTON_METAL,
  MORPH_GROUP_BLOOM,
  MORPH_GROUP_GAP,
  MORPH_GROUP_OVERHANG,
  MORPH_GROUP_SPACING,
  BUTTON_HEIGHT,
  PRESS_SPRING,
  VALUE_SPRING,
} from "../../constants";
import { usePressProgress } from "../../hooks";
import type {
  ILiquidGlassMorphGroupProps,
  ILiquidGlassMorphItem,
} from "../../interfaces";
import { useGlassUITheme } from "../../theme";

/**
 * The iOS 26 stretch-merge: drag a capsule toward its neighbour and the two fuse like liquid;
 * release over it and they merge (the app decides what that means via `onMerge`), release
 * anywhere else and everything springs home.
 *
 * Three renderers, one behaviour:
 *
 * - **Shader renderers** (Android `agsl`, iOS Metal — so iOS 15.1–25, or `renderer="metal"`):
 *   a *canvas* glass view lies UNDER the row, spanning it plus an overhang so a dragged capsule
 *   has room to travel. During a drag the two participating capsules' own panes crossfade out
 *   and the canvas takes over both silhouettes — `metal.shape` is the dragged capsule riding the
 *   finger, `metal.morph` the nearest neighbour — so refraction and the rim bend around the
 *   *merged* outline, which is what reads as one pane of liquid necking apart. Labels live above
 *   both layers and never blur.
 * - **iOS 26 native**: the row is wrapped in `LiquidGlassContainer` (`UIGlassContainerEffect`,
 *   `spacing`) and the system's own merge takes over; the canvas never mounts.
 * - **No glass at all**: capsules are plain washed views; the drag, springs and `onMerge` all
 *   still work — the morph is a garnish, never the mechanism.
 */
interface IRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const NATIVE_MORPH = Platform.OS === "ios" && supportsNativeGlass;

interface IMorphItemProps {
  item: ILiquidGlassMorphItem;
  index: number;
  height: number;
  tint: ILiquidGlassMorphGroupProps["tint"];
  variant: ILiquidGlassMorphGroupProps["variant"];
  paneMetal: GlassMetalOptions;
  providerId: ILiquidGlassMorphGroupProps["providerId"];
  textStyle: ILiquidGlassMorphGroupProps["textStyle"];
  labelColor: string;
  activeIdx: SharedValue<number>;
  targetIdx: SharedValue<number>;
  progress: SharedValue<number>;
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  onRect: (index: number, rect: IRect) => void;
  onGrab: () => void;
  onRelease: () => void;
  onDrop: (index: number) => void;
  onTap: (key: string) => void;
}

/** One capsule: its own pane, its content, and the pan that can carry it away. */
const MorphItem: React.FC<IMorphItemProps> = ({
  item,
  index,
  height,
  tint,
  variant,
  paneMetal,
  providerId,
  textStyle,
  labelColor,
  activeIdx,
  targetIdx,
  progress,
  tx,
  ty,
  onRect,
  onGrab,
  onRelease,
  onDrop,
  onTap,
}: IMorphItemProps): React.ReactElement => {
  const handleLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      const { x, y, width: w, height: h } = event.nativeEvent.layout;
      onRect(index, { x, y, w, h });
    },
    [index, onRect],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-6, 6])
        .activeOffsetY([-6, 6])
        .onStart(() => {
          activeIdx.value = index;
          tx.value = 0;
          ty.value = 0;
          onGrab();
        })
        .onChange((event) => {
          tx.value += event.changeX;
          ty.value += event.changeY;
        })
        .onEnd(() => {
          // Released over the neighbour = merged. The centre-in-rect test, not overlap area:
          // it matches where the eye says the capsule "is".
          const drop = targetIdx.value;
          if (drop >= 0) onDrop(drop);
        })
        .onFinalize(() => {
          // activeIdx is deliberately NOT reset: the pane's crossfade and the canvas both key
          // off it while the release springs play out, and the next grab overwrites it anyway.
          tx.value = withSpring(0, VALUE_SPRING);
          ty.value = withSpring(0, VALUE_SPRING);
          onRelease();
        }),
    [activeIdx, index, tx, ty, onGrab, onRelease, onDrop, targetIdx],
  );

  // The two participating panes hand their silhouettes to the canvas for the duration of the
  // gesture; everyone else keeps their own pane.
  const paneStyle = useAnimatedStyle(() => {
    const involved =
      activeIdx.value === index ||
      (activeIdx.value >= 0 && targetIdx.value === index);
    return { opacity: NATIVE_MORPH || !involved ? 1 : 1 - progress.value };
  });

  const moveStyle = useAnimatedStyle(() => ({
    transform:
      activeIdx.value === index
        ? [{ translateX: tx.value }, { translateY: ty.value }]
        : [{ translateX: 0 }, { translateY: 0 }],
  }));

  const handlePress = useCallback((): void => {
    item.onPress?.();
    onTap(item.key);
  }, [item, onTap]);

  return (
    <GestureDetector gesture={pan}>
      <Animated.View onLayout={handleLayout} style={moveStyle}>
        <Pressable accessibilityRole="button" onPress={handlePress}>
          <Animated.View style={paneStyle}>
            <LiquidGlassView
              variant={variant}
              providerId={providerId}
              cornerRadius={height / 2}
              cornerStyle="continuous"
              tint={tint}
              metal={paneMetal}
              style={[styles.pane, { height, borderRadius: height / 2 }]}
            />
          </Animated.View>
          <View style={[styles.content, { height }]}>
            {item.icon}
            {item.label != null ? (
              <Text style={[styles.label, { color: labelColor }, textStyle]}>
                {item.label}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
};

const AnimatedGlassView = Animated.createAnimatedComponent(LiquidGlassView);

const LiquidGlassMorphGroupBase: React.FC<ILiquidGlassMorphGroupProps> = ({
  items,
  onMerge,
  onItemPress,
  spacing = MORPH_GROUP_SPACING,
  gap = MORPH_GROUP_GAP,
  height = BUTTON_HEIGHT,
  tint,
  variant,
  metal,
  providerId,
  style,
  textStyle,
}: ILiquidGlassMorphGroupProps): React.ReactElement => {
  const { colors } = useGlassUITheme();
  const labelColor = tint != null ? "#FFFFFF" : colors.label;

  const paneMetal = metal ?? GLASS_BUTTON_METAL;
  // The canvas draws two capsules of the same material; the drawn border stays off because it
  // would ring the whole canvas, not the silhouettes. The shader's own rim light survives.
  const canvasMetal = useMemo<GlassMetalOptions>(
    () => ({ ...paneMetal, border: { width: 0, opacity: 0 } }),
    [paneMetal],
  );

  const rects = useSharedValue<(IRect | undefined)[]>([]);
  const activeIdx = useSharedValue(-1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const press = usePressProgress(PRESS_SPRING);

  const targetIdx = useDerivedValue(() => {
    const i = activeIdx.value;
    const list = rects.value;
    if (i < 0 || list.length < 2) return -1;
    const r = list[i];
    if (r == null) return -1;
    const cx = r.x + tx.value + r.w / 2;
    const cy = r.y + ty.value + r.h / 2;
    let best = -1;
    let bestD = Number.MAX_VALUE;
    for (let k = 0; k < list.length; k += 1) {
      if (k === i) continue;
      const o = list[k];
      if (o == null) continue;
      const dx = o.x + o.w / 2 - cx;
      const dy = o.y + o.h / 2 - cy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
  });

  const canvasProps = useAnimatedProps(() => {
    const i = activeIdx.value;
    const list = rects.value;
    const r = i >= 0 ? list[i] : undefined;
    if (r == null) {
      // A near-zero shape draws nothing. Deliberately not zero and not absent: absent means
      // "fill the view", zero resolves to absent natively — and a canvas-filling pane is the
      // one thing this must never be, even behind the wrapper's opacity 0.
      return {
        metal: { ...canvasMetal, shape: { x: 0, y: 0, width: 0.01, height: 0.01 } },
      };
    }
    const bloom = MORPH_GROUP_BLOOM * press.progress.value;
    const shape = {
      x: MORPH_GROUP_OVERHANG + r.x + tx.value - bloom / 2,
      y: MORPH_GROUP_OVERHANG + r.y + ty.value - bloom / 2,
      width: r.w + bloom,
      height: r.h + bloom,
    };
    const t = targetIdx.value >= 0 ? list[targetIdx.value] : undefined;
    const morph =
      t == null
        ? undefined
        : {
            x: MORPH_GROUP_OVERHANG + t.x,
            y: MORPH_GROUP_OVERHANG + t.y,
            width: t.w,
            height: t.h,
            cornerRadius: t.h / 2,
            smoothing: spacing,
          };
    return { metal: { ...canvasMetal, shape, morph } };
  });

  // Wrapper opacity, not metal.opacity: it holds on every renderer the canvas could resolve
  // to — including a blur or plain-View degrade, where a visible full-canvas rectangle would be
  // the failure mode.
  const canvasFade = useAnimatedStyle(() => ({
    opacity: NATIVE_MORPH ? 0 : press.progress.value,
  }));

  const handleRect = useCallback(
    (index: number, rect: IRect): void => {
      // `modify` runs on the UI thread against the UI thread's current array. A JS-side
      // read-modify-write (`rects.value = [...rects.value]`) cannot work here: Reanimated 4's JS
      // setter only schedules the write, and the getter hands back the last value the UI thread
      // published, so the three onLayout calls of one commit each start from the same stale array
      // and the last one wins — the dragged pill then has no rect and no target, ever.
      rects.modify((list) => {
        "worklet";
        list[index] = rect;
        return list;
      });
    },
    [rects],
  );

  const fireMerge = useCallback(
    (fromIdx: number, toIdx: number): void => {
      const from = items[fromIdx]?.key;
      const to = items[toIdx]?.key;
      if (from != null && to != null && from !== to) onMerge?.(from, to);
    },
    [items, onMerge],
  );

  const handleDrop = useCallback(
    (toIdx: number): void => {
      "worklet";
      const i = activeIdx.value;
      const list = rects.value;
      const r = i >= 0 ? list[i] : undefined;
      const t = list[toIdx];
      if (r == null || t == null) return;
      const cx = r.x + tx.value + r.w / 2;
      const cy = r.y + ty.value + r.h / 2;
      if (cx >= t.x && cx <= t.x + t.w && cy >= t.y && cy <= t.y + t.h) {
        runOnJS(fireMerge)(i, toIdx);
      }
    },
    [activeIdx, rects, tx, ty, fireMerge],
  );

  const handleTap = useCallback(
    (key: string): void => {
      onItemPress?.(key);
    },
    [onItemPress],
  );

  const row = (
    <View style={[styles.row, { gap }, style]}>
      {!NATIVE_MORPH ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.canvas, canvasFade]}
        >
          <AnimatedGlassView
            renderer="metal"
            providerId={providerId}
            cornerRadius={height / 2}
            cornerStyle="continuous"
            tint={tint}
            animatedProps={canvasProps}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
      {items.map((item, index) => (
        <MorphItem
          key={item.key}
          item={item}
          index={index}
          height={height}
          tint={tint}
          variant={variant}
          paneMetal={paneMetal}
          providerId={providerId}
          textStyle={textStyle}
          labelColor={labelColor}
          activeIdx={activeIdx}
          targetIdx={targetIdx}
          progress={press.progress}
          tx={tx}
          ty={ty}
          onRect={handleRect}
          onGrab={press.pressIn}
          onRelease={press.pressOut}
          onDrop={handleDrop}
          onTap={handleTap}
        />
      ))}
    </View>
  );

  // iOS 26: the system's own container merge. `spacing` keeps the same meaning on every path.
  return NATIVE_MORPH ? (
    <LiquidGlassContainer spacing={spacing}>{row}</LiquidGlassContainer>
  ) : (
    row
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  canvas: {
    position: "absolute",
    top: -MORPH_GROUP_OVERHANG,
    left: -MORPH_GROUP_OVERHANG,
    right: -MORPH_GROUP_OVERHANG,
    bottom: -MORPH_GROUP_OVERHANG,
  },
  pane: {
    ...ABSOLUTE_FILL,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    gap: 8,
  },
  label: {
    fontSize: 17,
    fontWeight: "600",
  },
});

const LiquidGlassMorphGroup: React.NamedExoticComponent<ILiquidGlassMorphGroupProps> =
  memo<ILiquidGlassMorphGroupProps>(LiquidGlassMorphGroupBase);
LiquidGlassMorphGroup.displayName = "LiquidGlassMorphGroup";

export { LiquidGlassMorphGroup };
