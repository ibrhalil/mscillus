# Mscillus — Müzik Görselleştirici: Proje Planı ve Durum Takibi

> **BU DOSYA DEVAM EDEN MODEL/GELİŞTİRİCİ İÇİN TEK KAYNAKTIR.**
> Bir aşama bittiğinde buradaki kutucuğu işaretle, yeni karar aldıysan "Karar Defteri"ne ekle.
> Son güncelleme: **v0.3.0** — mod modernizasyonu tamamlandı (38 mod; GPU'ya taşınan/yeniden yazılan modlar, ortak `onset.ts`, favori rakam kısayolları 1-9/0, her modun kendi harf tuşu; Güneş Sistemi/Neon/Twister silindi). Önceki: v0.2.4 — Solucan Deliği (W) köşe/çökme hataları düzeltildi: kapalı periyodik "salınan halka" yolu (keskin köşe imkânsız), parallel-transport up + viraja yatma (banking). Fosfen (⇧F) v0.3'te geometrik desen olarak yeniden yazıldı.

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

## 5. Görsel Modlar (v0.3: 38 adet; 14 mod başka modlara birleştirilip silindi — bkz. Karar Defteri sonu)

| # | id | Ad | Renderer | Özet |
|---|---|---|---|---|
| ⇧S | `bars` | Spektrum Barları | canvas2d | (v0.3) Log ölçekli frekans gruplama; hızlı yükselme + yerçekimli düşüş, bekleyen/düşen tepe çubukları, taban yansıması. Seçenekler: style (Dolu/LED/İnce Çizgi), align (Alttan/Ortadan), colorMode (frekans/yükseklik/akan palet/tek renk), mirror, gap, radius, ledCount, height, fall, alpha, glowPower, peaks, reflection, baseline |
| D | `radial` | Dairesel | canvas2d | (v0.3) Merkezden ışınlar; hızlı yükselme+doğrusal düşüş yumuşatma, `binAtLerp`, renk daire boyunca dikişsiz (ping-pong). Stil: Işın/Çubuk/Dalga (Dalga = kapalı quadratic eğri + `createConicGradient`). Seçenekler: style, extend (dışa/içe/iki yönlü; Dalga'da iki yönlü = dışa), colorMode, mirror, reverse, radius, length, thickness, pulse, fall, trail (fadeFrame alfa), fill, ring, dot |
| ⇧P | `particles` | Parçacıklar | canvas2d | (v0.3) Seviyeye göre sürekli + beat'te burst spawn, `lighter` blend, iz. Palet LUT (64) — parçacık başına `sampleGradient` yok. Kaynak: Merkez/Halka/Alt/Spektrum (Spektrum: bant enerjisi olasılığıyla fışkırır, renk=frekans); şekil Nokta/Çizgi; renk rastgele/hız/ömür/tek. Seçenekler: emitter, shape, colorMode, power, size, life, burst, gravity, swirl, trail, bounce. Eski `init` `#000` dolgusu RenderLoop'un bg dolgusunu eziyordu, kaldırıldı |
| V | `wave` | Dalga Formu | canvas2d | (v0.3) Osiloskop: yükselen sıfır-geçiş tetiklemesi (sabit dalga) + zaman penceresi (varsayılan tamponun %50'si), yeniden örnekleme (≤ w/3 nokta), quadratic yumuşatma. Stil: Çizgi/Dolgu/Çubuk; renk yatay/dikey/tek. Seçenekler: style, colorMode, layers, trigger, window, smooth, amp, thickness, persist (fosfor izi = fadeFrame), mirror, centerLine, grid |
| T | `tunnel` | 3D Tünel | three | Halkalardan tünel, her halka kendi frekans bandıyla pulsa, beat'te kamera sarsıntısı |
| O | `plenoptic` | Plenoptic (XP) | three | WMP: InstancedMesh 140 küre, additive blend, kameraya doğru süzülme |
| A | `ambience` | Ambience | canvas2d | WMP hipnotik mod: 5 katman aurora perdesi, morphlanan renk dalgaları |
| M | `milkdrop` | MilkDrop (Hayal Bulutu) | three (manualRender) | Feedback shader "hayal bulutu" ayarında: çok yavaş nefes alan zoom (0.004+bass*0.018), düşük frekanslı bulut kabarması (warp), yukarı süzülme drift'i, uzun iz decay (0.955), yumuşak düşük frekanslı boya (angular stripe YOK), çok yavaş hue-rotate |
| A | `avsring` | AVS Halka | canvas2d | Superscope: konik-gradyan halka üzerinde dalga formu + iç kılavuz halka + merkez nokta |
| D | `avsdots` | AVS Noktalar | canvas2d | Frekans noktaları: 96 simetrik dış nokta halkası (binAt) + 48 iç dalga noktası (karşıt dönüş) + beat flash halkası |
| R | `avsripple` | AVS Dalgalar | canvas2d | Beat ripple'ları: vuruşta doğan, seviyeyle hızlanan genişleyen halkalar (tiz yüksekse çift) + bass nefes halkası + merkez pulsu |
| G | `gforce` | G-Force | canvas2d | Swirl flow field + GÜÇLÜ müzik etkileşimi: alan zamanı mid/bass ile morphlanır, hız level+beat ile, partikül parlaklığı KENDİ bandına (bass/mid/tiz, renk konumuna göre) bağlı, boyut bass ile |
| I | `starfield` | Işık Hızı | canvas2d | Klasik 3D yıldız alanı: x,y ±9 / z 0.08-10 düzleminde gerçek perspektif bölmesi (x/z·scale), yıldızlar uzakta doğar kenara doğru hızlanır; hız 1.6+level·7+beat·14, vuruşta uzun warp çizgileri, merkez beat parlaması |
| Z | `fractal` | Fraktal | three (manualRender, QuadShader) | Tam ekran morphlanan Julia: k=0.7885·e^{iθ} döner (bass yarıçap, beat ofset modüle eder), zoom YOK (eski zoom düz renk bölgesine dalıyordu — "ne olduğu anlaşılmıyor" şikayetinin nedeni), smooth (escape-time sürekli) renklendirme, tiz → iterasyon sayısı |
| O | `blob` | Organik Blob | canvas2d | 8 yumuşak blob: 'screen' blend (eski 'lighter'+zayıf fade beyaz doygunluğuna yol açıyordu — düzeltildi), fade 0.38, düşük gradyan alfaları, band bazlı yarıçap, wobble yörünge |
| W | `wormhole` | Solucan Deliği | three (manualRender, kendi sahnesi+kamerası) | **v0.2.4 — GERÇEK 3D uçuş, akışkan kıvrımlar:** yol = kapalı periyodik "salınan halka" (büyük çember R=72 + düşük tam-sayı frekanslı sinüs ofsetler → eğrilik her zaman yumuşak, kendine kesişme/köşe YOK; her açılışta faz/frekans rastgele) → TubeGeometry 700×26 BackSide. Kamera: path üzerinde, teğet ileri bakış (lookAt pos+fwd·10), UP = parallel transport (up her karede fwd'ye ortogonalize → dik segmentlerde ASLA çökmez), viraja yatma bank=yaw·12 (clamp ±0.7, lerp) + yavaş sway (±0.55 rad sinüsler) + beat kick (sönümlü). Beat: ileride doğan ışık halkası → içinden geçilir; FOV 70+beat·6; duvar: periyodik akış deseni + 8 sektör band + vertex undulation (0.35+bass·0.6), fog exp(-ahead·0.018). Hız 10+level·16+beat·10 |
| K | `kaleidoscope` | Kaleydoskop | canvas2d | Offscreen kaynak tuval (fade'li additive noktalar, band bazlı yarıçap/parlaklık) → ana tuvale 8 dilim, dönüşümlü aynalı (scale(1,-1)) kopya; rotationSpeed ile döner mandala |
| P | `plasma` | Plazma | canvas2d | Klasik demoscene plazma: düşük çözünürlük ImageData (w/8), 4 sinüs bileşimi + önceden hesaplanmış radial dist, palet LUT (256), smooth upscale; zaman hızı level+beat ile, parlaklık bass ile |
| L | `ribbons` | Şeritler | canvas2d | WhiteCap tarzı akan şeritler: 6 şerit, Lissajous/Spiro baş hareketi (yol ritimle DEĞİŞMEZ), her kuyruk noktası doğduğu anki kalınlık/parlaklığı taşır (vuruş kuyruk boyunca akan şişkinlik), her şerit kendi frekans diliminden beslenir, sabit adımlı (60 Hz) örnekleme, parıltı = geniş sönük 2. geçiş. Eski hâli scratchpad `Ribbons_old.ts` |
| Y | `galaxy` | Galaksi | webgl (manualRender, özel Points shader) | **GPU yıldız alanı** (eski: 1800 kare nokta): ≤24k yuvarlak yumuşak sprite, sarmal kollar + kalın merkez (bulge) + %4 büyük parlak yıldız. Yarıçap→frekans (merkez bas, dış tiz, yumuşatılmış 64×1 doku). Vuruşta merkezden dışa yayılan parlaklık dalgası (3 dalga, şiddet EventScale). Dönüş yavaş filtreli seviyeyle. Seçenekler: arms, density, size, tilt, react. Eski hâli scratchpad `Galaxy_old.ts` |
| V | `spirograph` | Spirograf | canvas2d | Lissajous/harmonograf: 3 katman (3:2, 5:4, 7:3 frekans), yavaş morph (frekans oranı sin ile), ÇOK uzun iz (fade 0.07) → girintili spirograf ağı, beat parlama |
| E | `fire` | Ateş | canvas2d | Klasik fire demosu: heat buffer (w/4), alt satır frekansla beslenir (simetrik), yukarı doğru 0.965 sönümlü yayılım + rastgele soğuma, palet LUT (karanlık→parlak eğri), upscale |
| X | `matrix` | Matris | canvas2d | Matrix dijital yağmur: kolon başlı satır satır düşer (prevY→y arası glif), katakana/ascii/digit karışımı, kolon bandına (i%8) göre parlaklık, hız level+beat ile, head glifi lighten+glow |
| B | `laser` | Lazer | canvas2d | 4 lazer kaynağı × `beams` ışın; sinüs tarama (±0.95 rad) ve yelpaze açıklığı ritimle DEĞİŞMEZ. Her kaynak spektrumun kendi diliminden beslenir (bas→tiz); dilim başına onset'te ışın boyunca kaynaktan uca koşan ışık atımı (gradient stroke) + kaynak tabanı çakar. Hız yavaş süzülmüş seviyeyle. Eski hâli scratchpad `Laser_old.ts` |
| C | `fireworks` | Havai Fişek | canvas2d | **Vuruş = patlama:** güçlü vuruş (EventScale) havadaki en yüksek roketi anında patlatır + yeni roket fırlatır (OnsetTracker + beat); zirveye çıkan roket küçük patlar; çalan müzikte seyrek taban akışı, sessizde roket yok. Net kabuklar: şakayık (iç halka farklı ton), eğik halka, söğüt; kıvılcım = hız yönünde kısa çizgi; patlama çakması. Seçenekler: rate, burst, life, gravity. Eski hâli scratchpad `Fireworks_old.ts` |
| U | `water` | Su Dalgası | canvas2d | Gerçek 2-buffer dalga denklemi (komşu ort/2 - prev, damp 0.985, w/4 çözünürlük): beat'te damla (bass gücü), level ile dolaşan skim damlası, \|yükseklik\| → palet LUT, upscale |
| N | `city` | Gece Şehri | canvas2d | Binalar=barValue spektrum (edge glow + koyu gövde), pencereler deterministik hash ile (flicker sin ile), ay + bass nabzı, hash1 yıldızlar |
| T | `skyline` | Silüet & Yansıma | canvas2d | Suda yansıyan silüet: binalar opak koyu, yansıma 4px dilimler halinde sinüs x-ofset + fade, ay, ufuk çizgisi, su şeritleri |
| Q | `bubbles` | Baloncuklar | canvas2d | Altta doğan, tizle çoğalan, bass ile hızlanan baloncuklar; wobble, büyüme, üstte/beat'te POP halkası |
| J | `champagne` | Köpük Fıskiyesi | canvas2d | Merkezden fışkıran köpük: sürekli akış (level) + beat burst 80, yay çizgisi (gravity 260), twinkle, jet glow |
| R | `snow` | Kar | canvas2d | **Derinlikli kar:** her tane z (0 uzak..1 yakın) → boyut/hız/parlaklık/hale; düşüş hızı yavaş süzülmüş seviyeyle; rüzgâr yumuşatılmış orta frekanstan; yön ritimle DEĞİŞMEZ. Ritim yalnız parlaklık: tane x konumuna karşılık gelen frekans sütunu (sol bas→sağ tiz) + vuruşta yukarıdan aşağı süpüren parlaklık kuşağı (EventScale). Seçenekler: fall, sway, wind, flakeSize (+ particleCount, trail). Eski hâli scratchpad `Snow_old.ts` |
| ⇧Y | `rain` | Yağmur | canvas2d | **Derinlikli, gerçekçi yağış + zemin düzlemi:** damla z (0 uzak..1 yakın) → uzunluk/kalınlık/hız/parlaklık; uzak damla zeminde daha yukarıya düşer. 640'lık havuz, süzülmüş seviyeyle damla sayısı (12'lik yumuşak belirme); eğim yavaş rüzgâr salınımı (yön ritimle değişmez). **Yağış hızı ritimle artar** (süzülmüş seviye + vuruş dalgası, `damp 3`). Damla = sönük kuyruk + parlak baş; sıçramada halka + sekme damlacıkları; zeminde sis. Ritim: x sütunu frekans parlaklığı + vuruşta zeminde güçlü frekansların altında sıçrama. **Şimşek OPSİYONEL (varsayılan kapalı):** güçlü vuruşta dallı şimşek + çift çakma + gökten ışıma. Seçenekler: length, splash, lightning, slant, density. Eski hâli scratchpad `Rain_old.ts` |
| ⇧R | `rotozoom` | Rotozoom | canvas2d | Klasik rotozoom: 2x2 damalı CanvasPattern (palet değişince rebuild), rotate+scale(oscilasyon)+translate akış, beat zoom kick |
| ⇧D | `vortex` | Hipnoz | webgl | Zıt dönen iki kalın Arşimet spirali (eski Girdap'tan yalnız Hipnoz kaldı); kalınlık frekansla, hız/yön ritimle değişmez |
| ⇧G | `hypno` | Hipnoz Spiral | canvas2d | Çift ters-dönen kalın spiral (22px/13px), temiz redraw, merkez beat nabzı + ripple halka |
| ⇧K | `opart` | Op-Art Halkalar | canvas2d | Dışa akan eş merkezli dalgalı (loblu) halkalar; şekil/yön ritimle DEĞİŞMEZ. Akış hızı süzülmüş seviye + yumuşak vuruş dalgası. Ritim yalnız kalınlık/parlaklık: halka yarıçapına karşılık gelen frekans (merkez bas→dış tiz, 32 sütun yumuşatılmış) + vuruşta merkezden dışa parlaklık dalgası (EventScale). Yeni halka merkezde yumuşakça belirir. **Stil:** Çizgi (eski görünüm, varsayılan) veya Dolu Bantlar (Bridget Riley tarzı dönüşümlü dolu bantlar, komşu halkaların farklı fazlı dalgalanmasından moiré). Seçenekler: style, rings, lobes, wobble, pulse (ritim tepki gücü). Eski hâli scratchpad `Opart_old.ts` |
| ~~⇧M~~ | ~~`solar`~~ | ~~Güneş Sistemi~~ | — | **SİLİNDİ** (kullanıcı: "pek iyi olmadı sil gitsin"). Yedekler scratchpad `Solar_old.ts` (özgün) ve `Solar_v2.ts` (gölgeli küre + şok halkası sürümü) |
| ⇧O | `orbit3d` | 3D Yörünge | three | Eğik disk: additive güneş + 6 gezegen (paylaşılan Icosahedron) + Torus yörünge halkaları; band bazlı hız/ölçek/parlaklık |
| ⇧P | `lava` | Lav Lambası | canvas2d | Dikey lav blobları (7 adet, sin döngüsü yüksel-alçal), alt ısıtıcı glow (bass), 'screen' blend yumuşak gradyanlar |
| ⇧R | `magma` | Magma | canvas2d | Püskürme: kraterden yukarı kor parçacıkları (gravity, soğuma=alfa/parlaklık yaş ile söner), beat burst 110, krater glow |
| ⇧U | `static` | Parazit (eski adı Statik) | canvas2d | Retro TV gürültüsü: low-res rastgele palet pikselleri (density=level), beat/tesadüfi beyaz satır tear, scanline+vignette, upscale (smoothing off) |
| ⇧Y | `crt` | CRT Osiloskop | canvas2d | Fosfor osiloskop: grid, ghost+ana trace (tiz jitter), güçlü glow, scanline, vignette, beat çerçeve parlaması |
| ⇧A | `spectrogram` | Spektrogram | canvas2d | Kayan spektrogram (v0.3): offscreen self-drawImage ile kayar; kaydırma sabit 150 px/sn (dt birikimli, kare hızından bağımsız, Animasyon Hızı ölçekler); sütun tek `putImageData` (1×h) ile yazılır; dikey eksen `binAtLerp` (log + komşu bin interpolasyonu); 100 Hz/1 kHz/10 kHz cetveli (`freqPosition` + `AudioFrame.sampleRate`). Seçenekler: contrast (LUT gamma), grid, beatLine |
| ⇧B | `metaball` | Metaball | canvas2d | GERÇEK metaball: low-res alan Σ r²/d² (bounding box optimizasyonu), eşik 1.0 → dolgun gövde + rim + dış glow harflaması, upscale |
| ⇧C | `cubefield` | Küp Alanı | three | 220 InstancedMesh küp halka tüneli: kameraya akış (wrap), per-küp dönme + band ölçek/parlaklık, additive |
| ⇧L | `lightning` | Şimşek | canvas2d | **Yavaş çekim yıldırım oluşumu (bulut YOK, en tepeden başlar):** (1) öncü çizgi (stepped leader): sönük ince kanal sıçramalarla (adım–duraksama) yukarıdan aşağı iner (~1.5 sn), ucu parlak, arkası soluk iz, yan dallar + alt dallar ana kanalın ilerlemesiyle büyür, kimi yarıda söner; (2) dönüş çakması: yere değince parlaklık cephesi zeminden yukarı tırmanır, tüm kanal ve dallar aydınlanır; (3) sönüm: 1-2 yeniden parlama, dallar ana kanaldan önce söner. Zayıf olayda öncü yere ulaşamadan söner. Müzik: vuruş/onset yeni öncü doğurur (en fazla 2 inen), GÜÇLÜ vuruş inmekte olan öncüyü yere ulaştırır (çakma vuruşla aynı an); konum en enerjili frekans sütunu; sessizde yeni yıldırım yok. Seçenekler: rate, thickness, slow (öncü çizgi süresi), flash (gökyüzü ışığı, dikey gradyan). Eski hâlleri scratchpad `Lightning_old.ts` ve `Lightning_v2_clouds.ts` |
| ⇧V | `vu` | VU Göstergeleri | canvas2d | 4 analog gösterge (BAS/ORTA/TİZ/SEVİYE): yay fiziği iğne (vel+kısılma), tick'ler + kırmızı bölge, hub, LED, etiket |
| ⇧X | `pong` | Audio Pong | canvas2d | Toplar spektrum çubuklarında zıplar (yerçekimi 900, duvarlar). Müzik etkileşimi: yumuşatılmış çubuklar; zıplama gücü çarpılan çubuğun enerjisinden + çubuk yükselme hızı topu fırlatır; sessizde toplar çubukta durur; vuruş/onset en güçlü çubuğun üstünden yeni top bırakır; toplar ömürlü (solar), son top kalır; top son çarptığı çubuğun rengini alır. Seçenekler: balls, ballSize, gravity, bounce |
| ⇧W | `notewaterfall` | Notta Şelalesi | canvas2d | Synthesia tarzı: local-maximum peak algılama (top 5), eşleşen nota uzar (hold), roundRect nota blokları düşer, altta 14 tuşlu klavye (peak ile yanar) |
| ⇧F | `phosphene` | Fosfen | three (manualRender, QuadShader + feedback) | **Kullanıcının nihai tarifi:** "göz kapaklarına basınca oluşan girdap tünel". Polar tünel (depth=0.3/r) + kaybolma noktası rastgele süzülür (uCenter lerp, 1.5-5sn'de bir veya beat %35 → yeni swerve) + derinlik boyunca yılan kıvrımı (sin(v·0.4+phase)·uCurve, rastgele) + sürekli swirl + fbm(4 oktav value-noise) organik duvar dokusu (grid YOK) + 8 sektör band enerjisi + merkez ışık (exp(-r·5.5), bass/beat nefesi) + FEEDBACK: önceki kare 0.993 içe emilerek eklenir (tünelin çekme hissi, decay 0.40+bass) + soft tone map. Ping-pong yarı çözünürlük (MilkDrop pattern'i) |

Silinen modlar (kullanıcı beğenmedi): Battery, Alchemy, Bars & Waves (v0.1.4), 3D Borular (v0.1.6), 3D Arazi (v0.1.8), Neon Grid ve DNA Sarmalı (v0.1.11).
Bölünen modlar: AVS (v0.1.5 birleşik → v0.1.6'da avsring/avsdots/avsripple olarak 3 ayrı mod).

**Klavye tuşları:** sayılar + m/a/d/r/g. App'te tuş eşleşmesi `toLowerCase` ile; S/H/F kısayollarıyla çakışma yok.

**Yeni mod ekleme prosedürü** (devam eden model için):
1. `src/visuals/` altına `implements Visualizer` sınıf yaz
2. `registry.ts` → `DEFS` tablosuna TEK satır ekle: `canvas2d|scene3d|webgl(id, ad, tuş, kategori, () => import('./X').then(m => m.X))`.
   `ModeId` tablodan türetilir (ayrı union/switch YOK); sınıfta `id/name/renderer` alanı tutulmaz.
3. Bitti. UI (mod seçici, tuşlar, kategoriler) registry'den otomatik beslenir.

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

`harfler, ⇧Shift+harfler` mod (her modun KENDİ harfi var; mod seçicide gösterilir) · `1-9, 0` FAVORİ modlar (eklenme sırasıyla ilk 10 favori; modun ikinci kısayolu, favoriden çıkarılınca sıradakiler kayar) · `←/→` önceki/sonraki mod · `/` mod seçici (arama + kategori) · `Space` play/pause (dosya) · `S` ayar paneli · `H` UI gizle/göster · `F` tam ekran · `Esc` seçici/panel kapat

**Tuş şeması notu:** harf tuşları dolduğu için ikinci varyantlar BÜYÜK harf (Shift'li) key aldı
(App'te `e.shiftKey ? key.toUpperCase() : key.toLowerCase()`). S/H/F kısayolları Shift'siz
kaldı; uppercase mode key'leri (D,G,K,M,O,P,R,U,Y) bunlarla çakışmıyor. ModeSwitcher'da
uppercase key `⇧X` olarak etiketlenir.

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
1. **Mod birleştirme / karıştırma özelliği** — kullanıcı talebi (v0.1.6): "ileride bu modları
   birleşik gösterme özelliği yapacağız". Öneri: "Karışım" composite modu — birden fazla alt
   görselleştiriciyi üst üste render eden wrapper Visualizer (canvas2d alt modları için iz
   efekti/fade yönetimi composite'a devredilmeli; three modları karışımda hariç tutulabilir
   veya kendi sahniyle küçük pencere gösterebilir — tasarım kararı gerekli).
2. **Tekrar manuel test** — yeni modlar (MilkDrop hayal bulutu ayarı, AVS üçlüsü, G-Force
   etkileşimi) kullanıcı onayı bekliyor; kaynak geçişleri de hâlâ doğrulanmalı.
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
- **v0.1.2 — Plenoptic modu (kullanıcı talebi: "XP'deki müzik çalarken başka boyuta götüren görsel",
  yani Windows Media Player'ın Plenoptic'i):**
  - `src/visuals/Plenoptic.ts` — THREE.InstancedMesh (140 küre, tek draw call), AdditiveBlending +
    depthWrite:false (WMP parlaklığı), her küre kendi frekans bin'ine bağlı (binAt(hueT)), bass/beat
    ile parlaklık+ölçek pulsu, kameraya doğru süzülme (seviyeye bağlı hız, wrap'ta yeniden konum),
    sin/cos wobble; additive malzemede THREE.Fog yanlış parlattığı için `fog:false` + manuel depthFade.
  - Registry'ye `plenoptic` (tuş 6) eklendi; `ModeId` union'ına 'plenoptic' eklendi.
  - RenderLoop.setMode'daki three tetiklemesi 'tunnel'-hardcode yerine `MODES` metadata'dan
    `renderer === 'three'` kontrolüne generalize edildi (yeni three modları otomatik çalışır).
  - Plenoptic kendi lazy chunk'ında (2.19kB; three zaten paylaşılan chunk).
- **v0.1.3 — WMP nostalgia paketi.** Kullanıcı: "hangi mod?" sorusuna "hepsini sırayla uygula,
  beğenmediğimizi sileriz" dedi → Ambience (7), Battery (8), Alchemy (9), Bars & Waves (0) eklendi;
  Plenoptic kalıyor. Kullanıcı test edip beğenmediklerini söylerse ilgili mod şu şekilde silinir:
  visuals/<Mod>.ts dosyası + registry MODES girdisi + createVisualizer case'i + ModeId üyesi +
  PLAN.md/README satırları. Not: Ambience ve BarsWaves statik import (ana bundle'da, ~3kB);
  Battery ve Alchemy dynamic import (kendi chunk'ları). Kamera çerçeveleme: Battery GROUP_Z=-6,
  Alchemy GROUP_Z=-7.5 (spike uzunlukları kenar taşmasın diye).
- **v0.1.4 — Kullanıcı 8/9/0'ı beğenmedi → Battery, Alchemy, BarsWaves tamamen silindi**
  (dosyalar + registry girdileri + ModeId üyeleri + dokümantasyon). Kalan 7 mod: bars, radial,
  particles, wave, tunnel, plenoptic, ambience.
- **Aranan görsel hâlâ bulunamadı** (kullanıcı: "hiçbiri istediğim gibi değil; belki o zamanlar
  kurduğum bir uygulamada var olan bir özellikti veya XP ekran koruyucu falanı"). Güçlü hipotez:
  **Winamp eklentisi** — en olası aday MilkDrop (psikedelik, sürekli morphlanan, sonsuza zoomlayan
  akışkan tüneller; "başka boyut" hissinin mimarı). Diğer adaylar: Winamp AVS, G-Force, müzikle
  değişen ekran koruyucular. Kullanıcıya soruldu, cevap bekleniyor.
- **v0.1.5 — Kullanıcı "hepsini tek tek yapalım, beğenmediğimi o anda silersin" dedi** → 4 aday
  mod eklendi: MilkDrop (m), AVS (a), G-Force (g), 3D Borular (e). Teknik altyapı değişiklikleri:
  (1) `Visualizer.manualRender?: boolean` eklendi — MilkDrop kendi render hattını çalıştırır,
  RenderLoop otomatik render'ı atlar; (2) `VisualizerDeps.renderer` eklendi (MilkDrop feedback
  buffer'ları için WebGLRenderer referansı); (3) klavye eşleşmesi harf tuşları için toLowerCase
  yapıldı, ModeSwitcher etiketleri toUpperCase; (4) MilkDrop'ta özel alan adı `renderer` olamaz
  (arayüz üyesiyle çakışır) → `gl` olarak adlandırıldı. Beğenilmeyen modlar v0.1.4 prosedürüyle
  anında silinebilir.
- **v0.1.6 — Kullanıcı geri bildirimi uygulandı:**
  (1) MilkDrop "bu şekilde değil, hayal bulutu gibi" → shader yumuşatıldı: yavaş nefes zoom,
  düşük frekanslı bulut kabarması, yukarı drift, uzun decay, angular stripe'lar kaldırılıp
  yumuşak alan boya, yavaş hue; isim 'MilkDrop (Hayal Bulutu)'.
  (2) AVS "özellikleri ayırmak daha hoş" → birleşik Avs silindi; AvsRing (a), AvsDots (d),
  AvsRipple (r) ayrı modlar oldu. Kullanıcı ileride modları BİRLEŞİK gösterme özelliği istiyor
  (sıradaki adımlara eklendi).
  (3) G-Force "müzikle etkileşimi yok" → alan zaman hızı mid/bass'a bağlandı, hız 2x +
  beat kick, partikül parlaklığı kendi frekans bandına (bass/mid/tiz) bağlı, boyut bass ile.
  (4) 3D Borular tamamen silindi ("hiç beğenmedim").
- **v0.1.7 — Kullanıcı "her birini deneyerek hatırlayacağım" dedi** → 5 görsel arketip modu daha
  eklendi: Starfield (i), Fractal (z), Terrain (t), BlobMode (o), Wormhole (w). Yeni ortak altyapı:
  `visuals/quadShader.ts` (fullscreen quad + ortho kamera + ShaderMaterial sarmalayıcı) — MilkDrop
  buna refactor edildi, Fractal da aynı yardımcıyı kullanıyor. Fractal da manualRender=true
  (feedback YOK, doğrudan render). Terrain ring-buffer yükseklik + vertex renkleri (wireframe
  Basic). Wormhole manuel BufferGeometry tüp. Not: shader modlarında dinamik loop üst sınırı
  sabit (GLSL ES) — break ile erken çıkış.
- **v0.1.8 — Kullanıcı geri bildirimi:** "Işık hızı güzel ama düzgün çalışmıyor; Fraktal anlaşılmıyor
  ve çalışmıyor; 3D Arazi sil; Blob güzel ama çalışmıyor; Solucan Deliği çok kötü." Düzeltmeler:
  (1) Starfield yeniden yazıldı — eski sürümde yıldızlar ekran ORTASINDA dar alanda doğup
  perspektifi ters kuruyordu; artık klasik geniş alan (x,y ±9, z 0.08-10) + doğru projeksiyon.
  (2) Fractal: zoom döngüsü kaldırıldı (origin'in içine dalıp düz renk oluyordu), tam ekran
  morph + smooth coloring eklendi; ad 'Fraktal' oldu.
  (3) BlobMode: 'lighter'+0.22 fade beyaz doygunluğu yapıyordu → 'screen' + 0.38 fade + düşük
  alfalar.
  (4) Wormhole: mesh-tüp tamamen çöpe, yerine polar tünel fragment shader (grid + 8 band
  uniform + twist + travel). uBands float[8] uniform'u ShaderMaterial'de number[] value ile
  çalışıyor.
  (5) Terrain silindi.
- **v0.1.9 — Kullanıcı "diğerlerine geç, hâlâ bulamadım"** → 6 yeni arketip: Kaleidoscope (k),
  Plasma (p), Ribbons (l), Galaxy (y), Spirograph (v), Fire (e). Teknik notlar: (1) low-res
  ImageData modları (Plazma, Ateş) offscreen canvas + drawImage upscale ile (putImageData
  ölçekleyemez); (2) Plazma radial mesafe tablosu resize'ta bir kez hesaplanır; (3) Ateş heat
  buffer'ı simetrik frekans beslemesi alır (kenarlarda sıfır binAt); (4) Kaleydoskop offscreen
  yarı-çözünürlük kaynak + 8 dilim aynalama; (5) Galaksi Points + vertexColors (per-point size
  shader'sız olmaz → material.size topluca bass ile).
- **v0.1.10 — "bunlar dışında ekleyeceğin var mı?"** → kalan ikonik arketipler: Matrix (x),
  NeonGrid (n), Laser (b), Fireworks (c), Water (u), Helix (j). Teknik notlar: (1) Water gerçek
  dalga simülasyonu — cur/prev swap sonrası this.cur güncel buffer; drop() this.cur'a yazar;
  (2) Matrix kolonları prevY→y satır aralığına glif basar (hızlı düşüşte boşluk olmasın);
  (3) Fireworks apex: vy=-√(2g·Δy) — patlama vy≥-24'te; (4) NeonGrid sun şeritleri clip
  ile; yatay satırlar pow(p,2.6) perspektif; (5) Helix strand B = strand A'nın antipodu
  (cos(ang+π), sin(ang+π)) → rung uçları sadece -x,-z ile yazılır.
- **v0.1.11 — Kullanıcı: "Neon Grid ve DNA Sarmalı sil"** → ikisi de tamamen silindi
  (dosyalar + registry + ModeId + dokümantasyon). 26 mod kaldı. Kullanıcı mevcut modlarda
  düzenleme isteyecek (beklemede). Kalan yapılmamış arketip fikirleri (kullanıcıya sunuldu):
  Şehir Silüeti (spektrum binaları), Baloncuklar (yükselen), Kar/Yağmur, Rotozoom (damalı
  zemin), Hipnotik Spiral, Gezegenler/Solar sistem, Lav Lambası, Retro TV (statik gürültü).
- **v0.2.0 — Kullanıcı: "sırayla yap, ikişer şekilde"** → 8 arketipin HEPSİ iki varyantla
  yapıldı (16 mod, bkz. bölüm 5 tablosu). Yeni ortak yardımcılar `visuals/util.ts` (hash1,
  lighten — yeni modlar bunu kullanır; eski modlardaki lokal lighten'a dokunulmadı).
  Tuş şeması Shift destekli büyütüldü. Retro TV varyantları (Statik/CRT) low-res ImageData +
  upscale pattern'ini Plasma/Fire'dan alır ama smoothing kapalı (pikselli TV hissi).
- **v0.2.1 — Kullanıcı "kalanları da ekle"** → son 8 arketip (bkz. tablo). Teknik notlar:
  (1) Spectrogram offscreen kendini drawImage(-2,0) ile kaydırır (self-draw tarayıcılarda güvenli);
  (2) Metaball field'ı Float32Array + ball başına bounding-box; (3) Lightning displace()
  iteratif midpoint; (4) Pong çarpışması py+r<=top+26 toleranslı geçiş testi; (5) NoteWaterfall
  peak eşleştirme toleransı 0.025 (t uzayında). Büyük harf tuşları doldu: A,B,T,C,L,V,X,W
  (toplam kullanılan: D,G,K,M,O,P,R,U,Y,A,B,T,C,L,V,X,W). Artık boş Shift yuvası: E,I,N,Q,Z + F (Fosfen'e verildi).
- **v0.2.2 — Kullanıcı nihai tarifi verdi:** "solucan deliği gibi farklı yönlere kıvrılarak ilerleme,
  hipnoz eden, müzik ritmine göre + rastlantısal davranış, göz kapaklarına bastığında oluşan girdap
  tünel ve ilerleme hissi." → **Phosphene (Fosfen, ⇧F)** özel olarak yazıldı (detay bölüm 5'te).
  Tasarım kararları: (1) grid/keskin desen yerine fbm organik doku — fosfen bulutumsu olur;
  (2) kıvrım iki katman: ekran-uzayı kaybolma noktası süzülmesi + derinlikte sinüs yılanı;
  (3) feedback izleri içe doğru 0.993 emilimle — "içine çekilme" hissinin anahtarı;
  (4) rastgelelik: swerve zamanlayıcı + beat %35 erken tetik; (5) tuş 'F' büyük harf —
  Shift+F = Fosfen, düz F = tam ekran (mode kontrolü kısayollardan önce geldiği için çakışmaz).
  Tuning parametreleri (kullanıcı geri bildirimine göre): travel hızı, feedback decay (0.40),
  swirl hızı, swerve sıklığı, merkez glow şiddeti — hepsi Phosphene.ts içinde tek yerde.
- **v0.2.3 — Fosfen reddedildi ("hiç alakası yok, gerçek solucan deliği gibi hissettirmiyor").**
  Teşhis: ekran-uzayı polar girdap = düz huni GÖRÜNTÜSÜ verir; "içinden geçme" hissi ancak
  gerçek 3D'de, eğri yol üzerinde uçan kamerayla oluşur. Wormhole (W) bu ilkeyle baştan yazıldı:
  rastgele kapalı CatmullRom eğri + TubeGeometry, kamera eğri üzerinde (teğet bakış + roll),
  beat'te ileride doğan ve içinden geçilen ışık halkaları, FOV kick, vertex undulation.
  Bu mimari kullanıcı deneyimi için REFERANS: "gerçekten içinde" hissi = 3D path + kamera on-path.
  Fosfen (⇧F) duruyor — kullanıcı isterse silinecek.
- **v0.2.4 — Kullanıcı: "hatalı ve düzgün çalışmıyor; böyle hızlıca köşeyi dönen solucan deliği
  mi olur :D"** → v0.2.3'teki iki gerçek hata teşhis edildi: (1) rastgele kutu içi CatmullRom
  noktaları KENDİYLE KEŞİYORDU (tüp katlanmaları) ve kameranın sabit up=(0,1,0)+lookAt yaklaşımı
  dik yörünge segmentlerinde DEJENERE oluyordu (görüntü çökmesi); (2) lookAt noktası keskin
  dönüşlerde kamerayı kamçı gibi savuruyordu. Çözüm: kapalı periyodik salınan-halka yolu
  (buildLoopCurve: tam-sayı frekanslı sinüs ofsetler → keskin köşe matematiksel olarak imkânsız,
  dikişsiz loop), parallel-transport up (fwd'ye ortogonalize, asla çökmez), teğet ileri bakış,
  viraja yumuşak yatma (banking) + yavaş sway. Kural: "içinde uçuş" modlarında kamera yol
  teğetini takip etmeli ve up asla sabit dünya eksenine bağlanmamalı.

- **Refactor + arayüz (mod seçici):** (1) `registry.ts` tek tabloya indirildi (ModeId union + MODES + 220 satırlık
  switch → `DEFS`); tüm modlar tembel yüklenir; ModeMeta'ya `category` eklendi (6 kategori). (2) `Visualizer`
  arayüzünden `id/name/renderer` kaldırıldı (RenderLoop `modeMeta(id).renderer` kullanır). (3) 51 çiplik
  üst çubuk → `‹ mod adı [tuş] n/51 ›` + `/` ile açılan aramalı, kategorili mod seçici; ←/→ ile gezinme.
  (4) Arayüz 3,5 sn boşta kalınca silinir (`.stage--idle`). (5) App klavye işleyicisi `switch`'e çevrildi,
  ölü `F` dalı kaldırıldı. **Tarayıcıda görsel doğrulama YAPILMADI** (yalnızca `tsc` + `vite build`).

- **Moda göre ayarlar + ortak yardımcılar:** (1) `visuals/options.ts`: `OptionDef` + `SHARED_OPTIONS`
  (barCount, particleCount, rotationSpeed, glow, speed). Registry girdisine `{ uses: [...], options: [...] }`
  verilir; `ModeMeta.options` = kullanılan paylaşılanlar + `speed` + moda özel seçenekler. Panel yalnızca bunları
  çizer. (2) Değerler `Settings.modeOptions[modeId][optionId]` (varsayılana eşitse saklanmaz); `toView(settings,
  modeId)` çözümler, görsellere `s.opt.<id>` ile ve eski `s.glow/barCount/...` alanlarıyla iner. `speed`
  RenderLoop'ta `frame.dt`'ye uygulanır (tüm modlar). Global `glow/barCount/particleCount/rotationSpeed` alanları
  Settings'ten kaldırıldı (eski kayıtlı değerler varsayılana döner; diğer ayarlar korunur, anahtar hâlâ v1).
  (3) Moda özel seçenekli modlar: bars, wave, kaleidoscope, fire, rain, snow, plasma, spirograph — yeni
  seçenek eklemek: registry'de `options: [slider(...)]` + görselde `s.opt.<id>`. (4) `visuals/util.ts`:
  `TAU, clamp01, damp, clearFrame, fadeFrame, setGlow, createOffscreen, lighten, hash1` — modlardaki 25 solma,
  23 glow, 7 offscreen, 13 düz boyama, 70 `Math.PI*2` tekrarı bunlara indirildi; Matrix/Blob'daki yerel `lighten` kopyaları silindi.
  `ModeId` artık gerçek string birleşimi (yardımcılar generic). **Tarayıcıda doğrulama YAPILMADI** (kullanıcı test
  istemedi); yalnızca `tsc` + `vite build`.

- **Ayar altyapısı genişledi:** `OptionDef.kind` artık `'select'` (açılır liste, değer = dizin, `choices`) destekler
  ve `showIf(values)` ile koşullu görünürlük (örn. LED segment sayısı yalnızca LED stilinde). Kurucular: `slider/toggle/select`.

- **Üst çubuk/panel düzeni:** Ayarlar ve Tam Ekran düğmeleri SVG ikon (`ui/icons.tsx`; tam ekranda ikon değişir, title'da kısayol).
  "Kaynak Değiştir" yanlışlıkla basılmasın diye üst çubuktan kaldırıldı → Ayar paneli > "Ses Kaynağı" bölümünde, iki adımlı onayla.
  Panel açıkken panel/üst çubuk/oynatıcı dışına (görsele) tıklamak paneli kapatır (App'te window `pointerdown` dinleyicisi).

- **Parlama (Glow) performansı:** `shadowBlur` her çizimde ayrı blur geçişi olduğundan öğe-başına kullanım kasıyordu.
  Görünüm korunup mekanizma değişti (`util.ts`): `drawGlowDot` (önbellekli radial-gradient sprite, nokta/parçacık modları:
  Particles, GForce, Champagne, Magma, AvsDots, Matrix başı), `strokeGlow` (aynı yolun geniş+silik ikinci vuruşu; çizgi
  modları: Radial, Vortex, Laser, Opart, Bubbles, Starfield), `Bloom` (kare başına tek küçült-büyüt geçişi, SABİT maliyet;
  SpectrumBars). Bloom YALNIZCA her karede `clearFrame` yapan modlarda kullanılmalı — iz (fade) bırakan modda geri besleme yapar.
  Matrix'te hata vardı: baş harfte açılan shadowBlur hiç sıfırlanmıyor, tüm iz harfleri gölgeyle çiziliyordu.
  Hâlâ `setGlow`/shadowBlur kullanan modlar (öğe sayısı küçük, kasmaz): Ambience, AvsRing, AvsRipple, Crt, Kaleidoscope,
  Pong, Solar, Spirograph, Vu, Waveform, Ribbons, Fireworks (roketler). Yeni modda >~10 öğe/kare için shadowBlur kullanma.
  **Tarayıcıda ölçüm/görsel doğrulama YAPILMADI.**
  Kısa etiketli `select`'ler `segmented: true` ile düğme grubu olarak gösterilir (Parlama, bars: style/align, panelde FFT); uzun etiketliler (renk dağılımı, palet) açılır listede kalır.
  **Parlama** tek segmentli düğme (`select` + `segmented: true`): Kapalı/Düşük/Orta/Yüksek, varsayılan Yüksek; saklanan değer 0-3
  (`toView`: glow = değer>0, glowQuality = değer-1; eski kayıtlı 0 = kapalı geçerli kalır): RenderLoop her karede `setGlowQuality` çağırır; `glowBlur()/setGlow` bulanıklığı
  (×0.45/0.75/1), `drawGlowDot` yarıçap+alfayı, `strokeGlow` hale katmanlarını (Yüksek'te ek dış hale, Düşük'te hale yok),
  `Bloom` gücünü ölçekler. Doğrudan `shadowBlur` atayan yeni kod `glowBlur(px)` kullanmalı.

- **Favori modlar:** `Settings.favorites: ModeId[]` (eklenme sırası, localStorage'da kalıcı, bilinmeyen id'ler temizlenir;
  `toggleFavorite`). Mod seçicide en üstte "★ Favoriler" grubu (modlar kendi kategorisinde de görünür); her karoda ve mod
  çubuğunda yıldız düğmesi. Karo artık `div` içinde iki düğme (`.tile__main` + `.tile__star`) — iç içe `button` yok.

- **Toplu mod güncellemesi (v0.3):** Yeni paylaşılan seçenek `trail` ("İz Uzunluğu", `fadeTrail(ctx, s, alpha, w, h)`);
  modun `uses`'ına 'trail' yazılınca iz süresi ayarlanır. Güncellenen 26 mod ve seçenekleri (registry'de, `s.opt.<id>`):
  ambience(layers,height) · gforce(scale,size,life; `init` #000 hatası giderildi) · starfield(streak,size,boost) ·
  kaleidoscope(segments,mirror,sources,size) · plasma(scale,bands,contrast; LUT artık önbellekli) · fire(flame,flicker,mirror) ·
  matrix(glyphs,fontSize) · fireworks(rate,burst,life,gravity) · water(damping,drop,contrast; LUT önbellekli) ·
  rotozoom(pattern,zoom,scroll) · twister(width,twist,sway) · static(grain,density,glitch,scanlines,vignette) ·
  metaball(count,size,orbit) · lightning(rate,thickness,flash) · vu(scale,stiff,labels,led) · pong(balls,ballSize,gravity) ·
  notewaterfall(keys,maxNotes,threshold) · snow(+fall,sway) · rain(+length,splash,flash) · bubbles(rate,size,rise,pops) ·
  opart(rings,lobes,wobble,pulse) · laser(beams,sweep,spread) · galaxy(size,tilt,react) · tunnel(travel,react,core) ·
  milkdrop(decay,zoom,paint → uniform) · fractal(detail,zoom,morph → uniform).
  **Dokunulmayanlar (tekrar/gereksiz adayı, kullanıcıya soruldu):** avsring, avsdots, avsripple, city, skyline, crt, magma,
  champagne, blob, lava, hypno, vortex, plenoptic, cubefield, orbit3d, solar, ribbons, spirograph, wormhole, phosphene.

- **Mod birleştirme ve silme (v0.3, kullanıcı onayı: "özelliğini ekledikten sonra sil"):** 14 mod, özgün yanı kalan modun
  seçeneği yapıldıktan sonra silindi (tablodaki satırlar artık geçersiz): avsring/avsdots/avsripple → **radial**
  (stil Nokta, `scope` ses dalgası halkası, `ripples` vuruş halkaları) · crt → **wave** (`crt` efekti) · city/skyline →
  **bars** (stil Şehir + `moon`) · spirograph → **ribbons** (`curve` Spiro, heads, length) · magma/champagne →
  **particles** (kaynak Fıskiye, `source`, `twinkle`) · blob/lava → **metaball** (`motion` Lav, `render` Yumuşak) ·
  hypno → **vortex** (stil Hipnoz) · cubefield → **plenoptic** (`shape` Küp, `count`, `travel`) · orbit3d → **solar**
  (`tilt`, `spin`, `orbits`, `stars`; rotationSpeed). Serbest kalan tuşlar: a,d,r,n,t,j,o,P,R,Y,G,C,O (⇧). Silinen dosyaların
  kopyası repo dışında (oturum scratchpad'i) yedeklendi; repo'da git geçmişi yoktu (dosyalar takipsizdi).
  **Dokunulmadı:** wormhole, phosphene (shader tünelleri; 3D Tünel'e "özellik" olarak eklenemez; Fosfen için eski silme notu geçerli).

- **Nota Rulosu (eski Notta Şelalesi; id `notewaterfall`, tuş ⇧W) — yatay piyano rulosu:** önceki "şerit enerjisi" yaklaşımı gerçek
  nota vermiyordu ve gelecek bilinmediği için aşağı düşen nota mantığı yanlıştı. Şimdi: spektrum tepeleri parabolik
  interpolasyonla frekansa → en yakın MIDI notasına çevrilir (`AudioFrame.sampleRate` gerekir), en güçlü tepenin %50'sinin altı ve
  (seçenekle) alt notanın +12/19/24/28 yarım ton üstündeki zayıf tepeler (armonikler) elenir, en çok `maxNotes` nota alınır; 0.07 sn
  basılı tutma histerezisi. Çalan notalar klavyede basılı (Sağ/Sol), geçmiş klavyeden uzağa yatay akar (`scroll` px/sn); renk = perde
  sınıfı (Do hep aynı renk, B→C dikişsiz), nota adı C D E / Do Re Mi. Sınır: düşük notalarda (~130 Hz altı) FFT çözünürlüğü
  yetmez → Ses Motoru'nda FFT 4096 önerilir; başlangıç oktavı varsayılan 3 (C3).

- **MilkDrop ayarları düzeltildi:** `decay` geri-besleme denge parlaklığını (boya/(1-decay)) değiştirdiği için uçlarda ekran beyaza doyup /
  kararıp "donmuş" görünüyordu → boya `(1-decay)/0.045` ile normalleştirildi, decay aralığı 0.92–0.975. Yeni: `react` (ses uniform'larını
  ölçekler, 0 = müziğe tepkisiz), `swirl` (dönme), `warp` (dalgalanma); `zoom` 0–3.

- **İKİ AYRI MOD (kullanıcı: "uzayda güzeldi; Kuantum bambaşka bir şey, yeni mod olarak ayarla"):**
  (1) **Uzay Yolculuğu (`voyage`, tuş N, Voyage.ts) — yalnızca yıldız + nebula:** "bir yıldız gibi süzülüyoruz; sadece ritme göre hız ve yön
  değişir". Kullanıcı sırayla şunları KALDIRTTI: gezegen, uzak galaksiler, ışık halkaları (ne olduğu belli değil), bağımsız kuyruklu yıldızlar
  (kendi hızlarıyla gidip "tutarsız" görünüyordu). Kalan mimari: dünya sabit, yalnız KAMERA hareket eder. (a) **Boş taraf yok:** nesneler
  kameranın ÇEVRESİNDE her yöne dağılmış küp hacimde (yıldız 12000 @ R=220, bulut 56 @ R=300) ve kamera ilerledikçe küpte SARMALANIR
  (toroidal); sarma, parlaklığın zaten 0 olduğu uzak yüzeyde → pop yok, kamera dönünce dönülen taraf da dolu. (b) **Tutarlı ışık çizgisi:**
  gerçek hareket bulanıklığı — yıldızın önceki konumu p + (v + ω×r)·Δt (v = ileri·hız, ω = (0,−yaw',0) + sağ·pitch' + ileri·roll'),
  dönüşlerde çizgiler yana süpürür; uzunluk ≤ 60. (c) Ses düşük-geçiren filtreli (sLevel/sBass/sMid/sTreble), hız = yumuşak seviye + sönümlü
  vuruş atılımı, yön = yavaş salınımlar + 9-18 sn'de bir yumuşak manevra, dönüşe yatma, hızla FOV. Seçenekler: travel, steer, stars, streak,
  nebula. Doğrulanmadı.
  **Geri bildirim (kullanıcı):** "süzülme gerçekçi değil; müzik durunca olağan devam ediyor, müzikle eşzamanlı hissettirmiyor; gerçekçi
  bir uzay gezisiyle alakası yok" ve hedef görseli kendisi anlatacak ("hiçbiri, ben anlatayım") → BEKLENİYOR. Yapılan: tüm hareket
  `activity = clamp01(sLevel*5)` ile kapılandı (sessizlikte hız → 0, yön/pitch/roll → 0); vuruşta yaw/pitch itmesi + daha güçlü hız atılımı.
  **Düzeltmeler (kullanıcı):** yıldızlar kare görünüyordu → `PointsMaterial.map` ile radyal gradyan parıltı dokusu (yuvarlak, yumuşak).
  "Sağa dönerken yıldızlar sola gidiyor, inandırıcı değil" → kamera yatış (roll) işareti TERSTİ (sağa dönerken sola yatıyor, görüntü bir yöne
  dönerken yıldızlar öbür yöne akıyordu); `camera.up.applyAxisAngle(ileri, roll)` pozitif roll = saat yönü = sağa yatış → rollTarget artık
  +yawRate·1.6 (dönüşün içine yatar). Yıldızların yaw'da sola kayması fizik olarak doğrudur ve korunur.
  **Dönüş yumuşaklığı / tek yöne dönme (kullanıcı):** (1) vuruş itmesi artık yawRate'e değil sönen `yawBias` hedef sapmasına ekleniyor,
  yawRate sönümü 0.6 (eskiden 0.9 + doğrudan itme → sert). (2) "Hep aynı yöne dönüyor" sebepleri: orta−tiz farkı sürekli pozitif eğilim
  veriyordu (yavaş ortalaması `balAvg`/`bassAvg` çıkarıldı), yön hiç geri dönmüyordu (`−yaw·0.12` geri çağırma eklendi; pitch için `−pitch·0.3`),
  manevra işareti rastgeleydi (artık sırayla sağ/sol).
  **Kural (kullanıcı): "dönüşler ritimle alakasız; hız, titreşim ve renk yalnızca ses tepkisi; anlık yüksek seste ani hareket yok":**
  yön/pitch/roll artık hiçbir ses bandına veya vuruşa bağlı DEĞİL (yavaş sinüsler + sırayla sağ/sol manevra + geri çağırma), yalnızca
  `activity = clamp01(sMotion·5)` ile kapılı (müzik yoksa durgun). Hız = BASE·(0.25+1.7·sMotion)·activity, `sMotion` yavaş-atak filtre
  (damp 0.9) + hız sönümü 1.2; vuruş atılımı (surge), FOV vuruş sıçraması, beat kick'leri KALDIRILDI. Titreşim: **sis bulutları içindir, kamera DEĞİL** (kullanıcı düzeltti) —
  her bulutun kendi bandının enerjisiyle orantılı ölçek/opaklık/konum titreşimi (`vibration` seçeneği, sessizlikte 0); kamera sallanması KALDIRILDI. Renk: yıldız R/G/B kazancı bas/orta/tiz ile; bulut hue'su `hue += dt·sMotion·0.12`
  (sessizlikte durur).
  **Hep ileri (kullanıcı: "yön vermeyinde de hareket etmiyor gibi, hep ileri ilerleme olsun"):** sebep: `activity = clamp01(sMotion·5)` ve hız
  ∝ activity·(0.25+1.7·sMotion) → normal sesle (seviye ~0.1) kamera neredeyse duruyordu, yön de aynı kapıdan geçince zayıftı. Yeni:
  `activity = clamp01(sMotion·40)` (çalan her müzik "var" sayılır), hız = BASE·(cruise + 1.6·sMotion), cruise = 0.12 + 0.48·activity →
  müzik varken sabit seyir hızı + ses ÜSTÜNE ekler; tam sessizlikte durmaz, yavaş süzülür (0.12). Yön genlikleri büyütüldü (0.3/0.2, manevra 0.3-0.6).
  **Işık çizgisi boyu (kullanıcı):** yakın yıldızlar belirgin uzun, uzaktakiler kısa: çizgi ofseti `lf = 0.12 + 2.1·(1 − d/R)^1.6` ile
  ölçeklenir (ω×r terimi uzaklıkla büyüdüğü için uzak çizgiler dönüşte fazla uzuyordu). Fiziksel hareket bulanıklığına sanatsal bir ağırlık.
  **Işık çizgisi yönü (kullanıcı: "yaklaşan yıldızın çizgisi farklı yöne gidiyor"):** ω×r (dönüş) terimi çizgileri merkezden dışa değil yana
  çarpıtıyordu → KALDIRILDI; çizgi yalnızca ilerleme yönünde: kuyruk = p + ileri·hız·Δt (ilerleme noktasına doğru). pitchRate/rollRate ve sağ
  vektör silindi. Boy ölçeği `lf = 0.03 + 2.2·(1−d/R)^2.2` (uzaktakiler neredeyse nokta).
  **Yön değişimi nadir (kullanıcı: "sık sık olmasın, sadece ileri ilerlediğini görmedim"):** sürekli sinüs salınımları KALDIRILDI (kamera hep
  hafifçe dönüyordu). Artık çoğu zaman düz ileri; 25-55 sn'de bir, 6-10 sn süren TEK yumuşak viraj (sin² çan eğrisi, yaw ±0.14-0.24 rad/s ≈
  net 20-45°, pitch ±0.05), virajlar sırayla sağ/sol (net sapma birikmez), müzik yokken başlamaz; roll yalnızca dönüşe bağlı (düz giderken 0).
  **Yaklaşan yıldız hızlansın (kullanıcı):** doğrusal ilerleme + perspektif yetmedi → çizim konumu (`renderPos`, dünya konumu `starPos` sabit kalır)
  yanal bileşeni `flare = 1 + accel·2.5·(1−d/R)^3` ile büyütür (yıldız yaklaştıkça ilerleme ekseninden uzaklığı artar → ekranda merkezden
  dışa giderek hızlı fırlar). Seçenek: `accel` ("Yaklaşma İvmesi", 0-3, varsayılan 1; 0 = saf perspektif). Işık çizgisi başı/kuyruğu da renderPos'tan.
  (2) **Kuantum Dalışı (`quantum`, tuş J, Quantum.ts)** ayrı mod: tek geçişli QuadShader, log-kutupsal sonsuz zoom (derinlik v = -ln r + zoom,
  zoom = hız integrali → sıçrama yok), merkez süzülür + yılan dalgalanması + sarmal; DALGA = ses dalgasıyla bükülen halkalar + spektrumla parlayan
  sarmal kaburgalar (64×2 DataTexture); TANECİK = 3 paralaks katmanda hücre-hash parıltıları; merkez çekirdek, vuruşta dışa yayılan ışık halkası.
  Seçenekler: travel, steer, twist, waves, density, core, quality. **İkisi de tarayıcıda doğrulanmadı** (tsc+build).

- **Uzay Yolculuğu bitirildi** (kullanıcı: "daha iyi oldu"); son kontrol: `tsc` + `vite build` temiz, ölü kod yok.
- **Solucan Deliği (`wormhole`) seçenekleri eklendi (v0.3):** shader/yol/kamera mimarisine dokunulmadı. `travel` (hız), `punch` (vuruşta hızlanma
  + FOV sıçraması), `kick` (vuruşta savrulma), `bank` (viraj yatışı), `fov`, `wave` (duvar dalgalanması), `bands` (spektrumla parlayan duvar,
  yeni uniform `uBandAmt`), `brightness` (`uBright`), `ring` (vuruş halkası). Hız artık düşük-geçiren filtreli seviyeden (`sLevel`, damp 2.5)
  hesaplanır; vuruş atılımı yalnız `punch`'a bağlı (0 = tamamen sakin). Varsayılanlar eski davranışı korur (punch/kick=1). **Doğrulanmadı.**

- **Kuantum Dalışı (J) baştan yazıldı — gerçek kıvrımlı tünel (kullanıcı: "solucan deliğinde gezinme hissettirmiyor"):** teşhis: ekran-uzayı
  log-kutupsal zoom = düz huni görüntüsü (Fosfen'deki hatanın aynısı; v0.2.3 notu: "içinden geçme" ancak 3B yol + yol üzerindeki kamerayla olur).
  Yeni: tek geçişli QuadShader'da KÜRE İZLEME — her piksel için ışın, tünel ekseni a2·z²/2 + a3·z³/6 kadar kıvrılır (a2/a3 = yol uzunluğuna
  bağlı sinüs toplamının 2./3. türevi, JS'te analitik; kamera ekseninde ve teğet yönünde, bu yüzden 1. türev yok), adım = (R−|o|)/|lat−c'|
  güvenli üst sınır, 36 yineleme, ZMAX 110. Duvarda: halka/kaburga DALGALARI (ses dokusu: spektrum + dalga biçimi) + 3 katmanlı TANECİK
  parıltıları (dünya biriminde kare hücre), kenarda rim parlaması, uzak duvar ışık sisine karışır. Viraj içine yatış (roll = a2.x·9).
  Hareket Voyage ilkelerine uyar: yol müzikten BAĞIMSIZ (yalnız katedilen mesafeye bağlı), hız yavaş-atak seviye + sabit seyir (cruise),
  vuruş sıçraması/savrulma YOK. Seçenekler: travel, bend, radius, twist, waves, density, core, quality. `steer` seçeneği `bend` oldu.
  **Doğrulanmadı** (tsc+build).

- **Kuantum Dalışı Solucan Deliği'ne BİRLEŞTİRİLİP silindi (kullanıcı: "solucan deliği ile bunu birleştirelim"):** hayatta kalan = `wormhole`
  (gerçek 3B TubeGeometry + kapalı yol + yol üzerinde kamera). Taşınanlar (FRAG'a "Kuantum katmanı"): spektrum+dalga biçimi DataTexture (64×2),
  ses dalgasıyla bükülen halka/kaburga dalgaları (`waves`), 3 katmanlı duvar tanecik parıltıları (`density`), kenar parlaması (`rim`, view-space
  normal/pozisyon varying'leri), uzak ışık sisi (`haze`), sarmal dönüş (`twist`), renk kayması `hue` (yalnız ses varken), çözünürlük (`quality`,
  piksel oranı). Silinen: Quantum.ts (kopya scratchpad'de), registry girdisi, J tuşu. Mod sayısı 38. Quantum'un küre izleme yolu/yatışı
  gerekmedi (Wormhole zaten gerçek geometri + banking). **Doğrulanmadı.**

- **Wormhole birleştirme düzeltmesi (kullanıcı: "öncekinden kötü, aralarda çizgi var, dairesel görünmesini engelliyor"):** çizgi kaynakları bulundu:
  (1) boyuna sarmal kaburgalar (`rib`) kaldırıldı — yalnız dairesel halkalar kaldı, kenarları yumuşak; (2) spektrum aynası `abs(2·fract−1)` sert
  katlanma çizgisi veriyordu → `0.5−0.5·cos(2π·u)`; (3) tanecik haresi hücre sınırında kesiliyordu (ızgara çizgisi) → yarıçap*2 ≤ 0.24 ile hücre
  İÇİNDE söner; (4) 8 sektör enerjisi sert basamaktı (eskiden de vardı) → komşu sektörler arası smoothstep. RADIAL_SEGS 26 → 72 (çokgen kesit →
  yuvarlak). Yeni katman varsayılanları kısıldı: waves 0.6, density 0.6, rim 0.5, haze 0.8 (eski görünüme yakın başlasın).

- **Wormhole "ilerledikçe bazı noktalarda bozulma" (kullanıcı):** teşhis: yol KAPALI HALKA; eklediğim desenler döngünün başı/sonunda eşleşmiyordu →
  her turda bir dikiş. Düzeltmeler (hepsi periyodik/dikişsiz): halka sıklıkları k·loopLen = 2π·N'e yuvarlandı; tanecik ızgarası döngü boyunca TAM
  SAYIDA hücre (`nS = floor(loopLen/cell)`, id.y mod nS, `s+offset` kayması kaldırıldı); sarmal dönüş döngüde TAM SAYI tur (`ua = vUv.y + vUv.x·N`,
  eskiden s·twist·0.01); palet `vUv.x·8` (tam sayı döngü) + çevrede `0.12·sin(2π·ua)` (eskiden ua·0.2 → boyuna renk çizgisi). Eski Wormhole
  desenleri (flow1/flow2/undulate) zaten tam sayı frekanslıydı. NOT: TubeGeometry/yol geometrisi değişmedi; bozulma geometrik ise (sıkışan dönüş,
  Frenet bükülmesi) ayrıca incelenmeli.

- **Wormhole renk (kullanıcı: "uzak bu kadar renkli olamaz, renkler müzik ritmine göre artsın"):** son aşamada `col = mix(gri, col, uColorAmt·mix(0.2,1,fade))`
  — uzak duvar/sis %80'e kadar renksiz; `colorAmt` = clamp(0.1 + 2.5·sLevel + 0.5·beatPulse) hızlı-yumuşak (damp 6) → sessizlikte gri, ritimle canlanır.
  Seçenek `colorful` ("Renk Canlılığı", 0-1.5, varsayılan 1; 0 = tamamen gri).

- **Wormhole "arada bir zıplama" (kullanıcı):** vuruşa/ham sese doğrudan bağlı ani değişimler yumuşatıldı: hız hedefi → `speedS` (damp 1.5), vuruş atılımı
  `sBeat` (damp 3) üzerinden, FOV `fovS` (damp 4), roll savrulması `kickS` (damp 2.5), duvar dalgalanma genliği (`uWave`) ve shader'daki
  `uBass/uBeat/uLevel` yumuşak değerler. `curve.arcLengthDivisions = 3000` (varsayılan 200: u→t eşlemesi parça parça doğrusal → hafif hız/teğet
  kademeleri). Doğrulanmadı.

- **Wormhole hep SAĞA gidiyor (kullanıcı sordu; tesadüf DEĞİL):** yol büyük bir daireydi (θ artan yönde, merkez kameranın hep SAĞINDA: fwd × up = −x) →
  sürekli tek yönlü viraj. Yeni yol: SEKİZ (∞) — x = A sinθ, z = B sin2θ, y = H cosθ (+ küçük harmonikler), A 70-90, B 48-66, H 14-20; lob başına
  dönüş yönü değişir (sağ/sol sırayla). Kesişme (θ=0,π) farklı yükseklikte (y = ±H ≥ 28 > tüp çapı 7.2) → tüp kendini kesmez. `flip` ile ayna.
  En sıkı eğrilik yarıçapı ≈ A/(4B²)⁻¹ ≈ 150+ ≫ 3.6. `BASE_RADIUS` kaldırıldı. Doğrulanmadı.

- **Wormhole ufku (kullanıcı sordu: "biraz daha bulanık ve karanlık olmaz mı?"):** evet → `fade = exp(−ahead·0.018·uDark)` (daha hızlı kararır),
  `detail = exp(−ahead·0.045·uBlur)`: uzakta flow deseni ortalamaya (0.55) karışır, halka/tanecik katmanı söner (aliasing/titreme de azalır).
  Seçenekler: `horizonDark` (varsayılan 1.5), `horizonBlur` (1.0); uzak ışık sisi varsayılanı 0.8 → 0.5. Gerçek (ekran-uzayı) bulanıklık değil, detay
  sönümlemesidir. Doğrulanmadı.

- **Wormhole ufuk + sarmal (kullanıcı: "çok koyu olmasın, sadece uzak bulanık olsun; daireler sarmala yakın olsa?"):** `horizonDark` varsayılanı 1.5 → 1.0
  (eski kararma), `horizonBlur` 1.0 → 1.3, haze 0.5 → 0.7. SARMAL: halka fazına `− 2π·ua·N` eklendi (N = `spiral`, TAM SAYI → çevrede dikişsiz);
  N=1 ≈ halkalar ~17° eğik (halka periyodu ≈7 br, çevre ≈22.6 br), ince halka k2≈3·k1 olduğu için kayması 3N. Seçenek `spiral` (0-3 tam sayı, varsayılan 1).

- **Wormhole parlaklık (kullanıcı: "çok fazla; uzay daha karanlık; ışık ritimle belirginleşsin"):** duvar parlaklığı `b = (0.05 + wall·(0.14 + e·bandAmt·0.9 + bass·0.4))·fade·bright·uLight`
  (eski taban 0.22+0.5 çok yüksekti); `uLight = clamp(0.3 + 2.4·sLevel + 1.0·sBeat, 0, 2)` hızlı-yumuşak (damp 8) → sessizlikte loş, seviye/vuruşla belirginleşir; dalga/tanecik
  katmanı ve uzak sis de `uLight` ile çarpılır. `brightness` varsayılanı 1 → 0.8. Doğrulanmadı.

- **Wormhole tanecikleri ışık çizgisi (kullanıcı: "uzay yolculuğundaki gibi çizgili olsun, çok belirgin olmasın"):** `sparkle` yeniden yazıldı: hücreler derinlik
  yönünde 3× uzun, her hücrede yuvarlak baş (yarıçap 0.06-0.12 hücre genişliği) + derinlikte UZAĞA (ilerleme noktasına doğru, +s) doğrusal sönen kuyruk
  (`Lw = rw·(1 + 5·streak·clamp(hız/20, 0.3, 1.5))`, ≤ 0.5 hücre uzunluğu → hücre içinde kalır, ızgara çizgisi yok). Ekranda ilerleme noktasından yayılan
  ışınlar. Yoğunluk eşikleri hücre büyüdüğü için 0.45/0.35/0.28 → 0.8/0.65/0.5. Seçenek `streak` ("Tanecik Çizgisi", 0-2, varsayılan 1; 0 ≈ nokta).

- **Plenoptic (6) gözden geçirildi (v0.3):** (1) **derinlik formülü hatası:** `depthFade = min(1,(FAR_Z − orb.z)/60)` z NEGATİF olduğu için hep 1 → küreler uzakta aniden beliriyor, yakında
  (z>2) büyük/parlakken aniden siliniyordu → mesafe `dist = CAM_Z(4) − z`; `farFade = clamp((130−dist)/60)`, `nearFade = clamp((dist−3)/10)`. (2) Yeni şekil **Parıltı**
  (varsayılan): `PlaneGeometry` + radyal gradyan dokusu, additive (bokeh; çokgen kenar yok; kamera −z'ye baktığı için düzlemler kameraya bakar); Küre/Küp korundu
  (dizin sırası değişmesin diye Parıltı sona, varsayılan 2). (3) Hız artık `speedS` (damp 1.5) ve yumuşak seviye/vuruş (`sLevel` damp 2.5, `sBeat` damp 3) — vuruşta ani sıçrama yok.
  (4) Seçenekler: size, spread (konum çarpanı), drift (salınım). Doğrulanmadı.

- **VU Göstergeleri (⇧V) gözden geçirildi (v0.3):** (1) SEVİYE iğnesi neredeyse kıpırdamıyordu (doğrusal RMS 0.05-0.3) → dB ölçeği `clamp((20·log10(rms)+34)/34)`;
  bas/orta/tiz zaten dB-eşlemeli analizör değeri. (2) İğne yayı ζ≈0.3 (~%37 aşma) idi → ζ=0.65 (`damping = 2·0.65·√(220·stiff)`), gerçek VU ~%10. (3) Dar ekranda 2×2 yerleşim
  (`layout` Otomatik/1×4/2×2; otomatik: w/h < 1.3 → 2×2). (4) Kırmızı bölge yayı (8-10), ölçek sayıları (0-10), tepe tutma işareti (0.9 sn bekler, 0.22/sn düşer), arka ışık
  (seviyeyle aydınlanan radyal gradyan, `lamp`), iğne gölgesi, cam parlaması. (5) Seçenekler: layout, scale, gain, stiff, lamp, peak, numbers, labels, led. Doğrulanmadı.

- **Ambience (7) gözden geçirildi (v0.3):** (1) 5 büyük perde dolgusunda `shadowBlur 24` her karede çok pahalıydı → gölge kaldırıldı; parlama tepe ışık çizgisinde (`strokeGlow`, `crest`).
  (2) Palet kayması `(lt + hue) % 1` her ~50 sn'de başa sarıp renk atlıyordu → ping-pong. (3) Ham bas/beat dalgaları titretiyordu → yumuşatılmış `sBass/sMid/sTreble/sLevel/sBeat`
  (damp 3-5); her katman kendi bandına tepki verir (katman % 3: bas/orta/tiz). (4) Yeni seçenekler: flow (dalga sıklığı), base (yükseklik konumu), fill (dolgu opaklığı), crest. Doğrulanmadı.

- **Fraktal (Z) müzik tepkisi (kullanıcı: "ilk 10 sn sonrası neredeyse etkileşim yok"):** teşhis: Julia açısı θ = `uTime·0.12` (müzikten bağımsız evrim), müzik yalnız c'ye küçük ham sapma
  ekliyordu (bas·0.06, titrek), renk kayması zaman tabanlıydı, palet durakları `%1` ile sarıp atlıyordu. Düzeltme: θ ve hue **müzikle birikir** (`θ += dt·(0.02 + (sSlow·0.5 + sBass·0.2)·react)·morph`,
  `hue += dt·(0.004 + sSlow·0.12·react)`) → ses yükselince evrim hızlanır, sessizlikte durur; c'ye bas/orta/vuruş itmesi (yumuşatılmış, ×react); zoom seviye+vuruşla nefes alır (`uPulse`);
  spektrum açıyla (64×1 DataTexture, `0.5−0.5·cos(atan)` pürüzsüz ayna) parlaklığı/iç rengi modüle eder; palet ping-pong. Seçenekler: react (1.3), spectrum. Doğrulanmadı.

- **Fraktal (fractal) SİLİNDİ → Kum Levhası (`chladni`, tuş Z, canvas2d) (kullanıcı: "kum tanelerini levhaya koymuşlar, müzik ritmine göre şekiller çıkıyordu, bunun gibi bir şey yapalım"):**
  Chladni figürleri. Levha modu u = cos(nπx̃)cos(mπỹ) − cos(mπx̃)cos(nπỹ) (x̃=(x+1)/2; u=0 düğüm çizgileri). Taneler (3000-20000, 560² ImageData → büyütme) iki etkiyle
  hareket eder: u²'nin eğimi boyunca aşağı kayma (düğüme yerleşme, `settle`) + titreşim×(|u|+0.04) ile orantılı rastgele sıçrama. Müzik: n = (2+8·centroid)·complexity (log frekans
  enerji merkezi, sessizlikte korunur), m = n·(0.45+0.5·trebleShare)+1.2 (|n−m|≥1), ikisi damp 1.4 ile yumuşakça kayar → desen morflanır, taneler takip eder; titreşim amp =
  (0.12 + 2.2·sLevel + 1.4·sBeat)·vibration → vuruşta taneler sıçrar, sonra düğümlerde yeniden toplanır. Levha ışıması: 56² |u|·amp gölge dokusu. Seçenekler: plate (kare/yuvarlak kırpma),
  colorMode (palet LUT/krem kum), count, grain, vibration, settle, complexity, shading. Silinen Fractal.ts yedeği scratchpad'de. **Doğrulanmadı.**

- **Kum Levhası: SÜREKLİ kum yağışı (kullanıcı: "kum her yerine ve sürekli gelsin, üstten akar gibi"; önceki periyodik meme animasyonu kaldırıldı):** `updateRain`: her saniye `count·0.08·rainRate`
  tane levhanın HER yerinden (kare veya daire içinde rastgele) yağar; aktif tane sayısı `active` 0.4·count ile başlar, yağışla üst sınıra çıkar, sınırdayken rastgele bir tane
  alınıp yeniden yağdırılır (toplam sabit, eski kum yenilenir). Düşen tane (`gh` 0.6-1 → 0, 1.8/sn): levha fiziği yok; yukarıdan bakışta yükseklik = büyüklük/saydamlık;
  yere varınca küçük saçılma. Yağış müzikten bağımsız (sessizlikte de akar). Seçenekler: `rain` (aç/kapat), `rainRate`. Doğrulanmadı.

- **Kum Levhası sessizlik davranışı (kullanıcı: "levha temizlenmez, her yeri kum olması gerekir; bu yüzden kum yağmuru istemiştim"):** İKİ deneme: (1) "sessizlikte desen korunur"
  → ekran donmuş göründü; (2) "sessizlikte kum temizlenir" → YANLIŞ (kullanıcı reddetti). KURAL: levha ASLA boşalmaz, hep kumla kaplı. Sessizlikte (`silentT` > 1.0 sn; sLevel<0.012 sayar, >0.02 sıfırlar)
  titreşim yok → kum düğüme kaymaz (`eta ×= 0`) ve yağış ×4 (`rainRate·4`) ile eski kumu hızla yeniler → eski şekil ~birkaç sn'de erir, kum her yere EŞİT yayılır; müzik gelince titreşim + düğüme yerleşme
  geri döner. `drain` seçeneği KALDIRILDI. Doğrulanmadı.

- **Kum yağmurunun belirginliği (kullanıcı: "azalt ama levhaya kum eklemesine dokunma"):** yalnız ÇİZİM değişti — düşen tane alfası `(0.05 + 0.3·(1−h))·rainVis` (eskiden 0.3+0.65·(1−h)),
  boyu `1 + h·1.0·min(1,rainVis)` (eskiden 1+h·2.4), rengi daha sönük kum tonu. Yağış/ekleme mekaniği (hız, tane sayısı, sessizlik kuralı) AYNEN. Seçenek `rainVis`
  ("Yağmurun Belirginliği", 0-1.5, varsayılan 0.4).

- **Kum Levhası: sessizlikte eski şekil hâlâ belirgin (kullanıcı):** sebepler: (1) yağış eski kumu yalnız ÜSTEL yavaş yeniliyordu; (2) titreşim ışıması `|u|·amp` sessizlikte de
  taban `0.12` ile çiziliyordu. Düzeltme: sessizlikte her tane `p = 1 − e^(−2dt)` olasılıkla (yarı ömür ≈0.35 sn) rastgele yeni konuma konur (levha DOLU kalır, ~1.5 sn'de eşit yayılır);
  `act` (0 sessiz…1 titreşiyor, damp 5) hem `amp`'i hem levha ışımasını çarpar → sessizlikte ışıma ve sıçrama söner. Doğrulanmadı.

- **Kum Levhası: farklı müzikte hep aynı şekil (kullanıcı, İKİ kez):** (1) "enerji merkezi" modu hep benzer çıkardı; (2) "iki baskın tepe + %25 histerezis" denemesi de başarısız: pembe-gürültü
  düzeltmesinden sonra tepeler birbirine çok yakın kaldığından geçiş HİÇ tetiklenmiyor, mod başlangıçta takılı kalıyordu. ÇÖZÜM (artık spektral eşiğe bağlı değil): **ritimle mod dizisi** —
  16 estetik (n,m) çifti (`MODE_PAIRS`); vuruşlar sayılır, her `rhythm` vuruşta (varsayılan 8; vuruş yoksa 12 sn'de) `block++`; çift = `MODE_PAIRS[(block·5 + floor(t1·16)) % 16]`, `t1` = blok başında kilitlenen
  baskın frekans tepesi → farklı şarkı farklı dizi. Ayrıca alan işareti `u = cos·cos − sg·cos·cos`, `sg` bloklar arasında +1/−1 (yumuşak): −1'de köşegenler düğüm değil (farklı simetri; eskiden köşegenler HER ZAMAN düğümdü
  → tüm figürler benzer görünürdü). n,m damp 1.4 ile kayar. Seçenek `rhythm`. Doğrulanmadı.

- **Kum Levhası: müzik sakinleşince yağış/erime çok geç (kullanıcı):** eski zincir: sLevel damp 3 → `silentT > 1.0` sn bekleme → dağılma (toplam ~3-4 sn) ve yalnız TAM sessizlikte devreye giriyordu.
  Yeni: `sFast` (damp 12) → `calm = 1 − smoothstep(0.012, 0.06, sFast)` SÜREKLİ 0..1, bekleme yok; yağış ×(1 + 3·calm), eski kum yeniden konumlanma olasılığı `1−e^(−3·dt·calm)` (tam sakinlikte yarı ömür ≈0.23 sn),
  düğüme kayma ×(1−calm), `act` (damp 8) ışımayı/sıçramayı ölçekler. Sakin müzik bölümlerinde de kısmen tepki verir. Doğrulanmadı.

- **Kum Levhası: aynı şarkıda ton/geçiş farkı hissedilmiyor (kullanıcı):** şekil yalnız vuruş bloklarında değişiyor, blok başında kilitleniyordu. Yeni (3 katman): (1) ritim blokları (`rhythm`) sürer;
  (2) CANLI TON: baskın tepe `tp` (parabolik inceltilmiş, damp 4) ve karesel ağırlıklı parlaklık `tb` blok başı değerlerinden saptıkça `n += 14·(tp − t1)` (±4) ve `m += 12·(tb − tb0)` (±3) SÜREKLİ kayar → nota/tını
  değişince şekil morflanır; (3) GEÇİŞ: `|tb − tbLong| > 0.06` (tbLong damp 0.25 ≈ 4 sn ortalama) ve blok ≥1.8 sn ise blok hemen ilerler (bölüm/nakarat/enstrüman geçişi). n,m damp 1.8. Doğrulanmadı.

- **Kum Levhası TAM EKRAN (kullanıcı):** `plate` seçeneği ['Tam Ekran' (varsayılan), 'Kare', 'Yuvarlak']. Alan koordinatları FİZİKSEL ölçülür: kısa kenar [−1,1], uzun kenar en-boy oranı kadar uzar
  (`ax = w/short`, `ay = h/short`) → hücreler kare kalır, desen uzun kenarda yalnızca daha çok tekrar eder (germe yok). Taneler normalize [−1,1]² tutulur (yeniden boyutlanmada bozulmaz); hareket
  fiziksel birimde hesaplanıp ÷ax/÷ay ile normalize edilir. Kum ve ışıma tamponları `ensureBuffers` ile en-boy oranına göre (RES=640 × oran) yeniden kurulur. Tam ekranda çerçeve çizilmez.
  Eski kayıtlı `plate` değerleri bir kayar (0 → Tam Ekran, 1 → Kare, 2 → Yuvarlak). Doğrulanmadı.

- **Varsayılanlar (kullanıcı: "hassasiyet ve yumuşatmayı azalt, kum miktarı ve yoğunluğu biraz arttır"):** GENEL ses ayarı varsayılanları (`DEFAULT_SETTINGS`): hassasiyet 1.2 → 1.0, yumuşatma 0.8 → 0.6
  (tüm modları etkiler; kayıtlı eski değerler değişmez — kullanıcı paneldeki "Ses Motoru" kaydırıcılarından veya "Tüm Ayarları Sıfırla" ile alır). Kum Levhası: Kum Miktarı 9000 → 12000, Yağış Yoğunluğu 1 → 1.4.

- **G-Force (G) gözden geçirildi (v0.3):** (1) akış zamanı/hız ham sese bağlıydı (vuruşta sıçrama) → yumuşatılmış `sBass/sMid/sTreble/sLevel/sBeat`, `flowTime += dt·(0.18 + 1.4·sMid + 0.5·sBass)`; (2) nokta+solma
  hızlı giderken kesik iz bırakıyordu → varsayılan **Çizgi** stili (önceki konum→şimdiki, `px/py`); (3) alan bükümlü (`warp`: koordinatlar kendi sinüsleriyle çarpıtılır) ve **girdap** (`swirl`, ekranda gezinen merkez,
  şiddeti basla; teğet vektör eklenir); (4) **simetri** (`mirror`: Yok/Yatay/4 Yön — çizim kopyaları); (5) renk LUT (64) + ping-pong ile sesle biriken `hue` kayması (eskiden parçacık başına sampleGradient ve sabit renk).
  Seçenekler: style, mirror, swirl, warp (+ scale, size, life). Doğrulanmadı.

- **Kaleydoskop (K) YENİDEN YAZILDI (kullanıcı: "ilgi çekici değil, çok sıradan; güzel bir güncelleme getiremiyorsan sil"):** canvas2d → **webgl/QuadShader** (tek geçiş). Mandala: önce `segments` aynalı
  dilime POLAR KATLAMA (`a = abs(mod(a, seg) − seg/2)`), sonra `detail` (3-8) yineleme KIFS: `z = rot(...)·(abs(z) − kaydırma)·1.32`; her katmanda katlama izi (halka `|‖z‖ − r|` + çapraz çizgi) `0.01/(d+0.012)`
  parlak ışık hattı; hat rengi palet (`pal(fi·0.19 + hue + r0·0.35)`), parlaklığı katmanın bandına (i%3: bas/orta/tiz) ve ÇAPSAL spektruma (64×1 DataTexture, r0·0.6). Işık seviye+vuruşla
  belirginleşir; akış/dönüş/renk/nefes yumuşatılmış sesle birikir (sessizlikte yavaşlar). Seçenekler: segments, detail, zoom, bright (+rotationSpeed). Eski canvas sürümü scratchpad'de (Kaleidoscope_old.ts).
  Eski seçenekler (mirror, sources, size, trail, glow) kaldırıldı. **Doğrulanmadı — beğenilmezse silinecek.**

- **Kaleydoskop genişletildi (kullanıcı: "güzel olmuş, daha fazla ne yapabilirsin"; dört yön seçildi):** (1) ŞEKİL `shape`: Halka+Çizgi / Yıldız / Altıgen (sdHex) / Kristal / Karışık (katman başına dönüşümlü);
  (2) DERİNLİK: `depth` — ileri katmanlar daha geniş ışıma + sönük, merkez çekirdeği; SONSUZ ZOOM `zoomFlow` — iki zoom fazının çapraz geçişi (`mix(mandala(zoom^-ph), mandala(zoom^(1−ph)), smoothstep(ph))`, faz sarınca dikişsiz; 2× maliyet, 0 = kapalı);
  (3) MÜZİKLE GEÇİŞ `auto`/`rhythm`: her N vuruşta (veya tını `|tb−tbLong|>0.07`, ya da 24 sn) KARARTMA→segment sayısı (`SEG_LIST`) + katlama tohumu (`uSeed`, damp 1.2) değişimi→aydınlanma (0.3+0.5 sn);
  (4) RENK/IŞIK: `colorMode` (katman/yarıçap/karışık), `bloom` (geniş hale + vuruşta kenar parlaması), `fringe` (R/G/B palette ±δ okunur → ince renk ayrışması), `quality` piksel oranı. Doğrulanmadı.

- **Kaynak seçme ekranı yenilendi (kullanıcı: "ilgi çekici değil, bir el at"):** `ui/PickerBackdrop.tsx` — tek 2D tuvalde canlı arka plan (7 süzülen ışık küresi `lighter`, alttan akan 3 dalga katmanı, 70 yükselen toz;
  `prefers-reduced-motion` açıksa tek kare). `SourcePicker.tsx`: hero (CSS ekolayzır çubukları + akan gradyan başlık + "Müziği görün" alt başlığı), 2×2 (mobilde 1 sütun) KARTLAR — her birinde SVG ikon
  (sekme/sistem/dosya/mikrofon), başlık, açıklama, ipucu, ok; "Önerilen" rozeti (Tarayıcı Sekmesi); hover'da kayma+parlama+ikon dönüşü; sürükle-bırak için kesikli düğme (tıklayınca dosya seçer) + sürüklerken tam ekran
  "Müzik dosyasını bırakın" kaplaması; altta kısayol ipuçları (/, H, F). Kısayol tuşlarıyla kart seçme EKLENMEDİ (App'in 1-7 mod tuşlarıyla çakışırdı). CSS: `.picker*`, `.card*`, `.eq`. Doğrulanmadı.

- **Kaleydoskop: katmanlar frekans aralığına bağlı (kullanıcı önerisi):** eskiden katmanlar sırayla bas/orta/tiz (i%3 → 8 katmanda sıra karışık). Yeni `layerBands` (varsayılan "Frekans Aralığı"): katman i spektrumun
  [i/N, (i+1)/N] log aralığına bağlı (3 örnek ortalaması, `clamp((e−0.15)·1.6, 0, 1.2)`); katman 0 en düşük frekans, son katman en yüksek. Katmanın parlaklığı (`0.25 + 1.9·band + 0.25·spec`), ışıma genişliği (`0.8 + 0.8·band`)
  ve dönüşü (`+0.35·band`) kendi aralığına tepki verir. Spektrum dokusu artık bin başına yumuşatılmış (yükselme damp 14, düşme damp 5). Eski mod ("Bas / Orta / Tiz") seçenekle korunur. Doğrulanmadı.

- **Plazma (P) GPU'ya taşındı ve müzik desene işlendi (v0.3):** eski sürüm CPU'da 8× düşük çözünürlüktü ve müzik yalnız zaman hızı + parlaklığı değiştiriyordu (desen sese kayıtsızdı). Yeni: canvas2d → webgl/QuadShader,
  tam çözünürlük. Alan 4 sinüs toplamı; stiller `style`: Klasik (hafif büküm), Sıvı (4 kat alan bükümü — varsayılan), Girdap (yarıçapla dönen koordinat). MÜZİK desene işler: bas büküm şiddetini (`w = warp·(0.55 + 1.5·bass·react)`),
  orta desen sıklığını (`scale·(1 + 0.35·mid)`), tiz ince hızlı dalgacıkları, çapsal spektrum halkaları (`(spec − 0.25)·0.45·sin(9r − 1.6t)`, merkez düşük frekans); ritim parlaklığı ve renk akışını (`hue += dt·(0.01 + 0.1·sLevel)`) sürer.
  Sesler yumuşatılmış (damp 3-6), spektrum bin başına yumuşak. Seçenekler: style, react, warp, scale, bands, contrast, bright. Eski canvas sürümü scratchpad'de (Plasma_old.ts). Doğrulanmadı.

- **Plazma düzeltmesi (kullanıcı: "kötü olmuş, eskisi gibi farklı görünüm vermiyor, hep aynı desen"):** sebepler: varsayılan stil "Sıvı" (sürekli alan bükümü → hep benzer yumuşak bulut), desen frekansları SABİT (yalnız aynı şekilde kayıyordu), akış eskisinden yavaş.
  Düzeltme: varsayılan **Klasik**, `warp` 1 → 0.4, akış eski hız `0.5 + 1.8·sLevel + 0.8·sBeat`; desen YAPISI 8 preset (`PRESETS`: frekans çarpanları `uP` (x/y/çapraz/radyal), kafes terimi `uE·2·sin(0.35·xy + 0.6t)`, alan dönüşü `uRotF`) arasında müzikle değişir —
  her `rhythm` vuruşta / tını değişiminde (`|tb−tbLong|>0.07`) / 20 sn'de, preset = `(block·3 + floor(tb·8)) % 8` (şarkıya özgü), geçiş damp 0.9. Seçenekler: auto, rhythm. Doğrulanmadı.

- **Rotozoom (0) yeniden yazıldı (kullanıcı: "bir görsel olmadıktan sonra karelere bakmanın ne anlamı var"):** canvas2d dama → webgl/QuadShader. Dönen+yakınlaşan sonsuz zemin ama desen artık: Truchet yayları (varsayılan), Petek (hex ızgara),
  Voronoi (salınan noktalar, kenar ışıması), Moiré (3 hareketli merkezden halka girişimi), Dama. İsteğe bağlı PERSPEKTİF (mode-7 eğik düzlem: ufuk 0.9, `z = 1/(0.9 − y)`, derinlik sisi). MÜZİK: her hücreye rastgele bir
  spektrum bini atanır (`cellEnergy(id)` = `texture(uSpec, hash(id))`) → o frekans çalınca hücre/yay ışır ("ekolayzır mozaiği"); bas zoom'u (`1 + 0.25·bass`), seviye dönüşü/akışı, vuruş parlaklığı; hepsi yumuşatılmış.
  Zoom: `2.4·zoom·exp(0.55·sin(phase))` (oransal yakınlaşma salınımı). Seçenekler: pattern, persp, react, zoom, detail, scroll, glowLine, bright (+rotationSpeed). Eski canvas sürümü scratchpad'de (Rotozoom_old.ts). Doğrulanmadı — beğenilmezse silinecek.

- **Neon Lambalar (Shift+N) SİLİNDİ (kullanıcı: "olmamış, sil gitsin"):** üç denemede (rastgele hücre ızgarası + sonsuz zoom → sabit çizgi/halka/bar sahnesi → LED panel duvarı + neon tabela + ritimle beliren neon yazılar) istenen görünüm
  yakalanamadı. Kaynak scratchpad'de (Neon_v3.ts). Tuş `⇧N` yeniden serbest. Mod sayısı 38'e döndü; README güncel. Fikir tekrar istenirse: kullanıcı tarifi = ritme göre yanıp sönen neon LED alanları/floresanlar, korku evi titremesi, cyberpunk, neon yazılar (müzik klipleri gibi), kamera yaklaş/uzaklaş.

- **Girdap (D) GPU'ya taşındı ve yeniden tasarlandı (kullanıcı: "çok kötü bir durumda"):** eski sürüm 5 kol × ~150 parça = ~900 ayrı çizgi + her birinde ışıma çiziyordu (kasma), ham ses kalınlığı/rengi titretiyordu, kollar sese göre sıçrıyordu.
  Yeni: canvas2d → webgl/QuadShader tek geçiş. Stiller: **Spektrum** (log spiral kollar `s = a/τ·kol + burgu·ln r − rot`; kol kalınlığı/parlaklığı yarıçapa karşılık gelen frekansla (merkez bas, dış tiz); ince karşı kollar; merkez ışığı),
  **Hipnoz** (zıt yönlerde dönen iki kalın spiral, analitik kenar yumuşatma `uPxH`, bant kalınlığı spektrumla nefes alır, ortada delik + vuruş halkası), **Çevrinti** (YENİ: lavabo girdabı — `depth = 1/(r+0.12)`, kollar derinliğe bükülür,
  halkalar merkeze akar, kol başına rastgele frekans, karanlık delik + bas ile parlayan kenar). Ses yumuşatılmış (bas/orta damp 4, seviye 3, vuruş 5; spektrum bin başına yükselme 14/düşme 5); dönüş `0.12 + 0.5·seviye` ve akış seviyeyle birikir.
  Seçenekler: style, arms (2–10), twist, react, halo, direction, bright (+rotationSpeed). Eski canvas sürümü scratchpad'de (Vortex_old.ts). Doğrulanmadı.

- **Girdap düzeltmesi (kullanıcı: "içine çekilir hissi vermiyor"):** teşhis: (1) Spektrum'da kollar varsayılan yönde merkezden DIŞARI kayıyordu (itme, çekme değil) ve dönüş çok yavaştı; (2) hiçbir şey merkeze radyal akmıyordu, yalnız dönüş vardı; (3) merkez delik değil sıradan ışıktı;
  (4) BUG: `hash1(floor(s))` açı sınırında (a=±π) kol sayısı kadar atlıyordu → solda renk dikişi (`mod(floor(s), kol)` ile düzeltildi). Yeni: kollar lavabo şeklinde bükülür (`aw = a + burgu·0.9/(r+0.15)`, merkezde sıkışır), dönüş yönü içeri;
  `streams()` log-kutupsal hücre ızgarası: parçacıklar merkeze akar (`v = −3·ln r − flow`), yaklaştıkça küçülür (perspektif), uzar (`ls = 0.28 + 0.7·e^(−2.2r)` hızlanma hissi), parlar ve beyaza döner, her biri rastgele frekansa bağlı (hash açı sınırında `mod` ile periyodik);
  `blackHole()`: karanlık çekirdek + basla nabzı atan parlak kenar + hale (Spektrum ve Çevrinti'de). Yeni seçenekler: `pull` Çekim Hızı (0.3–3, varsayılan 1.2; dönüş ve akış hızını çarpar), `hole` Delik Boyutu, `direction` artık Akış Yönü (İçeri Çek / Dışarı Saç; ikisi de dönüş+akışı ters çevirir).
  Hipnoz klasik kaldı (zıt dönen spiraller; yön = çekme/itme). Doğrulanmadı.

- **Girdap 3. düzeltme (kullanıcı: "hiç olmadı, kamera için çekilir gibi olacaktı; eklediğin lekeleri sil"):** parçacık/leke alanı (`streams()`) TAMAMEN SİLİNDİ. İçeri çekilme artık KAMERA hareketi: desen `log(r) − Z` üzerinde tanımlı, `Z` üstel artar (e-katı/sn,
  `0.3 + 0.9·seviye + 0.5·bas`, ×`pull`) → kollar ve halkalar merkezden doğup büyür, ekran kenarından çıkar. Log-spiral kollar (`s = (a−rot)/τ·kol + 1.5·burgu·(ln r − Z)`) ve log aralıklı halkalar (`RINGS=1.3`, vuruşta parlar) kendine benzer → dikişsiz sonsuz zoom.
  Derinlik: merkez uzak/karanlık, yakın (büyük r) parlak, kenar sönük. Hipnoz da log-spiral (iki zıt sarım) + zoom; Çevrinti perspektifli tünel (1/r), halkalar merkezden doğar. Dönüş yavaş, yalnız kamera yuvarlanması (`rot` 0.06+0.25·seviye).
  Ortada kara delik korundu. `direction` "Dışarı Saç" = kamera geri çekilir. Doğrulanmadı.

- **Girdap 4. düzeltme (kullanıcı: "ortadaki siyah daireyi sil, tamamen içine doğru ilerlesin; yandaki çizgiler hâlâ ilerliyormuş gibi hissettirmiyor"):** kara delik KALDIRILDI (`blackHole` → `centerLight`: delik yok, her şey merkezdeki basla nabız atan ışığa birleşir; `hole` seçeneği silindi).
  Teşhis: kollar güçlü bükülü olduğu için zoom DÖNÜŞ gibi okunuyordu, çizgiler seyrek ve yavaştı. Çözüm: Spektrum = perspektif ızgara — hafif bükülmüş kollar (`burgu·0.5`), sık log halkalar (`RINGS` 1.3 → 2.2, vuruşta parlar),
  aralarında frekansla yanan hücreler (kol başına 2 dilim × halka, hash açıda periyodik → dikiş yok); hücreler/çizgiler merkezden doğup büyüdüğü için ilerleme net okunur; kenar yumuşatma analitik (`uPxH`); merkezde sis. Hız ~2×:
  `flow += (0.7 + 1.2·seviye + 0.6·bas)·pull`. Hipnoz ve Çevrinti'den de delik çıkarıldı. Doğrulanmadı.

- **Girdap: hücreler KALDIRILDI (kullanıcı: "eklediğin hücreler işin özünü bozmuş"):** Spektrum yalnız hafif bükülmüş kollar + sık log halkalar (vuruşta parlar); frekansla yanan hücre katmanı silindi. Delik yok, merkez ışığı ve ~2× hız korundu. Doğrulanmadı.

- **Girdap: kollar ve halkalar tutarlı sarmal dalış (kullanıcı önerisi: "kolları ile gelen halkayı tutarlı bir şekilde döndürerek yakınlaştır"):** eskiden kollar bağımsız `rot` (kamera yuvarlanması) ile dönüyor, halkalar yalnız zoom yapıyordu → iki ayrı hareket. Şimdi `uRot` YOK; kolların dönüşü zoom parametresine (`Z = uFlow`) bağlı:
  `s = a/τ·kol + burgu·(ln r − Z) − spin·Z` (halkalar `ln r − Z` ile aynı Z'de büyür). Yani her e-katı zoom'da kollar sabit miktar döner (burgu + spin) — dönüş ile yakınlaşma birbirinden ayrılamaz; Hipnoz'da zıt sarım B ters döner; Çevrinti'de kollar `spin·Z`.
  Yeni seçenek `spin` "Dönüş (zoom ile birlikte)" 0–2, varsayılan 0.3 (0 = yalnız burgu kaynaklı dönüş); `direction` ikisini birlikte ters çevirir (Z işareti). Global Rotasyon Hızı bu moddan çıkarıldı. Doğrulanmadı.

- **Girdap: ritim kolların yönüne/şekline etki etmesin (kullanıcı: "yalnız hızda ufak değişiklik ve kalınlık"):** BUG: burgu `tw` bas ile çarpılıyordu (`1 + 0.2·bas`); `s = … + tw·(ln r − Z)` içinde Z büyüdükçe `tw·Z` terimi her vuruşta kolları kaydırıp yönünü/şeklini oynatıyordu.
  `tw` artık sabit (Spektrum `0.5·burgu`, Hipnoz `1.2·burgu`). Ritim yalnız: (1) kalınlık (frekans enerjisi `er`, orta), (2) hız: `flow += (0.9 + 0.35·seviye + 0.15·bas)·pull` (eski 0.7 + 1.2·seviye + 0.6·bas; salınım ~%25 oranında), (3) halka parlaklığı (vuruş). Doğrulanmadı.

- **Girdap → HİPNOZ'a indirgendi (kullanıcı: "sadece hipnoz özelliği kalsın, sadeleştirme ve güncelleme yap"):** 5 denemede "içine çekilme" hissi yakalanamadı (Solucan Deliği zaten bunu yapıyor); Spektrum ve Çevrinti stilleri, kamera dalışı, halkalar, kara delik silindi.
  Mod adı "Hipnoz" (id `vortex`, tuş ⇧D, dosya Vortex.ts korundu → kayıtlı favoriler/ayar anahtarı bozulmasın). Yeniden yazıldı: zıt yönlerde dönen iki kalın ARŞİMET spirali (`s = (a−φ)/τ·kol ∓ r·k`; faz kol sayısının tam katı → dikişsiz), analitik kenar yumuşatma (`uPxH`),
  B spirali ters sarılı ve ters döner (0.75×) — ikisi aynı yönde içe/dışa akıyormuş gibi görünür. Ritim YALNIZ: kalınlık (yarıçapa karşılık gelen frekans: merkez bas, dış tiz), hızda küçük değişim (`0.5 + 0.25·seviye + 0.1·bas`) ve vuruş halkası; yön/şekil değişmez.
  Delik yok (merkez ışığı). Seçenekler (7, eskiden 10): arms (1–8, varsayılan 3), tight (Sıkılık), thick (Kalınlık), speed, direction (İçe/Dışa), react, bright. Doğrulanmadı.

- **Hipnoz: tek spiral (kullanıcı: "iki farklı katman gibi gözükmesi hipnoz etkisi yaşatmıyor"):** ikinci (ters dönen) spiral KALDIRILDI. Ekran tek Arşimet spiraliyle parlak ve koyu (`pal·0.2`) bantlara bölünür, bantlar sürekli döner; kalınlık = parlak/koyu oranı
  (`duty = 0.5 + (kalınlık−1)·0.3 + 0.1·(er−0.3)`, 0.2–0.8). `uRotB` ve ters dönüş silindi. Ritim yine yalnız kalınlık, küçük hız değişimi ve vuruş halkası. Doğrulanmadı.

- **Hipnoz: yön + derinlik (kullanıcı: "dönüş yönü de yanlış gibi, dalıp gidemiyorum"):** hesaba göre eski varsayılan (`dir=+1`) bantları ışın boyunca merkeze taşıyordu, ama kullanıcı ekranda tersini algıladı → varsayılan TERSİNE çevrildi
  (`dir = Yön seçeneği == "Dışa" ? 1 : −1`; "İçe Doğru" artık eski işaretin tersi). Yön seçeneği hâlâ ayarlanabilir; yine yanlışsa seçeneği çevirmek yeterli. İkinci neden: bantlar her yerde eşit kalınlıktaydı (Arşimet) → derinlik/perspektif yok, düz dönüş gibi okunuyor.
  Yeni `depth` (Derinlik, 0–1, varsayılan 0.4): radyal faz `(1−D)·r + D·0.55·ln(r+0.02)` → bantlar merkeze doğru incelir (perspektif tünel); kenar yumuşatma türevi buna uyarlandı. 0 = eski eşit aralıklı spiral. Doğrulanmadı.

- **Ateş (E) GPU'ya taşındı, gerçekçi alev (v0.3):** eski sürüm CPU'da çeyrek çözünürlükte Doom-ateşi hücresel simülasyonuydu (bloklu görünüm, her piksele rastgele gürültü, ham spektrum doğrudan sütunlara, palet renkleri ateş gibi durmuyordu).
  Yeni: canvas2d → webgl/QuadShader, tam çözünürlük. Alev = yukarı kayan, alanı kendisiyle bükülmüş fbm gürültüsü (4 oktav); sütun yüksekliği = o sütundaki yumuşatılmış spektrum (hızlı yükselir damp 20, yavaş söner damp 4; texture doğrusal süzme → sütunlar arası pürüzsüz),
  vuruşta kabarır (`+0.1·beat`), seviye yükselme hızını biraz değiştirir. Kıvılcım: 2 katman hücre bazlı, alev yüksekliğine kadar yükselip solar. Renk: Ateş (siyah→kızıl→turuncu→sarı→beyaz), Mavi Alev, Palet. Yerleşim: simetrik (bas ortada, eskiden kenarda) ya da soldan sağa.
  Seçenekler: colors, layout, flame, flicker (Dalgalanma), sparks, react, bright (eski `mirror` kalktı → layout). Eski canvas sürümü scratchpad'de (Fire_old.ts). Doğrulanmadı.

- **Ateş: müzik yokken sönük (kullanıcı: "müzik olmadığında hiç yanmıyor gibi olmalı"):** sessizlikte yine yanıyordu: sütun yüksekliğinde 0.12 taban, taban kızarması (`+0.4`), sıcak ışık sabit terimi. Düzeltme: yükseklik tabansız (`0.74·enerji·alev + 0.1·vuruş + 0.06·seviye`),
  `lit = smoothstep(0, 0.07, yükseklik)` kapısı sıcaklığı ve taban ışığını çarpar (gürültü terimi de kapalıyken sıfır), enerji eşiği 0.08 → 0.1. Alev yükseklik sıfıra inince tamamen kaybolur (sönme ~1 sn: damp 4). Doğrulanmadı.

- **Ateş: sert/sivri yükselişler (kullanıcı: "çok keskin yükselişler yapan yerler var"):** sebep: her sütun kendi frekans binine bağlıydı, komşular bağımsızdı (tek bin tepesi ince bir alev iğnesi çıkarıyordu) + hızlı yükselme (damp 20) + sıkıştırmasız tepe;
  Simetrik yerleşimde merkezde `abs()` V-şekilli sivri tepe vardı. Düzeltme: (1) uzayda 7 noktalı yumuşatma `[1,2,3,4,3,2,1]` (JS, doku öncesi); (2) zamanda yükselme damp 20 → 9 (sönme 4); (3) shader'da yumuşak sıkıştırma `1.25·e/(1+0.4·e)`;
  (4) merkezde `d^1.5` eşlemesi (türev sıfır → düz tepe). Doğrulanmadı.

- **Ateş: rüzgar/esinti + odak merkez (kullanıcı: "biraz rüzgar esinti hissi ver; hangi sütun daha fazla tepeye çıkıyorsa onu merkez noktası yapalım, sürekli değişsin"):**
  RÜZGAR: `rüzgar = (0.6·sin(0.37t) + 0.4·sin(0.91t + 1.3))·seçenek·(0.7 + 0.5·seviye)` (yavaş değişen esinti, gerçek zamanla); alevler yükseldikçe yana yatar: piksel (x,y) tabandaki sütun `x_b = x + (x−0.5)·0.5·eğilme·y^1.3 − rüzgar·0.22·y^1.3`;
  yükseklik, enerji ve gürültü `x_b` ile örneklenir (alev dilleri de yatar); kıvılcımlar rüzgârla savrulur. MERKEZE EĞİLME: yan alevler merkeze doğru bükülür (konveksiyon; çadır şekli). ODAK: yeni Yerleşim 0 "Odaklı" (varsayılan) — ekran ortası = her sütunun yavaş ortalamasının
  (damp 0.4) en çok ÜSTÜNE çıkan sütun (`prom = blur − 0.9·avg`, eşik 0.08), yanları frekans komşuları (pencere 0.6, sınırda yansıma); merkez hedefi müzik varken güncellenir ve damp 1.3 ile süzülür (sıçramaz, sürekli değişir).
  Yerleşim 1 simetrik (bas ortada), 2 soldan sağa korundu. Yeni seçenekler: wind (Rüzgar), lean (Merkeze Eğilme). Not: simetrik yerleşimde odak anlamsızdı (profil zaten simetrik), o yüzden "ekranı odak frekansa göre kaydırma" yorumu seçildi. Doğrulanmadı.

- **Ateş: kıvılcım yeniden yazıldı (kullanıcı: "etrafta nokta gibi çıkıp duran şeyler ne?" → "gerçek hayat gibi ara sıra ve rastgele çıksın, ilk çıktığında güçlü, yavaş yavaş soğuyarak yok olsun"):** eski kıvılcımlar sabit sütunlarda
  çok yavaş (0.1–0.22 ekran/sn) yükselen yuvarlak, sönüp yanan benekler olduğu için asılı nokta gibi görünüyordu. Yeni `sparksAt()`: 6 yuva, her biri 4–10 sn (÷ kıvılcım ayarı) aralıkla rastgele yerde (x rastgele, başlangıç y düşük) %70 olasılıkla 1–3 kıvılcımlık
  patlama; her kıvılcım hızlı (v0 0.45–0.95) başlar, sürtünmeyle yavaşlar (`y = y0 + v0·(1−e^(−1.5t))/1.5`), rastgele yana kayar, rüzgârla savrulur; ÖMÜR 1.5–2.7 sn: ısı `e^(−t/(0.45·ömür))` → renk rampası beyaz-sarı → turuncu → kızıl → karanlık,
  parlaklık `0.15 + 2.2·ısı^1.4` (ilk anda çok güçlü), uzun iz (`sy = sx + 0.03·hız·ısı`) hız düştükçe noktaya iner, boyut küçülür. Müzik bitince (`sLevel` kapısı) birlikte kaybolur; `sparks`=0 kapatır. Gerçek zamanla (`uClock`) çalışır. Doğrulanmadı.

- **Ateş: rastgele esintiler + durağan dönem (kullanıcı: "rüzgâr içinde rastgele ve farklı yönlerde esinti hissettirsin, durağan bir zaman dilimi de olsun"):** eski rüzgâr iki yavaş sinüstü (tahmin edilebilir, hiç durmuyordu). Yeni `stepWind()` durum makinesi (JS):
  DURAĞAN dönem 2.5–7 sn (rüzgâr ≈ 0, alevler dik) → rastgele yönde (±1), şiddet 0.4–1.2, süre 1.5–4 sn bir esinti (`sin²` zarfı: yumuşak başlar/söner, ×(1+0.2·sin 5t) hafif dalgalanma); bitince %25 olasılıkla 0.2–0.8 sn sonra TERS yönde ikinci esinti, yoksa yeni durağan dönem.
  Çıkış damp 3 ile yumuşatılır. Shader: esinti sırasında alev dilleri hafif titrer (`sin(8y − 5t)·0.012·|rüzgâr|·y^1.3`). Kıvılcımlar da aynı rüzgârla savrulur. `wind` ayarı genel şiddeti çarpar. Doğrulanmadı.

- **Ateş: vuruşta kıvılcım artışı (kullanıcı: "ritim ani yükselişte kıvılcım sayısı ve şiddeti artsın"):** kıvılcım çekirdeği `oneSpark(uv, x0, y0, tohum, yaş, boost, alevKapısı)` fonksiyonuna ayrıldı. JS her vuruşta (`frame.beat`, min 0.18 sn arayla) halka tampona (6) bir olay yazar:
  (zaman, şiddet = `0.5 + 0.6·bas + 0.6·seviye` ≤ 1.4, tohum) → `uBeatEv[6]`. Shader olay başına `n = min(10, (2 + 4·şiddet)·kıvılcım ayarı[0.5–2])` kıvılcım koparır (0.025 sn arayla), `boost = 1 + 0.8·şiddet` (daha parlak, daha hızlı, ömür ×(0.8+0.25·boost) — vuruş kıvılcımları ≤ ~2 sn, halka tampon yetsin),
  alev kapısı: yalnız o x'te alev yüksekse (`colHeight(x0) > y0`) çıkar (güçlü sütunlardan kopar; kapı sınırlama kutusundan SONRA hesaplanır → ucuz). Rastgele kıvılcımlar da vuruşla biraz güçlenir (`boost = 1 + 0.6·sBeat`). `sparks` = 0 hepsini kapatır. Doğrulanmadı.

- **Ateş: ilk (ani/şiddetli) vuruşta kıvılcım (kullanıcı: "ilk vuruş birden ve şiddetli olduğunda gelsin"):** sebep: kıvılcım kapısı ve vuruş şiddeti YAVAŞ seviyeye (`sLevel`, damp 3) bağlıydı; sessizlikten gelen ilk vuruşta sLevel henüz düşük → kıvılcımlar kapalı/zayıf.
  Düzeltme: hızlı seviye `fast` (damp 25) + kapı `max(sLevel, fast)` (ilk an hemen açar, sessizlikte ~1 sn tutar); vuruş şiddeti `0.5 + 0.6·bas + 0.6·sLevel + 5·sıçrama` (sıçrama = `frame.level − sLevel`), tavan 2.2; ANİ BAŞLANGIÇ = `sıçrama > 0.06 && sLevel < 0.1` → olay `w=1`:
  alev kapısı yok (alev henüz yükselmeden de çıkar), n ≤ 14 kıvılcım, boost ≈ 2.8. Eşikler seviye ölçeğine duyarlı (RMS ~0.05–0.3); tetiklenmiyorsa `jump`/`sLevel` eşikleri ayarlanabilir. Doğrulanmadı.

- **Ateş: kıvılcım sayısı artırıldı (kullanıcı: "az önceki daha fazlaydı kıvılcım çıkma durumu"):** son değişiklikte sayıyı azaltan bir şey bulunamadı (şiddet/tavan arttı), yine de algı geri bildirimi esas alındı: vuruş demeti `n = min(20, (4 + 7·şiddet)·kıvılcım[0.5–3])` (eski 2 + 4·şiddet, tavan 14),
  rastgele yuvalar 2.5–7 sn aralıkla (eski 4–10), patlama olasılığı %85 (eski %70), patlamada 2. ve 3. kıvılcım %70 (eski %55). `sparks` ayarı 0–3 (varsayılan 1.4; eski 0–2, 1). Doğrulanmadı.

- **Ateş: normalde sürekli kıvılcım, ani patlamada belirgin fark (kullanıcı: "olağan durumda da kıvılcım gelmeye devam etsin, sadece ani patlamada kesin gözle görmek isterim bu farkı"):** kontrast için normal akış SAKİNLEŞTİRİLDİ (rastgele yuvalar 3–8 sn, %80, ek kıvılcım %60;
  normal vuruş demeti `n = min(8, (1 + 3·şiddet)·kıvılcım)` = 2–6) ve ANİ PATLAMA belirginleştirildi: `onset = (sıçrama > 0.06 && sLevel < 0.1) || sıçrama > 0.18`; n ≈ 22 (≤ 24), boost 3.2 (≈ 3× parlak, daha hızlı, daha büyük, ömür uzun), alev kapısı yok;
  ek olarak `flash` (1'e çıkar, 0.5 sn'de söner) alevi bir an kabartır (`+0.3·flash·alev`). Doğrulanmadı.

- **Ateş: patlama kıvılcımları çizgi gibi görünmesin (kullanıcı: "şiddetli çıkan kıvılcımlar çok çizgisel gözüküyor, sadece ilk çıktığında"):** sebep: iz uzunluğu `sy = sx + 0.03·v0·e^(−kt)·ısı` yüksek ilk hızda (boost ile v0 ≈ 1.6) baş/kuyruk ≈ 10:1 elips yapıyordu. Yeni şekil: yuvarlak parlak baş (`exp(−|d/sx|²)`) + yumuşak hale (0.22, 3× geniş) +
  kısa ucu incelen kuyruk (yalnız başın ALTINDA; uzunluk `0.8 + 1.4·stretch` sx, `stretch = clamp(6·hız·ısı, 0, 2.5)` → kuyruk ≤ ~4.3 sx; genişlik `e^(−1.3·dx²)`). Soğudukça hız düşer, kuyruk kaybolur, yuvarlak kor kalır. Doğrulanmadı.

- **Ateş: patlama şiddete göre ölçeklensin (kullanıcı: "farklı müzikte fazla şiddetli çıkışlarda fazla kıvılcım oluşmuş, şiddet durumuna göre ayarla"):** ani patlama sabit ~22 kıvılcımdı. Şimdi `sev = clamp((şiddet − 0.9)/1.3, 0, 1)`: kıvılcım sayısı `mix(6, 22, sev)·kıvılcım/1.4` (hafif onset ~6, en sert ~22),
  parlaklık/boost `mix(1.8, 3.2, sev)`, alev kabarması `flash = 0.3 + 0.7·sev`. Normal vuruş demeti zaten şiddete bağlı (`1 + 3·şiddet`, ≤ 8). Doğrulanmadı.

- **Su Dalgası (U) yeniden yazıldı: gerçek su görünümü (v0.3):** eski sürüm çeyrek çözünürlükte CPU dalga simülasyonuydu, yalnız `|yükseklik|`'i palete boyuyordu (parlak halkalar; su gibi görünmüyordu), kare hızına bağlı hızla çalışıyor, tek hücre damla (ince nokta),
  kenar yansımaları vardı. Yeni: simülasyon CPU'da SABİT 60 Hz adımla (en çok 3/kare; kare hızından bağımsız), ızgara canvas oranında (yükseklik 160/220/300, genişlik ≤720); damlalar Gauss (σ≈2.4 hücre); kenarda 10 hücrelik sünger (dalga yansıması azalır).
  Yükseklik alanı R32F DataTexture olarak GPU'ya gider (filtresiz, shader'da elle bilineer örnekleme → her GPU'da çalışır). Shader: yüzey normali = yükseklik eğimi; derinlik rengi (Okyanus / Gece Gölü / Palet); dalga eğimiyle kayan kırılan ışık ağları (caustics, 4 yineleme);
  güneş/ay parıltısı (keskin `nh^120` + geniş hale), eğime bağlı ışıma ve gökyüzü yansıması. Müzik: vuruşta bas şiddetinde büyük damla + 1-2 küçük eş damla; tiz ince yağmur dalgacıklarını sürer (sessizlikte hafif esinti dalgacıkları kalır, su yine canlı görünür).
  Seçenekler: colors, drop, rain, damping, wave, shine, caustic, bright, quality (eski `contrast` → `bright`). Eski canvas sürümü scratchpad'de (Water_old.ts). Doğrulanmadı.

- **Su: Stil seçeneği — Sade Dalga (varsayılan) / Gerçekçi Su (kullanıcı: "sadece dalga modellesen yeterli (ritme göre rastgele yerde şiddete göre büyüyen bir şey), yeni mod mu ekleyelim?"):** yeni mod AÇILMADI (aynı simülasyonu ikinci kez barındırır, mod listesini şişirir; kullanıcının önceki tercihi: örtüşenleri özellik olarak ekle).
  Sade Dalga: yalnız halkalar — çukur/tepe palet renkleri (`m/(1+m)` yumuşak sıkıştırma; zayıflayan halkalar da görünür) + hafif eğim ışıması, caustics/parıltı gökyüzü/yağmur/esinti YOK (müzik yokken yüzey düz). Vuruşta TEK damla rastgele yerde:
  `şiddet = min(2.2, 0.5 + 1.2·bas + 1.0·sLevel)`, genlik `0.7·şiddet`, yarıçap σ `1.6 + 1.3·şiddet` hücre (şiddet büyüdükçe halka hem güçlü hem kalın → daha uzağa ulaşır). Gerçekçi Su önceki görünüm. Gerçekçi'ye özel ayarlar (su rengi, yağmur, ışık ağları) yalnız o stilde görünür. Doğrulanmadı.

- **Su: dalga dar aralıkta + zayıf bas/ritimde karanlık ekran (kullanıcı: "çok dar aralıkta dalga gözüküyor", "ritmi zayıf bass vermeyen müziklerde karanlık ekran"):**
  (1) DALGA GENİŞLİĞİ: sebep: tek Gauss halka (σ ~4 hücre ≈ ekran yüksekliğinin %2'si, ince) + sönüm 0.985/adım (~0.77 sn yarı ömür) + yayıldıkça genlik düşüşü (1/√r) ve zayıf halkaların görünmemesi.
  Yeni Sade damla = Gauss zarflı KOSİNÜS dalga treni (`g = A·e^(−d²/2σ²)·cos(2πd/λ)`, λ = (7 + 4·şiddet) hücre, σ = 1.25·λ → 3–4 eş merkezli halka), `Dalga Ömrü` varsayılanı 0.985 → 0.993 (üst sınır 0.999) → dalga ekranın büyük kısmını geçer;
  shader sıkıştırması `v = |h|^0.6 / (1 + |h|^0.6)` (zayıf halkalar da görünür), eğim ışıması 0.35 → 0.5.
  (2) KARANLIK EKRAN: sebep: damla yalnız `frame.beat`'te düşüyordu; bas yoksa/ritim zayıfsa beat hiç gelmez. Yeni tetikleyiciler: vuruş VEYA spektral akı onset'i (32 bant, pozitif artışların toplamı; `akı > 0.12 && akı/ortalama > 1.7`, 0.22 sn bekleme; şiddet `0.4 + 0.25·oran`) VEYA müzik varken 1.4 sn hiçbir şey olmadıysa yumuşak boşta damlası (şiddet 0.45).
  Ayrıca müzik varken zeminde çok hafif palet rengi (`0.03·seviye`). Doğrulanmadı.

- **Su: iç içe dalgalar + dalga treni KALDIRILDI (kullanıcı: "aynı yerde çok fazla vurgu iç içe", "dalga treni olmasın"):** Sade damla yine TEK Gauss halka ama geniş (`σ = (4.5 + 3·şiddet)·ölçek` hücre; kosinüs dalga treni silindi, `drop()` imzası eski haline döndü).
  İç içe girmeyi önlemek: (1) konum seçimi — son 3.5 sn'deki damlalardan EN UZAK aday (8 rastgele adaydan; yaşlandıkça ağırlık `1 + 0.15·yaş`); (2) tetikleyiciler arası bekleme: vuruş 0.3 sn, spektral akı 0.5 sn (akı oranı eşiği 1.7 → 2.0), boşta damlası 1.4 → 2.2 sn. Doğrulanmadı.

- **Su: Sade Dalga analitik tek-damla halkaları (kullanıcı: "gene hala aynı yerden dalgalanma başlıyor; dalga hareketi tek bir damla ile başlatılmış gibi gösterilsin; damla büyüklüğü şiddet ve bass'a göre; tiz silik dalga oluştursun ama büyük dalgaları etkilemeden sönsün"):**
  sebep: dalga denklemi (2B) damla noktasında uzun süre titreşen iz bırakıyordu → "aynı yerden dalgalanma". Çözüm: Sade stil SİMÜLASYONSUZ (CPU sim ve doku yükü yok). `uD0[16]` (x, y, yaş, boyut) + `uD1[16]` (genlik, ömür): her damla = TEK halka;
  `R = (0.2 + 0.16·S)·yaş` (ekran yüksekliği/sn), genişlik `(0.018 + 0.03·S)·(1 + 0.5·yaş)`, zarf `genlik·(1 − yaş/ömür)²/√(0.25 + 2R)` (yayılma kaybı + sönme), ön tepe + arkasında zayıf çukur + düşme anı sıçrama (0.17 sn). Bitince iz YOK.
  BOYUT S: vuruşta `0.35 + 0.95·bas + 0.25·min(1, 2·seviye)` ≤ 1.6 (bas vuruşu büyük damla); bas yoksa (akı) `0.3 + 0.12·oran + 0.4·bas` ≤ 0.9; boşta 0.3. Ömür `(3 + 1.8·S)·ömürÖlçeği` (`Dalga Ömrü` ayarı 0.5–1.5×). Tiz: `sTreble > 0.06` iken küçük (S 0.1–0.18),
  düşük genlikli (≤0.32), KISA ömürlü (0.9–1.4 sn) halkalar → silik, büyük dalgaları örtmez, çabuk söner; sessizlikte çıkmaz. Konum: son 3.5 sn'dekilerden en uzak aday (gerçek saat `clock` ile). Gerçekçi stil değişmedi (simülasyon). Doğrulanmadı.

- **Su (Sade): tüm dalgalarda sönüm + etkileşim (kullanıcı: "sönümlenme ve etkileşim her dalga hareketinde olamaz mı?"):** eskiden pozitif ve negatif katkılar ayrı kanallarda toplanıyordu (tepe ile çukur üst üste gelince götürmüyordu, ikisi de görünüyordu) ve tiz dalgacıklar ayrı, elle yazılmış ömür/genliğe sahipti.
  Şimdi HEPSİ aynı yasa: (1) SÖNÜM: zarf `genlik·(1−yaş/ömür)²/√(0.25+2R)`, genlik `(0.12 + 0.55·S)·damla·olaySiddeti` ve ömür `(0.9 + 2.4·S)·ömürÖlçeği` DAMLA BOYUTU S'den türer (büyük dalga güçlü ve uzun yaşar, küçük/tiz zayıf ve çabuk söner; özel durum yok);
  (2) GİRİŞİM: dalgalar tek işaretli yüksekliğe `h` katkı yapar → tepe+tepe güçlenir, tepe+çukur birbirini götürür; sonra `h>0` palet rengi A, `h<0` renk B; (3) KENAR YANSIMASI: büyük damlalar (S>0.5) için 4 duvardan ayna-görüntü kaynakları (genlik ×0.6),
  yansıyan dalga gelenlerle girişim yapar. Maliyet: boş yuvalar atlanır (uniform dallanma), `|q|<5` dışı hesaplanmaz. Gerçekçi stil değişmedi (zaten simülasyon: sönüm + girişim + yansıma doğal). Doğrulanmadı.

- **Su (Sade): dalga rengi şiddet + süre ile ilişkili (kullanıcı: "dalga rengi şiddeti ve süresi ile ilişkili olsun"):** her halka kendi rengini taşır: `heat = clamp(genlik/1.1, 0, 1)·(1 − yaş/ömür)`, renk `pal(heat·0.85 + ton·0.5)` → genç ve güçlü dalga paletin sıcak/parlak ucunda başlar,
  zayıfladıkça ve yaşlandıkça soğuk/sönük uca kayar; silik tiz dalgacıklar düşük genlikli olduğundan baştan soğuk görünür. Girişim renkli işaretli toplamda (`vec3 hc`) yapılır: tepe+çukur renkli bileşenlerde de birbirini götürür; kalan negatif kısım ortak çukur rengiyle (`pal(0.1)`),
  tepe parlaklığı beyaza yaklaşır (`lum²·0.5·parıltı`). Doğrulanmadı.

- **Su (Sade): renk değişimi görünmüyordu (kullanıcı: "renk değişikliğini neden göremiyorum?"):** teşhis (kod incelemesi, tarayıcıda doğrulanmadı): (1) renk ve parlaklık aynı anda azalıyordu — yaşlanan dalga soğuk uca kayarken sönüyordu, paletin soğuk ucu çoğu zaman koyu olduğu için "renk değişti" yerine "karardı" gibi görünüyordu;
  (2) renk kanalları ayrı ayrı `pow(·,0.7)/(1+·)` ile sıkıştırılıyordu (ton beyaza yıkanıyordu); (3) tepe parlaklığı saf beyaz (`lum²`) ekliyordu. Düzeltme: renk PARLAKLIKTAN AYRILDI — halka rengi `pal(heat^0.8·0.75 + ton·0.5)` (tam palet aralığı c0 → c(0.5) → c(1)) ve en parlak kanala NORMALİZE (doygun, tam parlak);
  parlaklık yalnız işaretli toplam `hs`'ten gelir (girişim korunur), renk `|katkı|` ağırlıklı ortalama `ca/wa`; tepe parlaması renkten beyaza yalnız %60 karışır. Palet tek renk tonluysa (monokrom) fark yine az görünür. Doğrulanmadı.

- **Su (Sade): ilk andan sonra renkler aynı + renk/boyut/etki/şiddet farkı görünmüyor (kullanıcı geri bildirimi):** teşhis: (1) renk `şiddet·kalanÖmür` idi ve tipik genlik (`0.4–0.6`/1.1) paletin küçük bir kısmına denk geliyordu, ömür azalınca hepsi aynı soğuk uca çöküyordu; ilk andaki renk düşme sıçramasıydı;
  (2) boyut `0.35 + 0.95·bas + …` — bas çoğu zaman benzer yüksek seviyede olduğundan neredeyse tüm damlalar aynı boyutta çıkıyordu; boyutun hız/kalınlık/ömre etkisi de dardı. Düzeltme: (a) BOYUT müziğin kendi ortalamasına göre: `pw = 0.5 + 0.5·(e − ortalama)/yayılım` (ortalama olay enerjisi 0.15 ile güncellenir, tepe yavaşça söner),
  `S = (0.2 + 1.6·pw^1.3)·rastgele(0.88–1.12)` → 0.2–1.8 (eski ~0.35–1.6 ama hep üst uçta); (b) boyutun etkisi geniş: hız `0.10 + 0.26·S`, kalınlık `0.008 + 0.04·S`, genlik `0.1 + 0.5·S`, ömür `0.8 + 2.6·S`; yansıma yalnız S>0.9;
  (c) RENK başlangıcı şiddetten (`inten = (genlik − 0.1)/0.85` → paletin tüm aralığı), zamanla `inten·(0.25 + 0.75·k)` ile başlangıç rengine soğur; her damlaya ±0.1 rastgele ton sapması (`d1.z`) → dalgalar renk olarak da birbirinden ayrılır. Doğrulanmadı.

- **Baloncuklar (Q) sıfırdan yazıldı: sabun köpüğü (v0.3):** eski sürüm düz daire konturlarıydı (ışıma vardı ama baloncuk gibi görünmüyordu), müzik yalnız tizle sıklık/basla hız, tepede rastgele patlama. Yeni: canvas2d → webgl, `InstancedBufferGeometry` + ShaderMaterial (≤220 baloncuk + ≤48 patlama, nokta boyutu sınırı yok),
  toplamsal harmanlama. Baloncuk: neredeyse saydam gövde, kenarda gökkuşağı İNCE FİLM (açı/yarıçap/zamanla kayan bantlar `pal(r·1.6 + …)`, Fresnel `r⁵`), iki yansıma (üst solda uzun, alt sağda küçük), hafif şekil titreşimi (ellips, alan korunur). Fizik: kaldırma ~ boyut (`vt = (22 + 3r)·hız·(0.75 + 0.5·bas)` px/sn), boyuta ters orantılı sallanma,
  ÇARPIŞINCA BİRLEŞME (`0.65·(r1+r2)` içinde; alan korunur, konum/hız alan ağırlıklı; taze demet 0.8 sn birleşmez), tepede (yükseklik %78–95, baloncuğa özgü) patlama halkası. MÜZİK: vuruş → alttan demet; sayı ve boyut `EventScale` ile vuruşun müziğin KENDİ ortalamasına göre şiddeti (`3 + 10·pw^1.2`, `r0 = 7 + 30·pw`),
  bas vermeyen müzik için `OnsetTracker` (spektral akı onset'i, küçük demet), tiz → ince küçük baloncuk akışı (`0.9 + 18·(tiz−0.05)`/sn; müzik varken taban akış), bas → yükselme hızı (yumuşak). Renk boyutla ilişkili (küçük = paletin başı, büyük = sonu) + küçük rastgele sapma; doğuşta kısa parlama.
  YENİ ORTAK DOSYA `onset.ts` (`OnsetTracker`, `EventScale`: Su'daki mantığın çıkarılmış hali; Su henüz kendi kopyasını kullanıyor). Seçenekler: rate, size, rise, merge, pops, film, bright (eski glow/trail kullanımı kalktı). Eski canvas sürümü scratchpad'de (Bubbles_old.ts). Doğrulanmadı.

- **Baloncuklar: birleşme KALDIRILDI (kullanıcı: "birleşme iyi bir özellik olmamış"):** çarpışınca birleşme kodu ve `merge` seçeneği silindi; baloncuklar birbirinin üstünden serbestçe geçer. Önceki PLAN notundaki "ÇARPIŞINCA BİRLEŞME" ve `merge` seçeneği artık geçerli değil. Doğrulanmadı.

- **Baloncuklar: dip dibe kümeli çıkış (kullanıcı: "bir şeye olmasa dip dibe kümeli halde çıkmaya devam ediyor"):** sebep: bir vuruşun TÜM baloncukları aynı anda ve tek noktanın etrafında dar bir bantta (`±(50 + 3·r0)`) çıkıyordu, hızları da benzerdi → yükselirken ayrılmıyorlardı. Düzeltme:
  (1) ZAMANA YAYMA: demet bir `pending` kuyruğuna girer, her baloncuk `i·(0.05–0.13) + 0–0.15` sn gecikmeyle çıkar (kısa bir akış); (2) GENİŞ BANT + BOŞ YER: `spread = min(w/2, 160 + 5·r0)`, çıkış x'i dipteki (y < 3r + 140) mevcut baloncuklardan EN UZAK aday (8 adaydan; tiz akışı da); (3) hız farkı: baloncuğa özgü ±15% (`0.85 + 0.3·tohum`);
  (4) YUMUŞAK AYRIŞMA: örtüşen çiftler (`d < 0.95·(r1 + r2)`) alan ağırlıklı itilir (yatay tam, dikey ×0.3, çarpan 0.35/kare); birleşme YOK, iç içe girmezler. Doğrulanmadı.

- **Baloncuklar: farklı zamanlarda patlama + ritim yükselişinde eskiler patlasın (kullanıcı: "falonlar farklı zaman aralığında patlasın; anlık ritim yükselmesinde yeni baloncuklar oluşurken eskileri patlasın"):** önceden yalnız tepe bölgesinde (%78–95) patlıyorlardı (hepsi benzer yükseklik/zamanda).
  Şimdi her baloncuğun rastgele ÖMRÜ var (`(2.5 + 9·rastgele^1.4)·(0.6 + 0.4·min(1, r/25))` sn; küçükler çabuk) → ömür dolunca ekranın HERHANGİ bir yerinde patlar (halka efekti); tepeye ulaşırsa yine patlar. RİTİM YÜKSELİŞİ (vuruş/onset): yeni demet çıkarken en yaşlı (>1.5 sn) baloncukların
  `~0.7·demet sayısı` kadarı `popAt = şimdi + 0.05–0.5 sn` ile işaretlenir (serpiştirilmiş, aynı anda değil; demet şiddetli → çok baloncuk patlar). Yalnız "Tepede Patlasın" açıkken geçerli (kapalıysa baloncuklar patlamadan tepeden çıkar). Doğrulanmadı.

- **Baloncuklar: farklı boyutlar + boyuta göre patlama şok dalgası (kullanıcı: "farklı boyutlarda baloncuk olsun, boyutlarına göre patlama etkisi etrafa (diğerlerini itelesin)"):** (1) BOYUT ÇEŞİTLİLİĞİ: `randSize` log-normal benzeri (`taban·e^(1.2·(U+U+U−1.5))` → ~0.3×–3×, çoğu orta/küçük, ara sıra çok büyük) + demette %10 dev baloncuk (×1.8), tavan `90·boyut`;
  tiz akışı da `randSize(4.5)`; yükselme hızı `vtOf = 22 + 3·min(r, 60)` (dev baloncuk fazla hızlanmaz). (2) ŞOK DALGASI: patlayanlar önce toplanır, sonra her patlama çevredeki (menzil `4.5·r + komşu r`) baloncuklara radyal itme uygular: `hız = 7·r_patlayan·(14/(r_komşu + 10))·(1 − d/menzil)²`
  (büyük patlama güçlü ve geniş; küçük baloncuklar daha çok savrulur; yatay/dikey hız anlık eklenir, sonra damp 2 ile normale döner). Patlama halkası da boyuta göre: süre `0.35 + 0.4·güç` sn, parlaklık `0.6 + 0.6·güç`, yarıçap `1.7·r`. Doğrulanmadı.

- **Baloncuklar: boyut ritimle ilişkili (kullanıcı: "en sessiz anda büyük baloncuk oluşması saçma oldu"):** sebep: `randSize` log-normal uzun kuyruğu (~3×) ve demette sabit %10 dev baloncuk, ses seviyesinden bağımsız çalışıyordu (taban akışta da tavan sabit `40·boyut`). Düzeltme: `loud = min(1, sLevel·3.5)` (mutlak ses seviyesi).
  Demet: `r0 = (7 + 30·pw)·(0.45 + 0.55·loud)·boyut` (hem müziğin ortalamasına göre hem mutlak seviyeye göre), üst sınır `r0·(1.3 + pw)`, dev baloncuk yalnız `pw > 0.55` ve olasılık `0.18·pw`. Taban akış: taban `3.5·boyut·(0.6 + 0.8·loud)`, tavan `(8 + 30·loud)·boyut` → sessizken yalnız küçük (≤8px), yükseldikçe aralık açılır. Doğrulanmadı.

- **Baloncuklar: esneme hareketinde kesik kenar (kullanıcı: "esnerken alan dışına çıkan tarafı kesik gözüküyor"):** sebep: şekil titreşimi `p.x *= 1+wob; p.y /= 1+wob` ellipsi bir eksende 1/(1+wob) > 1... yani çizim karesinin (±1) dışına taşırıyordu ve taşan kısım karenin kenarında düz kesiliyordu.
  Düzeltme: çizim alanı %25 genişletildi (`vP = position.xy · 1.25`, piksel konumu `iPos.xy + vP·r`) → baloncuk yarıçapı yine 1 birim, kare dışına taşabilir; titreşim genliği 0.05 olduğundan taşma payı fazlasıyla yeter (≤ ~0.2). Patlama halkası aynı eşlemeyi kullanır (boyutu değişmez). Doğrulanmadı.

- **Metaball (B) GPU'ya taşındı ve yeniden tasarlandı (v0.3):** eski sürüm çeyrek çözünürlükte CPU alanıydı, renk palet gradyanından düz (`alan → LUT`), yarıçaplar ham bas/orta/tizle titriyordu, zaman hızı ham orta ile sıçrıyordu, 3 banda bağlı 9 top.
  Yeni: canvas2d → webgl/QuadShader, tam çözünürlük. Toplar kompakt çekirdekli alan toplamı (`w = (1 − d²/R²)³`, `R = 2.2·r`), eşik 0.35; yüzey alanın GRADYANINDAN aydınlatılır (normal `(−0.18·∇F, 1)`: merkez düz, kenar eğimli → küre görünümü):
  yaygın + yansıma (`pow(·, 60)`) + kenar ışığı + çekirdek parlaması, çevrede yumuşak aura; renk topların alan ağırlıklı karışımı (kaynaşan toplar renk karışır). Kenar yumuşatma analitik (`aa = 1.5·uPxH·|∇F|`). Her topun KENDİ frekansı (spektrum 0.02–0.87, topa göre sıralı), enerjisi yumuşatılmış
  (yükselme damp 10, düşüş 3.5); yarıçap `taban·(0.6 + 0.9·enerji)`, renk enerjiyle paletin başından sonuna kayar. Zaman hızı yumuşatılmış orta ile (`0.3 + 0.5·orta`). Vuruşta toplar merkezden `0.08·nabız` kadar dışa itilir. Hareket: Yörünge / Lav; Görünüm: Metaball / Yumuşak ışık.
  Top sayısı 3–12 (eski 3–9). Seçenekler: motion, render, count, size, orbit, shine, glow, bright. Eski canvas sürümü scratchpad'de (Metaball_old.ts). Doğrulanmadı.

- **Twister (⇧T) SİLİNDİ (kullanıcı: "hiç güzel gözükmüyor, silsende olur"):** 56 satırlık basit şeritli kolon (satır satır `half = maxW·max(|cos|,|sin|)`), ışık/derinlik/anlamlı müzik bağı yoktu; benzer işi Hipnoz/Kaleydoskop/Op-Art daha iyi yapıyor. Kaynak scratchpad'de (Twister_old.ts). `⇧T` serbest, mod sayısı 37.

- **Fosfen (⇧F) YENİDEN YAZILDI: dönen geometrik desenler (kullanıcı: "diğer agent bunu istediğim gibi oluşturamadı"; AskUserQuestion → "Dönen geometrik desenler"):** eski sürüm "göz kapaklarına basınca girdap tünel" idi ve reddedilmişti (v0.2.3; tünel işi Solucan Deliği'nde). Yeni: gerçek fosfenlerdeki Klüver form sabitleri.
  Tek geçişli shader (feedback/ping-pong YOK): kaleydoskopik katlama (N-katlı simetri; `a = |mod(atan, τ/N) − τ/(2N)|`, faz sektör tam katı → dikiş yok) üzerinde 4 desen: PETEK (altıgen ızgara), ÖRÜMCEK AĞI (log halkalar + ışınlar), SPİRAL (log spiral kollar), LOG-KUTUPSAL KAFES. Desenler `uMorph` (dairesel 0–4) ile komşu iki desen çapraz geçer (toplam ağırlık 1; zıplama yok);
  geçiş her `rhythm` vuruşta ya da 14 sn'de (hedef +1, morph damp 0.9 ile kayar). Çizgiler koyu zeminde parlayan ışık hatları (en az 1 piksel çekirdek `uPxH` + geniş hale). Müzik: radyal spektrum çizgi parlaklığı (merkez bas, dış tiz), bas çizgi kalınlığı/nefes, tiz ince parıltı (hash titreşimi), vuruş geçişi tetikler;
  dönüş/akış seviyeyle yavaş birikir (yön/şekil ritimle sıçramaz). Renk yarıçap + açıyla paletten. Seçenekler: sym (4–16 çift), rhythm, speed, width, halo, react, bright. Eski sürüm scratchpad'de (Phosphene_old.ts). Doğrulanmadı.

- **YENİ MOD: Kağıt Yırtma (⇧J, psikedelik) — kullanıcı fikri ("kağıt yırtar gibi ekranı yırtıyordu, farklı renk kağıtlar vardı"); AskUserQuestion: yırtılma "İkisi birden" (sürekli + vuruşta ek), kağıt "düz renkli, kenarları beyaz lifli". İLK SÜRÜM (süpürme sınırı + yuvarlak delikler) yanlıştı;
  kullanıcı: "kağıt yırtılması ÇİZGİSEL olacaktı, ve altında her seferinde yeni kağıt var olacak, sonsuza kadar devam edecek" → yeniden yazıldı.**
  webgl/QuadShader tek geçiş. Üst üste kâğıt katmanları (3 olay katmanı + sabit 4.). ANA YIRTIK: üst kâğıtta ekranı baştan sona geçen ÇİZGİSEL çatlak — rastgele (ya da Yatay/Dikey) açıda, ince tırtıklı çizgi olarak ilerler (`τ`: 0→1, hız `(0.1 + 0.1·seviye)·hız`, ~10 sn),
  uçta daralır; tamamlanınca iki yan hızlanarak AÇILIR (`w = 0.046 + 0.12·açılma²` → yaklaşık 5 sn'de ekranı aşar: kâğıt iki yana çekilir) ve altındaki YENİ kâğıdın rengi açılır. Genişlik ekranı aşınca üst kâğıt kaldırılır (görüntü değişmez), katmanlar kayar, altına yeni kâğıt gelir,
  0.6–2 sn sonra yeni kâğıtta yeni yırtık başlar → SONSUZ. VURUŞ/onset (`OnsetTracker` + `EventScale`; bas vermeyen müzik de çalışır): kısa çizgisel ÇATLAK (mercek: iki ucu kapalı), yarı uzunluk `(0.12 + 0.5·pw)·boyut` (pw = müziğin ortalamasına göre şiddet), hızla açılıp kalır
  (`0.25 + 0.4·pw` sn), katman başına ≤4, mevcut çatlaklardan en uzak yer; katman gidince çatlaklar da gider. Her yırtık: işaretli kenar mesafesi `E` (eğri-bügrü merkez çizgisi + kenar tırtığı, 2 oktav), görünen kâğıt = üstten ilk `E<0` katman; yırtık kenarında beyaz düzensiz lifler,
  üstteki kâğıttan alttakine gölge (`exp(−E·18)·0.4`). Kâğıt rengi: Palet (altın oran adımı → ardışık kâğıtlar farklı) ya da Kağıt Tonları (8 sönük renk). Seçenekler: colors, direction, speed, size (vuruş çatlakları), jag, fiber, shadow, bright.
  Yapılmadı: kâğıt parçalarının kıvrılıp düşmesi. Doğrulanmadı.

- **YENİ MOD: Boya Damlası (⇧T, psikedelik) — kullanıcı: "[Kağıt Yırtma'nın] eski yaptığını yeni mod olarak ekleyebiliriz; bir boya sanki damlarcasına tuvale iz bırakır".** Eski (reddedilen) tasarımın tırtıklı genişleyen leke fikri burada boya damlasına dönüştü.
  webgl, PING-PONG BİRİKİM DOKUSU (RGBA8, RGB = renk, A = boya kalınlığı; çözünürlük 0.5/0.75/1× drawing buffer, ≤2048 genişlik): boya KALICIDIR, yeni boya eskinin üstüne biner (sonsuz katmanlama, durum büyümez). Her kare yalnız BÜYÜYEN halka + eski kenar bandı yeniden boyanır
  (daha yeni lekeler ezilmez). Leke: tırtıklı/sıçramalı yarıçap `reff` (açıya bağlı periyodik gürültü 3 oktav + `pow(·,6)` ışınsal sıçrama spike'ları), ease-out büyür (`0.25 + 0.35·pw` sn), kenarda koyu şişkin kalın boya (`exp(−e/rim)`), fırça gürültüsü; çevresinde 2 + ⌊6·pw⌋ küçük sıçrama damlası;
  AKINTILAR: lekenin alt yarısından 1 + ⌊2·pw·akıntı⌋ dikey kapsül, gecikmeli başlar, sürtünmeyle yavaşlar (`1 − e^(−0.9t)`), ucu yuvarlak/şişkin, kenarı hafif dalgalı. Gösterim geçişi: boya kalınlığı (alfa) gradyanından normal → yaygın + ıslak boya parıltısı, hafif tuval dokuması (`sin·sin`), vinyet.
  Müzik: vuruş/onset (`OnsetTracker` + `EventScale`; bas vermeyen müzik de çalışır) → damla; boyut `(0.1 + 0.42·pw)·boyut` (pw = müziğin ortalamasına göre şiddet); renk: güçlü damla paletin sonuna doğru, öncekinden ≥0.22 farklı; tiz → küçük sıçramalar. Seçenekler: base (Tuval/Koyu), size, jag, drips, rim, gloss, bright, quality.
  Not: pencere yeniden boyutlanınca/çözünürlük değişince tuval sıfırlanır. Kağıt Yırtma (⇧J) olduğu gibi duruyor. Doğrulanmadı.

- **Kağıt Yırtma: yalnız TEK yırtık, ek yırtıklar kaldırıldı (kullanıcı: "kağıt tek bir yerden yırtılsın ve geri çekilsin, sadece yeni yırtıklar niye ekliyorsun"):** vuruş çatlakları (mercek yırtıklar, `OnsetTracker`/`EventScale` kullanımı, `size` seçeneği) TAMAMEN silindi; katman başına tek yırtık (`SLOTS = 1`).
  Akış: tek çizgisel yırtık ilerler → iki yan açılır, kâğıt geri çekilir → altındaki yeni kâğıt tamamen görünür → yeni yırtık (sonsuz). Ritim artık yalnız `jerk`: vuruşta 1'e çıkar (`−3.5/sn` söner), yırtık ucu hızı `0.06 + 0.05·seviye + 0.3·jerk`, açılma `×(1 + 1.2·jerk)` — kâğıt hamle hamle yırtılır; ses seviyesi kenar tırtıklığını biraz artırır. Kâğıt Yırtma'daki "yan yırtık" notları (önceki giriş) artık geçerli değil. Doğrulanmadı.

- **Kağıt Yırtma + Boya Damlası: GERÇEKÇİLİK için yeniden yazıldı (kullanıcı: "ikisi de istediğim gibi olmamış, önce gerçekçilikle alakası yok; ilk olarak tekrar düzenlemeni istiyorum, beceremezsen ben devralırım").**
  Teşhis — KAĞIT: yırtık kenarı düz bir beyaz çizgiydi (gerçekte renkli yüzey + beyaz LİFLİ çekirdek bandı ayrı), kâğıtlar düz levha gibi kayıyordu (havalanma/yumuşak gölge yok), yırtık eşit genişlikte açılıyordu. BOYA: düz renkli, koyu çerçeveli daireydi (gerçekte kubbe, parlak, ışığı yansıtır), akıntı düz şeritti.
  KAĞIT v3: (1) V biçimli yırtık (başlangıçta en geniş, uçta kapalı; açılma sonrası uçtaki minimum %30 genişlik, `W` büyüdükçe tüm ekran açılır; açılma `0.049 + 0.25·t²`); (2) İKİ KATMANLI kenar: renkli yüzey → düzensiz genişlikli (`fibW`) beyaz lifli çekirdek bandı (lifler kenara DİK: `n2(u·210, eb·38)` + ince gürültü), kenar sınırı tırtıklı;
  (3) havalanma: kenar ışık yakalar (`+14%·kalkma`), üstteki kâğıttan alttakine IŞIĞA GÖRE KAYDIRILMIŞ yumuşak gölge (`E` üst katmanda `p + L·(0.008 + 0.1·kalkma)` noktasında örneklenir, yarı gölge `0.004 + 0.06·kalkma`) + kenar boyunca ortam kararması; (4) kâğıt dokusu (bulutsu leke + ince lif + yönlü lif);
  (5) katmanlar ALTTAN ÜSTE kenar yumuşatmalı (`smoothstep(aa, −aa, E)`) birleştirilir (eski: ikili test + aliasing). Ritim: vuruşta yırtık hamlesi (`jerk`). Yapılmadı: kâğıdın kıvrılması/yuvarlanması (sayfa kıvrımı), düşen parçalar.
  BOYA v2: boya bir YÜKSEKLİK fonksiyonu — damla KUBBE (`√(1−(1−s)²)`, kenarı dik) + kenarda ince menisküs halkası; sıçrama tacı ışınsal PARMAKLAR (`pow(pn, 5/7)` seyrek sivri çıkıntılar, yalnız dışa) + parmak uçlarında küçük damlalar; akıntı SİLİNDİR kesitli (`√(1−ρ²)`), gövde aşağı incelir (−%35), ucu şişkin boncuk, hafif dalgalı.
  AYDINLATMA boya geçişinde ANALİTİK: yükseklikten sonlu farkla normal → yaygın + ıslak parıltı (`pow 90`) + pencere (softbox) yansıması (`reflect`) + hafif gökyüzü; pigment kalın yerde koyu/doygun, ince kenarda açık ve yarı saydam (alttaki görünür); sonuç birikim dokusuna PİŞİRİLİR (eski sürümde 8-bit alfa yüksekliği bantlaşırdı). Tuval dokusu ince boyadan görünür.
  Olaylar OLUŞTURULMA SIRASIYLA her kare TAM yeniden boyanır (kubbe profili yarıçapla ölçeklendiği için artık yalnız halka değil); kendinden eski bir olay bitmemişken bitmiş olaylar da boyanır (sıra korunur), baştan itibaren biten olaylar kalıcılaşır. Seçenekler: `rim` → `thick` (Boya Kalınlığı), `jag` → Sıçrama Parmakları. Doğrulanmadı.

- **Boya Damlası v3: YAĞLI BOYA KÂĞIDA DAMLAR — düz 2B leke (kullanıcı: "kağıt yırtılması kabul edilebilir; boya damlası istediğim gibi olmamış, 3D niye gözüküyor? yağlı boya gibi kağıda damlar ve yayılması gerekir, yağlı olduğu için önce yağ tabakası sonra boya dağılır").**
  Kâğıt Yırtma kabul edildi (dokunulmadı). v2'deki 3B kubbe, ıslak parıltı/yansıma, silindir akıntı, parmaklı sıçrama taçı, tuval dokusu, ışıklandırma TAMAMEN SİLİNDİ (kullanıcı 3B görünüm istemedi).
  Yeni model: (1) ÖNCE YAĞ: saydam, hafif sararmış/koyulaşmış (`OD = (0.05, 0.1, 0.22)`) yumuşak kenarlı düz disk hızla yayılır (`1 − e^(−t/τo)`, τo 0.35–0.6 sn); (2) ARDINDAN PİGMENT: 0.3–0.5 sn gecikmeyle yağın İÇİNDE dağılır (`τp` 0.8–1.4 sn), yarıçapı yağın %55–70'i; merkezde yoğun, kenara seyrelen (`(1−x²)^1.3`),
  lifli/tüylü kenar (açıya bağlı periyodik gürültü + `pow(·,4)` tüyler) ve kâğıt liflerinin pigmenti eşit emmemesi (konuma bağlı sabit modülasyon); (3) KURUMA: `dryStart = gecikme + 2.2·τp`, 1.2 sn'de kenarda pigment biriken koyu halka belirir.
  Renk birleşimi gerçek leke gibi ÇARPIMSAL (Beer-Lambert): pigment `OD = −ln renk`, `rgb *= exp(−OD)` → üst üste gelen lekeler karışır (opak örtme yok). Birikim dokusuna her kare YALNIZ yeni eklenen yoğunluk (`şimdiki − önceki`) çarpılır (sıra/yeniden boyama sorunu yok; biten leke listeden çıkar).
  Hassasiyet: mümkünse HalfFloat birikim dokusu (`EXT_color_buffer_float/half_float`), yoksa 8-bit + yalnız boya eklenen piksellerde stokastik yuvarlama (küçük artışlar kaybolmasın). Yavaş solma: her 2 sn'de bir eski lekeler kâğıt rengine kayar (en az 1.5 seviye adım) — kâğıt sonsuza dek kararmasın (`fade` ayarı).
  Müzik: vuruş/onset → damla; yarıçap `(0.14 + 0.5·pw)·boyut`, sıçrama `⌊4·pw⌋` küçük leke (hızlı), tiz → ince küçük lekeler; renk güçlü damla paletin sonuna doğru, öncekinden farklı. Akıntı YOK (yağlı boya kâğıtta akmaz). Seçenekler: base (Beyaz/Krem kâğıt), size, oil, jag, fade, bright, quality
  (eski gloss/thick/drips/Koyu zemin kalktı). Doğrulanmadı.

- **Boya Damlası v4 (kullanıcı: "daha iyi; yağ biraz boya rengini alsın, boya daha yavaş dağılmaya devam etsin, en son yağlı alan nereye geldiyse boya oraya yetiştikten sonra kurur gibi yavaştan yok et; ritim ve müzik damlamaya ve yayılmaya etki etsin"):**
  (1) YAĞ RENKLİ: yağ OD'si `(0.03, 0.055, 0.12) + pigmentOD·0.14` (hafif sararmış + boya rengini biraz alır; `yağ` ayarıyla ölçeklenir). (2) PİGMENT YETİŞİR: hedef `rp = 0.96·ro` (eskiden %55–70), yavaş (`τp 2.2–3.6 sn` ÷ müzik hızı) → yağın kenarına yetişene dek dağılmaya devam eder.
  (3) YAŞAM DÖNGÜSÜ: pigment ilerlemesi `pPr ≥ 3` (kenara %95 yetişti) → kuruma halkası 1.2 sn → ~1 sn bekleyiş → YAVAŞÇA SİLİNİR (`decayT += dt/silinmeSüresi`, ayar `life` 3–20 sn, varsayılan 8): ÖNCE pigment (`lifeP = 1 − smoothstep(0,1,u)`), yağ biraz geç (`1 − smoothstep(0.2,1.25,u)`); silinirken yoğunluk farkı NEGATİF → boya geri alınır
  (`rgb *= exp(+ΔOD)`, sonuç kâğıt rengine kenetlenir → hayalet kalmaz). Her leke kendi başına doğar/söner; global solma KALDIRILDI (kâğıt kararmaz). (4) MÜZİK: damla vuruşta DÜŞER (görünür düz renkli damla, `0.13–0.2 sn`, kısa → iniş vuruşla neredeyse eş zamanlı; boyutu `0.012 + 0.02·pw`, show geçişinde çizilir) ve inince leke başlar;
  boyut müziğin ortalamasına göre şiddetle; YAYILMA HIZI `hız = (0.6 + 1.2·seviye + 1.2·vuruş)·yayılma` (yağ ve pigment ilerlemesi ses seviyesiyle ve vuruş nabzıyla hızlanır); tiz → ince küçük lekeler. Seçenekler: base, size, spread, life, oil, jag, bright, quality (eski `fade` kalktı).
  Doğrulanmadı.

- **Boya Damlası: damla etrafında siyah çember (kullanıcı: "damla etrafında neden siyah çember oluşturuyorsun?"):** sebep: bilerek eklediğim KURUMA HALKASI (kuruyan lekede pigmentin kenarda birikmesi) fazla güçlü (`0.6` OD) ve fazla düzgün bir daireydi; pigment rengi koyuysa siyaha kaçıyordu.
  Düzeltme: genlik `0.6 → 0.5·ring` (`ring` varsayılan 0.35 → ~0.175), genişlik `0.07 → 0.1`, açıya göre değişen yoğunluk (`0.45 + 0.55·pn(a·7)`) → düzensiz; yeni seçenek `ring` (Kuruma Halkası, 0 = yok). Doğrulanmadı.

- **Boya Damlası: kuruma YOK, yavaşça silinsin (kullanıcı: "kuruma yok, yavaştan boyayı sil, yeni boyaya yer oluşsun"):** kuruma halkası ve `ring` seçeneği TAMAMEN silindi (dens'teki halka terimi, uniform, ayar). Pigment yağlı alanın kenarına yetişince (`pPr ≥ 3`) HEMEN yavaş silinme başlar (`decayT += dt/silinmeSüresi`; önceki "kuruma 1.2 sn + ~1 sn bekleyiş" kalktı);
  önce pigment, yağ biraz geç söner → kâğıt boşalır, yeni damlalar için yer açılır. Doğrulanmadı.

- **Boya Damlası: damla etrafında hâlâ siyah çember (kullanıcı geri bildirimi; kuruma halkası kaldırıldıktan sonra da sürdü → önceki teşhis yanlıştı):** asıl sebep YAĞ HALKASI: yağ OD'si `(0.03,0.055,0.12) + pigmentOD·0.14` idi; pigment koyuysa (OD ~2.8) yağ ≈ %32 koyu gri disk oluyor ve düz diskin kenarı (smoothstep %18) çember gibi görünüyordu
  (pigment yağdan küçükken yağ dışarıda halka olarak kalıyordu). Düzeltme: yağ rengi `mix(beyaz, pigmentRengi, 0.16)·(0.985, 0.975, 0.93)` (açık, renk tonlu, en fazla ~%16 karışım) → `OD = −ln(yağRengi)·yağ`; kenar çok yumuşak (`smoothstep(Reo, 0.5·Reo, r)`). Doğrulanmadı.

- **Boya Damlası: boya KARARIYOR, solmalı (kullanıcı: "boyayı karartıyorsun, ben soluklaştırıp yok etmeni istiyorum"):** sebep: pigment yoğunluğu `(1−x²)^1.3·kenar` yarıçap büyüdükçe sabit pikselde ARTIYORDU (monoton birikim) → leke yayılırken koyulaşıyordu; gerçekte pigment miktarı sabit, alan büyür → SEYRELİR.
  Düzeltme: pigment yoğunluğu `amp = 1 − 0.65·f²` ile çarpılır (`f = rp_şimdiki/rp_hedef`): damla ilk anda yoğun (1), yağın kenarına yetiştiğinde en soluk (0.35); yoğunluk farkı işaretli olduğundan seyrelme (negatif artış) boyayı geri açar (zaten desteklenen mekanizma). Sonra mevcut yavaş silinme (pigment önce) → tamamen kaybolur.
  Kuruma terimi ve `dryT/dryC/dryP` alanları `amp`'a dönüştü (E1.z/w = amp şimdiki/önceki). Doğrulanmadı.

- **Boya Damlası v5: ÇİZİM MİMARİSİ DEĞİŞTİ — birikim dokusu kaldırıldı (kullanıcı: "animasyonu hızlandırdım bekledim, yok olan boya yok (boyanın bıraktığı izleri de silmelisin); tuval hep karartılarla kalıyor, yeni renk ve etkileşimler anlaşılmıyor ilerleyen zamanda"):**
  KÖK SEBEP: ping-pong birikim dokusuna yoğunluk FARKLARINI çarpıp (silinirken geri alarak) boyuyordum; yuvarlama hataları (8-bit'te her karede stokastik yuvarlama gürültüsü + kâğıt rengine tek yönlü kenetleme → net koyulaşma bias'ı; yarım hassasiyette de binlerce çarpma) BİRİKİYOR, silinen lekenin izi kalıyor ve tuval giderek kararıyordu.
  ÇÖZÜM: tuval HER KARE SIFIRDAN hesaplanır: `kâğıt × exp(−Σ yoğunluk·OD)` (canlı lekelerin analitik yoğunluğu; Beer-Lambert → renkler çarpılarak karışır); RT/ping-pong/dither/uClock/`quality` seçeneği KALDIRILDI. Silinen leke TAM yok olur (iz imkânsız), tuval kararmaz.
  Canlı leke sayısı en çok 14 (5 vec4 değil 4 vec4 + renk: uniform yükü küçük); doluyken en yaşlı leke 6× hızla silinir (`rush`), silinene yakınsa (`lifeP ≤ 0.15`) yerine yenisi alınır, aksi halde o damla düşmez → tuval hep temiz, yeni renkler/etkileşimler okunur. Sadeleştirme: sıçrama lekeleri ve tiz küçük lekeler KALDIRILDI (kullanıcı hiç istemedi, kalabalık yapıyordu; kapasiteyi yiyorlardı).
  Korunanlar: düşen damla (görünür), yağ (açık, renk tonlu, çok yumuşak kenar) → pigment yavaş yetişir ve seyrelir → hemen yavaş silinir; yayılma hızı ses seviyesi + vuruşla; boyut müziğin ortalamasına göre. Seçenekler: base, size, spread, life, oil, jag, bright. Doğrulanmadı.

- **Boya Damlası: sönme sonda ani kesilmesin (kullanıcı: "sona doğru soluklaştırma hızını düşür, en sonda hep bir anda yok olmasını fark etmeyelim"):** iki sebep: (1) eğri `1 − smoothstep` sondaki yoğunluk algısı (≈ doğrusal OD) için yeterince uzun kuyruk bırakmıyordu; (2) KAPASİTE DOLUNCA `lifeP ≤ 0.15` olan en yaşlı leke listeden ANİDEN atılıyordu (yağ hâlâ görünürken) → pop.
  Düzeltme: sönme DIŞBÜKEY — pigment `(1−u)^2.2` (hızlı başlar, çok yavaş biter), yağ `(1 − (u−0.15)/1.1)^2` (geç başlar, daha uzun sürer; u=1.25'te 0); kapasite dolunca en yaşlı yalnız hızlandırılır (`rush 4`), ASLA anında atılmaz (yeni damla o an düşmez). Doğrulanmadı.

- **Boya Damlası: büyük leke daha geç silinsin (kullanıcı: "daha büyük boyalar daha geç silinsin, küçük boya ile aynı sürede siliniyor gibi"):** silinme süresi `decayDur = silinmeSüresi·(0.45 + 1.6·pw)` (pw = damla şiddeti/boyutu: küçük ≈ 0.45×, büyük ≈ 2.05× → ~4.5 kat fark). Yayılma süresi zaten boyutla artıyordu (`τp 2.2–3.6`), silinme de artık boyuta bağlı. Doğrulanmadı.

- **Boya Damlası: bazı damlalar iz bırakmıyor (kullanıcı: "bazı damlamalar boya izi hiç bırakmıyor niye?"):** iki gerçek sebep: (1) KAPASİTE kontrolü damla İNDİKTEN SONRA yapılıyordu (`stain()` doluyken `return`) — damla görünür şekilde düşüyor, sonra hiç leke oluşmuyordu (önceki notta "o damla düşmez" denmişti, yanlıştı);
  (2) boya rengi paletten rastgele seçiliyordu; beyaza/kâğıda yakın (açık) renk görünmez leke oluyordu. Düzeltme: `fall()` kapasiteyi (`leke + düşen ≥ 14`) DAMLA DÜŞMEDEN ÖNCE kontrol eder; doluysa damla hiç düşmez (en yaşlının silinmesi hızlanır), böylece düşen her damla leke bırakır;
  `pickColor` parlak renkleri (`lum ≥ 0.72`) 6 denemede eler, olmazsa ×0.62 koyulaştırır. Doğrulanmadı.

- **Boya Damlası: damlama SIKLIĞI ritme ve şiddetine göre (kullanıcı isteği):** eskiden her vuruş/onset tam 1 damla çıkarıyordu. Şimdi: (1) RİTİM — her vuruş/onset tetikleyici (hızlı ritim = sık damla); (2) ŞİDDET (`pw`, müziğin ortalamasına göre): `pw < 0.3` bazen HİÇ (`olasılık = pw/0.3·0.6`), `0.3–0.7` → 1 damla, `> 0.7` → 2 damla art arda (`> 0.9` → 2.6 ort.), aralık 70–150 sn'lik rastgele gecikmelerle (`pending` kuyruğu; art arda damlanın şiddeti `×(1−0.12·i)`);
  (3) GÜRLÜK — arka plan damlaları `0.05 + 0.5·max(0, 3·seviye − 0.2)` /sn (yüksek müzikte vuruşlar arasında da, sessizde neredeyse hiç; `pw 0.15–0.45`). Yeni ayar `rate` (Damlama Sıklığı, 0.3–2.5, varsayılan 1) tümünü çarpar. Kapasite denetimi `fall()` içinde (dolunca damla düşmez). Doğrulanmadı.

- **Boya Damlası: durağan müzikte damlama olmuyordu (kullanıcı: "biraz durağan bir müzikte damlama olmuyor, ondan böyle dedim"):** sebep: (1) durağan müzikte vuruş algılanmıyor, spektral akı eşiği (`oran > 2.0`) de aşılmıyordu; (2) arka plan damlası `0.05 + 0.5·max(0, 3·seviye − 0.2)` sakin seviyede (RMS ~0.05–0.1) ≈ 0.1/sn idi → pratikte hiç.
  Düzeltme: onset eşiği 2.0 → 1.5, bekleme 0.5 → 0.35 sn; TABAN AKIŞ: müzik çalıyorsa (`seviye > 0.015`) vuruş olmasa da `(0.3 + 1.0·gürlük)·sıklık`/sn (sakin ≈ 0.45/sn → gürken ≈ 1.3/sn; gürlük = `min(1, 3·seviye)`), damla şiddeti `0.12 + 0.3·rastgele + 0.25·gürlük` (sakinde küçük, gürken büyük); sessizde (müzik yok) düşmez. Doğrulanmadı.

- **Boya Damlası: damla en tepeden başlasın (kullanıcı: "damlayı en tepeden başlat, sanki damla bölgeye yakın bir yerde oluşuyor gibi gözükmesin"):** düşen damla artık hedefin yalnızca 0.3–0.5 üstünden değil EKRANIN EN TEPESİNDEN (`y0 = 1.08`, kenarın hemen dışı) başlar; düşme süresi `T = 0.1 + 0.13·√(mesafe)` (ivmeli `k²` profil; tepeden ~0.2–0.3 sn),
  dikey uzama 1.6 → 2.2 (hızlı görünür). Not: vuruşu önceden bilemediğimiz için leke inişi vuruştan ~0.2–0.3 sn sonra olur (önceden 0.13–0.2 sn). Doğrulanmadı.

- **3D Tünel (5) GPU'ya taşındı ve yeniden tasarlandı (v0.3):** eski sürüm scene3d, 48 torus halkası ileri uçuyordu; her halka kendi indeksiyle bir frekansa bağlıydı (müzik yalnız parlaklık), hız ham `seviye·1.8 + vuruş·1.4` ile sıçrıyordu, spektrum ham, tünelin kendisi boş.
  Yeni: scene3d → webgl/QuadShader, tam ekran shader, gerçek PERSPEKTİFLİ düz çokgen tünel (apothem 1, kenar sayısı 3–12): piksel → panel (`pidx`, panel içi `la`), derinlik `z = 1/(cos(la)·r)`, panel koordinatı `tan(la)/tan(seg/2)`; kare hücreler (hücre boyu = panel genişliği/hücre sayısı). KAMERA salınımı çok hafif (`0.06·ayar·(1+bas)`).
  MÜZİK GEÇMİŞİ DUVARDA AKAR: 64×64 gecmiş dokusu (satır = dünya hücre indeksi mod 64, sütun = frekans); ileri uçuş yeni bir hücre sınırını geçtikçe JS uzak uca (`+46` hücre) o anki YUMUŞATILMIŞ spektrumu yazar → hücre doğduğu andaki sesi taşır, kameraya yaklaşıp geçer (yeni ses ufukta doğar). Çevre boyunca frekans:
  hücre indeksinden simetrik (alçak frekans ortada); vuruş bir sonraki satıra `+0.55` yazılır → tüm çevreyi saran parlak halka tünelde yaklaşır. Hız yumuşatılmış seviyeyle `(3.5 + 7·min(1, 3·seviye))·ilerleme` hücre/sn (ani yüksek seste sıçramaz); `T` mod 1024 (64'ün katı → satır eşlemesi tutarlı).
  Yapısal detay: panel kenarları çizgi, her 8 hücrede bir halka çerçeve, köşe şeritleri; ufuka sis + ufuk ışığı (delik DEĞİL; bas ile nabız); uzakta moire olmasın diye ayrıntı piksel başına hücre birimine göre ortalamaya geçer. Seçenekler: sides, cells, travel, react, sway, core (Ufuk Işığı), bright (+rotationSpeed).
  Eski scene3d sürümü scratchpad'de (Tunnel3D_old.ts). Doğrulanmadı.

- **Işık Hızı (i) GPU'ya taşındı ve yeniden tasarlandı (sıradaki: elden geçirilmeyen 13 modun 1.'si):** eski sürüm canvas2d, yıldızlar kare noktalar (+ çizgi izi), hız `1.6 + seviye·7 + vuruş·14·ayar` (ham → sıçrıyordu), müzikle yıldız ilişkisi yok, tek renk gibi rastgele. Uzay Yolculuğu ile ÖRTÜŞMEZ: o yıldızlar arasında yavaş seyir, bu merkezden fışkıran hiper uzay çizgileri (silinmedi).
  Yeni: log-kutupsal hücre alanı (`ln R − T`, T üstel zoom), her hücrede bir yıldız = radyal çizgi (başı dışarıda, kuyruğu merkeze doğru söner), çizgi uzunluğu = hız (hareket bulanıklığı) `0.05 + çizgi·hız·Kr·0.1`; 3 katman (48/96/180 açı dilimi; 2.2/3.0/4.2 hücre/e-katı), yakın (büyük R) yıldız parlak/kalın, kenar yumuşatma ≥ 0.9 piksel.
  MÜZİK: her yıldız kendi AÇISAL dilimine göre frekansa bağlı (alt = bas, üst = tiz, simetrik): o frekans çaldıkça parlar (`0.45 + 0.9·lit`) ve çizgisi uzar (`1 + 0.8·lit`) → alan bir ekolayzır gibi okunur; renk açıya/frekansa göre paletten + beyaza karışım. Hız yumuşatılmış seviyeyle `(0.8 + 1.6·min(1, 3·seviye))·uçuş`; HİPER ATLAMA yalnız GÜÇLÜ vuruş/onset'te
  (`pw > 0.6`, müziğin ortalamasına göre, 1.5 sn bekleme): `hız += 4.5·atlama`, hepsi damp 3 ile (anlık sıçrama yok), çizgiler `×(1 + 1.5·atlama)` uzar, merkezde yumuşak ışık (delik değil), `0.8/sn` ile sakinleşir. Seçenekler: travel, streak, density, size, jump, react, bright (eski glow/trail/particleCount/boost/streak-toggle kalktı).
  Eski canvas sürümü scratchpad'de (Starfield_old.ts). Doğrulanmadı.

- **Işık Hızı: anlık hızlanma/yavaşlama yumuşatıldı (kullanıcı: "anlık hızlanma ve yavaşlamayı yumuşatmak lazım"):** hız `damp 3` ile ve hızlı ses seviyesiyle (`damp 3`) hedefe gidiyor, atlama anında tepeye çıkıp doğrusal sönüyordu. Düzeltme: (1) hız için AYRI yavaş seviye süzgeci (`sSlow`, damp 0.7); (2) hız hedefe `damp 1.1` ile yaklaşır ve adım ivme sınırıyla kırpılır
  (`≤ 1.6 hız birimi/sn`), kırpılmış adım ayrıca `damp 6` ile yumuşatılır (ivmenin kendisi de kademeli → hız eğrisi köşesiz); (3) atlama zarfı (`jumpEnv`, tetiklenince tepe, `0.45/sn` söner) ve `jump` onu kademeli izler (yükselirken damp 2.5, inerken 1.2). Doğrulanmadı.

- **Matris (x): GPU sürümü GERİ ALINDI, eski GÖRÜNÜM korundu + yalnız etkileşim eklendi (kullanıcı: "önceki görsel gösterim daha güzeldi, sadece etkileşimi yoktu"):** ilk deneme (analitik GPU shader + harf atlası + titreşen iz harfleri + tarama çizgisi) kullanıcıya göre eskisinden daha az güzeldi. Dosya eski canvas2d sürümüne döndü
  (`fadeTrail 0.12` ile yumuşakça sönen iz, parlak kafa + glow sprite, sabit harfler, aynı sütun/hız aralıkları) ve yalnız MÜZİK ETKİLEŞİMİ eklendi: (1) her sütun x konumuna göre soldan sağa bir frekansa bağlı (eskiden `i % 8`); o frekansın yumuşatılmış enerjisi (yükselme damp 8, düşme 3) iz parlaklığını (`0.35 + e·0.5`, eski formül),
  kafa ışımasını ve sütun hızını (`× (0.8 + 0.5·e)`) belirler; (2) genel yağış hızı yumuşatılmış seviyeyle (`1 + 1.4·min(1, 3·seviye)`, hedefe damp 1.2; eskiden ham `seviye + vuruş` sıçrıyordu); (3) vuruşta/onset'te `3 + 18·pw` sütunda (müziğin ortalamasına göre, en enerjik frekanslar öncelikli: 3 adaydan en yüksek `e`) tepeden YENİ akış başlar (kafası alt çeyreğe inmiş sütunlardan).
  Seçenekler: glyphs, fontSize, react, burst. GPU/atlas sürümü silindi (görünüm farkı sebebiyle). Doğrulanmadı.

- **Statik (⇧U): ANTEN PARAZİTİ stili eklendi, GPU'ya taşındı (kullanıcı: "2000'ler ve 90'ların çekmeyen anten sorunu gibi bir görünüm olsun, ister özellik ister düzenle; internette crt tv parazit desenlerine bak"):** webgl/QuadShader, iki stil (`style`): ANTEN PARAZİTİ (varsayılan) ve KLASİK KAR (önceki görünüm: renkli taneler, yoğunluk frekansa göre, beyaz parazit çizgisi, tarama çizgisi, vinyet, vuruş parlaması).
  Araştırılan analog bozulma sözlüğü (Wikipedia "Television interference", repairfaq herringbone sayfası): kar, hum çubukları (yukarı kayan yatay bantlar; şebeke paraziti), balıksırtı/herringbone (ince zikzak çapraz çizgiler), hayalet görüntü (çok yollu yansıma: yana kaymış kopya), V-hold kaybı (dikey kayma + yırtılma), rastgele yatay çizgiler (kıvılcım).
  ANTEN stili: sinyal = renk çubuğu TEST KARTI (7 çubuk paletten + ters şerit + gri rampa); `sinyal` (0–1) gürlük + vuruş + yavaş "hava" ile değişir, ara sıra TAM SİNYAL KAYBI (dip); sinyal zayıflayınca kar baskın olur (`0.1 + 0.9·(1−s)^1.2`), renk solar, kanal kayması/yumuşaklık artar. Satır başına rastgele sinyal düşüşü, YATAY TİTREME/yırtılma (kayma + dalga + kararma çubuğu yakınında şiddetli),
  V-HOLD (`roll += 0.012 + 1.3·(1−s)^3.5`, zayıfken hızlanır; kararma çubuğu), hum çubukları, balıksırtı (`sin(u·260 + zikzak·18 + t·3)`, yön ~28 satırda bir değişir), hayalet (`u − 0.02…0.06`), renk taşması, ara taramalı titreme, tarama çizgileri, vinyet. MÜZİK: BAS → hum çubukları, TİZ → balıksırtı, ORTA → hayalet kayması; çubuk parlaklığı frekansla;
  güçlü vuruşta kayma ivmesi (`rollKick`), YIRTILMA BANTLARI (pw>0.3) ve KIVILCIM çizgileri (pw>0.5); şiddet müziğin ortalamasına göre (`EventScale`+`OnsetTracker`). Seçenekler: style, sig, interf, roll, ghost, jitter, grain, density (klasik), react, glitch, tear, scanlines, vignette.
  Eski canvas sürümü scratchpad'de (StaticNoise_old.ts). Doğrulanmadı.

- **Statik (Anten): SESSİZDE DURAĞAN, müzikle ritme göre hareket (kullanıcı: "parazit müzik olmayınca durağan olsun, müzik ile dalgalanma ve diğer türlü şeyleri ekle ritme göre"):** önceki sürümde sessizde sinyal düşüktü → V-hold kayması EN HIZLI (tam tersi), hava/dip salınımları ve zamana bağlı fazlar (hum/balıksırtı/dalga) sessizde de akıyordu.
  Düzeltme: `act` (0→1, `(sSlow − 0.012)/0.04`, damp 2) — sessizde 0. SESSİZ: sinyal SABİT 0.42; V-hold hızı `act·(…)` = 0 (konum sabit); hum/balıksırtı/dalga FAZLARI yalnız `act` ile ilerler (donuk çubuklar/çizgiler); dip ve hava yok; satır dususu donuk (`step(0.3, act)`); satır kayması sabit taban (hash sabit tohum); hayalet, hum (0.2·parazit), balıksırtı (0.1·parazit) sabit. Yalnız KAR akar (analog kar doğası gereği hep titrer).
  MÜZİK: `act` yükselince hepsi canlanır: sinyal `mix(0.42, müzikSinyali, act)`; V-hold + vuruş ivmesi (pw>0.3: 0.3·pw, pw>0.7: 0.8·pw); fazlar `hum 0.08·(0.4 + 1.2·gürlük + bas)`, `balıksırtı 3·(0.5 + gürlük + 2·tiz)`, `dalga 2.5·(0.6 + gürlük)`; YENİ ritim etkileri: her vuruşta satırlar dalgalanır (`0.012·vuruş`, ritimle sarsılan görüntü) ve kanal kayması (renk taşması) vuruşla nabız atar (`+0.008·vuruş`). Klasik stil değişmedi. Doğrulanmadı.

- **Mod adı: Statik → PARAZİT (kullanıcı: "bu moda parazit ismini verelim, static olmaz artık"):** görünen ad "Parazit"; iç kimlik `static` ve tuş ⇧U korundu (favoriler/kayıtlı ayarlar bozulmasın). README güncellendi. Önceki PLAN notlarındaki "Statik" aynı moddur.

- **Audio Pong (müzik etkileşimi; görünüm korundu):** (1) çubuklar yumuşatıldı (hızlı yükselme 16, yavaş düşüş 6); (2) zıplama artık rastgele değil: `40 + 480·çubukEnerjisi·bounce + vuruş·90 + çubukYükselmeHızı·0.55`; yükselen çubuk topu havaya fırlatır, eski "geçiş toleransı" testi kalktı (hızlı yükselen çubuğun içinde kalan top çubuktan düşüyordu); (3) kick < 90 → top çubuğun üstünde DURUR (sessizde durağan; çubuk yükselince 1400 px/sn'ye kadar taşınır); (4) vuruş = `frame.beat` veya OnsetTracker; yeni top EN GÜÇLÜ çubuğun üstünden, yatay hız vuruş şiddetine (EventScale, müziğin ortalamasına göre) bağlı; (5) toplar ömürlü (9-16 sn, son 1.5 sn solar), son top silinmez; (6) top son çarptığı çubuğun rengini alır; (7) yeni seçenek `bounce` (Zıplama Gücü). Yerçekimi/hareket şekli ritimle değişmez. Doğrulanmadı.

- **Galaksi (GPU'ya taşındı):** eski sürüm 1800 KARE noktaydı (PointsMaterial sprite'sız), ham `binAt`/`level` ile parlaklık/dönüş hızı sıçrıyordu ve RenderLoop'un beat kamera sarsıntısına tabiydi. Yeni: kendi kamerası/sahnesi (`manualRender`, sarsıntı yok), ShaderMaterial Points, yumuşak yuvarlak sprite, twinkle, merkez çekirdek (bas ile nefes), vuruş dalgası, dönüş hızı `damp 1.2` süzülmüş seviyeden (ani hızlanma yok). Kol sayısı değişince yıldızlar yeniden üretilir; yoğunluk `setDrawRange`. Ritim yalnız parlaklık/boyut; kol şekli/yön değişmez. Doğrulanmadı (yıldız boyutu/yoğunluğu gözle ayarlanmalı).

- **Güneş Sistemi (etkileşim + gölgeli küreler):** eski sürümde gezegen hızı HAM bant değeriyle (`0.25 + v·2.6`) her karede sıçrıyordu → hız `damp 1.5` ile süzülen hedefe (`(0.25 + 1.6·süzülmüşBant)/(uzaklık/0.16)`) yaklaşıyor. Görünüm korundu; gezegenler düz daire yerine güneş yönünde vurgulu küre, ön yarıdaki (sin a>0) %12 büyük/arka yarıdaki küçük, arka gezegenler güneşin ALTINDA ön gezegenler ÜSTÜNDE; 5. gezegende halka (arka yarı gezegenin altında, ön yarı üstünde). Eski "8 ışınlı vuruş çizgileri" kaldırıldı → vuruşta (beat veya OnsetTracker; şiddet EventScale) güneşten dışa yayılan şok halkası: yayılırken yörünge çizgisi ve gezegen parlar (en fazla 3 halka). Gezegen boyutu piksel sabitiydi → ekrana göre ölçeklenir (`base/700`). Ritim yalnız parlaklık/boyut/hız; yön ve şekil sabit. Doğrulanmadı.

- **Güneş Sistemi SİLİNDİ:** gölgeli küre + vuruş şok halkası sürümü beğenilmedi ("pek iyi olmadı sil gitsin"). `Solar.ts` ve registry girişi kaldırıldı; ⇧M tuşu boşta. README mod sayısı 38'e düştü, listeden çıkarıldı. Kalan dokunulmamış modlar: Şeritler, Lazer, Havai Fişek, Kar, Yağmur, Şimşek, Op-Art Halkalar.

- **TUŞ ATAMASI YENİDEN YAPILDI (kullanıcı: "her mod için klavyeden bir harf ataması yap, sadece favoriler numerik olarak 2. bir kısayol tuşu olacak (ilk 10 tanesi)"):** (1) rakam tuşu alan 10 mod harfe taşındı: Spektrum Barları ⇧S, Dairesel d, Parçacıklar ⇧P, Dalga Formu v, 3D Tünel t, Plenoptic o, Ambience a, Kar r, Yağmur ⇧Y, Rotozoom ⇧R (kalan modların harfleri değişmedi; s/h/f ayar/gizle/tam ekran ile çakışma yok — büyük S ≠ s). (2) Favoriler eklenme sırasıyla `1..9,0` tuşlarına bağlanır: `registry.ts` → `FAVORITE_KEYS`, `favoriteKey(favorites, id)`, `favoriteForKey(favorites, key)`; `App.tsx` keydown'da önce favori rakamı denenir (`settingsRef.current.favorites`). 10'dan sonraki favoriler rakamsız kalır, favoriden çıkarınca sıradakiler kayar. (3) Mod çubuğunda ve seçici kartlarında favorinin rakamı ikinci `kbd` rozeti (`.kbd--fav`, vurgu rengi) olarak harfin yanında görünür. Doğrulanmadı.

- **Şeritler (yol sabit, ritim yalnız kalınlık/parlaklık):** (1) eski sürümde şeklin kendisi ritimle değişiyordu (`env = 0.65 + level·0.4 + beatPulse·0.2` genliği çarpıyordu) ve hız ham `level` ile sıçrıyordu → genlik sabit, hız `damp 1.2` süzülmüş seviyeden; (2) **hata:** Spiro'da `time·f·morph` ve `morph` zamanla değiştiği için türev `time·morph'` büyüyor, şerit hızı uzun sürede sürekli artıyordu → sınırlı faz kayması `0.8·sin(0.05·t)`; (3) her kuyruk noktası doğduğu andaki kalınlık/parlaklık çarpanını (`0.6 + bant·0.8 + vuruş·0.45` / `0.25 + bant·0.6 + vuruş·0.25`) saklar → vuruş kuyruk boyunca baştan sona akar; (4) her şerit kendi frekans diliminden (6 dilim, eskiden 3 grup bas/orta/tiz); (5) sabit 60 Hz adımlı örnekleme (kuyruk süresi 144 Hz ekranda kısalmıyor); (6) 660 segmentte shadowBlur (pahalı) yerine geniş+sönük ikinci çizim geçişi; (7) kalınlık ekrana göre ölçeklenir; renkler palet boyunca ping-pong yavaş kayar. Doğrulanmadı.

- **Lazer (yelpaze sabit, ritim = ışık atımları):** (1) eski sürümde yelpaze açıklığı ham `band`/`beatPulse` ile açılıp kapanıyordu (şekil değişimi) ve tarama hızı ham `level` ile sıçrıyordu → açıklık sabit (`0.16·spread`), hız `damp 1.2` süzülmüş seviyeden; (2) kaynaklar önceden `i%6/6` ile yalnız spektrumun alt yarısını görüyordu → 4 eşit dilim (bas→tiz), yumuşatılmış; (3) **dilim başına onset:** dilimin ani yükselişi kendi ortalamasının 2.2 katını aşınca (`rise > avgRise·2.2 + 0.01`, bekleme 0.28 sn) o kaynağın ışınları boyunca kaynaktan uca (1.7/sn) koşan ışık atımı + kaynak tabanı çakması; şiddet dilimin kendi ortalamasına göre → bas kaynağı vuruşta, tiz kaynağı hi-hat'te ateşler; (4) tam ekran vuruş çakması KALDIRILDI (titreme); (5) renkler palet boyunca ping-pong yavaş kayar, kalınlık/hale ekrana göre ölçeklenir. Doğrulanmadı.

- **Havai Fişek (vuruş = patlama, net kabuklar):** eski sürümde roket vuruşta fırlıyor ama ~2 sn sonra patlıyordu; patlama şiddeti o andaki HAM bas/beat'ten geldiği için ritimle eşleşmiyordu, patlama da rastgele hızlı "toz yumağı"ydı. Yeni: (1) roket uçuşu hızlandı (`ROCKET_GRAVITY 600`, ~1.4 sn); (2) vuruş (OnsetTracker bekleme 0.18 + `frame.beat`; şiddet EventScale) `pw>0.5` ise havadaki, yüksekliğin ≥%35'ine ulaşmış en yüksek roketi O ANDA patlatır, ayrıca yeni roket fırlatır (güçlü vuruş daha yükseğe); zirveye çıkan roket `0.8·pw` ile küçük patlar; (3) çalan müzikte (süzülmüş seviye `act`) seyrek taban akışı `0.5·rate/sn`, sessizde roket yok; (4) patlama kabuğu rastgele: %55 şakayık (dar hız dağılımı, %35 iç halka farklı ton), %25 eğik halka (elips), %20 söğüt (uzun ömür, ağır yerçekimi, altın ton); sayı/hız vuruş şiddetiyle; (5) kıvılcım hız yönünde kısa çizgi + patlama çakması (`drawGlowDot`, 0.3 sn); kalınlık ekrana göre ölçeklenir. Doğrulanmadı.

- **Havai Fişek — ÖNERİ VE TAVSİYELER (kullanıcı istedi; UYGULANMADI, onay bekliyor):**
  Öneriler: (1) **Frekansa göre kabuk türü:** bas ağırlıklı vuruş → büyük şakayık, tiz ağırlıklı → ince söğüt/çıtırtı (şu an kabuk rastgele). (2) **Roket x konumu frekansa bağlı:** bas ortada/tiz kenarda (ya da vuruşun baskın bandının x'i). (3) **Final:** enerji sıçraması (drop) algılanınca birkaç roketin aynı anda patlaması. (4) **Çift patlama:** büyük şakayığın iç halkası gecikmeli ikinci patlama. (5) **Şok halkası:** patlama anında dışa genişleyen ince halka (güçlü vuruşta). (6) **Ufuk silüeti** (şehir/tepe) — yalnız istenirse; "gereksiz ek" riski var.
  Tavsiyeler (ayar): `pw>0.5` patlatma eşiği — patlamalar seyrek geliyorsa 0.4'e indir, çok sık ise 0.6; "İz" ayarını (trail) artırmak roket ve kıvılcım izlerini uzatır; "Roket Sıklığı"nı ritmi zayıf parçalarda artır (taban akışı `0.5·rate/sn`), ritmi sert parçalarda 1'in altına çek (yoksa ekran dolar, MAX_ROCKETS 6/MAX_SPARKS 1100 sınırı var); sönük paletlerde söğüt (altın ton) paletten bağımsız kalır, istenirse palete bağlanabilir.

- **Kar (derinlikli, ritim = parlaklık):** eski sürümde tüm taneler aynı düz noktaydı, düşüş hızı ham `level` ile (`0.6 + level·1.4`) sıçrıyor, vuruşta tüm taneler yana sarsılıyordu (`beatPulse·50·sin`). Yeni: (1) her tane `z` (`pow(rand,1.6)`) → boyut `0.7+2z`, hız `14+44z`, alfa `0.25+0.4z`, yakın taneler (z>0.75) yumuşak haleli; (2) hız `0.7 + 0.8·süzülmüşSeviye` (`damp 1.2`), rüzgâr süzülmüş ortadan (`damp 1.0`); sarsıntı KALDIRILDI; (3) tane parlaklığı kendi x konumundaki frekans sütunundan (32 sütun, yumuşatılmış) + vuruşta (OnsetTracker/beat, EventScale) yukarıdan aşağı süpüren parlaklık kuşağı (0.85·h/sn, en fazla 3); (4) 8 tonlu palet LUT (hafif ton farkı); boyut/hız ekrana göre ölçeklenir. Sessizde kar yavaşça yağmaya devam eder. Doğrulanmadı.

- **Yağmur (derinlikli, yön sabit, ritim = parlaklık/sıçrama):** eski sürümde (1) damla sayısı ham `level`le (`90 + level·360`) değişip damlalar ani beliriyor/kayboluyordu, (2) eğim ham `mid`le (`0.14 + mid·0.22`) → yağmurun YÖNÜ ritimle değişiyordu, (3) vuruşta tüm ekran `fillRect` ile çakıyordu (titreme), (4) tüm damlalar aynıydı. Yeni: (1) `z = pow(rand,1.3)` → uzunluk `(0.5+z)`, hız `520+560z`, kalınlık/alfa derinliğe göre; (2) zemin düzlemi: damla `h·(1 − 0.16·(1−z))`'de iner (uzak damla daha yukarıda sıçrar); (3) damla sayısı `(90 + 360·süzülmüşSeviye)·density` (`damp 0.8`), damla başına 12'lik yumuşak belirme; (4) eğim `0.14 + 0.07·sin(0.17t) + 0.12·süzülmüşOrta`; (5) damla alfası x'indeki frekans sütunundan (32 sütun); (6) vuruşta (OnsetTracker/beat, EventScale) `4 + 14·pw` sıçrama halkası, 3 adaydan en enerjili sütunun altında; (7) "Vuruşta Işık Çakması" = üstten inen yumuşak gradyan (`0.22·şiddet`); (8) çizim 12 kovada (3 derinlik × 4 alfa) tek `stroke`. Doğrulanmadı.

- **Yağmur (kullanıcı: "şimşek opsiyonel olsun, yağış hızı ritme göre artsın, biraz daha gerçekçi yağmur görünümüne bürünsün"):** (1) `flash` ("Vuruşta Işık Çakması", varsayılan açık) → `lightning` ("Şimşek (güçlü vuruşta)", varsayılan KAPALI): `pw>0.7` ve 1.4 sn bekleme ile orta-nokta-kaydırmalı dallı şimşek (6 seviye, 1-3 dal), çift çakma (0.09/0.17 sn), 3 katman çizim (hale/orta/beyaz çekirdek, `lighter`), gökten `0.3·şiddet` ışıma; (2) yağış hızı = `d.speed·rainSpeed`, `rainSpeed` hedefi `0.85 + 0.5·süzülmüşSeviye + 0.55·vuruşDalgası` (`beatEnv` 1.6/sn söner, `damp 3` ile yaklaşır → vuruşta hızlanır ama sıçramaz); (3) gerçekçilik: damla iki geçişte (tüm uzunlukta sönük kuyruk + son %35'inde parlak baş → hareket bulanıklığı), yakın damlalarda sıçrama halkasına ek 3 sekme damlacığı (balistik, 0.3-0.5 sn), ufuk çizgisinde hafif sis gradyanı. Kova çizimi 12 → 24 stroke. Doğrulanmadı.

- **Şimşek (şiddete göre, gerçekçi zamanlama):** eski sürümde her şimşek aynıydı (yalnız çak/çakma), tetik ham `beat` veya ham `treble>0.4` rastgelesi, çizim bir anda tam belirir, her karede `Math.random()` flicker (strob). Yeni: (1) `pw = EventScale.rel(0.6·bas + 0.4·seviye)` → bitiş yüksekliği `h·(0.3 + 0.62·pw)` (zayıf bulutta biter), dal sayısı `1 + round(3·pw)`, ömür `0.3 + 0.35·pw` sn, kalınlık/alfa/ışıma şiddetle; `pw>0.65` ise 2. çakma; (2) konum: 3 adaydan en enerjili frekans sütunu (32 sütun, yumuşatılmış → sol bas/sağ tiz); (3) öncü çizgi 70 ms'de büyür (`reveal`), zarf: 0.5 → 1 → sönüm, rastgele strob yerine `±%8` sinüs titreşim; (4) "Gökyüzü ve Zemin Işığı": çarpma noktası radyali + üstten radyal gökyüzü ışıması `0.22·pw`; (5) tetik OnsetTracker (bekleme 0.25) + beat, olasılık `min(1, rate)`, 0.14 sn minimum aralık, en fazla 4 şimşek; çalan müzikte (`sLevel>0.06`) seyrek zayıf taban, sessizde şimşek yok; (6) kalınlık ekrana göre ölçeklenir. Doğrulanmadı.

- **Şimşek v2 (kullanıcı: "pek gerçekçi ve ilgi çekici olmamış, sondaki daire hiç hoş göstermiyor"):** (1) çarpma noktası radyal gradyan DAİRESİ ve üstteki büyük radyal gökyüzü ışıması KALDIRILDI (gökyüzü ışıması artık yalnız dikey yumuşak gradyan, seçenek adı "Gökyüzü Işığı"); (2) fırtına bulutları: 640×160 dikişsiz blob dokusu (170 yumuşak radyal blob, üstte yoğun, altı dağılan), `0.08` alfayla koyu katman, 7·px/sn sürüklenir; (3) bulut içi aydınlanma: düşük çözünürlüklü (w/3) ışık tuvaline radyal ışıklar (`lighter`) çizilir, sonra bulut dokusu `destination-in` ile üstünden geçilir (ışık yalnız bulutun olduğu yerde kalır), ana tuvale `lighter` basılır; (4) `pw<0.4` → ÇİZGİSİZ yaygın şimşek (3 atımlı zarf: 0.04/0.16/0.30 sn), `pw≥0.4` → çizgili şimşek (bitiş `h·(0.45+0.5pw)`) + bulut aydınlanması; (5) taper: yol 7 parçada, genişlik 1 → 0.4; güçlüde (`pw>0.55`) %50 alt dal; (6) şimşek başlangıcı bulutun içinden (`h·0.5·0.35`), sıfır yükseklikten değil. Doğrulanmadı.

- **Şimşek v3 (kullanıcı: "şimşek üzerinde odaklan, bulut falan istemedim, en tepeden başlasın yıldırım, yavaşlatılmış şekilde yıldırımın oluştuğunu gördüğümüz videolardaki hissiyat"):** bulut dokusu/ışık maskesi/yaygın şimşek tamamen KALDIRILDI; yıldırım `y = -4`'ten (ekran tepesi) başlar. Fizik temelli üç evre: **öncü çizgi** (`stepTimes`: 2-6 noktalık adımlar, adım başına 0.05-0.12 sn, adımın ilk %25'inde atılım, kalanı duraksama; ana kanal ~65 nokta ≈ 1.4 sn; parlaklık `0.16 + 0.6·exp(−yaş/0.1)` → uç parlak, iz soluk), dallar kavşak noktasının `tg`'sinden büyür ve ana kanal yere değmeden biter (`limit` ile sıkıştırılır), %30'u yarıda söner, `pw>0.45` alt dal, `pw>0.55 & ground` yere uzanan ikinci kol; **dönüş çakması** (`RETURN_T 0.16`): noktanın aydınlanma zamanı `tl + (endY−y)/endY·RETURN_T` → parlaklık cephesi zeminden yukarı tırmanır, dal noktaları kavşağın zamanından `+0.012·j` ile dışa doğru; **sönüm** `exp(−since/τ)`, `τ = 0.38·(0.7+0.8pw)`, dallar `decayMul 0.55-0.85`, 1-2 yeniden parlama (`pulse`). `pw<0.3` → `ground=false`: öncü `h·(0.35-0.65)`'te durur ve söner. Müzik: vuruş/onset → yeni öncü (bekleme 0.5 sn, en fazla 2 inen, MAX_BOLTS 3), `pw>0.55` → `clock/tl>0.3` olan en ilerlemiş öncü `rush` (saat ×9) ile tam yere değdiği kareye oturtulur → dönüş çakması vuruşla eşzamanlı; çalan müzikte taban: yavaş inen öncü. Yeni seçenek `slow` ("Yavaş Çekim (öncü çizgi süresi)", yıldırım saati `dt/slow`). Gökyüzü ışıması yalnız dikey gradyan, daire yok. Çizim kanal başına 4 noktalık parçalarda (parça başına 3 stroke), genişlik ana kanalda 1 → 0.45 incelir. Doğrulanmadı — öncü hızı/dal sayısı/parlaklık gözle ayarlanmalı.

- **Şimşek hız ayarı (kullanıcı: "güzel ama biraz hızlı gerçekleşmeli, isterse ayarlardan yavaşlatsın"):** `slow` varsayılanı 1 → **0.6** (öncü çizgi ~0.9 sn; dönüş çakması ve sönüm de aynı saatle hızlandı), aralık 0.5–2.5 → **0.2–2.5** (alt sınır `max(0.15, slow)`). Yavaşlatmak isteyen kullanıcı kaydırıcıyı 1 (≈1.5 sn) veya 2.5'e (≈3.5 sn) çeker. Doğrulanmadı.

- **Şimşek: ilk temasta dallar durur, temas yere olmak zorunda değil (kullanıcı isteği; kısa ve uzun yıldırımlar):** (1) dal "sıkıştırma" (`limit`/`f`) kaldırıldı; dallar kendi hızında büyür, belirme koşulu `tg <= min(saat, tl)` → ana kanalın ucu bir yere değdiği an (`tl`) TÜM dal ilerlemeleri kesilir (o ana kadar büyümüş kısımlar kalır, kalanı hiç belirmez); (2) `ground`/yarıda kalan öncü kavramı kaldırıldı: her yıldırım bir temas noktasında biter ve dönüş çakması o noktadan tepeye tırmanır; temas yüksekliği `endY = h·(0.22 + 0.74·reach)`, `reach = min(1, 0.7·rastgele + 0.3·pw)` → kısa ve uzun yıldırımlar, güçlü olay uzuna eğilimli; (3) kısa yıldırım daha çabuk iner (ana kanal adım süresi `×(0.35 + 0.65·endY/h)`), dönüş çakması süresi `RETURN_T·(0.4 + 0.6·endY/h)`, yatay sapma, dal uzunluğu ve gökyüzü ışıması uzunlukla ölçeklenir; (4) dal uzunluğu temas noktasının altına sarkmayacak şekilde sınırlı (`(endY − sy)/sin(açı)`); (5) 2. ana kol koşulu yalnız `pw>0.55`; 1-2 yeniden parlama her yıldırımda. Doğrulanmadı.

- **Op-Art Halkalar (şekil sabit, ritim = kalınlık/parlaklık; yeni "Dolu Bantlar" stili):** eski sürümde (1) bas halkaların YARIÇAPINI ölçekliyordu (`pulse = 1 + bass·0.22·o.pulse` → şekil ritimle değişiyordu), (2) akış hızı ham `level`le (`18 + level·80`) sıçrıyordu, (3) vuruşta faz birden `spacing·0.4` atlıyordu. Yeni: yarıçap ölçeği YOK; hız `(14 + 50·süzülmüşSeviye + 45·vuruşDalgası)·px` hedefine `damp 3` ile yaklaşır (faz sıçraması yok); her halkanın kalınlığı `1.6 + (3.2·e + 2.5·dalga)·pulse`, alfası `0.15 + 0.7·fade + 0.2e + 0.3dalga`; `e` = halkanın `r/maxR` konumundaki frekans (yumuşatılmış); vuruşta (OnsetTracker/beat, EventScale) merkezden dışa `0.7·maxR/sn` parlaklık dalgası (en fazla 3); yeni halka merkezde `r/(1.5·aralık)` ile yumuşakça belirir; 72 segment. `style=1` Dolu Bantlar: halkalar dıştan içe dolu çokgenlerle boyanır (çift halka sayısı, `maxR = hypot/2·1.02` ekranı kaplar; arka plan en dış halkanın zıt rengi → sarma dikişsiz), renkler `c0` ↔ koyu `c1·0.16`, vuruş/frekans halkayı açar (`lighten`). Varsayılan stil Çizgi (eski görünüm korundu). Doğrulanmadı.

## 11. Doğrulama Komutları

```bash
npm run dev        # geliştirme sunucusu (tarayıcıda manuel test: müzik aç → sekme paylaş + ses)
npm run build      # tsc -b && vite build — MUTLAKA geçmeli
npm run preview    # prod önizleme
```

Manuel test senaryosu: kaynak seç (Sekme) → YouTube/Spotify çal → modlar arasında 1-5 geç →
ayarları değiştir → sayfayı yenile (ayarlar korunmalı) → kaynak değiştir.
