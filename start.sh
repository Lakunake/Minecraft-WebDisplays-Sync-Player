#!/bin/bash

# =================================================================
# Get script location and set working directory
# =================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
echo "Running from: $(pwd)"

# =================================================================
# Check Node.js installation
# =================================================================
echo "Checking Node.js installation..."
if ! command -v node &> /dev/null; then
    echo
    echo "ERROR: Node.js is not installed or not in PATH!"
    echo "Please download and install Node.js from:"
    echo "https://nodejs.org/"
    echo
    exit 1
fi

# =================================================================
# Initialize configuration
# =================================================================
echo "Initializing configuration..."
if [ ! -f "config.txt" ]; then
    echo "Creating default configuration..."
    cat > config.txt << EOF
# Minecraft Video Sync Configuration
# Format: key: value  (space after colon is optional)
# Lines starting with # are comments

# Video file name in videos folder (include extension)
video_file: filmeva.mp4

# Server port (1024-49151)
port: 3000

# Volume step percentage (1-20)
volume_step: 5

# Rewind/Skip seconds (5-60)
skip_seconds: 10
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
# Install dependencies
# =================================================================
echo "Installing dependencies..."
if [ ! -d "node_modules" ]; then
    echo "Installing Node.js dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "Failed to install dependencies."
        echo "Please check your internet connection and try again."
        exit 1
    fi
    echo "Dependencies installed successfully."
else
    echo "Checking for additional dependencies..."
    if [ ! -d "node_modules/music-metadata" ]; then
        echo "Installing additional dependency: music-metadata..."
        npm install music-metadata
        if [ $? -ne 0 ]; then
            echo "Failed to install music-metadata."
            echo "Some MKV features may not work properly."
        else
            echo "music-metadata installed successfully."
        fi
    else
        echo "All dependencies already installed."
    fi
fi

# =================================================================
# Read configuration
# =================================================================
echo "Reading configuration..."
VIDEO_FILE="filmeva.mp4"
PORT="3000"
VOLUME_STEP="5"
SKIP_SECONDS="10"

while IFS=':' read -r key value; do
    key=$(echo "$key" | xargs)
    value=$(echo "$value" | xargs)
    
    if [[ -n "$key" && ! "$key" =~ ^# ]]; then
        case "$key" in
            "video_file") VIDEO_FILE="$value" ;;
            "port") PORT="$value" ;;
            "volume_step") VOLUME_STEP="$value" ;;
            "skip_seconds") SKIP_SECONDS="$value" ;;
        esac
    fi
done < config.txt

# =================================================================
# Check FFmpeg installation
# =================================================================
echo "Checking FFmpeg installation..."
if ! command -v ffmpeg &> /dev/null; then
    echo
    echo "[WARNING]: FFMPEG IS NOT INSTALLED!"
    echo "Some video formats may not play correctly."
    echo "Install FFmpeg using: brew install ffmpeg"
    echo "Or download from: https://ffmpeg.org/"
    echo
    sleep 5
fi

# =================================================================
# Check firewall status (macOS)
# =================================================================
echo "Checking firewall status for port $PORT..."
echo "Note: On macOS, ensure your firewall allows incoming connections on port $PORT"
echo "You can check in System Preferences > Security & Privacy > Firewall"

# =================================================================
# Get local IP address
# =================================================================
echo "Getting local IP address..."
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")

if [ "$LOCAL_IP" = "localhost" ]; then
    LOCAL_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | head -n1 | awk '{print $2}')
fi

# =================================================================
# Display server information
# =================================================================
echo
echo "Minecraft Video Sync Server"
echo "=========================="
echo
echo "Settings:"
echo "- Video File: videos/$VIDEO_FILE"
echo "- Server Port: $PORT"
echo "- Volume Step: ${VOLUME_STEP}%"
echo "- Skip Seconds: ${SKIP_SECONDS}s"
echo
echo "Features:"
echo "- MKV file support with audio/subtitle track selection"
echo "- HEVC codec detection and warnings"
echo "- Multi-video playlist support"
echo
echo "Access URLs:"
echo "- This computer: http://localhost:$PORT"
echo "- Your network: http://$LOCAL_IP:$PORT"
echo "- Admin Panel: http://localhost:$PORT/admin"
echo
echo "Starting Server..."
node server.js