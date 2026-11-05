// İlçe sınırları → kara maskesi (100 m) + sade ilçe çokgenleri; sonra 1 km'lik ızgarada her noktadan erişim alanı.
// Kullanım: node araclar/izgara.js
"use strict";
const fs = require("fs"), path = require("path");
const KOK = path.resolve(__dirname, "..");
const E = require(path.join(KOK, "erisim.js"));

const ILCELER = ["Adalar", "Arnavutköy", "Ataşehir", "Avcılar", "Bağcılar", "Bahçelievler", "Bakırköy", "Başakşehir", "Bayrampaşa", "Beşiktaş", "Beykoz", "Beylikdüzü", "Beyoğlu", "Büyükçekmece", "Çatalca", "Çekmeköy", "Esenler", "Esenyurt", "Eyüpsultan", "Fatih", "Gaziosmanpaşa", "Güngören", "Kadıköy", "Kağıthane", "Kartal", "Küçükçekmece", "Maltepe", "Pendik", "Sancaktepe", "Sarıyer", "Silivri", "Sultanbeyli", "Sultangazi", "Şile", "Şişli", "Tuzla", "Ümraniye", "Üsküdar", "Zeytinburnu"];

const gj = JSON.parse(fs.readFileSync(path.join(KOK, "ham/tur_adm2.geojson"), "utf8"));
const ilceler = [];
for (const f of gj.features) {
  let ad = f.properties.shapeName;
  if (ad === "Prince Islands") ad = "Adalar";
  if (!ILCELER.includes(ad)) continue;
  const g = f.geometry;
  const coklu = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  // yalnız Çatalca/Silivri gibi tek parça; bazı küçük ilçelerin bbox'u İstanbul dışına taşabilir — kontrol
  ilceler.push({ ad, coklu });
}
if (ilceler.length !== 39) throw new Error("ilçe sayısı " + ilceler.length);

// --- kara maskesi: 100 m hücreler, satır tarama ---
const LAT0 = 40.78, LAT1 = 41.62, LON0 = 27.95, LON1 = 29.97;
const DLAT = 100 / 111320, DLON = 100 / (111320 * Math.cos((41 * Math.PI) / 180));
const NX = Math.ceil((LON1 - LON0) / DLON), NY = Math.ceil((LAT1 - LAT0) / DLAT);
const bit = new Uint8Array(Math.ceil((NX * NY) / 8));
const ilceIzgara = new Uint8Array(NX * NY); // 0 = deniz/dış, 1.. = ilçe sırası
ilceler.forEach((il, ii) => {
  const kenar = [];
  for (const cokgen of il.coklu) for (const halka of cokgen) for (let k = 0; k < halka.length - 1; k++) kenar.push([halka[k], halka[k + 1]]);
  for (let y = 0; y < NY; y++) {
    const la = LAT0 + (y + 0.5) * DLAT, xs = [];
    for (const [[x1, y1], [x2, y2]] of kenar) {
      if ((y1 <= la) !== (y2 <= la)) xs.push(x1 + ((la - y1) / (y2 - y1)) * (x2 - x1));
    }
    if (!xs.length) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil((xs[k] - LON0) / DLON - 0.5)), b = Math.min(NX - 1, Math.floor((xs[k + 1] - LON0) / DLON - 0.5));
      for (let x = a; x <= b; x++) { const i = y * NX + x; bit[i >> 3] |= 1 << (i & 7); ilceIzgara[i] = ii + 1; }
    }
  }
});
const kara = { lat0: LAT0, lon0: LON0, dlat: DLAT, dlon: DLON, nx: NX, ny: NY, bit };
let karaHucre = 0; for (let i = 0; i < NX * NY; i++) if (bit[i >> 3] & (1 << (i & 7))) karaHucre++;
console.log("kara", NX, "×", NY, "hücre;", (karaHucre / 100).toFixed(0), "km² (İstanbul resmî ≈ 5.343 km²)");
const bas = Buffer.alloc(24);
bas.writeFloatLE(LAT0, 0); bas.writeFloatLE(LON0, 4); bas.writeFloatLE(DLAT, 8); bas.writeFloatLE(DLON, 12); bas.writeUInt32LE(NX, 16); bas.writeUInt32LE(NY, 20);
fs.writeFileSync(path.join(KOK, "veri/kara.bin"), Buffer.concat([bas, Buffer.from(bit)]));

// --- sade çokgenler (Douglas–Peucker) ---
function dp(n, eps) {
  if (n.length < 4) return n;
  let en = 0, ix = 0;
  const [ax, ay] = n[0], [bx, by] = n[n.length - 1];
  for (let i = 1; i < n.length - 1; i++) {
    const [px, py] = n[i];
    const d = Math.abs((by - ay) * px - (bx - ax) * py + bx * ay - by * ax) / (Math.hypot(by - ay, bx - ax) || 1e-12);
    if (d > en) { en = d; ix = i; }
  }
  if (en <= eps) return [n[0], n[n.length - 1]];
  return dp(n.slice(0, ix + 1), eps).slice(0, -1).concat(dp(n.slice(ix), eps));
}
const sade = ilceler.map((il) => ({
  ad: il.ad,
  h: il.coklu.flatMap((c) => c.slice(0, 1)).map((h) => { const o = h.length >> 1; return dp(h.slice(0, o + 1), 0.0006).concat(dp(h.slice(o), 0.0006).slice(1)); })
  .map((h) => h.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)])).filter((h) => h.length >= 4),
}));
fs.writeFileSync(path.join(KOK, "veri/ilceler.json"), JSON.stringify(sade));

// --- 1 km ızgara, 08:00 ---
const ab = (f) => { const b = fs.readFileSync(path.join(KOK, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const dur = ab("veri/duraklar.bin"), yur = ab("veri/yuruyus.bin");
const v = E.oku(dur, yur, ab("veri/pencere-0800.bin"));
const ADIM = 10; // 10 hücre = 1 km
const noktalar = [];
const t0 = Date.now();
for (let y = 5; y < NY; y += ADIM) {
  for (let x = 5; x < NX; x += ADIM) {
    const i = y * NX + x;
    if (!ilceIzgara[i]) continue;
    const la = LAT0 + (y + 0.5) * DLAT, lo = LON0 + (x + 0.5) * DLON;
    let yakin = Infinity;
    for (let s = 0; s < v.N; s++) { const m = E.mesafe(la, lo, v.kd[2 * s], v.kd[2 * s + 1]); if (m < yakin) yakin = m; }
    if (yakin > 500) continue;
    const T = E.hesapla(v, la, lo, 2700);
    const a = [900, 1800, 2700].map((b) => +E.alan(v, T, la, lo, b, kara).toFixed(1));
    noktalar.push([+la.toFixed(4), +lo.toFixed(4), ...a, ilceIzgara[i] - 1]);
  }
}
console.log(noktalar.length, "nokta,", ((Date.now() - t0) / 1000).toFixed(0), "sn");
const ilceOzet = sade.map((il, ii) => {
  const p = noktalar.filter((n) => n[5] === ii).map((n) => n[3]).sort((a, b) => a - b);
  return { ad: il.ad, nokta: p.length, ortanca30: p.length ? p[Math.floor(p.length / 2)] : null, en30: p.length ? p[p.length - 1] : null };
});
fs.writeFileSync(path.join(KOK, "veri/izgara.json"), JSON.stringify({ saat: "08:00", adim_km: 1, alanlar: ["15", "30", "45"], noktalar, ilceler: ilceOzet }));
console.log(ilceOzet.filter((x) => x.nokta >= 3).sort((a, b) => b.ortanca30 - a.ortanca30).map((x) => `${x.ad} ${x.ortanca30} (${x.nokta})`).join("\n"));
