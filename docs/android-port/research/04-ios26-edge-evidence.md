# 04 — Reverse-engineering the iOS 26 edge from screenshots

Working ledger for the screenshot-driven round. Every hand-picked reference image gets an ID and
a row per claim; every analyst (Claude main loop, Fable subagent, gemini-3.1-pro via agy, GPT via
cursor CLI) files independent reads before any shader change. A claim graduates to a shader delta
only on multi-analyst consensus **or** a decisive pixel measurement (crop + measured intensity /
displacement), never on one witness — F48's research already caught one confident single-witness
error (an LLM reading Kyant's shader string called its sampling outward; the Kotlin negation makes
it inward).

## Shipped state under test (as of `241bee8`)

| Parameter | Shipped | Status |
| --- | --- | --- |
| Inset shadow / signed glow wash | deleted | **confirmed correct twice** (Kyant reference, dark-bars photo E2) |
| Interior | flat (frost/saturation only) | confirmed (E1, E2: centres are undistorted) |
| Rim | additive two-lobe `pow(abs(dot(n, lobeDir)), falloff)`, equal lobes, 1.5 dp, intensity 0.25/0.35 | **open — asymmetry** (E2 shows top-dominant) |
| Border stroke | 1 dp pure white, gradient along highlight axis, no black | open — E1 may show a *dark outer hairline* on the shadow side (see OQ4) |
| Refraction | inward sampling, `pixels - amount * direction` | confirmed (E1, E2: outside content pulled into the band, violent stretch) |
| Swirl | `direction += swirl * lobeDir` (uniform lean toward light axis), default 0.25 | **open — lean vs circulation** (OQ1) |
| Scheme adaptivity | frost mixes toward black in dark mode; nothing else adapts | open — E2 suggests the rim itself adapts (OQ3) |

## Evidence

| ID | Image | What it shows |
| --- | --- | --- |
| E1 | uploads/…/2d86107d-1000081197.jpg | Apple Music **home-screen icon** glass over diagonal brown/black/blue wallpaper bands. Light-ish scheme. |
| E2 | uploads/…/146fe2ed-1000081196.jpg | Apple Music **mini-player + tab-bar pills**, dark mode, over library list. |
| E3+ | (user's labelled batch — pending) | |

## Claims filed

| # | Evidence | Claim | Analyst | Verdict |
| --- | --- | --- | --- | --- |
| C1 | E2 | Dark bottom is NOT an inset shadow; text refracts violently through the "dark" region. | gemini | **CONFIRMED** (Fable: interior flat 31–32 over 100+px, scrim transfer measured `0.32·c+31` ≈ frost `#2E2E30 @ 0.68`; drop-shadow sub-claim REFUTED — probe below the edge shows no darkening) |
| C2 | E2 | Rim hairline top-only; top:bottom ≈ 1:0 in dark scheme. | gemini | **REFUTED** (Fable luminance peaks: 82/82, 97/108, 78/82, 97/97 — bottom/top 1.00–1.11; gemini read the content ghosts) |
| C3 | E1 | Two lobes in light scheme, ratio ≈ 1:0.5. | gemini | confirmed-ish (Fable: +12…45 vs +70…93 ≈ 0.4 on the icon; E2 bars are 1.0 — asymmetry is icon-specific, bars want equal) |
| C4 | E1 | Clockwise circulation → tangential `twist·rotate90(normal)` term. | gemini | **REFUTED** (Fable per-edge solves: every edge fits `normal + depth·radial` with a hard edge profile; residuals rotate with position — the radial term's signature, no circulation) |
| C5 | E1 | Dark hairline on the shadow-side outer edge. | gemini | **REFINED** (Fable: real 1–2px dark contour on the NON-LIT FLANKS — left 9–17 vs 35–92 neighbours, right 54–64 vs 149–151 — multiplicative in character, self-hiding over black, hence invisible in E2) |
| C6 | E1 | Refraction depth is light-asymmetric. | gemini | unsupported (Fable's fits used one reach per edge ≈ 0.2–0.25·minDim; asymmetry not needed) |
| C7 | E2 | Old deleted treatment (top-lit / bottom-dark) resembles the dark bars. | user | **RESOLVED as illusion** — bright stretched title ghost in the top third + black row-gap under the bottom half; measured edges are symmetric, interior flat |
| C8 | E1+E2 | Shipped swirl lean (+0.25 toward light axis) is the worse fit on 3 of 4 testable edges; no constant-axis lean fits all four. | Fable | **CONFIRMED by measurement** → default 0 |
| C9 | E1+E2 | Lobe axis is near-vertical (E2: zero rim at side extremes, perfect top/bottom symmetry; E1: top lobe biased slightly left ⇒ axis ~15° off vertical). Shipped 135° contradicted. | Fable | **CONFIRMED** → default angle 180 (vertical axis; bars are the main use case) |
| C10 | E1 | Apple hairline ≈ 0.5–0.75 dp (2–3px on a 238px icon); shipped 1.5 dp is 2–3× too wide. Plus a separate weak wide inner sheen under lit edges (+13/255 over ~25px top, +8–10 over ~15px bottom in E2). | Fable | **CONFIRMED** → width 0.75 dp + explicit sheen term |

## Deltas applied from this round (see the commit trail)

1. `refraction.swirl` default 0.25 → **0** — reverses F48 item 4's default; the uniform stays as a
   knob. The "swirl look" is the radial fisheye (`depth 1`) + edge-hugging profile, which we ship.
2. `highlight.angle` default 135° → **180°** (vertical lobe axis; border fade lands on the side
   midpoints, matching E2's invisible side extremes).
3. `highlight.width` default 1.5 → **0.75 dp**, plus a fixed weak sheen band (~7 dp, ~0.18·intensity).
4. A **multiplicative dark flank contour** returns (the remodel's line deletion overshot):
   `color *= 1 − k·(1−rim)·lineBand`, k ≈ 0.5 — darkens only the non-lit flanks, disappears over
   black exactly as E2 shows.

## Open questions → what would settle them

- **OQ1 (swirl mechanism):** lean toward light axis (shipped) vs clockwise tangential circulation
  (C4) vs corner-sweep illusion. Settles: one image of glass over a straight-line grid /
  vertical-stripe background — on a *straight edge midpoint*, a lean shifts stripes the same
  tangential way on opposite edges; a circulation shifts them opposite ways.
- **OQ2 (lobe asymmetry):** measure hairline luminance top vs bottom in E1/E3+ crops. If ~1:0.5
  light / 1:0 dark, add an asymmetry weight on the signed lobe, possibly scheme-driven.
- **OQ3 (scheme adaptivity):** need one light-mode in-app bar photo and one dark icon-over-bright
  -wallpaper photo to separate "scheme" from "backdrop luminance".
- **OQ4 (dark outer hairline):** E1 crop at bottom-right outer silhouette: is the dark line
  *outside* the glass boundary (contact shadow — out of shader scope, document only) or *on* it
  (border needs a shadow-side dark component after all — would partially reverse the de-blacking)?
- **OQ5 (drop shadow):** Apple pills carry an outer drop shadow the glass itself refracts (C1).
  We draw none. Out of shader scope on Android (caller can wrap), but if E3+ confirms it is load-
  bearing for the dark look, consider a `shadow` prop later.
