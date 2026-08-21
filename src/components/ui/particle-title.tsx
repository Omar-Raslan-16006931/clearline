import { useEffect, useRef } from 'react';

/**
 * Hero text rendered as drifting particles on a 2D canvas.
 * Lightweight (capped particle count, lower on mobile), pointer-repel on
 * fine pointers, form-in reveal, reduced-motion + cleanup aware.
 */
export function ParticleTitle({ text = 'ClearTube', className = '' }: { text?: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const mq = (q: string) => (window.matchMedia ? window.matchMedia(q).matches : false);
    const reduce = mq('(prefers-reduced-motion: reduce)');
    const small = window.innerWidth < 700 || mq('(pointer: coarse)');

    const LW = 1200, LH = 300;
    const MAX = small ? 1000 : 2400;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    // exact palette from the reference: bone, with rust (left) + blue (right) accents
    const COL_BONE = { r: 247, g: 249, b: 252 };
    const COL_RUST = { r: 255, g: 150, b: 96 };
    const COL_BLUE = { r: 157, g: 184, b: 255 };

    type P = {
      tx: number; ty: number; x: number; y: number; vx: number; vy: number;
      phase: number; size: number; ease: number; c: { r: number; g: number; b: number };
    };
    let particles: P[] = [];
    const pointer: { x: number | null; y: number | null } = { x: null, y: null };
    let t = 0, formT = 0, raf = 0;

    const setSize = () => {
      canvas.width = LW * dpr;
      canvas.height = LH * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const build = () => {
      const off = document.createElement('canvas');
      off.width = LW; off.height = LH;
      const o = off.getContext('2d');
      if (!o) return;
      let fs = 220;
      o.textAlign = 'left';
      o.textBaseline = 'middle';
      const setFont = (s: number) => { o.font = `800 ${s}px system-ui, -apple-system, 'Segoe UI', sans-serif`; };
      setFont(fs);
      while (o.measureText(text).width > LW * 0.94 && fs > 20) { fs -= 2; setFont(fs); }
      if (fs > LH * 0.82) { fs = Math.floor(LH * 0.82); setFont(fs); }
      const tw = o.measureText(text).width;
      const sx = (LW - tw) / 2;
      o.fillStyle = '#fff';
      o.fillText(text, sx, LH / 2 + fs * 0.02);
      const data = o.getImageData(0, 0, LW, LH).data;

      const pts: number[][] = [];
      const step = 3;
      for (let y = 0; y < LH; y += step) {
        for (let x = 0; x < LW; x += step) {
          if (data[(y * LW + x) * 4 + 3] > 128) pts.push([x, y]);
        }
      }
      let use = pts;
      if (pts.length > MAX) {
        use = [];
        const stride = pts.length / MAX;
        for (let i = 0; i < MAX; i++) use.push(pts[Math.floor(i * stride)]);
      }

      particles = use.map(([px, py]) => {
        const xn = px / LW;
        const roll = Math.random();
        let c = COL_BONE;
        if (xn < 0.42 && roll < 0.5) c = COL_RUST;
        else if (xn > 0.62 && roll < 0.28) c = COL_BLUE;
        else if (roll < 0.08) c = COL_RUST;
        return {
          tx: px, ty: py,
          x: px + (Math.random() - 0.5) * 260,
          y: py + (Math.random() - 0.5) * 260,
          vx: 0, vy: 0,
          phase: Math.random() * Math.PI * 2,
          size: 1.6 + Math.random() * 1.1,
          ease: 0.06 + Math.random() * 0.05,
          c,
        };
      });
      formT = 0;
    };

    const frame = () => {
      ctx.clearRect(0, 0, LW, LH);
      t += 0.02;
      if (formT < 1) formT += 0.018;
      const a = formT < 1 ? 1 - Math.pow(1 - formT, 3) : 1;
      for (const p of particles) {
        const dx0 = Math.sin(t * 0.7 + p.phase) * 0.6;
        const dy0 = Math.cos(t * 0.6 + p.phase) * 0.6;
        p.vx += (p.tx + dx0 - p.x) * p.ease;
        p.vy += (p.ty + dy0 - p.y) * p.ease;
        if (pointer.x !== null && pointer.y !== null) {
          const dx = p.x - pointer.x, dy = p.y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 3600) {
            const d = Math.sqrt(d2) || 1, f = (60 - d) / 60;
            p.vx += (dx / d) * f * 5.5;
            p.vy += (dy / d) * f * 5.5;
          }
        }
        p.vx *= 0.82; p.vy *= 0.82;
        p.x += p.vx; p.y += p.vy;
        ctx.fillStyle = `rgba(${p.c.r},${p.c.g},${p.c.b},${a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, 6.283);
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };

    setSize();
    build();
    if (reduce) {
      // draw once at rest
      formT = 1;
      for (const p of particles) { p.x = p.tx; p.y = p.ty; }
      ctx.clearRect(0, 0, LW, LH);
      for (const p of particles) {
        ctx.fillStyle = `rgba(${p.c.r},${p.c.g},${p.c.b},1)`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.283); ctx.fill();
      }
    } else {
      raf = requestAnimationFrame(frame);
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const r = canvas.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width) * LW;
      pointer.y = ((e.clientY - r.top) / r.height) * LH;
    };
    const onLeave = () => { pointer.x = null; pointer.y = null; };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);

    if (document.fonts && (document.fonts as any).ready) {
      (document.fonts as any).ready.then(() => build());
    }
    let rt: number;
    const onResize = () => {
      clearTimeout(rt);
      rt = window.setTimeout(() => {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        setSize(); build();
      }, 200);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('resize', onResize);
    };
  }, [text]);

  return (
    <canvas
      ref={ref}
      aria-label={text}
      role="img"
      className={className}
      style={{ width: '100%', height: 'auto', aspectRatio: '1200 / 300', display: 'block', cursor: 'crosshair' }}
    />
  );
}
