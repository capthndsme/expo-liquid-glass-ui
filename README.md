# expo-liquid-glass-ui

Liquid Glass **controls** for React Native — a tab bar, button, switch, slider and text input in the
iOS 26 style, built entirely on
[`expo-liquid-glass-view`](https://github.com/capthndsme/expo-liquid-glass-view/tree/android-port).
The base view
carries the rendering (Apple's `UIGlassEffect` on iOS 26+, a Metal renderer below it, an AGSL port
on Android 13+ with graceful tiers down to API 29), so these components are the *backport of the
controls*: the geometry, choreography and palette of Apple's glass controls, running on Android and
on iOS versions that never got them.

The designs are ported from the
[AndroidLiquidGlass](https://github.com/Kyant0/AndroidLiquidGlass) catalog — `LiquidButton`,
`LiquidToggle`, `LiquidSlider` and `LiquidBottomTabs` — with the text field styled to match. Not
just the look: the catalog's `DampedDragAnimation` physics rig is ported whole, so the controls
share its springs, its velocity-driven jelly and its convergence-gated release.

TypeScript only. No native code, no config plugin: if `expo-liquid-glass-view` runs, this runs.

## Install

Neither package is on npm yet — both install from git:

```bash
npm install github:capthndsme/expo-liquid-glass-ui \
  github:capthndsme/expo-liquid-glass-view#android-port \
  react-native-reanimated react-native-gesture-handler
```

The branch matters. npm's `expo-liquid-glass-view` is the
[upstream package](https://github.com/rit3zh/expo-liquid-glass-view) — SwiftUI, iOS only — and the
Android renderer these controls need lives on the `android-port` branch of the fork above. Install
it by bare name and the kit has nothing to draw with on Android.

Gestures and springs are Reanimated worklets driven by `react-native-gesture-handler` — drag
tracking, the springs, and even the switch's track-color interpolation run on the UI thread with
**no JS work per frame**, which is what keeps the controls smooth on 120 Hz displays and under a
busy JS thread. Both peers are the Expo defaults; wrap the app in `GestureHandlerRootView` as
usual.

## Android needs a provider

On Android the base library captures the backdrop explicitly. Wrap the content that should show
*through* the glass in a `LiquidGlassProvider`, and put these controls **after it as siblings —
never inside it** (a nested glass view would refract its own output). The provider is a plain
`View` on iOS and web, so one tree ships everywhere:

```tsx
import { LiquidGlassProvider } from "expo-liquid-glass-view";

<View style={{ flex: 1 }}>
  <LiquidGlassProvider style={StyleSheet.absoluteFill}>
    {/* screen content */}
  </LiquidGlassProvider>

  {/* glass controls go here, after the provider */}
</View>;
```

Give the provider exactly **one** direct child (a wrapper `View` around your background and
scroller). Measured on device: with two direct children the native provider view lays out only the
first — the second never appears.

## Components

### LiquidGlassTabBar

A capsule glass bar with a glass pill that springs between tabs — tap a tab, or grab the pill and
drag it. It balloons to `78/56` while held, **stretches like jelly** with the drag, and snaps to
the nearest tab on release.

Six things from the reference are ported in full:

- **The jelly is velocity-driven counter-scaling**, not a lag or trail term. X divides and Y
  multiplies by a clamped ±20% of the follower's velocity, so the deformation is
  volume-preserving and inverts on reverse motion. The two axes use deliberately mismatched
  springs (`ζ 0.6` on X, `0.7` on Y) — that 0.1 asymmetry *is* the wobble.
- **The grab outlives the finger.** Release is gated on convergence: the pill stays inflated and
  refractive until it is within 2.5% of its target, then deflates. Deflating on finger-up instead
  is the usual way this gets lost.
- **The pill is clear because the bar is not.** The bar runs `vibrancy → blur(8dp) → lens(24,24)`
  permanently while the resting pill attaches *no render effect at all*. The clarity is relative;
  flatten the bar and it disappears.
- **The accent row lives under the glass.** A screen-invisible copy of the row, tinted to the
  accent and swelling to 1.2× on grab, is composited into the pill's backdrop — so it reaches the
  eye only through the pill's lens and dispersion, cut exactly at the capsule edge.
- **The bar looks smaller through the pill.** That accent copy is not just icons: it carries a
  second capsule, 56dp against the visible 64dp. The pill therefore has *two* rims to bend rather
  than one, and the 4dp inset between them is the whole of the effect. Give the accent layer
  nothing of its own and the pill shows the bar at its true size.
- **The bar lights up under the grabbed pill.** `InteractiveHighlight`: a flat additive wash plus a
  soft lobe centred on the pill, running on its own bouncier spring (`ζ 0.5 / k 300`) and released
  the instant the finger lifts — while the pill's own press stays pinned at 1 through the entire
  flight home. The two are meant to disagree.

```tsx
import { LiquidGlassTabBar } from "expo-liquid-glass-ui";
import { Ionicons } from "@expo/vector-icons";

const [index, setIndex] = useState(0);

<LiquidGlassTabBar
  selectedIndex={index}
  onTabSelected={setIndex}
  tabs={[
    { key: "home", title: "Home", icon: ({ color, size }) => <Ionicons name="home" color={color} size={size} /> },
    { key: "search", title: "Search", icon: ({ color, size }) => <Ionicons name="search" color={color} size={size} /> },
    { key: "profile", title: "You", icon: ({ color, size }) => <Ionicons name="person" color={color} size={size} /> },
  ]}
  style={{ position: "absolute", left: 16, right: 16, bottom: 32 }}
/>;
```

`accentColor`, `inactiveColor`, `tint`, `height` (default 64), `pillHeight` (56),
`pillPressedScale`, `barMetal`, `pillMetal`, `pillDraggedMetal`, `pillTint`, `labelStyle` and
`providerId` are all overridable; the defaults follow the scheme (light/dark) with the iOS system
palette.

### LiquidGlassButton

A 48pt glass capsule with the reference's full jelly: a grow-on-press spring on every renderer,
plus rubber-band follow toward the finger and stretch along the drag axis — all Reanimated
worklets observing the touch without ever stealing a scroll.

```tsx
import { LiquidGlassButton } from "expo-liquid-glass-ui";

<LiquidGlassButton onPress={submit}>Continue</LiquidGlassButton>
<LiquidGlassButton onPress={buy} tint="#0088FFCC">Buy now</LiquidGlassButton>
```

String children are wrapped in a styled `Text` (white when tinted, label color otherwise);
anything else renders as-is in a centered row.

### LiquidGlassSwitch

The 64×28 toggle: a colored capsule track under a 40×24 glass thumb. At rest the thumb wears an
opaque white fill over an 8dp frost; pressing melts the fill away, drops the blur to **zero** and
balloons the bare glass to 1.5× — a full lens ball with chromatic dispersion over a combined
`[screen, track]` backdrop, so the green body and the world behind the switch both bend through
it. Drag it across or tap to toggle. Both routes play the same press → fly → release
choreography, and both carry the jelly (at the reference's gentler `÷50` setting).

```tsx
import { LiquidGlassSwitch } from "expo-liquid-glass-ui";

<LiquidGlassSwitch value={enabled} onValueChange={setEnabled} />;
```

`accentColor` (on-state, defaults to system green) and `trackColor` take parseable color strings —
they feed `Animated` color interpolation.

### LiquidGlassSlider

A 6dp track under the same 40×24 glass thumb the switch uses — but on the reference's
full-strength jelly setting (`÷10` rather than `÷50`), which is the control the effect was
originally tuned on. A tap on the track seeks without jumping: it plays the whole grab, so
seeking looks exactly like dragging.

```tsx
import { LiquidGlassSlider } from "expo-liquid-glass-ui";

const [volume, setVolume] = useState(0.5);

<LiquidGlassSlider value={volume} onValueChange={setVolume} />;
```

`minimumValue`/`maximumValue` (0–1 by default), `accentColor`, `trackColor`, `onSlidingComplete`,
`thumbMetal`, `thumbPressedMetal` and `providerId` are all overridable.

### LiquidGlassTextInput

A glass capsule field with `leading`/`trailing` slots and an accent focus ring that springs in.
Accepts every `TextInput` prop.

```tsx
import { LiquidGlassTextInput } from "expo-liquid-glass-ui";

<LiquidGlassTextInput
  placeholder="Search"
  value={query}
  onChangeText={setQuery}
  leading={<Ionicons name="search" size={18} color="#8E8E93" />}
/>;
```

## Theme

`useGlassUITheme()` returns the resolved scheme and the palette the controls use
(system blue/green, label/inactive/placeholder, surface washes), and `GLASS_UI_PALETTE` exposes
both schemes statically.

## Fidelity notes

Honest deltas against the Compose originals:

- **Dispersion is a magnitude here, not a boolean.** The reference flips `chromaticAberration` on
  and takes 7 fixed spectral taps; the base view walks N taps along the displacement axis and
  masks them into channels. The *shape* of the effect now matches — `dispersion.quadrant: 1` was
  added to the base view's shader for this, and it reproduces Kyant's `(cx·cy)/(hx·hy)` weighting
  including the sign flip, so a capsule fringes at its two ends, hue order reversing between them,
  and stays clean along the flanks. The exact per-channel weights are still not tap-for-tap equal.
- **Dispersion has a usable range, and it is narrow.** Under ~2dp of spread the shader skips it
  entirely; over the tap budget it steps into discrete bands. `quality: "medium"` spaces its 8 taps
  one *point* apart and `"high"` its 16 one *pixel* apart, so the wider the fringe the more the
  expensive tier earns its cost. The pill runs 12dp on `"high"`; everything else is narrow enough
  for `"medium"`.
- **No shadows.** The reference's pill carries `Shadow(alpha = p)` and `InnerShadow(8dp × p)`;
  the base view has no shadow or inner-shadow effect at all, so the pill has no drop or depth.
- **Nothing here.** The one deviation that used to live in this list — a plain capsule in place of
  the reference's second glass bar — turned out to be a mistake in both directions. It came from
  measuring the strip while the pill was still sampling a *three*-layer backdrop; drop the visible
  bar from that stack, as the reference does, and the faithful version is both correct and
  **faster** (POCO F1: 61 fps at 0.8% jank, against 45 fps at 28% for the three-layer stack).
- **The button's press glow is the reference's own fallback.** Its buttons light up with a flat
  additive white plus a finger-centred radial, both `BlendMode.Plus`. React Native has neither, so
  the button uses the flat `White α0.25 × p` the reference itself declares for devices without
  runtime shaders. The *tab bar* is exact — it drives the base view's `glow` prop, which is that
  same highlight living in the AGSL where it belongs.
- **The pill's cutout is hard on Android, soft on iOS.** Android composites explicit provider
  layers, so the pill covers the inactive row and the accent copy replaces it — the reference's
  exact behaviour, icons sliced in two at the capsule edge. iOS samples a window capture that
  already contains those icons, so there the inactive item fades under the pill instead.

Everything gesture-driven animates its `metal` per frame through `lerpMetal` and
`useAnimatedProps`, the way the reference recomposes its effect chain — no React state is in the
path of a material change. That is exported, so app code can do the same:

```tsx
const props = useAnimatedProps(() => ({
  metal: lerpMetal(REST, HELD, pressProgress.value),
}));
```

## Working on this

The dev dependency on the base view is a path — `file:../expo-liquid-glass-view` — so a clone
expects its sibling checked out next to it, on the `android-port` branch, and built once
(`npm run build` there) before `npm install` here can typecheck against it:

```
projects/
  expo-liquid-glass-view/   # android-port branch
  expo-liquid-glass-ui/     # this repo
```

The base repo's example app has a **ui tune** screen that drives this kit's tab bar off live
sliders — every `metal` knob for both pill states, both scheme pairs, and a `log` button that
prints the tuned JSON to the Metro console. The shipped defaults came from it.

## License

MIT
