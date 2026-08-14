#!/usr/bin/env node
// Calibrates the (E, n) superellipse corner family against Apple's continuous corner.
//
// Ground truth: the PaintCode reverse-engineering of iOS' continuous rounded rect
// (https://www.paintcodeapp.com/news/code-for-ios-7-rounded-rectangles, Matej Dunik / PixelCut,
// "You may use it in your projects as you wish"), as republished in
// https://gist.github.com/dagronf/cb9ea487b10151e69e2555e819b1ef3d (MIT). Three cubics + two
// hairline lines per corner, extent 1.52866483 x radius.
//
// The candidate family: a superellipse quadrant in an E x E corner cell,
//     ((E-x)/E)^n + ((E-y)/E)^n = 1
// in corner-local coordinates (x, y = distance from the rect corner along each edge). This family
// contains the circular corner exactly at (E = r, n = 2), which is what lets the shader's SDF and
// the Kotlin Path treat "circular" and "continuous" as two points of one formula.
//
// Outputs: fitted n (E pinned to the Apple extent, and a joint fit for comparison), max/mean
// deviation from the bezier ground truth, the first-order SDF's distance error at refraction-band
// depths, and the SDF gradient's angular error. Everything in units of r, with px shown for
// r = 110 px (a 40 dp radius at density 2.75).
//
// Run: node docs/android-port/research/tools/squircle-calibration.mjs

const EXTENT = 1.52866483;

// ---- ground truth: PaintCode corner, normalized to r = 1, corner at origin -------------------
// Coordinates: (along-edge distance from corner, along-perpendicular-edge distance from corner).
// The corner-to-corner FP jitter in the gist (e.g. 0.07491100 vs 0.07491176) is export noise;
// the geometrically symmetric mean is used.

const SEGMENTS = [
  { type: "cubic", p: [[1.52866483, 0], [1.08849311, 0], [0.86840695, 0], [0.66993412, 0.06549584]] },
  { type: "line", p: [[0.66993412, 0.06549584], [0.63149399, 0.07491105]] },
  {
    type: "cubic",
    p: [[0.63149399, 0.07491105], [0.37282397, 0.16905955], [0.16905955, 0.37282397], [0.07491105, 0.63149399]],
  },
  { type: "line", p: [[0.07491105, 0.63149399], [0.06549584, 0.66993412]] },
  { type: "cubic", p: [[0.06549584, 0.66993412], [0, 0.86840695], [0, 1.08849311], [0, 1.52866483]] },
];
// Note: the gist's first cubic ends at (0.66993, 0.06550) and the *line* runs to (0.63149, 0.07491),
// then the middle cubic runs to (0.07491, 0.63149); by symmetry the tail is line + cubic mirrored.
// The gist folds the tail line into its third cubic's start point; splitting it out changes nothing
// (collinear-with-tangent hairline), and makes the segment list symmetric.

function cubic(p, t) {
  const u = 1 - t;
  const c0 = u * u * u, c1 = 3 * u * u * t, c2 = 3 * u * t * t, c3 = t * t * t;
  return [
    c0 * p[0][0] + c1 * p[1][0] + c2 * p[2][0] + c3 * p[3][0],
    c0 * p[0][1] + c1 * p[1][1] + c2 * p[2][1] + c3 * p[3][1],
  ];
}

function sampleGroundTruth(perSegment = 600) {
  const pts = [];
  for (const seg of SEGMENTS) {
    for (let i = 0; i <= perSegment; i++) {
      const t = i / perSegment;
      if (seg.type === "cubic") pts.push(cubic(seg.p, t));
      else {
        const [a, b] = seg.p;
        pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
  }
  return pts;
}

// ---- candidate: superellipse quadrant --------------------------------------------------------

function sampleSuperellipse(E, n, count = 4000) {
  // Parametrize by angle; the exponent 2/n maps the circle parametrization onto the superellipse.
  const pts = [];
  for (let i = 0; i <= count; i++) {
    const th = (i / count) * (Math.PI / 2);
    const cx = Math.pow(Math.cos(th), 2 / n);
    const sy = Math.pow(Math.sin(th), 2 / n);
    pts.push([E - E * cx, E - E * sy]);
  }
  return pts;
}

// ---- distance helpers ------------------------------------------------------------------------

function segDist(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const apx = p[0] - a[0], apy = p[1] - a[1];
  const len2 = abx * abx + aby * aby;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / len2)) : 0;
  const dx = apx - t * abx, dy = apy - t * aby;
  return Math.hypot(dx, dy);
}

// Coarse-to-fine: nearest vertex on a stride-16 scan, then exact segment distances in that
// neighborhood. Valid because both curves here are smooth and convex — the distance field along
// the polyline is unimodal enough that the coarse minimum brackets the true one.
function polylineDist(p, poly) {
  const stride = 16;
  let bi = 0, bd = Infinity;
  for (let i = 0; i < poly.length; i += stride) {
    const dx = p[0] - poly[i][0], dy = p[1] - poly[i][1];
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; bi = i; }
  }
  const lo = Math.max(0, bi - 2 * stride), hi = Math.min(poly.length - 2, bi + 2 * stride);
  let best = Infinity;
  for (let i = lo; i <= hi; i++) {
    const d = segDist(p, poly[i], poly[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

function nearestOnPolyline(p, poly) {
  const stride = 16;
  let bi = 0, bd = Infinity;
  for (let i = 0; i < poly.length; i += stride) {
    const dx = p[0] - poly[i][0], dy = p[1] - poly[i][1];
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; bi = i; }
  }
  const lo = Math.max(0, bi - 2 * stride), hi = Math.min(poly.length - 2, bi + 2 * stride);
  let best = Infinity, bx = 0, by = 0;
  for (let i = lo; i <= hi; i++) {
    const a = poly[i], b = poly[i + 1];
    const abx = b[0] - a[0], aby = b[1] - a[1];
    const len2 = abx * abx + aby * aby;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2)) : 0;
    const qx = a[0] + t * abx, qy = a[1] + t * aby;
    const d = Math.hypot(p[0] - qx, p[1] - qy);
    if (d < best) { best = d; bx = qx; by = qy; }
  }
  return { d: best, x: bx, y: by };
}

// Symmetric max/mean deviation between ground truth and candidate.
function deviation(E, n, truth) {
  const cand = sampleSuperellipse(E, n);
  let max = 0, sum = 0;
  for (const p of truth) {
    const d = polylineDist(p, cand);
    if (d > max) max = d;
    sum += d;
  }
  const truthPoly = truth;
  for (let i = 0; i < cand.length; i += 8) {
    const d = polylineDist(cand[i], truthPoly);
    if (d > max) max = d;
  }
  return { max, mean: sum / truth.length };
}

// ---- the shader's SDF formula, exactly as AGSL will compute it -------------------------------
// Corner-cell coords q = (E - x, E - y): q in (0, E]^2 is the corner region, boundary at
// nnorm(q) = E. First-order Euclidean correction: sd ~ (g - E) / |grad g|.

function shaderSd(x, y, E, n) {
  const qx = E - x, qy = E - y;
  if (qx <= 0 || qy <= 0) {
    // Edge region: exact (matches the straight-edge branch of the rect SDF).
    return Math.max(qx, qy) - E;
  }
  const g = Math.pow(Math.pow(qx, n) + Math.pow(qy, n), 1 / n);
  const gx = Math.pow(qx / g, n - 1);
  const gy = Math.pow(qy / g, n - 1);
  const gradLen = Math.hypot(gx, gy);
  return (g - E) / gradLen;
}

function shaderGrad(x, y, E, n) {
  const qx = E - x, qy = E - y;
  const g = Math.pow(Math.pow(Math.max(qx, 0), n) + Math.pow(Math.max(qy, 0), n), 1 / n);
  // Outward (toward the corner) direction in corner-local coords is -d/d(x,y) of sd, i.e. along
  // (dg/dqx, dg/dqy) mapped back through q = E - x: outward = -(gx, gy) in (x, y) axes points
  // toward the corner; report the unit vector in q-space, which is what the shader uses.
  const gx = g > 0 ? Math.pow(Math.max(qx, 0) / g, n - 1) : 0;
  const gy = g > 0 ? Math.pow(Math.max(qy, 0) / g, n - 1) : 0;
  const len = Math.hypot(gx, gy) || 1;
  return [gx / len, gy / len];
}

// ---- fitting ---------------------------------------------------------------------------------

function goldenMin(f, lo, hi, iters = 80) {
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = lo, b = hi;
  let c = b - phi * (b - a), d = a + phi * (b - a);
  let fc = f(c), fd = f(d);
  for (let i = 0; i < iters; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - phi * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + phi * (b - a); fd = f(d); }
  }
  return (a + b) / 2;
}

const truth = sampleGroundTruth();

console.log("== Fit 1: E pinned to the Apple extent ==");
const nBest = goldenMin((n) => deviation(EXTENT, n, truth).max, 2.2, 6.0);
const devBest = deviation(EXTENT, nBest, truth);
console.log(`  E = ${EXTENT}, n = ${nBest.toFixed(6)}`);
console.log(`  max deviation  = ${devBest.max.toExponential(3)} r  (${(devBest.max * 110).toFixed(3)} px at r=110px)`);
console.log(`  mean deviation = ${devBest.mean.toExponential(3)} r  (${(devBest.mean * 110).toFixed(3)} px at r=110px)`);

console.log("\n== Fit 2: joint (E, n) ==");
// Cheap objective for the search: sparse truth, then a dense re-measure of the winner below.
const truthSparse = sampleGroundTruth(80);
const innerN = (E) => goldenMin((nn) => deviation(E, nn, truthSparse).max, 2.2, 6.5, 40);
const bestE = goldenMin((E) => deviation(E, innerN(E), truthSparse).max, 1.35, 1.75, 40);
const jN = goldenMin((nn) => deviation(bestE, nn, truth).max, 2.2, 6.5, 60);
const jBest = { E: bestE, n: jN, max: deviation(bestE, jN, truth).max };
console.log(`  E = ${jBest.E.toFixed(6)}, n = ${jBest.n.toFixed(6)}`);
console.log(`  max deviation  = ${jBest.max.toExponential(3)} r  (${(jBest.max * 110).toFixed(3)} px at r=110px)`);

// Apex sanity: where does each curve cross the diagonal?
function apex(E, n) { return E * (1 - Math.pow(2, -1 / n)); }
const truthApex = truth.reduce((best, p) => (Math.abs(p[0] - p[1]) < Math.abs(best[0] - best[1]) ? p : best));
console.log("\n== Apex (diagonal crossing, distance from corner along an axis) ==");
console.log(`  ground truth: ${truthApex[0].toFixed(6)} r`);
console.log(`  circle r:     ${(1 - Math.SQRT1_2).toFixed(6)} r  (a circular corner of the same nominal radius)`);
console.log(`  fit 1:        ${apex(EXTENT, nBest).toFixed(6)} r`);
console.log(`  fit 2:        ${apex(jBest.E, jBest.n).toFixed(6)} r`);

// ---- SDF accuracy through the refraction band ------------------------------------------------
// March inward along the true normal from boundary points; compare the shader formula against the
// true Euclidean distance to the curve. Depths in px at r = 110 px, i.e. depth_r = d_px / 110.

for (const fit of [{ label: "fit 1", E: EXTENT, n: nBest }, { label: "fit 2", E: jBest.E, n: jBest.n }]) {
  const cand = sampleSuperellipse(fit.E, fit.n, 8000);
  console.log(`\n== SDF first-order distance error, ${fit.label} (E=${fit.E.toFixed(4)}, n=${fit.n.toFixed(4)}) ==`);
  console.log("  depth_px |  max |sd_err|  (px)  |  max rel err  |  max grad angle err (deg)");
  for (const dPx of [1, 2, 5, 10, 20, 40, 55]) {
    const depth = dPx / 110;
    let maxErr = 0, maxRel = 0, maxAng = 0;
    for (let i = 40; i < cand.length - 40; i += 40) {
      const p = cand[i];
      // inward normal from neighboring samples (tangent rotated); inward = away from the corner
      const a = cand[i - 8], b = cand[i + 8];
      const tx = b[0] - a[0], ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1;
      let nx = -ty / tl, ny = tx / tl;
      // inward: toward increasing x+y (rect interior)
      if (nx + ny < 0) { nx = -nx; ny = -ny; }
      const px = p[0] + nx * depth, py = p[1] + ny * depth;
      if (px >= fit.E || py >= fit.E) continue; // left the corner cell: edge/interior branch, exact
      const sd = shaderSd(px, py, fit.E, fit.n);
      const trueD = nearestOnPolyline([px, py], cand).d;
      const err = Math.abs(-sd - trueD); // sd negative inside
      const rel = err / Math.max(trueD, 1e-9);
      if (err > maxErr) maxErr = err;
      if (rel > maxRel) maxRel = rel;
      const g = shaderGrad(px, py, fit.E, fit.n);
      const near = nearestOnPolyline([px, py], cand);
      // true outward direction: from the point toward its nearest boundary point
      let ox = near.x - px, oy = near.y - py;
      const ol = Math.hypot(ox, oy) || 1;
      ox /= ol; oy /= ol;
      // shader outward in (x,y) axes: -(gx, gy) maps q->xy sign flip twice; grad in q-space
      // points toward larger q = toward the corner = outward. Convert: xy-outward = -(q-grad).
      const sxo = -g[0], syo = -g[1];
      const dot = Math.max(-1, Math.min(1, sxo * ox + syo * oy));
      const ang = (Math.acos(dot) * 180) / Math.PI;
      if (ang > maxAng) maxAng = ang;
    }
    console.log(
      `  ${String(dPx).padStart(7)} |  ${(maxErr * 110).toFixed(4).padStart(18)}  |  ${(maxRel * 100).toFixed(2).padStart(10)}%  |  ${maxAng.toFixed(3).padStart(8)}`
    );
  }
}

// ---- capsule degradation blend ---------------------------------------------------------------
// E_eff = min(EXTENT * r, room); n blends linearly in E_eff/r from (1 -> 2) to (EXTENT -> n_fit).
console.log("\n== Degradation blend (n as a function of E_eff/r) ==");
function blendN(eOverR, nFit) {
  const t = Math.max(0, Math.min(1, (eOverR - 1) / (EXTENT - 1)));
  return 2 + (nFit - 2) * t;
}
for (const eor of [1.0, 1.1, 1.25, 1.4, EXTENT]) {
  const n = blendN(eor, nBest);
  console.log(`  E/r = ${eor.toFixed(3)}  ->  n = ${n.toFixed(4)}, apex = ${apex(eor, n).toFixed(4)} r  (circle apex ${(1 - Math.SQRT1_2).toFixed(4)} r)`);
}

console.log("\n== Constants to bake ==");
console.log(`  CONTINUOUS_EXTENT = 1.52866483f   // Apple's corner extent, PaintCode ground truth`);
console.log(`  CONTINUOUS_N      = ${nBest.toFixed(4)}f          // fitted exponent at that extent (fit 1)`);
