"""
ClearTube Installer & Updater — Standalone all-in-one utility.

Features:
- Can be distributed as a single .exe to new or existing users.
- FRESH INSTALL: If ClearTube is not installed, downloads and installs it to
  Documents/ClearTube (or user's choice) and provides step-by-step browser setup guide.
- UPDATE: If an installation is detected, updates in-place: wipes old files, extracts
  new files, keeps the exact same folder name and location so browser links stay intact.
- AUTO-DETECT: Scans Chrome, Brave, Edge, and common paths to detect existing installations.
- SETTINGS GUI: Manage installation locations, toggle Windows startup background updates,
  backup/restore, and direct browser shortcuts.
"""

import glob
import json
import os
import shutil
import sys
import threading
import tkinter as tk
import webbrowser
from io import BytesIO
from tkinter import filedialog, messagebox
from urllib.request import Request, urlopen
from zipfile import ZipFile

try:
    import winreg
except ImportError:
    winreg = None

# ── Constants ──────────────────────────────────────────────────────────────

DEFAULT_VERSION_URL = "https://cleartube.vercel.app/version.json"
DEFAULT_ZIP_URL     = "https://cleartube.vercel.app/cleartube.zip"
STARTUP_KEY         = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
STARTUP_NAME        = "ClearTubeUpdater"
CONFIG_NAME         = "updater.json"

def get_default_install_dir():
    return os.path.join(os.path.expanduser("~"), "Documents", "ClearTube")

# ── Palette (dark, matches the ClearTube bar on YouTube) ──────────────────

BG          = "#0f0f10"
INK         = "#f5f5f7"
MUTED       = "#a8a8ad"
LINE        = "#26262a"
ACCENT      = "#ff5277"
ACCENT2     = "#e03e63"
HOVER       = "#2a2a2e"
CARD        = "#1a1a1c"
SUCCESS     = "#4cd27a"
DANGER      = "#ff6b6b"
CARD_BORDER = "#2a2a2e"
ON_ACCENT   = "#1a1a1c"
BADGE_BG    = "#2a2a2e"
BADGE_NEW   = "#17301f"
SOFT_BTN    = "#26262a"

# ── Config Management ──────────────────────────────────────────────────────

def _base_dir():
    return os.path.dirname(
        sys.executable if getattr(sys, "frozen", False) else os.path.abspath(__file__)
    )

def _config_path():
    return os.path.join(_base_dir(), CONFIG_NAME)

def load_config():
    defaults = {
        "ext_path": "",
        "auto_detect_on_launch": True,
        "keep_backup": True,
        "silent_auto_update": False,
        "update_url": DEFAULT_VERSION_URL,
    }
    try:
        if os.path.isfile(_config_path()):
            with open(_config_path(), "r", encoding="utf-8") as f:
                saved = json.load(f)
                defaults.update(saved)
    except Exception:
        pass
    return defaults

def save_config(cfg):
    try:
        with open(_config_path(), "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
    except Exception:
        pass

# ── Detection Engine ───────────────────────────────────────────────────────

def read_manifest_info(folder_path):
    """Returns (name, version) if folder contains a valid ClearTube manifest, else None."""
    if not folder_path or not os.path.isdir(folder_path):
        return None
    mf = os.path.join(folder_path, "manifest.json")
    if not os.path.isfile(mf):
        return None
    try:
        with open(mf, "r", encoding="utf-8", errors="ignore") as f:
            data = json.load(f)
        name = data.get("name", "")
        desc = data.get("description", "")
        if "ClearTube" in name or "ClearTube" in desc or "YT Loop" in desc:
            return (name or "ClearTube", data.get("version", "0.0.0"))
    except Exception:
        pass
    return None

def detect_all_locations():
    """
    Scans Chrome, Brave, Edge, Opera, and typical directories to discover where
    ClearTube extensions are loaded.
    Returns list of dicts: [{'path': ..., 'source': ..., 'version': ...}]
    """
    results = []
    seen_paths = set()

    def add_candidate(path, source):
        if not path:
            return
        norm = os.path.normpath(path)
        if norm.lower() in seen_paths:
            return
        info = read_manifest_info(norm)
        if info:
            seen_paths.add(norm.lower())
            results.append({
                "path": norm,
                "source": source,
                "name": info[0],
                "version": info[1]
            })

    local_app = os.environ.get("LOCALAPPDATA", "")
    user_home = os.path.expanduser("~")

    # 1. Scan Chromium browser preferences for unpacked extension paths
    browser_roots = [
        ("Google Chrome", os.path.join(local_app, "Google", "Chrome", "User Data")),
        ("Brave Browser", os.path.join(local_app, "BraveSoftware", "Brave-Browser", "User Data")),
        ("Microsoft Edge", os.path.join(local_app, "Microsoft", "Edge", "User Data")),
        ("Opera", os.path.join(os.environ.get("APPDATA", ""), "Opera Software", "Opera Stable")),
    ]

    for b_name, b_root in browser_roots:
        if not os.path.isdir(b_root):
            continue
        pref_patterns = [
            os.path.join(b_root, "*", "Preferences"),
            os.path.join(b_root, "*", "Secure Preferences"),
            os.path.join(b_root, "Preferences"),
            os.path.join(b_root, "Secure Preferences"),
        ]
        for pattern in pref_patterns:
            for pref_file in glob.glob(pattern):
                prof_name = os.path.basename(os.path.dirname(pref_file))
                if prof_name.lower() in ("user data", "opera stable"):
                    prof_name = "Default"
                try:
                    with open(pref_file, "r", encoding="utf-8", errors="ignore") as pf:
                        pdata = json.load(pf)
                    ext_settings = pdata.get("extensions", {}).get("settings", {})
                    for _, ext_val in ext_settings.items():
                        epath = ext_val.get("path")
                        if epath:
                            add_candidate(epath, f"{b_name} ({prof_name})")
                except Exception:
                    pass

    # 2. Common folders & workspace paths
    typical_paths = [
        (get_default_install_dir(), "Standard Documents"),
        (os.path.join(user_home, "Documents", "yt-loop-shorts"), "Documents folder"),
        (os.path.join(user_home, "Downloads", "cleartube"), "Downloads folder"),
        (os.path.join(user_home, "Downloads", "ClearTube"), "Downloads folder"),
        (os.path.join(user_home, "Desktop", "cleartube"), "Desktop folder"),
        (os.path.join(user_home, "Documents", "clearline", "extension"), "ClearLine Project"),
        (os.path.join(_base_dir(), "..", "extension"), "Relative ../extension"),
        (os.path.join(_base_dir(), "extension"), "Relative ./extension"),
    ]
    for c_path, c_label in typical_paths:
        add_candidate(c_path, c_label)

    return results

def get_best_location(cfg):
    """Determine active extension location based on config, detection, or default."""
    configured = cfg.get("ext_path")
    if configured and read_manifest_info(configured):
        return os.path.normpath(configured)

    detected = detect_all_locations()
    if detected:
        # Prefer browser-registered paths
        for d in detected:
            if any(b in d["source"] for b in ("Chrome", "Brave", "Edge")):
                return d["path"]
        return detected[0]["path"]

    return ""

# ── Version & Network Helpers ──────────────────────────────────────────────

def parse_version(v_str):
    res = []
    for x in str(v_str).strip().split("."):
        try:
            res.append(int(x))
        except ValueError:
            res.append(0)
    return res

def is_newer_version(remote, local):
    if not local or local == "Not Installed":
        return True
    r, l = parse_version(remote), parse_version(local)
    for a, b in zip(r + [0] * 5, l + [0] * 5):
        if a > b:
            return True
        if a < b:
            return False
    return False

def fetch_remote_info(url=DEFAULT_VERSION_URL):
    req = Request(url, headers={"User-Agent": "ClearTubeUpdater/2.0", "Cache-Control": "no-cache"})
    with urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return (
        data.get("version", "0.0.0"),
        data.get("url", DEFAULT_ZIP_URL),
        data.get("notes", "")
    )

# ── Download, Install & In-Place Update Logic ──────────────────────────────

def install_or_update_extension(zip_url, ext_path, keep_backup=True):
    """
    Downloads new release zip and installs or updates ext_path:
    - If ext_path exists: retains exact directory path and name, wipes old files, extracts new.
    - If ext_path does not exist: creates directory and extracts files fresh.
    """
    norm_path = os.path.normpath(ext_path)
    is_fresh = not os.path.isdir(norm_path) or not read_manifest_info(norm_path)

    # 1. Download zip into memory
    req = Request(zip_url, headers={"User-Agent": "ClearTubeUpdater/2.0"})
    with urlopen(req, timeout=120) as r:
        zip_bytes = r.read()

    if len(zip_bytes) < 1000:
        raise ValueError("Downloaded update package is invalid or incomplete.")

    # 2. Backup if updating an existing install
    backup_path = norm_path.rstrip("/\\") + "_backup"
    if not is_fresh and keep_backup:
        try:
            if os.path.exists(backup_path):
                shutil.rmtree(backup_path, ignore_errors=True)
            shutil.copytree(norm_path, backup_path)
        except Exception:
            pass

    # 3. Prepare target directory
    os.makedirs(norm_path, exist_ok=True)
    if not is_fresh:
        for item in os.listdir(norm_path):
            p = os.path.join(norm_path, item)
            try:
                if os.path.isdir(p):
                    shutil.rmtree(p, ignore_errors=True)
                else:
                    os.remove(p)
            except Exception:
                pass

    # 4. Extract new contents directly into norm_path
    try:
        with ZipFile(BytesIO(zip_bytes)) as zf:
            namelist = zf.namelist()
            top_level = {n.split("/")[0] for n in namelist if n and not n.startswith("__MACOSX")}
            prefix = ""
            if len(top_level) == 1:
                single_folder = list(top_level)[0]
                if f"{single_folder}/manifest.json" in namelist:
                    prefix = f"{single_folder}/"

            for member in zf.infolist():
                name = member.filename
                if name.startswith("__MACOSX") or member.is_dir():
                    continue
                rel_path = name
                if prefix and rel_path.startswith(prefix):
                    rel_path = rel_path[len(prefix):]
                if not rel_path or rel_path.endswith("/"):
                    continue

                target_file = os.path.join(norm_path, rel_path.replace("/", os.sep))
                os.makedirs(os.path.dirname(target_file), exist_ok=True)
                with zf.open(member) as src, open(target_file, "wb") as dst:
                    dst.write(src.read())

    except Exception as err:
        if not is_fresh and keep_backup and os.path.isdir(backup_path):
            try:
                for item in os.listdir(norm_path):
                    ip = os.path.join(norm_path, item)
                    (shutil.rmtree if os.path.isdir(ip) else os.remove)(ip)
                for b_item in os.listdir(backup_path):
                    s = os.path.join(backup_path, b_item)
                    d = os.path.join(norm_path, b_item)
                    (shutil.copytree if os.path.isdir(s) else shutil.copy2)(s, d)
            except Exception:
                pass
        raise RuntimeError(f"Failed extracting files: {err}")

    if not os.path.isfile(os.path.join(norm_path, "manifest.json")):
        raise RuntimeError("Installation completed, but manifest.json was not found.")

    return is_fresh, (backup_path if (not is_fresh and keep_backup and os.path.isdir(backup_path)) else None)

# ── Windows Startup Registry ───────────────────────────────────────────────

def _get_exe_command():
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}" --auto'
    return f'"{sys.executable}" "{os.path.abspath(__file__)}" --auto'

def check_startup_enabled():
    if not winreg:
        return False
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, STARTUP_KEY, 0, winreg.KEY_READ)
        val, _ = winreg.QueryValueEx(key, STARTUP_NAME)
        winreg.CloseKey(key)
        return bool(val)
    except Exception:
        return False

def configure_startup(enabled):
    if not winreg:
        return
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, STARTUP_KEY, 0, winreg.KEY_SET_VALUE)
        if enabled:
            winreg.SetValueEx(key, STARTUP_NAME, 0, winreg.REG_SZ, _get_exe_command())
        else:
            try:
                winreg.DeleteValue(key, STARTUP_NAME)
            except FileNotFoundError:
                pass
        winreg.CloseKey(key)
    except Exception as e:
        print(f"Startup toggle error: {e}")

# ── GUI Application ────────────────────────────────────────────────────────

class ClearTubeApp:
    def __init__(self, root):
        self.root = root
        self.root.title("ClearTube Installer & Updater")
        self.root.configure(bg=BG)
        self.root.resizable(False, False)

        self.cfg = load_config()
        self.current_location = get_best_location(self.cfg) or get_default_install_dir()
        self.remote_version = None
        self.remote_zip_url = None
        self.remote_notes = ""
        self.detected_list = []
        self._action_mode = "check"

        self.container = tk.Frame(self.root, bg=BG)
        self.container.pack(fill="both", expand=True)

        self.main_frame = tk.Frame(self.container, bg=BG)
        self.settings_frame = tk.Frame(self.container, bg=BG)

        self.build_main_view()
        self.build_settings_view()

        self.show_main_view()
        self.center_window(520, 580)
        self.polish()

        self.root.after(100, self.start_check_thread)

    def polish(self):
        """Dark title bar on Windows + hover/pressed colors for every button."""
        try:
            import ctypes
            self.root.update()
            hwnd = ctypes.windll.user32.GetParent(self.root.winfo_id())
            for attr in (20, 19):  # DWMWA_USE_IMMERSIVE_DARK_MODE (new / old id)
                ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, attr, ctypes.byref(ctypes.c_int(1)), 4)
        except Exception:
            pass

        def walk(w):
            for c in w.winfo_children():
                if isinstance(c, tk.Button):
                    primary = str(c.cget("bg")).lower() == ACCENT.lower()
                    c.configure(
                        activebackground=ACCENT2 if primary else HOVER,
                        activeforeground=ON_ACCENT if primary else INK,
                        highlightthickness=0 if not primary else 0,
                        takefocus=0,
                    )
                walk(c)
        walk(self.root)

    def center_window(self, width, height):
        self.root.update_idletasks()
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        x = max(0, (sw - width) // 2)
        y = max(0, (sh - height) // 2)
        self.root.geometry(f"{width}x{height}+{x}+{y}")

    # ── View Switching ─────────────────────────────────────────────────────

    def show_main_view(self):
        self.settings_frame.pack_forget()
        self.main_frame.pack(fill="both", expand=True)
        self.update_main_location_label()

    def show_settings_view(self):
        self.main_frame.pack_forget()
        self.settings_frame.pack(fill="both", expand=True)
        self.refresh_settings_view()

    # ── Build Main View ────────────────────────────────────────────────────

    def build_main_view(self):
        header = tk.Frame(self.main_frame, bg=BG)
        header.pack(fill="x", padx=24, pady=(20, 0))

        title_box = tk.Frame(header, bg=BG)
        title_box.pack(side="left")

        tk.Label(title_box, text="Clear", font=("Segoe UI", 16, "bold"), bg=BG, fg=INK).pack(side="left")
        tk.Label(title_box, text="Tube", font=("Segoe UI", 16, "bold"), bg=BG, fg=ACCENT).pack(side="left")
        tk.Label(title_box, text="  Manager", font=("Segoe UI", 11), bg=BG, fg=MUTED).pack(side="left", pady=(3, 0))

        btn_settings = tk.Button(
            header, text="⚙ Settings", font=("Segoe UI", 9, "bold"),
            bg=CARD, fg=INK, relief="flat", bd=0, cursor="hand2",
            highlightthickness=1, highlightbackground=CARD_BORDER,
            padx=12, pady=5, command=self.show_settings_view
        )
        btn_settings.pack(side="right")

        tk.Frame(self.main_frame, bg=LINE, height=1).pack(fill="x", padx=24, pady=(14, 0))

        # Location Card
        loc_card = tk.Frame(self.main_frame, bg=CARD, highlightthickness=1, highlightbackground=CARD_BORDER)
        loc_card.pack(fill="x", padx=24, pady=(14, 0))

        loc_hdr = tk.Frame(loc_card, bg=CARD)
        loc_hdr.pack(fill="x", padx=14, pady=(10, 0))
        self.lbl_loc_title = tk.Label(loc_hdr, text="EXTENSION FOLDER", font=("Segoe UI", 8, "bold"), bg=CARD, fg=MUTED)
        self.lbl_loc_title.pack(side="left")

        self.lbl_loc_badge = tk.Label(loc_hdr, text="Auto-Detected", font=("Segoe UI", 8, "bold"), bg=BADGE_BG, fg=ACCENT2, padx=6, pady=1)
        self.lbl_loc_badge.pack(side="right")

        self.lbl_main_path = tk.Label(
            loc_card, text=self.current_location,
            font=("Segoe UI", 9), bg=CARD, fg=INK, anchor="w", wraplength=440, justify="left"
        )
        self.lbl_main_path.pack(fill="x", padx=14, pady=(4, 10))

        # Version Info Box
        ver_box = tk.Frame(self.main_frame, bg=CARD, highlightthickness=1, highlightbackground=CARD_BORDER)
        ver_box.pack(fill="x", padx=24, pady=(12, 0))

        col1 = tk.Frame(ver_box, bg=CARD)
        col1.pack(side="left", padx=16, pady=12)
        tk.Label(col1, text="INSTALLED", font=("Segoe UI", 8, "bold"), bg=CARD, fg=MUTED).pack(anchor="w")
        self.lbl_installed = tk.Label(col1, text="…", font=("Segoe UI", 12, "bold"), bg=CARD, fg=INK)
        self.lbl_installed.pack(anchor="w", pady=(2, 0))

        tk.Frame(ver_box, bg=LINE, width=1).pack(side="left", fill="y", pady=8)

        col2 = tk.Frame(ver_box, bg=CARD)
        col2.pack(side="left", padx=16, pady=12)
        tk.Label(col2, text="AVAILABLE", font=("Segoe UI", 8, "bold"), bg=CARD, fg=MUTED).pack(anchor="w")
        self.lbl_available = tk.Label(col2, text="…", font=("Segoe UI", 12, "bold"), bg=CARD, fg=INK)
        self.lbl_available.pack(anchor="w", pady=(2, 0))

        self.lbl_status_pill = tk.Label(ver_box, text="", font=("Segoe UI", 9, "bold"), bg=CARD, fg=MUTED)
        self.lbl_status_pill.pack(side="right", padx=16)

        # Release Notes / Description
        self.lbl_notes = tk.Label(
            self.main_frame, text="", font=("Segoe UI", 8), bg=BG, fg=MUTED,
            wraplength=460, justify="center"
        )
        self.lbl_notes.pack(fill="x", padx=24, pady=(8, 0))

        # Primary Action Button (Install / Update)
        self.btn_action = tk.Button(
            self.main_frame, text="Checking status…", font=("Segoe UI", 11, "bold"),
            bg=ACCENT, fg=ON_ACCENT, activebackground=ACCENT2, activeforeground=ON_ACCENT,
            relief="flat", bd=0, cursor="hand2", padx=20, pady=14,
            command=self.on_primary_action
        )
        self.btn_action.pack(fill="x", padx=24, pady=(14, 0))

        # Action Links Row
        action_row = tk.Frame(self.main_frame, bg=BG)
        action_row.pack(fill="x", padx=24, pady=(10, 0))

        btn_open_folder = tk.Button(
            action_row, text="📁 Open Folder", font=("Segoe UI", 8, "bold"),
            bg=CARD, fg=INK, relief="flat", bd=0, cursor="hand2",
            padx=10, pady=4, command=self.open_current_folder
        )
        btn_open_folder.pack(side="left")

        btn_guide = tk.Button(
            action_row, text="🌐 Browser Setup Guide", font=("Segoe UI", 8, "bold"),
            bg=CARD, fg=INK, relief="flat", bd=0, cursor="hand2",
            padx=10, pady=4, command=self.show_browser_setup_modal
        )
        btn_guide.pack(side="left", padx=(8, 0))

        btn_recheck = tk.Button(
            action_row, text="↻ Re-scan", font=("Segoe UI", 8),
            bg=CARD, fg=INK, relief="flat", bd=0, cursor="hand2",
            padx=10, pady=4, command=self.start_check_thread
        )
        btn_recheck.pack(side="right")

        # Bottom Status Bar
        tk.Frame(self.main_frame, bg=LINE, height=1).pack(fill="x", padx=24, pady=(14, 0))
        self.lbl_status = tk.Label(self.main_frame, text="Ready", font=("Segoe UI", 9), bg=BG, fg=MUTED, anchor="w")
        self.lbl_status.pack(fill="x", padx=24, pady=(6, 12))

    # ── Build Settings View ────────────────────────────────────────────────

    def build_settings_view(self):
        hdr = tk.Frame(self.settings_frame, bg=BG)
        hdr.pack(fill="x", padx=24, pady=(18, 0))

        btn_back = tk.Button(
            hdr, text="← Back", font=("Segoe UI", 9, "bold"),
            bg=CARD, fg=INK, relief="flat", bd=0, cursor="hand2",
            padx=10, pady=4, command=self.show_main_view
        )
        btn_back.pack(side="left")

        tk.Label(hdr, text="Settings & Locations", font=("Segoe UI", 12, "bold"), bg=BG, fg=INK).pack(side="left", padx=12)

        tk.Frame(self.settings_frame, bg=LINE, height=1).pack(fill="x", padx=24, pady=(12, 0))

        content = tk.Frame(self.settings_frame, bg=BG)
        content.pack(fill="both", expand=True, padx=24, pady=(6, 14))

        # Section 1: Detected Browser Locations
        tk.Label(content, text="ACTIVE / DETECTED EXTENSION FOLDERS", font=("Segoe UI", 8, "bold"), bg=BG, fg=MUTED).pack(anchor="w")

        self.loc_listbox_frame = tk.Frame(content, bg=CARD, highlightthickness=1, highlightbackground=CARD_BORDER)
        self.loc_listbox_frame.pack(fill="x", pady=(4, 0))

        self.loc_listbox = tk.Listbox(
            self.loc_listbox_frame, font=("Segoe UI", 9), bg=CARD, fg=INK,
            selectbackground=ACCENT, selectforeground=ON_ACCENT,
            relief="flat", bd=0, height=4, activestyle="none"
        )
        self.loc_listbox.pack(side="left", fill="both", expand=True, padx=6, pady=6)

        loc_btn_row = tk.Frame(content, bg=BG)
        loc_btn_row.pack(fill="x", pady=(6, 10))

        tk.Button(
            loc_btn_row, text="Select As Active", font=("Segoe UI", 8, "bold"),
            bg=ACCENT, fg=ON_ACCENT, relief="flat", bd=0, cursor="hand2",
            padx=8, pady=4, command=self.on_use_selected_location
        ).pack(side="left", padx=(0, 6))

        tk.Button(
            loc_btn_row, text="Choose Custom Folder...", font=("Segoe UI", 8),
            bg=CARD, fg=INK, relief="flat", bd=0, cursor="hand2",
            padx=8, pady=4, command=self.on_browse_custom_folder
        ).pack(side="left", padx=(0, 6))

        tk.Button(
            loc_btn_row, text="Re-Scan Browsers", font=("Segoe UI", 8),
            bg=CARD, fg=INK, relief="flat", bd=0, cursor="hand2",
            padx=8, pady=4, command=self.refresh_settings_view
        ).pack(side="left")

        # Section 2: Automation & Preferences
        tk.Label(content, text="AUTOMATIC UPDATES & STARTUP", font=("Segoe UI", 8, "bold"), bg=BG, fg=MUTED).pack(anchor="w", pady=(4, 0))

        opts_card = tk.Frame(content, bg=CARD, highlightthickness=1, highlightbackground=CARD_BORDER)
        opts_card.pack(fill="x", pady=(4, 10))

        self.var_startup = tk.BooleanVar(value=check_startup_enabled())
        chk_startup = tk.Checkbutton(
            opts_card, text=" Launch on Windows startup (auto-checks for new updates)",
            variable=self.var_startup, font=("Segoe UI", 9), bg=CARD, fg=INK,
            selectcolor=BG, activebackground=CARD, activeforeground=INK, anchor="w", cursor="hand2",
            command=self.on_toggle_startup
        )
        chk_startup.pack(fill="x", padx=10, pady=(6, 3))

        self.var_silent = tk.BooleanVar(value=self.cfg.get("silent_auto_update", False))
        chk_silent = tk.Checkbutton(
            opts_card, text=" Download & apply updates silently in the background",
            variable=self.var_silent, font=("Segoe UI", 9), bg=CARD, fg=INK,
            selectcolor=BG, activebackground=CARD, activeforeground=INK, anchor="w", cursor="hand2",
            command=self.save_settings_from_gui
        )
        chk_silent.pack(fill="x", padx=10, pady=(0, 3))

        self.var_backup = tk.BooleanVar(value=self.cfg.get("keep_backup", True))
        chk_backup = tk.Checkbutton(
            opts_card, text=" Create automatic backup of previous version before updating",
            variable=self.var_backup, font=("Segoe UI", 9), bg=CARD, fg=INK,
            selectcolor=BG, activebackground=CARD, activeforeground=INK, anchor="w", cursor="hand2",
            command=self.save_settings_from_gui
        )
        chk_backup.pack(fill="x", padx=10, pady=(0, 6))

        # Section 3: Recovery
        tk.Label(content, text="BACKUP RESTORATION", font=("Segoe UI", 8, "bold"), bg=BG, fg=MUTED).pack(anchor="w")

        rec_card = tk.Frame(content, bg=CARD, highlightthickness=1, highlightbackground=CARD_BORDER)
        rec_card.pack(fill="x", pady=(4, 0))

        rec_btn_row = tk.Frame(rec_card, bg=CARD)
        rec_btn_row.pack(fill="x", padx=10, pady=6)

        tk.Button(
            rec_btn_row, text="Restore Previous Backup", font=("Segoe UI", 8),
            bg=SOFT_BTN, fg=INK, relief="flat", bd=0, cursor="hand2",
            padx=8, pady=4, command=self.on_restore_backup
        ).pack(side="left", padx=(0, 6))

        tk.Button(
            rec_btn_row, text="Open chrome://extensions", font=("Segoe UI", 8),
            bg=SOFT_BTN, fg=INK, relief="flat", bd=0, cursor="hand2",
            padx=8, pady=4, command=self.open_chrome_url
        ).pack(side="left")

    def update_main_location_label(self):
        path = self.current_location
        has_install = bool(path and read_manifest_info(path))

        if has_install:
            self.lbl_loc_title.config(text="INSTALLED EXTENSION FOLDER")
            self.lbl_main_path.config(text=path)
            badge = "Detected"
            for d in self.detected_list:
                if d["path"].lower() == path.lower():
                    badge = d["source"]
                    break
            self.lbl_loc_badge.config(text=badge, bg=BADGE_BG, fg=ACCENT2)
        else:
            self.lbl_loc_title.config(text="INSTALL DESTINATION")
            self.lbl_main_path.config(text=path or get_default_install_dir())
            self.lbl_loc_badge.config(text="New Install", bg=BADGE_NEW, fg=SUCCESS)

    def refresh_settings_view(self):
        self.detected_list = detect_all_locations()
        self.loc_listbox.delete(0, tk.END)
        cur_norm = self.current_location.lower() if self.current_location else ""
        sel_index = 0

        for idx, item in enumerate(self.detected_list):
            label = f"{item['source']} [v{item['version']}] → {item['path']}"
            self.loc_listbox.insert(tk.END, label)
            if item["path"].lower() == cur_norm:
                sel_index = idx

        if not self.detected_list:
            self.loc_listbox.insert(tk.END, f"Default Location → {get_default_install_dir()}")

        self.loc_listbox.selection_set(sel_index)

    def on_use_selected_location(self):
        sel = self.loc_listbox.curselection()
        if not sel:
            messagebox.showinfo("Select", "Please select a location from the list.")
            return
        if self.detected_list:
            chosen = self.detected_list[sel[0]]["path"]
        else:
            chosen = get_default_install_dir()

        self.current_location = chosen
        self.cfg["ext_path"] = chosen
        save_config(self.cfg)
        self.update_main_location_label()
        self.show_main_view()
        self.start_check_thread()

    def on_browse_custom_folder(self):
        d = filedialog.askdirectory(title="Select ClearTube Destination Folder")
        if not d:
            return
        self.current_location = os.path.normpath(d)
        self.cfg["ext_path"] = self.current_location
        save_config(self.cfg)
        self.update_main_location_label()
        self.show_main_view()
        self.start_check_thread()

    def on_toggle_startup(self):
        configure_startup(self.var_startup.get())

    def save_settings_from_gui(self):
        self.cfg["silent_auto_update"] = self.var_silent.get()
        self.cfg["keep_backup"] = self.var_backup.get()
        save_config(self.cfg)

    def on_restore_backup(self):
        if not self.current_location:
            return
        backup = self.current_location.rstrip("/\\") + "_backup"
        if not os.path.isdir(backup):
            messagebox.showinfo("No Backup Found", f"No backup found at:\n{backup}")
            return
        ans = messagebox.askyesno("Restore Backup", f"Replace current extension with backup from:\n{backup}?")
        if not ans:
            return
        try:
            for item in os.listdir(self.current_location):
                p = os.path.join(self.current_location, item)
                (shutil.rmtree if os.path.isdir(p) else os.remove)(p)
            for b_item in os.listdir(backup):
                s = os.path.join(backup, b_item)
                d = os.path.join(self.current_location, b_item)
                (shutil.copytree if os.path.isdir(s) else shutil.copy2)(s, d)
            messagebox.showinfo("Restored", "Backup restored successfully. Reload extension in Chrome.")
            self.start_check_thread()
        except Exception as e:
            messagebox.showerror("Error", f"Failed restoring backup: {e}")

    def open_current_folder(self):
        target = self.current_location or get_default_install_dir()
        os.makedirs(target, exist_ok=True)
        os.startfile(target)

    def open_chrome_url(self):
        try:
            webbrowser.open("chrome://extensions")
        except Exception:
            pass
        self.show_browser_setup_modal()

    def show_browser_setup_modal(self):
        folder = self.current_location or get_default_install_dir()
        msg = (
            "HOW TO ACTIVATE IN CHROME / BRAVE / EDGE:\n\n"
            "1. Open your browser and go to:  chrome://extensions\n"
            "   (or brave://extensions or edge://extensions)\n\n"
            "2. Turn ON the 'Developer mode' toggle (top-right corner)\n\n"
            "3. Click the 'Load unpacked' button (top-left)\n\n"
            f"4. Select this folder:\n   {folder}\n\n"
            "ClearTube is now active on YouTube!"
        )
        messagebox.showinfo("Browser Setup Instructions", msg)

    # ── Check & Install/Update Handlers ────────────────────────────────────

    def start_check_thread(self):
        self.lbl_status.config(text="Scanning system & checking for latest release…")
        self.btn_action.config(state="disabled", text="Checking…", bg=HOVER, fg=INK)
        threading.Thread(target=self._worker_check, daemon=True).start()

    def _worker_check(self):
        self.detected_list = detect_all_locations()

        # If current location isn't a valid install, adopt first detected or default
        if not read_manifest_info(self.current_location):
            if self.detected_list:
                self.current_location = self.detected_list[0]["path"]
                self.cfg["ext_path"] = self.current_location
                save_config(self.cfg)
            elif not self.current_location:
                self.current_location = get_default_install_dir()

        local_info = read_manifest_info(self.current_location)
        local_ver = local_info[1] if local_info else None

        remote_ver = None
        zip_url = None
        notes = ""
        error_msg = None

        try:
            url = self.cfg.get("update_url", DEFAULT_VERSION_URL)
            remote_ver, zip_url, notes = fetch_remote_info(url)
        except Exception as e:
            error_msg = str(e)

        self.root.after(0, self._on_check_completed, local_ver, remote_ver, zip_url, notes, error_msg)

    def _on_check_completed(self, local_ver, remote_ver, zip_url, notes, error_msg):
        self.update_main_location_label()

        if local_ver:
            self.lbl_installed.config(text=f"v{local_ver}")
        else:
            self.lbl_installed.config(text="Not Installed")

        if error_msg:
            self.lbl_available.config(text="Offline")
            self.lbl_status_pill.config(text="● Check Failed", fg=DANGER)
            self.lbl_status.config(text=f"Network error: {error_msg}")
            self.btn_action.config(state="normal", text="Retry Connection", bg=CARD, fg=INK)
            self._action_mode = "check"
            return

        self.remote_version = remote_ver
        self.remote_zip_url = zip_url
        self.remote_notes = notes
        self.lbl_available.config(text=f"v{remote_ver}")

        # Fresh install state
        if not local_ver:
            self.lbl_status_pill.config(text="● Ready to Install", fg=SUCCESS)
            self.lbl_notes.config(text="Click below to download and install ClearTube.")
            self.lbl_status.config(text="ClearTube is not yet installed on this PC.")
            self.btn_action.config(
                state="normal",
                text=f"⬇ Download & Install ClearTube v{remote_ver}",
                bg=ACCENT, fg=ON_ACCENT
            )
            self._action_mode = "install"
            return

        # Existing install state
        has_update = is_newer_version(remote_ver, local_ver)
        if has_update:
            self.lbl_status_pill.config(text="● Update Available", fg=ACCENT)
            self.lbl_notes.config(text=f'"{notes}"' if notes else "")
            self.lbl_status.config(text=f"New version v{remote_ver} is available.")
            self.btn_action.config(
                state="normal",
                text=f"Update to v{remote_ver}",
                bg=ACCENT, fg=ON_ACCENT
            )
            self._action_mode = "update"
        else:
            self.lbl_status_pill.config(text="✓ Up to date", fg=SUCCESS)
            self.lbl_notes.config(text="You are running the latest version of ClearTube.")
            self.lbl_status.config(text="Extension is up to date.")
            self.btn_action.config(
                state="normal",
                text="Check for Updates",
                bg=CARD, fg=INK
            )
            self._action_mode = "check"

    def on_primary_action(self):
        if self._action_mode in ("install", "update"):
            self.start_install_update_thread()
        else:
            self.start_check_thread()

    def start_install_update_thread(self):
        target = self.current_location or get_default_install_dir()
        action_verb = "Installing" if self._action_mode == "install" else "Updating"

        self.btn_action.config(state="disabled", text=f"{action_verb}… please wait", bg=HOVER, fg=INK)
        self.lbl_status.config(text=f"Downloading ClearTube v{self.remote_version} and setting up files…")
        threading.Thread(target=self._worker_install_update, args=(target,), daemon=True).start()

    def _worker_install_update(self, target):
        err = None
        is_fresh = False
        backup = None
        try:
            keep_backup = self.cfg.get("keep_backup", True)
            is_fresh, backup = install_or_update_extension(self.remote_zip_url, target, keep_backup=keep_backup)
            self.current_location = target
            self.cfg["ext_path"] = target
            save_config(self.cfg)
        except Exception as e:
            err = str(e)

        self.root.after(0, self._on_install_update_completed, err, is_fresh, backup)

    def _on_install_update_completed(self, err, is_fresh, backup):
        if err:
            self.btn_action.config(state="normal", text="Retry", bg=ACCENT, fg=ON_ACCENT)
            self.lbl_status.config(text=f"Operation failed: {err}")
            messagebox.showerror("Error", f"Failed to complete operation:\n\n{err}")
        else:
            self.start_check_thread()
            if is_fresh:
                messagebox.showinfo(
                    "Install Complete!",
                    f"🎉 ClearTube v{self.remote_version} installed successfully!\n\n"
                    f"Folder: {self.current_location}\n\n"
                    "Next: Open chrome://extensions, turn on Developer Mode, click 'Load unpacked', and select this folder."
                )
                self.show_browser_setup_modal()
            else:
                msg = (
                    f"ClearTube has been updated to v{self.remote_version} in-place!\n\n"
                    f"Location: {self.current_location}\n\n"
                    "To activate:\n"
                    "1. Go to chrome://extensions (or brave://extensions)\n"
                    "2. Click the reload button (↻) on ClearTube\n"
                    "3. Refresh any open YouTube tabs."
                )
                if backup:
                    msg += f"\n\n(Previous version backup: {os.path.basename(backup)})"
                messagebox.showinfo("Update Complete", msg)

# ── Silent Mode (--auto) ───────────────────────────────────────────────────

def run_silent_mode():
    cfg = load_config()
    target = get_best_location(cfg)
    if not target or not os.path.isdir(target):
        return

    info = read_manifest_info(target)
    if not info:
        return
    local_ver = info[1]

    try:
        url = cfg.get("update_url", DEFAULT_VERSION_URL)
        remote_ver, zip_url, _ = fetch_remote_info(url)
        if is_newer_version(remote_ver, local_ver):
            if cfg.get("silent_auto_update", False):
                install_or_update_extension(zip_url, target, keep_backup=cfg.get("keep_backup", True))
            else:
                root = tk.Tk()
                root.withdraw()
                ans = messagebox.askyesno(
                    "ClearTube Update Available",
                    f"A new ClearTube version (v{remote_ver}) is ready.\nUpdate now in:\n{target}?"
                )
                if ans:
                    install_or_update_extension(zip_url, target, keep_backup=cfg.get("keep_backup", True))
                    messagebox.showinfo("ClearTube Updated", f"Updated to v{remote_ver}! Reload in chrome://extensions.")
                root.destroy()
    except Exception:
        pass

# ── Entry Point ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if "--auto" in sys.argv:
        run_silent_mode()
    else:
        root = tk.Tk()
        app = ClearTubeApp(root)
        root.mainloop()
