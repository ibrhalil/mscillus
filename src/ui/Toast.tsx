export interface ToastMessage {
  id: number;
  text: string;
  kind: 'info' | 'error';
  /** Ekranda kalma süresi (ms); CSS animasyonu da bu süreye göre söner. */
  duration: number;
}

/** Ekranın üst ortasında kısa süreli bildirim (mod adı, hata). Arayüz gizliyken de görünür. */
export function Toast({ toast }: { toast: ToastMessage | null }) {
  if (!toast) return null;
  return (
    <div
      key={toast.id}
      className={`toast toast--${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      style={{ animationDuration: `${toast.duration}ms` }}
    >
      {toast.text}
    </div>
  );
}
