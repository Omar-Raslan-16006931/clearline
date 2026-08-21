/* Background service worker: resolves a downloadable URL for a chosen format
 * (deciphering YouTube's signature + throttling "n" param when needed) and
 * hands it to chrome.downloads.
 *
 * Design principle: degrade gracefully. If deciphering fails, we still try the
 * raw URL — the download may just be slower (throttled) rather than broken. */

const playerCache = {}; // playerUrl -> { sig: fn|null, nfn: fn|null }

/* ---------------- fetch + parse base.js ---------------- */

async function getDecoders(playerUrl) {
  if (!playerUrl) return { sig: null, nfn: null };
  if (playerCache[playerUrl]) return playerCache[playerUrl];
  let decoders = { sig: null, nfn: null };
  try {
    const js = await (await fetch(playerUrl)).text();
    decoders = { sig: buildSigDecoder(js), nfn: buildNDecoder(js) };
  } catch (e) {
    /* keep nulls */
  }
  playerCache[playerUrl] = decoders;
  return decoders;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* Signature transform: NAME=function(a){a=a.split("");HELPER.x(a,3);...return a.join("")} */
function buildSigDecoder(js) {
  try {
    const fnRe =
      /(?:function\s+([A-Za-z0-9_$]+)|(?:var\s+)?([A-Za-z0-9_$]+)\s*=\s*function)\s*\(\s*([A-Za-z0-9_$]+)\s*\)\s*\{\s*\3\s*=\s*\3\.split\(\s*""\s*\)\s*;([\s\S]+?)return\s+\3\.join\(\s*""\s*\)\s*\}/;
    const m = js.match(fnRe);
    if (!m) return null;
    const arg = m[3];
    const body = m[4];
    const objName = (body.match(/([A-Za-z0-9_$]+)\.[A-Za-z0-9_$]+\(/) || [])[1];
    if (!objName) return null;
    const objRe = new RegExp(
      "var\\s+" + escapeRe(objName) + "\\s*=\\s*\\{([\\s\\S]+?)\\}\\s*;"
    );
    const om = js.match(objRe);
    if (!om) return null;
    const src =
      "var " +
      objName +
      "={" +
      om[1] +
      "};return function(" +
      arg +
      "){" +
      arg +
      "=" +
      arg +
      '.split("");' +
      body +
      "return " +
      arg +
      '.join("");};';
    // eslint-disable-next-line no-new-func
    return new Function(src)();
  } catch (e) {
    return null;
  }
}

/* Throttling "n" transform: a self-contained function(a){var b=a.split("")...return b.join("")} */
function buildNDecoder(js) {
  try {
    let name =
      (js.match(
        /[&(]([A-Za-z0-9_$]+)\s*=\s*[A-Za-z0-9_$]+\.get\([^)]*\)[\s\S]{0,40}?[A-Za-z0-9_$]+\s*=\s*([A-Za-z0-9_$]+)\(/
      ) || [])[2] ||
      (js.match(/\.get\("n"\)\)&&\([A-Za-z0-9_$]+=([A-Za-z0-9_$]+)\(/) || [])[1] ||
      (js.match(
        /([A-Za-z0-9_$]+)=function\([A-Za-z0-9_$]\)\{var [A-Za-z0-9_$]+=[A-Za-z0-9_$]\.split\(""\)[\s\S]+?return [A-Za-z0-9_$]+\.join\(""\)\}/
      ) || [])[1];

    let fnSrc = null;
    if (name) {
      const declRe = new RegExp(
        escapeRe(name) +
          "\\s*=\\s*function\\s*\\(([A-Za-z0-9_$]+)\\)\\s*\\{([\\s\\S]+?return [A-Za-z0-9_$]+\\.join\\(\\s*\"\"\\s*\\))\\s*\\}"
      );
      const dm = js.match(declRe);
      if (dm) {
        fnSrc = "return function(" + dm[1] + "){" + dm[2] + "};";
      }
    }
    if (!fnSrc) {
      const anon = js.match(
        /function\(([A-Za-z0-9_$]+)\)\{var [A-Za-z0-9_$]+=\1\.split\(\s*""\s*\)[\s\S]+?return [A-Za-z0-9_$]+\.join\(\s*""\s*\)\}/
      );
      if (anon) fnSrc = "return " + anon[0] + ";";
    }
    if (!fnSrc) return null;
    // eslint-disable-next-line no-new-func
    return new Function(fnSrc)();
  } catch (e) {
    return null;
  }
}

/* ---------------- resolve a format's final URL ---------------- */

function applyNParam(url, nfn) {
  if (!nfn) return url;
  try {
    const u = new URL(url);
    const n = u.searchParams.get("n");
    if (n) {
      const nn = nfn(n);
      if (nn && typeof nn === "string" && !nn.startsWith("enhanced_")) {
        u.searchParams.set("n", nn);
        return u.toString();
      }
    }
  } catch (e) {}
  return url;
}

async function resolveUrl(format, playerUrl) {
  const { sig, nfn } = await getDecoders(playerUrl);

  if (format.url) {
    return applyNParam(format.url, nfn);
  }

  const cipher = format.signatureCipher || format.cipher;
  if (cipher) {
    const params = new URLSearchParams(cipher);
    let baseUrl = params.get("url");
    const s = params.get("s");
    const sp = params.get("sp") || "signature";
    if (baseUrl && s && sig) {
      const decoded = sig(s);
      const u = new URL(baseUrl);
      u.searchParams.set(sp, decoded);
      return applyNParam(u.toString(), nfn);
    }
    if (baseUrl) return applyNParam(baseUrl, nfn);
  }
  return null;
}

/* ---------------- filename helpers ---------------- */

function extFor(mime) {
  if (!mime) return "bin";
  if (mime.startsWith("video/mp4")) return "mp4";
  if (mime.startsWith("video/webm")) return "webm";
  if (mime.startsWith("audio/mp4")) return "m4a";
  if (mime.startsWith("audio/webm")) return "weba";
  return "bin";
}

function sanitize(name) {
  return (name || "youtube-video")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/* ---------------- SponsorBlock segments (fetched here to avoid CORS) ---------------- */

async function sha256hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchSbSegments(videoId, categories) {
  const cats = categories && categories.length ? categories : ["sponsor", "selfpromo", "interaction"];
  const prefix = (await sha256hex(videoId)).slice(0, 4); // privacy: only send hash prefix
  const url =
    "https://sponsor.ajay.app/api/skipSegments/" +
    prefix +
    "?categories=" +
    encodeURIComponent(JSON.stringify(cats));
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  const entry = Array.isArray(data) ? data.find((d) => d.videoID === videoId) : null;
  if (!entry || !Array.isArray(entry.segments)) return [];
  return entry.segments
    .filter(
      (s) =>
        Array.isArray(s.segment) &&
        s.segment.length === 2 &&
        s.segment[1] > s.segment[0] &&
        (!s.actionType || s.actionType === "skip")
    )
    .map((s) => ({ start: s.segment[0], end: s.segment[1], cat: s.category }));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "GET_SB_SEGMENTS") return false;
  fetchSbSegments(msg.videoId, msg.categories)
    .then((segments) => sendResponse({ ok: true, segments }))
    .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
  return true; // async response
});

/* ---------------- Dislikes (Return YouTube Dislike) ---------------- */

async function fetchDislikes(videoId) {
  const res = await fetch(
    "https://returnyoutubedislikeapi.com/votes?videoId=" + encodeURIComponent(videoId)
  );
  if (!res.ok) return null;
  const d = await res.json();
  return typeof d.dislikes === "number" ? d.dislikes : null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "GET_DISLIKES") return false;
  fetchDislikes(msg.videoId)
    .then((dislikes) => sendResponse({ ok: true, dislikes }))
    .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
  return true; // async response
});

/* ---------------- message handling ---------------- */

/* ---------------- update check ---------------- */

const VERSION_CHECK_URL = "https://cleartube.vercel.app/version.json";
const UPDATE_ALARM = "cleartube-update-check";

function parseVer(v) {
  return String(v || "0")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
}

function isNewer(remote, local) {
  const r = parseVer(remote);
  const l = parseVer(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

async function checkForUpdate() {
  try {
    const res = await fetch(VERSION_CHECK_URL, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const current = chrome.runtime.getManifest().version;
    if (data && data.version && isNewer(data.version, current)) {
      await chrome.storage.local.set({
        updateInfo: {
          version: data.version,
          url: data.url || "https://cleartube.vercel.app/cleartube.zip",
          notes: data.notes || "",
          checkedAt: Date.now(),
        },
      });
      chrome.action.setBadgeText({ text: "1" });
      chrome.action.setBadgeBackgroundColor({ color: "#c67f56" });
    } else {
      await chrome.storage.local.remove("updateInfo");
      chrome.action.setBadgeText({ text: "" });
    }
  } catch (e) {
    /* offline or blocked — stay quiet, try again next alarm */
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 720, delayInMinutes: 1 });
  checkForUpdate();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 720, delayInMinutes: 1 });
  checkForUpdate();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) checkForUpdate();
});

/* Resolve a single format's final URL without triggering a download —
 * used by the quality picker (download.html) to fetch video/audio streams
 * itself for client-side muxing. */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "RESOLVE_URL") return false;
  resolveUrl(msg.format, msg.playerUrl)
    .then((url) => {
      if (!url) {
        sendResponse({ ok: false, error: "Could not resolve a URL for this format." });
      } else {
        sendResponse({ ok: true, url });
      }
    })
    .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
  return true; // async response
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "DOWNLOAD") return false;
  (async () => {
    try {
      const url = await resolveUrl(msg.format, msg.playerUrl);
      if (!url) {
        sendResponse({ ok: false, error: "Could not resolve a download URL for this format." });
        return;
      }
      const label = msg.format.__label || msg.format.qualityLabel || "audio";
      const ext = extFor(msg.format.mimeType);
      const filename = sanitize(msg.title) + " [" + label + "]." + ext;
      chrome.downloads.download({ url, filename, saveAs: true }, (id) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ ok: true, id });
        }
      });
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  })();
  return true; // async response
});
