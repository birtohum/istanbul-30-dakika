"""İBB GTFS (İETT otobüs 2026 + raylı/vapur/minibüs 2024) → tarayıcı için ikili tarife dosyaları.

Çıktı (veri/):
  duraklar.bin   Float32 [lat, lon] × N
  yuruyus.bin    Uint32 başlangıç indeksleri (N+1) + Uint16 [hedef, saniye] çiftleri (≤ 300 m)
  pencere-HHMM.bin  bağlantılar: Uint16 kalkış durağı, varış durağı, kalkış sn, varış sn (D'den itibaren) + Uint32 sefer
  ozet.json      sayılar, kaynak tarihleri
Hafta içi (pazartesi) tarifesi kullanılır.
"""
import csv, io, json, math, struct, sys, zipfile
from collections import defaultdict
from pathlib import Path

KOK = Path(__file__).resolve().parent.parent
HAM = KOK / "ham"
CIKTI = KOK / "veri"
CIKTI.mkdir(exist_ok=True)

PENCERELER = [8 * 3600, 13 * 3600, 18 * 3600, 23 * 3600]  # 08:00, 13:00, 18:00, 23:00
SURE = 50 * 60  # 45 dk bütçe + pay
YURUME_HIZ = 1.2  # m/sn (≈ 4,3 km/sa)
DOLAMBAC = 1.3  # kuş uçuşu → gerçek yol
AKTARMA_YARICAP = 300  # m


def sn(t):
    if not t:
        return None
    h, m, s = t.strip().split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def iett_koord(x):
    d = x.replace(".", "").strip()
    return int(d) / 10 ** (len(d) - 2)


def mesafe(a, b):
    la1, lo1 = map(math.radians, a)
    la2, lo2 = map(math.radians, b)
    x = (lo2 - lo1) * math.cos((la1 + la2) / 2)
    return math.hypot(x, la2 - la1) * 6371000


# ---- duraklar ----
koord = {}
for r in csv.DictReader(open(HAM / "iett/stops.csv", encoding="utf-8-sig"), delimiter=";"):
    try:
        koord["i" + r["stop_id"]] = (iett_koord(r["stop_lat"]), iett_koord(r["stop_lon"]))
    except Exception:
        pass
for r in csv.DictReader(open(HAM / "raylı/stops.csv", encoding="cp1254")):
    try:
        koord["r" + r["stop_id"]] = (float(r["stop_lat"]), float(r["stop_lon"]))
    except Exception:
        pass
# İstanbul dışına düşen (hatalı) koordinatları at
koord = {k: v for k, v in koord.items() if 40.7 < v[0] < 41.6 and 27.9 < v[1] < 29.95}
print("durak", len(koord))

# ---- hafta içi servisler ----
servis_i = {r["service_id"] for r in csv.DictReader(open(HAM / "iett/calendar.csv", encoding="utf-8-sig"), delimiter=";") if r["monday"] == "1"}
servis_r = {r["service_id"] for r in csv.DictReader(open(HAM / "raylı/calendar.csv", encoding="cp1254")) if r["monday"] == "1"}

rota_tur = {}
for r in csv.DictReader(open(HAM / "raylı/routes.csv", encoding="cp1254")):
    rota_tur["r" + r["route_id"]] = (r["agency_id"], r["route_type"])

sefer_i = {}
for r in csv.DictReader(open(HAM / "iett/trips.csv", encoding="utf-8-sig"), delimiter=";"):
    if r["service_id"] in servis_i:
        sefer_i[r["trip_id"]] = "i" + r["route_id"]
sefer_r = {}
for r in csv.DictReader(open(HAM / "raylı/trips.csv", encoding="cp1254")):
    if r["service_id"] in servis_r:
        sefer_r[r["trip_id"]] = "r" + r["route_id"]
print("hafta içi sefer: iett", len(sefer_i), "raylı/diğer", len(sefer_r))

frek = defaultdict(list)
for r in csv.DictReader(open(HAM / "raylı/frequencies.csv", encoding="cp1254")):
    frek[r["trip_id"]].append((sn(r["start_time"]), sn(r["end_time"]), int(r["headway_secs"])))


def zamanlari_doldur(satirlar):
    """satirlar: [(sira, durak, varis, kalkis)] → boş saatleri mesafeye göre doğrusal doldur."""
    satirlar.sort()
    st = [s for s in satirlar if s[1] in koord]
    if len(st) < 2:
        return []
    kum = [0.0]
    for a, b in zip(st, st[1:]):
        kum.append(kum[-1] + mesafe(koord[a[1]], koord[b[1]]))
    zam = [(s[2] if s[2] is not None else s[3]) for s in st]
    bilinen = [i for i, z in enumerate(zam) if z is not None]
    if len(bilinen) < 2:
        return []
    for i in range(len(zam)):
        if zam[i] is None:
            sol = max((k for k in bilinen if k < i), default=None)
            sag = min((k for k in bilinen if k > i), default=None)
            if sol is None or sag is None:
                continue
            f = (kum[i] - kum[sol]) / ((kum[sag] - kum[sol]) or 1)
            zam[i] = round(zam[sol] + f * (zam[sag] - zam[sol]))
    return [(st[i][1], zam[i]) for i in range(len(st)) if zam[i] is not None]


seferler = []  # [(rota, [(durak, saniye)])]


def ekle(rota, durak_zaman):
    if len(durak_zaman) < 2:
        return
    a, b = durak_zaman[0][1], durak_zaman[-1][1]
    for D in PENCERELER:
        for gun in (0, 86400):
            if a - gun <= D + SURE and b - gun >= D:
                seferler.append((rota, durak_zaman))
                return


# İETT: stop_times sefer sefer gruplu geliyor
with zipfile.ZipFile(HAM / "iett/stop_times.zip") as z:
    f = io.TextIOWrapper(z.open("stop_times.txt"), encoding="utf-8-sig")
    rd = csv.reader(f)
    bas = next(rd)
    ix = {k: i for i, k in enumerate(bas)}
    simdiki, grup = None, []
    for r in rd:
        t = r[ix["trip_id"]]
        if t != simdiki:
            if simdiki in sefer_i:
                ekle(sefer_i[simdiki], zamanlari_doldur(grup))
            simdiki, grup = t, []
        if t in sefer_i:
            grup.append((int(r[ix["stop_sequence"]]), "i" + r[ix["stop_id"]], sn(r[ix["arrival_time"]]), sn(r[ix["departure_time"]])))
    if simdiki in sefer_i:
        ekle(sefer_i[simdiki], zamanlari_doldur(grup))
print("iett sefer işlendi", len(seferler))

gruplar = defaultdict(list)
for r in csv.DictReader(open(HAM / "raylı/stop_times.csv", encoding="cp1254")):
    if r["trip_id"] in sefer_r:
        gruplar[r["trip_id"]].append((int(r["stop_sequence"]), "r" + r["stop_id"], sn(r["arrival_time"]), sn(r["departure_time"])))
n0 = len(seferler)
for t, g in gruplar.items():
    dz = zamanlari_doldur(g)
    if not dz:
        continue
    if t in frek:
        bas0 = dz[0][1]
        for a, b, h in frek[t]:
            k = a
            while k < b:
                ekle(sefer_r[t], [(d, z - bas0 + k) for d, z in dz])
                k += h
    else:
        ekle(sefer_r[t], dz)
print("raylı/diğer sefer", len(seferler) - n0)

# ---- kullanılan duraklar ve indeks ----
kullanilan = sorted({d for _, dz in seferler for d, _ in dz})
idx = {d: i for i, d in enumerate(kullanilan)}
N = len(kullanilan)
assert N < 65535, N
with open(CIKTI / "duraklar.bin", "wb") as f:
    for d in kullanilan:
        f.write(struct.pack("<ff", *koord[d]))
print("kullanılan durak", N)

# ---- yürüyüş aktarmaları (ızgara) ----
izgara = defaultdict(list)
H = 0.003
for d in kullanilan:
    la, lo = koord[d]
    izgara[(int(la / H), int(lo / H))].append(d)
komsu = [[] for _ in range(N)]
for d in kullanilan:
    la, lo = koord[d]
    a, b = int(la / H), int(lo / H)
    for da in (-1, 0, 1):
        for db in (-1, 0, 1):
            for e in izgara.get((a + da, b + db), ()):
                if e == d:
                    continue
                m = mesafe(koord[d], koord[e])
                if m <= AKTARMA_YARICAP:
                    komsu[idx[d]].append((idx[e], round(m * DOLAMBAC / YURUME_HIZ)))
with open(CIKTI / "yuruyus.bin", "wb") as f:
    bas = [0]
    for k in komsu:
        bas.append(bas[-1] + len(k))
    f.write(struct.pack(f"<{N + 1}I", *bas))
    for k in komsu:
        for e, s in k:
            f.write(struct.pack("<HH", e, s))
print("yürüyüş kenarı", bas[-1])

# ---- pencereler ----
ozet = {"durak": N, "sefer": len(seferler), "pencereler": {}}
for D in PENCERELER:
    baglanti = []
    sefer_no = 0
    atilan = 0
    for rota, dz in seferler:
        kullandi = False
        for (a, ta), (b, tb) in zip(dz, dz[1:]):
            for gun in (0, 86400):  # gece yarısını aşan tarifeler (24:xx) ve ertesi gün
                t0, t1 = ta - gun, tb - gun
                if D <= t0 <= D + SURE and t1 >= t0:
                    m = mesafe(koord[a], koord[b])
                    if (t1 == t0 and m > 300) or (t1 > t0 and m / (t1 - t0) > 31):  # >110 km/sa: tarife hatası
                        atilan += 1
                        continue
                    baglanti.append((t0 - D, idx[a], idx[b], min(t1 - D, 65535), sefer_no))
                    kullandi = True
        if kullandi:
            sefer_no += 1
    baglanti.sort()
    ad = f"pencere-{D // 3600:02d}00.bin"
    with open(CIKTI / ad, "wb") as f:
        f.write(struct.pack("<I", len(baglanti)))
        for t0, a, b, t1, s in baglanti:
            f.write(struct.pack("<HHHHI", a, b, t0, t1, s))
    ozet["pencereler"][f"{D // 3600:02d}:00"] = {"dosya": ad, "baglanti": len(baglanti), "sefer": sefer_no}
    print(ad, len(baglanti), "bağlantı", sefer_no, "sefer", atilan, "hatalı hız atıldı")
    ozet.setdefault("atilan", {})[ad] = atilan

ozet["kaynak"] = {
    "iett": "İBB Açık Veri, İETT GTFS (takvim 16.03.2026–31.12.2026)",
    "rayli": "İBB Açık Veri, Toplu Ulaşım GTFS (metro, Marmaray, vapur, minibüs, dolmuş; 2024 tarifesi)",
}
ozet["yurume_hiz"] = YURUME_HIZ
ozet["dolambac"] = DOLAMBAC
json.dump(ozet, open(CIKTI / "ozet.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
