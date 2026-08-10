import {
  LiquidGlassProvider,
  LiquidGlassView,
  type LiquidGlassViewProps,
} from "expo-liquid-glass-view";
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

/**
 * Every prop the Android view accepts, one tile each, over a shared static backdrop.
 *
 * Each tile changes exactly one thing from the `regular` defaults, so anything visible in a tile is
 * attributable to the prop named under it. Tiles that are *meant* to look identical to the baseline
 * say so — `captureQuality` and `cornerStyle` are accepted for API parity and deliberately do
 * nothing on Android, and a tile that silently did nothing would otherwise read as a bug.
 *
 * The backdrop is pinned and the tiles scroll, so this screen also exercises the pre-draw geometry
 * watcher: every tile's backdrop has to stay welded to the world while the tile moves over it.
 */
export default function AndroidPropsDemo(): React.JSX.Element {
  return (
    <View style={styles.root}>
      <LiquidGlassProvider style={StyleSheet.absoluteFill}>
        <View style={styles.backdrop}>
          {BANDS.map((color, i) => (
            <View key={i} style={[styles.band, { backgroundColor: color }]} />
          ))}
        </View>
      </LiquidGlassProvider>

      {/* R11: the stretch overscroll is a pixel-space RenderEffect on this ScrollView's own
          RenderNode, so it warps each tile together with the backdrop baked into it while the
          provider behind stays flat. Nothing inside can compensate — turn it off. */}
      <ScrollView
        overScrollMode="never"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {SECTIONS.map((section) => (
          <View key={section.title}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <View style={styles.grid}>
              {section.tiles.map((tile) => (
                <View key={tile.label} style={styles.cell}>
                  <LiquidGlassView style={styles.tile} {...tile.props} />
                  <Text style={styles.label}>{tile.label}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

type Tile = { label: string; props: LiquidGlassViewProps };

/** Repeated on most tiles so the one varied prop is the only difference from the baseline. */
const BASE: LiquidGlassViewProps = { cornerRadius: 20 };

const SECTIONS: { title: string; tiles: Tile[] }[] = [
  {
    title: "view props",
    tiles: [
      { label: "baseline (regular)", props: BASE },
      { label: 'variant="clear"', props: { ...BASE, variant: "clear" } },
      {
        label: "tint #3b82f655",
        props: { ...BASE, tint: "#3b82f655" },
      },
      {
        label: "cornerRadius 48",
        props: { cornerRadius: 48 },
      },
      {
        label: "cornerRadius per-corner",
        props: {
          cornerRadius: {
            topLeft: 44,
            topRight: 6,
            bottomRight: 44,
            bottomLeft: 6,
          },
        },
      },
      {
        // No Android primitive for continuous corners, and the iOS *Metal* renderer this ports is
        // circular-only too — so ignoring it is parity, not a gap.
        label: 'cornerStyle="circular" (no-op)',
        props: { ...BASE, cornerStyle: "circular" },
      },
      {
        // `native` has no Android meaning; there is no Apple material to ask for. It resolves to the
        // shader path exactly as it does on iOS below 26 — which is what the shared FlatList and
        // ScrollView demos rely on.
        label: 'renderer="native" → agsl',
        props: { ...BASE, renderer: "native" },
      },
      {
        label: 'renderer="metal"',
        props: { ...BASE, renderer: "metal" },
      },
      {
        // Press and hold: the glow blooms under the finger, chases it, and the tile inflates a
        // touch. Springs run natively — nothing crosses the bridge per frame.
        label: "interactive (press me)",
        props: { ...BASE, interactive: true },
      },
      {
        // Same flag on the blur tier: the shader is gone, so the press feedback is the additive
        // wash painted on the composited path. Feedback must never vanish with the tier.
        label: "interactive + maxTier blur",
        props: {
          ...BASE,
          interactive: true,
          metal: { android: { maxTier: "fallback-blur" } },
        },
      },
    ],
  },
  {
    title: "metal — surface",
    tiles: [
      { label: "blurRadius 40", props: { ...BASE, metal: { blurRadius: 40 } } },
      { label: "frost 0.8", props: { ...BASE, metal: { frost: 0.8 } } },
      { label: "frost 0", props: { ...BASE, metal: { frost: 0 } } },
      { label: "opacity 0.4", props: { ...BASE, metal: { opacity: 0.4 } } },
      { label: "saturation 0", props: { ...BASE, metal: { saturation: 0 } } },
      { label: "saturation 4", props: { ...BASE, metal: { saturation: 4 } } },
      { label: "noise 0.4", props: { ...BASE, metal: { noise: 0.4 } } },
      { label: "light 0.5", props: { ...BASE, metal: { light: 0.5 } } },
      {
        // Scales the rasterized capture on iOS. The Android path records a display list rather than
        // pixels, so there is nothing to scale.
        label: "captureQuality 0.25 (no-op)",
        props: { ...BASE, metal: { captureQuality: 0.25 } },
      },
    ],
  },
  {
    title: "metal — refraction",
    tiles: [
      {
        label: "refraction.amount 120",
        props: { ...BASE, metal: { refraction: { amount: 120 } } },
      },
      {
        label: "refraction.amount 0",
        props: { ...BASE, metal: { refraction: { amount: 0 } } },
      },
      {
        label: "refraction.width 60",
        props: { ...BASE, metal: { refraction: { width: 60 } } },
      },
      {
        // On iOS this also sets the highlight's falloff distance; on Android the highlight has its
        // own `highlight.width`, so this tile must show a deeper lens with an UNCHANGED rim.
        label: "refraction.height 60",
        props: { ...BASE, metal: { refraction: { height: 60 } } },
      },
      {
        label: "refraction.depth 0",
        props: { ...BASE, metal: { refraction: { depth: 0 } } },
      },
      {
        // `curve` is all-or-nothing on iOS: supplying `power` alone silently takes the Record's
        // `bias` default of 0 rather than the variant's. Reproduced deliberately.
        label: "curve { power 3, bias 0.4 }",
        props: {
          ...BASE,
          metal: { refraction: { curve: { power: 3, bias: 0.4 } } },
        },
      },
      {
        // The one input that makes the refracted sample travel OUTWARD. `base = pixels - amount *
        // direction` with `direction` pointing out of the shape, so only a negative `amount` — a
        // negative `bias` here, or a negative `refraction.amount` — leaves the view rect at all.
        // That is the case `GlassAppearance.refractionReachPx` sizes the backdrop padding for, and
        // the one tile on this screen that would show a black or smeared rim if it got it wrong.
        label: "curve { power 1, bias −0.8 }",
        props: {
          ...BASE,
          metal: { refraction: { curve: { power: 1, bias: -0.8 } } },
        },
      },
    ],
  },
  {
    title: "metal — dispersion, highlight, border",
    tiles: [
      {
        label: "dispersion.amount 40",
        props: { ...BASE, metal: { dispersion: { amount: 40 } } },
      },
      {
        // Falls back to the *refraction height default*, not to your `refraction.height` override —
        // another deliberate iOS quirk.
        label: "dispersion.reach 60",
        props: {
          ...BASE,
          metal: { dispersion: { amount: 40, reach: 60 } },
        },
      },
      {
        label: "highlight.intensity 0",
        props: { ...BASE, metal: { highlight: { intensity: 0 } } },
      },
      {
        label: "highlight.intensity 1",
        props: { ...BASE, metal: { highlight: { intensity: 1 } } },
      },
      {
        // The rim is 180°-periodic (both lobes lit), so against `angle 135` only the faint
        // interior shading should flip sides — not the rim.
        label: "highlight.angle 315",
        props: { ...BASE, metal: { highlight: { angle: 315 } } },
      },
      {
        // Android-only: the rim bloom's own fade-out depth, decoupled from refraction.height.
        label: "highlight.width 20",
        props: { ...BASE, metal: { highlight: { width: 20 } } },
      },
      {
        label: "border { width 6, opacity 1 }",
        props: { ...BASE, metal: { border: { width: 6, opacity: 1 } } },
      },
      {
        label: "border.opacity 0",
        props: { ...BASE, metal: { border: { opacity: 0 } } },
      },
    ],
  },
  {
    title: "metal.android",
    tiles: [
      {
        label: 'quality "low"',
        props: {
          ...BASE,
          metal: { dispersion: { amount: 40 }, android: { quality: "low" } },
        },
      },
      {
        label: 'quality "medium"',
        props: {
          ...BASE,
          metal: { dispersion: { amount: 40 }, android: { quality: "medium" } },
        },
      },
      {
        label: 'quality "high"',
        props: {
          ...BASE,
          metal: { dispersion: { amount: 40 }, android: { quality: "high" } },
        },
      },
      {
        label: 'maxTier "fallback-blur"',
        props: {
          ...BASE,
          metal: { blurRadius: 24, android: { maxTier: "fallback-blur" } },
        },
      },
      {
        label: 'maxTier "scrim"',
        props: { ...BASE, metal: { android: { maxTier: "scrim" } } },
      },
      {
        label: 'maxTier "none"',
        props: { ...BASE, metal: { android: { maxTier: "none" } } },
      },
    ],
  },
];

const BANDS = [
  "#ff5f6d",
  "#ffc371",
  "#47cf73",
  "#12c2e9",
  "#c471ed",
  "#f64f59",
  "#0f2027",
  "#eaeaea",
  "#111111",
  "#2c5364",
];

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0d0d0d" },
  backdrop: { flex: 1 },
  band: { flex: 1 },
  content: { paddingTop: 110, paddingBottom: 120, paddingHorizontal: 16 },
  sectionTitle: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginTop: 18,
    marginBottom: 10,
  },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "33.333%", alignItems: "center", marginBottom: 16 },
  tile: { width: 96, height: 96 },
  label: {
    marginTop: 6,
    fontSize: 9,
    lineHeight: 12,
    color: "#ffffffbb",
    textAlign: "center",
    paddingHorizontal: 2,
  },
});
