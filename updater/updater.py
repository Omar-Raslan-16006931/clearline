"""
ClearTube Updater — keeps the sideloaded Chrome extension up to date.

Usage:
    python updater.py           # launch the GUI
    python updater.py --auto    # silent check + auto-apply (used by startup shortcut)

Build:
    pip install pyinstaller
    pyinstaller --onefile --windowed --name "ClearTube Updater" updater.py
"""

import json, os, shutil, sys, threading
import tkinter as tk
from tkinter import filedialog, messagebox
from io import BytesIO
from urllib.request import urlopen, Request
from zipfile import ZipFile

try:
    import winreg
except ImportError:
    winreg = None

# ── Constants ──────────────────────────────────────────────────────────────

VERSION_URL  = "https://cleartube.vercel.app/version.json"
DEFAULT_ZIP  = "https://cleartube.vercel.app/cleartube.zip"
STARTUP_KEY  = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
STARTUP_NAME = "ClearTubeUpdater"
CONFIG_NAME  = "updater.json"

# ── Palette (matches the extension popup) ──────────────────────────────────

BG      = "#f2ece1"
INK     = "#2c2721"
MUTED   = "#837a6f"
LINE    = "#e4dbcc"
ACCENT  = "#c67f56"
ACCENT2 = "#a1603a"
HOVER   = "#ebe1d2"
CARD    = "#fdf9f2"

# ── Helpers ────────────────────────────────────────────────────────────────

def _base_dir():
    """Directory beside the .exe (frozen) or the .py script."""
    return os.path.dirname(sys.executable if getattr(sys, "frozen", False)
                           else os.path.abspath(__file__))

def _config_path():
    return os.path.join(_base_dir(), CONFIG_NAME)

def load_config():
    try:
        with open(_config_path()) as f:
            return json.load(f)
    except Exception:
        return {}

def save_config(cfg):
    with open(_config_path(), "w") as f:
        json.dump(cfg, f, indent=2)

def parse_ver(v):
    return [int(x) for x in str(v).split(".")]

def is_newer(remote, local):
    r, l_ = parse_ver(remote), parse_ver(local)
    for a, b in zip(r + [0] * 5, l_ + [0] * 5):
        if a > b: return True
        if a < b: return False
    return False

def find_extension():
    """Try common relative paths from the exe / script location."""
    for rel in ("../extension", "extension", "../../extension"):
        p = os.path.normpath(os.path.join(_base_dir(), rel))
        if os.path.isfile(os.path.join(p, "manifest.json")):
            return p
    return None

def local_version(ext_path):
    with open(os.path.join(ext_path, "manifest.json")) as f:
        return json.load(f)["version"]

def remote_info():
    req = Request(VERSION_URL, headers={"Cache-Control": "no-cache"})
    data = json.loads(urlopen(req, timeout=15).read())
    return data["version"], data.get("url", DEFAULT_ZIP), data.get("notes", "")

def download_and_apply(zip_url, ext_path):
    """Download the zip, back up the old extension, and extract the new one."""
    data = urlopen(zip_url, timeout=120).read()

    # Backup current extension.
    backup = ext_path.rstrip("/\\") + "_backup"
    if os.path.exists(backup):
        shutil.rmtree(backup)
    shutil.copytree(ext_path, backup)

    try:
        # Clear old files.
        for item in os.listdir(ext_path):
            p = os.path.join(ext_path, item)
            (shutil.rmtree if os.path.isdir(p) else os.remove)(p)

        # Determine if the zip wraps everything in a single folder.
        with ZipFile(BytesIO(data)) as zf:
            tops = {n.split("/")[0] for n in zf.namelist()}
            prefix = ""
            if len(tops) == 1:
                sole = tops.pop()
                if sole + "/manifest.json" in zf.namelist():
                    prefix = sole + "/"

            for info in zf.infolist():
                if info.is_dir():
                    continue
                rel = info.filename
                if prefix and rel.startswith(prefix):
                    rel = rel[len(prefix):]
                if not rel:
                    continue
                dest = os.path.join(ext_path, rel)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with zf.open(info) as src, open(dest, "wb") as dst:
                    dst.write(src.read())
    except Exception:
        # Restore from backup on failure.
        shutil.rmtree(ext_path, ignore_errors=True)
        shutil.copytree(backup, ext_path)
        raise

    return backup

# ── Auto-start (Windows registry) ─────────────────────────────────────────

def _exe_cmd():
    if getattr(sys, "frozen", False):
        return '"' + sys.executable + '"'
    return '"' + sys.executable + '" "' + os.path.abspath(__file__) + '"'

def is_auto_start():
    if not winreg:
        return False
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, STARTUP_KEY, 0,
                             winreg.KEY_READ)
        winreg.QueryValueEx(key, STARTUP_NAME)
        winreg.CloseKey(key)
        return True
    except Exception:
        return False

def set_auto_start(enable):
    if not winreg:
        return
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, STARTUP_KEY, 0,
                             winreg.KEY_SET_VALUE)
        if enable:
            winreg.SetValueEx(key, STARTUP_NAME, 0, winreg.REG_SZ,
                              _exe_cmd() + " --auto")
        else:
            try:
                winreg.DeleteValue(key, STARTUP_NAME)
            except FileNotFoundError:
                pass
        winreg.CloseKey(key)
    except Exception as e:
        messagebox.showerror("Error", f"Could not modify startup setting:\n{e}")

# ── GUI ────────────────────────────────────────────────────────────────────

class App:
    def __init__(self, root):
        self.root = root
        root.title("ClearTube Updater")
        root.configure(bg=BG)
        root.resizable(False, False)

        cfg = load_config()
        self.ext_path = cfg.get("ext_path") or find_extension() or ""
        self.remote_ver = self.zip_url = None
        self._btn_mode = "check"

        self._build()
        self._center()
        self.check_async()

    # ── layout ──

    def _center(self):
        self.root.update_idletasks()
        w, h = self.root.winfo_width(), self.root.winfo_height()
        x = (self.root.winfo_screenwidth()  - w) // 2
        y = (self.root.winfo_screenheight() - h) // 2
        self.root.geometry(f"+{x}+{y}")

    def _build(self):
        # Header
        hdr = tk.Frame(self.root, bg=BG)
        hdr.pack(fill="x", padx=22, pady=(18, 0))
        tk.Label(hdr, text="Clear", font=("Segoe UI", 16, "bold"),
                 bg=BG, fg=INK).pack(side="left")
        tk.Label(hdr, text="Tube", font=("Segoe UI", 16, "bold"),
                 bg=BG, fg=ACCENT).pack(side="left")
        tk.Label(hdr, text="  Updater", font=("Segoe UI", 11),
                 bg=BG, fg=MUTED).pack(side="left", pady=(3, 0))

        tk.Frame(self.root, bg=LINE, height=1).pack(fill="x", padx=22,
                                                     pady=(12, 0))

        # Extension path
        tk.Label(self.root, text="Extension folder", font=("Segoe UI", 9),
                 bg=BG, fg=MUTED, anchor="w").pack(fill="x", padx=22,
                                                    pady=(14, 0))
        pf = tk.Frame(self.root, bg=BG)
        pf.pack(fill="x", padx=22, pady=(4, 0))

        self.path_var = tk.StringVar(value=self.ext_path)
        self.path_entry = tk.Entry(
            pf, textvariable=self.path_var, font=("Segoe UI", 9),
            bg=CARD, fg=INK, relief="flat", bd=0,
            highlightthickness=1, highlightcolor=ACCENT,
            highlightbackground=LINE)
        self.path_entry.pack(side="left", fill="x", expand=True, ipady=6,
                             padx=(0, 8))

        tk.Button(pf, text="Browse", font=("Segoe UI", 9, "bold"),
                  bg=HOVER, fg=INK, relief="flat", bd=0, cursor="hand2",
                  padx=12, pady=4, command=self._browse).pack(side="right")

        # Version info
        vf = tk.Frame(self.root, bg=BG)
        vf.pack(fill="x", padx=22, pady=(16, 0))
        left = tk.Frame(vf, bg=BG)
        left.pack(side="left")

        tk.Label(left, text="Installed", font=("Segoe UI", 10), bg=BG,
                 fg=MUTED, width=10, anchor="w").grid(row=0, column=0,
                                                       sticky="w")
        self.local_lbl = tk.Label(left, text="…", font=("Segoe UI", 10, "bold"),
                                  bg=BG, fg=INK, anchor="w")
        self.local_lbl.grid(row=0, column=1, sticky="w", padx=(8, 0))

        tk.Label(left, text="Available", font=("Segoe UI", 10), bg=BG,
                 fg=MUTED, width=10, anchor="w").grid(row=1, column=0,
                                                       sticky="w", pady=(2, 0))
        self.remote_lbl = tk.Label(left, text="…", font=("Segoe UI", 10, "bold"),
                                   bg=BG, fg=INK, anchor="w")
        self.remote_lbl.grid(row=1, column=1, sticky="w", padx=(8, 0),
                             pady=(2, 0))

        self.badge = tk.Label(vf, text="", font=("Segoe UI", 9), bg=BG,
                              fg=ACCENT)
        self.badge.pack(side="right")

        # Action button
        self.btn = tk.Button(
            self.root, text="Check for updates",
            font=("Segoe UI", 11, "bold"), bg=ACCENT, fg="#fff",
            activebackground=ACCENT2, activeforeground="#fff",
            relief="flat", bd=0, cursor="hand2", padx=20, pady=10,
            command=self._on_btn)
        self.btn.pack(fill="x", padx=22, pady=(18, 0))

        # Auto-start
        self.autostart = tk.BooleanVar(value=is_auto_start())
        tk.Checkbutton(
            self.root, text="  Launch on Windows startup",
            variable=self.autostart, font=("Segoe UI", 9), bg=BG, fg=INK,
            selectcolor=CARD, activebackground=BG, anchor="w", cursor="hand2",
            command=lambda: set_auto_start(self.autostart.get())
        ).pack(fill="x", padx=22, pady=(14, 0))

        # Status
        tk.Frame(self.root, bg=LINE, height=1).pack(fill="x", padx=22,
                                                     pady=(14, 0))
        self.status = tk.Label(self.root, text="Ready", font=("Segoe UI", 9),
                               bg=BG, fg=MUTED, anchor="w")
        self.status.pack(fill="x", padx=22, pady=(8, 16))

    # ── actions ──

    def _browse(self):
        d = filedialog.askdirectory(title="Select the ClearTube extension folder")
        if not d:
            return
        if not os.path.isfile(os.path.join(d, "manifest.json")):
            messagebox.showwarning("Invalid folder",
                                   "No manifest.json found in that folder.")
            return
        self.ext_path = os.path.normpath(d)
        self.path_var.set(self.ext_path)
        save_config({"ext_path": self.ext_path})
        self.check_async()

    def _on_btn(self):
        if self._btn_mode == "update":
            self._do_update()
        else:
            self.check_async()

    # ── check ──

    def check_async(self):
        self.status.config(text="Checking for updates…")
        self.btn.config(state="disabled", text="Checking…")
        threading.Thread(target=self._check_worker, daemon=True).start()

    def _check_worker(self):
        try:
            path = self.path_var.get().strip() or self.ext_path
            if not path or not os.path.isfile(os.path.join(path, "manifest.json")):
                self.root.after(0, self._check_err, "Extension folder not found.")
                return
            self.ext_path = path
            loc = local_version(path)
            rem, url, _ = remote_info()
            self.remote_ver, self.zip_url = rem, url
            newer = is_newer(rem, loc)
            self.root.after(0, self._check_ok, loc, rem, newer)
        except Exception as e:
            self.root.after(0, self._check_err, str(e))

    def _check_ok(self, loc, rem, newer):
        self.local_lbl.config(text=loc)
        self.remote_lbl.config(text=rem)
        if newer:
            self.badge.config(text="● Update available", fg=ACCENT)
            self.btn.config(state="normal", text="Update now",
                            bg=ACCENT, fg="#fff")
            self.status.config(text=f"Version {rem} is available.")
            self._btn_mode = "update"
        else:
            self.badge.config(text="✓ Up to date", fg="#5a8a5a")
            self.btn.config(state="normal", text="Check for updates",
                            bg=HOVER, fg=INK)
            self.status.config(text="You're on the latest version.")
            self._btn_mode = "check"

    def _check_err(self, msg):
        self.badge.config(text="")
        self.btn.config(state="normal", text="Retry", bg=HOVER, fg=INK)
        self.status.config(text=msg)
        self._btn_mode = "check"

    # ── update ──

    def _do_update(self):
        self.status.config(text="Downloading and applying update…")
        self.btn.config(state="disabled", text="Updating…")
        threading.Thread(target=self._update_worker, daemon=True).start()

    def _update_worker(self):
        try:
            backup = download_and_apply(self.zip_url, self.ext_path)
            ver = local_version(self.ext_path)
            save_config({"ext_path": self.ext_path})
            self.root.after(0, self._update_ok, ver, backup)
        except Exception as e:
            self.root.after(0, self._update_err, str(e))

    def _update_ok(self, ver, backup):
        self.local_lbl.config(text=ver)
        self.badge.config(text="✓ Up to date", fg="#5a8a5a")
        self.btn.config(state="normal", text="Check for updates",
                        bg=HOVER, fg=INK)
        self.status.config(text=f"Updated to v{ver} — reload in Chrome.")
        self._btn_mode = "check"
        messagebox.showinfo(
            "Updated",
            f"ClearTube updated to v{ver}.\n\n"
            "Open chrome://extensions, click the reload ↻ button on ClearTube, "
            "then refresh any open YouTube tabs.\n\n"
            f"Backup: {backup}")

    def _update_err(self, msg):
        self.btn.config(state="normal", text="Retry update", bg=ACCENT,
                        fg="#fff")
        self._btn_mode = "update"
        self.status.config(text=f"Failed: {msg}")
        messagebox.showerror("Update failed", msg)

# ── Silent mode (--auto) ──────────────────────────────────────────────────

def run_silent():
    cfg = load_config()
    ext = cfg.get("ext_path") or find_extension()
    if not ext or not os.path.isfile(os.path.join(ext, "manifest.json")):
        return
    try:
        loc = local_version(ext)
        rem, url, _ = remote_info()
        if not is_newer(rem, loc):
            return
        backup = download_and_apply(url, ext)
        ver = local_version(ext)
        root = tk.Tk()
        root.withdraw()
        messagebox.showinfo(
            "ClearTube Updated",
            f"Auto-updated to v{ver}.\n\n"
            "Open chrome://extensions, click the reload ↻ button on ClearTube, "
            "then refresh any open YouTube tabs.\n\n"
            f"Backup: {backup}")
        root.destroy()
    except Exception:
        pass  # fail silently in auto mode

# ── Entry point ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if "--auto" in sys.argv:
        run_silent()
    else:
        root = tk.Tk()
        App(root)
        root.mainloop()

