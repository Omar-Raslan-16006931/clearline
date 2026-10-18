/* ClearTube — content script
 * Performance rules this file follows (the old version violated all of them):
 *  - No page-wide MutationObserver. One 1s heartbeat + YouTube's own
 *    navigation events keep everything in place.
 *  - Never touch YouTube's layout (no position/overflow/border overrides on
 *    the player, no body overflow, no page-wide visibility toggles).
 *  - The control bar lives in a Shadow DOM, is built once, and is updated in
 *    place — never wiped and rebuilt.
 *  - Storage writes only on commit (pointer release), never per drag tick.
 */
(() => {
  "use strict";

  const DEFAULTS = {
    loop: true,
    hideShorts: true,
    redirectShorts: false,
    skipSponsors: true,
    showDislikes: true,
    volumeBoost: 100,
    blockAds: true,
    speed: 1,
    speedPresets: "1, 1.5, 2, 2.5, 3, 5, 10",
    speedMode: "slider", // "slider" | "buttons"
    ambientGlow: true,
    autoFadeUI: true,
  };
  let settings = { ...DEFAULTS };

  const $ = (id) => document.getElementById(id);
  const video = () => document.querySelector("video");
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  // A reloaded extension leaves the old content script running in open tabs
  // with dead chrome.* APIs. Detect that so it cleans up instead of leaving a
  // second, dead control bar behind.
  function alive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  /* ---------- DOWNLOAD: read player data from page context ---------- */
  let latestVideo = null; // { videoId, title, streamingData, playerUrl }

  function injectPageScript() {
    try {
      const s = document.createElement("script");
      s.src = chrome.runtime.getURL("inject.js");
      s.onload = () => s.remove();
      (document.head || document.documentElement).appendChild(s);
    } catch (_) {}
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "YTLS_INJECT") return;
    latestVideo = e.data.payload;
  });

  // The quality picker asks for the current video's formats. Ask the page
  // context to re-read its player response first so we never serve a stale one.
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === "GET_FORMATS") {
        const before = latestVideo;
        try {
          window.postMessage({ source: "YTLS_REQUEST_GRAB" }, "*");
        } catch (_) {}
        setTimeout(() => sendResponse({ video: latestVideo || before }), 250);
        return true;
      }
      return false;
    });
  } catch (_) {}

  /* ---------- settings ---------- */
  function loadSettings(cb) {
    try {
      chrome.storage.sync.get(DEFAULTS, (res) => {
        settings = { ...DEFAULTS, ...res };
        cb && cb();
      });
    } catch (_) {
      cb && cb();
    }
  }
  function persist(obj) {
    try {
      chrome.storage.sync.set(obj);
    } catch (_) {}
  }

  /* ---------- helpers ---------- */
  function currentVideoId() {
    try {
      const u = new URL(location.href);
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const m = u.pathname.match(/^\/(?:shorts|embed)\/([\w-]+)/);
      return m ? m[1] : null;
    } catch (_) {
      return null;
    }
  }
  function fmtDur(s) {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h) return h + "h " + m + "m";
    if (m) return m + "m " + sec + "s";
    return sec + "s";
  }
  const isAdShowing = () => {
    const p = $("movie_player") || document.querySelector(".html5-video-player");
    return !!(p && p.classList.contains("ad-showing"));
  };

  /* ---------- LOOP ---------- */
  function applyLoop() {
    const v = video();
    if (!v) return;
    if (settings.loop) {
      if (!v.loop) v.loop = true;
    } else if (v.loop) {
      v.loop = false;
    }
  }

  function watchVideo() {
    const v = video();
    if (!v || v.__ctBound) return;
    v.__ctBound = true;
    v.addEventListener("ended", () => {
      if (settings.loop) {
        v.currentTime = 0;
        v.play().catch(() => {});
      }
    });
    v.addEventListener("timeupdate", () => trySkip(v));
    v.addEventListener("durationchange", renderSegmentBar);
    v.addEventListener("loadedmetadata", () => {
      renderSegmentBar();
      applySpeed();
    });
    v.addEventListener("playing", () => {
      applySpeed();
      effectsTick();
      bumpActivity();
    });
    v.addEventListener("pause", () => {
      effectsTick();
      setIdle(false);
    });
    applyLoop();
    applySpeed(true);
    applyBoost();
  }

  /* ---------- SPONSOR SKIP (SponsorBlock public API) ---------- */
  const SKIP_CATEGORIES = ["sponsor", "selfpromo", "interaction"];
  let sbSegments = [];
  let sbVideoId = null;
  let sbLoading = false;
  let sbTimeSaved = 0;

  // Segments are fetched by the background worker (content-script fetches to
  // sponsor.ajay.app are blocked by CORS in MV3; the background bypasses it).
  async function maybeLoadSegments() {
    if (!settings.skipSponsors) {
      if (sbSegments.length) sbSegments = [];
      renderSegmentBar();
      return;
    }
    const vid = currentVideoId();
    if (!vid || vid === sbVideoId || sbLoading) return;
    sbVideoId = vid;
    sbLoading = true;
    sbSegments = [];
    renderSegmentBar(); // clears stale markers from the previous video
    try {
      const resp = await chrome.runtime.sendMessage({
        type: "GET_SB_SEGMENTS",
        videoId: vid,
        categories: SKIP_CATEGORIES,
      });
      if (vid === currentVideoId() && resp && resp.ok && Array.isArray(resp.segments)) {
        sbSegments = resp.segments.sort((a, b) => a.start - b.start);
      }
    } catch (_) {}
    sbLoading = false;
    renderSegmentBar();
  }

  /* ---------- SEGMENT BAR (colored markers on the scrubber) ---------- */
  function categoryColor(cat) {
    switch (cat) {
      case "sponsor": return "#00d400";
      case "selfpromo": return "#ffff00";
      case "interaction": return "#cc00ff";
      case "intro": return "#00ffff";
      case "outro": return "#0202ed";
      case "preview": return "#008fd6";
      case "music_offtopic": return "#ff9900";
      case "filler": return "#7300ff";
      default: return "#00d400";
    }
  }
  let segSig = "";
  function removeSegmentBar() {
    const o = $("ytls-segbar");
    if (o) o.remove();
    segSig = "";
  }
  function renderSegmentBar() {
    if (!settings.skipSponsors || !sbSegments.length) {
      removeSegmentBar();
      return;
    }
    const v = video();
    const bar = document.querySelector(".ytp-progress-bar") || document.querySelector(".ytp-progress-bar-container");
    if (!v || !bar) return;
    const dur = v.duration;
    if (!dur || !isFinite(dur) || dur <= 0) return;

    let overlay = $("ytls-segbar");
    const sig = currentVideoId() + "|" + Math.round(dur) + "|" + sbSegments.length;
    if (overlay && sig === segSig) return; // already drawn — don't thrash the DOM
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "ytls-segbar";
      overlay.style.cssText = "position:absolute;left:0;top:0;height:100%;width:100%;pointer-events:none;z-index:35;";
      bar.appendChild(overlay);
    }
    segSig = sig;
    overlay.textContent = "";
    const frag = document.createDocumentFragment();
    for (const seg of sbSegments) {
      const left = clamp((seg.start / dur) * 100, 0, 100);
      const width = Math.max(0.15, Math.min(100 - left, ((seg.end - seg.start) / dur) * 100));
      const d = document.createElement("div");
      d.style.cssText =
        "position:absolute;top:0;height:100%;left:" + left + "%;width:" + width + "%;background:" +
        categoryColor(seg.cat) + ";opacity:.85;";
      frag.appendChild(d);
    }
    overlay.appendChild(frag);
  }

  function trySkip(v) {
    if (!settings.skipSponsors || !sbSegments.length || v.paused) return;
    const t = v.currentTime;
    for (const seg of sbSegments) {
      if (t >= seg.start && t < seg.end - 0.2) {
        const saved = Math.max(0, seg.end - t);
        v.currentTime = seg.end;
        sbTimeSaved += saved;
        try {
          chrome.storage.local.set({ sbTimeSaved });
        } catch (_) {}
        sbToast(seg.cat, saved);
        break;
      }
    }
  }

  function sbToast(cat, saved) {
    try {
      const label = cat === "selfpromo" ? "self-promo" : cat === "interaction" ? "interaction reminder" : "sponsor";
      let el = $("ytls-toast");
      if (!el) {
        el = document.createElement("div");
        el.id = "ytls-toast";
        el.style.cssText =
          "position:fixed;left:24px;bottom:96px;z-index:99999;max-width:320px;" +
          "background:#1a1a1c;color:#f5f5f7;font-family:Roboto,Arial,sans-serif;" +
          "padding:12px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.12);" +
          "box-shadow:0 8px 24px rgba(0,0,0,.4);opacity:0;transform:translateY(8px);" +
          "transition:opacity .2s cubic-bezier(.4,0,.2,1),transform .2s cubic-bezier(.4,0,.2,1);pointer-events:none;";
        document.body.appendChild(el);
      }
      el.textContent = "";
      const t = document.createElement("div");
      t.style.cssText = "font-size:13px;font-weight:600;line-height:1.4;";
      t.textContent = "Skipped " + label;
      const s = document.createElement("div");
      s.style.cssText = "font-size:11px;color:#a8a8ad;margin-top:4px;line-height:1.4;";
      s.textContent = fmtDur(saved || 0) + " skipped · " + fmtDur(sbTimeSaved) + " saved in total";
      el.append(t, s);
      requestAnimationFrame(() => {
        el.style.opacity = "1";
        el.style.transform = "none";
      });
      clearTimeout(el.__t);
      el.__t = setTimeout(() => {
        el.style.opacity = "0";
        el.style.transform = "translateY(8px)";
      }, 3000);
    } catch (_) {}
  }

  /* ---------- BLOCK ADS ---------- */
  const AD_STYLE_ID = "ytls-adblock-style";
  const AD_CSS = `
    #player-ads, #masthead-ad, ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer,
    ytd-banner-promo-renderer, ytd-statement-banner-renderer,
    ytd-promoted-sparkles-web-renderer, ytd-companion-slot-renderer,
    ytd-action-companion-ad-renderer, .ytp-ad-overlay-slot,
    .ytp-ad-overlay-container, #clarify-box,
    ytd-rich-item-renderer:has(ytd-ad-slot-renderer) {
      display: none !important;
    }
  `;
  function setAdStyle(on) {
    const ex = $(AD_STYLE_ID);
    if (on) {
      if (!ex) {
        const s = document.createElement("style");
        s.id = AD_STYLE_ID;
        s.textContent = AD_CSS;
        (document.head || document.documentElement).appendChild(s);
      }
    } else if (ex) {
      ex.remove();
    }
  }

  let adActive = false;
  let adSeekedFor = null;

  const SKIP_SELECTORS = [
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button",
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button-container button",
    ".ytp-ad-skip-button-slot button",
  ];
  function clickSkip(player) {
    for (const s of SKIP_SELECTORS) {
      const btn = document.querySelector(s);
      if (btn) {
        try {
          btn.click();
        } catch (_) {}
        return true;
      }
    }
    // Text fallback for newer ad layouts — only ever runs while an ad is on screen.
    if (player) {
      const cands = player.querySelectorAll('button, [role="button"]');
      for (const b of cands) {
        const t = (b.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (/^skip( ads?)?$/.test(t)) {
          try {
            b.click();
          } catch (_) {}
          return true;
        }
      }
    }
    return false;
  }

  function handleAds() {
    if (!settings.blockAds) return;
    const player = $("movie_player") || document.querySelector(".html5-video-player");
    const isAd = !!(player && player.classList.contains("ad-showing"));

    if (!isAd && !adActive) {
      // Cheap idle path: overlay banners + the "ad blockers not allowed" popup.
      const ov = document.querySelector(".ytp-ad-overlay-close-button, .ytp-ad-overlay-close-container");
      if (ov) {
        try {
          ov.click();
        } catch (_) {}
      }
      const enforce = document.querySelector("ytd-enforcement-message-view-model");
      if (enforce) {
        const dlg = enforce.closest("tp-yt-paper-dialog") || enforce;
        try {
          dlg.remove();
        } catch (_) {}
        document.querySelectorAll("tp-yt-iron-overlay-backdrop").forEach((b) => b.remove());
        const v = video();
        if (v && v.paused) v.play().catch(() => {});
      }
      return;
    }

    const v = video();
    if (isAd && v) {
      adActive = true;
      clickSkip(player);
      // Seek past the ad once per ad (not every tick — repeated seeks stutter).
      try {
        const d = v.duration;
        if (isFinite(d) && d > 0) {
          if (adSeekedFor !== d) {
            adSeekedFor = d;
            v.currentTime = d;
          }
        } else if (v.playbackRate < 16) {
          v.playbackRate = 16;
        }
      } catch (_) {}
    } else if (adActive) {
      adActive = false;
      adSeekedFor = null;
      applySpeed(true); // restore our speed (or 1×) after the ad
    }
  }

  let adTimer = null;
  function scheduleAdTick() {
    clearTimeout(adTimer);
    adTimer = setTimeout(() => {
      if (!alive()) return;
      try {
        handleAds();
      } catch (_) {}
      scheduleAdTick();
    }, adActive ? 150 : 500);
  }

  /* ---------- VOLUME BOOST (Web Audio, up to 500%) ---------- */
  let audioCtx = null;
  let unlockArmed = false;

  function userHasInteracted() {
    try {
      return !navigator.userActivation || navigator.userActivation.hasBeenActive;
    } catch (_) {
      return true;
    }
  }
  function armAudioUnlock() {
    if (unlockArmed) return;
    unlockArmed = true;
    const go = () => {
      unlockArmed = false;
      applyBoost();
    };
    ["pointerdown", "keydown"].forEach((t) => document.addEventListener(t, go, { once: true, capture: true }));
  }

  function audioGraphFor(v) {
    if (v.__ctAudio) return v.__ctAudio;
    // Routing a <video> through Web Audio while the context is suspended
    // silences it. Only build the graph once the browser lets audio run.
    if (!userHasInteracted()) {
      armAudioUnlock();
      return null;
    }
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
      const src = audioCtx.createMediaElementSource(v);
      const gain = audioCtx.createGain();
      const limiter = audioCtx.createDynamicsCompressor(); // tames clipping at high boost
      limiter.threshold.value = -6;
      limiter.knee.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.2;
      src.connect(gain);
      gain.connect(limiter);
      limiter.connect(audioCtx.destination);
      v.__ctAudio = { gain, limiter };
      return v.__ctAudio;
    } catch (_) {
      return null;
    }
  }

  function applyBoost() {
    const v = video();
    if (!v) return;
    const boost = clamp(Number(settings.volumeBoost) || 100, 100, 500) / 100;
    // Don't touch the audio path at all until a boost is requested.
    if (boost <= 1 && !v.__ctAudio) return;
    const g = audioGraphFor(v);
    if (!g || !audioCtx) return;
    g.gain.gain.setTargetAtTime(boost, audioCtx.currentTime, 0.03);
    g.limiter.ratio.value = boost > 1 ? 8 : 1;
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  }

  /* ---------- SHOW DISLIKES (Return YouTube Dislike API) ---------- */
  let dislikeVid = null;
  let lastDislikes = null;

  function fmtCount(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
    return String(n);
  }
  async function loadDislikes() {
    if (!settings.showDislikes) return;
    const vid = currentVideoId();
    if (!vid) return;
    if (vid !== dislikeVid) {
      dislikeVid = vid;
      lastDislikes = null;
      try {
        const resp = await chrome.runtime.sendMessage({ type: "GET_DISLIKES", videoId: vid });
        if (vid === currentVideoId() && resp && resp.ok && typeof resp.dislikes === "number") {
          lastDislikes = resp.dislikes;
        }
      } catch (_) {}
    }
    injectDislikes();
  }
  function injectDislikes() {
    if (!settings.showDislikes || lastDislikes == null) return;
    const btn =
      document.querySelector("dislike-button-view-model button") ||
      document.querySelector("#segmented-dislike-button button") ||
      document.querySelector("ytd-toggle-button-renderer#dislike-button button");
    if (!btn) return;
    let span = btn.querySelector(".yt-spec-button-shape-next__button-text-content");
    if (!span) {
      span = document.createElement("div");
      span.className = "yt-spec-button-shape-next__button-text-content";
      btn.appendChild(span);
    }
    const text = fmtCount(lastDislikes);
    if (span.textContent !== text) span.textContent = text;
  }

  /* ---------- HIDE SHORTS ---------- */
  const STYLE_ID = "ytls-hide-shorts-style";
  const HIDE_CSS = `
    ytd-rich-shelf-renderer[is-shorts],
    ytd-reel-shelf-renderer,
    grid-shelf-view-model,
    ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
    ytd-rich-section-renderer:has([overlay-style="SHORTS"]),
    ytd-guide-entry-renderer:has(a[title="Shorts"]),
    ytd-mini-guide-entry-renderer[aria-label="Shorts"],
    a#endpoint[title="Shorts"],
    ytd-video-renderer:has(a[href^="/shorts"]),
    ytd-grid-video-renderer:has(a[href^="/shorts"]),
    ytd-rich-item-renderer:has(a[href^="/shorts"]),
    ytm-shorts-lockup-view-model,
    yt-chip-cloud-chip-renderer:has(yt-formatted-string[title="Shorts"]) {
      display: none !important;
    }
  `;
  function setShortsHidden(on) {
    const existing = $(STYLE_ID);
    if (on) {
      if (!existing) {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = HIDE_CSS;
        (document.head || document.documentElement).appendChild(style);
      }
    } else if (existing) {
      existing.remove();
    }
  }
  function maybeRedirectShorts() {
    if (!settings.hideShorts || !settings.redirectShorts) return;
    const m = location.pathname.match(/^\/shorts\/([\w-]+)/);
    if (m) location.replace("https://www.youtube.com/watch?v=" + m[1]);
  }

  /* ---------- PLAYBACK SPEED ---------- */
  const SPEED_MIN = 0.25;
  const SPEED_MAX = 100;
  const SLIDER_STEPS = 1000;
  const DEFAULT_PRESETS = [1, 1.5, 2, 2.5, 3, 5, 10];
  const BASE_SNAPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 10, 16, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  function parseSpeedPresets(str) {
    const raw = String(str || "").split(/[\s,]+/);
    const parsed = raw.map(Number).filter((n) => isFinite(n) && n >= SPEED_MIN && n <= SPEED_MAX);
    const set = Array.from(new Set(parsed)).sort((a, b) => a - b);
    return set.length ? set : DEFAULT_PRESETS.slice();
  }
  let snapCache = { key: null, pts: [] };
  function snapPoints() {
    const key = String(settings.speedPresets || "");
    if (snapCache.key !== key) {
      snapCache = {
        key,
        pts: Array.from(new Set([...BASE_SNAPS, ...parseSpeedPresets(key)])).sort((a, b) => a - b),
      };
    }
    return snapCache.pts;
  }

  // Browsers clamp playbackRate at 16×. Above that we nudge currentTime
  // forward on a timer ("turbo"), skipping ticks while the player is
  // seeking/buffering so seeks never pile up.
  let turboTimer = null;
  let turboSpeed = 0;
  const TURBO_MS = 200;
  function startTurbo(s) {
    if (turboTimer && turboSpeed === s) return;
    stopTurbo();
    turboSpeed = s;
    turboTimer = setInterval(() => {
      const v = video();
      if (!v || v.paused || v.seeking || v.readyState < 3 || isAdShowing()) return;
      try {
        const next = v.currentTime + (turboSpeed - 16) * (TURBO_MS / 1000);
        v.currentTime = isFinite(v.duration) ? Math.min(next, v.duration - 0.25) : next;
      } catch (_) {}
    }, TURBO_MS);
  }
  function stopTurbo() {
    if (turboTimer) clearInterval(turboTimer);
    turboTimer = null;
    turboSpeed = 0;
  }

  // At 1× we leave YouTube's own speed menu alone unless `force` is set.
  function applySpeed(force) {
    const v = video();
    if (!v) return;
    const s = clamp(Number(settings.speed) || 1, SPEED_MIN, SPEED_MAX);
    if (!force && s === 1 && !turboTimer) return;
    const native = Math.min(16, s);
    try {
      if (Math.abs(v.playbackRate - native) > 0.001) v.playbackRate = native;
    } catch (_) {}
    if (s > 16) startTurbo(s);
    else stopTurbo();
  }
  function setSpeed(s, commit) {
    settings.speed = s;
    if (commit) persist({ speed: s });
    applySpeed(true);
  }
  function setVolumeBoost(v, commit) {
    settings.volumeBoost = v;
    if (commit) persist({ volumeBoost: v });
    applyBoost();
  }

  // Slider position is logarithmic so 0.25×–100× gets proportionate resolution.
  function speedToPos(s) {
    const c = clamp(s, SPEED_MIN, SPEED_MAX);
    return Math.round((SLIDER_STEPS * Math.log(c / SPEED_MIN)) / Math.log(SPEED_MAX / SPEED_MIN));
  }
  function posToSpeed(pos) {
    return SPEED_MIN * Math.pow(SPEED_MAX / SPEED_MIN, pos / SLIDER_STEPS);
  }
  function niceRound(s) {
    if (s < 1) return Math.round(s * 20) / 20;
    if (s < 10) return Math.round(s * 10) / 10;
    return Math.round(s);
  }
  // Magnetic snap: pull toward the nearest snap point when within ~6% (log distance).
  function magnetize(s) {
    let best = null;
    let bestDist = Infinity;
    for (const p of snapPoints()) {
      const dist = Math.abs(Math.log(s / p));
      if (dist < bestDist) {
        bestDist = dist;
        best = p;
      }
    }
    return bestDist < 0.06 ? { value: best, snapped: true } : { value: niceRound(s), snapped: false };
  }
  function fmtSpeed(s) {
    return (Math.abs(s - Math.round(s)) < 0.001 ? Math.round(s) : Math.round(s * 100) / 100) + "×";
  }

  /* ---------- CONTROL BAR (under the player) ----------
   * Design rules (Apple HIG-style audit):
   *  Layout       one 44px row; presets live in a popover, toggles are icons
   *  Type scale   11 caption · 13 body · 15 speed value (accent, the focal point)
   *  Spacing      4px grid → 4 / 6 / 8 / 12
   *  Contrast     text ≥ 4.5:1, track/controls ≥ 3:1 in dark and light themes
   *  Motion       120–200ms, cubic-bezier(.4,0,.2,1), transform/opacity/color only
   */
  const BAR_CSS = `
    :host{
      all:initial;display:block;position:relative;z-index:5;margin:22px 0 8px;contain:layout;
      font-family:Roboto,"YouTube Noto",Arial,sans-serif;color:var(--text);
      --ease:cubic-bezier(.4,0,.2,1);--amb:255 82 119;
      --surface:#1a1a1c;--border:rgba(255,255,255,.10);--text:#f5f5f7;--text2:#a8a8ad;
      --track:rgba(255,255,255,.32);--accent:#ff5277;--accent-soft:rgba(255,82,119,.16);
      --on-accent:#1a1a1c;--hover:rgba(255,255,255,.08);--thumb:#fff;--tip-bg:#f5f5f7;--tip-fg:#0f0f0f;
    }
    :host([data-theme="light"]){
      --surface:#f6f6f7;--border:rgba(0,0,0,.10);--text:#0f0f0f;--text2:#5f5f66;
      --track:rgba(0,0,0,.45);--accent:#d11f4b;--accent-soft:rgba(209,31,75,.10);
      --on-accent:#fff;--hover:rgba(0,0,0,.06);--tip-bg:#1a1a1c;--tip-fg:#fff;
    }
    *{box-sizing:border-box;margin:0;padding:0}

    /* Bar hugs its content instead of stretching across the page. */
    .bar{
      position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;width:fit-content;max-width:100%;
      min-height:46px;padding:6px 10px 6px 16px;background:var(--surface);border:1px solid var(--border);border-radius:12px;
      animation:enter .24s var(--ease);
      transition:opacity .4s var(--ease),box-shadow .9s ease,border-color .9s ease;
    }
    @keyframes enter{from{opacity:0;transform:translateY(4px)}}
    /* Ambient glow: the bar picks up the video's colors. */
    .bar::before{
      content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;
      background:linear-gradient(100deg,rgb(var(--amb) / .16),transparent 60%);transition:opacity .6s ease;
    }
    :host([data-glow]) .bar{border-color:rgb(var(--amb) / .35);box-shadow:0 8px 26px -10px rgb(var(--amb) / .7)}
    :host([data-glow]) .bar::before{opacity:1}
    :host([data-glow]) .brand i{background:rgb(var(--amb));box-shadow:0 0 8px rgb(var(--amb))}
    /* Auto-fade: dims while the video plays and you're not using the bar. */
    :host([data-idle]) .bar{opacity:.3}
    :host([data-playing]) .brand i{animation:breathe 2.4s ease-in-out infinite}
    @keyframes breathe{50%{opacity:.45;transform:scale(.8)}}

    .bar>*{position:relative}
    [data-tip]{position:relative}
    span[data-tip]{display:inline-flex}
    .brand{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;white-space:nowrap}
    .brand i{width:6px;height:6px;border-radius:50%;background:var(--accent);transition:background-color .9s ease}
    .sep{width:1px;height:20px;background:var(--border)}
    .grp{position:relative;display:flex;align-items:center;gap:8px;min-width:0}
    .end{display:flex;align-items:center;gap:4px}
    .end .vr{width:1px;height:16px;margin:0 4px;background:var(--border)}

    .val{
      width:50px;height:28px;padding:0 6px;border:1px solid transparent;border-radius:8px;background:transparent;
      font:600 15px Roboto,Arial,sans-serif;color:var(--accent);font-variant-numeric:tabular-nums;outline:none;
      transition:border-color .12s var(--ease),background-color .12s var(--ease);
    }
    .val:hover{background:var(--hover)}
    .val:focus{border-color:var(--accent);background:transparent}
    .val.bump{animation:bump .18s var(--ease)}
    @keyframes bump{50%{transform:scale(1.12)}}
    .num{min-width:36px;font-size:13px;font-weight:500;color:var(--text2);font-variant-numeric:tabular-nums;text-align:right}

    .slider{position:relative;flex:none;width:168px}
    .vol .slider{width:104px}
    input[type=range]{
      -webkit-appearance:none;appearance:none;display:block;width:100%;height:20px;background:transparent;cursor:pointer;--p:0%;border-radius:6px;
    }
    input[type=range]::-webkit-slider-runnable-track{
      height:4px;border-radius:999px;background:linear-gradient(to right,var(--accent) var(--p),var(--track) var(--p));
    }
    input[type=range]::-webkit-slider-thumb{
      -webkit-appearance:none;appearance:none;width:14px;height:14px;margin-top:-5px;border-radius:50%;
      background:var(--thumb);border:0;box-shadow:0 0 0 1px rgba(0,0,0,.18),0 1px 3px rgba(0,0,0,.35);
      transition:transform .12s var(--ease),box-shadow .6s ease;
    }
    :host([data-glow]) input[type=range]::-webkit-slider-thumb{box-shadow:0 0 0 1px rgba(0,0,0,.18),0 0 10px 1px rgb(var(--amb) / .9)}
    input[type=range]:active::-webkit-slider-thumb{transform:scale(1.18)}
    :is(input,button):focus-visible{outline:2px solid var(--accent);outline-offset:2px}

    button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
    .ib{
      position:relative;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;color:var(--text2);flex:none;
      transition:background-color .12s var(--ease),color .12s var(--ease),transform .1s var(--ease);
    }
    .ib:hover{background:var(--hover);color:var(--text)}
    .ib[aria-pressed=true]{background:var(--accent-soft);color:var(--accent)}
    :is(.ib,.chip,.seg button,.primary):active{transform:scale(.92)}
    .ib svg,.glyph svg,.seg svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
    .glyph{display:inline-flex;color:var(--text2);flex:none}

    /* Instant labelled tooltips so every icon says what it does. */
    [data-tip]::after{
      content:attr(data-tip);position:absolute;bottom:calc(100% + 8px);left:50%;z-index:20;transform:translate(-50%,4px);
      white-space:nowrap;padding:4px 8px;border-radius:6px;background:var(--tip-bg);color:var(--tip-fg);
      font:500 12px/16px Roboto,Arial,sans-serif;opacity:0;pointer-events:none;
      transition:opacity .12s var(--ease),transform .12s var(--ease);
    }
    [data-tip]:hover::after,[data-tip]:focus-visible::after{opacity:1;transform:translate(-50%,0);transition-delay:.2s}

    .seg{display:inline-flex;flex:none;padding:2px;gap:2px;border-radius:8px;background:var(--hover)}
    .seg button{position:relative;display:inline-flex;align-items:center;justify-content:center;width:26px;height:24px;border-radius:6px;color:var(--text2);
      transition:background-color .12s var(--ease),color .12s var(--ease),transform .1s var(--ease)}
    .seg button:hover{color:var(--text)}
    .seg button[aria-pressed=true]{background:var(--accent-soft);color:var(--accent)}

    .chips{display:flex;flex-wrap:wrap;gap:6px}
    .chip{
      height:28px;padding:0 10px;border:1px solid var(--border);border-radius:999px;font-size:13px;font-weight:500;color:var(--text2);
      font-variant-numeric:tabular-nums;transition:background-color .12s var(--ease),color .12s var(--ease),border-color .12s var(--ease),transform .1s var(--ease);
    }
    .chip:hover{background:var(--hover);color:var(--text)}
    .chip[aria-pressed=true]{background:var(--accent-soft);border-color:var(--accent);color:var(--accent)}
    .inline{flex:none;max-width:340px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}
    .inline::-webkit-scrollbar{display:none}
    .inline .chip{flex:none;padding:0 8px}
    [hidden]{display:none!important}

    .pop{
      position:absolute;z-index:30;top:calc(100% + 10px);left:0;width:300px;max-width:calc(100vw - 32px);display:grid;gap:10px;padding:12px;
      background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.35);
      opacity:0;transform:translateY(4px);pointer-events:none;transition:opacity .16s var(--ease),transform .16s var(--ease);
    }
    .pop.open{opacity:1;transform:none;pointer-events:auto}
    .cap{font-size:11px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;color:var(--text2)}
    .pop input[type=text]{
      width:100%;height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--border);
      background:transparent;color:var(--text);font:500 13px Roboto,Arial,sans-serif;outline:none;
    }
    .pop input[type=text]:focus{border-color:var(--accent)}
    .row{display:flex;justify-content:space-between;align-items:center;gap:8px}
    .primary{height:28px;padding:0 14px;border-radius:999px;background:var(--accent);color:var(--on-accent);font-size:13px;font-weight:600;transition:transform .1s var(--ease)}
    .ghost{height:28px;padding:0 10px;border-radius:999px;font-size:13px;color:var(--text2)}
    .ghost:hover{background:var(--hover);color:var(--text)}
    @media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
    @media (prefers-contrast:more){
      :host{--text2:#d1d1d6;--border:rgba(255,255,255,.4);--track:rgba(255,255,255,.6)}
      :host([data-theme="light"]){--text2:#3a3a40;--border:rgba(0,0,0,.5);--track:rgba(0,0,0,.65)}
    }
  `;

  const ICONS = {
    settings: '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
    modeSlider: '<svg viewBox="0 0 24 24"><path d="M3 12h18"/><circle cx="9" cy="12" r="2.6" fill="currentColor"/></svg>',
    modeButtons: '<svg viewBox="0 0 24 24"><rect x="2.5" y="8" width="5.5" height="8" rx="2"/><rect x="9.25" y="8" width="5.5" height="8" rx="2"/><rect x="16" y="8" width="5.5" height="8" rx="2"/></svg>',
    volume: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/></svg>',
    loop: '<svg viewBox="0 0 24 24"><path d="M17 3l3 3-3 3"/><path d="M4 11V10a4 4 0 014-4h12"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v1a4 4 0 01-4 4H4"/></svg>',
    // skip-forward = jump over sponsor segments
    skipSponsors: '<svg viewBox="0 0 24 24"><path d="M5 5.5v13l9-6.5z"/><path d="M19 5v14"/></svg>',
    // shield with a cross = block ads
    blockAds: '<svg viewBox="0 0 24 24"><path d="M12 3l7.5 3v5.5c0 4.4-3 7.7-7.5 9.5-4.5-1.800-7.500-5.100-7.500-9.500V6z"/><path d="M9.200 9.700l5.600 5.600M14.800 9.700l-5.600 5.600"/></svg>',
    // vertical Shorts card with a strike = hide Shorts
    hideShorts: '<svg viewBox="0 0 24 24"><rect x="6.500" y="2.500" width="11" height="19" rx="3"/><path d="M10.500 9.500v5l4-2.500z"/><path d="M3.500 3.500l17 17"/></svg>',
    // sun with rays = ambient glow
    ambientGlow: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.500v2M12 19.500v2M2.500 12h2M19.500 12h2M5.300 5.300l1.400 1.400M17.300 17.300l1.400 1.400M5.300 18.700l1.400-1.400M17.300 6.700l1.400-1.400"/></svg>',
    // half-filled circle = fades out
    autoFadeUI: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.500"/><path d="M12 3.500a8.500 8.500 0 010 17z" fill="currentColor"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>',
  };
  const PROFILES = [
    ["Default", "1, 1.5, 2, 2.5, 3, 5, 10"],
    ["Casual", "0.75, 1, 1.25, 1.5, 1.75, 2"],
    ["Study", "1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3"],
    ["Ultra", "1, 2, 5, 10, 20, 50, 100"],
  ];
  const TOGGLES = [
    ["loop", "Loop video"],
    ["skipSponsors", "Skip sponsors"],
    ["blockAds", "Block ads"],
    ["hideShorts", "Hide Shorts"],
  ];
  const EFFECTS = [
    ["ambientGlow", "Ambient glow"],
    ["autoFadeUI", "Auto-fade bar"],
  ];

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (k === "class") e.className = v;
        else if (k === "html") e.innerHTML = v; // only ever called with static literals above
        else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v);
      }
    }
    for (const c of kids) if (c != null) e.append(c);
    return e;
  }

  let barUI = null;

  function paintRange(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const f = (Number(input.value) - min) / (max - min);
    input.style.setProperty("--p", "calc(7px + (100% - 14px) * " + f + ")");
  }

  function bumpValue() {
    if (!barUI) return;
    const el = barUI.hero;
    el.classList.remove("bump");
    void el.offsetWidth; // restart the animation
    el.classList.add("bump");
  }

  function createBar() {
    const host = h("div", { id: "ct-bar" });
    const root = host.attachShadow({ mode: "open" });
    root.append(h("style", null, BAR_CSS));
    ["keydown", "keyup", "keypress"].forEach((t) => host.addEventListener(t, (e) => e.stopPropagation()));
    // Any interaction with the bar wakes it from auto-fade.
    ["pointerenter", "pointerdown", "focusin"].forEach((t) => host.addEventListener(t, () => bumpActivity()));

    const ui = { host, root, chips: [], togs: {}, fx: {} };

    /* speed value (type an exact number) */
    ui.hero = h("input", { class: "val", type: "text", inputmode: "decimal", spellcheck: "false", "aria-label": "Playback speed" });
    const heroWrap = h("span", { "data-tip": "Speed — click to type" }, ui.hero);
    const commitHero = () => {
      const n = parseFloat(String(ui.hero.value).replace(/[×x\s]/gi, ""));
      if (isFinite(n)) {
        setSpeed(clamp(Math.round(n * 100) / 100, SPEED_MIN, SPEED_MAX), true);
        bumpValue();
      }
      syncBar();
    };
    ui.hero.addEventListener("focus", () => ui.hero.select());
    ui.hero.addEventListener("change", commitHero);
    ui.hero.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        ui.hero.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        syncBar();
        ui.hero.blur();
      }
    });

    /* speed slider (log scale 0.25×–100×, magnetic) */
    ui.speed = h("input", { type: "range", min: "0", max: String(SLIDER_STEPS), step: "2", "aria-label": "Playback speed slider" });
    ui.speed.addEventListener("input", () => {
      const m = magnetize(posToSpeed(Number(ui.speed.value)));
      if (m.snapped) ui.speed.value = String(speedToPos(m.value));
      paintRange(ui.speed);
      if (ui.hero.value !== fmtSpeed(m.value)) {
        ui.hero.value = fmtSpeed(m.value);
        if (m.snapped) bumpValue();
      }
      ui.speed.setAttribute("aria-valuetext", fmtSpeed(m.value));
      markChips(m.value);
      setSpeed(m.value, false);
    });
    ui.speed.addEventListener("change", () => setSpeed(magnetize(posToSpeed(Number(ui.speed.value))).value, true));
    ui.sliderWrap = h("div", { class: "slider" }, ui.speed);
    ui.inlineRow = h("div", { class: "chips inline", role: "group", "aria-label": "Speed presets" });

    /* slider ↔ buttons switch */
    ui.modeBtns = {
      slider: h("button", { type: "button", "data-tip": "Speed slider", "aria-label": "Speed slider", html: ICONS.modeSlider }),
      buttons: h("button", { type: "button", "data-tip": "Speed buttons", "aria-label": "Speed buttons", html: ICONS.modeButtons }),
    };
    for (const mode of Object.keys(ui.modeBtns)) {
      ui.modeBtns[mode].addEventListener("click", () => {
        if (settings.speedMode === mode) return;
        settings.speedMode = mode;
        persist({ speedMode: mode });
        syncMode();
      });
    }
    const seg = h("div", { class: "seg", role: "group", "aria-label": "Speed control style" }, ui.modeBtns.slider, ui.modeBtns.buttons);

    /* settings popover: presets + effects */
    const settingsBtn = h("button", { class: "ib", type: "button", "data-tip": "Speed presets", "aria-label": "Speed presets", "aria-haspopup": "dialog", html: ICONS.settings });
    ui.chipRow = h("div", { class: "chips" });
    const pop = h("div", { class: "pop", role: "dialog", "aria-label": "Speed presets" });
    const popInput = h("input", { type: "text", placeholder: "e.g. 1, 1.5, 2, 3, 5", "aria-label": "Custom presets, comma-separated" });
    const closePop = () => {
      pop.classList.remove("open");
      settingsBtn.setAttribute("aria-expanded", "false");
    };
    // HIG: a self-closing popover keeps the person's work — Done, Enter and
    // clicking outside all save. Only Escape discards.
    const savePop = () => {
      if (!pop.classList.contains("open")) return;
      const formatted = parseSpeedPresets(popInput.value).join(", ");
      if (formatted !== settings.speedPresets) {
        settings.speedPresets = formatted;
        persist({ speedPresets: formatted });
        renderPresets(true);
        markChips(clamp(Number(settings.speed) || 1, SPEED_MIN, SPEED_MAX));
      }
      closePop();
    };
    pop.append(
      h("div", { class: "cap" }, "Quick speeds"),
      ui.chipRow,
      h("div", { class: "cap" }, "Preset profiles"),
      h("div", { class: "chips" }, ...PROFILES.map(([name, val]) => h("button", { class: "chip", type: "button", onclick: () => (popInput.value = val) }, name))),
      popInput,
      h(
        "div",
        { class: "row" },
        h("button", { class: "ghost", type: "button", onclick: () => (popInput.value = DEFAULTS.speedPresets) }, "Reset presets"),
        h("button", { class: "primary", type: "button", onclick: savePop }, "Done")
      )
    );
    popInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        savePop();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closePop();
      }
    });
    settingsBtn.addEventListener("click", () => {
      if (pop.classList.contains("open")) return savePop();
      popInput.value = settings.speedPresets || DEFAULTS.speedPresets;
      pop.classList.add("open");
      settingsBtn.setAttribute("aria-expanded", "true");
    });
    ui.closePop = savePop;
    ui.pop = pop;
    ui.editBtn = settingsBtn;

    const speedGrp = h("div", { class: "grp speed" }, heroWrap, ui.sliderWrap, ui.inlineRow, seg, settingsBtn, pop);

    /* volume boost */
    ui.volVal = h("span", { class: "num" }, "100%");
    ui.vol = h("input", { type: "range", min: "100", max: "500", step: "10", "aria-label": "Volume boost" });
    ui.vol.addEventListener("input", () => {
      ui.volVal.textContent = ui.vol.value + "%";
      paintRange(ui.vol);
      setVolumeBoost(Number(ui.vol.value), false);
    });
    ui.vol.addEventListener("change", () => setVolumeBoost(Number(ui.vol.value), true));
    const volGrp = h(
      "div",
      { class: "grp vol" },
      h("span", { class: "glyph", "data-tip": "Volume boost (up to 500%)", html: ICONS.volume }),
      h("div", { class: "slider" }, ui.vol),
      ui.volVal
    );

    /* feature toggles + download */
    const end = h("div", { class: "end" });
    for (const [key, label] of TOGGLES) {
      const b = h("button", { class: "ib", type: "button", "aria-pressed": "false", "aria-label": label, html: ICONS[key] });
      b.addEventListener("click", () => {
        settings[key] = !settings[key];
        persist({ [key]: settings[key] });
        syncToggle(b, key, label);
        queueApply();
      });
      ui.togs[key] = [b, label];
      end.append(b);
    }
    end.append(h("span", { class: "vr" }));
    for (const [key, label] of EFFECTS) {
      const b = h("button", { class: "ib", type: "button", "aria-pressed": "false", "aria-label": label, html: ICONS[key] });
      b.addEventListener("click", () => {
        settings[key] = !settings[key];
        persist({ [key]: settings[key] });
        syncToggle(b, key, label);
        applyEffects();
      });
      ui.togs[key] = [b, label];
      end.append(b);
    }
    const dlBtn = h("button", { class: "ib", type: "button", "data-tip": "Download — choose quality", "aria-label": "Download", html: ICONS.download });
    dlBtn.addEventListener("click", () => {
      try {
        chrome.runtime.sendMessage({ type: "OPEN_DOWNLOAD" });
      } catch (_) {}
    });

    root.append(
      h(
        "div",
        { class: "bar" },
        h("div", { class: "brand" }, h("i"), "ClearTube"),
        h("span", { class: "sep" }),
        speedGrp,
        h("span", { class: "sep" }),
        volGrp,
        h("span", { class: "sep" }),
        end,
        h("span", { class: "sep" }),
        dlBtn
      )
    );
    return ui;
  }

  function syncToggle(b, key, label) {
    const on = !!settings[key];
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("data-tip", label + (on ? " · On" : " · Off"));
  }

  function syncMode() {
    const ui = barUI;
    if (!ui) return;
    const buttons = settings.speedMode === "buttons";
    ui.sliderWrap.hidden = buttons;
    ui.inlineRow.hidden = !buttons;
    ui.modeBtns.slider.setAttribute("aria-pressed", String(!buttons));
    ui.modeBtns.buttons.setAttribute("aria-pressed", String(buttons));
  }

  function markChips(val) {
    if (!barUI) return;
    for (const c of barUI.chips) c.setAttribute("aria-pressed", String(Math.abs(Number(c.dataset.v) - val) < 0.01));
  }

  let presetKey = null;
  function renderPresets(force) {
    const ui = barUI;
    const key = String(settings.speedPresets || "");
    if (!ui || (!force && key === presetKey)) return;
    presetKey = key;
    ui.chipRow.textContent = "";
    ui.inlineRow.textContent = "";
    ui.chips = [];
    for (const p of parseSpeedPresets(key)) {
      for (const row of [ui.inlineRow, ui.chipRow]) {
        const chip = h("button", { class: "chip", type: "button", "data-v": String(p), "aria-pressed": "false" }, fmtSpeed(p));
        chip.addEventListener("click", () => {
          ui.speed.value = String(speedToPos(p));
          paintRange(ui.speed);
          ui.hero.value = fmtSpeed(p);
          markChips(p);
          bumpValue();
          setSpeed(p, true);
        });
        ui.chips.push(chip);
        row.append(chip);
      }
    }
  }

  // Update the existing bar in place from `settings` — never rebuild it.
  function syncBar() {
    const ui = barUI;
    if (!ui) return;
    const cur = clamp(Number(settings.speed) || 1, SPEED_MIN, SPEED_MAX);
    if (ui.root.activeElement !== ui.hero) ui.hero.value = fmtSpeed(cur);
    ui.speed.value = String(speedToPos(cur));
    ui.speed.setAttribute("aria-valuetext", fmtSpeed(cur));
    paintRange(ui.speed);
    renderPresets(false);
    syncMode();
    markChips(cur);
    const vol = clamp(Number(settings.volumeBoost) || 100, 100, 500);
    ui.vol.value = String(vol);
    ui.volVal.textContent = vol + "%";
    paintRange(ui.vol);
    for (const key of Object.keys(ui.togs)) syncToggle(ui.togs[key][0], key, ui.togs[key][1]);
    for (const key of Object.keys(ui.fx)) ui.fx[key].setAttribute("aria-pressed", String(!!settings[key]));
    const theme = document.documentElement.hasAttribute("dark") ? "dark" : "light";
    if (ui.host.getAttribute("data-theme") !== theme) ui.host.setAttribute("data-theme", theme);
  }

  /* ---------- EFFECTS: ambient glow + auto-fade ----------
   * Safe versions of the old effects. They only restyle our own bar plus a
   * box-shadow on the player — never YouTube's layout (no position, overflow,
   * border or page-wide visibility changes), and the color is sampled once a
   * second from an 8×4 thumbnail, not every 120ms.
   */
  let ambCanvas = null;
  let ambCtx = null;
  let ambLast = "";
  let glowEl = null;

  function clearPlayerGlow() {
    if (glowEl) {
      glowEl.style.boxShadow = "";
      glowEl.style.transition = "";
      glowEl = null;
    }
  }
  function stopAmbient() {
    ambLast = "";
    clearPlayerGlow();
    if (barUI) barUI.host.removeAttribute("data-glow");
  }

  function sampleAmbient() {
    if (!settings.ambientGlow || !barUI) return;
    const v = video();
    if (!v || v.paused || v.readyState < 2 || !v.videoWidth || isAdShowing()) return;
    try {
      if (!ambCanvas) {
        ambCanvas = document.createElement("canvas");
        ambCanvas.width = 8;
        ambCanvas.height = 4;
        ambCtx = ambCanvas.getContext("2d", { willReadFrequently: true });
      }
      ambCtx.drawImage(v, 0, 0, 8, 4);
      const d = ambCtx.getImageData(0, 0, 8, 4).data;
      let r = 0, g = 0, b = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
      }
      r /= n;
      g /= n;
      b /= n;
      // Lift brightness and saturation so the glow reads on a dark page.
      const gray = (r + g + b) / 3;
      const sat = (c) => gray + (c - gray) * 1.7;
      r = sat(r);
      g = sat(g);
      b = sat(b);
      const mx = Math.max(r, g, b, 1);
      const lift = Math.min(3, 230 / mx);
      const rgb = [r, g, b].map((c) => clamp(Math.round(c * lift), 0, 255)).join(" ");
      if (rgb === ambLast) return;
      ambLast = rgb;
      barUI.host.style.setProperty("--amb", rgb);
      barUI.host.setAttribute("data-glow", "");
      const target = document.querySelector("#ytd-player") || $("movie_player");
      if (target) {
        if (glowEl && glowEl !== target) clearPlayerGlow();
        glowEl = target;
        target.style.transition = "box-shadow .9s ease";
        target.style.boxShadow = "0 0 56px 4px rgb(" + rgb.replace(/ /g, ",") + ",0.32)";
      }
    } catch (_) {}
  }

  let fadeTimer = null;
  let lastActivity = 0;
  function setIdle(on) {
    if (barUI) barUI.host.toggleAttribute("data-idle", !!on);
  }
  function bumpActivity() {
    setIdle(false);
    clearTimeout(fadeTimer);
    const v = video();
    if (!settings.autoFadeUI || !barUI || !v || v.paused) return;
    fadeTimer = setTimeout(() => {
      if (!barUI) return;
      const busy = barUI.pop.classList.contains("open") || barUI.root.activeElement || barUI.host.matches(":hover");
      if (busy) return bumpActivity();
      const vv = video();
      if (vv && !vv.paused) setIdle(true);
    }, 3000);
  }
  const onActivity = () => {
    const now = Date.now();
    if (now - lastActivity < 250) return; // throttle mousemove
    lastActivity = now;
    bumpActivity();
  };
  ["mousemove", "keydown", "wheel", "touchstart"].forEach((t) => document.addEventListener(t, onActivity, { passive: true, capture: true }));

  function applyEffects() {
    if (!settings.ambientGlow) stopAmbient();
    else sampleAmbient();
    if (!settings.autoFadeUI) {
      clearTimeout(fadeTimer);
      setIdle(false);
    } else bumpActivity();
  }
  function effectsTick() {
    if (!barUI) return;
    const v = video();
    barUI.host.toggleAttribute("data-playing", !!(v && !v.paused));
    sampleAmbient();
  }

  function mountTarget() {
    const below = document.querySelector("ytd-watch-flexy #below, ytd-watch-grid #below, #below");
    if (below && below.parentElement) return { parent: below.parentElement, before: below };
    const meta = document.querySelector("ytd-watch-metadata");
    if (meta && meta.parentElement) return { parent: meta.parentElement, before: meta };
    return null;
  }

  function ensureBar() {
    if (location.pathname !== "/watch" || !currentVideoId()) return removeBar();
    if (!barUI) {
      barUI = createBar();
      presetKey = null;
      renderPresets(true);
      syncBar();
    }
    const host = barUI.host;
    const target = mountTarget();
    if (!target) return;
    // Re-attach only if YouTube dropped it or moved it — never on every tick.
    if (!host.isConnected || host.parentElement !== target.parent) {
      target.parent.insertBefore(host, target.before);
    }
  }
  function removeBar() {
    clearPlayerGlow();
    if (barUI) {
      try {
        barUI.host.remove();
      } catch (_) {}
    }
  }

  // Close the presets editor when clicking anywhere outside it.
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!barUI || !barUI.pop.classList.contains("open")) return;
      const path = e.composedPath();
      if (!path.includes(barUI.pop) && !path.includes(barUI.editBtn)) barUI.closePop();
    },
    true
  );

  /* ---------- orchestration ---------- */
  let applyQueued = false;
  function queueApply() {
    if (applyQueued) return;
    applyQueued = true;
    setTimeout(() => {
      applyQueued = false;
      if (alive()) applyAll();
    }, 60);
  }

  function applyAll() {
    setShortsHidden(settings.hideShorts);
    setAdStyle(settings.blockAds);
    maybeRedirectShorts();
    ensureBar();
    syncBar();
    watchVideo();
    applyLoop();
    applySpeed(true);
    applyBoost();
    maybeLoadSegments();
    renderSegmentBar();
    loadDislikes();
    handleAds();
    applyEffects();
  }

  let heartbeat = null;
  function shutdown() {
    clearInterval(heartbeat);
    clearTimeout(adTimer);
    stopTurbo();
    removeBar();
    removeSegmentBar();
  }
  function tick() {
    if (!alive()) return shutdown();
    if (document.hidden) return;
    try {
      ensureBar();
      watchVideo();
      applySpeed(false);
      maybeLoadSegments();
      renderSegmentBar();
      loadDislikes();
      effectsTick();
      if (barUI) {
        const theme = document.documentElement.hasAttribute("dark") ? "dark" : "light";
        if (barUI.host.getAttribute("data-theme") !== theme) barUI.host.setAttribute("data-theme", theme);
      }
    } catch (_) {}
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      let changed = false;
      for (const k of Object.keys(changes)) {
        const nv = changes[k].newValue;
        if (settings[k] === nv) continue; // our own commit echoing back — nothing to do
        settings[k] = nv;
        changed = true;
        if (k === "skipSponsors") sbVideoId = null;
        if (k === "showDislikes") dislikeVid = null;
      }
      if (changed) queueApply();
    });
  } catch (_) {}

  // YouTube fires several events per navigation — coalesce them into one pass.
  ["yt-navigate-finish", "yt-page-data-updated"].forEach((t) => window.addEventListener(t, queueApply, true));

  function boot() {
    // Remove any bar left by a previous (reloaded) instance of this script.
    document.querySelectorAll("#ct-bar").forEach((n) => n.remove());
    injectPageScript();
    try {
      chrome.storage.local.get({ sbTimeSaved: 0 }, (r) => {
        sbTimeSaved = r.sbTimeSaved || 0;
      });
    } catch (_) {}
    loadSettings(() => {
      applyAll();
      heartbeat = setInterval(tick, 1000);
      scheduleAdTick();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
