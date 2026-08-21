/* ClearTube quality picker — lists progressive + adaptive (1080p/1440p/4K,
 * "Enhanced bitrate") formats for the video open in the source tab, and for
 * adaptive picks, fetches the separate video+audio streams and muxes them
 * client-side with ffmpeg.wasm (stream copy — no re-encode, so it's fast).
 * Nothing is uploaded anywhere; the merge happens entirely in this tab. */
(() => {
  "use strict";

  const qs = new URLSearchParams(location.search);
  const sourceTabId = Number(qs.get("tabId"));

  const el = (id) => document.getElementById(id);
  const videoTitleEl = el("videoTitle");
  const progressiveList = el("progressiveList");
  const adaptiveList = el("adaptiveList");
  const audioList = el("audioList");
  const statusBox = el("status");
  const statusLabel = el("statusLabel");
  const statusBar = el("statusBar");
  const statusNote = el("statusNote");

  function showStatus(label, pct, note, isError) {
    statusBox.classList.add("show");
    statusLabel.textContent = label;
    statusBar.style.width = (pct == null ? 0 : Math.max(0, Math.min(100, pct))) + "%";
    statusNote.textContent = note || "";
    statusNote.classList.toggle("error", !!isError);
  }
  function hideStatus() {
    statusBox.classList.remove("show");
  }

  function containerOf(mime) {
    if (!mime) return null;
    if (mime.indexOf("mp4") !== -1) return "mp4";
    if (mime.indexOf("webm") !== -1) return "webm";
    return null;
  }
  function isVideoFmt(f) {
    return f && f.mimeType && f.mimeType.indexOf("video/") === 0;
  }
  function isAudioFmt(f) {
    return f && f.mimeType && f.mimeType.indexOf("audio/") === 0;
  }
  function fmtBitrate(bps) {
    if (!bps) return "";
    return Math.round(bps / 1000) + " kbps";
  }
  function sanitizeName(name) {
    return (name || "youtube-video").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  }

  /* ---------- fetch GET_FORMATS from the source tab, with a few retries ---------- */
  function getFormats(tries) {
    return new Promise((resolve, reject) => {
      if (!sourceTabId) return reject(new Error("No source tab."));
      const attempt = (left) => {
        chrome.tabs.sendMessage(sourceTabId, { type: "GET_FORMATS" }, (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.video) {
            if (left > 0) {
              setTimeout(() => attempt(left - 1), 700);
            } else {
              reject(new Error("Could not read this video's formats. Reload the YouTube tab and try again."));
            }
            return;
          }
          resolve(resp.video);
        });
      };
      attempt(tries || 5);
    });
  }

  function resolveUrl(format, playerUrl) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "RESOLVE_URL", format, playerUrl }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.ok) {
          reject(new Error((resp && resp.error) || "Could not resolve stream URL."));
        } else {
          resolve(resp.url);
        }
      });
    });
  }

  function directDownload(format, title, playerUrl) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "DOWNLOAD", format, title, playerUrl },
        (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.ok) {
            reject(new Error((resp && resp.error) || "Download failed."));
          } else {
            resolve();
          }
        }
      );
    });
  }

  /* ---------- fetch with progress ---------- */
  async function fetchWithProgress(url, onProgress) {
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      // Fall back to a plain fetch if streaming isn't available.
      const buf = await (await fetch(url)).arrayBuffer();
      return new Uint8Array(buf);
    }
    const total = parseInt(res.headers.get("Content-Length") || "-1", 10);
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (onProgress) onProgress(total > 0 ? (received / total) * 100 : null, received, total);
    }
    const out = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }

  /* ---------- ffmpeg (lazy singleton) ---------- */
  let ffmpegInstance = null;
  async function getFfmpeg(onProgress) {
    if (ffmpegInstance) return ffmpegInstance;
    const ff = new FFmpegWASM.FFmpeg();
    ff.on("log", () => {}); // silence stdio spam
    const coreVersion = "0.12.6";
    const base = "https://unpkg.com/@ffmpeg/core@" + coreVersion + "/dist/umd";
    onProgress && onProgress("Loading media engine (first time only, ~30MB)…", null);
    const coreURL = await FFmpegUtil.toBlobURL(base + "/ffmpeg-core.js", "text/javascript");
    const wasmURL = await FFmpegUtil.toBlobURL(base + "/ffmpeg-core.wasm", "application/wasm");
    await ff.load({ coreURL, wasmURL });
    ffmpegInstance = ff;
    return ff;
  }

  /* ---------- build + render option lists ---------- */
  function buildAdaptiveVideoOptions(adaptiveFormats) {
    const videos = adaptiveFormats.filter((f) => isVideoFmt(f) && f.qualityLabel);
    const groups = {};
    for (const f of videos) {
      (groups[f.qualityLabel] = groups[f.qualityLabel] || []).push(f);
    }
    const options = [];
    Object.keys(groups).forEach((label) => {
      const arr = groups[label].sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      arr.forEach((f, i) => {
        options.push({ format: f, label, enhanced: arr.length > 1 && i === 0 });
      });
    });
    options.sort((a, b) => {
      const bh = b.format.height || 0,
        ah = a.format.height || 0;
      if (bh !== ah) return bh - ah;
      return (b.format.bitrate || 0) - (a.format.bitrate || 0);
    });
    return options;
  }

  function pickBestAudio(adaptiveFormats, wantContainer) {
    const audios = adaptiveFormats.filter(isAudioFmt);
    const sameContainer = audios.filter((f) => containerOf(f.mimeType) === wantContainer);
    const pool = (sameContainer.length ? sameContainer : audios).slice();
    pool.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    return pool[0] || null;
  }

  function row(labelHtml, subText, buttonText, onClick) {
    const r = document.createElement("div");
    r.className = "row";
    const text = document.createElement("div");
    text.className = "text";
    const label = document.createElement("div");
    label.className = "label";
    label.innerHTML = labelHtml;
    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = subText || "";
    text.appendChild(label);
    text.appendChild(sub);
    const btn = document.createElement("button");
    btn.className = "pick";
    btn.textContent = buttonText || "Download";
    btn.addEventListener("click", () => onClick(btn));
    r.appendChild(text);
    r.appendChild(btn);
    return r;
  }

  async function handleAdaptivePick(btn, videoFormat, audioFormat, playerUrl, title, container) {
    const allButtons = document.querySelectorAll("button.pick");
    allButtons.forEach((b) => (b.disabled = true));
    try {
      const ffmpegPromise = getFfmpeg((label) => showStatus(label, null));

      showStatus("Downloading video stream…", 0);
      const videoUrl = await resolveUrl(videoFormat, playerUrl);
      const videoBytes = await fetchWithProgress(videoUrl, (pct) => {
        showStatus("Downloading video stream…", pct == null ? null : pct * 0.45);
      });

      showStatus("Downloading audio stream…", 45);
      const audioUrl = await resolveUrl(audioFormat, playerUrl);
      const audioBytes = await fetchWithProgress(audioUrl, (pct) => {
        showStatus("Downloading audio stream…", pct == null ? 45 : 45 + pct * 0.25);
      });

      showStatus("Loading media engine…", 70);
      const ff = await ffmpegPromise;

      showStatus("Merging video + audio…", 85);
      const vExt = container === "webm" ? "webm" : "mp4";
      const aExt = containerOf(audioFormat.mimeType) === "webm" ? "webm" : "m4a";
      const inV = "in_video." + vExt;
      const inA = "in_audio." + aExt;
      const outName = "out." + vExt;

      await ff.writeFile(inV, videoBytes);
      await ff.writeFile(inA, audioBytes);

      let exit = await ff.exec(["-i", inV, "-i", inA, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", outName]);
      if (exit !== 0) {
        // Fallback: re-encode just the audio track (cheap) if stream-copy muxing failed,
        // e.g. because the audio codec doesn't fit the target container.
        const audioCodec = vExt === "webm" ? "libopus" : "aac";
        exit = await ff.exec(["-i", inV, "-i", inA, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", audioCodec, outName]);
      }
      if (exit !== 0) throw new Error("Merging failed (ffmpeg exit code " + exit + ").");

      showStatus("Saving file…", 97);
      const data = await ff.readFile(outName);
      const blob = new Blob([data.buffer || data], { type: vExt === "webm" ? "video/webm" : "video/mp4" });
      const blobUrl = URL.createObjectURL(blob);
      const filename = sanitizeName(title) + " [" + videoFormat.qualityLabel + "]." + vExt;

      chrome.downloads.download({ url: blobUrl, filename, saveAs: true }, () => {
        setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
      });

      // Best-effort cleanup of the virtual FS.
      ff.deleteFile(inV).catch(() => {});
      ff.deleteFile(inA).catch(() => {});
      ff.deleteFile(outName).catch(() => {});

      showStatus("Done — check your downloads.", 100);
      setTimeout(hideStatus, 4000);
    } catch (e) {
      showStatus("Something went wrong", null, String((e && e.message) || e), true);
    } finally {
      allButtons.forEach((b) => (b.disabled = false));
    }
  }

  async function handleDirectPick(btn, format, title, playerUrl) {
    const allButtons = document.querySelectorAll("button.pick");
    allButtons.forEach((b) => (b.disabled = true));
    showStatus("Starting download…", null);
    try {
      await directDownload(format, title, playerUrl);
      showStatus("Download started — check your downloads.", 100);
      setTimeout(hideStatus, 3000);
    } catch (e) {
      showStatus("Something went wrong", null, String((e && e.message) || e), true);
    } finally {
      allButtons.forEach((b) => (b.disabled = false));
    }
  }

  function render(video) {
    const { title, streamingData, playerUrl } = video;
    videoTitleEl.textContent = title || "";

    const formats = (streamingData && streamingData.formats) || [];
    const adaptive = (streamingData && streamingData.adaptiveFormats) || [];

    // Instant / progressive (already has audio baked in).
    progressiveList.innerHTML = "";
    const progressiveVideos = formats
      .filter((f) => isVideoFmt(f) && f.qualityLabel)
      .sort((a, b) => (b.height || 0) - (a.height || 0));
    if (!progressiveVideos.length) {
      progressiveList.innerHTML = '<div id="empty">No instant formats for this video.</div>';
    } else {
      progressiveVideos.forEach((f) => {
        progressiveList.appendChild(
          row(
            f.qualityLabel + ' <span class="tag instant">instant</span>',
            containerOf(f.mimeType) + (f.bitrate ? " · " + fmtBitrate(f.bitrate) : ""),
            "Download",
            (btn) => handleDirectPick(btn, f, title, playerUrl)
          )
        );
      });
    }

    // High quality / adaptive (needs muxing).
    adaptiveList.innerHTML = "";
    const adaptiveOptions = buildAdaptiveVideoOptions(adaptive);
    if (!adaptiveOptions.length) {
      adaptiveList.innerHTML = '<div id="empty">No high-quality formats available for this video.</div>';
    } else {
      adaptiveOptions.forEach((opt) => {
        const container = containerOf(opt.format.mimeType) || "mp4";
        const audioFormat = pickBestAudio(adaptive, container);
        const enabled = !!audioFormat;
        const tag = opt.enhanced
          ? '<span class="tag enhanced">Enhanced bitrate</span>'
          : '<span class="tag muxed">merge</span>';
        const sub =
          container +
          (opt.format.bitrate ? " · " + fmtBitrate(opt.format.bitrate) : "") +
          (audioFormat ? " + " + (containerOf(audioFormat.mimeType) || "") + " audio" : " · no audio track found");
        const r = row(
          opt.label + " " + tag,
          sub,
          "Download",
          (btn) => handleAdaptivePick(btn, opt.format, audioFormat, playerUrl, title, container)
        );
        if (!enabled) {
          r.querySelector("button").disabled = true;
        }
        adaptiveList.appendChild(r);
      });
    }

    // Audio only.
    audioList.innerHTML = "";
    const audios = adaptive.filter(isAudioFmt).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    const seen = new Set();
    let shown = 0;
    for (const f of audios) {
      const key = containerOf(f.mimeType) + ":" + Math.round((f.bitrate || 0) / 1000);
      if (seen.has(key) || shown >= 3) continue;
      seen.add(key);
      shown++;
      audioList.appendChild(
        row(
          (containerOf(f.mimeType) === "webm" ? "Opus" : "AAC") + " audio",
          fmtBitrate(f.bitrate),
          "Download",
          (btn) => handleDirectPick(btn, f, title, playerUrl)
        )
      );
    }
    if (!shown) {
      audioList.innerHTML = '<div id="empty">No separate audio track found.</div>';
    }
  }

  getFormats()
    .then(render)
    .catch((e) => {
      videoTitleEl.textContent = "";
      progressiveList.innerHTML = "";
      adaptiveList.innerHTML = "";
      audioList.innerHTML = "";
      showStatus("Couldn't load this video", null, String((e && e.message) || e), true);
    });
})();
