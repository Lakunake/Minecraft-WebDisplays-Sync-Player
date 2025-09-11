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
:: Check and install Node.js if needed
:: =================================================================
echo Checking Node.js installation...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo Node.js not found. Attempting to install...
    
    :: Download and install Node.js
    powershell -Command "Invoke-WebRequest 'https://nodejs.org/dist/v18.17.1/node-v18.17.1-x64.msi' -OutFile 'nodejs-installer.msi'"
    if exist nodejs-installer.msi (
        echo Installing Node.js...
        start /wait msiexec /i nodejs-installer.msi /quiet
        del nodejs-installer.msi
        echo Node.js installed successfully.
        
        :: Refresh PATH to recognize Node.js
        for /f "skip=2 tokens=3*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path') do set "systempath=%%a %%b"
        setx Path "%systempath%;C:\Program Files\nodejs" /M
        set "PATH=%systempath%;C:\Program Files\nodejs"
    ) else (
        echo Failed to download Node.js installer.
        echo Please download and install Node.js from:
        echo https://nodejs.org/
        echo.
        pause
        exit /b 1
    )
)

:: =================================================================
:: Check and install FFmpeg if needed
:: =================================================================
echo Checking FFmpeg installation...
where ffmpeg >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo FFmpeg not found. Attempting to install...
    
    :: Create temp directory for FFmpeg
    if not exist temp mkdir temp
    cd temp
    
    :: Download and extract FFmpeg
    powershell -Command "Invoke-WebRequest 'https://github.com/GyanD/codexffmpeg/releases/download/6.0/ffmpeg-6.0-full_build.7z' -OutFile 'ffmpeg.7z'"
    if exist ffmpeg.7z (
        :: Check if 7-Zip is available
        where 7z >nul 2>&1
        if %errorlevel% neq 0 (
            echo Installing 7-Zip...
            powershell -Command "Invoke-WebRequest 'https://www.7-zip.org/a/7z2301-x64.exe' -OutFile '7z-installer.exe'"
            start /wait 7z-installer.exe /S
            del 7z-installer.exe
        )
        
        :: Extract FFmpeg
        echo Extracting FFmpeg...
        7z x ffmpeg.7z -o"C:\Program Files\ffmpeg" >nul
        del ffmpeg.7z
        
        :: Add FFmpeg to PATH
        for /f "skip=2 tokens=3*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path') do set "systempath=%%a %%b"
        setx Path "%systempath%;C:\Program Files\ffmpeg\bin" /M
        set "PATH=%systempath%;C:\Program Files\ffmpeg\bin"
        
        echo FFmpeg installed successfully.
    ) else (
        echo Failed to download FFmpeg.
        echo Some video formats may not play correctly.
        echo Install FFmpeg from: https://ffmpeg.org/
    )
    cd ..
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
:: Set up firewall rules
:: =================================================================
echo Configuring firewall for port %PORT%...
set FIREWALL_RULE_NAME=WebDisplays Video Sync (Port %PORT%)

:: Check if rule already exists
netsh advfirewall firewall show rule name="%FIREWALL_RULE_NAME%" >nul 2>&1
if %errorlevel% equ 0 (
    echo Firewall rule already exists.
) else (
    echo Adding firewall rule...
    netsh advfirewall firewall add rule name="%FIREWALL_RULE_NAME%" dir=in action=allow protocol=TCP localport=%PORT%
    if %errorlevel% equ 0 (
        echo Firewall rule added successfully.
    ) else (
        echo.
        echo [WARNING]: Failed to add firewall rule.
        echo Server may not be accessible from other devices.
        echo.
        echo To fix: Run this script as Administrator
        echo.
        timeout /t 3 >nul
    )
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
