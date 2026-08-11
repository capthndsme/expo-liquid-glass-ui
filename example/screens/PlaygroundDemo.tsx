import {
  LiquidGlassProvider,
  LiquidGlassView,
  type TGlassVariant,
} from "expo-liquid-glass-view";
import { LinearGradient } from "expo-linear-gradient";
import React, { useMemo, useRef, useState } from "react";
import {
  Animated,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

/**
 * The Backdrop Catalog demo wallpaper (AndroidLiquidGlass, Apache-2.0 — see NOTICE): sharp
 * mint/cerulean boundaries and a fine stucco texture, which is exactly what edge refraction is
 * eyeballed against. Bundled, not a URL, so the stage stays static and screenshots reproduce.
 */
const WALLPAPER = require("../assets/wallpaper-light.webp");

/**
 * Every `metal` dial on a slider, over a backdrop built to be read through glass — modeled on
 * AndroidLiquidGlass's GlassPlaygroundContent.
 *
 * The stage has one of each surface the effects need to be judged against: thin stripes for
 * refraction and dispersion, a dark and a light patch for the highlight rim (the additive rim must
 * stay visible on black — that is the whole point of it), text for legibility, and a gradient for
 * banding. The panel drags anywhere on the stage; the JSON readout at the bottom of the sheet is
 * the current configuration, ready to paste into a `<LiquidGlassView />`.
 */
export default function PlaygroundDemo(): React.JSX.Element {
  const [p, setP] = useState<Params>(() => defaultsFor("regular"));
  const [sheetVisible, setSheetVisible] = useState(true);
  // Outside `Params` deliberately: variant switches and reset call defaultsFor, and the backdrop
  // choice should survive both.
  const [backdrop, setBackdrop] = useState<"wallpaper" | "gradient">("wallpaper");

  const pan = useRef(new Animated.ValueXY()).current;
  const panOffset = useRef({ x: 0, y: 0 });
  const drag = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pan.setOffset(panOffset.current);
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: (_e, g) => {
        panOffset.current = {
          x: panOffset.current.x + g.dx,
          y: panOffset.current.y + g.dy,
        };
        pan.flattenOffset();
      },
    })
  ).current;

  const set = (patch: Partial<Params>) => setP((prev) => ({ ...prev, ...patch }));

  const metal = useMemo(
    () => ({
      blurRadius: p.blurRadius,
      frost: p.frost,
      saturation: p.saturation,
      noise: p.noise,
      light: p.light,
      opacity: p.opacity,
      refraction: {
        amount: p.refAmount,
        width: p.refWidth,
        height: p.refHeight,
        depth: p.refDepth,
        swirl: p.refSwirl,
      },
      dispersion: { amount: p.dispAmount, reach: p.dispReach },
      highlight: {
        intensity: p.hiIntensity,
        angle: p.hiAngle,
        width: p.hiWidth,
        falloff: p.hiFalloff,
      },
      border: { width: p.borderWidth, opacity: p.borderOpacity },
      ...(p.quality === "auto" ? {} : { android: { quality: p.quality } }),
    }),
    [p]
  );

  const size = SHAPES[p.shape];

  return (
    <View style={styles.root}>
      <LiquidGlassProvider style={StyleSheet.absoluteFill}>
        <Stage backdrop={backdrop} />
      </LiquidGlassProvider>

      <Animated.View
        {...drag.panHandlers}
        style={[styles.panelWrap, { transform: pan.getTranslateTransform() }]}
      >
        {/* With `interactive` on, a press blooms the glow — until the wrapper's PanResponder
            claims the drag, which lands as ACTION_CANCEL on the native side and releases it.
            That flicker is the cancel path working, not a bug. */}
        <LiquidGlassView
          variant={p.variant}
          cornerRadius={p.cornerRadius}
          interactive={p.interactive}
          metal={metal}
          style={{ width: size.w, height: size.h }}
        />
      </Animated.View>

      <Pressable
        style={styles.sheetToggle}
        onPress={() => setSheetVisible((v) => !v)}
      >
        <Text style={styles.sheetToggleText}>{sheetVisible ? "×" : "▤"}</Text>
      </Pressable>

      {sheetVisible && (
        <LiquidGlassView
          variant="regular"
          cornerRadius={24}
          metal={SHEET_GLASS}
          style={styles.sheet}
        >
          <View style={styles.sheetHeader}>
            <Segmented
              options={["regular", "clear"]}
              value={p.variant}
              onChange={(variant) => setP(defaultsFor(variant as TGlassVariant))}
            />
            <Pressable
              style={styles.reset}
              onPress={() => {
                setP(defaultsFor(p.variant));
                panOffset.current = { x: 0, y: 0 };
                pan.setOffset({ x: 0, y: 0 });
                pan.setValue({ x: 0, y: 0 });
              }}
            >
              <Text style={styles.resetText}>reset</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.sheetScroll}
            showsVerticalScrollIndicator={false}
            overScrollMode="never"
          >
            <View style={styles.segRow}>
              <Segmented
                options={["card", "pill", "circle"]}
                value={p.shape}
                onChange={(shape) =>
                  set({
                    shape: shape as Params["shape"],
                    cornerRadius: SHAPES[shape as Params["shape"]].radius,
                  })
                }
              />
              <Segmented
                options={["auto", "low", "medium", "high"]}
                value={p.quality}
                onChange={(quality) => set({ quality: quality as Params["quality"] })}
              />
            </View>

            <Slider label="cornerRadius" value={p.cornerRadius} min={0} max={100} step={1} onChange={(cornerRadius) => set({ cornerRadius })} />

            <View style={styles.segRow}>
              <Segmented
                options={["inactive", "interactive"]}
                value={p.interactive ? "interactive" : "inactive"}
                onChange={(v) => set({ interactive: v === "interactive" })}
              />
              <Segmented
                options={["wallpaper", "gradient"]}
                value={backdrop}
                onChange={(v) => setBackdrop(v as "wallpaper" | "gradient")}
              />
            </View>

            <Group title="surface" />
            <Slider label="blurRadius" value={p.blurRadius} min={0} max={40} step={1} onChange={(blurRadius) => set({ blurRadius })} />
            <Slider label="frost" value={p.frost} min={0} max={1} step={0.01} onChange={(frost) => set({ frost })} />
            <Slider label="saturation" value={p.saturation} min={0} max={4} step={0.05} onChange={(saturation) => set({ saturation })} />
            <Slider label="noise" value={p.noise} min={0} max={0.3} step={0.01} onChange={(noise) => set({ noise })} />
            <Slider label="light" value={p.light} min={0} max={0.3} step={0.01} onChange={(light) => set({ light })} />
            <Slider label="opacity" value={p.opacity} min={0.2} max={1} step={0.01} onChange={(opacity) => set({ opacity })} />

            <Group title="refraction" />
            <Slider label="amount" value={p.refAmount} min={0} max={150} step={1} onChange={(refAmount) => set({ refAmount })} />
            <Slider label="width" value={p.refWidth} min={1} max={80} step={1} onChange={(refWidth) => set({ refWidth })} />
            <Slider label="height" value={p.refHeight} min={1} max={80} step={1} onChange={(refHeight) => set({ refHeight })} />
            <Slider label="depth" value={p.refDepth} min={0} max={1} step={0.01} onChange={(refDepth) => set({ refDepth })} />
            <Slider label="swirl" value={p.refSwirl} min={-1} max={1} step={0.05} onChange={(refSwirl) => set({ refSwirl })} />

            <Group title="dispersion" />
            <Slider label="amount" value={p.dispAmount} min={0} max={60} step={1} onChange={(dispAmount) => set({ dispAmount })} />
            <Slider label="reach" value={p.dispReach} min={1} max={80} step={1} onChange={(dispReach) => set({ dispReach })} />

            <Group title="highlight" />
            <Slider label="intensity" value={p.hiIntensity} min={0} max={1} step={0.01} onChange={(hiIntensity) => set({ hiIntensity })} />
            <Slider label="angle" value={p.hiAngle} min={0} max={360} step={1} onChange={(hiAngle) => set({ hiAngle })} />
            <Slider label="width" value={p.hiWidth} min={0} max={24} step={0.5} onChange={(hiWidth) => set({ hiWidth })} />
            <Slider label="falloff" value={p.hiFalloff} min={0.25} max={6} step={0.25} onChange={(hiFalloff) => set({ hiFalloff })} />

            <Group title="border" />
            <Slider label="width" value={p.borderWidth} min={0} max={8} step={0.5} onChange={(borderWidth) => set({ borderWidth })} />
            <Slider label="opacity" value={p.borderOpacity} min={0} max={1} step={0.01} onChange={(borderOpacity) => set({ borderOpacity })} />

            <Text style={styles.json} selectable>
              {JSON.stringify({ variant: p.variant, cornerRadius: p.cornerRadius, metal })}
            </Text>
          </ScrollView>
        </LiquidGlassView>
      )}
    </View>
  );
}

// --------------------------------------------------------------------------------------- stage

/** Static on purpose: the provider records it once, and screenshots reproduce. */
function Stage({ backdrop }: { backdrop: "wallpaper" | "gradient" }): React.JSX.Element {
  if (backdrop === "wallpaper") {
    // The Backdrop Catalog demo, verbatim: just the wallpaper, centre-cropped. Its boundaries and
    // texture do all the reading, so none of the gradient stage's props are overlaid.
    return (
      <View style={styles.stage}>
        <Image source={WALLPAPER} style={StyleSheet.absoluteFill} resizeMode="cover" />
      </View>
    );
  }
  return (
    <View style={styles.stage}>
      <LinearGradient
        colors={["#101c3f", "#4c2470", "#c2455f", "#f5a04a"]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.blob, { top: "6%", left: -60, backgroundColor: "#2dd4bf88" }]} />
      <View style={[styles.blob, { top: "30%", right: -70, backgroundColor: "#a3e63566" }]} />
      <View style={[styles.blob, { bottom: "18%", left: "30%", backgroundColor: "#ffffff2e" }]} />

      {/* Thin stripes: the surface refraction and dispersion are easiest to read against. */}
      <View style={styles.stripes}>
        {Array.from({ length: 16 }, (_, i) => (
          <View key={i} style={styles.stripe} />
        ))}
      </View>

      <Text style={styles.stageTitle}>Liquid{"\n"}Glass</Text>
      <Text style={styles.stageBody}>
        Grab the panel and drag it. The stripes read refraction; the rim must hold on the dark
        patch.
      </Text>

      {/* The additive rim's acid test (black), and the frost's (white). */}
      <View style={[styles.patch, styles.patchDark]} />
      <View style={[styles.patch, styles.patchLight]} />
    </View>
  );
}

// ------------------------------------------------------------------------------------ controls

function Group({ title }: { title: string }): React.JSX.Element {
  return <Text style={styles.group}>{title}</Text>;
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}): React.JSX.Element {
  return (
    <View style={styles.seg}>
      {options.map((o) => (
        <Pressable
          key={o}
          onPress={() => onChange(o)}
          style={[styles.segItem, o === value && styles.segItemActive]}
        >
          <Text style={[styles.segText, o === value && styles.segTextActive]}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}): React.JSX.Element {
  const trackRef = useRef<View>(null);
  const geom = useRef({ x: 0, w: 0 });
  // The responder is created once, so it must not close over this render's props.
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  const setFromPageX = (pageX: number) => {
    const { x, w } = geom.current;
    if (w <= 0) return; // first gesture's moves can outrun the async measure
    const frac = Math.min(1, Math.max(0, (pageX - x) / w));
    const next = Math.round((min + frac * (max - min)) / step) * step;
    // Dedupe: finger movement within one step's width would otherwise re-render the whole
    // playground (and re-commit the glass props) per touch event for no visible change.
    if (next !== latest.current.value) latest.current.onChange(next);
  };

  // Claim on touch-down (tap-to-set) and refuse to hand the gesture to the sheet's ScrollView —
  // without the termination veto a slightly diagonal slide scrolls the sheet mid-adjust.
  //
  // The math uses pageX against the track's measured window origin, NEVER locationX: locationX is
  // relative to whichever child the finger happens to be over, so grabbing the THUMB delivered
  // thumb-local coordinates, snapped the value toward min, the thumb jumped out from under the
  // finger, and the value oscillated for the rest of the drag.
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const { pageX } = e.nativeEvent;
        // Re-measured every gesture: it is cheap, and the sheet never moves horizontally between
        // them, so the stored origin also keeps the next gesture exact even before this lands.
        trackRef.current?.measureInWindow((x, _y, w) => {
          geom.current = { x, w: Math.max(1, w) };
          setFromPageX(pageX);
        });
      },
      onPanResponderMove: (e) => setFromPageX(e.nativeEvent.pageX),
    })
  ).current;

  const frac = (value - min) / (max - min);
  return (
    <View style={styles.slider}>
      <Text style={styles.sliderLabel}>{label}</Text>
      <View
        ref={trackRef}
        collapsable={false}
        style={styles.track}
        {...responder.panHandlers}
      >
        <View pointerEvents="none" style={styles.trackLine} />
        <View pointerEvents="none" style={[styles.trackFill, { width: `${frac * 100}%` }]} />
        <View pointerEvents="none" style={[styles.thumb, { left: `${frac * 100}%` }]} />
      </View>
      <Text style={styles.sliderValue}>
        {step < 1 ? value.toFixed(2) : Math.round(value)}
      </Text>
    </View>
  );
}

// -------------------------------------------------------------------------------------- state

type Params = {
  variant: TGlassVariant;
  quality: "auto" | "low" | "medium" | "high";
  shape: keyof typeof SHAPES;
  interactive: boolean;
  cornerRadius: number;
  blurRadius: number;
  frost: number;
  saturation: number;
  noise: number;
  light: number;
  opacity: number;
  refAmount: number;
  refWidth: number;
  refHeight: number;
  refDepth: number;
  refSwirl: number;
  dispAmount: number;
  dispReach: number;
  hiIntensity: number;
  hiAngle: number;
  hiWidth: number;
  hiFalloff: number;
  borderWidth: number;
  borderOpacity: number;
};

const SHAPES = {
  card: { w: 210, h: 210, radius: 44 },
  pill: { w: 280, h: 76, radius: 38 },
  circle: { w: 170, h: 170, radius: 85 },
} as const;

/** The native per-variant defaults (GlassVariant.swift / GlassEnums.kt), so "reset" is honest. */
function defaultsFor(variant: TGlassVariant): Params {
  const regular = variant === "regular";
  return {
    variant,
    quality: "auto",
    shape: "card",
    interactive: false,
    cornerRadius: SHAPES.card.radius,
    blurRadius: 0,
    frost: regular ? 0.36 : 0.06,
    saturation: regular ? 1.8 : 1.15,
    noise: regular ? 0.05 : 0.06,
    light: 0,
    opacity: 1,
    refAmount: regular ? 60 : 30,
    refWidth: regular ? 20 : 10,
    refHeight: regular ? 20 : 10,
    refDepth: regular ? 1 : 0,
    refSwirl: 0.25,
    dispAmount: regular ? 6 : 10,
    dispReach: regular ? 20 : 10,
    hiIntensity: regular ? 0.25 : 0.35,
    hiAngle: 135,
    hiWidth: 1.5,
    hiFalloff: 1,
    borderWidth: 1,
    borderOpacity: regular ? 0.28 : 0.4,
  };
}

/** The sheet's own glass. Heavy frost so the controls stay legible over the loud stage. */
const SHEET_GLASS = {
  blurRadius: 14,
  frost: 0.62,
  saturation: 1.5,
  refraction: { amount: 24, width: 10, height: 10 },
  dispersion: { amount: 0 },
} as const;

// -------------------------------------------------------------------------------------- styles

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0d0d0d" },
  stage: { flex: 1 },
  blob: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
  },
  stripes: {
    position: "absolute",
    top: "12%",
    right: 16,
    width: 150,
    height: 260,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  stripe: { width: 3, backgroundColor: "#ffffffcc" },
  stageTitle: {
    position: "absolute",
    top: "14%",
    left: 24,
    color: "#ffffff",
    fontSize: 56,
    fontWeight: "800",
    lineHeight: 60,
  },
  stageBody: {
    position: "absolute",
    top: "33%",
    left: 24,
    width: 190,
    color: "#ffffffb3",
    fontSize: 13,
    lineHeight: 19,
  },
  // The band between the text and the sheet's top edge — sized so nothing tucks under the sheet.
  patch: { position: "absolute", width: 130, height: 80, borderRadius: 12 },
  patchDark: { top: "43%", left: 24, backgroundColor: "#08080c" },
  patchLight: { top: "43%", right: 24, backgroundColor: "#f4f2ee" },

  panelWrap: {
    position: "absolute",
    top: "20%",
    alignSelf: "center",
  },

  sheetToggle: {
    position: "absolute",
    right: 14,
    bottom: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#000000a0",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  sheetToggleText: { color: "#ffffff", fontSize: 17 },

  sheet: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    maxHeight: "46%",
    padding: 14,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    paddingRight: 48,
  },
  sheetScroll: { flexGrow: 0 },
  segRow: { gap: 8, marginBottom: 6 },
  seg: {
    flexDirection: "row",
    backgroundColor: "#00000055",
    borderRadius: 15,
    padding: 3,
    alignSelf: "flex-start",
  },
  segItem: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12 },
  segItemActive: { backgroundColor: "#ffffffd9" },
  segText: { color: "#ffffffcc", fontSize: 12, fontWeight: "600" },
  segTextActive: { color: "#111111" },
  reset: {
    backgroundColor: "#00000055",
    borderRadius: 15,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  resetText: { color: "#ffffff", fontSize: 12, fontWeight: "700" },

  group: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 10,
    marginBottom: 2,
    opacity: 0.75,
  },
  slider: { flexDirection: "row", alignItems: "center", height: 30 },
  sliderLabel: {
    width: 92,
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
    textShadowColor: "#00000066",
    textShadowRadius: 3,
  },
  track: { flex: 1, height: 30, justifyContent: "center" },
  trackLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: "#ffffff45",
  },
  trackFill: {
    position: "absolute",
    left: 0,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: "#ffffffd9",
  },
  thumb: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#ffffff",
    marginLeft: -7,
  },
  sliderValue: {
    width: 44,
    textAlign: "right",
    color: "#ffffffe6",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
    textShadowColor: "#00000066",
    textShadowRadius: 3,
  },
  json: {
    marginTop: 10,
    color: "#ffffff99",
    fontSize: 9,
    fontFamily: "monospace",
  },
});
