import { useEffect, useRef } from 'react';

/** A soft violet glow that trails the cursor. Hidden on touch / reduced-motion. */
export function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (coarse || reduce) return;

    let x = 0, y = 0, tick = false;
    const onMove = (e: PointerEvent) => {
      x = e.clientX; y = e.clientY;
      el.style.opacity = '1';
      if (tick) return;
      tick = true;
      requestAnimationFrame(() => {
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        tick = false;
      });
    };
    const onLeave = () => { el.style.opacity = '0'; };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="fixed top-0 left-0 w-[460px] h-[460px] rounded-full z-[1] pointer-events-none opacity-0 transition-opacity duration-300"
      style={{
        background: 'radial-gradient(circle, rgba(139,92,246,0.14), transparent 62%)',
        transform: 'translate(-50%, -50%)',
        willChange: 'transform',
      }}
    />
  );
}
