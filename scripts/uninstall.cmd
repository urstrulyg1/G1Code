@echo off
setlocal EnableDelayedExpansion

REM ============================================================
REM  G1Code - Complete Uninstaller (Windows)
REM  Removes G1Code and ALL leftover data, cache, and shortcuts
REM ============================================================

echo.
echo  ========================================================
echo    G1Code - Complete Uninstaller
echo  ========================================================
echo.

REM -- 1. Kill running G1Code processes
echo [1/6] Stopping G1Code processes...
taskkill /IM "G1Code.exe" /F >nul 2>&1
if %errorlevel%==0 (
    echo       Killed G1Code.exe
    timeout /t 2 /nobreak >nul
) else (
    echo       No running G1Code processes found
)

REM -- 2. Run the NSIS uninstaller silently
echo [2/6] Running NSIS uninstaller...
set "UNINSTALLER_PF=C:\Program Files\G1Code\Uninstall G1Code.exe"
set "UNINSTALLER_LOCALAPP=%LOCALAPPDATA%\Programs\G1Code\Uninstall G1Code.exe"

if exist "%UNINSTALLER_PF%" (
    echo       Found uninstaller at Program Files
    "%UNINSTALLER_PF%" /S /allusers
    timeout /t 5 /nobreak >nul
) else if exist "%UNINSTALLER_LOCALAPP%" (
    echo       Found uninstaller at Local AppData
    "%UNINSTALLER_LOCALAPP%" /S /currentuser
    timeout /t 5 /nobreak >nul
) else (
    echo       No NSIS uninstaller found, proceeding with manual cleanup
)

REM -- 3. Remove installation directories
echo [3/6] Removing installation directories...
set CLEANED=0

if exist "C:\Program Files\G1Code" (
    rmdir /s /q "C:\Program Files\G1Code" 2>nul
    if not exist "C:\Program Files\G1Code" (
        echo       Removed C:\Program Files\G1Code
        set CLEANED=1
    ) else (
        echo       [!] Could not remove C:\Program Files\G1Code - need admin
    )
)

if exist "%LOCALAPPDATA%\Programs\G1Code" (
    rmdir /s /q "%LOCALAPPDATA%\Programs\G1Code" 2>nul
    echo       Removed %LOCALAPPDATA%\Programs\G1Code
    set CLEANED=1
)

if !CLEANED!==0 (
    echo       No installation directories found
)

REM -- 4. Remove user data and Electron cache
echo [4/6] Removing user data and cache...

if exist "%APPDATA%\G1Code" (
    rmdir /s /q "%APPDATA%\G1Code" 2>nul
    echo       Removed %APPDATA%\G1Code [database]
)

if exist "%APPDATA%\g1code-ai-ide" (
    rmdir /s /q "%APPDATA%\g1code-ai-ide" 2>nul
    echo       Removed %APPDATA%\g1code-ai-ide [Electron cache]
)

if exist "%LOCALAPPDATA%\g1code-ai-ide" (
    rmdir /s /q "%LOCALAPPDATA%\g1code-ai-ide" 2>nul
    echo       Removed %LOCALAPPDATA%\g1code-ai-ide
)

if exist "%LOCALAPPDATA%\G1Code" (
    rmdir /s /q "%LOCALAPPDATA%\G1Code" 2>nul
    echo       Removed %LOCALAPPDATA%\G1Code
)

if exist "%LOCALAPPDATA%\g1code-updater" (
    rmdir /s /q "%LOCALAPPDATA%\g1code-updater" 2>nul
    echo       Removed %LOCALAPPDATA%\g1code-updater
)

del /f /q "%TEMP%\g1code*" 2>nul

REM -- 5. Remove shortcuts
echo [5/6] Removing shortcuts...

if exist "%PUBLIC%\Desktop\G1Code.lnk" (
    del /f /q "%PUBLIC%\Desktop\G1Code.lnk" 2>nul
    echo       Removed public desktop shortcut
)
if exist "%USERPROFILE%\Desktop\G1Code.lnk" (
    del /f /q "%USERPROFILE%\Desktop\G1Code.lnk" 2>nul
    echo       Removed user desktop shortcut
)

if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\G1Code.lnk" (
    del /f /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\G1Code.lnk" 2>nul
    echo       Removed Start Menu shortcut
)
if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\G1Code" (
    rmdir /s /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\G1Code" 2>nul
    echo       Removed Start Menu folder
)
if exist "%ProgramData%\Microsoft\Windows\Start Menu\Programs\G1Code.lnk" (
    del /f /q "%ProgramData%\Microsoft\Windows\Start Menu\Programs\G1Code.lnk" 2>nul
    echo       Removed All Users Start Menu shortcut
)

REM -- 6. Clean up registry
echo [6/6] Cleaning registry entries...

reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\db526152-8485-5838-b552-c942f2f3e7bd" /f >nul 2>&1
if %errorlevel%==0 echo       Removed HKLM uninstall registry key

for /f "tokens=*" %%k in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall" /s /f "G1Code" 2^>nul ^| findstr /i "HKEY_"') do (
    reg delete "%%k" /f >nul 2>&1
    echo       Removed HKCU registry key
)

reg delete "HKCU\Software\G1Code" /f >nul 2>&1
reg delete "HKLM\Software\G1Code" /f >nul 2>&1

REM -- Verification
echo.
echo  --------------------------------------------------------
echo   Verification
echo  --------------------------------------------------------

set ALL_CLEAN=1

if exist "C:\Program Files\G1Code" (
    echo   [FAIL] C:\Program Files\G1Code still exists
    set ALL_CLEAN=0
) else (
    echo   [ OK ] C:\Program Files\G1Code removed
)

if exist "%APPDATA%\G1Code" (
    echo   [FAIL] AppData\Roaming\G1Code still exists
    set ALL_CLEAN=0
) else (
    echo   [ OK ] AppData\Roaming\G1Code removed
)

if exist "%APPDATA%\g1code-ai-ide" (
    echo   [FAIL] AppData\Roaming\g1code-ai-ide still exists
    set ALL_CLEAN=0
) else (
    echo   [ OK ] AppData\Roaming\g1code-ai-ide removed
)

if exist "%PUBLIC%\Desktop\G1Code.lnk" (
    echo   [FAIL] Desktop shortcut still exists
    set ALL_CLEAN=0
) else (
    echo   [ OK ] Desktop shortcut removed
)

reg query "HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\db526152-8485-5838-b552-c942f2f3e7bd" >nul 2>&1
if %errorlevel%==0 (
    echo   [FAIL] Registry entry still exists
    set ALL_CLEAN=0
) else (
    echo   [ OK ] Registry entry removed
)

echo.
if !ALL_CLEAN!==1 (
    echo  G1Code has been completely uninstalled. No leftovers!
) else (
    echo  Some items could not be removed. Try running as Administrator.
    echo  Right-click this script and select "Run as administrator"
)
echo.
pause
