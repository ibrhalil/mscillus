# Mscillus — Müzik Görselleştirici

Bilgisayarda çalan müziği gerçek zamanlı yakalayıp ritim ve frekans verisine göre görselleştiren
web uygulaması. 5 görsel mod, 4 ses kaynağı, tarayıcı içi özelleştirme paneli.

## Çalıştırma

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc + prod build (dist/)
npm run preview    # prod önizleme
```

Chrome veya Edge önerilir (ses yakalama uyumluluğu en yüksek tarayıcılar).

## Ses Kaynakları

| Kaynak | Nasıl | Not |
|---|---|---|
| **Tarayıcı Sekmesi** | Kaynak seçin → paylaşım penceresinde sekmeyi seçin → **"Sesi de paylaş" kutusunu işaretleyin** | YouTube, Spotify Web vb. En güvenilir yöntem. |
| **Sistem Sesi** | Paylaşım penceresinde "Tüm Ekran" seçin (ses kutusu varsa işaretleyin) | Windows'ta sorunsuz. **macOS'ta** Chrome sürümüne bağlı olarak ses paylaşılmayabilir → aşağıdaki BlackHole rehberi. |
| **Yerel Dosya** | Kaynak kartına tıklayın veya dosyayı ekrana sürükleyip bırakın | MP3 / FLAC / WAV / OGG. Oynatma kontrolleri alt barda görünür. |
| **Mikrofon** | Mikrofon kartına tıklayın, izin verin | Hoparlörden çalan müziği duyma yoluyla görselleştirir (kulaklıkla önerilir). |

## Görsel Modlar

`1` Spektrum Barları · `2` Dairesel · `3` Parçacıklar · `4` Dalga Formu · `5` 3D Tünel (Three.js)

Tüm modlar bass vuruş algılamasıyla (beat detection) senkronize çalışır.

## Klavye Kısayolları

| Tuş | İşlev |
|---|---|
| `1` – `5` | Görsel modu değiştir |
| `Space` | Oynat/Duraklat (dosya kaynağı) |
| `S` | Ayar panelini aç/kapat |
| `H` | Arayüzü gizle/göster |
| `F` | Tam ekran |
| `Esc` | Paneli kapat |

## Özelleştirme

Sağ üstteki **Ayarlar** panelinden: hassasiyet, yumuşatma, FFT çözünürlüğü, renk paleti
(Neon / Gün Batımı / Okyanus / Gökkuşağı / Monokrom), bar sayısı, parçacık yoğunluğu,
rotasyon hızı, parlama ve FPS göstergesi. Tüm ayarlar `localStorage`'a kaydedilir
(`mscillus.settings.v1`).

## macOS'ta Sistem Sesi: BlackHole Rehberi

macOS, uygulamaların sistem sesini doğrudan dinlemesine izin vermez. Chrome'un "Tüm Ekran +
ses" paylaşımı bazı sürümlerde çalışır; çalışmazsa:

1. [BlackHole 2ch](https://existential.audio/blackhole/) indirin ve kurun.
2. **Ses Ayarları → Çıkış**: Multi-Output Device oluşturun (Dahili Hoparlör + BlackHole 2ch),
   çıktı olarak onu seçin.
3. **Ses Ayarları → Giriş**: Giriş olarak BlackHole 2ch seçin.
4. Mscillus'ta **Mikrofon** kaynağını seçin — artık sistem sesini yakalar.

Not: Multi-Output Device kullanırken sistem ses ayarlarından hafif gecikme olabilir.

## Mimari Özet

- `src/audio/` — Web Audio motoru (AnalyserNode), 4 kaynak, beat detector
- `src/visuals/` — `Visualizer` arayüzü + registry; yeni mod eklemek için bir sınıf yazıp
  `registry.ts`'ye kaydetmek yeterli
- `src/render/RenderLoop.ts` — tek rAF döngüsü, çift canvas (2D + WebGL) yönetimi
- `src/store/settings.tsx` — ayarlar (Context + useReducer + localStorage)
- `src/ui/` — React bileşenleri (kaynak seçici, mod çipleri, ayar paneli, transport)

Detaylı plan ve durum takibi: [PLAN.md](./PLAN.md)
