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

**iPhone 13 calibration batch** (1170×2532 @3x, calibration wallpaper: 36px-pitch stripes,
horizontal/vertical/45° bands, every 5th stripe colour-coded, magenta separators):

| ID | Image | What it shows |
| --- | --- | --- |
| E3 | uploads/…/c370561a-1000081243.png | Wallpaper-picker gallery: clock glass digits over horizontal stripes; **Focus pill over diagonals** with cap-curl + dispersion tints. |
| E4 | uploads/…/a06fb1f2-1000081244.png | Lock screen: clock, frosted notification stack over vertical+diagonal bands, flashlight/camera circles. |
| E5 | uploads/…/bb6f8834-1000081245.png | Photos app toolbar: **CLEAR glass circles + pill directly over vertical stripes** — cleanest unfrosted refraction target. |
| E6 | uploads/…/eaf0ad39-1000081238.png | Home screen: **clear icon grid straddling all three bands**, frosted dock over diagonals, magenta line refracting through icons. |
| E7 | uploads/…/c51dae36-1000081239.png | Lock-screen customize: large slab; **bottom-right corner whirlpool** (stripes wrap the corner); **rainbow dispersion fringe** along the bottom edge. |
| E8 | uploads/…/122e423a-1000081240.png | Notification centre over home screen: stacked frost, widgets, dock. |
| E9 | uploads/…/85393023-1000081241.png | Notification centre over vertical band: Options/Clear pills, frosted-edge S-bends. |
| E10 | uploads/…/2804ccc7-1000081242.png | Widget stack: Reading List over horizontal, Sleep/Fitness over vertical, Batteries straddling a band boundary — **apparent full-interior waviness under frost** (verify: artifact or real etched-glass texture, OQ6). |

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
| C11 | E10/E8/E9 | Frosted-interior waviness is an ARTIFACT: blur σ≈18–20px + 8-bit banding at the 5-stripe colour pitch (~180px wavelength), uniform field, stripes straight outside. Flat interior stands (OQ6). | gemini | pending corroboration |
| C12 | E10/E9 | Frosted scrim transfer ≈ the known dark-mode `0.32c+31` (white stripes → ~112). | gemini | consistent with round-2 measurement |
| C13 | E9/E10 | Frosted edge band: single smooth compression, no mirror-fold/oscillation; ~15px (5 dp) deep on straight edges, ~30px at corners — much shallower than clear glass (E1: ~0.2·minDim). Frost may run a smaller lens than clear. | gemini | pending Fable size-ladder comparison |
| C14 | E9/E10/E4 | On LIGHT backdrops: bright hairline TOP-ONLY (bottom absent) + a distinct 1px dark flank contour on left/right silhouettes. Contradicts E2's measured top/bottom symmetry (dark backdrop) — either backdrop-adaptive asymmetry or another gemini hairline misread (it was wrong on E2's). | gemini | **disputed** — awaiting Fable E5/E6 rim measurements |
| C15 | E6/E4 | Displacement = local edge normal + broad radial term: opposite normal shifts on opposite edges, corner wrap 70–90° over ~42–50px radius with four-way GEOMETRIC symmetry (±3–5px, only lighting asymmetric), no tangential residual, no handed circulation on diagonals. Third independent confirmation of swirl 0. | sol | consistent with C4/C8 verdicts |
| C16 | E6 | CLEAR icon interiors not perfectly flat: broad expansion/compression + soft caustic texture across the FULL icon (clearest on the diagonal band) — a whole-surface lens/magnification component our shader lacks (interior is identity between edge bands). | sol | **new — needs Fable E5/E6 interior measurement (its question F)** |
| C17 | E6/E4 | Rim is a DOUBLE line: bright outer hairline (1–3px, strongest top/left/upper corners) with a dark inner companion (2–5px, present at top/bottom midpoints too, strongest right/lower-right). Bright is light-biased, dark is shadow-biased — not a pure lobe-complement flank model. E1's round-2 data had the same hint (dark dip 128 coexisting with the bottom bright line). | sol | pending Fable rim profiles |
| C18 | E4/E6 dock | Frosted interiors show REAL full-surface waviness (8–20px excursions, clearest in the dock and diagonal notification group). Direct collision with C11's artifact call. | sol | **disputed vs C11** — resolved by C19 |
| C19 | E10 (2.2× crops) | Tie-break: the "waviness" is a DEEP edge-refraction band on the blurred backdrop — stripes straight through widget middles, folding into U-turn wraps in the last ~100–120px of a ~470px widget. Not full-surface texture (C18 overstates reach), not an artifact (C11 wrongly dismisses the folds). Frost = blur → lens, same as our chain. Fold depth ≈ 0.22–0.25·minDim — the SAME fraction as E1's icon (0.2–0.25·238px), suggesting Apple scales refraction height with element size rather than a fixed dp (our defaults: fixed 20 dp). | Claude (crop measurement) | **CONFIRMED by C20's size ladder** |

**Fable measurement round on E5/E6/E7** (FFT pitch calibration — exactly 36.00 px, no iOS crop;
least-squares fits to the shipped profile `A·circleMap((1−d/H)^p)`, rms ≤ 1.5 px; per-channel
diagonal phase for dispersion; full scripts in the session scratchpad):

| # | Evidence | Claim | Analyst | Verdict |
| --- | --- | --- | --- | --- |
| C20 | E5+E6+E7 | **H scales with element size**: ≈ minDim/6 on 48–64 dp buttons/icons (6–9.5 dp), ≈ minDim/4.5 on the 358 px sheet (26 dp), = radius on circles — NOT fixed 20 dp. A = 27–48 dp declining with size (icon 37.5 dp; `min(48dp, 0.6·minDim)` fits all four points); p ≈ 0.7–1. | Fable (pixel solve) | **measured, decisive** |
| C21 | E5 pill, E6 icons | Near-edge \|dD/dd\| > 1 produces a visible mirror FOLD; the "dark 1–2 px line" (C5, C17-sol, E1's flank measurement) is folded dark-stripe content (achromatic 61/61/65 where the true stripe is green) — content, not drawn ink. | Fable | **measured** — C5 and C17 reinterpreted; the round-3 multiplicative contour is unsupported |
| C22 | E5+E6 midpoints | Tangential residual **0.00 px** (pill), ≤ 0.1 px (icons), all depths. | Fable | **measured** — OQ1 closed permanently, swirl 0 stands (4th confirmation) |
| C23 | E7+E6 corners | Corners isotropic: \|Δθ\| to ~88° with mean ≈ 0 (symmetric fanning), extent ≈ cornerR+H, both corners statistically identical; the "whirlpool" drama was a red diagonal passing through. Fully explained by shipped `normal + depth·radial`. | Fable | **measured** — no corner term, depth 1 stands |
| C24 | E5 circles | Circles are full-radius fisheyes (H ≈ R, A ≈ 44 dp); circle interiors NOT flat (~1.3 px bow at r=10). Rounded-rect interiors ARE flat (refutes C16-sol for rects, confirms it for circles). | Fable | **measured** |
| C25 | E7 slab top | A clipped boundary produces NO refraction band — only true SDF silhouettes refract (φ=0.0, conf 0.999). | Fable | **measured** — matches our SDF-only model |
| C26 | E7 bottom | **Dispersion is LONGITUDINAL** (along the displacement direction): R deepest, B least; R−B = 26/16/9/4/0 px at d=10/12/14/16/18; blue outermost fringe ~14 px; sides ~6× weaker; ≤1 px on small buttons. Shipped tangential tap axis (ours and Metal's) is wrong; dispersionHeight ≈ 6 dp confirmed. | Fable | **measured** → axis fix applied |
| C27 | E5+E6 rims | Rim: top+bottom lobes only, ~1 dp, additive-ish (screen-like); pill exactly 1:1, icons ~1:0.7 top-dominant; **no side rim, no dark outer hairline** anywhere on clear glass. Resolves C14 for clear surfaces (gemini's top-only wrong again); C3's icon/bar asymmetry split re-confirmed. | Fable | **measured** — angle 180 / width 0.75 dp stand |
| C28 | E6 vs E5 | Sheen is per-surface: icons +10–20 luma over 10–30 dp; toolbar pill has NONE (flat from d=4). Shipped always-on 7 dp sheen is an icon-ism applied everywhere. | Fable | **measured** — policy decision pending |
| C29 | E5/E6/E7 | "Clear" is a material FAMILY: pill ≈ 0.59c+50 sat-boosted σ2.5 blur; icons ≈ 0.55c+60 desaturating; sheet = identity (no frost/blur/dim); dock = soft weak-refraction recipe. One variant cannot represent all. | Fable | **measured** — per-surface presets are a design question |
| C30 | E6 | Uniform interior B−R crossing offset −0.6..−1.0 px (depth-independent chromatic), plus a G-excess ghost at vband icon left flanks. | Fable | anomaly logged, open |

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
