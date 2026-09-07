import type { RefObject } from "react";
import { useCallback, useContext, useLayoutEffect, useRef } from "react";
import type { LayoutChangeEvent, View as RNView } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import { useDerivedValue, useSharedValue } from "react-native-reanimated";

import { GlassGroupContext } from "../context";
import type { IGlassGroupMember, IGlassGroupRect } from "../context";

interface IGlassGroupMembership {
  /** Whether a `LiquidGlassGroup` is above this control. */
  inGroup: boolean;
  /**
   * Whether the pane should stay put — because the system merges natively (iOS 26), or because
   * there is no group at all. When false the pane crossfades to the group's canvas while
   * involved in a merge.
   */
  keepsPane: boolean;
  /** This member's slot, on the UI thread; -1 until registered. */
  slot: SharedValue<number>;
  /**
   * Attach to the member's outermost, untransformed view. Pass that view's instance too (or
   * give the hook a `frameRef`): the frame is then measured against the group's row, so a
   * wrapper between the two does not put the canvas pane in the wrong place.
   */
  onLayout: (event: LayoutChangeEvent, node?: RNView | null) => void;
  /**
   * Opacity for the member's own glass pane: 1 normally, `1 - activeProgress` while this member
   * is the pressed one or its partner — the canvas is drawing both silhouettes for the duration.
   */
  paneOpacity: SharedValue<number>;
}

type TMeasurable = {
  measureLayout?: (
    relativeTo: unknown,
    onSuccess: (x: number, y: number, width: number, height: number) => void,
    onFail?: () => void
  ) => void;
};

/**
 * The member half of `LiquidGlassGroup`: registers the control's press channels with the group
 * above it (if any), reports its frame, and hands back the opacity its own pane should wear.
 *
 * Every hook here mounts whether or not a group exists, so a control can be written once; outside
 * a group `paneOpacity` is a constant 1 and `onLayout` is a no-op.
 */
function useGlassGroupMember(
  member: IGlassGroupMember,
  frameRef?: RefObject<RNView | null>
): IGlassGroupMembership {
  const group = useContext(GlassGroupContext);
  const slot = useSharedValue(-1);
  const slotRef = useRef(-1);
  const { progress, offsetX, offsetY, pressX, pressY, height, growth, light } =
    member;

  /** The frame measured against the group's row, with the layout event's numbers as fallback. */
  const report = useCallback(
    (
      assigned: number,
      node: RNView | null | undefined,
      fallback?: IGlassGroupRect
    ): void => {
      if (group == null) return;
      const host = group.hostRef.current;
      const measurable = node as unknown as TMeasurable | null | undefined;
      if (host != null && measurable?.measureLayout != null) {
        measurable.measureLayout(
          host,
          (mx, my, mw, mh) => {
            if (mw > 0 && mh > 0) {
              group.setRect(assigned, { x: mx, y: my, w: mw, h: mh });
            } else if (fallback != null) {
              group.setRect(assigned, fallback);
            }
          },
          () => {
            if (fallback != null) group.setRect(assigned, fallback);
          }
        );
        return;
      }
      if (fallback != null) group.setRect(assigned, fallback);
    },
    [group]
  );

  useLayoutEffect(() => {
    if (group == null) return undefined;
    const assigned = group.register({
      progress,
      offsetX,
      offsetY,
      pressX,
      pressY,
      height,
      growth,
      light,
    });
    slotRef.current = assigned;
    slot.value = assigned;
    // A re-registration (a prop in the deps changed, or a refresh) gets a new slot but no new
    // layout event, so the frame is measured here as well; on first mount the view has no
    // size yet and the layout event that follows fills it in.
    report(assigned, frameRef?.current);
    return () => {
      group.unregister(assigned);
      slotRef.current = -1;
      slot.value = -1;
    };
  }, [
    group,
    progress,
    offsetX,
    offsetY,
    pressX,
    pressY,
    height,
    growth,
    light,
    slot,
    report,
    frameRef,
  ]);

  const onLayout = useCallback(
    (event: LayoutChangeEvent, node?: RNView | null): void => {
      if (group == null || slotRef.current < 0) return;
      const { x, y, width: w, height: h } = event.nativeEvent.layout;
      report(slotRef.current, node ?? frameRef?.current, { x, y, w, h });
    },
    [group, report, frameRef]
  );

  const keepsPane = group == null || group.native;
  const activeSlot = group?.activeSlot;
  const targetSlot = group?.targetSlot;
  const activeProgress = group?.activeProgress;

  const paneOpacity = useDerivedValue(() => {
    if (
      keepsPane ||
      activeSlot == null ||
      targetSlot == null ||
      activeProgress == null
    ) {
      return 1;
    }
    const mine = slot.value;
    const involved =
      mine >= 0 && (activeSlot.value === mine || targetSlot.value === mine);
    if (!involved) return 1;
    // The press spring overshoots on both ends; the pane must not wrap around.
    return Math.min(1, Math.max(0, 1 - activeProgress.value));
  }, [keepsPane, activeSlot, targetSlot, activeProgress, slot]);

  return {
    inGroup: group != null,
    keepsPane,
    slot,
    onLayout,
    paneOpacity,
  };
}

export { useGlassGroupMember };
export type { IGlassGroupMembership };
