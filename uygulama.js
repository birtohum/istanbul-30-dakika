"use strict";
const $ = (id) => document.getElementById(id);
const sayi = (x, b = 0) => x.toLocaleString("tr-TR", { minimumFractionDigits: b, maximumFractionDigits: b });
const HAZIR = [
  ["Kadıköy iskele", 40.9917, 29.0231, "Kadıköy iskelesinden"], ["Taksim", 41.0369, 28.985, "Taksim'den"], ["Mecidiyeköy", 41.0672, 28.9957, "Mecidiyeköy'den"],
  ["Bağcılar meydan", 41.0393, 28.8566, "Bağcılar meydanından"], ["Esenyurt meydan", 41.0343, 28.6772, "Esenyurt meydanından"], ["Pendik", 40.8765, 29.2346, "Pendik merkezden"],
  ["Sarıyer", 41.1667, 29.0573, "Sarıyer merkezden"], ["Silivri", 41.0735, 28.2466, "Silivri merkezden"],
];
const KOYU = matchMedia("(prefers-color-scheme: dark)");
const renk = (ad) => getComputedStyle(document.documentElement).getPropertyValue(ad).trim();

let harita, taban, dur, yur, kara, ilceler, izgara, pencere = "0800";
const pencereler = {};
let secim = null, isaret = null, sonT = null;

const ab = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(u + " " + r.status); return r.arrayBuffer(); };

async function pencereAl(s) {
  if (!pencereler[s]) pencereler[s] = ab(`veri/pencere-${s}.bin`).then((b) => Erisim.oku(dur, yur, b));
  return pencereler[s];
}

function tabanKur() {}

// kara kırpma yolu (ilçe çokgenleri)
function karaYolu(ctx) {
  ctx.beginPath();
  for (const il of ilceler) for (const h of il.h) {
    h.forEach(([lo, la], i) => { const p = harita.latLngToContainerPoint([la, lo]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
    ctx.closePath();
  }
}

function ciz() {
  const c = $("boya"), r = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = w * r; c.height = h * r;
  const x = c.getContext("2d");
  x.setTransform(r, 0, 0, r, 0, 0);
  x.clearRect(0, 0, w, h);
  if (!ilceler) return;
  // altlık: kara ve ilçe sınırları
  karaYolu(x); x.fillStyle = renk("--kara"); x.fill("evenodd");
  x.save(); karaYolu(x); x.clip("evenodd");
  const mPx = (la) => { // metre → piksel
    const a = harita.latLngToContainerPoint([la, 29]), b = harita.latLngToContainerPoint([la + 0.001, 29]);
    return (a.y - b.y) / 111.32;
  };
  if (secim && sonT) {
    const { la, lo, v } = secim;
    const k = mPx(41);
    for (const [butce, ad] of [[2700, "--b45"], [1800, "--b30"], [900, "--b15"]]) {
      x.fillStyle = renk(ad);
      x.beginPath();
      const daire = (a, b, rm) => { if (rm <= 0) return; const p = harita.latLngToContainerPoint([a, b]); x.moveTo(p.x + rm * k, p.y); x.arc(p.x, p.y, rm * k, 0, 2 * Math.PI); };
      daire(la, lo, Erisim.yaricap(butce));
      for (let i = 0; i < v.N; i++) if (sonT[i] < butce) daire(v.kd[2 * i], v.kd[2 * i + 1], Erisim.yaricap(butce - sonT[i]));
      x.fill("nonzero");
    }
  } else if (izgara) {
    const enb = 100, k = mPx(41) * 1000;
    const r15 = renk("--b15"), r30 = renk("--b30"), r45 = renk("--b45");
    for (const n of izgara.noktalar) {
      const f = Math.min(1, n[3] / enb);
      x.fillStyle = f > 0.66 ? r15 : f > 0.4 ? r30 : f > 0.2 ? r45 : KOYU.matches ? "#2a3035" : "#e7e5dc";
      const p = harita.latLngToContainerPoint([n[0], n[1]]);
      x.fillRect(p.x - k / 2, p.y - k / 2, k + 0.5, k + 0.5);
    }
  }
  x.restore();
  karaYolu(x); x.strokeStyle = renk("--sinir"); x.lineWidth = 0.8; x.stroke();
  if (harita.getZoom() >= 11) {
    x.fillStyle = renk("--soluk"); x.font = "500 11px Inter, system-ui, sans-serif"; x.textAlign = "center";
    for (const il of ilceler) { const h = il.h[0]; let la = 0, lo = 0; h.forEach((q) => { lo += q[0]; la += q[1]; }); const p = harita.latLngToContainerPoint([la / h.length, lo / h.length]); x.fillText(il.ad, p.x, p.y); }
  }
}

function lejantAyarla() {
  $("lejant").innerHTML = secim
    ? '<span><i class="b15"></i>15 dk</span><span><i class="b30"></i>30 dk</span><span><i class="b45"></i>45 dk</span>'
    : '<span><i class="isi"></i>30 dakikada ulaşılan alan: az → çok (08:00, 1 km kareler)</span>';
}

function ilceBul(la, lo) {
  for (const il of ilceler) {
    let ic = false;
    for (const h of il.h) for (let i = 0, j = h.length - 1; i < h.length; j = i++) {
      const [xi, yi] = h[i], [xj, yj] = h[j];
      if ((yi > la) !== (yj > la) && lo < ((xj - xi) * (la - yi)) / (yj - yi) + xi) ic = !ic;
    }
    if (ic) return il.ad;
  }
  return null;
}

async function hesapla(la, lo, ad) {
  const v = await pencereAl(pencere);
  const t0 = performance.now();
  sonT = Erisim.hesapla(v, la, lo, 2700);
  secim = { la, lo, v };
  const a = [900, 1800, 2700].map((b) => Erisim.alan(v, sonT, la, lo, b, kara));
  const ms = performance.now() - t0;
  if (isaret) isaret.setLatLng([la, lo]); else isaret = L.circleMarker([la, lo], { radius: 6, color: "#111", weight: 2, fillColor: "#fff", fillOpacity: 1 }).addTo(harita);
  const ilce = ilceBul(la, lo);
  const oz = izgara.ilceler.find((x) => x.ad === ilce);
  const durak = sonT.filter((t) => t < 1800).length;
  let cumle = `${ad || (ilce ? ilce + " ilçesindeki bu noktadan" : "Bu noktadan")} ${pencere.slice(0, 2)}:00'de yola çıkarsan 30 dakikada <b>${sayi(durak)} durağa</b> ve <b>${sayi(a[1])} km²</b> kara alanına ulaşırsın (İstanbul'un tamamı 5.343 km²).`;
  if (oz && oz.ortanca30 && pencere === "0800") cumle += ` ${ilce} ortancası ${sayi(oz.ortanca30)} km².`;
  $("sonuc").innerHTML = [["15", a[0]], ["30", a[1]], ["45", a[2]]].map(([d, k]) => `<div class="kutu"><b>${sayi(k)} km²</b><span>${d} dakikada</span></div>`).join("")
    + `<p class="cumle">${cumle}</p><p class="ipucu">Hesap tarayıcında ${sayi(ms)} ms sürdü. Başka bir yere dokun ya da saati değiştir.</p>`;
  lejantAyarla();
  ciz();
}

function siralama() {
  const l = izgara.ilceler.filter((x) => x.nokta >= 3).sort((a, b) => b.ortanca30 - a.ortanca30);
  const enb = l[0].ortanca30;
  $("siralama").innerHTML = l.map((x) => `<button class="sira" data-ad="${x.ad}"><span class="ad">${x.ad}</span><span class="cubuk" style="width:${(100 * x.ortanca30) / enb}%"></span><span class="deger">${sayi(x.ortanca30)} km²</span></button>`).join("");
  $("siralama").addEventListener("click", (e) => {
    const b = e.target.closest(".sira"); if (!b) return;
    // ilçenin en bağlantılı noktasına git
    const ii = izgara.ilceler.findIndex((x) => x.ad === b.dataset.ad);
    const n = izgara.noktalar.filter((p) => p[5] === ii).sort((p, q) => q[3] - p[3])[0];
    $("harita").scrollIntoView({ behavior: "smooth", block: "center" });
    harita.setView([n[0], n[1]], 11);
    hesapla(n[0], n[1], `${b.dataset.ad} ilçesinin en bağlantılı noktasından`);
  });
}

async function baslat() {
  harita = L.map("harita", { zoomControl: true, attributionControl: false, preferCanvas: true, minZoom: 9, maxZoom: 15 }).setView([41.02, 28.98], 10);
  tabanKur();
  KOYU.addEventListener("change", () => { tabanKur(); ciz(); });
  harita.on("move zoom resize viewreset", ciz);
  [dur, yur] = await Promise.all([ab("veri/duraklar.bin"), ab("veri/yuruyus.bin")]);
  const [k, il, iz] = await Promise.all([ab("veri/kara.bin"), fetch("veri/ilceler.json").then((r) => r.json()), fetch("veri/izgara.json").then((r) => r.json())]);
  kara = Erisim.karaOku(k); ilceler = il; izgara = iz;
  siralama(); lejantAyarla(); ciz();
  await pencereAl("0800");
  $("bekle").hidden = true;
  $("sonuc").innerHTML = '<p class="ipucu">Renkler her 1 km karede 30 dakikada ulaşılan alanı gösteriyor. Bir yere dokun ya da aşağıdan bir yer seç.</p>';
  harita.on("click", (e) => hesapla(e.latlng.lat, e.latlng.lng));
  HAZIR.forEach(([ad, la, lo, cumle]) => {
    const b = document.createElement("button"); b.textContent = ad;
    b.onclick = () => { harita.setView([la, lo], 11); hesapla(la, lo, cumle); };
    $("hazir").appendChild(b);
  });
  $("saatler").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    pencere = b.dataset.s;
    [...$("saatler").children].forEach((x) => { x.classList.toggle("secili", x === b); x.setAttribute("aria-checked", x === b); });
    if (secim) { $("bekle").hidden = false; await hesapla(secim.la, secim.lo); $("bekle").hidden = true; }
  });
}
baslat().catch((e) => { $("bekle").textContent = "Yüklenemedi: " + e.message; });
