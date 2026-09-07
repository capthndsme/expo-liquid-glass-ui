import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import type { GlassMetalOptions } from "expo-liquid-glass-ui";
import { LiquidGlassProvider, LiquidGlassView } from "expo-liquid-glass-ui";
import {
  GLASS_UI_PALETTE,
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
 * The pill tuner: every `metal` knob the shader reads on a slider — refraction, the dispersion
 * *reach*, the rim, the border, quality — for both of the pill's states, driving the real
 * component live, over a stage that flips light/dark so both **tint pairs** can be finalized in
 * one sitting. The JSON readout maps 1:1 onto the kit's props and palette; dial it, long-drag the
 * pill to feel the dragged state, and paste it back.
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

type TScheme = "light" | "dark";
type TQuality = "low" | "medium" | "high";

/** One glass state, every knob explicit — nothing left to fall back to a variant default. */
type MetalParams = {
  amount: number;
  width: number;
  height: number;
  depth: number;
  swirl: number;
  curvePower: number;
  curveBias: number;
  dispersion: number;
  dispersionReach: number;
  blurRadius: number;
  frost: number;
  saturation: number;
  noise: number;
  light: number;
  opacity: number;
  rim: number;
  rimAngle: number;
  rimWidth: number;
  rimFalloff: number;
  borderWidth: number;
  borderOpacity: number;
  quality: TQuality;
};

/** The bar wash and the pill wash that have to work as a pair, per scheme. */
type TintPair = {
  barLevel: number;
  barAlpha: number;
  pillLevel: number;
  pillAlpha: number;
};

type Params = {
  scheme: TScheme;
  pairs: Record<TScheme, TintPair>;
  rest: MetalParams;
  drag: MetalParams;
  inset: number;
  pressedScale: number;
};

/**
 * The `regular` variant's own fallbacks (`GlassEnums.kt` REGULAR_DEFAULTS plus the non-variant
 * constants in `GlassAppearance.resolve`), spelled out so every seed below is a real starting
 * value rather than an implicit one. Two quirks worth knowing while tuning:
 *
 * - `dispersion.reach` falls back to the variant's **refraction height** (20), not to whatever
 *   height this metal sets — so a pill at height 24 disperses over a 20 dp depth until reach is
 *   set explicitly. That is the knob this screen exists to expose.
 * - `refraction.curve` is all-or-nothing: passing it at all overrides both power and bias.
 */
const VARIANT_REGULAR: MetalParams = {
  amount: 60,
  width: 20,
  height: 20,
  depth: 1,
  swirl: 0,
  curvePower: 1,
  curveBias: 0,
  dispersion: 6,
  dispersionReach: 20,
  blurRadius: 0,
  frost: 0.36,
  saturation: 1.8,
  noise: 0.05,
  light: 0,
  opacity: 1,
  rim: 0.25,
  rimAngle: 180,
  rimWidth: 0.75,
  rimFalloff: 1,
  borderWidth: 1,
  borderOpacity: 0.28,
  quality: "medium",
};

/**
 * The kit's shipped defaults, so "reset" is honest. Rest is the silent scrim — every effect off,
 * because the *dragged* state is what refracts, and the drag is spread rather than bend: a
 * shallow lens in a thin band with the dispersion run up over a long reach. The pair seeds follow
 * the general rule — dark mode gets a dark bar under a light pill, light mode a light bar under a
 * dark pill — which is exactly what `GLASS_UI_PALETTE` ships.
 */
const DEFAULTS: Params = {
  scheme: "dark",
  pairs: {
    dark: { barLevel: 18, barAlpha: 0.4, pillLevel: 255, pillAlpha: 0.1 },
    light: { barLevel: 250, barAlpha: 0.42, pillLevel: 0, pillAlpha: 0.12 },
  },
  rest: {
    ...VARIANT_REGULAR,
    amount: 0,
    width: 24,
    height: 24,
    dispersion: 0,
    frost: 0,
    saturation: 1,
    noise: 0,
    rim: 0,
    borderOpacity: 0,
    quality: "high",
  },
  drag: {
    ...VARIANT_REGULAR,
    amount: 35,
    width: 12,
    height: 6,
    dispersion: 30,
    dispersionReach: 50,
    frost: 0.4,
    light: 0.2,
    rim: 0.4,
    quality: "high",
  },
  inset: 2,
  pressedScale: 1.3,
};

/**
 * Fast refresh keeps the old state object across edits, and old objects are missing whatever a
 * new knob added — merging against the defaults at every level keeps a mid-session edit from
 * handing a slider `undefined`.
 */
function normalize(state: Params): Params {
  return {
    ...DEFAULTS,
    ...state,
    rest: { ...DEFAULTS.rest, ...state.rest },
    drag: { ...DEFAULTS.drag, ...state.drag },
    pairs: {
      dark: { ...DEFAULTS.pairs.dark, ...state.pairs?.dark },
      light: { ...DEFAULTS.pairs.light, ...state.pairs?.light },
    },
  };
}

const rgba = (level: number, alpha: number): string =>
  `rgba(${level},${level},${level},${alpha})`;

function buildMetal(m: MetalParams): GlassMetalOptions {
  return {
    refraction: {
      amount: m.amount,
      width: m.width,
      height: m.height,
      depth: m.depth,
      swirl: m.swirl,
      curve: { power: m.curvePower, bias: m.curveBias },
    },
    dispersion: { amount: m.dispersion, reach: m.dispersionReach },
    blurRadius: m.blurRadius,
    frost: m.frost,
    saturation: m.saturation,
    noise: m.noise,
    light: m.light,
    opacity: m.opacity,
    highlight: {
      intensity: m.rim,
      angle: m.rimAngle,
      width: m.rimWidth,
      falloff: m.rimFalloff,
    },
    border: { width: m.borderWidth, opacity: m.borderOpacity },
    android: { quality: m.quality },
  };
}

const paletteFor = (p: Params) => ({
  dark: {
    tabBarSurface: rgba(p.pairs.dark.barLevel, p.pairs.dark.barAlpha),
    tabIndicatorSurface: rgba(p.pairs.dark.pillLevel, p.pairs.dark.pillAlpha),
  },
  light: {
    tabBarSurface: rgba(p.pairs.light.barLevel, p.pairs.light.barAlpha),
    tabIndicatorSurface: rgba(p.pairs.light.pillLevel, p.pairs.light.pillAlpha),
  },
});

function buildProps(p: Params) {
  const palette = paletteFor(p)[p.scheme];
  return {
    pillMetal: buildMetal(p.rest),
    pillDraggedMetal: buildMetal(p.drag),
    pillInset: p.inset,
    pillPressedScale: p.pressedScale,
    tint: palette.tabBarSurface,
    pillTint: palette.tabIndicatorSurface,
    accentColor: GLASS_UI_PALETTE[p.scheme].accent,
    inactiveColor: GLASS_UI_PALETTE[p.scheme].inactive,
  };
}

/** The stage flips with the scheme — a light pair can only be judged over a light room. */
const STAGE = {
  dark: {
    gradient: ["#20315c", "#101018"] as const,
    backdrop: "#101018",
    title: "#ffffff",
  },
  light: {
    gradient: ["#c9dcff", "#f4f4f8"] as const,
    backdrop: "#f4f4f8",
    title: "#101018",
  },
};

const SHEET_GLASS: GlassMetalOptions = {
  blurRadius: 14,
  frost: 0.62,
  saturation: 1.5,
  refraction: { amount: 24, width: 10, height: 10 },
  dispersion: { amount: 0 },
};

type TMetalNumeric = Exclude<keyof MetalParams, "quality">;
type TMetalKnob = {
  key: TMetalNumeric;
  label: string;
  min: number;
  max: number;
  step: number;
};

/** One table, rendered twice, so rest and dragged can never drift apart. */
const METAL_KNOBS: readonly TMetalKnob[] = [
  { key: "amount", label: "refract", min: 0, max: 200, step: 1 },
  { key: "width", label: "band w", min: 1, max: 60, step: 1 },
  { key: "height", label: "band h", min: 1, max: 60, step: 1 },
  { key: "depth", label: "depth", min: 0, max: 1, step: 0.01 },
  { key: "swirl", label: "swirl", min: -1, max: 1, step: 0.05 },
  { key: "curvePower", label: "curve pow", min: 0.2, max: 4, step: 0.05 },
  { key: "curveBias", label: "curve bias", min: -1, max: 1, step: 0.05 },
  { key: "dispersion", label: "dispersion", min: 0, max: 30, step: 0.5 },
  { key: "dispersionReach", label: "disp reach", min: 0, max: 80, step: 1 },
  { key: "blurRadius", label: "blur", min: 0, max: 40, step: 1 },
  { key: "frost", label: "frost", min: 0, max: 1, step: 0.01 },
  { key: "saturation", label: "saturation", min: 0, max: 4, step: 0.05 },
  { key: "noise", label: "noise", min: 0, max: 0.5, step: 0.01 },
  { key: "light", label: "body light", min: 0, max: 2, step: 0.05 },
  { key: "opacity", label: "opacity", min: 0, max: 1, step: 0.01 },
  { key: "rim", label: "rim light", min: 0, max: 3, step: 0.05 },
  { key: "rimAngle", label: "rim angle", min: 0, max: 360, step: 5 },
  { key: "rimWidth", label: "rim width", min: 0, max: 6, step: 0.05 },
  { key: "rimFalloff", label: "rim falloff", min: 0.05, max: 4, step: 0.05 },
  { key: "borderWidth", label: "border w", min: 0, max: 4, step: 0.05 },
  { key: "borderOpacity", label: "border", min: 0, max: 1, step: 0.01 },
];

const QUALITIES: readonly TQuality[] = ["low", "medium", "high"];

type TSection = "pair" | "rest" | "drag" | "geom" | "json" | "none";

export default function GlassUITunerDemo(): React.JSX.Element {
  const [tab, setTab] = useState(0);
  const [pState, setP] = useState<Params>(DEFAULTS);
  const [sheetVisible, setSheetVisible] = useState(true);
  const [open, setOpen] = useState<TSection>("pair");

  const p = normalize(pState);
  const pair = p.pairs[p.scheme];
  const stage = STAGE[p.scheme];
  const props = buildProps(p);

  const set = (patch: Partial<Params>) =>
    setP((prev) => ({ ...normalize(prev), ...patch }));
  const setPair = (patch: Partial<TintPair>) =>
    setP((prev) => {
      const n = normalize(prev);
      return {
        ...n,
        pairs: { ...n.pairs, [n.scheme]: { ...n.pairs[n.scheme], ...patch } },
      };
    });
  const setMetal = (which: "rest" | "drag", patch: Partial<MetalParams>) =>
    setP((prev) => {
      const n = normalize(prev);
      return { ...n, [which]: { ...n[which], ...patch } };
    });
  const toggle = (section: TSection) =>
    setOpen((cur) => (cur === section ? "none" : section));

  const output = {
    pillMetal: props.pillMetal,
    pillDraggedMetal: props.pillDraggedMetal,
    pillInset: props.pillInset,
    pillPressedScale: props.pillPressedScale,
    palette: paletteFor(p),
  };
  const json = JSON.stringify(output, null, 1);

  return (
    <View style={[styles.root, { backgroundColor: stage.backdrop }]}>
      <LiquidGlassProvider style={StyleSheet.absoluteFill}>
        <View style={styles.stage}>
          <LinearGradient colors={stage.gradient} style={StyleSheet.absoluteFill} />
          {/* A loud band right behind the bar, so the pill always has edges to bend. */}
          <View style={styles.cardRow} pointerEvents="none">
            {CARD_COLORS.map((color, i) => (
              <View key={i} style={[styles.card, { backgroundColor: color }]} />
            ))}
          </View>
          <Text style={[styles.stageTitle, { color: stage.title }]}>
            Pill{"\n"}tuner
          </Text>
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
          // The sheet keeps its own dark wash so its white labels survive the light stage.
          tint="rgba(16,16,22,0.55)"
          style={styles.sheet}
        >
          <View style={styles.sheetHeader}>
            <Segmented
              options={["dark", "light"]}
              value={p.scheme}
              onChange={(scheme) => set({ scheme: scheme as TScheme })}
            />
            <View style={styles.headerButtons}>
              {/* There is no clipboard on this screen, so the tuned state leaves the device
                  through the Metro log — one tap, one line, exact values. */}
              <Pressable
                style={styles.reset}
                onPress={() => console.log(`[tuner] ${JSON.stringify(output)}`)}
              >
                <Text style={styles.resetText}>log</Text>
              </Pressable>
              <Pressable style={styles.reset} onPress={() => setP(DEFAULTS)}>
                <Text style={styles.resetText}>reset</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView
            style={styles.sheetScroll}
            showsVerticalScrollIndicator={false}
            overScrollMode="never"
          >
            <Section id="pair" title={`pair · ${p.scheme}`} open={open} onToggle={toggle}>
              <Text style={styles.hint}>
                {p.scheme === "dark"
                  ? "dark bar, light pill"
                  : "light bar, dark pill"}
              </Text>
              <Slider label="bar level" value={pair.barLevel} min={0} max={255} step={1} onChange={(barLevel) => setPair({ barLevel })} />
              <Slider label="bar alpha" value={pair.barAlpha} min={0} max={1} step={0.01} onChange={(barAlpha) => setPair({ barAlpha })} />
              <Slider label="pill level" value={pair.pillLevel} min={0} max={255} step={1} onChange={(pillLevel) => setPair({ pillLevel })} />
              <Slider label="pill alpha" value={pair.pillAlpha} min={0} max={1} step={0.01} onChange={(pillAlpha) => setPair({ pillAlpha })} />
            </Section>

            <Section id="rest" title="pill · rest" open={open} onToggle={toggle}>
              <Text style={styles.hint}>the pill you see when nothing is held</Text>
              <MetalGroup
                value={p.rest}
                onChange={(patch) => setMetal("rest", patch)}
              />
            </Section>

            <Section id="drag" title="pill · dragged" open={open} onToggle={toggle}>
              <Text style={styles.hint}>long-drag the pill to hold this state</Text>
              <MetalGroup
                value={p.drag}
                onChange={(patch) => setMetal("drag", patch)}
              />
            </Section>

            <Section id="geom" title="geometry" open={open} onToggle={toggle}>
              <Slider label="inset" value={p.inset} min={0} max={6} step={1} onChange={(inset) => set({ inset })} />
              <Slider label="pressedScale" value={p.pressedScale} min={1} max={1.8} step={0.01} onChange={(pressedScale) => set({ pressedScale })} />
            </Section>

            <Section id="json" title="json" open={open} onToggle={toggle}>
              <Text style={styles.json} selectable>
                {json}
              </Text>
            </Section>
          </ScrollView>
        </LiquidGlassView>
      )}
    </View>
  );
}

// ------------------------------------------------------------------------------------ controls

function Section({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: TSection;
  title: string;
  open: TSection;
  onToggle: (id: TSection) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const isOpen = open === id;
  return (
    <>
      <Pressable style={styles.groupRow} onPress={() => onToggle(id)}>
        <Text style={styles.group}>{title}</Text>
        <Text style={styles.groupChevron}>{isOpen ? "▾" : "▸"}</Text>
      </Pressable>
      {isOpen ? children : null}
    </>
  );
}

function MetalGroup({
  value,
  onChange,
}: {
  value: MetalParams;
  onChange: (patch: Partial<MetalParams>) => void;
}): React.JSX.Element {
  return (
    <>
      {METAL_KNOBS.map((knob) => (
        <Slider
          key={knob.key}
          label={knob.label}
          value={value[knob.key]}
          min={knob.min}
          max={knob.max}
          step={knob.step}
          onChange={(v) => onChange({ [knob.key]: v } as Partial<MetalParams>)}
        />
      ))}
      <View style={styles.segRow}>
        <Segmented
          options={QUALITIES}
          value={value.quality}
          onChange={(quality) => onChange({ quality: quality as TQuality })}
        />
      </View>
    </>
  );
}

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
    // Snapped, then rounded off the float dust — the JSON below is meant to be pasted.
    const snapped = Math.round((min + frac * (max - min)) / step) * step;
    const next = Math.round(snapped * 1000) / 1000;
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
  root: { flex: 1 },
  stage: { flex: 1 },
  stageTitle: {
    position: "absolute",
    top: 110,
    left: 24,
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
    maxHeight: "58%",
    padding: 14,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  sheetScroll: { flexGrow: 0 },
  segRow: { flexDirection: "row", gap: 8, marginTop: 4, marginBottom: 6 },
  hint: {
    color: "#ffffff99",
    fontSize: 11,
    fontStyle: "italic",
    marginBottom: 2,
  },

  headerButtons: { flexDirection: "row", gap: 8 },
  reset: {
    backgroundColor: "#00000055",
    borderRadius: 15,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  resetText: { color: "#ffffff", fontSize: 12, fontWeight: "700" },

  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    marginBottom: 2,
  },
  group: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    opacity: 0.75,
  },
  groupChevron: { color: "#ffffff", fontSize: 11, opacity: 0.75 },
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
    marginTop: 6,
    color: "#ffffff99",
    fontSize: 9,
    fontFamily: "monospace",
  },
});
