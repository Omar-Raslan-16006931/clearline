import { motion } from 'motion/react';
import { Download } from 'lucide-react';

export function Navbar() {
  return (
    <motion.header
      initial={{ opacity: 0, y: -14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="sticky top-0 z-50 w-full backdrop-blur-md bg-[#0b0b10]/70 border-b border-[#23232c]"
    >
      <div className="max-w-6xl mx-auto px-6 h-[68px] flex items-center justify-between">
        <a href="#top" className="flex items-center gap-2.5">
          <span
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#6d5cf5,#a78bfa)', boxShadow: '0 0 18px -4px rgba(109,92,245,0.9)' }}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-white" />
          </span>
          <span className="text-lg font-semibold tracking-tight text-[#f0edfa]">ClearTube</span>
        </a>

        <nav className="hidden sm:flex items-center gap-9 text-[15px] text-[#a09db4]">
          <a href="#difference" className="hover:text-[#f0edfa] transition-colors">Difference</a>
          <a href="#features" className="hover:text-[#f0edfa] transition-colors">Features</a>
          <a href="#install" className="hover:text-[#f0edfa] transition-colors">Install</a>
        </nav>

        <a
          href="/cleartube.zip"
          download
          className="inline-flex items-center gap-2 text-[15px] font-medium px-5 py-2.5 rounded-xl bg-[#6d5cf5] text-white hover:bg-[#5f4ef0] transition-colors shadow-[0_6px_18px_-6px_rgba(109,92,245,0.7)]"
        >
          <Download size={16} /> Download
        </a>
      </div>
    </motion.header>
  );
}
