@echo off
title Admin Console
color 0a
setlocal enabledelayedexpansion

:: =================================================================
:: Get script location and set working directory
:: =================================================================
set "batchdir=%~dp0"
cd /d "%batchdir%"
echo Running from: %cd%

:: =================================================================
:: Check Node.js installation
:: =================================================================
title Admin Console - Checking Node.js
echo Checking Node.js installation...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Node.js is not installed or not in PATH!
    echo Please download and install Node.js from:
    echo https://nodejs.org/
    echo Press Enter to download Node.js from here.
    pause >nul
    call winget install --id OpenJS.NodeJS.LTS -e
    echo.
)

:: =================================================================
:: Initialize configuration
:: =================================================================
title Admin Console - Initializing
if not exist config.txt (
    echo Creating default configuration...
    echo port: 3000 > config.txt
    echo volume_step: 5 >> config.txt
    echo skip_seconds: 5 >> config.txt
    echo Default config created
)

:: =================================================================
:: Create folders if needed
:: =================================================================
if not exist videos (
    mkdir videos
    echo Created videos directory
)

:: =================================================================
:: Check and Install Dependencies
:: =================================================================
title Admin Console - Checking Dependencies
echo Checking required dependencies...

:: Check Node.js dependencies
set MISSING_DEPS=0
if not exist node_modules (
    set MISSING_DEPS=1
    echo [MISSING]: Node.js dependencies (express, socket.io)
) else (
    echo Checking for specific dependencies...
    if not exist "node_modules\express" (
        set MISSING_DEPS=1
        echo [MISSING]: express package
    )
    if not exist "node_modules\socket.io" (
        set MISSING_DEPS=1
        echo [MISSING]: socket.io package
    )
    if %MISSING_DEPS% equ 0 (
        echo [OK]: All Node.js dependencies found
    )
)

:: Check FFmpeg
set MISSING_FFMPEG=0
where ffmpeg >nul 2>&1
if %errorlevel% neq 0 (
    set MISSING_FFMPEG=1
    echo [MISSING]: FFmpeg (required for video processing)
) else (
    echo [OK]: FFmpeg found
)

:: Ask user to install missing dependencies
if %MISSING_DEPS% equ 1 (
    echo.
    echo [REQUIRED]: This software needs Node.js dependencies to work properly.
    echo Missing packages: express, socket.io
    echo.
    echo Press ENTER to install dependencies automatically, or Ctrl+C to exit.
    pause >nul
    echo.
    echo Installing Node.js dependencies...
    call npm install express@5.1.0 socket.io@4.8.1
    call
    if %errorlevel% neq 0 (
        echo [ERROR]: Failed to install dependencies.
        echo Please check your internet connection and try again.
        echo You can also try running: npm install express@5.1.0 socket.io@4.8.1
        echo.
        pause
        exit /b 1
        ) else (
            echo [SUCCESS]: Dependencies installed successfully.
            set MISSING_DEPS=0
            color 0a
        )
)

:: Ask user about FFmpeg
if %MISSING_FFMPEG% equ 1 (
    echo.
    echo [REQUIRED]: FFmpeg is not installed.
    echo FFmpeg is required for proper video processing and MKV support.
    echo.
    echo Press ENTER to download FFmpeg.
    pause >nul
    call winget install ffmpeg
    echo.
)

:: =================================================================
:: Read configuration
:: =================================================================
title Admin Console - Reading Config
set PORT=3000
set VOLUME_STEP=5
set SKIP_SECONDS=5

if exist config.txt (
    for /f "tokens=1,* delims=: " %%a in ('type config.txt ^| findstr /v "^#"') do (
        if "%%a"=="port" set PORT=%%b
        if "%%a"=="volume_step" set VOLUME_STEP=%%b
        if "%%a"=="skip_seconds" set SKIP_SECONDS=%%b
    )
) else (
    echo [WARNING]: config.txt not found, using default values
)


:: =================================================================
:: Firewall Information
:: =================================================================
title Admin Console - Firewall Info
echo.
echo [INFO]: Ensure port %PORT% is open in Windows Firewall for network access
echo.

:: =================================================================
:: Get local IP address
:: =================================================================
title Admin Console - Getting IP
echo Getting local IP address...
set LOCAL_IP=
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4 Address"') do (
    set "LOCAL_IP=%%a"
    set LOCAL_IP=!LOCAL_IP: =!
    goto :ip_found
)

:ip_found
if "%LOCAL_IP%"=="" set LOCAL_IP=localhost

:: =================================================================
:: Display server information
:: =================================================================
title Admin Console
echo.
echo Minecraft Video Sync Server
echo ==========================
echo.
echo Settings:
echo - Server Port: %PORT%
echo - Volume Step: %VOLUME_STEP%%
echo - Skip Seconds: %SKIP_SECONDS%s
echo.
echo Access URLs:
echo - Your network: http://%LOCAL_IP%:%PORT%
echo - Admin Panel: http://%LOCAL_IP%:%PORT%/admin
echo - Testing purposes: http://localhost:%PORT%
echo.
echo Firewall: Manual configuration required for network access
echo.
echo Starting Server...
echo.
echo [DEBUG]: Current directory: %CD%
echo.
if not exist server.js (
    echo [ERROR]: server.js not found in current directory!
    echo Please ensure you are running this script from the correct folder.
    echo.
    pause
    exit /b 1
)
echo [DEBUG]: Starting server with port %PORT%...
node server.js %LOCAL_IP%
if %errorlevel% neq 0 (
    echo.
    echo [ERROR]: Server crashed with exit code %errorlevel%
    echo Please check the error messages above.
    echo.
    pause
)
