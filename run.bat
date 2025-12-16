@echo off
:: Sync-Player Launcher
:: This batch file launches the PowerShell script with ExecutionPolicy Bypass
:: so users don't need to configure their execution policy manually.

title Sync-Player
cd /d "%~dp0"

:: Launch PowerShell with bypass
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0console.ps1"

:: If PowerShell isn't available, show error
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Could not run PowerShell script.
    echo Please make sure PowerShell is installed.
    echo.
    pause
)
