import type React from 'react';
import { useRef } from 'react';

const GridPattern = () => {
  return (
    <svg className="w-full h-full" style={{ color: '#9d7156' }}>
      <defs>
        <pattern id="grid-pattern" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid-pattern)" />
    </svg>
  );
};

/** Infinite scrolling grid with a cursor-revealed active layer + soft colour orbs.
 *  Renders whatever content you pass as children on top. */
export function InfiniteGridHero({ children }: { children?: React.ReactNode }) {
  const sectionRef = useRef<HTMLElement>(null);
  const pendingFrame = useRef<number | null>(null);
  const pointer = useRef({ x: 0, y: 0 });

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    pointer.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };

    if (pendingFrame.current !== null) return;
    pendingFrame.current = requestAnimationFrame(() => {
      sectionRef.current?.style.setProperty('--cursor-x', `${pointer.current.x}px`);
      sectionRef.current?.style.setProperty('--cursor-y', `${pointer.current.y}px`);
      pendingFrame.current = null;
    });
  };

  return (
    <section
      id="top"
      ref={sectionRef}
      onPointerMove={handlePointerMove}
      className="relative w-full min-h-screen flex items-center overflow-hidden"
    >
      <div className="absolute inset-0 z-0 opacity-[0.13]">
        <GridPattern />
      </div>
      <div className="cursor-grid absolute inset-0 z-0 pointer-events-none">
        <GridPattern />
      </div>

      <div className="absolute inset-0 pointer-events-none z-0">
        <div className="absolute right-[-15%] top-[-18%] w-[46%] h-[46%] rounded-full bg-[#c27149]/18 blur-[130px]" />
        <div className="absolute right-[8%] top-[-8%] w-[24%] h-[24%] rounded-full bg-[#e0a472]/26 blur-[110px]" />
        <div className="absolute left-[-12%] bottom-[-20%] w-[46%] h-[46%] rounded-full bg-[#a96d4a]/14 blur-[130px]" />
      </div>

      <div className="relative z-10 w-full">{children}</div>
    </section>
  );
}
