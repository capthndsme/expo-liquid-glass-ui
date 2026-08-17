# expo-liquid-glass-ui

Liquid Glass **controls** for React Native — a tab bar, button, switch and text input in the iOS 26
style, built entirely on [`expo-liquid-glass-view`](../expo-liquid-glass-view). The base view
carries the rendering (Apple's `UIGlassEffect` on iOS 26+, a Metal renderer below it, an AGSL port
on Android 13+ with graceful tiers down to API 29), so these components are the *backport of the
controls*: the geometry, choreography and palette of Apple's glass controls, running on Android and
on iOS versions that never got them.

The designs are ported from the
[AndroidLiquidGlass](https://github.com/Kyant0/AndroidLiquidGlass) catalog —
`LiquidButton`, `LiquidToggle` and `LiquidBottomTabs` — with the text field styled to match.

TypeScript only. No native code, no config plugin: if `expo-liquid-glass-view` runs, this runs.

## Install

```bash
npm install expo-liquid-glass-ui expo-liquid-glass-view react-native-reanimated react-native-gesture-handler
```

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

A capsule glass bar with a glass indicator pill that springs between tabs — tap a tab, or grab the
pill and drag it; it scales up while held and snaps to the nearest tab on release.

Three tricks from the reference are ported wholesale, on real combined backdrops: the pill
reads `[screen, bar glass, accent row]` composited in order, so it refracts the bar over the
content behind it through one lens; the accent row lives in a screen-invisible provider and
reaches the eye only through the pill's glass — lens, dispersion and all — while each inactive
tab fades away under it; and the pill's **rim light brightens while dragged** — the reference's
`Highlight(alpha = progress)` — instead of the base view's `interactive`, whose native gesture
handling fights the drag.

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

`accentColor`, `inactiveColor`, `tint`, `height` (default 64), `labelStyle` and `providerId` are
all overridable; the defaults follow the scheme (light/dark) with the iOS system palette.

### LiquidGlassButton

A 48pt glass capsule. Where the platform owns the press response natively (iOS 26+,
Android's AGSL tier) it is passed through; on the iOS Metal renderer and the Android fallback
tiers a JS spring reproduces the same grow-on-press, keyed off `onRendererChange`.

```tsx
import { LiquidGlassButton } from "expo-liquid-glass-ui";

<LiquidGlassButton onPress={submit}>Continue</LiquidGlassButton>
<LiquidGlassButton onPress={buy} tint="#0088FFCC">Buy now</LiquidGlassButton>
```

String children are wrapped in a styled `Text` (white when tinted, label color otherwise);
anything else renders as-is in a centered row.

### LiquidGlassSwitch

The 64×28 toggle: a colored capsule track under a 40×24 glass thumb. At rest the thumb wears an
opaque white fill; pressing melts the fill away and balloons the bare glass to 1.5× so the
backdrop refracts through it. Drag it across or tap to toggle; it snaps with a spring.

```tsx
import { LiquidGlassSwitch } from "expo-liquid-glass-ui";

<LiquidGlassSwitch value={enabled} onValueChange={setEnabled} />;
```

`accentColor` (on-state, defaults to system green) and `trackColor` take parseable color strings —
they feed `Animated` color interpolation.

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

- The rubber-band panel offset and velocity squish of the reference tab bar are dropped; the
  springs, scales and palette are kept.
- The inactive tab copy fades out under the pill rather than being covered by it — a wash the
  reference does not need because its pill's backdrop replaces the row outright.

## License

MIT
