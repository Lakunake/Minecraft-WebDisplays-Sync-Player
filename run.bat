@echo off
:: Prefer Windows Terminal on Windows 10/11 - Check this FIRST to minimize CMD flash
if "%WT_SESSION%"=="" (
    where wt.exe >nul 2>&1
    if %errorlevel% equ 0 (
        :: Use VBScript to launch WT completely detached, avoiding ghost windows
        wscript.exe "%~dp0res\launcher.vbs" "%~dp0res\console.ps1"
        exit /b
    )
)

title Sync-Player
cd /d "%~dp0"

:: Check for PowerShell installation
where powershell.exe >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [ERROR]: PowerShell is not installed or not in PATH!
    echo PowerShell is required to run Sync-Player.
    echo.
    set /p "install=Press Enter to install PowerShell via winget, or Ctrl+C to exit: "
    
    echo.
    echo Installing PowerShell...
    winget install --id Microsoft.PowerShell -e
    
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR]: Failed to install PowerShell via winget.
        echo Please install it manually from: https://aka.ms/powershell
        pause
        exit /b 1
    )
    
    echo.
    echo [SUCCESS]: PowerShell installed. Please restart this script.
    pause
    exit /b 0
)

:: Launch PowerShell normally if already in WT or WT is missing
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0res\console.ps1"
