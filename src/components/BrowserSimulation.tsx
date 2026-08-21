import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Shield, ShieldOff, Play, Image as ImageIcon, Search } from 'lucide-react';

export function BrowserSimulation() {
  const [enabled, setEnabled] = useState(false);

  return (
    <div className="w-full flex flex-col rounded-2xl overflow-hidden border border-[#3a2f26] bg-[#140f0b] shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)]">
      {/* Browser Header */}
      <div className="h-12 bg-[#241b14] border-b border-[#3a2f26]/70 flex items-center px-4 gap-4 relative z-20">
        <div className="flex gap-2">
          <div className="w-3 h-3 rounded-full bg-[#e0684f]/80" />
          <div className="w-3 h-3 rounded-full bg-[#e0a54f]/80" />
          <div className="w-3 h-3 rounded-full bg-[#7fae62]/80" />
        </div>

        <div className="flex-1 flex justify-center">
          <div className="w-full max-w-md h-7 bg-black/30 rounded-md flex items-center px-3 gap-2 border border-[#3a2f26]/70">
            <Search size={12} className="text-[#8c8175]" />
            <span className="text-xs text-[#a99d8e] font-mono">youtube.com</span>
          </div>
        </div>

        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => setEnabled(!enabled)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
            enabled
              ? 'bg-[#c67f56]/20 text-[#d9a179] border border-[#c67f56]/40'
              : 'bg-[#2a2019] text-[#a99d8e] border border-[#3a2f26] hover:bg-[#33271e]'
          }`}
        >
          {enabled ? <Shield size={14} /> : <ShieldOff size={14} />}
          {enabled ? 'ClearTube ON' : 'ClearTube OFF'}
        </motion.button>
      </div>

      {/* Browser Content */}
      <div className="p-6 h-[400px] overflow-hidden relative bg-[#100c09] flex gap-6">
        {/* Sidebar */}
        <div className="w-48 flex-shrink-0 flex flex-col gap-4">
          <div className="h-8 bg-white/5 rounded-md w-full" />
          <div className="h-8 bg-white/5 rounded-md w-3/4" />
          <div className="h-8 bg-white/5 rounded-md w-5/6" />

          <AnimatePresence>
            {!enabled && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0, scale: 0.9, filter: 'blur(4px)' }}
                transition={{ duration: 0.3 }}
                className="mt-auto p-4 rounded-xl border border-[#e0684f]/25 bg-[#e0684f]/5 flex flex-col gap-2 relative overflow-hidden"
              >
                <div className="absolute top-1 right-2 text-[8px] text-[#e0684f] uppercase tracking-widest">Ad</div>
                <div className="w-full h-24 bg-[#e0684f]/10 rounded-md flex items-center justify-center">
                  <ImageIcon size={24} className="text-[#e0684f]/40" />
                </div>
                <div className="h-2 bg-[#e0684f]/20 rounded w-full mt-2" />
                <div className="h-2 bg-[#e0684f]/20 rounded w-2/3" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col gap-6">
          {/* Banner Ad */}
          <AnimatePresence>
            {!enabled && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0, scale: 0.95, filter: 'blur(4px)' }}
                transition={{ duration: 0.4 }}
                className="w-full p-4 rounded-xl border border-[#e0a54f]/25 bg-[#e0a54f]/5 relative overflow-hidden flex items-center justify-between"
              >
                <div className="absolute top-1 right-2 text-[8px] text-[#e0a54f] uppercase tracking-widest">Sponsored</div>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-[#e0a54f]/20 rounded-lg flex items-center justify-center">
                    <ImageIcon size={20} className="text-[#e0a54f]/40" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="w-48 h-3 bg-[#e0a54f]/20 rounded" />
                    <div className="w-32 h-2 bg-[#e0a54f]/10 rounded" />
                  </div>
                </div>
                <div className="px-4 py-2 bg-[#e0a54f]/20 text-[#e0a54f] rounded-md text-xs font-bold">Buy Now</div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Video Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="flex flex-col gap-2">
                <div className="w-full aspect-video bg-white/5 rounded-xl border border-white/5 flex items-center justify-center relative group">
                  <Play size={20} className="text-white/20 group-hover:text-white/50 transition-colors" />
                  <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/80 rounded text-[10px] text-white/70 font-mono">10:42</div>
                </div>
                <div className="flex gap-2">
                  <div className="w-8 h-8 rounded-full bg-white/5 shrink-0" />
                  <div className="flex flex-col gap-1 w-full pt-1">
                    <div className="w-full h-3 bg-white/10 rounded" />
                    <div className="w-2/3 h-2 bg-white/5 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Shorts Shelf */}
          <AnimatePresence>
            {!enabled && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 8 }}
                exit={{ opacity: 0, height: 0, marginTop: 0, scale: 0.95, filter: 'blur(4px)' }}
                transition={{ duration: 0.4 }}
                className="flex flex-col gap-4 pt-4 border-t border-white/5 overflow-hidden"
              >
                <div className="flex items-center gap-2">
                  <Play size={16} className="text-[#e0684f]" />
                  <span className="text-sm font-bold text-white">Shorts</span>
                </div>
                <div className="flex gap-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="w-32 aspect-[9/16] bg-white/5 border border-white/5 rounded-xl flex items-center justify-center relative">
                      <Play size={24} className="text-white/20" />
                      <div className="absolute bottom-2 left-2 right-2 text-xs text-white/50 truncate">Short video {i}</div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
