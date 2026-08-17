import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { LiquidGlassProvider, LiquidGlassView } from "expo-liquid-glass-view";
import {
  LiquidGlassTabBar,
  type LiquidGlassTabIconState,
  type LiquidGlassTabItem,
} from "expo-liquid-glass-ui";
import React, { useRef, useState } from "react";
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

/**
 * The pill tuner: every `LiquidGlassTabBar` tunable on a slider, driving the real component live,
 * with a JSON readout that maps 1:1 onto the props. Dial the look, long-drag the pill to feel the
 * dragged state, and paste the JSON back.
 */

const ion =
  (focused: string, outline: string) =>
  ({ focused: isFocused, color, size }: LiquidGlassTabIconState) => (
    <Ionicons
      name={(isFocused ? focused : outline) as never}
      color={color}
      size={size}
    />
  );

const TAB_ITEMS: LiquidGlassTabItem[] = [
  { key: "home", title: "Home", icon: ion("home", "home-outline") },
  { key: "search", title: "Search", icon: ion("search", "search-outline") },
  { key: "likes", title: "Likes", icon: ion("heart", "heart-outline") },
  { key: "you", title: "You", icon: ion("person", "person-outline") },
];

const CARD_COLORS = ["#FF6B6B", "#FFD93D", "#6BCB77", "#4D96FF", "#B983FF"];

type Params = {
  // pill at rest
  refAmount: number;
  refWidth: number;
  refHeight: number;
  refDepth: number;
  dispAmount: number;
  blurRadius: number;
  frost: number;
  saturation: number;
  restHighlight: number;
  restBorder: number;
  // pill while dragged
  dragAmount: number;
  dragWidth: number;
  dragHeight: number;
  dragDepth: number;
  dragDispersion: number;
  dragBlurRadius: number;
  dragFrost: number;
  dragSaturation: number;
  dragHighlight: number;
  // pill chrome + geometry
  tintBase: "black" | "white";
  tintAlpha: number;
  inset: number;
  pressedScale: number;
  // the bar behind it
  barTintBase: "light" | "dark";
  barTintAlpha: number;
};

/** The kit's shipped defaults, so "reset" is honest and the JSON diff starts at zero. */
const DEFAULTS: Params = {
  refAmount: 0,
  refWidth: 24,
  refHeight: 24,
  refDepth: 1,
  dispAmount: 0,
  blurRadius: 0,
  frost: 0,
  saturation: 1,
  restHighlight: 0,
  restBorder: 0,
  dragAmount: 104,
  dragWidth: 24,
  dragHeight: 24,
  dragDepth: 1,
  dragDispersion: 6,
  dragBlurRadius: 0,
  dragFrost: 0.36,
  dragSaturation: 1.8,
  dragHighlight: 1,
  tintBase: "white",
  tintAlpha: 0.1,
  inset: 2,
  pressedScale: 1.39,
  barTintBase: "dark",
  barTintAlpha: 0.4,
};

function buildProps(p: Params) {
  const tintRgb = p.tintBase === "black" ? "0,0,0" : "255,255,255";
  const barRgb = p.barTintBase === "light" ? "250,250,250" : "18,18,18";
  return {
    pillMetal: {
      refraction: {
        amount: p.refAmount,
        width: p.refWidth,
        height: p.refHeight,
        depth: p.refDepth,
      },
      dispersion: { amount: p.dispAmount },
      blurRadius: p.blurRadius,
      frost: p.frost,
      saturation: p.saturation,
      noise: 0,
      highlight: { intensity: p.restHighlight },
      border: { opacity: p.restBorder },
    },
    pillDraggedMetal: {
      refraction: {
        amount: p.dragAmount,
        width: p.dragWidth,
        height: p.dragHeight,
        depth: p.dragDepth,
      },
      dispersion: { amount: p.dragDispersion },
      blurRadius: p.dragBlurRadius,
      frost: p.dragFrost,
      saturation: p.dragSaturation,
      highlight: { intensity: p.dragHighlight },
    },
    pillTint: `rgba(${tintRgb},${p.tintAlpha})`,
    pillInset: p.inset,
    pillPressedScale: p.pressedScale,
    tint: `rgba(${barRgb},${p.barTintAlpha})`,
  } as const;
}

const SHEET_GLASS = {
  blurRadius: 14,
  frost: 0.62,
  saturation: 1.5,
  refraction: { amount: 24, width: 10, height: 10 },
  dispersion: { amount: 0 },
} as const;

export default function GlassUITunerDemo(): React.JSX.Element {
  const [tab, setTab] = useState(0);
  const [pState, setP] = useState<Params>(DEFAULTS);
  const [sheetVisible, setSheetVisible] = useState(true);
  const set = (patch: Partial<Params>) => setP((prev) => ({ ...prev, ...patch }));
  // Fast refresh preserves the old state object across edits; merging keeps newly added params
  // from arriving as undefined mid-session.
  const p: Params = { ...DEFAULTS, ...pState };

  const props = buildProps(p);
  const json = JSON.stringify(
    {
      pillMetal: props.pillMetal,
      pillDraggedMetal: props.pillDraggedMetal,
      pillTint: props.pillTint,
      pillInset: props.pillInset,
      pillPressedScale: props.pillPressedScale,
      tint: props.tint,
    },
    null,
    1,
  );

  return (
    <View style={styles.root}>
      <LiquidGlassProvider style={StyleSheet.absoluteFill}>
        <View style={styles.stage}>
          <LinearGradient
            colors={["#20315c", "#101018"]}
            style={StyleSheet.absoluteFill}
          />
          {/* A loud band right behind the bar, so the pill always has edges to bend. */}
          <View style={styles.cardRow} pointerEvents="none">
            {CARD_COLORS.map((color, i) => (
              <View key={i} style={[styles.card, { backgroundColor: color }]} />
            ))}
          </View>
          <Text style={styles.stageTitle}>Pill{"\n"}tuner</Text>
        </View>
      </LiquidGlassProvider>

      <LiquidGlassTabBar
        tabs={TAB_ITEMS}
        selectedIndex={tab}
        onTabSelected={setTab}
        style={styles.bar}
        {...props}
      />

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
            <Text style={styles.sheetTitle}>drag the pill to feel “dragged”</Text>
            <Pressable style={styles.reset} onPress={() => setP(DEFAULTS)}>
              <Text style={styles.resetText}>reset</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.sheetScroll}
            showsVerticalScrollIndicator={false}
            overScrollMode="never"
          >
            <Text style={styles.group}>pill · rest lens</Text>
            <Slider label="amount" value={p.refAmount} min={0} max={150} step={1} onChange={(refAmount) => set({ refAmount })} />
            <Slider label="width" value={p.refWidth} min={1} max={60} step={1} onChange={(refWidth) => set({ refWidth })} />
            <Slider label="height" value={p.refHeight} min={1} max={60} step={1} onChange={(refHeight) => set({ refHeight })} />
            <Slider label="depth" value={p.refDepth} min={0} max={1} step={0.01} onChange={(refDepth) => set({ refDepth })} />
            <Slider label="dispersion" value={p.dispAmount} min={0} max={20} step={0.5} onChange={(dispAmount) => set({ dispAmount })} />
            <Slider label="blurRadius" value={p.blurRadius} min={0} max={24} step={1} onChange={(blurRadius) => set({ blurRadius })} />
            <Slider label="frost" value={p.frost} min={0} max={1} step={0.01} onChange={(frost) => set({ frost })} />
            <Slider label="saturation" value={p.saturation} min={0} max={4} step={0.05} onChange={(saturation) => set({ saturation })} />
            <Slider label="rim light" value={p.restHighlight} min={0} max={2} step={0.05} onChange={(restHighlight) => set({ restHighlight })} />
            <Slider label="border" value={p.restBorder} min={0} max={1} step={0.01} onChange={(restBorder) => set({ restBorder })} />

            <Text style={styles.group}>pill · dragged</Text>
            <Slider label="amount" value={p.dragAmount} min={0} max={150} step={1} onChange={(dragAmount) => set({ dragAmount })} />
            <Slider label="width" value={p.dragWidth} min={1} max={60} step={1} onChange={(dragWidth) => set({ dragWidth })} />
            <Slider label="height" value={p.dragHeight} min={1} max={60} step={1} onChange={(dragHeight) => set({ dragHeight })} />
            <Slider label="depth" value={p.dragDepth} min={0} max={1} step={0.01} onChange={(dragDepth) => set({ dragDepth })} />
            <Slider label="dispersion" value={p.dragDispersion} min={0} max={20} step={0.5} onChange={(dragDispersion) => set({ dragDispersion })} />
            <Slider label="blurRadius" value={p.dragBlurRadius} min={0} max={24} step={1} onChange={(dragBlurRadius) => set({ dragBlurRadius })} />
            <Slider label="frost" value={p.dragFrost} min={0} max={1} step={0.01} onChange={(dragFrost) => set({ dragFrost })} />
            <Slider label="saturation" value={p.dragSaturation} min={0} max={4} step={0.05} onChange={(dragSaturation) => set({ dragSaturation })} />
            <Slider label="highlight" value={p.dragHighlight} min={0} max={2} step={0.05} onChange={(dragHighlight) => set({ dragHighlight })} />

            <Text style={styles.group}>pill · chrome + geometry</Text>
            <View style={styles.segRow}>
              <Segmented
                options={["black", "white"]}
                value={p.tintBase}
                onChange={(tintBase) => set({ tintBase: tintBase as Params["tintBase"] })}
              />
            </View>
            <Slider label="tint alpha" value={p.tintAlpha} min={0} max={0.5} step={0.01} onChange={(tintAlpha) => set({ tintAlpha })} />
            <Slider label="inset" value={p.inset} min={0} max={4} step={1} onChange={(inset) => set({ inset })} />
            <Slider label="pressedScale" value={p.pressedScale} min={1} max={1.6} step={0.01} onChange={(pressedScale) => set({ pressedScale })} />

            <Text style={styles.group}>bar</Text>
            <View style={styles.segRow}>
              <Segmented
                options={["light", "dark"]}
                value={p.barTintBase}
                onChange={(barTintBase) => set({ barTintBase: barTintBase as Params["barTintBase"] })}
              />
            </View>
            <Slider label="tint alpha" value={p.barTintAlpha} min={0} max={0.8} step={0.01} onChange={(barTintAlpha) => set({ barTintAlpha })} />

            <Text style={styles.json}>{json}</Text>
          </ScrollView>
        </LiquidGlassView>
      )}
    </View>
  );
}

// ---------------------------------------------------------------- controls (from PlaygroundDemo)

function Segmented({
  options,
  value,
  onChange,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}): React.JSX.Element {
  return (
    <View style={styles.seg}>
      {options.map((option) => (
        <Pressable
          key={option}
          style={[styles.segItem, option === value && styles.segItemActive]}
          onPress={() => onChange(option)}
        >
          <Text style={[styles.segText, option === value && styles.segTextActive]}>
            {option}
          </Text>
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
    if (next !== latest.current.value) latest.current.onChange(next);
  };

  // pageX against the measured window origin, never locationX — see PlaygroundDemo's Slider.
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const { pageX } = e.nativeEvent;
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#101018" },
  stage: { flex: 1 },
  stageTitle: {
    position: "absolute",
    top: 110,
    left: 24,
    color: "#ffffff",
    fontSize: 48,
    fontWeight: "800",
    lineHeight: 52,
  },
  cardRow: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 180,
    flexDirection: "row",
  },
  card: { flex: 1 },

  bar: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 28,
  },

  sheetToggle: {
    position: "absolute",
    right: 14,
    top: 108,
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
    bottom: 108,
    maxHeight: "56%",
    padding: 14,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  sheetTitle: { color: "#ffffffcc", fontSize: 12, fontStyle: "italic" },
  sheetScroll: { flexGrow: 0 },
  segRow: { flexDirection: "row", gap: 8, marginBottom: 6 },

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
