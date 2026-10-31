// Fetches candles from Yahoo, computes MB bar counts + retrace points, writes data.json
const fs = require("fs");
const PAIRS = ("AUDCAD AUDCHF AUDJPY AUDNZD AUDUSD CADCHF CADJPY CHFJPY EURAUD EURCAD " +
  "EURCHF EURGBP EURJPY EURNZD EURUSD GBPAUD GBPCAD GBPCHF GBPJPY GBPNZD " +
  "GBPUSD NZDCAD NZDCHF NZDJPY NZDUSD USDCAD USDCHF USDJPY").split(" ");
const TF = {
  MN: { iv: "1mo", range: "5y", bucket: 0, len: (t) => { const d = new Date(t * 1000); d.setUTCMonth(d.getUTCMonth() + 1); return d / 1000; } },
  W1: { iv: "1wk", range: "2y", bucket: 0, len: (t) => t + 7 * 86400 },
  D1: { iv: "1d", range: "1y", bucket: 0, len: (t) => t + 86400 },
  H4: { iv: "60m", range: "60d", bucket: 4 * 3600, len: (t) => t + 4 * 3600 },
  H1: { iv: "60m", range: "60d", bucket: 0, len: (t) => t + 3600 },
};
const MBK = ["MN", "W1", "D1", "H4"], RTK = ["D1", "H4", "H1"];
const memo = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url) {
  if (memo.has(url)) return memo.get(url);
  const p = (async () => {
    let err;
    for (let a = 0; a < 3; a++) {
      try {
        const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.json();
      } catch (e) { err = e; await sleep(1500 * (a + 1)); }
    }
    throw err;
  })();
  memo.set(url, p);
  return p;
}

async function candles(pair, tf) {
  const { iv, range, bucket } = TF[tf];
  const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${pair}=X?interval=${iv}&range=${range}`);
  const res = j.chart.result[0], q = res.indicators.quote[0];
  let bars = [];
  res.timestamp.forEach((t, i) => { if (q.open[i] != null && q.close[i] != null) bars.push({ t, o: q.open[i], c: q.close[i] }); });
  if (bucket) {
    const m = new Map();
    for (const b of bars) {
      const k = Math.floor(b.t / bucket) * bucket;
      if (!m.has(k)) m.set(k, { t: k, o: b.o, c: b.c }); else m.get(k).c = b.c;
    }
    bars = [...m.values()];
  }
  if (bars.length && TF[tf].len(bars[bars.length - 1].t) > Date.now() / 1000) bars.pop(); // drop forming candle
  return bars;
}

// CHANGE THIS if your MB indicator counts bars differently.
function countBars(b) {
  if (!b.length) return null;
  const up = b.map((x) => x.c > x.o);
  let n = 1;
  for (let i = up.length - 2; i >= 0 && up[i] === up[up.length - 1]; i--) n++;
  return n;
}
// CHANGE THIS if your Retrace points are defined differently.
function avgRetrace(b, pair) {
  if (b.length < 3) return null;
  const pt = pair.endsWith("JPY") ? 0.001 : 0.00001;
  const L = [];
  let s = b[0].o, d = b[0].c > b[0].o, l = b[0].c;
  for (let i = 1; i < b.length; i++) {
    const x = b[i].c > b[i].o;
    if (x !== d) { L.push(Math.abs(l - s)); s = b[i].o; d = x; }
    l = b[i].c;
  }
  L.push(Math.abs(l - s));
  return Math.round(L.reduce((a, c) => a + c, 0) / L.length / pt);
}

(async () => {
  const out = {};
  PAIRS.forEach((p) => (out[p] = { p, v: [null, null, null, null], r: [null, null, null] }));
  const jobs = [];
  PAIRS.forEach((p) => Object.keys(TF).forEach((t) => jobs.push([p, t])));
  let n = 0, fail = 0;
  async function worker() {
    while (n < jobs.length) {
      const [p, t] = jobs[n++];
      try {
        const b = await candles(p, t);
        if (MBK.includes(t)) out[p].v[MBK.indexOf(t)] = countBars(b);
        if (RTK.includes(t)) out[p].r[RTK.indexOf(t)] = avgRetrace(b, p);
      } catch (e) { fail++; console.error(p, t, e.message); }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log("failed:", fail, "of", jobs.length);
  if (fail > jobs.length / 3) { console.error("Too many failures; keeping old data.json"); process.exit(1); }
  fs.writeFileSync("data.json", JSON.stringify({ updated: new Date().toISOString(), rows: PAIRS.map((p) => out[p]) }));
  console.log("data.json written");
})();
