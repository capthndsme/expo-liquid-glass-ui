import * as React from "react";
import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import {
  I18nManager,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { LiquidGlassProvider, LiquidGlassView } from "../../core";

import {
  ABSOLUTE_FILL,
  GLASS_ACCENT_STRIP_METAL,
  GLASS_ACCENT_STRIP_PRESSED_METAL,
  GLASS_BAR_CLEAR_METAL,
  GLASS_BAR_METAL,
  GLASS_PILL_DRAGGED_METAL,
  GLASS_PILL_METAL,
  PANEL_SPRING,
  TAB_ACCENT_PRESSED_SCALE,
  TAB_ACCENT_STRIP_HEIGHT,
  TAB_BAR_HEIGHT,
  TAB_BAR_PADDING,
  TAB_BAR_PRESS_GROWTH,
  TAB_CONTENT_GAP,
  TAB_ICON_SIZE,
  TAB_ICON_SLOT,
  TAB_LABEL_SIZE,
  TAB_PANEL_MAX_OFFSET,
  TAB_PILL_BLOOM_WIDTH,
  TAB_PILL_HEIGHT,
  TAB_PILL_PRESSED_SCALE,
  TAB_VELOCITY_DIVISOR,
} from "../../constants";
import { useDampedDrag, usePressProgress } from "../../hooks";
import type {
  ILiquidGlassTabBarProps,
  ILiquidGlassTabItem,
} from "../../interfaces";
import { useGlassUITheme } from "../../theme";
import { lerpMetal } from "../../utils";

/** The reference's rubber-band curve — Compose `EaseOut`, i.e. CSS `ease-out`. */
const EASE_OUT = Easing.bezier(0, 0, 0.58, 1).factory();

/**
 * Every glass surface here changes under the finger, so all three are animated components. The
 * props they take from the UI thread — `metal` and `glow` — are re-uploaded as shader uniforms and
 * redrawn; no geometry rebuild, no backdrop re-record, no JS.
 */
const AnimatedGlassView = Animated.createAnimatedComponent(LiquidGlassView);

/**
 * On Android the pill's backdrop is an explicit stack of provider layers, so the pill paints over
 * the inactive row and the accent copy underneath replaces it — the reference's hard cutout, which
 * slices icons in two at the capsule edge.
 *
 * Everywhere else that machinery does not exist: iOS declares no provider props (its Metal path
 * captures the whole window) and web has no native module at all — so before this split the
 * accent copy only ever reached the eye through a backdrop nothing else could sample, and the
 * active item faded to nothing. QA's "tap home, home button disappears". The soft cutout is the
 * same slice built from plain views: the active item still fades out under the pill, and a
 * clipped capsule window riding the pill shows the wash and the accent copy instead — no
 * backdrop required, so it also survives every renderer downgrade below glass.
 */
const CUTOUT_IS_HARD = Platform.OS === "android";

/**
 * The reference's second `onDrawSurface` rect: a 3% black wash that fades *in* under the grab, as
 * the resting fill fades out. Black in both themes — the resting fill is the one that flips.
 */
const PILL_WASH_ALPHA = 0.03;

interface IBaseTabProps {
  tab: ILiquidGlassTabItem;
  index: number;
  selected: boolean;
  position: SharedValue<number>;
  color: string;
  labelStyle: ILiquidGlassTabBarProps["labelStyle"];
  onPress: (index: number) => void;
}

/** One inactive tab. The pill covers it; see {@link CUTOUT_IS_HARD}. */
const BaseTab: React.FC<IBaseTabProps> = ({
  tab,
  index,
  selected,
  position,
  color,
  labelStyle,
  onPress,
}: IBaseTabProps): React.ReactElement => {
  const fadeStyle = useAnimatedStyle(() =>
    CUTOUT_IS_HARD
      ? { opacity: 1 }
      : { opacity: Math.min(1, Math.abs(position.value - index)) },
  );
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={tab.title ?? tab.key}
      onPress={() => onPress(index)}
      style={styles.tab}
    >
      <Animated.View style={[styles.tabContent, fadeStyle]}>
        <View style={styles.iconSlot}>
          {tab.icon?.({ focused: false, color, size: TAB_ICON_SIZE })}
        </View>
        {tab.title != null ? (
          <Text style={[styles.label, { color }, labelStyle]}>{tab.title}</Text>
        ) : null}
      </Animated.View>
    </Pressable>
  );
};

interface IAccentRowProps {
  tabs: ILiquidGlassTabItem[];
  accent: string;
  labelStyle: ILiquidGlassTabBarProps["labelStyle"];
  scaleStyle: React.ComponentProps<typeof Animated.View>["style"];
}

/**
 * The focused row, accent throughout. One copy feeds Android's provider layer, the other fills the
 * soft cutout's window — shared so the two cutouts cannot drift apart.
 */
const AccentRow: React.FC<IAccentRowProps> = ({
  tabs,
  accent,
  labelStyle,
  scaleStyle,
}: IAccentRowProps): React.ReactElement => {
  return (
    <View style={styles.row}>
      {tabs.map((tab) => (
        <View key={tab.key} style={styles.tab}>
          <Animated.View style={[styles.tabContent, scaleStyle]}>
            <View style={styles.iconSlot}>
              {tab.icon?.({ focused: true, color: accent, size: TAB_ICON_SIZE })}
            </View>
            {tab.title != null ? (
              <Text style={[styles.label, { color: accent }, labelStyle]}>
                {tab.title}
              </Text>
            ) : null}
          </Animated.View>
        </View>
      ))}
    </View>
  );
};

/**
 * The catalog's `LiquidBottomTabs`.
 *
 * Three stacked siblings, in the reference's own z-order:
 *
 * 1. **The visible bar** — glass with the always-on material, carrying the real, tappable tab row.
 * 2. **A screen-invisible accent clone**, recorded into its own provider. Not just tinted icons: a
 *    second, complete glass bar 8dp shorter than the visible one, with its own fill and its own
 *    lens. That inset rim is what the pill's lens finds to bend, and it is why the bar reads as
 *    *smaller* through the pill than beside it.
 * 3. **The pill**, last and therefore on top, reading `[screen, accent]` as one combined backdrop.
 *    Whatever it covers appears accent-blue; everything outside stays inactive. There is no
 *    cross-fade and no per-tab colour lerp — the transition follows the capsule edge exactly.
 *
 * The visible bar is deliberately **absent** from that stack, exactly as the reference's
 * `rememberCombinedBackdrop(backdrop, tabsBackdrop)` leaves it out. Including it scrims everything
 * the pill shows a second time — the bar's container fill on top of the strip's — and the pill goes
 * darker and flatter than the bar around it. It is also *slower*: on a POCO F1 the three-layer
 * stack measured 45 fps at 28% jank against 61 fps at 0.8% for this one.
 *
 * All of the above is the Android build. Where the provider stack does not exist — iOS, web — the
 * accent clone is not rendered at all; a clipped capsule window rides *on* the pill instead,
 * holding the wash and the accent row (the soft cutout, {@link CUTOUT_IS_HARD}). The backdrop
 * trick and the JS trick draw the same picture; only the mechanism is per-platform.
 *
 * Nothing above swaps on a React state change. The pill's lens, the strip's lens and the light the
 * bar throws under the pill are all continuous functions of one shared value, written to the native
 * views from the UI thread — the reference recomposes its effect chain every frame of a press, and
 * anything less lands a frame late and at the wrong moment.
 *
 * The motion is `DampedDragAnimation`: a critically-damped follower chased by an underdamped
 * velocity channel, with the grab held through the whole snap and released only on arrival.
 */
const LiquidGlassTabBarBase: React.FC<ILiquidGlassTabBarProps> = ({
  tabs,
  selectedIndex,
  onTabSelected,
  accentColor,
  inactiveColor,
  tint,
  variant = "regular",
  height = TAB_BAR_HEIGHT,
  barMetal,
  pillMetal,
  pillDraggedMetal,
  pillTint,
  pillHeight = TAB_PILL_HEIGHT,
  pillPressedScale = TAB_PILL_PRESSED_SCALE,
  providerId,
  style,
  labelStyle,
}: ILiquidGlassTabBarProps): React.ReactElement => {
  const { colors } = useGlassUITheme();
  const accent = accentColor ?? colors.accent;
  const inactive = inactiveColor ?? colors.inactive;
  const count = Math.max(tabs.length, 1);
  const direction = I18nManager.isRTL ? -1 : 1;
  const accentLayerId = `glass-ui-tabs-${useId()}-accent`;

  const [width, setWidth] = useState(0);
  const tabWidth = width > 0 ? (width - TAB_BAR_PADDING * 2) / count : 0;
  const pillTop = (height - pillHeight) / 2;
  const stripHeight = Math.min(TAB_ACCENT_STRIP_HEIGHT, height);
  const stripTop = (height - stripHeight) / 2;

  const restMetal = pillMetal ?? GLASS_PILL_METAL;
  const grabbedMetal = pillDraggedMetal ?? GLASS_PILL_DRAGGED_METAL;
  // The whole dress switches together: a clear bar needs its fill pulled back *and* its material
  // re-leaned, and the accent strip has to follow or the pill would show a scrim the bar no longer
  // has. `barMetal`/`tint` still override either.
  const isClear = variant === "clear";
  const surfaceTint =
    tint ?? (isClear ? colors.tabBarSurfaceClear : colors.tabBarSurface);
  const resolvedBarMetal =
    barMetal ?? (isClear ? GLASS_BAR_CLEAR_METAL : GLASS_BAR_METAL);

  const drag = useDampedDrag({
    range: [0, count - 1],
    initialValue: selectedIndex,
    pressedScale: pillPressedScale,
    velocityDivisor: TAB_VELOCITY_DIVISOR,
  });

  /**
   * The bar's light runs on its own clock. `InteractiveHighlight` presses with `spring(0.5f, 300f)`
   * and lets go the moment the finger does, while the pill's `spring(1f, 1000f)` press stays pinned
   * at 1 until the follower has arrived. Driving both from one value — which is what a single
   * `pressProgress` would do — makes the bar hold its glow through the whole flight home, and the
   * grab stops reading as a grab.
   */
  const glow = usePressProgress();

  /** Raw accumulated drag in px, unclamped — feeds the whole-panel rubber band. */
  const panelDrag = useSharedValue(0);
  const panelOffset = useSharedValue(0);
  const barWidth = useSharedValue(0);
  const slotWidth = useSharedValue(0);
  /** Mirrors `selectedIndex` on the UI thread so the drag can tell when the landing changed. */
  const committedIndex = useSharedValue(selectedIndex);

  const lastReported = useRef(selectedIndex);

  useEffect(() => {
    barWidth.value = width;
    slotWidth.value = tabWidth;
  }, [barWidth, slotWidth, width, tabWidth]);

  // An external change plays the full grab choreography, exactly as a tap does — the reference's
  // `animateToValue` presses, flies and releases rather than tweening the position.
  useEffect(() => {
    if (lastReported.current === selectedIndex) return;
    lastReported.current = selectedIndex;
    committedIndex.value = selectedIndex;
    drag.animateTo(selectedIndex);
  }, [committedIndex, drag, selectedIndex]);

  const commit = useCallback(
    (index: number): void => {
      lastReported.current = index;
      onTabSelected(index);
    },
    [onTabSelected],
  );

  // The gesture lives on the pill alone — the reference puts its drag inspector on the pill and
  // leaves the tabs to their own click handling.
  //
  // The reference presses on touch-down (`awaitFirstDown`, no slop) and this did too, which is
  // wrong the moment a bar floats over a scroll view: a finger landing on the pill to *scroll*
  // inflated it and lit the whole bar, and since the press spring is `spring(1f, 1000f)` the
  // apology took ~130 ms to play out. Requiring horizontal intent costs 6dp of travel nobody can
  // see and removes the flash entirely; `failOffsetY` hands a vertical drag straight to the
  // scroller. The reference never had to solve this — its tab bars sit in a static column.
  const pan = Gesture.Pan()
    .enabled(count > 1)
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .shouldCancelWhenOutside(false)
    .onBegin(() => {
      panelDrag.value = 0;
    })
    // Not `onBegin`: the grab starts when the gesture *activates*, which is the first moment the
    // drag is unambiguously horizontal.
    .onStart(() => {
      drag.press();
      glow.pressIn();
    })
    // `onChange` gives the incremental delta; `onUpdate` would give the cumulative translation,
    // and the reference accumulates onto the spring's *target*, one drag amount at a time.
    .onChange((event) => {
      if (slotWidth.value <= 0) return;
      drag.dragBy((direction * event.changeX) / slotWidth.value);

      // The rubber band tracks total signed drag, not overscroll, so it engages from the first
      // pixel anywhere on the strip — and it nudges the whole widget, never the pill alone.
      panelDrag.value += event.changeX;
      const f = Math.min(
        1,
        Math.max(-1, panelDrag.value / Math.max(barWidth.value, 1)),
      );
      panelOffset.value =
        TAB_PANEL_MAX_OFFSET * Math.sign(f) * EASE_OUT(Math.abs(f));
    })
    .onEnd(() => {
      // Plain round(), no fling: velocity feeds the jelly and nothing else, so a fast flick that
      // only crossed 0.4 of a cell snaps back.
      const target = Math.min(
        count - 1,
        Math.max(0, Math.round(drag.targetValue.value)),
      );
      drag.animateTo(target);
      if (target !== committedIndex.value) {
        committedIndex.value = target;
        runOnJS(commit)(target);
      }
    })
    .onFinalize(() => {
      drag.release();
      glow.pressOut();
      panelOffset.value = withSpring(0, PANEL_SPRING);
    });

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: panelOffset.value }],
  }));
  const barStyle = useAnimatedStyle(() => {
    const scale =
      1 +
      (TAB_BAR_PRESS_GROWTH / Math.max(barWidth.value, 1)) *
        drag.pressProgress.value;
    return { transform: [{ scale }] };
  });
  const accentScaleStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: 1 + (TAB_ACCENT_PRESSED_SCALE - 1) * drag.pressProgress.value,
      },
    ],
  }));
  const pillStyle = useAnimatedStyle(() => {
    const { scaleX, scaleY } = drag.jelly();
    // The grab scale is a *height* ratio (56 -> 78dp). Applied to width it overshoots badly on a
    // wide pill — held still, a 4-tab cell would hang ~17dp past its slot on each side, which is
    // the "overhanging" the flick fix could not touch because the jelly is at zero when the finger
    // stops. So the spring's own 0..1 progress is re-mapped onto a fixed 22dp of width instead,
    // preserving its overshoot and settle exactly. `scaleX / drag.scaleX.value` isolates the jelly
    // factor, which still rides on top.
    const bloom = pillPressedScale - 1;
    const grabbed = bloom > 1e-6 ? (drag.scaleX.value - 1) / bloom : 0;
    const widthGrab =
      slotWidth.value > 0
        ? 1 + (TAB_PILL_BLOOM_WIDTH / slotWidth.value) * grabbed
        : 1;
    const jellyX = drag.scaleX.value !== 0 ? scaleX / drag.scaleX.value : 1;
    return {
      transform: [
        { translateX: direction * drag.value.value * slotWidth.value },
        { scaleX: widthGrab * jellyX },
        { scaleY },
      ],
    };
  });

  // `InteractiveHighlight`, ported: a flat white wash over the whole bar plus a soft lobe centred
  // on the pill, both riding press progress, additive. It lives in the shader already — this is
  // only telling it where the finger is, since the finger is on the pill and not on the bar. The
  // reference hangs the same highlight on both rows, so the light shows through the pill too.
  //
  // `lens: false` is the point of the distinction: the bar lights up, it does not start refracting
  // harder because something sitting on top of it was grabbed.
  const barGlowProps = useAnimatedProps(() => ({
    glow: {
      progress: glow.progress.value,
      x: TAB_BAR_PADDING + (drag.value.value + 0.5) * slotWidth.value,
      y: height / 2,
      lens: false,
    },
  }));
  const accentProps = useAnimatedProps(() => ({
    glow: {
      progress: glow.progress.value,
      x: TAB_BAR_PADDING + (drag.value.value + 0.5) * slotWidth.value,
      y: stripHeight / 2,
      lens: false,
    },
    metal: lerpMetal(
      GLASS_ACCENT_STRIP_METAL,
      GLASS_ACCENT_STRIP_PRESSED_METAL,
      drag.pressProgress.value,
    ),
  }));
  const pillProps = useAnimatedProps(() => ({
    metal: lerpMetal(restMetal, grabbedMetal, drag.pressProgress.value),
  }));

  /**
   * The pill's own surface, and the reason a resting pill reads as a chip while a grabbed one reads
   * as clear glass. Two stacked rects, exactly the reference's `onDrawSurface`: the tinted fill
   * fades out under the grab and a 3% black wash fades in behind it.
   *
   * Siblings over the glass rather than its `tint`, because `tint` is a colour and a colour cannot
   * cross to the UI thread as a native prop. The one thing that costs is z-order — these sit over
   * the shader's rim light instead of under it — and it costs nothing in practice, because the rim
   * only exists at full press, which is exactly where the fill has already reached zero.
   */
  const pillFillStyle = useAnimatedStyle(() => ({
    opacity: 1 - drag.pressProgress.value,
    transform: [{ translateX: direction * drag.value.value * slotWidth.value }],
  }));
  const pillWashStyle = useAnimatedStyle(() => ({
    opacity: PILL_WASH_ALPHA * drag.pressProgress.value,
  }));

  /**
   * The soft cutout (see {@link CUTOUT_IS_HARD}): a capsule window riding the pill, with a
   * bar-sized accent row counter-translated inside so the copy stays glued to the real row while
   * the window's edge does the slicing. The wash sits inside the same window, under the icons —
   * the very spot the Android chip occupies in the accent layer. The window deliberately skips
   * the pill's bloom and jelly: the grabbed pill swells *around* a stable icon, which is also how
   * the Android lens reads.
   */
  const cutoutWindowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: direction * drag.value.value * slotWidth.value }],
  }));
  const cutoutContentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -direction * drag.value.value * slotWidth.value }],
  }));
  const cutoutFillStyle = useAnimatedStyle(() => ({
    opacity: 1 - drag.pressProgress.value,
  }));

  const handleLayout = (event: LayoutChangeEvent): void => {
    setWidth(event.nativeEvent.layout.width);
  };

  const handleTabPress = (index: number): void => {
    // The tap carries the liquid too. `animateTo` is the reference's `animateToValue`: it
    // presses, retargets the follower, and releases only once the value has essentially arrived —
    // so a tapped pill wears the same bloom and the same lens as one under a finger, and settles
    // back into the silent resting state on landing.
    //
    // This supersedes the hand-rolled version from main, which raised `pressProgress` with a
    // `withSpring` callback and guarded an interrupted flight on `finished === false`. The
    // convergence gate makes that guard structural: a second tap simply re-presses and re-arms it,
    // so there is no completion flag to mis-handle.
    committedIndex.value = index;
    drag.animateTo(index);
    if (index !== selectedIndex) commit(index);
  };

  return (
    <Animated.View
      onLayout={handleLayout}
      style={[{ height }, panelStyle, style]}
    >
      {/* The visible bar. Nothing records it: the pill reads the screen and the accent strip, and
          the reference is equally deliberate about that — a bar in the pill's stack would scrim
          the pill's view a second time with its own container fill. */}
      <Animated.View style={[StyleSheet.absoluteFill, barStyle]}>
        <AnimatedGlassView
          providerId={providerId}
          cornerRadius={height / 2}
          cornerStyle="continuous"
          tint={surfaceTint}
          metal={resolvedBarMetal}
          animatedProps={barGlowProps}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <View style={styles.row} pointerEvents="box-none">
        {tabs.map((tab, index) => (
          <BaseTab
            key={tab.key}
            tab={tab}
            index={index}
            selected={index === selectedIndex}
            position={drag.value}
            color={inactive}
            labelStyle={labelStyle}
            onPress={handleTabPress}
          />
        ))}
      </View>

      {/* The accent clone: screen-invisible, touch-inert, recorded at full strength, and stacked
          on top of the pill's combined backdrop — so all of this reaches the eye only through the
          pill's glass. The 2% wrapper opacity applies at composite time, after the provider has
          recorded its children. Android only: nothing else can sample a provider, so anywhere
          else this subtree is three mounted views nobody can ever see. */}
      {CUTOUT_IS_HARD ? (
        <View pointerEvents="none" style={styles.accentLayer}>
          <LiquidGlassProvider providerId={accentLayerId} style={styles.fill}>
            <View style={styles.fill}>
              {/* The inset strip: 56dp against the visible bar's 64dp, and the only glass the
                  pill reads. It therefore carries the whole material — vibrancy, blur and a lens
                  that ramps with the grab — because the visible bar is deliberately *not* in the
                  pill's stack. See GLASS_ACCENT_STRIP_METAL. */}
              <AnimatedGlassView
                providerId={providerId}
                cornerRadius={stripHeight / 2}
                cornerStyle="continuous"
                tint={surfaceTint}
                animatedProps={accentProps}
                style={[styles.strip, { top: stripTop, height: stripHeight }]}
              />
              {/* The resting pill's lift. It belongs *here*, under the accent icons, rather than
                  as a film over the pill's glass: the pill is showing this layer, so anything
                  painted on top of the lens washes the very icon the lens is displaying — a 20%
                  white film turned #0088FF into #38A0FD. Recorded beneath the icons it lifts the
                  strip and leaves the glyphs untouched. */}
              {tabWidth > 0 ? (
                <Animated.View
                  style={[
                    styles.pill,
                    {
                      start: TAB_BAR_PADDING,
                      top: pillTop,
                      width: tabWidth,
                      height: pillHeight,
                      borderRadius: pillHeight / 2,
                      backgroundColor: pillTint ?? colors.tabIndicatorSurface,
                    },
                    pillFillStyle,
                  ]}
                />
              ) : null}
              <AccentRow
                tabs={tabs}
                accent={accent}
                labelStyle={labelStyle}
                scaleStyle={accentScaleStyle}
              />
            </View>
          </LiquidGlassProvider>
        </View>
      ) : null}

      {tabWidth > 0 ? (
        <GestureDetector gesture={pan}>
          <Animated.View
            style={[
              styles.pill,
              {
                start: TAB_BAR_PADDING,
                top: pillTop,
                width: tabWidth,
                height: pillHeight,
              },
              pillStyle,
            ]}
          >
            <AnimatedGlassView
              // The reference's `rememberCombinedBackdrop(backdrop, tabsBackdrop)` exactly: the
              // screen, then the accent strip. The visible bar is deliberately absent — it carries
              // its own container fill, so including it scrims everything the pill shows a second
              // time and the pill reads darker and flatter than the bar around it.
              providerId={[providerId ?? "default", accentLayerId]}
              cornerRadius={pillHeight / 2}
              cornerStyle="continuous"
              animatedProps={pillProps}
              style={StyleSheet.absoluteFill}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                styles.pillWash,
                { borderRadius: pillHeight / 2 },
                pillWashStyle,
              ]}
            />
          </Animated.View>
        </GestureDetector>
      ) : null}

      {/* The soft cutout. Drawn over the pill's glass rather than into any backdrop, so it works
          on every renderer — UIGlassEffect, Metal, and the plain-View degrade alike. On the Metal
          path the window capture does contain this overlay, but the resting pill's refraction is
          zeroed, so its ghost sits exactly under the crisp copy. */}
      {!CUTOUT_IS_HARD && tabWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pill,
            styles.cutoutWindow,
            {
              start: TAB_BAR_PADDING,
              top: pillTop,
              width: tabWidth,
              height: pillHeight,
              borderRadius: pillHeight / 2,
            },
            cutoutWindowStyle,
          ]}
        >
          <Animated.View
            style={[
              styles.cutoutFill,
              { backgroundColor: pillTint ?? colors.tabIndicatorSurface },
              cutoutFillStyle,
            ]}
          />
          <Animated.View
            style={[
              styles.cutoutContent,
              { start: -TAB_BAR_PADDING, top: -pillTop, width, height },
              cutoutContentStyle,
            ]}
          >
            <AccentRow
              tabs={tabs}
              accent={accent}
              labelStyle={labelStyle}
              scaleStyle={accentScaleStyle}
            />
          </Animated.View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  pill: {
    position: "absolute",
  },
  pillWash: {
    backgroundColor: "#000",
  },
  accentLayer: {
    ...ABSOLUTE_FILL,
    opacity: 0.02,
  },
  cutoutWindow: {
    overflow: "hidden",
  },
  cutoutFill: {
    ...ABSOLUTE_FILL,
  },
  cutoutContent: {
    position: "absolute",
  },
  strip: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  row: {
    ...ABSOLUTE_FILL,
    flexDirection: "row",
    paddingHorizontal: TAB_BAR_PADDING,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tabContent: {
    alignItems: "center",
    gap: TAB_CONTENT_GAP,
  },
  iconSlot: {
    width: TAB_ICON_SLOT,
    height: TAB_ICON_SLOT,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: TAB_LABEL_SIZE,
    fontWeight: "400",
  },
});

const LiquidGlassTabBar: React.NamedExoticComponent<ILiquidGlassTabBarProps> =
  memo<ILiquidGlassTabBarProps>(LiquidGlassTabBarBase);
LiquidGlassTabBar.displayName = "LiquidGlassTabBar";

export { LiquidGlassTabBar };
