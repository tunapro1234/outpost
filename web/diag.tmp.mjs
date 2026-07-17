// headless force-layout diagnostic — GraphView.tsx fiziklerinin aynası
// usage: node diag.tmp.mjs <configName>
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceX, forceY, forceCollide } from "d3-force-3d";
import { readFileSync } from "fs";

const raw = JSON.parse(readFileSync("/tmp/claude-0/-srv-outpost/348439bb-e481-433f-9d89-6ac305b5f2c1/scratchpad/graph.json", "utf8"));
const nodes = raw.nodes.map((n) => ({ ...n }));
const links = raw.edges.map((e) => ({ source: e.source, target: e.target, kind: e.kind }));

// degree map (same as GraphView: neighbor-set size)
const nb = new Map(nodes.map((n) => [n.id, new Set()]));
for (const e of links) { nb.get(e.source)?.add(e.target); nb.get(e.target)?.add(e.source); }
const degreeById = new Map(nodes.map((n) => [n.id, nb.get(n.id)?.size ?? 0]));

// components
const compSizeById = new Map();
{
  const seen = new Set();
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    const q = [n.id]; seen.add(n.id); const mem = [];
    while (q.length) { const c = q.pop(); mem.push(c); for (const m of nb.get(c) ?? []) if (!seen.has(m)) { seen.add(m); q.push(m); } }
    for (const m of mem) compSizeById.set(m, mem.length);
  }
}

// radiusFor mirror (hubSet: threshold — PhysicsPanel'de hubThreshold var ama fizik etkisi yok, radius için kaba yaklaşım)
const minDeg = Math.min(...nodes.map((n) => n.degree));
const maxDeg = Math.max(...nodes.map((n) => n.degree));
function radiusFor(n) {
  const span = (maxDeg - minDeg) || 1;
  const t = Math.max(0, (n.degree - minDeg) / span);
  return 3.4 + Math.sqrt(t) * 6.6;
}

// deterministic hash → [0,1)
function hash01(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 8) & 0xffff) / 0x10000;
}

const configName = process.argv[2] ?? "baseline";

const CONFIGS = {
  baseline: {
    charge: (d) => -(30 + 12 * Math.sqrt(d + 1)),
    distanceMin: 1, distanceMax: Infinity,
    linkDist: (l, mind) => (mind <= 2 ? 60 : 120),
    linkStr: (mind) => Math.max(0.35, 1 / Math.sqrt(mind)),
    collideR: (n) => radiusFor(n) * 1.3 + 2, collideIter: 2, collideStr: 1,
  },
  logcharge: {
    charge: (d) => -(24 + 9 * Math.log2(d + 2)),
    distanceMin: 12, distanceMax: Infinity,
    linkDist: (l, mind) => (mind <= 2 ? 60 : 120),
    linkStr: (mind) => Math.max(0.35, 1 / Math.sqrt(mind)),
    collideR: (n) => radiusFor(n) * 1.3 + 2, collideIter: 2, collideStr: 1,
  },
  jitter: {
    charge: (d) => -(24 + 9 * Math.log2(d + 2)),
    distanceMin: 12, distanceMax: Infinity,
    linkDist: (l, mind) => {
      const j = hash01(l.source.id ?? l.source) * hash01((l.target.id ?? l.target) + "#");
      return mind <= 2 ? 30 + 70 * Math.sqrt(j) : 90 + 60 * j;
    },
    linkStr: (mind) => Math.max(0.35, 1 / Math.sqrt(mind)),
    collideR: (n) => radiusFor(n) * 1.0 + 1.5, collideIter: 1, collideStr: 0.7,
  },
  organik: {
    // sürekli derece ölçeği + jitter + zayıf collide
    charge: (d) => -(20 + 7 * Math.log2(d + 2)),
    distanceMin: 16, distanceMax: 900,
    linkDist: (l, mind) => {
      const key = (l.source.id ?? l.source) + "→" + (l.target.id ?? l.target);
      const j = hash01(key);
      const base = 34 + 16 * Math.log2(mind + 1); // sürekli: mind 1→34, 4→~71, 30→~113
      return base * (0.55 + 0.9 * j); // ±%45 jitter
    },
    linkStr: (mind) => Math.max(0.4, 1 / Math.sqrt(mind)),
    collideR: (n) => radiusFor(n) * 1.0 + 1.5, collideIter: 1, collideStr: 0.6,
  },
  organik2: {
    // charge daha da düşük, yaprak kenarı strength >1, jitter'lı collide (kafes kırıcı)
    charge: (d) => -(14 + 5 * Math.log2(d + 2)),
    distanceMin: 8, distanceMax: 700,
    linkDist: (l, mind) => {
      const key = (l.source.id ?? l.source) + "→" + (l.target.id ?? l.target);
      const j = hash01(key);
      const base = 28 + 15 * Math.log2(mind + 1);
      return base * (0.5 + 1.0 * j);
    },
    linkStr: (mind) => (mind <= 2 ? 1.2 : Math.max(0.4, 1 / Math.sqrt(mind))),
    collideR: (n) => (radiusFor(n) * 0.9 + 1) * (0.7 + 0.6 * hash01(n.id + "c")),
    collideIter: 1, collideStr: 0.5,
  },
  organik3: {
    // organik2 + biraz daha nefes (charge orta), collide jitter korunur
    charge: (d) => -(18 + 6 * Math.log2(d + 2)),
    distanceMin: 8, distanceMax: 800,
    linkDist: (l, mind) => {
      const key = (l.source.id ?? l.source) + "→" + (l.target.id ?? l.target);
      const j = hash01(key);
      const base = 30 + 16 * Math.log2(mind + 1);
      return base * (0.5 + 1.0 * j);
    },
    linkStr: (mind) => (mind <= 2 ? 1.3 : Math.max(0.4, 1 / Math.sqrt(mind))),
    collideR: (n) => (radiusFor(n) * 0.9 + 1) * (0.7 + 0.6 * hash01(n.id + "c")),
    collideIter: 1, collideStr: 0.5,
  },
  organik4: {
    // orta-hub halkasını kapatma denemesi: charge daha düşük, yaprak strength 1.5
    charge: (d) => -(12 + 4.5 * Math.log2(d + 2)),
    distanceMin: 8, distanceMax: 700,
    linkDist: (l, mind) => {
      const key = (l.source.id ?? l.source) + "→" + (l.target.id ?? l.target);
      const j = hash01(key);
      const base = 26 + 15 * Math.log2(mind + 1);
      return base * (0.45 + 1.1 * j);
    },
    linkStr: (mind) => (mind <= 2 ? 1.5 : Math.max(0.4, 1 / Math.sqrt(mind))),
    collideR: (n) => (radiusFor(n) * 0.9 + 1) * (0.7 + 0.6 * hash01(n.id + "c")),
    collideIter: 1, collideStr: 0.35,
  },
  organik5: {
    // organik4 + biraz daha yumuşak charge, yaprak strength 1.6
    charge: (d) => -(11 + 4 * Math.log2(d + 2)),
    distanceMin: 8, distanceMax: 700,
    linkDist: (l, mind) => {
      const key = (l.source.id ?? l.source) + "→" + (l.target.id ?? l.target);
      const j = hash01(key);
      const base = 26 + 15 * Math.log2(mind + 1);
      return base * (0.4 + 1.15 * j);
    },
    linkStr: (mind) => (mind <= 2 ? 1.6 : Math.max(0.4, 1 / Math.sqrt(mind))),
    collideR: (n) => (radiusFor(n) * 0.9 + 1) * (0.7 + 0.6 * hash01(n.id + "c")),
    collideIter: 1, collideStr: 0.35,
  },
};
const C = CONFIGS[configName];
if (!C) { console.error("bilinmeyen config", configName, "→", Object.keys(CONFIGS)); process.exit(1); }

const linkDegree = (e) => degreeById.get(typeof e === "string" ? e : e.id) ?? 0;
const linkMinDeg = (l) => Math.max(1, Math.min(linkDegree(l.source), linkDegree(l.target)));

const sim = forceSimulation(nodes, 2)
  .force("link", forceLink(links).id((n) => n.id)
    .distance((l) => C.linkDist(l, linkMinDeg(l)))
    .strength((l) => C.linkStr(linkMinDeg(l))))
  .force("charge", forceManyBody()
    .strength((n) => C.charge(degreeById.get(n.id) ?? 0))
    .distanceMin(C.distanceMin).distanceMax(C.distanceMax))
  .force("center", forceCenter(0, 0))
  .force("x", forceX(0).strength((n) => ((compSizeById.get(n.id) ?? 1) < 20 ? 0.16 : 0.06)))
  .force("y", forceY(0).strength((n) => ((compSizeById.get(n.id) ?? 1) < 20 ? 0.16 : 0.06)))
  .force("collide", forceCollide().radius((n) => C.collideR(n)).iterations(C.collideIter).strength(C.collideStr ?? 1))
  .alphaDecay(0.0228).velocityDecay(0.3)
  .stop();

for (let i = 0; i < 500; i++) sim.tick();

// ---- metrics ----
const byId = new Map(nodes.map((n) => [n.id, n]));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const linkLens = links.map((l) => dist(l.source, l.target));
const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));

// hub analizi: deg >= 30
const hubs = nodes.filter((n) => (degreeById.get(n.id) ?? 0) >= 30)
  .sort((a, b) => degreeById.get(b.id) - degreeById.get(a.id)).slice(0, 8);
console.log(`config=${configName}  medianLink=${q(linkLens, 0.5).toFixed(1)}  p90Link=${q(linkLens, 0.9).toFixed(1)}  spread=${spread.toFixed(0)}`);
for (const h of hubs) {
  const leaves = [...(nb.get(h.id) ?? [])].map((i) => byId.get(i)).filter((m) => (degreeById.get(m.id) ?? 0) <= 2);
  if (leaves.length < 5) continue;
  const ds = leaves.map((m) => dist(h, m));
  const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
  const cv = Math.sqrt(ds.reduce((a, b) => a + (b - mean) ** 2, 0) / ds.length) / mean; // low = halka
  // yaprak NN mesafesi CV (petek = düşük)
  const nnds = leaves.map((m) => Math.min(...leaves.filter((o) => o !== m).map((o) => dist(m, o))));
  const nnMean = nnds.reduce((a, b) => a + b, 0) / nnds.length;
  const nnCv = Math.sqrt(nnds.reduce((a, b) => a + (b - nnMean) ** 2, 0) / nnds.length) / nnMean;
  console.log(`  hub=${h.id.slice(0, 28).padEnd(28)} deg=${String(degreeById.get(h.id)).padStart(3)} leaves=${String(ds.length).padStart(3)}  gapMin=${q(ds, 0).toFixed(0).padStart(4)} p25=${q(ds, 0.25).toFixed(0).padStart(4)} med=${q(ds, 0.5).toFixed(0).padStart(4)} max=${q(ds, 1).toFixed(0).padStart(5)}  radCV=${cv.toFixed(2)}  nnCV=${nnCv.toFixed(2)}`);
}
