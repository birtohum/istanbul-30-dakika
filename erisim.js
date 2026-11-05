"use strict";
// Bağlantı tarama algoritması (Connection Scan, Dibbelt vd. 2013). Tarayıcıda ve Node'da aynı kod.
(function (kok) {
  const YURUME = 1.2, DOLAMBAC = 1.3, ILK_YURUYUS = 1000, AKTARMA_PAYI = 60;

  function oku(duraklarBuf, yuruyusBuf, pencereBuf) {
    const kd = new Float32Array(duraklarBuf);
    const N = kd.length / 2;
    const bas = new Uint32Array(yuruyusBuf, 0, N + 1);
    const kenar = new Uint16Array(yuruyusBuf, (N + 1) * 4);
    const dv = new DataView(pencereBuf);
    const M = dv.getUint32(0, true);
    const a = new Uint16Array(M), b = new Uint16Array(M), t0 = new Uint16Array(M), t1 = new Uint16Array(M), s = new Uint32Array(M);
    let sefer = 0;
    for (let i = 0, o = 4; i < M; i++, o += 12) {
      a[i] = dv.getUint16(o, true); b[i] = dv.getUint16(o + 2, true);
      t0[i] = dv.getUint16(o + 4, true); t1[i] = dv.getUint16(o + 6, true);
      s[i] = dv.getUint32(o + 8, true); if (s[i] >= sefer) sefer = s[i] + 1;
    }
    return { N, kd, bas, kenar, M, a, b, t0, t1, s, sefer };
  }

  function mesafe(la1, lo1, la2, lo2) {
    const r = Math.PI / 180, x = (lo2 - lo1) * r * Math.cos(((la1 + la2) / 2) * r);
    return Math.hypot(x, (la2 - la1) * r) * 6371000;
  }

  // varış saniyeleri (Float64Array, ulaşılamayan = Infinity)
  function hesapla(v, lat, lon, butce) {
    const T = new Float64Array(v.N).fill(Infinity), H = new Float64Array(v.N).fill(Infinity);
    const binildi = new Uint8Array(v.sefer);
    for (let i = 0; i < v.N; i++) {
      const m = mesafe(lat, lon, v.kd[2 * i], v.kd[2 * i + 1]);
      if (m <= ILK_YURUYUS) T[i] = H[i] = (m * DOLAMBAC) / YURUME;
    }
    for (let i = 0; i < v.M; i++) {
      const dep = v.t0[i];
      if (dep > butce) break;
      const tr = v.s[i];
      if (binildi[tr] || H[v.a[i]] <= dep) {
        binildi[tr] = 1;
        const arr = v.t1[i], hedef = v.b[i];
        if (arr < T[hedef]) {
          T[hedef] = arr;
          if (arr + AKTARMA_PAYI < H[hedef]) H[hedef] = arr + AKTARMA_PAYI;
          for (let k = v.bas[hedef]; k < v.bas[hedef + 1]; k++) {
            const e = v.kenar[2 * k], w = arr + v.kenar[2 * k + 1];
            if (w < T[e]) { T[e] = w; if (w < H[e]) H[e] = w; }
          }
        }
      }
    }
    return T;
  }

  // her durak için kalan sürede yürünebilecek yarıçap (metre)
  function yaricap(kalanSn) { return Math.max(0, (kalanSn * YURUME) / DOLAMBAC); }

  // kara maskesi (veri/kara.bin): başlık 24 bayt + bit dizisi
  function karaOku(buf) {
    const dv = new DataView(buf);
    return { lat0: dv.getFloat32(0, true), lon0: dv.getFloat32(4, true), dlat: dv.getFloat32(8, true), dlon: dv.getFloat32(12, true),
      nx: dv.getUint32(16, true), ny: dv.getUint32(20, true), bit: new Uint8Array(buf, 24) };
  }

  // ulaşılan kara alanı (km²): kara maskesinin 100 m hücrelerinde say
  function alan(v, T, lat, lon, butce, kara) {
    const k = kara, dolu = new Uint8Array(k.nx * k.ny);
    let say = 0;
    const mLat = 111320, mLon = 111320 * Math.cos((41 * Math.PI) / 180);
    const isle = (la, lo, r) => {
      const ry = r / mLat / k.dlat, rx = r / mLon / k.dlon;
      const cy = (la - k.lat0) / k.dlat - 0.5, cx = (lo - k.lon0) / k.dlon - 0.5;
      const y0 = Math.max(0, Math.ceil(cy - ry)), y1 = Math.min(k.ny - 1, Math.floor(cy + ry));
      for (let y = y0; y <= y1; y++) {
        const dy = (y - cy) / ry, w = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
        const x0 = Math.max(0, Math.ceil(cx - w)), x1 = Math.min(k.nx - 1, Math.floor(cx + w));
        for (let x = x0; x <= x1; x++) {
          const i = y * k.nx + x;
          if (!dolu[i] && k.bit[i >> 3] & (1 << (i & 7))) { dolu[i] = 1; say++; }
        }
      }
    };
    isle(lat, lon, yaricap(butce));
    for (let i = 0; i < v.N; i++) if (T[i] < butce) isle(v.kd[2 * i], v.kd[2 * i + 1], yaricap(butce - T[i]));
    return say / 100;
  }

  const api = { oku, karaOku, hesapla, yaricap, alan, mesafe };
  if (typeof module !== "undefined") module.exports = api; else kok.Erisim = api;
})(this);
