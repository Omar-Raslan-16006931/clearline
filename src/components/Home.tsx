import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import {
  Ban, SkipForward, EyeOff, Volume2, ThumbsDown, Repeat, Download, Languages, ShieldCheck, SlidersHorizontal,
} from 'lucide-react';
import { InfiniteGridHero } from './ui/the-infinite-grid';

const ACCENT = '#ce7d51';
const SERIF = "'Fraunces', Georgia, serif";

const features = [
  { icon: Ban, title: 'Block ads', desc: 'Web + YouTube' },
  { icon: SkipForward, title: 'Skip sponsors', desc: 'SponsorBlock' },
  { icon: EyeOff, title: 'Hide Shorts', desc: 'Feeds & search' },
  { icon: Volume2, title: 'Volume boost', desc: 'Up to 500%' },
  { icon: ThumbsDown, title: 'Show dislikes', desc: 'Return YT Dislike' },
  { icon: Repeat, title: 'Auto-loop', desc: 'No refresh' },
  { icon: Download, title: 'Quick download', desc: 'One click' },
  { icon: Languages, title: 'English + عربي', desc: 'Own font' },
];

const steps = [
  { n: '1', title: 'Download & unzip', desc: 'Extract it somewhere permanent.' },
  { n: '2', title: 'Open extensions', desc: 'Go to chrome://extensions ' },
  { n: '3', title: 'Developer mode', desc: 'Toggle it on, top-right.' },
  { n: '4', title: 'Load unpacked', desc: 'Pick the folder. Done.' },
];

const rise = (d = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.55, delay: d, ease: 'easeOut' as const },
});

const label = 'text-[12px] font-semibold tracking-[0.2em] uppercase text-[#9b7d68]';

export function Home() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    fetch('/version.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && d.version && setVersion(d.version))
      .catch(() => {});
  }, []);

  return (
    <InfiniteGridHero>
      <div className="w-full max-w-[96rem] mx-auto px-4 sm:px-7 lg:px-10 py-8 md:py-10">
        <div className="grid lg:grid-cols-[0.86fr_1.14fr] gap-8 lg:gap-16 items-center">
          {/* LEFT — hero copy */}
          <motion.div {...rise(0)}>
            <p className="text-[14px] text-[#9b7d68] mb-4" style={{ fontFamily: SERIF }}>
              A Chrome extension for a quieter YouTube.
            </p>
            <h1 style={{ fontFamily: SERIF }} className="hero-title max-w-xl text-[46px] md:text-[68px] font-semibold tracking-[-0.045em] leading-[0.94]">
              <span className="block">YouTube, without</span>
              <span className="hero-title-video block">the distractions.</span>
            </h1>
            <p className="mt-4 text-[17px] text-[#68584d] max-w-md leading-relaxed">
              ClearTube strips YouTube back to what you came for.
            </p>
            <div className="mt-6 flex items-center gap-3 flex-wrap">
              <a
                href="/ClearTube-Installer.exe"
                download="ClearTube-Installer.exe"
                className="download-button inline-flex items-center gap-2.5 px-7 py-4 rounded-xl bg-[#ce7d51] text-white text-base font-medium shadow-[0_12px_34px_-8px_rgba(181,101,61,0.45)] hover:bg-[#b86c43] transition-colors"
              >
                <Download size={20} /> Download ClearTube (.exe)
              </a>
              {version && (
                <span className="inline-flex items-center px-3.5 py-2 rounded-full text-xs font-semibold tracking-wide bg-[#ce7d51]/10 text-[#a1603a] border border-[#ce7d51]/25">
                  v{version}
                </span>
              )}
            </div>
            <p className="mt-4 text-xs text-[#8f857b]">
              One-click installer &amp; auto-updater for Windows · Chrome, Brave &amp; Edge.
            </p>
          </motion.div>

          {/* RIGHT — every feature */}
          <motion.div {...rise(0.12)} className="features-panel">
            <div className="flex items-center justify-between mb-4">
              <p className={label}>Everything it does</p>
              <span className="text-[11px] uppercase tracking-[0.16em] text-[#9b7d68]">Built for focus</span>
            </div>
            <div className="focus-console">
              <div className="flex items-center gap-3">
                <span className="focus-console-icon"><ShieldCheck size={19} /></span>
                <div>
                  <p className="text-sm font-semibold text-[#30231c]">ClearTube is Secure and Safe 100%</p>
                  <p className="text-xs text-[#8b7565] mt-0.5">Trust me bro.</p>
                </div>
              </div>
              
            </div>
            <div className="feature-grid grid grid-cols-2">
              {features.map((f, index) => {
                const Icon = f.icon;
                return (
                  <motion.div
                    key={f.title}
                    whileHover={{ y: -7, rotateX: 4, rotateY: index % 2 ? -3 : 3 }}
                    transition={{ duration: 0.24, ease: 'easeOut' }}
                    className="feature-card group flex items-start gap-3.5"
                  >
                    <span className="feature-icon"><Icon size={20} style={{ color: ACCENT }} strokeWidth={1.9} /></span>
                    <div>
                      <div className="text-[15px] font-semibold text-[#30231c] leading-tight">{f.title}</div>
                      <div className="text-[13px] text-[#8b7565] mt-0.5">{f.desc}</div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        </div>

        {/* STEPS — styled cards, same background */}
        <motion.div {...rise(0.24)} className="mt-5 lg:mt-6 pt-6 border-t border-[#dfd1bf]">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <p className={label}>Install in 30 seconds</p>
            <a
              href="/cleartube.zip"
              download
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-[#fffaf2] border border-[#dfd1bf] text-[#523b2d] hover:bg-[#f0e3d0] transition-colors"
            >
              <Download size={15} /> Download (.zip)
            </a>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {steps.map((s) => (
              <div
                key={s.n}
                className="rounded-2xl border border-[#dfd1bf] bg-[#fffaf2]/70 p-4 hover:bg-[#f8ebd9] hover:border-[#cfae92] transition-colors"
              >
                <span style={{ fontFamily: SERIF, color: ACCENT }} className="text-3xl font-semibold leading-none">
                  {s.n}
                </span>
                <h3 className="mt-3 text-[15px] font-semibold text-[#30231c] leading-tight">{s.title}</h3>
                <p className="mt-1 text-[13px] text-[#8b7565] leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </InfiniteGridHero>
  );
}
