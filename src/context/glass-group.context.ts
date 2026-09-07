import type { RefObject } from "react";
import { createContext } from "react";
import type { View as RNView } from "react-native";
import type { SharedValue } from "react-native-reanimated";

/** A member's frame in the group's own coordinates, dp — what `onLayout` reports. */
interface IGlassGroupRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * What a member hands the group when it joins: the shared values its own press is driven by, so
 * the group's canvas can redraw the member's silhouette — inflated, carried, stretched — from
 * exactly the inputs the member's pane is transformed by, one frame at a time, with no JS.
 */
interface IGlassGroupMember {
  /** Press progress, 0 at rest → 1 held. */
  progress: SharedValue<number>;
  /** The finger's travel since it landed, dp — the rubber band's inputs. */
  offsetX: SharedValue<number>;
  offsetY: SharedValue<number>;
  /** Where the finger landed, member-local dp — the press light's hotspot. */
  pressX: SharedValue<number>;
  pressY: SharedValue<number>;
  /** The member's height, which its press growth is expressed as a fraction of. */
  height: number;
  /** How many dp of height the member grows by at full press. */
  growth: number;
  /** The member's press light, 0..1 — the canvas lights the merged pane by the same amount. */
  light: number;
}

interface IGlassGroupContext {
  /**
   * The system is doing the merging (iOS 26's `UIGlassContainerEffect`): members keep their own
   * panes and there is no canvas to hand them to.
   */
  native: boolean;
  /** The group's row — what member frames are measured against. */
  hostRef: RefObject<RNView | null>;
  /** Join. Returns the member's slot — its index into the group's rect table. */
  register: (member: IGlassGroupMember) => number;
  unregister: (slot: number) => void;
  /** Report a laid-out frame, group-local dp. UI-thread write; safe from `onLayout`. */
  setRect: (slot: number, rect: IGlassGroupRect) => void;
  /** The pressed member, or -1. */
  activeSlot: SharedValue<number>;
  /** The member the pressed one is fusing with, or -1. */
  targetSlot: SharedValue<number>;
  /** The pressed member's progress — what both involved panes fade out by. */
  activeProgress: SharedValue<number>;
}

/**
 * Supplied by `LiquidGlassGroup`; read by the kit's controls, which hand their silhouette to the
 * group's canvas while pressed so a press merges into the neighbour like liquid. `null` outside
 * any group — a control on its own draws its own pane and nothing changes.
 */
const GlassGroupContext = createContext<IGlassGroupContext | null>(null);

export { GlassGroupContext };
export type { IGlassGroupContext, IGlassGroupMember, IGlassGroupRect };
