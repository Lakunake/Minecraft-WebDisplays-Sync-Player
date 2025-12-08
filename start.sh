#!/bin/bash

#THIS SCRIPT IS NOT YET UPDATED TO MATCH 1.6.0


# =================================================================
# Set up the script
# =================================================================
clear
echo -e "\033]0;Admin Console\007"
printf '\033[0;32m\033[40m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
echo "Running from: $(pwd)"

# =================================================================
# Check Node.js installation
# =================================================================
echo -e "\033]0;Admin Console - Checking Node.js\007"
echo "Checking Node.js installation..."
if ! command -v node &> /dev/null; then
    echo
    echo "ERROR: Node.js is not installed or not in PATH!"
    echo "Please download and install Node.js from:"
    echo "https://nodejs.org/"
    echo "Press Enter to open the Node.js download page."
    read -r
    xdg-open "https://nodejs.org/" 2>/dev/null || echo "Please manually visit https://nodejs.org/"
    echo
    # For Linux, you might want to suggest package manager installation
    echo "You can also install Node.js using your package manager:"
    echo "Ubuntu/Debian: sudo apt install nodejs npm"
    echo "Fedora: sudo dnf install nodejs npm"
    echo "Arch: sudo pacman -S nodejs npm"
    exit 1
fi

# =================================================================
# Initialize configuration
# =================================================================
echo -e "\033]0;Admin Console - Initializing\007"
if [ ! -f "config.txt" ]; then
    echo "Creating default configuration..."
    cat > config.txt << EOF
port: 3000
volume_step: 5
skip_seconds: 5
EOF
    echo "Default config created"
fi

# =================================================================
# Create folders if needed
# =================================================================
if [ ! -d "videos" ]; then
    mkdir videos
    echo "Created videos directory"
fi

# =================================================================
# Check and Install Dependencies
# =================================================================
echo -e "\033]0;Admin Console - Checking Dependencies\007"
echo "Checking required dependencies..."

# Check Node.js dependencies
MISSING_DEPS=0
if [ ! -d "node_modules" ]; then
    MISSING_DEPS=1
    echo "[MISSING]: Node.js dependencies (express, socket.io)"
else
    echo "Checking for specific dependencies..."
    if [ ! -d "node_modules/express" ]; then
        MISSING_DEPS=1
        echo "[MISSING]: express package"
    fi
    if [ ! -d "node_modules/socket.io" ]; then
        MISSING_DEPS=1
        echo "[MISSING]: socket.io package"
    fi
    if [ $MISSING_DEPS -eq 0 ]; then
        echo "[OK]: All Node.js dependencies found"
    fi
fi

# Check FFmpeg
MISSING_FFMPEG=0
if ! command -v ffmpeg &> /dev/null; then
    MISSING_FFMPEG=1
    echo "[MISSING]: FFmpeg (required for video processing)"
else
    echo "[OK]: FFmpeg found"
fi

# Ask user to install missing dependencies
if [ $MISSING_DEPS -eq 1 ]; then
    echo
    echo "[REQUIRED]: This software needs Node.js dependencies to work properly."
    echo "Missing packages: express, socket.io"
    echo
    echo "Press ENTER to install dependencies automatically, or Ctrl+C to exit."
    read -r
    echo
    echo "Installing Node.js dependencies..."
    if npm install express@5.1.0 socket.io@4.8.1; then
