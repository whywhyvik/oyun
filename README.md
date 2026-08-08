# İsim Şehir Online v2.7.0

Gerçek zamanlı, çok oyunculu İsim · Şehir · Hayvan · Bitki kelime oyunu. Harici npm paketi gerektirmez; Node.js 18+ ile çalışır.

## v2.7.0 — anlık senkron + telefon/PC düzeltmesi

- Hazır, Başlat, Bitti, harf seçimi, değerlendirme, yeni tur ve final state'leri SSE ile anında tüm oyunculara yayınlanır.
- Bazı VPN/proxy/hosting katmanları SSE paketini geciktirse bile 650 ms yedek state uzlaştırması devrededir; aynı `room.version` tekrar çizilmez.
- `room:sync` artık UI'yi gereksiz yeniden render etmez; cevap yazarken input/klavye bozulmaz.
- Her API cevabındaki yeni state istemcide doğrudan uygulanır. Başlat/Bitti sonrası SSE olayını ayrıca beklemeden doğru ekran açılır.
- Oyun başlatma, harf seçimi, Bitti ve değerlendirme gönderimi idempotent hale getirildi. Ağ tekrarı/çift tıklama `Oyun zaten başladı` gibi sahte hata üretmez.
- Oturum doğrulaması geçici olarak kaybolursa istemci arka planda bir kez `room:sync` ile üyeliği kurtarır ve kullanıcının işlemini otomatik tekrarlar.
- Telefon görünümünde 16 px input, güvenli alanlar, yapışkan Bitti/değerlendirme butonları, tek sütun kritik kartlar ve dokunmatik hedefler iyileştirildi.
- PC görünümünde oda/oyun alanı geniş ekranlara göre optimize edildi.
- Ek `npm run test:realtime` testi iki gerçek SSE istemcisiyle Hazır → Başlat → Bitti → review/final yayınlarını ve çift işlem güvenliğini doğrular.

Önceki v2.6 oda üyeliği, kalıcı token, oda kodu normalizasyonu, restart dayanıklılığı ve ilk Bitti sonrası 60 saniye sistemi korunur.

## Kategoriler

İsim, Şehir, Hayvan, Bitki, Eşya, Ülke, Meslek, Yemek, Marka, Ünlü.

## Oyun akışı

1. Oyuncu profilini oluşturur ve açık/özel oda kurar veya 5 karakterli oda koduyla katılır.
2. Herkes Hazır olur; oda sahibi maçı başlatır.
3. Her tur farklı oyuncu daha önce kullanılmamış bir harf seçer veya rastgele kullanılmamış harf seçtirir.
4. Herkes 10 kategoriyi doldurur. Başlangıçta süre yoktur.
5. İlk oyuncu `Bitti` dediğinde kalan oyuncular için 60 saniyelik ortak sayaç başlar.
6. Herkes bitirirse veya süre dolarsa tüm cevaplar toplu değerlendirme ekranında açılır.
7. Oyuncular geçersiz gördükleri cevapları tikler. Benzersiz geçerli cevap +10, aynı cevap +5, boş 0, oybirliğiyle geçersiz cevap -5 puandır.
8. Ara turlar otomatik ilerler; son turdan sonra final sıralaması açılır.

## Kurulum

```bash
npm start
```

Tarayıcı:

```text
http://localhost:3000
```

Başka cihazlar/VPN kullanıcıları `localhost` değil, sunucunun ulaşılabilir IP veya domain adresini kullanmalıdır. Sunucu `0.0.0.0` üzerinde dinler; uygulama içinde VPN/IP engeli yoktur.

## Discord

`config.json`:

```json
{
  "discordInviteUrl": "https://discord.gg/SENIN-KODUN"
}
```

## Test

```bash
npm run check
npm test
```

`npm test` hem smoke testini hem canlı SSE testini çalıştırır. Oda koduyla giriş, restartta oda/host koruma, token kurtarma, Bitti, ilk Bitti sonrası ortak sayaç, Hazır/Start/Bitti yayınlarının diğer istemciye anlık ulaşması ve çift tıklama/idempotent işlemler doğrulanır.

## Dağıtım notu

`data/rooms.json` tek Node.js sunucusunda restart dayanıklılığı sağlar. Birden fazla bağımsız Node instance/container aynı anda çalıştırılacaksa gerçek ortak state için Redis/veritabanı gerekir; aksi halde kullanıcıları aynı instance'a yönlendiren sticky-session kullanılmalıdır.
