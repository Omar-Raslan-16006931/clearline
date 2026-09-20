/* YT Loop + Shorts Hider — content script
 * - Forces the active <video> to loop, and re-applies it across YouTube's
 *   SPA navigations (so you never have to refresh).
 * - Hides Shorts everywhere (home, sidebar, search, subscriptions) and can
 *   redirect /shorts/ URLs to the normal watch player.
 * - Injects a page-context reader so the popup can list download formats.
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
    ambientGlow: true,
    autoFadeUI: true,
  };
  let settings = { ...DEFAULTS };

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

  // Popup asks the content script for the current video's formats. Ask the
  // page context to re-read window.ytInitialPlayerResponse right now first —
  // YouTube can attach higher-bitrate / Premium variants to that object
  // after the initial page load, so a live read beats the cached snapshot.
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === "GET_FORMATS") {
        const before = latestVideo;
        try { window.postMessage({ source: "YTLS_REQUEST_GRAB" }, "*"); } catch (_) {}
        setTimeout(() => {
          sendResponse({ video: latestVideo || before });
        }, 250);
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

  /* ---------- LOOP ---------- */
  function applyLoop() {
    const v = document.querySelector("video");
    if (!v) return;
    if (settings.loop) {
      if (!v.loop) v.loop = true;
    } else if (v.loop) {
      v.loop = false;
    }
  }

  function watchVideo() {
    const v = document.querySelector("video");
    if (!v || v.__ytlsBound) return;
    v.__ytlsBound = true;
    v.addEventListener("ended", () => {
      if (settings.loop) {
        v.currentTime = 0;
        v.play().catch(() => {});
      }
    });
    v.addEventListener("timeupdate", () => trySkip(v));
    v.addEventListener("durationchange", renderSegmentBar);
    v.addEventListener("loadedmetadata", renderSegmentBar);
    v.addEventListener("play", () => { checkAmbientConditions(); checkAutoFadeConditions(); });
    v.addEventListener("pause", () => { checkAmbientConditions(); checkAutoFadeConditions(); });
    applyLoop();
    applySpeed();
  }

  /* ---------- SPONSOR SKIP (SponsorBlock public API) ---------- */
  const SKIP_CATEGORIES = ["sponsor", "selfpromo", "interaction"];
  let sbSegments = [];
  let sbVideoId = null;
  let sbLoading = false;
  let sbTimeSaved = 0; // total seconds skipped, persisted across sessions

  function fmtDur(s) {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h) return h + "h " + m + "m";
    if (m) return m + "m " + sec + "s";
    return sec + "s";
  }

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

  // Segments are fetched by the background worker (content-script fetches to
  // sponsor.ajay.app are blocked by CORS in MV3; the background bypasses it).
  async function maybeLoadSegments() {
    if (!settings.skipSponsors) {
      sbSegments = [];
      renderSegmentBar();
      return;
    }
    const vid = currentVideoId();
    if (!vid || vid === sbVideoId || sbLoading) return;
    sbVideoId = vid;
    sbLoading = true;
    sbSegments = [];
    try {
      const resp = await chrome.runtime.sendMessage({
        type: "GET_SB_SEGMENTS",
        videoId: vid,
        categories: SKIP_CATEGORIES,
      });
      if (resp && resp.ok && Array.isArray(resp.segments)) {
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

  function removeSegmentBar() {
    const o = document.getElementById("ytls-segbar");
    if (o) o.remove();
  }

  function renderSegmentBar() {
    if (!settings.skipSponsors) {
      removeSegmentBar();
      return;
    }
    const v = document.querySelector("video");
    const bar =
      document.querySelector(".ytp-progress-bar") ||
      document.querySelector(".ytp-progress-bar-container");
    if (!v || !bar || !sbSegments.length) return;
    const dur = v.duration;
    if (!dur || !isFinite(dur) || dur <= 0) return;

    let overlay = document.getElementById("ytls-segbar");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "ytls-segbar";
      overlay.style.cssText =
        "position:absolute;left:0;top:0;height:100%;width:100%;pointer-events:none;z-index:35;";
      bar.appendChild(overlay);
    }
    overlay.innerHTML = "";
    for (const seg of sbSegments) {
      const left = Math.max(0, Math.min(100, (seg.start / dur) * 100));
      const width = Math.max(0.15, Math.min(100 - left, ((seg.end - seg.start) / dur) * 100));
      const d = document.createElement("div");
      d.style.cssText =
        "position:absolute;top:0;height:100%;left:" +
        left +
        "%;width:" +
        width +
        "%;background:" +
        categoryColor(seg.cat) +
        ";opacity:.85;";
      overlay.appendChild(d);
    }
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
      const label =
        cat === "selfpromo"
          ? "self-promo"
          : cat === "interaction"
          ? "interaction reminder"
          : "sponsor";
      let el = document.getElementById("ytls-toast");
      if (!el) {
        el = document.createElement("div");
        el.id = "ytls-toast";
        el.style.cssText =
          "position:fixed;left:24px;bottom:96px;z-index:99999;" +
          "background:rgba(15,15,15,.95);color:#fff;" +
          "font-family:system-ui,-apple-system,Roboto,sans-serif;" +
          "padding:16px 22px;border-radius:14px;border-left:6px solid #ff0033;" +
          "box-shadow:0 8px 26px rgba(0,0,0,.55);transition:opacity .3s;" +
          "pointer-events:none;max-width:360px";
        document.body.appendChild(el);
      }
      el.innerHTML =
        '<div style="font-size:22px;font-weight:800;line-height:1.15">Skipped ' +
        label +
        "</div>" +
        '<div style="font-size:14px;color:#c9c9c9;margin-top:6px">+' +
        fmtDur(saved || 0) +
        " skipped &nbsp;·&nbsp; " +
        fmtDur(sbTimeSaved) +
        " saved total</div>";
      el.style.opacity = "1";
      clearTimeout(el.__t);
      el.__t = setTimeout(() => {
        el.style.opacity = "0";
      }, 3000);
    } catch (_) {}
  }

  /* ---------- BLOCK ADS (best-effort, DOM/player based) ---------- */
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
    const ex = document.getElementById(AD_STYLE_ID);
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
  let priorRate = 1;

  function clickSkip() {
    // 1) Known class-based skip buttons (classic + modern).
    const sel = [
      ".ytp-ad-skip-button-modern",
      ".ytp-ad-skip-button",
      ".ytp-skip-ad-button",
      ".ytp-ad-skip-button-container button",
      "button.ytp-ad-skip-button-modern",
      ".ytp-ad-skip-button-slot button",
    ];
    for (const s of sel) {
      const btn = document.querySelector(s);
      if (btn) {
        try {
          btn.click();
        } catch (_) {}
        return true;
      }
    }
    // 2) Text-based fallback for newer full-screen ad layouts: find a
    //    "Skip"/"Skip Ad" control inside the player, whatever its class is.
    const player =
      document.getElementById("movie_player") ||
      document.querySelector(".html5-video-player") ||
      document.querySelector("ytd-player") ||
      document.querySelector("#player");
    if (player) {
      const cands = player.querySelectorAll(
        'button, [role="button"], a, tp-yt-paper-button, yt-button-shape'
      );
      for (const b of cands) {
        const t = (b.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (t === "skip" || t === "skip ad" || t === "skip ads" || /^skip\b/.test(t)) {
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
    const player =
      document.getElementById("movie_player") ||
      document.querySelector(".html5-video-player");
    const v = document.querySelector("video");
    const isAd = !!(player && player.classList.contains("ad-showing"));

    // 1) Always try to click a Skip button if one is showing.
    clickSkip();

    // 2) Close overlay/banner ads.
    const ov = document.querySelector(
      ".ytp-ad-overlay-close-button, .ytp-ad-overlay-close-container"
    );
    if (ov) {
      try {
        ov.click();
      } catch (_) {}
    }

    // 3) Ad playing → force it to finish: seek to the end, and if the ad
    //    stream isn't seekable, blast through it at max speed.
    if (isAd && v) {
      if (!adActive) {
        adActive = true;
        priorRate = v.playbackRate || 1;
      }
      try {
        if (isFinite(v.duration) && v.duration > 0) {
          v.currentTime = v.duration;
        } else if (v.playbackRate < 16) {
          v.playbackRate = 16;
        }
      } catch (_) {}
    } else if (adActive && v) {
      // Ad just ended → restore normal playback speed.
      adActive = false;
      try {
        v.playbackRate = priorRate || 1;
      } catch (_) {}
    }

    // 4) Dismiss the "ad blockers are not allowed" enforcement popup and resume.
    const enforce = document.querySelector(
      "ytd-enforcement-message-view-model, tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)"
    );
    if (enforce) {
      try {
        enforce.remove();
      } catch (_) {}
      document.querySelectorAll("tp-yt-iron-overlay-backdrop").forEach((b) => {
        try {
          b.remove();
        } catch (_) {}
      });
      if (v && v.paused) v.play().catch(() => {});
    }
  }
  let adTimer = null;

  /* ---------- VOLUME BOOST (Web Audio, up to 500%) ---------- */
  let audioCtx = null;
  function gainFor(v) {
    if (!v) return null;
    if (v.__ytlsGain) return v.__ytlsGain;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaElementSource(v);
      const g = audioCtx.createGain();
      src.connect(g);
      g.connect(audioCtx.destination);
      v.__ytlsGain = g;
      return g;
    } catch (_) {
      return null;
    }
  }
  function applyBoost() {
    const v = document.querySelector("video");
    if (!v) return;
    const boost =
      Math.max(0, Math.min(500, Number(settings.volumeBoost) || 100)) / 100;
    // Only route through Web Audio once a boost above 100% is requested, so
    // normal playback is never altered for users who don't use the booster.
    if (boost > 1 || v.__ytlsGain) {
      const g = gainFor(v);
      if (g) {
        g.gain.value = boost;
        if (audioCtx && audioCtx.state === "suspended") {
          audioCtx.resume().catch(() => {});
        }
      }
    }
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
        const resp = await chrome.runtime.sendMessage({
          type: "GET_DISLIKES",
          videoId: vid,
        });
        if (resp && resp.ok && typeof resp.dislikes === "number") {
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
    const existing = document.getElementById(STYLE_ID);
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
    if (m) {
      location.replace("https://www.youtube.com/watch?v=" + m[1]);
    }
  }

  /* ---------- apply everything ---------- */
  /* ---------- PLAYBACK SPEED (0.25x – 100x) ---------- */
  const SPEED_MIN = 0.25;
  const SPEED_MAX = 100;
  // Points the slider "sticks" to when the thumb passes near them.
  const SPEED_SNAP_POINTS = [0.25, 0.5, 1, 1.5, 2, 3, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  let turboTimer = null;

  function applySpeed() {
    const v = document.querySelector("video");
    if (!v) return;
    const s = Math.max(SPEED_MIN, Math.min(SPEED_MAX, Number(settings.speed) || 1));
    // Browsers clamp playbackRate at 16x, so above that we nudge currentTime
    // forward on a timer ("turbo") to reach the requested speed.
    try {
      v.playbackRate = Math.min(16, s);
    } catch (_) {}
    if (s > 16) startTurbo(s);
    else stopTurbo();
  }
  function startTurbo(s) {
    stopTurbo();
    turboTimer = setInterval(() => {
      const v = document.querySelector("video");
      if (!v || v.paused) return;
      const p = document.getElementById("movie_player");
      if (p && p.classList.contains("ad-showing")) return;
      try {
        v.currentTime += (s - 16) * 0.1; // 16x from playbackRate + the remainder
      } catch (_) {}
    }, 100);
  }
  function stopTurbo() {
    if (turboTimer) {
      clearInterval(turboTimer);
      turboTimer = null;
    }
  }
  function setSpeed(s, persist) {
    settings.speed = s;
    if (persist !== false) {
      try {
        chrome.storage.sync.set({ speed: s });
      } catch (_) {}
    }
    applySpeed();
  }
  function setVolumeBoost(v, persist) {
    settings.volumeBoost = v;
    if (persist !== false) {
      try {
        chrome.storage.sync.set({ volumeBoost: v });
      } catch (_) {}
    }
    applyBoost();
  }
  function fmtSpeed(s) {
    return (Math.abs(s - Math.round(s)) < 0.001 ? Math.round(s) : Math.round(s * 100) / 100) + "×";
  }

  /* ---------- speed slider: logarithmic position with magnetic snap points ---------- */
  const SLIDER_STEPS = 1000;
  function speedToPos(s) {
    const c = Math.max(SPEED_MIN, Math.min(SPEED_MAX, s));
    return Math.round((SLIDER_STEPS * Math.log(c / SPEED_MIN)) / Math.log(SPEED_MAX / SPEED_MIN));
  }
  function posToSpeed(pos) {
    return SPEED_MIN * Math.pow(SPEED_MAX / SPEED_MIN, pos / SLIDER_STEPS);
  }
  function niceRound(s) {
    if (s < 1) return Math.round(s * 20) / 20; // nearest 0.05
    if (s < 10) return Math.round(s * 10) / 10; // nearest 0.1
    return Math.round(s); // nearest 1
  }
  function magnetize(s) {
    // Logarithmic distance so the "pull" toward a tick feels equal at both
    // ends of a 0.25x–100x range, not just near the small numbers.
    let best = null,
      bestDist = Infinity;
    for (const p of SPEED_SNAP_POINTS) {
      const dist = Math.abs(Math.log(s / p));
      if (dist < bestDist) {
        bestDist = dist;
        best = p;
      }
    }
    return bestDist < 0.06 ? best : niceRound(s);
  }
  function ensureSpeedSliderStyle() {
    if (document.getElementById("ct-speed-style")) return;
    const style = document.createElement("style");
    style.id = "ct-speed-style";
    style.textContent =
      "#ct-speed-slider,#ct-vol-slider{-webkit-appearance:none;appearance:none;width:" + SPEED_TRACK_WIDTH + "px;height:6px;border-radius:999px;" +
      "background:rgba(128,128,128,0.35);outline:none;vertical-align:middle;margin:0;}" +
      "#ct-vol-slider{width:130px;}" +
      "#ct-speed-slider::-webkit-slider-thumb,#ct-vol-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;" +
      "border-radius:50%;background:#ff5277;border:2px solid #fff;cursor:pointer;margin-top:-4px;" +
      "box-shadow:0 1px 3px rgba(0,0,0,.4);}" +
      "#ct-speed-slider::-moz-range-thumb,#ct-vol-slider::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#ff5277;" +
      "border:2px solid #fff;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.4);}" +
      "#ct-speed-slider::-moz-range-track,#ct-vol-slider::-moz-range-track{height:6px;border-radius:999px;background:rgba(128,128,128,0.35);}" +
      "#ct-speed-ticks{position:relative;width:" + SPEED_TRACK_WIDTH + "px;height:12px;}" +
      "#ct-speed-ticks b{position:absolute;top:1px;transform:translateX(-50%);font:600 9px Roboto,system-ui,sans-serif;" +
      "color:var(--yt-spec-text-secondary,#aaa);cursor:pointer;user-select:none;white-space:nowrap;}" +
      "#ct-speed-ticks b:hover{color:#ff5277;}";
    document.head.appendChild(style);
  }
  const SPEED_TRACK_WIDTH = 300;
  // Labels shown under the track — kept sparse so they never collide on a
  // single row. Dragging still snaps to every point in SPEED_SNAP_POINTS
  // (2×, 3×, 30×, 40×, etc.) even though not all of them get their own label.
  const SPEED_TICK_LABELS = [1, 2, 5, 10, 20, 50, 100];

  /* ---------- ON-PAGE CONTROL BAR (below the video) ---------- */
  function barBtn(text, active, onClick, title) {
    const b = document.createElement("button");
    b.textContent = text;
    if (title) b.title = title;
    b.style.cssText =
      "font:600 12px Roboto,system-ui,sans-serif;cursor:pointer;border-radius:8px;padding:6px 10px;line-height:1;" +
      "border:1px solid " +
      (active ? "#ff5277" : "rgba(128,128,128,0.35)") +
      ";background:" +
      (active ? "rgba(255,82,119,0.16)" : "transparent") +
      ";color:" +
      (active ? "#ff6f8b" : "var(--yt-spec-text-primary, #f1f1f1)") +
      ";";
    b.addEventListener("click", (e) => {
      e.preventDefault();
      onClick();
    });
    return b;
  }
  function toggleSetting(key) {
    settings[key] = !settings[key];
    try {
      chrome.storage.sync.set({ [key]: settings[key] });
    } catch (_) {}
    applyAll();
  }
  function removeBar() {
    const b = document.getElementById("ct-bar");
    if (b) b.remove();
  }
  function buildBar() {
    if (location.pathname !== "/watch" || !currentVideoId()) {
      removeBar();
      return;
    }
    let bar = document.getElementById("ct-bar");
    if (!bar) {
      const mount =
        document.querySelector("#below") ||
        document.querySelector("ytd-watch-metadata");
      if (!mount) return;
      bar = document.createElement("div");
      bar.id = "ct-bar";
      bar.style.cssText =
        "display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:12px 0;padding:10px 12px;" +
        "border:1px solid var(--yt-spec-10-percent-layer, rgba(128,128,128,0.2));border-radius:12px;" +
        "background:var(--yt-spec-badge-chip-background, rgba(128,128,128,0.08));";
      mount.prepend(bar);
    }
    updateBar();
  }
  function updateBar() {
    const bar = document.getElementById("ct-bar");
    if (!bar) return;
    bar.textContent = "";

    const brand = document.createElement("span");
    brand.textContent = "ClearTube";
    brand.style.cssText = "font:700 12px Roboto,system-ui,sans-serif;color:#ff5277;";
    bar.appendChild(brand);

    const spLabel = document.createElement("span");
    spLabel.textContent = "Speed";
    spLabel.style.cssText =
      "font:600 12px Roboto,system-ui,sans-serif;color:var(--yt-spec-text-secondary,#aaa);margin-left:6px;";
    bar.appendChild(spLabel);

    ensureSpeedSliderStyle();
    const cur = Math.max(SPEED_MIN, Math.min(SPEED_MAX, Number(settings.speed) || 1));

    const sliderCol = document.createElement("span");
    sliderCol.style.cssText = "display:inline-flex;flex-direction:column;gap:2px;";

    const sliderRow = document.createElement("span");
    sliderRow.style.cssText = "display:inline-flex;align-items:center;gap:8px;";

    const valueLabel = document.createElement("span");
    valueLabel.textContent = fmtSpeed(cur);
    valueLabel.style.cssText =
      "font:700 12px Roboto,system-ui,sans-serif;color:#ff5277;min-width:46px;";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.id = "ct-speed-slider";
    slider.min = "0";
    slider.max = String(SLIDER_STEPS);
    slider.step = "1";
    slider.value = String(speedToPos(cur));
    slider.title = "Drag to set playback speed (0.25×–100×)";

    slider.addEventListener("input", () => {
      const raw = posToSpeed(Number(slider.value));
      const snapped = magnetize(raw);
      const snappedPos = speedToPos(snapped);
      // Only visually "stick" the thumb when it's genuinely close to a tick —
      // otherwise free dragging would feel jumpy.
      if (Math.abs(snappedPos - Number(slider.value)) <= 15) {
        slider.value = String(snappedPos);
      }
      valueLabel.textContent = fmtSpeed(snapped);
      setSpeed(snapped, false); // live preview, no storage write yet
    });
    slider.addEventListener("change", () => {
      setSpeed(magnetize(posToSpeed(Number(slider.value))), true);
    });

    sliderRow.appendChild(slider);
    sliderRow.appendChild(valueLabel);

    const ticks = document.createElement("span");
    ticks.id = "ct-speed-ticks";
    SPEED_TICK_LABELS.forEach((p) => {
      const x = (speedToPos(p) / SLIDER_STEPS) * SPEED_TRACK_WIDTH;
      const t = document.createElement("b");
      t.textContent = p + "×";
      t.style.left = x + "px";
      t.addEventListener("click", () => {
        slider.value = String(speedToPos(p));
        valueLabel.textContent = fmtSpeed(p);
        setSpeed(p, true);
      });
      ticks.appendChild(t);
    });

    sliderCol.appendChild(sliderRow);
    sliderCol.appendChild(ticks);
    bar.appendChild(sliderCol);

    const divider = document.createElement("span");
    divider.style.cssText =
      "width:1px;height:20px;background:rgba(128,128,128,0.35);margin:0 4px;";
    bar.appendChild(divider);

    const volLabel = document.createElement("span");
    volLabel.textContent = "Volume";
    volLabel.style.cssText =
      "font:600 12px Roboto,system-ui,sans-serif;color:var(--yt-spec-text-secondary,#aaa);";
    bar.appendChild(volLabel);

    const curVol = Math.max(100, Math.min(500, Number(settings.volumeBoost) || 100));
    const volValueLabel = document.createElement("span");
    volValueLabel.textContent = curVol + "%";
    volValueLabel.style.cssText =
      "font:700 12px Roboto,system-ui,sans-serif;color:#ff5277;min-width:38px;";

    const volSlider = document.createElement("input");
    volSlider.type = "range";
    volSlider.id = "ct-vol-slider";
    volSlider.min = "100";
    volSlider.max = "500";
    volSlider.step = "10";
    volSlider.value = String(curVol);
    volSlider.title = "Volume boost (100%–500%)";
    volSlider.addEventListener("input", () => {
      const v = Number(volSlider.value);
      volValueLabel.textContent = v + "%";
      setVolumeBoost(v, false);
    });
    volSlider.addEventListener("change", () => {
      setVolumeBoost(Number(volSlider.value), true);
    });
    bar.appendChild(volSlider);
    bar.appendChild(volValueLabel);

    const divider2 = document.createElement("span");
    divider2.style.cssText =
      "width:1px;height:20px;background:rgba(128,128,128,0.35);margin:0 4px;";
    bar.appendChild(divider2);

    bar.appendChild(barBtn("Loop", !!settings.loop, () => toggleSetting("loop")));
    bar.appendChild(barBtn("Skip sponsors", !!settings.skipSponsors, () => toggleSetting("skipSponsors")));
    bar.appendChild(barBtn("Block ads", !!settings.blockAds, () => toggleSetting("blockAds")));
    bar.appendChild(barBtn("Hide Shorts", !!settings.hideShorts, () => toggleSetting("hideShorts")));

    bar.appendChild(
      barBtn("⤓ Download", false, () => {
        const vid = currentVideoId();
        if (!vid) return;
        try {
          navigator.clipboard.writeText("https://www.youtube.com/watch?v=" + vid);
        } catch (_) {}
        window.open("https://ytmp3.ws/nie/", "_blank");
      }, "Copy link & open downloader")
    );
  }

  /* ---------- AMBIENT GLOW (dynamic video color behind/around player) ---------- */
  const AMBIENT_STYLE_ID = "ct-ambient-style";
  const AMBIENT_CSS = `
    #ct-ambient-glow {
      position: absolute;
      inset: -20px;
      z-index: 0;
      pointer-events: none;
      border-radius: 16px;
      filter: blur(60px);
      opacity: 0.85;
      transition: background 0.35s ease, box-shadow 0.35s ease, opacity 0.35s ease;
    }
    #full-bleed-container,
    #player-theater-container,
    #player-container-outer,
    #player-container-inner,
    ytd-watch-flexy[theater] #player-container,
    ytd-watch-grid[theater] #player-container {
      overflow: visible !important;
    }
    #movie_player.html5-video-player {
      position: relative;
      z-index: 1;
    }
  `;
  let ambientRaf = null;
  let ambientCanvas = null;
  let ambientCtx = null;
  let ambientLastSample = 0;
  let ambientActive = false;
  const ambientReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function isTheaterMode() {
    if (location.pathname !== "/watch") return false;
    const flexy = document.querySelector("ytd-watch-flexy, ytd-watch-grid");
    if (flexy) {
      if (flexy.hasAttribute("theater") || flexy.hasAttribute("theater-requested_")) {
        return !flexy.hasAttribute("fullscreen");
      }
    }
    const tc = document.getElementById("player-theater-container");
    if (tc && tc.offsetHeight > 100) return true;
    const player = document.getElementById("movie_player");
    if (player && player.classList.contains("ytp-big-mode") && !document.fullscreenElement) {
      return true;
    }
    return false;
  }

  function ensureAmbientStyle() {
    if (document.getElementById(AMBIENT_STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = AMBIENT_STYLE_ID;
    s.textContent = AMBIENT_CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function startAmbientGlow() {
    if (ambientActive) return;
    ambientActive = true;
    ensureAmbientStyle();
    if (!ambientCanvas) {
      ambientCanvas = document.createElement("canvas");
      ambientCanvas.width = 16;
      ambientCanvas.height = 9;
      ambientCtx = ambientCanvas.getContext("2d", { willReadFrequently: true });
    }
    ensureGlowElement();
    ambientLastSample = 0;
    ambientRaf = requestAnimationFrame(ambientFrame);
  }

  function ensureGlowElement() {
    const player = document.getElementById("movie_player") || document.querySelector(".html5-video-player");
    if (!player || !player.parentElement) return null;

    let glow = document.getElementById("ct-ambient-glow");
    if (!glow) {
      glow = document.createElement("div");
      glow.id = "ct-ambient-glow";
      player.parentElement.style.position = "relative";
      player.parentElement.style.overflow = "visible";
      player.parentElement.insertBefore(glow, player);
    }
    return glow;
  }

  function stopAmbientGlow() {
    if (!ambientActive) return;
    ambientActive = false;
    if (ambientRaf) {
      cancelAnimationFrame(ambientRaf);
      ambientRaf = null;
    }
    const glow = document.getElementById("ct-ambient-glow");
    if (glow) glow.remove();
    const player = document.getElementById("movie_player");
    if (player) player.style.boxShadow = "";
  }

  function ambientFrame(ts) {
    if (!ambientActive) return;
    // Sample every ~120ms for smooth 8-9fps color transitions with zero frame drops
    if (ts - ambientLastSample >= 120) {
      ambientLastSample = ts;
      const v = document.querySelector("video");
      const player = document.getElementById("movie_player") || document.querySelector(".html5-video-player");
      const glow = ensureGlowElement();

      if (v && v.readyState >= 2 && !v.paused && v.videoWidth > 0) {
        try {
          ambientCtx.drawImage(v, 0, 0, 16, 9);
          const imgData = ambientCtx.getImageData(0, 0, 16, 9).data;
          let rTotal = 0, gTotal = 0, bTotal = 0, count = 0;
          for (let i = 0; i < imgData.length; i += 4) {
            rTotal += imgData[i];
            gTotal += imgData[i + 1];
            bTotal += imgData[i + 2];
            count++;
          }
          let r = Math.round(rTotal / count);
          let g = Math.round(gTotal / count);
          let b = Math.round(bTotal / count);

          // Boost color vibrancy so the ambient light is vivid
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          if (max > min && max > 20) {
            const boost = 1.35;
            r = Math.min(255, Math.round(r * boost));
            g = Math.min(255, Math.round(g * boost));
            b = Math.min(255, Math.round(b * boost));
          }

          const shadow =
            "0 0 90px 35px rgba(" + r + "," + g + "," + b + ",0.55), " +
            "0 0 180px 80px rgba(" + r + "," + g + "," + b + ",0.30)";

          if (glow) {
            glow.style.background = "radial-gradient(ellipse at center, rgba(" + r + "," + g + "," + b + ",0.75) 0%, rgba(" + r + "," + g + "," + b + ",0.35) 70%, transparent 100%)";
            glow.style.boxShadow = shadow;
          }
          if (player) {
            player.style.boxShadow = "0 0 60px 20px rgba(" + r + "," + g + "," + b + ",0.45)";
            player.style.transition = "box-shadow 0.35s ease";
          }
        } catch (_) {
          // Keep loop alive across transient canvas read issues
        }
      }
    }
    ambientRaf = requestAnimationFrame(ambientFrame);
  }

  function checkAmbientConditions() {
    const isWatch = location.pathname === "/watch";
    const v = document.querySelector("video");
    const playing = v && !v.paused && !v.ended;
    const shouldRun =
      settings.ambientGlow &&
      isWatch &&
      !document.hidden &&
      playing;

    if (shouldRun) {
      startAmbientGlow();
    } else {
      stopAmbientGlow();
    }
  }

  /* ---------- AUTO-FADE UI (hide page chrome on idle in theater mode) ---------- */
  const FADE_STYLE_ID = "ct-fade-style";
  const FADE_CSS = `
    body.clearline-idle #below,
    body.clearline-idle #secondary,
    body.clearline-idle #related,
    body.clearline-idle #comments,
    body.clearline-idle ytd-watch-metadata,
    body.clearline-idle #masthead-container,
    body.clearline-idle #chat,
    body.clearline-idle #ticket-shelf {
      opacity: 0 !important;
      pointer-events: none !important;
      transition: opacity 0.45s ease !important;
    }
    #below,
    #secondary,
    #related,
    #comments,
    ytd-watch-metadata,
    #masthead-container,
    #chat {
      transition: opacity 0.35s ease;
    }
  `;
  const IDLE_TIMEOUT = 2500;
  let fadeActive = false;
  let fadeTimer = null;

  function ensureFadeStyle() {
    if (document.getElementById(FADE_STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = FADE_STYLE_ID;
    s.textContent = FADE_CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function setIdle(on) {
    document.body.classList.toggle("clearline-idle", on);
  }

  function resetIdleTimer() {
    setIdle(false);
    clearTimeout(fadeTimer);
    const v = document.querySelector("video");
    if (fadeActive && v && !v.paused && !v.ended) {
      fadeTimer = setTimeout(() => {
        const curV = document.querySelector("video");
        if (fadeActive && curV && !curV.paused) {
          setIdle(true);
        }
      }, IDLE_TIMEOUT);
    }
  }

  function onFadeActivity() {
    if (fadeActive) resetIdleTimer();
  }

  function startAutoFade() {
    if (fadeActive) return;
    fadeActive = true;
    ensureFadeStyle();
    window.addEventListener("mousemove", onFadeActivity, { capture: true, passive: true });
    window.addEventListener("mousedown", onFadeActivity, { capture: true, passive: true });
    window.addEventListener("keydown", onFadeActivity, { capture: true, passive: true });
    window.addEventListener("wheel", onFadeActivity, { capture: true, passive: true });
    window.addEventListener("touchstart", onFadeActivity, { capture: true, passive: true });
    resetIdleTimer();
  }

  function stopAutoFade() {
    if (!fadeActive) return;
    fadeActive = false;
    clearTimeout(fadeTimer);
    fadeTimer = null;
    setIdle(false);
    window.removeEventListener("mousemove", onFadeActivity, { capture: true });
    window.removeEventListener("mousedown", onFadeActivity, { capture: true });
    window.removeEventListener("keydown", onFadeActivity, { capture: true });
    window.removeEventListener("wheel", onFadeActivity, { capture: true });
    window.removeEventListener("touchstart", onFadeActivity, { capture: true });
  }

  function checkAutoFadeConditions() {
    const v = document.querySelector("video");
    const playing = v && !v.paused && !v.ended;
    const shouldRun =
      settings.autoFadeUI &&
      isTheaterMode() &&
      !document.hidden &&
      playing;

    if (shouldRun) {
      startAutoFade();
    } else {
      stopAutoFade();
    }
  }

  function applyAll() {
    setShortsHidden(settings.hideShorts);
    applySpeed();
    buildBar();
    maybeRedirectShorts();
    watchVideo();
    applyLoop();
    maybeLoadSegments();
    renderSegmentBar();
    applyBoost();
    loadDislikes();
    setAdStyle(settings.blockAds);
    handleAds();
    checkAmbientConditions();
    checkAutoFadeConditions();
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      for (const k of Object.keys(changes)) settings[k] = changes[k].newValue;
      // Force a re-fetch of sponsor segments / dislikes when toggles change.
      sbVideoId = null;
      dislikeVid = null;
      applyAll();
    });
  } catch (_) {}

  window.addEventListener("yt-navigate-finish", applyAll, true);
  window.addEventListener("yt-page-data-updated", applyAll, true);
  document.addEventListener("yt-navigate-finish", applyAll, true);

  const mo = new MutationObserver(() => {
    watchVideo();
    applyLoop();
    applyBoost();
    applySpeed();
    // Re-inject the control bar if YouTube rebuilt the page.
    if (location.pathname === "/watch" && !document.getElementById("ct-bar")) {
      buildBar();
    }
    // Re-inject the segment bar if YouTube rebuilt the progress bar.
    if (
      settings.skipSponsors &&
      sbSegments.length &&
      !document.getElementById("ytls-segbar")
    ) {
      renderSegmentBar();
    }
    // Re-inject dislikes if YouTube rebuilt the action bar.
    if (settings.showDislikes && lastDislikes != null) {
      injectDislikes();
    }
    // Re-evaluate theater-mode dependent features (ambient glow, auto-fade)
    // when YouTube's DOM changes (e.g. theater attribute toggled).
    checkAmbientConditions();
    checkAutoFadeConditions();
  });

  function boot() {
    injectPageScript();
    try {
      chrome.storage.local.get({ sbTimeSaved: 0 }, (r) => {
        sbTimeSaved = r.sbTimeSaved || 0;
      });
    } catch (_) {}
    // Pause/resume ambient glow and auto-fade when tab visibility changes.
    document.addEventListener("visibilitychange", () => {
      checkAmbientConditions();
      checkAutoFadeConditions();
    });
    loadSettings(() => {
      applyAll();
      mo.observe(document.documentElement, { childList: true, subtree: true });
      // Fast poll to catch ad skip-buttons and unskippable ads promptly.
      if (!adTimer) adTimer = setInterval(handleAds, 200);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
