import { useEffect } from 'react';

/**
 * Görselleştirme açıkken ekranın kararmasını / uyumasını engeller (Screen Wake Lock API). Sekme gizlenince tarayıcı
 * kilidi kendiliğinden bırakır; sekme yeniden görünür olunca tekrar alınır.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (cancelled) void next.release();
        else lock = next;
      } catch {
        // pil tasarrufu / izin politikası nedeniyle reddedilebilir; görselleştirme yine çalışır
      }
    };
    const onVisibility = () => void acquire();
    void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void lock?.release();
    };
  }, [active]);
}
