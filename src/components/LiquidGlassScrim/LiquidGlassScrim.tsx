import * as React from "react";
import { memo, useMemo } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet } from "react-native";
import type { GlassMetalOptions } from "../../core";
import { LiquidGlassView } from "../../core";

import type { ILiquidGlassScrimProps } from "../../interfaces";

/**
 * The scroll-edge melt: content slides under it sharp and dissolves into blur toward the screen
 * edge — iOS 26's progressive scroll-edge treatment, as one drop-in view.
 *
 * A scrim, not a lens: every optical channel is zeroed and only `metal.progressiveBlur` runs.
 * `renderer="metal"` is forced, because the iOS 26 native material has no per-pixel blur to
 * drive — the shader renderers are the ones that can do this, on both platforms. Floors follow
 * the base package: Android 13 (API 33) ramps for real, API 31–32 approximates with a uniform
 * blur at the mean radius, and everything below degrades to a plain transparent view.
 *
 * Layout: hugs [edge] at the given [size] unless `style` repositions it. Children render inside,
 * edge-aligned — the usual tenant is a tab bar or toolbar.
 */
const LiquidGlassScrimBase: React.FC<ILiquidGlassScrimProps> = ({
  edge = "bottom",
  size = 160,
  radius = 24,
  reach = 0.7,
  tint,
  providerId,
  style,
  children,
}: ILiquidGlassScrimProps): React.ReactElement => {
  const metal = useMemo<GlassMetalOptions>(
    () => ({
      frost: 0,
      saturation: 1,
      noise: 0,
      light: 0,
      refraction: { amount: 0 },
      dispersion: { amount: 0 },
      highlight: { intensity: 0 },
      border: { width: 0 },
      progressiveBlur: {
        // The blur increases toward the edge the scrim hugs; the ramp begins at the content
        // side (fraction 0) and completes at `reach`.
        direction: edge === "top" ? "up" : edge === "bottom" ? "down" : edge,
        startRadius: 0,
        endRadius: radius,
        start: 0,
        end: Math.min(Math.max(reach, 0.05), 1),
      },
    }),
    [edge, radius, reach],
  );

  const placement = useMemo<StyleProp<ViewStyle>>(() => {
    switch (edge) {
      case "top":
        return { top: 0, left: 0, right: 0, height: size };
      case "left":
        return { top: 0, bottom: 0, left: 0, width: size };
      case "right":
        return { top: 0, bottom: 0, right: 0, width: size };
      default:
        return { bottom: 0, left: 0, right: 0, height: size };
    }
  }, [edge, size]);

  return (
    <LiquidGlassView
      renderer="metal"
      providerId={providerId}
      cornerRadius={0}
      tint={tint}
      metal={metal}
      style={[styles.scrim, placement, style]}
      containerStyle={styles.content}
    >
      {children}
    </LiquidGlassView>
  );
};

const styles = StyleSheet.create({
  scrim: {
    position: "absolute",
    // In style, not as a prop: the base view's plain-View degrade drops unknown props, and a
    // scrim that silently swallowed touches on old devices would be a nasty way to find out.
    pointerEvents: "box-none",
  },
  content: {
    flex: 1,
  },
});

const LiquidGlassScrim: React.NamedExoticComponent<ILiquidGlassScrimProps> =
  memo<ILiquidGlassScrimProps>(LiquidGlassScrimBase);
LiquidGlassScrim.displayName = "LiquidGlassScrim";

export { LiquidGlassScrim };
