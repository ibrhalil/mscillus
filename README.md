# Mscillus — Müzik Görselleştirici

Bilgisayarda çalan müziği gerçek zamanlı yakalayıp ritim ve frekans verisine göre görselleştiren
web uygulaması. 38 görsel mod, 4 ses kaynağı, tarayıcı içi özelleştirme paneli.

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

38 mod, 6 kategoride. Mod çubuğundaki adın üstüne tıklayın veya `/` ile mod seçiciyi açın (arama + favoriler); `⇧` = Shift ile basın.

**Favori kısayolları:** her modun kendi harf tuşu vardır. Favoriye eklediğiniz modlar ayrıca eklenme sırasıyla `1`–`9` ve `0` tuşlarına atanır (ilk 10 favori; favoriden çıkarınca sıradakiler kayar). Rakam, mod çubuğunda ve seçicide harfin yanında görünür.

- **Spektrum & Dalga:** `⇧S` Spektrum Barları · `D` Dairesel · `V` Dalga Formu · `⇧A` Spektrogram · `⇧V` VU Göstergeleri · `⇧W` Nota Rulosu
- **Psikedelik:** `A` Ambience · `M` MilkDrop (Hayal Bulutu) · `G` G-Force · `Z` Kum Levhası · `K` Kaleydoskop · `P` Plazma · `⇧R` Rotozoom · `⇧D` Hipnoz · `⇧K` Op-Art Halkalar · `⇧B` Metaball · `⇧F` Fosfen · `⇧J` Kağıt Yırtma · `⇧T` Boya Damlası
- **Uzay & 3D:** `T` 3D Tünel · `O` Plenoptic (XP) · `I` Işık Hızı · `W` Solucan Deliği · `Y` Galaksi · `N` Uzay Yolculuğu
- **Doğa:** `E` Ateş · `U` Su Dalgası · `Q` Baloncuklar · `R` Kar · `⇧Y` Yağmur · `⇧L` Şimşek
- **Işık & Parçacık:** `⇧P` Parçacıklar · `L` Şeritler · `B` Lazer · `C` Havai Fişek
- **Retro & Sahne:** `X` Matris · `⇧U` Parazit · `⇧X` Audio Pong

**MilkDrop** bir "hayal bulutu" gibi çalışır: feedback shader her kareyi yavaşça akıtır, bulutlar süzülür, bass ile nefes alır. Eski AVS Halka/Noktalar/Dalgalar artık **Dairesel** modunun stil ve seçenekleridir; CRT → **Dalga Formu** (CRT Efekti), Gece Şehri/Silüet → **Spektrum Barları** (Şehir stili), Spirograf → **Şeritler** (Spiro eğrisi), Magma/Köpük → **Parçacıklar** (Fıskiye), Blob/Lav → **Metaball** (Lav hareketi, Yumuşak ışık), Girdap → **Hipnoz** (yalnız hipnoz spirali kaldı), Küp Alanı → **Plenoptic** (Küp şekli), 3D Yörünge silindi, Kuantum Dalışı → **Solucan Deliği**. Fraktal, Chladni figürleri yapan **Kum Levhası** ile değiştirildi.

Tüm modlar bass vuruş algılamasıyla (beat detection) senkronize çalışır.

## Klavye Kısayolları

| Tuş | İşlev |
|---|---|
| Harfler ve `⇧Shift+harf` (mod seçicide gösterilir) | Görsel modu değiştir (her modun kendi harfi var) |
| `1`–`9`, `0` | Favori modlar (eklenme sırasıyla ilk 10 favori) |
| `←` / `→` | Önceki / sonraki mod |
| `/` | Mod seçiciyi aç (arama + kategoriler; ★ ile favori ekle/çıkar) |
| `Space` | Oynat/Duraklat (dosya kaynağı) |
| `S` | Ayar panelini aç/kapat |
| `H` | Arayüzü gizle/göster |
| `F` | Tam ekran |
| `Esc` | Mod seçiciyi / paneli kapat |

Arayüz, fare veya klavye ~3,5 sn hareketsiz kalınca kendiliğinden silinir.

## Özelleştirme

Sağ üstteki **Ayarlar** paneli iki bölümden oluşur:

- **Genel:** hassasiyet, yumuşatma, FFT çözünürlüğü, renk paleti
  (Neon / Gün Batımı / Okyanus / Gökkuşağı / Monokrom) ve FPS göstergesi.
- **Mod ayarları:** yalnızca etkin modun gerçekten kullandığı seçenekler görünür (bar sayısı,
  parçacık yoğunluğu, rotasyon hızı, parlama, animasyon hızı ve moda özel olanlar — örn. Spektrum
  Barları'nda bar aralığı/tepe çubukları, Kaleydoskop'ta segment sayısı, Ateş'te alev yüksekliği).
  Değerler her mod için ayrı saklanır; **Bu Modu Sıfırla** yalnızca etkin modu varsayılana döndürür.

Tüm ayarlar `localStorage`'a kaydedilir (`mscillus.settings.v1`).

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
  `registry.ts`'deki tabloya tek satır eklemek yeterli (her mod kendi chunk'ında tembel yüklenir)
- `src/render/RenderLoop.ts` — tek rAF döngüsü, çift canvas (2D + WebGL) yönetimi
- `src/store/settings.tsx` — ayarlar (Context + useReducer + localStorage)
- `src/ui/` — React bileşenleri (kaynak seçici, mod çipleri, ayar paneli, transport)

Detaylı plan ve durum takibi: [PLAN.md](./PLAN.md)
