# Mscillus — Müzik Görselleştirici: Proje Planı ve Durum Takibi

> **BU DOSYA DEVAM EDEN MODEL/GELİŞTİRİCİ İÇİN TEK KAYNAKTIR.**
> Bir aşama bittiğinde buradaki kutucuğu işaretle, yeni karar aldıysan "Karar Defteri"ne ekle.
> Son güncelleme: v0.1.1 — hata düzeltmeleri + optimizasyon turu tamamlandı.

---

## 1. Proje Amacı

Bilgisayarda çalan müziği (tarayıcı sekmesi sesi, sistem sesi, yerel dosya, mikrofon) gerçek
zamanlı yakalayıp Web Audio API frekans/ritim verisine göre görselleştiren web uygulaması.

- Kullanıcı farklı görsel modlar arasında geçiş yapabilmeli (klavye + tıklama).
- Görseller tarayıcı içinden özelleştirilebilmeli (renk paleti, hassasiyet, bar sayısı vb.).
- Ayarlar localStorage'da kalıcı olmalı.
- Sonradan yeni görsel modlar eklemek kolay olmalı (registry + temel arayüz mimarisi).

## 2. Teknoloji Kararları (KESİNLEŞTİ — yeniden tartışma)

| Konu | Karar | Gerekçe |
|---|---|---|
| Dil | **TypeScript (strict)** | Kullanıcı TS/React bilgisi var, tip güvenliği istendi |
| UI Framework | **React 18** | UI katmanı (ayar paneli, kaynak seçici) React'te |
| Build | **Vite** (`@vitejs/plugin-react`) | Hızlı, standart |
| 2D Görsel | **Canvas 2D API** (React render döngüsü DIŞINDA, saf TS modül) | 60fps performans |
| 3D Görsel | **Three.js** | Tünel modu için |
| State | **Context + useReducer** (redux/zustand YOK) | Basit ihtiyaç |
| Bağımlılıklar | `react`, `react-dom`, `three`, `@types/three` (dev), vite/ts araçları | Başka şey EKLEME |
| Dil/UI metinleri | Türkçe | Kullanıcı talebi |

## 3. Mimari Akış

```
[Ses Kaynağı]                        [Ses Motoru]                     [Görsel]
Sekme sesi      getDisplayMedia ─┐
Sistem sesi     getDisplayMedia ─┤→ GainNode(hassasiyet) → AnalyserNode
Yerel dosya     <audio>+createMediaElementSource ┘        │
Mikrofon        getUserMedia ────┘                        ↓
                                              FFT freq (Uint8Array) + waveform
                                                          ↓
                                        BeatDetector (bass enerji analizi)
                                                          ↓
                          RenderLoop (tek rAF döngüsü, React dışı)
                                                          ↓
                          Aktif Visualizer.update(frame, settings, w, h)
                                                          ↓
                          Canvas 2D çizimi  veya  Three.js renderer.render
```

**Ses yönlendirme önemli detayı:**
- `tab` / `system`: kaynak → gain → analyser (**destination'a BAĞLANMAZ** — çift ses olurdu;
  sekme/sistem sesi zaten normal şekilde duyulur)
- `file`: elementSource → gain → analyser → **destination** (element grafiğe girdiği için
  duyulması için gereklidir)
- `mic`: kaynak → gain → analyser (**destination'a BAĞLANMAZ** — geri besleme/çınlama olurdu)

**AudioContext** kullanıcı etkileşiminde (kaynak seçim tıklaması) oluşturulur — otoplay politikası.

## 4. Hedef Dosya Yapısı

```
mscillus/
├── PLAN.md                    ← bu dosya
├── README.md                  ← kullanım kılavuzu + macOS BlackHole rehberi
├── index.html
├── package.json / tsconfig.json / vite.config.ts
└── src/
    ├── main.tsx               # React bootstrap
    ├── App.tsx                # UI kabuğu: kaynak seçimi → çalışma ekranı, klavye kısayolları
    ├── index.css              # koyu tema, glass paneller, range stilleri
    ├── audio/
    │   ├── types.ts           # AudioFrame arayüzü
    │   ├── AudioEngine.ts     # AudioContext, AnalyserNode, kaynak yönetimi, getFrame()
    │   └── beatDetector.ts    # bass enerji → beat + beatPulse (sönümlü 0..1)
    ├── visuals/
    │   ├── types.ts           # Visualizer arayüzü, VisualizerSettingsView, Palette
    │   ├── palettes.ts        # palet tanımları + hex interpolasyon yardımcıları
    │   ├── registry.ts        # MODES metadata + createVisualizer() fabrikası
    │   ├── SpectrumBars.ts    # Mod 1: log ölçekli spektrum barları + peak caps
    │   ├── Radial.ts          # Mod 2: dairesel ışınlar, bass'a nabız, yavaş rotasyon
    │   ├── Particles.ts       # Mod 3: parçacık havuzu, beat'te patlama, additive blend
    │   ├── Waveform.ts        # Mod 4: osiloskop, 3 katmanlı dalga çizgileri
    │   └── Tunnel3D.ts        # Mod 5: Three.js halka tüneli, freq ile halka pulsasyonu
    ├── render/
    │   └── RenderLoop.ts      # tek rAF; 2 canvas (2D + WebGL) görünürlük yönetimi; ResizeObserver; FPS
    ├── store/
    │   └── settings.tsx       # SettingsProvider + useSettings + localStorage persist
    └── ui/
        ├── SourcePicker.tsx   # başlangıç ekranı: 4 kaynak kartı + sürükle-bırak
        ├── ModeSwitcher.tsx   # mod çipleri (1-5)
        ├── SettingsPanel.tsx  # sağdan açılan özelleştirme paneli
        └── TransportControls.tsx # dosya modunda: play/pause, seek, süre, volume
```

## 5. Görsel Modlar (ilk sürüm 5 adet)

| # | id | Ad | Renderer | Özet |
|---|---|---|---|---|
| 1 | `bars` | Spektrum Barları | canvas2d | Log ölçekli frekans gruplama, palet gradyanı, düşen peak cap'ler |
| 2 | `radial` | Dairesel | canvas2d | Merkezden ışınlar, bass+nabız ile yarıçap nefesi, rotasyon |
| 3 | `particles` | Parçacıklar | canvas2d | Seviyeye göre sürekli + beat'te burst spawn, `lighter` blend, iz efekti |
| 4 | `wave` | Dalga Formu | canvas2d | Osiloskop, 3 katman alfa çizgi + gradient stroke |
| 5 | `tunnel` | 3D Tünel | three | Halkalardan tünel, her halka kendi frekans bandıyla pulsa, beat'te kamera sarsıntısı |

**Yeni mod ekleme prosedürü** (devam eden model için):
1. `src/visuals/` altına `implements Visualizer` sınıf yaz
2. `registry.ts` → `MODES` listesine metadata ekle + `createVisualizer` içine factory ekle
3. Bitti. UI (çipler, tuşlar) registry'den otomatik beslenir.

## 6. Ayarlar (Settings)

```ts
interface Settings {
  sensitivity: number;    // 0.2..3, GainNode üzerinden (default 1.2)
  smoothing: number;      // 0..0.95 → analyser.smoothingTimeConstant (default 0.8)
  fftSize: number;        // 512|1024|2048|4096 (default 2048)
  paletteId: string;      // neon | sunset | ocean | rainbow | mono (default neon)
  glow: boolean;          // shadowBlur efektleri (default true)
  barCount: number;       // 16..128 (default 64)
  particleCount: number;  // 50..800 (default 300)
  rotationSpeed: number;  // 0..1 (default 0.15)
  showFps: boolean;       // (default false)
}
```
- `localStorage` anahtarı: `mscillus.settings.v1`
- Ayar değişimi: React state → `useEffect` ile engine köprüsü (`setSensitivity` vb.)

## 7. Klavye Kısayolları

`1-5` mod · `Space` play/pause (dosya) · `S` ayar paneli · `H` UI gizle/göster · `F` tam ekran · `Esc` panele kapat

## 8. Aşamalar ve Durum

- [x] 0. Plan + mimari kararlaştırıldı (bu dosya)
- [x] 1. Scaffold — NOT: `npm create vite` boş olmayan klasörde interaktif sorup iptal olduğu için
  **manuel scaffold** yapıldı (package.json + tsconfig + vite.config.ts). Kurulan sürümler:
  React 19.3, TS 7.0 (native), Vite 8.3, three 0.187, @types/three. Build scripti: `tsc --noEmit && vite build`
- [x] 2. `src/audio/`: AudioEngine + 4 kaynak + beatDetector
  - startSystem(), startTab() üzerine kuruludur (aynı getDisplayMedia akışı, sadece etiket farklı)
  - togglePlay() eklendi (Space kısayolu için)
- [x] 3. `src/visuals/`: types, palettes (5 palet + log-bin yardımcıları), registry + 4 Canvas modu
- [x] 4. `src/render/RenderLoop.ts` — rAF, çift canvas görünürlüğü, ResizeObserver, DPR(≤2), FPS callback
- [x] 5. `Tunnel3D.ts` — 48 halka + merkez çekirdek; kamera beat sarsıntısı RenderLoop'ta
- [x] 6. `store/settings.tsx` + UI: SourcePicker, ModeSwitcher, SettingsPanel, TransportControls, App, index.css
  - Klavye: 1-5 mod, Space play/pause, S panel, H arayüz gizle, F tam ekran, Esc kapat
- [x] 7. README.md (kullanım + kısayollar + macOS BlackHole rehberi + mimari özet)
- [x] 8. Doğrulama: `npm run build` GEÇTİ (tsc temiz + vite build ok); `npm run dev` smoke test OK
  (localhost:5173 HTML + module 200). **Gerçek müzikle manuel test TARAYICIDA YAPILMADI.**
- [x] 9. PLAN.md durumları güncellendi

**SIRADAKİ ADIMLAR (öncelik sırasıyla):**
1. **Tekrar manuel test** — kaynak geçişleri (sekme → sistem → dosya → mikrofon → sekme) + 3D tünel
   moduna geçiş (ilk geçişte three.js chunk'ı network'ten yüklenir, kısa bir gecikme normal).
   Kaynak geçiş hatası düzeltildi (bkz. Karar Defteri), kullanıcı onayı bekleniyor.
2. ~~Three.js dynamic import~~ — TAMAMLANDI (v0.1.1): ana bundle 246kB, three ayrı chunk.
3. **Mod bazlı ayarlar** — kullanıcı "sonradan daha fazla özelleştirme yapacağız" dedi; SettingsPanel'e
   aktif moda özel ayarlar eklenebilir (Settings interface'ine `perMode` alanı eklenebilir).
4. **getDisplayMedia video track'i** — yalnızca ses gerekiyorsa video track'i durdurma denenebilir
   (Chrome'da davranış değişken, test edilmeli).
5. Yeni görsel modları (bkz. bölüm 5 prosedür).

## 9. Teknik Notlar / Riskler / Tuzaklar

1. **getDisplayMedia ses için video da ister:** `getDisplayMedia({ video: true, audio: true })`;
   kullanıcı Chrome'da "Sekme paylaş" + **"Sesi de paylaş"** kutusunu işaretlemeli. SourcePicker'da
   ipucu metni gösterilecek.
2. **macOS sistem sesi:** Chrome'da "Tüm Ekran + ses" paylaşımı sürüme bağlı çalışmayabilir.
   Garantili yol **BlackHole** sanal ses aygıtı (README'de kurulum rehberi). Windows'ta sorunsuz.
3. **MediaElementAudioSourceNode** bir `<audio>` elementi için yalnızca BİR KEZ oluşturulabilir →
   engine'de kalıcı tek `audioEl` + tek elementSource tutulur, dosya değişince sadece `src` değişir.
4. **Mikrofon constraint'leri:** `echoCancellation/noiseSuppression/autoGainControl: false`
   (müzik net yakalansın diye).
5. **Beat detection:** bass bandı (~0-250Hz) anlık enerji vs 1sn'lik kayan ortalama; eşik ~1.35x;
   min 250ms cooldown; `beatPulse` her karede sönümlenir (dt tabanlı).
6. **DPR:** canvas fiziksel boyut = clientSize × devicePixelRatio; ctx2d'e setTransform ile ölçek;
   Three.js'te `renderer.setSize(w,h,false)` + kamera aspect güncelle.
7. **StrictMode çift mount:** tüm effect'lerde cleanup düzgün olmalı (loop.stop, observer disconnect).
8. **Yeni sekme/ses reddi:** `NotAllowedError` → kullanıcı iptal etti; hata mesajıyla picker'da kal.
9. **Uint8Array/tsconfig:** analyser metotları `Uint8Array` bekler; buffer'ları fftSize değişince yeniden boyutlandır.
10. **Performans:** React her karede render ETMEZ; FPS göstergesi throttle'lu callback ile.
11. **MediaStreamTrack.stop() 'ended' FIRLATMAZ** (spec) — wireEnded güvenli; kullanıcı tarayıcıdan
    paylaşımı durdurunca 'ended' gerçekten firlar → engine.onEnded ile kaynak ekranına dönülür.
12. **Kaynak değişiminde rAF döngüsü** — handleChangeSource loop'u stop() eder; yeni kaynak seçildiğinde
    startLoop MUTLAKA mevcut loop'u start() ile yeniden başlatmalı (aşağıda düzeltildi; bu hata
    "hiçbir kaynak çalışmıyor" görüntüsüne yol açmıştı).

## 10. Karar Defteri (tarih sırasıyla, devam eden model için)

- Ses kaynağı kapsamı: HEPSİ (sekme, sistem, dosya, mikrofon) — kullanıcı seçimi
- Görsel: Canvas 2D + Three.js birlikte — kullanıcı seçimi ("ikisi birlikte")
- İlk 5 mod: barlar, dairesel, parçacık, waveform, 3D tünel — kullanıcı 4'ünü seçti, 5.si (3D) stack kararından doğdu
- Stack: Vite + React + TS (kullanıcı "fark etmez, React bilgim var" dedi) — React ile devam kararı alındı
- Sonradan genişletilebilirlik şart: kullanıcı "daha fazla seçenek ve özelleştirme yapacağız" dedi
  → registry mimarisi + mod bazlı ayarlar ileride SettingsPanel'e eklenebilir
- Manuel scaffold: create-vite boş olmayan dizinde (PLAN.md mevcut) interaktif iptal etti →
  package.json/tsconfig/vite.config.ts elle yazıldı, bağımlılıklar npm ile kuruldu
- "Kod içi yorum yazma" kuralı: yorum yok (kullanıcı talimatı), self-documenting isimler kullanıldı
- **Kullanıcı ilk test raporu:** sekme sesi (YouTube) ÇALIŞTI; farklı kaynak denedikten sonra hiçbir
  kaynak çalışmamaya başladı. Kök neden: handleChangeSource render döngüsünü stop() ediyordu ama
  startLoop'taki `if (loopRef.current) return` yüzünden yeni kaynakta döngü yeniden başlatılmıyordu
  → ekran donuyor, her şey ölmüş görünüyordu. **Düzeltildi:** startLoop artık mevcut loop'u
  start() ile yeniden başlatıyor.
- Aynı testten çıkan iyileştirmeler: (1) getDisplayMedia sonucunda ses track'i yoksa artık
  açıklayıcı hata atılıyor (macOS "tüm ekran" sessizliği sessizce yutulmuyordu);
  (2) engine.onEnded eklendi — kullanıcı tarayıcı çubuğundan paylaşımı durdurursa otomatik
  kaynak seçim ekranına dönülüyor; (3) mic stream için de wireEnded kuruldu.
- Build uyarısı: chunk 772kB (three.js inline) — dynamic import ile lazy load edilmeli (bkz. sıradaki adımlar)
- **Refactor & optimizasyon turu (v0.1.1):**
  (1) three.js lazy load — RenderLoop'ta `createThree()` + registry'de `await import('./Tunnel3D')`;
      `setMode` async oldu, `modeToken` ile hızlı mod geçişi yarışlarına karşı koruma;
      ana bundle 773kB → 246kB (gzip 78kB), three ayrı chunk (sadece tünel modunda yüklenir).
      App.tsx'te setMode çağrıları `void`/`.then` ile ateşle-unut.
  (2) Ayar sanitizasyonu — store'da `sanitize()`: localStorage'dan bozuk/eski veri gelirse tüm alanlar
      clamp/doğrulanır (fftSize izinli listede mi, paletteId geçerli mi, sayısal alanlar aralıkta mı);
      reducer da çıktıyı sanitize eder.
  (3) AudioEngine dedupe — `captureDisplay(hint)` + `attachStream(stream, source)` çıkarıldı;
      sistem sesi hatasına artık KAYNAĞA ÖZEL mesaj (önceden "sekme" mesajı gösteriliyordu).
  (4) TransportControls — 250ms setInterval yerine HTMLMediaElement event'leri
      (timeupdate/play/pause/ended/volumechange/loadedmetadata).
  (5) Particles — drag katsayısı (`Math.pow(0.985, dt*60)`) parçacık başına değil kare başına hesaplanıyor.
  (6) Tunnel3D.dispose — scene.fog ve scene.background temizleniyor (mod geçişi sızıntısı).
  (7) SourcePicker — dragEnter derinlik sayacı ile iç elementlerde titreme düzeltildi.
  (8) Guard'lar: SpectrumBars `n>1` (NaN palet çökmesi), Radial `half>=1`.
  (9) Kullanılmayan `RenderLoop.modeId` getter'ı kaldırıldı; AbortError mesajı netleştirildi.

## 11. Doğrulama Komutları

```bash
npm run dev        # geliştirme sunucusu (tarayıcıda manuel test: müzik aç → sekme paylaş + ses)
npm run build      # tsc -b && vite build — MUTLAKA geçmeli
npm run preview    # prod önizleme
```

Manuel test senaryosu: kaynak seç (Sekme) → YouTube/Spotify çal → modlar arasında 1-5 geç →
ayarları değiştir → sayfayı yenile (ayarlar korunmalı) → kaynak değiştir.
