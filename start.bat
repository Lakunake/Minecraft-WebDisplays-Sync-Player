@echo off
title Minecraft Video Sync Manager
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
echo Checking Node.js installation...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Node.js is not installed or not in PATH!
    echo Please download and install Node.js from:
    echo https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: =================================================================
:: Initialize configuration
:: =================================================================
if not exist config.txt (
    echo Creating default configuration...
    echo max_clients: 4 > config.txt
    echo video_file: filmeva.mp4 >> config.txt
    echo chunk_size: 10 >> config.txt
    echo port: 3000 >> config.txt
    echo volume_step: 5 >> config.txt
    echo skip_seconds: 10 >> config.txt
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
:: Install dependencies
:: =================================================================
if not exist node_modules (
    echo Installing Node.js dependencies...
    call npm install
    echo Dependencies installed
)

:: =================================================================
:: Read configuration
:: =================================================================
set MAX_CLIENTS=4
set VIDEO_FILE=filmeva.mp4
set CHUNK_SIZE=10
set PORT=3000
set VOLUME_STEP=5
set SKIP_SECONDS=10
set START_TIME=1

for /f "tokens=1,* delims=: " %%a in ('type config.txt ^| findstr /v "^#"') do (
    if "%%a"=="max_clients" set MAX_CLIENTS=%%b
    if "%%a"=="video_file" set VIDEO_FILE=%%b
    if "%%a"=="chunk_size" set CHUNK_SIZE=%%b
    if "%%a"=="port" set PORT=%%b
    if "%%a"=="volume_step" set VOLUME_STEP=%%b
    if "%%a"=="skip_seconds" set SKIP_SECONDS=%%b
    if "%%a"=="start_time" set START_TIME=%%b
)

:: =================================================================
:: Check FFmpeg installation
:: =================================================================
echo Checking FFmpeg installation...
where ffmpeg >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [WARNING]: FFMPEG IS NOT INSTALLED!
    echo Some video formats may not play correctly.
    echo Install FFmpeg from: https://ffmpeg.org/
    echo.
    timeout /t 5 >nul
)

:: =================================================================
:: Check firewall rule status
:: =================================================================
echo Checking firewall rule for port %PORT%...
set FIREWALL_RULE_EXISTS=0
netsh advfirewall firewall show rule name="Node.js WebDisplay" >nul 2>&1 && set FIREWALL_RULE_EXISTS=1

if %FIREWALL_RULE_EXISTS% equ 1 (
    echo Firewall rule exists
) else (
    echo Firewall rule does not exist
    net session >nul 2>&1
    if %errorlevel% equ 0 (
        echo Adding firewall rule...
        netsh advfirewall firewall add rule name="Node.js WebDisplay" dir=in action=allow protocol=TCP localport=%PORT%
        echo Rule added for port %PORT%
    ) else (
        echo.
        echo [WARNING]: ADMIN PRIVILEGES REQUIRED FOR FIREWALL CONFIGURATION!
        echo No firewall rule exists for port %PORT%.
        echo Server may not be accessible from other devices.
        echo.
        echo To fix: Run this script as Administrator
        echo.
        timeout /t 5 >nul
    )
)

:: =================================================================
:: Verify video file exists
:: =================================================================
if not exist "videos\%VIDEO_FILE%" (
    echo.
    echo ERROR: Video file not found!
    echo Expected: videos\%VIDEO_FILE%
    dir /b videos
    echo.
    pause
    exit /b 1
)

:: =================================================================
:: Get local IP address
:: =================================================================
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
echo.
echo Minecraft Video Sync Server
echo ==========================
echo.
echo Settings:
echo - Max Clients: %MAX_CLIENTS%
echo - Video File: videos\%VIDEO_FILE%
echo - Chunk Size: %CHUNK_SIZE% MB
echo - Server Port: %PORT%
echo - Volume Step: %VOLUME_STEP%%
echo - Skip Seconds: %SKIP_SECONDS%s
echo.
echo Access URLs:
echo - This computer: http://localhost:%PORT%
echo - Your network: http://%LOCAL_IP%:%PORT%
echo - Admin Panel: http://localhost:%PORT%/admin
echo.
echo Starting Server...
node server.js %MAX_CLIENTS% %CHUNK_SIZE% %PORT% %VOLUME_STEP% %SKIP_SECONDS% "%VIDEO_FILE%" %START_TIME%