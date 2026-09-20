/* ================= i18n ================= */
const I18N = {
  en: {
    title: "Clear<b>Tube</b>",
    blockAds: "Block ads", blockAdsSub: "YouTube + web",
    loop: "Auto-loop", loopSub: "Repeat, no refresh",
    skip: "Skip sponsors", skipSub: "SponsorBlock data",
    dislikes: "Show dislikes", dislikesSub: "Return YT Dislike",
    hideShorts: "Hide Shorts", hideShortsSub: "Feeds & search",
    redirect: "Shorts as video", redirectSub: "Full player",
    volume: "Volume boost",
    download: "Download",
    dlNote: "Open a video, then:",
    dlNoteOff: "Open a video (watch page) first.",
    ytdlp: "Copy yt-dlp command",
    footer: "Reload YouTube after changing options.",
    savedFn: (x) => x + " of sponsors skipped",
    hintYtmp3: "Link copied — paste it on the page, pick MP3 or MP4.",
    hintYtmp4: "Link copied — paste it on ytmp4, then download.",
    hintYtdlp: "Command copied — paste in a terminal with yt-dlp.",
    updateLabel: "Update available",
    updateGet: "Get it",
    updateSubFn: (v) => "Version " + v + " is ready to download.",
    updateSubDownloaded: (v) => "Version " + v + " downloaded. Unzip it into your ClearTube folder, then reload.",
    updateShow: "Show downloaded file",
    updateReload: "Reload extension",
    dlQuality: "Choose quality (up to 4K)",
    ambientGlow: "Ambient glow", ambientGlowSub: "Color aura · theater",
    autoFadeUI: "Fade on idle", autoFadeUISub: "Hide page · theater",
  },
  ar: {
    title: "Clear<b>Tube</b>",
    blockAds: "حظر الإعلانات", blockAdsSub: "يوتيوب والويب",
    loop: "تكرار تلقائي", loopSub: "إعادة بدون تحديث",
    skip: "تخطي الرعاة", skipSub: "بيانات SponsorBlock",
    dislikes: "إظهار عدم الإعجاب", dislikesSub: "Return YT Dislike",
    hideShorts: "إخفاء Shorts", hideShortsSub: "الصفحات والبحث",
    redirect: "Shorts كفيديو", redirectSub: "المشغل الكامل",
    volume: "تعزيز الصوت",
    download: "تنزيل",
    dlNote: "افتح فيديو ثم:",
    dlNoteOff: "افتح فيديو أولاً.",
    ytdlp: "نسخ أمر yt-dlp",
    footer: "أعد تحميل يوتيوب بعد التغيير.",
    savedFn: (x) => "تم تخطي ⁦" + x + "⁩ من الرعاة",
    hintYtmp3: "تم نسخ الرابط — الصقه في الصفحة واختر MP3 أو MP4.",
    hintYtmp4: "تم نسخ الرابط — الصقه في ytmp4 ثم نزّل.",
    hintYtdlp: "تم نسخ الأمر — الصقه في الطرفية مع yt-dlp.",
    updateLabel: "تحديث متوفر",
    updateGet: "احصل عليه",
    updateSubFn: (v) => "الإصدار " + v + " جاهز للتنزيل.",
    updateSubDownloaded: (v) => "تم تنزيل الإصدار " + v + ". فك الضغط في مجلد ClearTube ثم أعد التحميل.",
    updateShow: "إظهار الملف الذي تم تنزيله",
    updateReload: "إعادة تحميل الإضافة",
    dlQuality: "اختر الجودة (حتى 4K)",
    ambientGlow: "إضاءة محيطية", ambientGlowSub: "هالة ملونة · المسرح",
    autoFadeUI: "إخفاء عند السكون", autoFadeUISub: "إخفاء الصفحة · المسرح",
  },
};
let LANG = "en";
const T = (k) => (I18N[LANG] || I18N.en)[k];

const langEnBtn = document.getElementById("langEn");
const langArBtn = document.getElementById("langAr");

function applyLang(lang) {
  LANG = I18N[lang] ? lang : "en";
  // Keep the layout in place (no RTL mirroring) — only swap the text + font.
  document.documentElement.dir = "ltr";
  document.documentElement.lang = LANG;
  document.body.classList.toggle("lang-ar", LANG === "ar");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const k = el.getAttribute("data-i18n");
    const val = T(k);
    if (val == null) return;
    if (k === "title") el.innerHTML = val;
    else el.textContent = val;
  });
  langEnBtn.classList.toggle("on", LANG === "en");
  langArBtn.classList.toggle("on", LANG === "ar");
  refreshSaved();
  refreshDlNote();
  refreshUpdateBanner();
}
langEnBtn.addEventListener("click", () => { chrome.storage.sync.set({ lang: "en" }); applyLang("en"); });
langArBtn.addEventListener("click", () => { chrome.storage.sync.set({ lang: "ar" }); applyLang("ar"); });

/* ================= toggles ================= */
const DEFAULTS = {
  loop: true, hideShorts: true, redirectShorts: false, skipSponsors: true,
  showDislikes: true, volumeBoost: 100, blockAds: true, lang: "en",
  ambientGlow: true, autoFadeUI: true,
};
const loopEl = document.getElementById("loop");
const blockAdsEl = document.getElementById("blockAds");
const skipEl = document.getElementById("skipSponsors");
const hideEl = document.getElementById("hideShorts");
const redirectEl = document.getElementById("redirectShorts");
const dislikesEl = document.getElementById("showDislikes");
const volumeEl = document.getElementById("volume");
const volValEl = document.getElementById("volVal");
const redirectRow = document.getElementById("redirectRow");
const ambientGlowEl = document.getElementById("ambientGlow");
const autoFadeUIEl = document.getElementById("autoFadeUI");

function syncNested() {
  redirectRow.classList.toggle("off", !hideEl.checked);
}
function paintVol() {
  const pct = ((Number(volumeEl.value) - 100) / 400) * 100;
  volumeEl.style.background =
    "linear-gradient(90deg, var(--accent) " + pct + "%, var(--track) " + pct + "%)";
}

chrome.storage.sync.get(DEFAULTS, (s) => {
  loopEl.checked = s.loop;
  blockAdsEl.checked = s.blockAds;
  skipEl.checked = s.skipSponsors;
  hideEl.checked = s.hideShorts;
  redirectEl.checked = s.redirectShorts;
  dislikesEl.checked = s.showDislikes;
  ambientGlowEl.checked = s.ambientGlow;
  autoFadeUIEl.checked = s.autoFadeUI;
  volumeEl.value = s.volumeBoost;
  volValEl.textContent = s.volumeBoost + "%";
  paintVol();
  syncNested();
  applyLang(s.lang || "en");
});

function save() {
  chrome.storage.sync.set({
    loop: loopEl.checked,
    blockAds: blockAdsEl.checked,
    skipSponsors: skipEl.checked,
    hideShorts: hideEl.checked,
    redirectShorts: redirectEl.checked,
    showDislikes: dislikesEl.checked,
    ambientGlow: ambientGlowEl.checked,
    autoFadeUI: autoFadeUIEl.checked,
    volumeBoost: Number(volumeEl.value),
  });
}
loopEl.addEventListener("change", save);
blockAdsEl.addEventListener("change", save);
skipEl.addEventListener("change", save);
dislikesEl.addEventListener("change", save);
hideEl.addEventListener("change", () => { syncNested(); save(); });
redirectEl.addEventListener("change", save);
ambientGlowEl.addEventListener("change", save);
autoFadeUIEl.addEventListener("change", save);
volumeEl.addEventListener("input", () => {
  volValEl.textContent = volumeEl.value + "%";
  paintVol();
  save();
});

/* ================= sponsor time-saved ================= */
function fmtDur(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return h + "h " + m + "m";
  if (m) return m + "m " + sec + "s";
  return sec + "s";
}
function refreshSaved() {
  chrome.storage.local.get({ sbTimeSaved: 0 }, (r) => {
    const el = document.getElementById("savedStat");
    if (!el) return;
    const s = r.sbTimeSaved || 0;
    el.dir = LANG === "ar" ? "rtl" : "ltr";
    el.textContent = s > 0 ? T("savedFn")(fmtDur(s)) : "";
  });
}

/* ================= download hand-off ================= */
const dlNote = document.getElementById("dlNote");
const dlButtons = document.getElementById("dlButtons");
const dlHint = document.getElementById("dlHint");
let hasVideo = false;
let watchUrl = null;

function refreshDlNote() {
  dlNote.textContent = hasVideo ? T("dlNote") : T("dlNoteOff");
}
function getVideoId(url) {
  try {
    const u = new URL(url);
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/);
    return m ? m[1] : null;
  } catch (_) { return null; }
}
function openTab(url) { chrome.tabs.create({ url }); }
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (_) { return false; }
}
let sourceTabId = null;

const SERVICES = {
  async quality() {
    if (!sourceTabId) return;
    chrome.tabs.create({ url: chrome.runtime.getURL("download.html") + "?tabId=" + sourceTabId });
  },
  async ytmp3() { await copyText(watchUrl); openTab("https://ytmp3.ws/nie/"); dlHint.textContent = T("hintYtmp3"); },
  async ytmp4() { await copyText(watchUrl); openTab("https://ytmp4.video/"); dlHint.textContent = T("hintYtmp4"); },
  async ytdlp() { await copyText('yt-dlp -f "bv*+ba/b" "' + watchUrl + '"'); dlHint.textContent = T("hintYtdlp"); },
};

/* ================= update banner ================= */
let updateInfo = null;
let autoFetchedVersion = null;
let autoFetchedDownloadId = null;

function refreshUpdateBanner() {
  const banner = document.getElementById("updateBanner");
  const sub = document.getElementById("updateSub");
  const dl = document.getElementById("updateDl");
  const actions = document.getElementById("updateActions");
  if (!banner) return;
  if (!updateInfo || !updateInfo.version) {
    banner.classList.remove("show");
    return;
  }
  banner.classList.add("show");
  const downloaded = autoFetchedVersion === updateInfo.version && autoFetchedDownloadId != null;
  if (downloaded) {
    sub.textContent = T("updateSubDownloaded")(updateInfo.version);
    dl.style.display = "none";
    actions.style.display = "flex";
  } else {
    sub.textContent = T("updateSubFn")(updateInfo.version);
    dl.href = updateInfo.url || "https://cleartube.vercel.app/cleartube.zip";
    dl.style.display = "";
    actions.style.display = "none";
  }
}
chrome.storage.local.get({ updateInfo: null, autoFetchedVersion: null, autoFetchedDownloadId: null }, (r) => {
  updateInfo = r.updateInfo || null;
  autoFetchedVersion = r.autoFetchedVersion || null;
  autoFetchedDownloadId = r.autoFetchedDownloadId || null;
  refreshUpdateBanner();
});
document.getElementById("updateDl").addEventListener("click", () => {
  chrome.action.setBadgeText({ text: "" });
});
document.getElementById("updateShow").addEventListener("click", () => {
  if (autoFetchedDownloadId != null) {
    chrome.downloads.show(autoFetchedDownloadId);
  } else {
    chrome.downloads.showDefaultFolder();
  }
});
document.getElementById("updateReload").addEventListener("click", () => {
  chrome.runtime.reload();
});

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  const vid = getVideoId((tab && tab.url) || "");
  hasVideo = !!vid;
  watchUrl = vid ? "https://www.youtube.com/watch?v=" + vid : null;
  sourceTabId = tab ? tab.id : null;
  dlButtons.classList.toggle("off", !hasVideo);
  refreshDlNote();
  if (hasVideo) {
    dlButtons.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const fn = SERVICES[btn.dataset.svc];
        if (fn) fn();
      });
    });
  }
});
