# ClearTube

A Chrome extension for a cleaner YouTube, plus its landing site and a Windows installer/updater.

**Website:** https://cleartube.vercel.app

## Extension features

- Blocks ads and skips sponsor segments
- Hides YouTube Shorts
- On-player speed control (custom presets, up to 100x) and volume boost (up to 500%)
- Shows dislike counts
- Ambient glow behind the player and auto-fading UI in theater mode
- Video downloader with format picker (ffmpeg.wasm for muxing)
- Checks for updates and downloads new versions automatically

## Repo layout

```
extension/   Chrome extension (Manifest V3): content script, background worker, popup
src/         Landing site (React + Vite + Tailwind)
public/      Downloadable extension zip, installer and version.json
updater/     Windows updater (Python, built to .exe)
```

## Tech stack

JavaScript (Chrome Extension MV3, declarativeNetRequest), React, TypeScript, Vite, Tailwind, Three.js, Python

## Getting started

```bash
# Landing site
npm install
npm run dev

# Extension
# chrome://extensions → enable Developer mode → "Load unpacked" → select extension/
```
