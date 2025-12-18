# Sync-Player PowerShell Startup Script
# Equivalent to legacylauncher.bat with improved error handling and cleaner syntax, legacy launcher was last updated in 17.12.2025

# Re-launch with bypass if not already bypassed (fixes right-click "Run with PowerShell")
if ($ExecutionContext.SessionState.LanguageMode -eq 'ConstrainedLanguage' -or 
    (Get-ExecutionPolicy) -notin @('Bypass', 'Unrestricted', 'RemoteSigned')) {
    Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -NoProfile -File `"$PSCommandPath`"" -NoNewWindow -Wait
    exit
}

$Host.UI.RawUI.WindowTitle = "Admin Console"
$ErrorActionPreference = "Stop"

# =================================================================
# Retry Counter (resets on computer reboot via TEMP folder)
# =================================================================
$RETRY_FILE = "$env:TEMP\sync_player_retry_count.txt"
$MAX_RETRIES = 2
$RETRY_COUNT = 0

if (Test-Path $RETRY_FILE) {
    $RETRY_COUNT = [int](Get-Content $RETRY_FILE -Raw)
}

# =================================================================
# Get script location and set working directory
# =================================================================
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir
Write-Host "Running from: $PWD"

# =================================================================
# Helper function for colored output
# =================================================================
function Write-Status {
    param(
        [string]$Type,
        [string]$Message
    )
    switch ($Type) {
        "OK" { Write-Host "[OK]: $Message" -ForegroundColor DarkCyan }
        "MISSING" { Write-Host "[MISSING]: $Message" -ForegroundColor Yellow }
        "WARNING" { Write-Host "[WARNING]: $Message" -ForegroundColor Yellow }
        "ERROR" { Write-Host "[ERROR]: $Message" -ForegroundColor Red }
        "CRITICAL" { Write-Host "[CRITICAL]: $Message" -ForegroundColor Red }
        "INFO" { Write-Host "[INFO]: $Message" -ForegroundColor Cyan }
        "SUCCESS" { Write-Host "[SUCCESS]: $Message" -ForegroundColor Green }
        "REQUIRED" { Write-Host "[REQUIRED]: $Message" -ForegroundColor Yellow }
        "DEBUG" { Write-Host "[DEBUG]: $Message" -ForegroundColor Gray }
        default { Write-Host $Message }
    }
}

# =================================================================
# Check Node.js installation
# =================================================================
$Host.UI.RawUI.WindowTitle = "Admin Console - Checking Node.js"
Write-Host "Checking Node.js installation..."

$nodeInstalled = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeInstalled) {
    Write-Host ""
    Write-Status "ERROR" "Node.js is not installed or not in PATH!"
    Write-Host "Press Enter to install Node.js via winget, or Ctrl+C to exit and install manually."
    Write-Host "Manual download: https://nodejs.org/en/download" -ForegroundColor Cyan
    Read-Host
    
    try {
        winget install --id OpenJS.NodeJS.LTS -e
        if ($LASTEXITCODE -ne 0) {
            throw "winget install failed with exit code $LASTEXITCODE"
        }
        Write-Status "SUCCESS" "Node.js installed. Please restart this script."
        Read-Host "Press Enter to exit"
        exit 0
    }
    catch {
        Write-Status "ERROR" "Failed to install Node.js via winget."
        Write-Host "Please install manually from: https://nodejs.org/en/download" -ForegroundColor Cyan
        Write-Host "After installing, restart this script."
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# =================================================================
# Initialize configuration
# =================================================================
$Host.UI.RawUI.WindowTitle = "Admin Console - Initializing"

if (-not (Test-Path "config.txt")) {
    Write-Host "Creating default configuration..."
    
    $defaultConfig = @"
# Sync-Player Configuration
# Lines starting with # are comments

# Server port (1024-49151)
port: 3000

# Volume step percentage (1-20)
volume_step: 5

# Skip seconds (1-60)
skip_seconds: 5

# Join mode: sync or reset
join_mode: sync

# HTTPS Configuration
use_https: false
ssl_key_file: key.pem
ssl_cert_file: cert.pem

# BSL-S2 (Both Side Local Sync Stream) Configuration
# Mode: 'any' = BSL-S2 active if ANY client has the local file
#       'all' = BSL-S2 only active if ALL clients have the local file
bsl_s2_mode: any

# Video Autoplay Configuration
# Set to true to automatically play videos when loaded
# Set to false to start videos paused
video_autoplay: false

# Admin Fingerprint Lock
# When enabled, only the first machine to access /admin will be allowed
# The fingerprint is stored in admin_fingerprint.txt
# Set to true to enable, false to allow any machine to access admin
admin_fingerprint_lock: false
"@
    
    $defaultConfig | Out-File -FilePath "config.txt" -Encoding UTF8
    Write-Host "Default config created with all available options"
}

# =================================================================
# Create folders if needed
# =================================================================
if (-not (Test-Path "media")) {
    New-Item -ItemType Directory -Path "media" | Out-Null
    Write-Host "Created media directory"
}

# =================================================================
# Check and Install Dependencies
# =================================================================
$Host.UI.RawUI.WindowTitle = "Admin Console - Checking Dependencies"
Write-Host "Checking required dependencies..."

$MISSING_DEPS = $false
$requiredPackages = @("express", "socket.io", "helmet")

if (-not (Test-Path "node_modules")) {
    $MISSING_DEPS = $true
    Write-Status "MISSING" "Node.js dependencies (express, socket.io, helmet)"
}
else {
    Write-Host "Checking for specific dependencies..."
    foreach ($pkg in $requiredPackages) {
        if (-not (Test-Path "node_modules\$pkg")) {
            $MISSING_DEPS = $true
            Write-Status "MISSING" "$pkg package"
        }
    }
    if (-not $MISSING_DEPS) {
        Write-Status "OK" "All Node.js dependencies found"
    }
}

# Check FFmpeg
$MISSING_FFMPEG = $false
$ffmpegInstalled = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpegInstalled) {
    $MISSING_FFMPEG = $true
    Write-Status "MISSING" "FFmpeg (required for video processing)"
}
else {
    Write-Status "OK" "FFmpeg found"
}

# Install missing Node.js dependencies
if ($MISSING_DEPS) {
    Write-Host ""
    Write-Status "REQUIRED" "This software needs Node.js dependencies to work properly."
    Write-Host "Missing packages: express, socket.io, helmet"
    Write-Host ""
    Write-Host "Press ENTER to install dependencies automatically, or Ctrl+C to exit."
    Read-Host
    Write-Host ""
    Write-Host "Installing Node.js dependencies..."
    
    try {
        Write-Host "Running: npm install express@5.1.0 socket.io@4.8.1 helmet@8.0.0" -ForegroundColor Gray
        Write-Host ""
        cmd /c "npm install express@5.1.0 socket.io@4.8.1 helmet@8.0.0"
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed with exit code $LASTEXITCODE"
        }
        Write-Host ""
        Write-Status "SUCCESS" "Dependencies installed successfully."
        $MISSING_DEPS = $false
        if (Test-Path $RETRY_FILE) { Remove-Item $RETRY_FILE -Force }
    }
    catch {
        Write-Status "ERROR" "Failed to install dependencies."
        Write-Host "Please check your internet connection and try again."
        Write-Host "You can also try running any one of the following commands in cmd after doing cd (Path to server.js):"
        Write-Host "npm install"
        Write-Host "npm install express socket.io helmet"
        Write-Host "npm install express@5.1.0 socket.io@4.8.1 helmet@8.0.0"
        Write-Host ""
        
        # Auto-retry logic
        if ($RETRY_COUNT -lt $MAX_RETRIES) {
            $RETRY_COUNT++
            $RETRY_COUNT | Out-File -FilePath $RETRY_FILE -Force
            Write-Host "Retry attempt $RETRY_COUNT of $MAX_RETRIES..."
            Write-Host "Restarting in 3 seconds..."
            Start-Sleep -Seconds 3
            Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File `"$PSCommandPath`""
            exit 0
        }
        else {
            Write-Status "CRITICAL" "Maximum retry attempts reached."
            Write-Host "Please fix the issue manually and restart the script."
            if (Test-Path $RETRY_FILE) { Remove-Item $RETRY_FILE -Force }
            Read-Host "Press Enter to exit"
            exit 1
        }
    }
}

if ($MISSING_FFMPEG) {
    Write-Host ""
    Write-Status "REQUIRED" "FFmpeg is not installed."
    Write-Host "FFmpeg is required for video thumbnails and MKV support."
    Write-Host ""
    Write-Host "Press ENTER to install FFmpeg via winget, or Ctrl+C to install manually."
    Write-Host "Manual download: https://ffmpeg.org/download.html" -ForegroundColor Cyan
    Read-Host
    
    try {
        winget install --id Gyan.FFmpeg -e
        if ($LASTEXITCODE -ne 0) {
            throw "winget install failed with exit code $LASTEXITCODE"
        }
        Write-Status "SUCCESS" "FFmpeg installed successfully."
        Write-Host "You may need to restart this script for FFmpeg to be detected."
        if (Test-Path $RETRY_FILE) { Remove-Item $RETRY_FILE -Force }
    }
    catch {
        Write-Status "WARNING" "FFmpeg installation via winget failed."
        Write-Host "Please install manually from: https://ffmpeg.org/download.html" -ForegroundColor Cyan
        Write-Host "For Windows, download from: https://www.gyan.dev/ffmpeg/builds/" -ForegroundColor Cyan
        Write-Host "Make sure to add FFmpeg to your system PATH."
        Write-Host ""
        Write-Host "You can continue without FFmpeg, but thumbnails and some features won't work."
        Write-Host "Press Enter to continue anyway..."
        Read-Host
    }
}

# =================================================================
# Read configuration
# =================================================================
$Host.UI.RawUI.WindowTitle = "Admin Console - Reading Config"

# Default values
$config = @{
    PORT         = 3000
    VOLUME_STEP  = 5
    SKIP_SECONDS = 5
    JOIN_MODE    = "sync"
    USE_HTTPS    = "false"
    BSL_S2_MODE  = "any"
    ADMIN_LOCK   = "false"
}

if (Test-Path "config.txt") {
    $configContent = Get-Content "config.txt"
    foreach ($line in $configContent) {
        # Skip comments and empty lines
        if ($line -match "^\s*#" -or $line -match "^\s*$") { continue }
        
        # Parse key: value pairs
        if ($line -match "^\s*(\w+)\s*:\s*(.+?)\s*$") {
            $key = $matches[1]
            $value = $matches[2]
            
            switch ($key) {
                "port" { $config.PORT = [int]$value }
                "volume_step" { $config.VOLUME_STEP = [int]$value }
                "skip_seconds" { $config.SKIP_SECONDS = [int]$value }
                "join_mode" { $config.JOIN_MODE = $value }
                "use_https" { $config.USE_HTTPS = $value }
                "bsl_s2_mode" { $config.BSL_S2_MODE = $value }
                "admin_fingerprint_lock" { $config.ADMIN_LOCK = $value }
            }
        }
    }
}
else {
    Write-Status "WARNING" "config.txt not found, using default values"
}

# =================================================================
# Firewall Information
# =================================================================
$Host.UI.RawUI.WindowTitle = "Admin Console - Firewall Info"
Write-Host ""
Write-Status "INFO" "Ensure port $($config.PORT) is open in Windows Firewall for network access"
Write-Host ""

# =================================================================
# Get local IP address
# =================================================================
$Host.UI.RawUI.WindowTitle = "Admin Console - Getting IP"
Write-Host "Getting local IP address..."

$LOCAL_IP = "localhost"
try {
    # Use same method as batch file - parse ipconfig
    $ipconfigOutput = ipconfig | Select-String "IPv4 Address"
    foreach ($line in $ipconfigOutput) {
        if ($line -match ":\s*(\d+\.\d+\.\d+\.\d+)") {
            $foundIP = $matches[1]
            # Skip link-local addresses (169.254.x.x) and loopback
            if ($foundIP -notmatch "^(169\.254\.|127\.)") {
                $LOCAL_IP = $foundIP
                break
            }
            # If we only find 169.254, use it as fallback
            if ($LOCAL_IP -eq "localhost") {
                $LOCAL_IP = $foundIP
            }
        }
    }
}
catch {
    Write-Status "WARNING" "Could not detect IP, using localhost"
}

# =================================================================
# Display server information
# =================================================================
$Host.UI.RawUI.WindowTitle = "Admin Console"
Write-Host ""
Write-Host "Sync-Player 1.8.1" -ForegroundColor Cyan
Write-Host "==========================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Settings:" -ForegroundColor Yellow
Write-Host "- Server Port: $($config.PORT)" -ForegroundColor White
Write-Host "- Volume Step: $($config.VOLUME_STEP)%" -ForegroundColor White
Write-Host "- Skip Seconds: $($config.SKIP_SECONDS)s" -ForegroundColor White
Write-Host "- Join Mode: $($config.JOIN_MODE)" -ForegroundColor White
Write-Host "- HTTPS: $($config.USE_HTTPS)" -ForegroundColor White
Write-Host "- BSL-S2 Mode: $($config.BSL_S2_MODE)" -ForegroundColor White
Write-Host "- Admin Lock: $($config.ADMIN_LOCK)" -ForegroundColor White
Write-Host ""
Write-Host "Access URLs:" -ForegroundColor Yellow
Write-Host "- Your network: http://${LOCAL_IP}:$($config.PORT)" -ForegroundColor White
Write-Host "- Admin Panel: http://${LOCAL_IP}:$($config.PORT)/admin" -ForegroundColor White
Write-Host "- Testing purposes: http://localhost:$($config.PORT)" -ForegroundColor White
Write-Host ""
Write-Host "Firewall: Manual configuration required for network access" -ForegroundColor Yellow
Write-Host ""
Write-Host "Starting Server..." -ForegroundColor Cyan
Write-Host ""
Write-Status "DEBUG" "Current directory: $PWD"
Write-Host ""

# =================================================================
# Start the server
# =================================================================
if (-not (Test-Path "server.js")) {
    Write-Status "CRITICAL" "server.js not found in current directory!"
    Write-Host "Please ensure you are running this script from the correct folder."
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Status "DEBUG" "Starting server with port $($config.PORT)..."

# Clear retry counter on successful start
if (Test-Path $RETRY_FILE) { Remove-Item $RETRY_FILE -Force }

try {
    & node server.js $LOCAL_IP
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "Server exited with code $exitCode"
    }
}
catch {
    Write-Host ""
    Write-Status "CRITICAL" "Server crashed: $_"
    Write-Host "Please check the error messages above."
    Write-Host ""
    Read-Host "Press Enter to exit"
}
