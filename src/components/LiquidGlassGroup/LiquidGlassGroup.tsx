import * as React from "react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import type { View as RNView } from "react-native";
import { Platform, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
} from "react-native-reanimated";

import {
  GLASS_BUTTON_METAL,
  GROUP_GAP,
  GROUP_OVERHANG,
  GROUP_SPACING,
} from "../../constants";
import { GlassGroupContext } from "../../context";
import type {
  IGlassGroupContext,
  IGlassGroupMember,
  IGlassGroupRect,
} from "../../context";
import {
  LiquidGlassContainer,
  LiquidGlassView,
  supportsGlass,
  supportsNativeGlass,
} from "../../core";
import type { GlassMetalOptions } from "../../core";
import type { ILiquidGlassGroupProps } from "../../interfaces";
import { buttonPressTransform } from "../../utils";

/**
 * iOS 26's `GlassEffectContainer`, for the kit's controls: buttons, icon buttons and chips laid
 * out together, and a press on any of them fuses it into its nearest neighbour like liquid — the
 * pressed capsule inflates and rubber-bands as it always did, and where it comes within
 * `spacing` of the next one the two silhouettes neck together into one pane, separating again
 * as the press lets go. That is how liquid glass behaves: near things are one thing.
 *
 * Three renderers, one behaviour:
 *
 * - **Shader renderers** (Android `agsl`, iOS Metal — iOS 15.1–25 or `renderer="metal"`): a
 *   *canvas* glass view lies UNDER the row, spanning it plus an overhang. While a member is
 *   pressed, its own pane and its partner's crossfade out and the canvas takes over both
 *   silhouettes — `metal.shape` is the pressed member, redrawn from the very same press
 *   channels its pane is transformed by, `metal.morph` the neighbour — so refraction, the rim
 *   and the press light bend around the *merged* outline. Labels live above both layers.
 * - **iOS 26 native**: the row is wrapped in `LiquidGlassContainer` (`UIGlassContainerEffect`,
 *   `spacing`) and the system's own merge takes over; the canvas never mounts and the members
 *   keep their panes.
 * - **No glass at all**: a plain row; the members are plain washed views and nothing merges.
 *
 * Membership is by context: `useGlassGroupMember` in a control registers its press channels and
 * reports its frame, and the group does the rest. Anything else can sit in the row untouched.
 */
const NATIVE_MERGE = Platform.OS === "ios" && supportsNativeGlass;

const AnimatedGlassView = Animated.createAnimatedComponent(LiquidGlassView);

interface ISlotMember extends IGlassGroupMember {
  slot: number;
}

interface IPaneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The pressed member's silhouette right now — inflated, carried and stretched with its pane. */
const pressedRect = (r: IGlassGroupRect, m: IGlassGroupMember): IPaneRect => {
  "worklet";
  const t = buttonPressTransform(
    r.w,
    r.h,
    m.growth,
    m.progress.value,
    m.offsetX.value,
    m.offsetY.value
  );
  const w = r.w * t.scaleX;
  const h = r.h * t.scaleY;
  return {
    x: r.x + r.w / 2 + t.translateX - w / 2,
    y: r.y + r.h / 2 + t.translateY - h / 2,
    w,
    h,
  };
};

/**
 * A near-zero shape draws nothing. Deliberately not zero and not absent: absent means "fill the
 * view", zero resolves to absent natively — and a canvas-filling pane is the one thing this must
 * never be, even behind the wrapper's opacity 0.
 */
const NO_SHAPE = { x: 0, y: 0, width: 0.01, height: 0.01 };

const LiquidGlassGroupBase: React.FC<ILiquidGlassGroupProps> = ({
  spacing = GROUP_SPACING,
  gap = GROUP_GAP,
  direction = "row",
  metal,
  tint,
  providerId,
  style,
  children,
}: ILiquidGlassGroupProps): React.ReactElement => {
  const [members, setMembers] = useState<ISlotMember[]>([]);
  const nextSlot = useRef(0);
  const hostRef = useRef<RNView>(null);
  const rects = useSharedValue<(IGlassGroupRect | undefined)[]>([]);

  const register = useCallback((member: IGlassGroupMember): number => {
    const slot = nextSlot.current;
    nextSlot.current += 1;
    setMembers((list) => [...list, { ...member, slot }]);
    return slot;
  }, []);

  const unregister = useCallback(
    (slot: number): void => {
      setMembers((list) => list.filter((m) => m.slot !== slot));
      rects.modify((list) => {
        "worklet";
        list[slot] = undefined;
        return list;
      });
    },
    [rects]
  );

  // `modify`, never a JS read-modify-write: the layout events of one commit each start from the
  // same stale array otherwise and the last one wins — see LiquidGlassMorphGroup.
  const setRect = useCallback(
    (slot: number, rect: IGlassGroupRect): void => {
      rects.modify((list) => {
        "worklet";
        list[slot] = rect;
        return list;
      });
    },
    [rects]
  );

  const activeSlot = useDerivedValue(() => {
    let best = -1;
    let bestProgress = 0.001;
    for (let i = 0; i < members.length; i += 1) {
      const m = members[i];
      if (m == null) continue;
      const p = m.progress.value;
      if (p > bestProgress) {
        bestProgress = p;
        best = m.slot;
      }
    }
    return best;
  }, [members]);

  const activeProgress = useDerivedValue(() => {
    const s = activeSlot.value;
    if (s < 0) return 0;
    for (let i = 0; i < members.length; i += 1) {
      const m = members[i];
      if (m != null && m.slot === s) return m.progress.value;
    }
    return 0;
  }, [members]);

  // The partner: the nearest member whose edge lies within `spacing` of the pressed silhouette.
  // Edge distance, not centre distance — a tall member next to a wide one merges just the same —
  // and a neighbour further than the smooth-min can reach stays out of the crossfade entirely.
  const targetSlot = useDerivedValue(() => {
    const s = activeSlot.value;
    if (s < 0) return -1;
    const list = rects.value;
    const r = list[s];
    if (r == null) return -1;
    let active: IGlassGroupMember | undefined;
    for (let i = 0; i < members.length; i += 1) {
      const m = members[i];
      if (m != null && m.slot === s) active = m;
    }
    if (active == null) return -1;
    const p = pressedRect(r, active);
    let best = -1;
    let bestGap = spacing;
    for (let k = 0; k < list.length; k += 1) {
      if (k === s) continue;
      const o = list[k];
      if (o == null) continue;
      const dx = Math.max(0, o.x - (p.x + p.w), p.x - (o.x + o.w));
      const dy = Math.max(0, o.y - (p.y + p.h), p.y - (o.y + o.h));
      const edgeGap = Math.max(dx, dy);
      if (edgeGap <= bestGap) {
        bestGap = edgeGap;
        best = k;
      }
    }
    return best;
  }, [members, spacing]);

  // The canvas draws capsules of the members' own material; the drawn border stays off because
  // it would ring the whole canvas, not the silhouettes. The shader's own rim light survives.
  const canvasMetal = useMemo<GlassMetalOptions>(
    () => ({
      ...(metal ?? GLASS_BUTTON_METAL),
      border: { width: 0, opacity: 0 },
    }),
    [metal]
  );

  // One radius for the canvas, and the shader clamps it to each shape's half-height — so the
  // tallest member's capsule radius gives every member a capsule, whatever its height.
  const canvasRadius = useMemo(
    () => members.reduce((r, m) => Math.max(r, m.height), 1) / 2,
    [members]
  );

  const canvasProps = useAnimatedProps(() => {
    const s = activeSlot.value;
    const list = rects.value;
    const r = s >= 0 ? list[s] : undefined;
    let active: IGlassGroupMember | undefined;
    for (let i = 0; i < members.length; i += 1) {
      const m = members[i];
      if (m != null && m.slot === s) active = m;
    }
    if (r == null || active == null) {
      return {
        metal: { ...canvasMetal, shape: NO_SHAPE, morph: undefined },
        glow: { progress: 0, x: 0, y: 0, lens: false },
      };
    }
    const p = pressedRect(r, active);
    const shape = {
      x: GROUP_OVERHANG + p.x,
      y: GROUP_OVERHANG + p.y,
      width: p.w,
      height: p.h,
    };
    const t = targetSlot.value;
    const o = t >= 0 ? list[t] : undefined;
    const morph =
      o == null
        ? undefined
        : {
            x: GROUP_OVERHANG + o.x,
            y: GROUP_OVERHANG + o.y,
            width: o.w,
            height: o.h,
            cornerRadius: o.h / 2,
            smoothing: spacing,
          };
    // The press light rides the canvas too, so it is not lost with the pane it started on.
    // The hotspot follows the carried pane: finger position, plus the rubber band's travel.
    return {
      metal: { ...canvasMetal, shape, morph },
      glow: {
        progress:
          Math.min(1, Math.max(0, active.progress.value)) * active.light,
        x: GROUP_OVERHANG + r.x + (p.x - r.x) + active.pressX.value,
        y: GROUP_OVERHANG + r.y + (p.y - r.y) + active.pressY.value,
        lens: true,
      },
    };
  }, [members, spacing, canvasMetal]);

  // Wrapper opacity, not metal.opacity: it holds on every renderer the canvas could resolve to.
  const canvasFade = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, activeProgress.value)),
  }));

  const context = useMemo<IGlassGroupContext>(
    () => ({
      native: NATIVE_MERGE,
      hostRef,
      register,
      unregister,
      setRect,
      activeSlot,
      targetSlot,
      activeProgress,
    }),
    [register, unregister, setRect, activeSlot, targetSlot, activeProgress]
  );

  const row = (
    <View
      ref={hostRef}
      style={[
        styles.row,
        direction === "column" ? styles.column : null,
        { gap },
        style,
      ]}
    >
      {supportsGlass && !NATIVE_MERGE ? (
        <Animated.View pointerEvents="none" style={[styles.canvas, canvasFade]}>
          <AnimatedGlassView
            renderer="metal"
            providerId={providerId}
            cornerRadius={canvasRadius}
            cornerStyle="continuous"
            tint={tint}
            animatedProps={canvasProps}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
      {children}
    </View>
  );

  return (
    <GlassGroupContext.Provider value={context}>
      {NATIVE_MERGE ? (
        <LiquidGlassContainer spacing={spacing}>{row}</LiquidGlassContainer>
      ) : (
        row
      )}
    </GlassGroupContext.Provider>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  column: {
    flexDirection: "column",
    alignItems: "stretch",
  },
  canvas: {
    position: "absolute",
    top: -GROUP_OVERHANG,
    left: -GROUP_OVERHANG,
    right: -GROUP_OVERHANG,
    bottom: -GROUP_OVERHANG,
  },
});

const LiquidGlassGroup: React.NamedExoticComponent<ILiquidGlassGroupProps> =
  memo<ILiquidGlassGroupProps>(LiquidGlassGroupBase);
LiquidGlassGroup.displayName = "LiquidGlassGroup";

export { LiquidGlassGroup };
