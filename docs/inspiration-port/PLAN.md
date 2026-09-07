# Inspiration port — iOS below 26 and Android, 2026-09-07

**Goal.** Bring the pre-iOS-26 Metal renderer up to the Android shader tier, and add the effects
the inspiration repositories have that neither renderer had. Sources studied (all local clones):

| Repo | License | What was taken |
|---|---|---|
| Kyant0/AndroidLiquidGlass (+ 818jsy's Expo adaptation) | Apache-2.0, credited in `NOTICE` | inner shadow model, magnifier, adaptive-luminance demo, sensor-driven highlight, press glow (already ported) |
| DnV1eX/LiquidGlassKit | **none** — all rights reserved; see `docs/liquidglasskit-study.md` | ideas only: rim in perceptual space, thumb states, edge haptics, rubber-band overshoot. No code, no close translation. |

Rule for the implementer, restated from the study: it is fine to know *that* a technique exists;
it is not fine to have LiquidGlassKit open in a split pane while writing ours.

**Constraint.** This box has no Xcode. Every iOS change is written blind and reviewed twice
(a struct-layout checker in `docs/inspiration-port/tools/`, and a second-opinion pass), Android
changes are verified on the emulator and the Xiaomi. The iOS work must be built on a Mac before
release; the checklist at the bottom says what to look at.

## Phase 1 — Metal renderer parity with the AGSL tier

The Android shader outgrew the Metal renderer it was translated from. Everything measured against
real iOS 26 on Android comes home to iOS < 26:

- [x] Continuous-corner SDF (`ContinuousCorners.swift`, same (E, n) family as Android) — shader,
      content mask, border and backdrop fill all on one curve. Was circular in the SDF while the
      content clip was continuous.
- [x] Highlight remodel: the additive two-lobe rim with `highlight.width` / `highlight.falloff`
      and the 7 pt sheen; the signed wash and the contour line are gone (they were the inset shadow
      real glass does not have — research/04).
- [x] `refraction.swirl`, `dispersion.quadrant`, longitudinal dispersion taps.
- [x] Border stroke: pure white light along the highlight axis, no black tails.
- [x] `interactive` on the Metal path: `GlassPressAnimator.swift`, the port of the Android
      springs (glow, dent, lens boost, inflation, follow, stretch), driven by touches and a
      CADisplayLink that only runs while a spring is unsettled.
- [x] `glow` prop on the Metal path (`GlassGlowOptions`).
- [x] `GlassParams` mirrored in Swift and Metal with the layout checker passing.

## Phase 2 — New effects on both renderers

- [x] `metal.innerShadow` `{ radius, offsetX, offsetY, opacity }` — Kyant's `InnerShadow` as an
      SDF band: the blurred coverage of `S \ (S + offset)`, evaluated on the merged field.
- [x] `metal.magnification` — a whole-surface lens (the C16 gap in research/04): sampling
      coordinates contract toward the shape center. Clamped to `[1, 4]`; ≥ 1 samples inward so
      the padding budget is untouched.
- [x] Android: uniforms, appearance, uploader, probe priming; TS types; `lerpMetal`.

## Phase 3 — Adaptive luminance

- [x] `adaptive` prop + `onBackdropLuminance` event: the glass samples the mean luminance of the
      backdrop under it (iOS: from the capture buffer; Android: an 8×8 `HardwareRenderer` render of
      the provider content) and reports it, throttled, with hysteresis-friendly raw values.
- [x] With `adaptive` on, the frost polarity follows the backdrop instead of the color scheme.
- [x] Kit: `useAdaptiveGlass` and an `adaptive` prop on the button and tab bar that flips label
      and icon colors with an animated crossfade.

## Phase 4 — Kit refinements

- [x] Pressed pill and thumbs carry the inner shadow (`8dp × p` on the pill, `4dp × p` on the
      thumbs — Kyant's numbers).
- [x] Drop shadow under the pressed pill and the thumbs, opacity-animated (`boxShadow`).
- [x] Slider: rubber-band overshoot past the ends, `onEdgeReached` for haptics (no dependency —
      the app wires `expo-haptics`).
- [~] Switch: dropped — `onValueChange` already fires at the moment the toggle commits, so a second callback would be the same event under another name.
- [x] `useGravityHighlight` — an optional sensor hook (the app passes an accelerometer sample
      stream; `expo-sensors` is not a dependency) that steers `highlight.angle` with device tilt.

## Phase 5 — Example, docs, verification

- [x] Example: a **goodies** tab — adaptive card over a split stage with the luminance readout,
      a draggable magnifier, inner-shadow and magnification dials in the playground.
- [x] README props table and platform columns, CHANGELOG, fidelity notes.
- [x] Android verification on the emulator and the Xiaomi (screenshots + measurements; see the CHANGELOG and the Dev Log for numbers).
- [ ] iOS build on a Mac (see checklist).

## iOS build checklist (needs a Mac)

1. `cd example && npx expo run:ios` on an iOS 18 device or simulator (the Metal path).
2. Playground: a squircle-cornered card — the border hugs the refraction fold at the corners
   (no double edge); `highlight.width` 0.75 reads as a hairline; `swirl` leans the rim.
3. `interactive` on the playground card: press blooms under the finger, the card inflates ~3.5 %
   and follows a drag with rubber-band resistance; release bounces home.
4. UI kit tab: the bar lights under a dragged pill (the `glow` prop).
5. Goodies tab: inner shadow visible on the pressed pill; magnifier zooms text; the adaptive
   card's label flips as it crosses the light/dark boundary.
6. If the Metal library fails to load at all, the view degrades to `fallback-blur` and
   `onRendererChange` says so — that is the signal for a shader compile error.
