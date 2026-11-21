# Mscillus — Müzik Görselleştirici

Bilgisayarda çalan müziği gerçek zamanlı yakalayıp ritim ve frekans verisine göre görselleştiren
web uygulaması. 38 görsel mod, 4 ses kaynağı, tarayıcı içi özelleştirme paneli, otomatik mod geçişi,
yerel dosyalar için çalma listesi.

## Çalıştırma

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc + prod build (dist/)
npm run preview    # prod önizleme
npm test           # birim testleri (Vitest)
```

Chrome veya Edge önerilir (ses yakalama uyumluluğu en yüksek tarayıcılar).

## Ses Kaynakları

| Kaynak | Nasıl | Not |
|---|---|---|
| **Tarayıcı Sekmesi** | Kaynak seçin → paylaşım penceresinde sekmeyi seçin → **"Sesi de paylaş" kutusunu işaretleyin** | YouTube, Spotify Web vb. En güvenilir yöntem. |
| **Sistem Sesi** | Paylaşım penceresinde "Tüm Ekran" seçin (ses kutusu varsa işaretleyin) | Windows'ta sorunsuz. **macOS'ta** Chrome sürümüne bağlı olarak ses paylaşılmayabilir → aşağıdaki BlackHole rehberi. |
| **Yerel Dosya** | Kaynak kartına tıklayın veya dosyaları ekrana sürükleyip bırakın | MP3 / FLAC / WAV / OGG. Birden çok dosya = **çalma listesi** (ileri/geri, tekrar, karıştır, liste penceresi). Çalarken ekrana bırakılan dosyalar listeye eklenir. Klavyedeki medya tuşları ve işletim sistemi medya kontrolleri çalışır. |
| **Mikrofon** | Mikrofon kartına tıklayın, izin verin | Hoparlörden çalan müziği duyma yoluyla görselleştirir (kulaklıkla önerilir). **Giriş aygıtı** (örn. BlackHole) Ayarlar → Ses Kaynağı'ndan seçilir ve hatırlanır. |

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
| `⇧←` / `⇧→` | Önceki / sonraki parça (dosya kaynağı; ilk 3 sn'den sonra `⇧←` parçayı başa sarar) |
| `/` | Mod seçiciyi aç (arama + kategoriler; ★ ile favori ekle/çıkar) |
| `Space` | Oynat/Duraklat (dosya kaynağı) |
| `S` | Ayar panelini aç/kapat |
| `H` | Arayüzü gizle/göster |
| `F` | Tam ekran |
| `Esc` | Mod seçiciyi / paneli kapat |

Arayüz, fare veya klavye ~3,5 sn hareketsiz kalınca kendiliğinden silinir. Klavyeyle veya otomatik geçişle mod
değişince adı ekranda kısa süre görünür (arayüz gizliyken de). Görselleştirme açıkken ekran kararmaz / uyumaz
(Screen Wake Lock).

## Özelleştirme

Sağ üstteki **Ayarlar** paneli (`S`) dört sekmeden oluşur; her sekmenin altında neyi etkilediği yazar. Panel en son
açık bıraktığınız sekmeyle açılır.

- **Bu Mod:** yalnızca o an açık olan modun ayarları (bar sayısı, parlama, animasyon hızı ve moda özel seçenekler —
  örn. Spektrum Barları'nda bar aralığı, Kaleydoskop'ta segment sayısı). Değerler her mod için ayrı saklanır;
  **Bu Modu Varsayılana Döndür** yalnızca o modu sıfırlar.
- **Renkler:** tüm modlarda geçerli renk paleti; kartlardan seçilir (Neon, Gün Batımı, Okyanus, Gökkuşağı, Monokrom,
  Vaporwave, Siberpunk, Orman, Kor, Pastel) veya **Özel**: 2-6 renk + arka plan, renk seçicilerle.
- **Ses:** dinlenen kaynak, mikrofon kaynağında **giriş aygıtı**, kaynağı değiştir; *Tepki Gücü* (hassasiyet — yalnız
  görselin tepkisini değiştirir, duyulan sesi değil), *Yumuşatma*, *Frekans Ayrıntısı* (FFT).
- **Genel:**
  - *Otomatik Mod Geçişi:* açıkken belirlenen sürede (10 sn – 5 dk) bir mod değişir; isteğe bağlı olarak süre dolunca
    sıradaki vuruşu bekler (en fazla 4 sn). Varsayılan havuz **favoriler** (en az 2 favori gerekir, yoksa tüm modlar);
    "Tüm Modlar" da seçilebilir. Sıra rastgele (her mod bir kez gösterilmeden tekrar yok) veya sıralı. Geçişte kısa
    karartma olur; ayar paneli veya mod seçici açıkken geçiş bekler. Üst çubuktaki döngü düğmesi hızlı aç/kapat sağlar.
  - *Ekran:* mod adı bildirimi, FPS göstergesi.
  - *Performans:* *Çözünürlük* — Otomatik (kare hızı düşünce çizim çözünürlüğünü kademeli azaltır, rahatlayınca geri
    yükseltir; küçültme işe yaramıyorsa geri alır) / Yüksek / Dengeli (%75) / Düşük (%50). *FPS Sınırı* — Sınırsız / 60 /
    30 (pil ve ısınma için). FPS göstergesi açıksa azaltılmış çözünürlük `· %70` gibi görünür.
  - *Tüm Ayarları Sıfırla* (onay ister; favoriler ve özel palet de sıfırlanır).

Tüm ayarlar `localStorage`'a kaydedilir (`mscillus.settings.v1`). Son kullanılan mod sekme oturumu boyunca
hatırlanır (sayfa yenilenince aynı modla açılır).

## macOS'ta Sistem Sesi: BlackHole Rehberi

macOS, uygulamaların sistem sesini doğrudan dinlemesine izin vermez. Chrome'un "Tüm Ekran +
ses" paylaşımı bazı sürümlerde çalışır; çalışmazsa:

1. [BlackHole 2ch](https://existential.audio/blackhole/) indirin ve kurun.
2. **Ses Ayarları → Çıkış**: Multi-Output Device oluşturun (Dahili Hoparlör + BlackHole 2ch),
   çıktı olarak onu seçin.
3. Mscillus'ta **Mikrofon** kaynağını seçin, sonra **Ayarlar → Ses Kaynağı → Giriş Aygıtı**'ndan
   **BlackHole 2ch**'yi seçin — artık sistem sesini yakalar. Seçim hatırlanır; sistemin giriş aygıtını
   değiştirmeniz gerekmez.

Not: Multi-Output Device kullanırken sistem ses ayarlarından hafif gecikme olabilir.

## Mimari Özet

- `src/audio/` — Web Audio motoru (AnalyserNode), 4 kaynak, zaman tabanlı beat detector, çalma listesi
  (`Playlist.ts`). Dosya kaynağında analiz kolu (hassasiyet) ile hoparlör kolu (ses seviyesi) ayrıdır.
- `src/visuals/` — `Visualizer` arayüzü + registry; yeni mod eklemek için bir sınıf yazıp
  `registry.ts`'deki tabloya tek satır eklemek yeterli (her mod kendi chunk'ında tembel yüklenir)
- `src/render/RenderLoop.ts` — tek rAF döngüsü, çift canvas (2D + WebGL) yönetimi, FPS sınırı, çözünürlük ölçeği
  (`AutoScale.ts`), mod hatası / WebGL bağlam kaybı kurtarma; `AutoCycle.ts` — otomatik mod geçişi
- `src/store/settings.tsx` — ayarlar (Context + useReducer + localStorage)
- `src/ui/` — React bileşenleri (kaynak seçici, mod çipleri, ayar paneli, transport)

Detaylı plan ve durum takibi: [PLAN.md](./PLAN.md)
