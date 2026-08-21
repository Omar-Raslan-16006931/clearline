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

  // Popup asks the content script for the current video's formats.
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === "GET_FORMATS") {
        sendResponse({ video: latestVideo });
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
  /* ---------- PLAYBACK SPEED (up to 50x) ---------- */
  const SPEED_PRESETS = [0.5, 1, 1.5, 2, 3, 5, 10, 16, 30, 50];
  let turboTimer = null;

  function applySpeed() {
    const v = document.querySelector("video");
    if (!v) return;
    const s = Math.max(0.1, Math.min(50, Number(settings.speed) || 1));
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
  function setSpeed(s) {
    settings.speed = s;
    try {
      chrome.storage.sync.set({ speed: s });
    } catch (_) {}
    applySpeed();
    updateBar();
  }

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

    const cur = Number(settings.speed) || 1;
    SPEED_PRESETS.forEach((s) => {
      bar.appendChild(barBtn(s + "×", Math.abs(cur - s) < 0.001, () => setSpeed(s)));
    });

    const divider = document.createElement("span");
    divider.style.cssText =
      "width:1px;height:20px;background:rgba(128,128,128,0.35);margin:0 4px;";
    bar.appendChild(divider);

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
  });

  function boot() {
    injectPageScript();
    try {
      chrome.storage.local.get({ sbTimeSaved: 0 }, (r) => {
        sbTimeSaved = r.sbTimeSaved || 0;
      });
    } catch (_) {}
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
