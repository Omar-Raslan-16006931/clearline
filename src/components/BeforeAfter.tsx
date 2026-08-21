import { useRef, useState } from 'react';
import { Play, Image as ImageIcon, Search } from 'lucide-react';

function Mock({ clean }: { clean: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col bg-[#100c09] select-none">
      <div className="h-11 bg-[#241b14] border-b border-[#3a2f26]/70 flex items-center px-4 gap-3">
        <div className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#e0684f]/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#e0a54f]/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#7fae62]/70" />
        </div>
        <div className="flex-1 flex justify-center">
          <div className="w-full max-w-xs h-6 bg-black/30 rounded flex items-center px-2 gap-2 border border-[#3a2f26]/70">
            <Search size={11} className="text-[#8c8175]" />
            <span className="text-[11px] text-[#a99d8e] font-mono">youtube.com</span>
          </div>
        </div>
      </div>

      <div className="flex-1 p-5 flex gap-5 overflow-hidden">
        <div className="w-40 shrink-0 flex flex-col gap-3">
          <div className="h-7 bg-white/5 rounded w-full" />
          <div className="h-7 bg-white/5 rounded w-3/4" />
          <div className="h-7 bg-white/5 rounded w-5/6" />
          {!clean && (
            <div className="mt-auto p-3 rounded-lg border border-[#e0684f]/25 bg-[#e0684f]/5">
              <div className="text-[8px] text-[#e0684f] uppercase tracking-widest mb-1">Ad</div>
              <div className="w-full h-20 bg-[#e0684f]/10 rounded flex items-center justify-center">
                <ImageIcon size={20} className="text-[#e0684f]/40" />
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 flex flex-col gap-4 min-w-0">
          {!clean && (
            <div className="w-full p-3 rounded-lg border border-[#e0a54f]/25 bg-[#e0a54f]/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-[#e0a54f]/20 rounded flex items-center justify-center">
                  <ImageIcon size={16} className="text-[#e0a54f]/40" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="w-40 h-2.5 bg-[#e0a54f]/20 rounded" />
                  <div className="w-24 h-2 bg-[#e0a54f]/10 rounded" />
                </div>
              </div>
              <div className="px-3 py-1.5 bg-[#e0a54f]/20 text-[#e0a54f] rounded text-[10px] font-bold">Buy</div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="w-full aspect-video bg-white/5 rounded-lg border border-white/5 flex items-center justify-center">
                  <Play size={16} className="text-white/20" />
                </div>
                <div className="w-full h-2 bg-white/10 rounded" />
                <div className="w-2/3 h-2 bg-white/5 rounded" />
              </div>
            ))}
          </div>

          {!clean && (
            <div className="pt-3 border-t border-white/5">
              <div className="flex items-center gap-2 mb-2">
                <Play size={13} className="text-[#e0684f]" />
                <span className="text-xs font-bold text-white">Shorts</span>
              </div>
              <div className="flex gap-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="w-20 aspect-[9/16] bg-white/5 border border-white/5 rounded-lg" />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function BeforeAfter() {
  const [pos, setPos] = useState(52);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const move = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos(Math.max(4, Math.min(96, ((clientX - r.left) / r.width) * 100)));
  };

  return (
    <div
      ref={ref}
      className="relative w-full h-[400px] rounded-2xl overflow-hidden border border-[#241a3a] cursor-ew-resize touch-none shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)]"
      onPointerDown={(e) => { dragging.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); move(e.clientX); }}
      onPointerMove={(e) => dragging.current && move(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onPointerLeave={() => (dragging.current = false)}
    >
      {/* before (cluttered) underneath */}
      <Mock clean={false} />
      {/* after (clean) clipped from the left */}
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <Mock clean={true} />
      </div>

      {/* labels */}
      <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#8b5cf6] text-white z-20 pointer-events-none">With ClearTube</div>
      <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-black/50 text-[#c6bde6] border border-[#241a3a] z-20 pointer-events-none">Without</div>

      {/* handle */}
      <div className="absolute top-0 bottom-0 z-10 pointer-events-none" style={{ left: `${pos}%`, transform: 'translateX(-50%)' }}>
        <div className="w-0.5 h-full bg-[#8b5cf6] shadow-[0_0_12px_1px_rgba(139,92,246,0.8)]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-[#8b5cf6] text-white flex items-center justify-center shadow-[0_0_18px_2px_rgba(139,92,246,0.7)] text-xs font-bold">
          ⇆
        </div>
      </div>
    </div>
  );
}
