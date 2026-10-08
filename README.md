<div align="center">

<img src=".github/assets/banner.svg" width="100%" alt="ClearTube"/>

<a href="https://cleartube.vercel.app"><img src="https://img.shields.io/badge/Live%20Demo-Visit-22c55e?style=for-the-badge&logo=vercel&logoColor=white" alt="Live demo"/></a>
<img src="https://img.shields.io/github/last-commit/Omar-Raslan-16006931/clearline?style=for-the-badge&color=6366f1" alt="Last commit"/>
<img src="https://img.shields.io/github/languages/top/Omar-Raslan-16006931/clearline?style=for-the-badge&color=0ea5e9" alt="Top language"/>

<br/><br/>

<img src="https://skillicons.dev/icons?i=js,react,ts,vite,tailwind,threejs,python&theme=dark" alt="Tech stack"/>

</div>

---

A Chrome extension for a cleaner YouTube, plus its landing site and a Windows installer/updater.


## ✨ Extension features

- Blocks ads and skips sponsor segments
- Hides YouTube Shorts
- On-player speed control (custom presets, up to 100x) and volume boost (up to 500%)
- Shows dislike counts
- Ambient glow behind the player and auto-fading UI in theater mode
- Video downloader with format picker (ffmpeg.wasm for muxing)
- Checks for updates and downloads new versions automatically

## 📁 Repo layout

```
extension/   Chrome extension (Manifest V3): content script, background worker, popup
src/         Landing site (React + Vite + Tailwind)
public/      Downloadable extension zip, installer and version.json
updater/     Windows updater (Python, built to .exe)
```

## 🛠️ Tech stack

JavaScript (Chrome Extension MV3, declarativeNetRequest), React, TypeScript, Vite, Tailwind, Three.js, Python

## 🚀 Getting started

```bash
# Landing site
npm install
npm run dev

# Extension
# chrome://extensions → enable Developer mode → "Load unpacked" → select extension/
```

---

<div align="center">

**Made with ❤️ by [Omar Raslan](https://github.com/Omar-Raslan-16006931)**

<img src=".github/assets/footer.svg" width="100%"/>

</div>
