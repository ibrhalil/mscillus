import { useEffect, useRef } from 'react';

const ORB_COLORS = ['0,245,212', '0,187,249', '155,93,229', '241,91,181'];

interface Orb {
  x: number;
  y: number;
  r: number;
  speed: number;
  phase: number;
  color: string;
}

interface Dust {
  x: number;
  y: number;
  size: number;
  speed: number;
  phase: number;
}

/**
 * Kaynak seçme ekranının canlı arka planı: yavaş süzülen ışık küreleri, alttan akan dalga katmanları ve yükselen
 * toz parçacıkları. Hafif (tek 2D tuval); `prefers-reduced-motion` açıksa tek kare çizer.
 */
export function PickerBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 1;
    let h = 1;
    let raf = 0;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      w = canvas.clientWidth || 1;
      h = canvas.clientHeight || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const orbs: Orb[] = Array.from({ length: 7 }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.2 + Math.random() * 0.25,
      speed: 0.03 + Math.random() * 0.04,
      phase: Math.random() * Math.PI * 2,
      color: ORB_COLORS[i % ORB_COLORS.length],
    }));
    const dust: Dust[] = Array.from({ length: 70 }, () => ({
      x: Math.random(),
      y: Math.random(),
      size: 0.6 + Math.random() * 1.6,
      speed: 0.01 + Math.random() * 0.03,
      phase: Math.random() * Math.PI * 2,
    }));

    const draw = (ms: number) => {
      const t = ms / 1000;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#05060b';
      ctx.fillRect(0, 0, w, h);

      // Işık küreleri (toplamsal)
      ctx.globalCompositeOperation = 'lighter';
      for (const o of orbs) {
        const x = (o.x + Math.sin(t * o.speed + o.phase) * 0.18) * w;
        const y = (o.y + Math.cos(t * o.speed * 0.8 + o.phase) * 0.16) * h;
        const r = o.r * Math.max(w, h) * (0.9 + 0.1 * Math.sin(t * 0.4 + o.phase));
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(${o.color},0.20)`);
        g.addColorStop(1, `rgba(${o.color},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }

      // Alttan akan dalga katmanları
      for (let l = 0; l < 3; l++) {
        const base = h * (0.78 + l * 0.07);
        const amp = h * (0.05 - l * 0.01);
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 12) {
          const u = x / w;
          const y =
            base +
            Math.sin(u * 5 + t * (0.35 + l * 0.12) + l) * amp +
            Math.sin(u * 11 - t * 0.5 + l * 2) * amp * 0.4;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, base - amp, 0, h);
        g.addColorStop(0, `rgba(${ORB_COLORS[l]},0.10)`);
        g.addColorStop(1, `rgba(${ORB_COLORS[l]},0)`);
        ctx.fillStyle = g;
        ctx.fill();
      }

      // Yükselen toz
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(200,230,255,0.5)';
      for (const d of dust) {
        const y = (((d.y - t * d.speed) % 1) + 1) % 1;
        const x = d.x + Math.sin(t * 0.5 + d.phase) * 0.01;
        ctx.globalAlpha = 0.15 + 0.35 * (0.5 + 0.5 * Math.sin(t + d.phase));
        ctx.fillRect(x * w, y * h, d.size, d.size);
      }
      ctx.globalAlpha = 1;

      if (!reduce) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={ref} className="picker__bg" aria-hidden="true" />;
}
