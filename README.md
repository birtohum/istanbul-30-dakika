# İstanbul'da 30 dakikada nereye gidebilirsin?

**Canlı:** https://birtohum.github.io/istanbul-30-dakika/

Haritada bir yere dokun. Otobüs, metrobüs, metro, Marmaray, vapur, minibüs ve yürüyüşle 15, 30 ve 45 dakikada ulaşılan alan boyanır. Yola çıkış saati seçilebilir: 08:00, 13:00, 18:00 ya da 23:00, hepsi hafta içi tarifesiyle.

## Nasıl çalışıyor

- `araclar/hazirla.py` İBB'nin iki GTFS veri setini okur: İETT 2026 ve Toplu Ulaşım 2024 (raylı sistem, vapur, minibüs, dolmuş). Bu veriden saat pencerelerine göre ikili tarife dosyaları üretir.
  - Saati verilmemiş geçişler, duraklar arası mesafeye göre doğrusal ara değerle doldurulur.
  - `frequencies.csv` içindeki seferler tek tek açılır.
  - 110 km/sa'ten hızlı görünen bağlantılar tarife hatası sayılıp atılır: 08:00 penceresinde 112 tane.
- `araclar/izgara.js` geoBoundaries ilçe sınırlarından 100 m'lik bir kara maskesi çıkarır. Sonra 1 km'lik ızgaradaki 1.594 noktanın her biri için 30 dakikalık erişim alanını hesaplar.
- `erisim.js` bağlantı tarama algoritmasıdır (Connection Scan). Aynı kod tarayıcıda ve Node'da çalışır; tarayıcıda bir hesap 5–20 ms sürer.
  - Yürüme hızı 1,2 m/sn, dolambaç katsayısı 1,3.
  - Başlangıçta en fazla 1 km, duraklar arası aktarmada en fazla 300 m yürünür.
  - Araç değiştirirken 60 sn pay bırakılır.

## Sonuç (08:00, ilçe ortancası, 30 dk)

Güngören 73,8 km², Bağcılar 69,7, Bayrampaşa 68,6 … Silivri 8,7, Şile 8,7, Adalar 2,7.

## Sınırlar

- **Trafik yok:** Süreler tarife süreleridir, trafik hesaba katılmaz.
- **Eski tarife:** Raylı sistem ve vapur tarifesi 2024'ten kalma. Sonradan açılan hatlar eksik.
- **Kaba alan:** Alan, kalan sürede kuş uçuşu yürüme dairesiyle hesaplanır; yol ağı kullanılmaz.

## Veri ve lisans

- İETT GTFS ve Toplu Ulaşım GTFS: İBB Açık Veri Lisansı.
- İlçe sınırları: geoBoundaries / OpenStreetMap, ODbL.
- Kod: Apache-2.0.

Ham veriyi yeniden indirmek için `ham/` klasörüne İBB'deki CSV ve ZIP dosyalarını koy, sonra `python araclar/hazirla.py && node araclar/izgara.js` çalıştır.
