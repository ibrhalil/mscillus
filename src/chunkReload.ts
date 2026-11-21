const RELOAD_KEY = 'mscillus.chunkReloadAt';
const MODE_KEY = 'mscillus.lastMode';
const RELOAD_GUARD_MS = 30_000;

let reloading = false;

/** Sayfa yenileniyor mu (yenileme sırasında oluşan ikincil hatalar bildirilmesin). */
export const isReloading = (): boolean => reloading;

/**
 * Mod parçası (dinamik import) yüklenemedi mi? Yeni sürüm yayınlanınca açık kalmış eski sekmedeki hash'li dosya adları
 * sunucuda artık yoktur; tarayıcılar bunu farklı mesajlarla bildirir.
 */
export function isChunkLoadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload/i.test(
    msg,
  );
}

/** Sayfayı yeniler; yeniden yükleme döngüsüne girmemek için 30 sn içinde ikinci kez yenilemez. Yenilediyse true. */
export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  reloading = true;
  location.reload();
  return true;
}

/** Sekme oturumu boyunca son modu hatırlar (yenilemeden sonra aynı modla açılsın). */
export function rememberMode(id: string): void {
  try {
    sessionStorage.setItem(MODE_KEY, id);
  } catch {
    // depolama kapalı
  }
}

export function rememberedMode(): string | null {
  try {
    return sessionStorage.getItem(MODE_KEY);
  } catch {
    return null;
  }
}
