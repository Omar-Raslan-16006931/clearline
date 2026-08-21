import { motion } from 'motion/react';
import { Mail, Github, Twitter, MapPin, Briefcase, GraduationCap } from 'lucide-react';

export function Install() {
  return (
    <div className="flex flex-col w-full max-w-5xl mx-auto px-6 py-12">
      <motion.div 
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="mb-16 mt-12"
      >
        <h1 className="text-6xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white via-slate-200 to-slate-500 mb-6 tracking-tight">
          About Me
        </h1>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
          <div className="md:col-span-2 p-8 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-xl space-y-6 text-slate-300 text-lg leading-relaxed shadow-2xl">
            <p>
              I'm John, a software engineer with a focus on simple, high-leverage tools.
              I believe software should be fast, respect user privacy, and get out of the way.
            </p>
            <p>
              Currently, I spend my time building Chrome extensions that improve the daily browsing
              experience, and writing about software architecture, performance, and minimalist design.
            </p>
            <p>
              Previously, I worked on core infrastructure at a few high-growth startups,
              where I learned the value of simplicity the hard way.
            </p>
          </div>
          
          <div className="flex flex-col gap-6">
            <div className="p-8 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-xl shadow-2xl">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-6">Location</h3>
              <div className="flex items-center gap-4 text-slate-300">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <MapPin size={20} />
                </div>
                <span className="font-medium text-lg">San Francisco, CA</span>
              </div>
            </div>

            <div className="p-8 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-xl shadow-2xl flex-grow">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-6">Connect</h3>
              <div className="flex flex-col space-y-4">
                <a href="#" className="group flex items-center gap-4 text-slate-300 hover:text-white transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-slate-400 group-hover:bg-white/10 group-hover:text-white transition-colors border border-white/5">
                    <Mail size={18} />
                  </div>
                  <span className="font-medium">john@example.com</span>
                </a>
                <a href="#" className="group flex items-center gap-4 text-slate-300 hover:text-white transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-slate-400 group-hover:bg-[#1da1f2]/20 group-hover:text-[#1da1f2] transition-colors border border-white/5 group-hover:border-[#1da1f2]/30">
                    <Twitter size={18} />
                  </div>
                  <span className="font-medium">@johndoe</span>
                </a>
                <a href="#" className="group flex items-center gap-4 text-slate-300 hover:text-white transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-slate-400 group-hover:bg-white/20 group-hover:text-white transition-colors border border-white/5 group-hover:border-white/30">
                    <Github size={18} />
                  </div>
                  <span className="font-medium">github.com/johndoe</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
