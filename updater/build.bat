@echo off
echo ============================================
echo   ClearTube Updater — Build Script
echo ============================================
echo.

:: Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python is not installed or not in PATH.
    echo Download it from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during install.
    pause
    exit /b 1
)

:: Install PyInstaller if needed
echo [1/2] Installing PyInstaller...
pip install pyinstaller --quiet --disable-pip-version-check

:: Build
echo [2/2] Building ClearTube Updater.exe...
pyinstaller --onefile --windowed --name "ClearTube Updater" updater.py --distpath . --clean --noconfirm >nul 2>&1

:: Clean up build artifacts
if exist build rmdir /s /q build
if exist "ClearTube Updater.spec" del "ClearTube Updater.spec"

echo.
if exist "ClearTube Updater.exe" (
    echo ============================================
    echo   SUCCESS: ClearTube Updater.exe is ready!
    echo ============================================
    echo.
    echo You can move the .exe anywhere — it will auto-detect the
    echo extension folder, or you can browse to it on first launch.
    echo.
    echo Tip: Enable "Launch on Windows startup" in the app for
    echo fully automatic background updates.
) else (
    echo BUILD FAILED — check the output above for errors.
)
echo.
pause

