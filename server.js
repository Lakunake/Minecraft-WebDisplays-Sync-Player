const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const helmet = require('helmet');

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

// Read and parse config file
function readConfig() {
  const configPath = path.join(__dirname, 'config.txt');
  try {
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = {};

      configData.split('\n').forEach(line => {
        line = line.trim();
        if (line && !line.startsWith('#')) {
          const parts = line.split(':');
          const key = parts.shift().trim();
          const value = parts.join(':').trim();
          if (key && value) config[key] = value;
        }
      });

      return config;
    }
  } catch (error) {
    console.error('Error reading config file:', error);
  }

  return {
    port: '3000',
    volume_step: '5',
    skip_seconds: '5',
    join_mode: 'sync',
    use_https: 'false',
    ssl_key_file: 'key.pem',
    ssl_cert_file: 'cert.pem'
  };
}

const config = readConfig();

const app = express();
let server;

if (config.use_https === 'true') {
  try {
    const keyPath = path.join(__dirname, config.ssl_key_file || 'key.pem');
    const certPath = path.join(__dirname, config.ssl_cert_file || 'cert.pem');

    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      const options = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
      };
      server = https.createServer(options, app);
      console.log(`${colors.green}Starting server in HTTPS mode${colors.reset}`);
    } else {
      console.error('SSL key or certificate file not found. Falling back to HTTP.');
      server = http.createServer(app);
    }
  } catch (error) {
    console.error('Error starting HTTPS server:', error);
    console.log(`${colors.yellow}Falling back to HTTP.${colors.reset}`);
    server = http.createServer(app);
  }
} else {
  server = http.createServer(app);
}

const io = new Server(server);

const PORT = parseInt(config.port) || 3000;
const SKIP_SECONDS = parseInt(config.skip_seconds) || 5;
const VOLUME_STEP = parseInt(config.volume_step) || 5;
const JOIN_MODE = config.join_mode || 'sync';
const BSL_S2_MODE = config.bsl_s2_mode || 'any'; // 'any' or 'all'
const VIDEO_AUTOPLAY = config.video_autoplay === 'true'; // defaults to false

// BSL-S² (Both Side Local Sync Stream) state tracking
// Maps socketId -> { folderSelected: bool, files: [{name, size}], matchedVideos: {playlistIndex: localFileName} }
const clientBslStatus = new Map();
// Track admin socket for BSL-S² status updates
let adminSocketId = null;
// Track verified admin sockets (for fingerprint lock security)
const verifiedAdminSockets = new Set();
// Track connected clients with their fingerprints
const connectedClients = new Map(); // socketId -> { fingerprint, connectedAt }

// BSL-S² Persistent matches file
const BSL_MATCHES_FILE = path.join(__dirname, 'bsl_matches.json');

// ==================== Unified Memory Storage ====================
const MEMORY_FILE = path.join(__dirname, 'memory.json');

// Load unified memory (contains all persistent data)
function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const data = fs.readFileSync(MEMORY_FILE, 'utf8');
      return JSON.parse(data);
    }
    // Check for legacy files and migrate
    const legacy = {
      adminFingerprint: null,
      clientNames: {},
      bslMatches: {}
    };

    // Migrate from old files if they exist
    if (fs.existsSync(path.join(__dirname, 'admin_fingerprint.txt'))) {
      legacy.adminFingerprint = fs.readFileSync(path.join(__dirname, 'admin_fingerprint.txt'), 'utf8').trim();
    }
    if (fs.existsSync(path.join(__dirname, 'client_names.json'))) {
      legacy.clientNames = JSON.parse(fs.readFileSync(path.join(__dirname, 'client_names.json'), 'utf8'));
    }
    if (fs.existsSync(BSL_MATCHES_FILE)) {
      legacy.bslMatches = JSON.parse(fs.readFileSync(BSL_MATCHES_FILE, 'utf8'));
    }

    // Save migrated data if any legacy data found
    if (legacy.adminFingerprint || Object.keys(legacy.clientNames).length > 0 || Object.keys(legacy.bslMatches).length > 0) {
      saveMemory(legacy);
      console.log(`${colors.green}Migrated legacy storage files to memory.json${colors.reset}`);
    }

    return legacy;
  } catch (error) {
    console.error('Error loading memory:', error);
  }
  return { adminFingerprint: null, clientNames: {}, bslMatches: {} };
}

// Save unified memory
function saveMemory(mem) {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2));
  } catch (error) {
    console.error('Error saving memory:', error);
  }
}

// Load memory at startup
let memory = loadMemory();

// Convenience accessors
function getAdminFingerprint() {
  return memory.adminFingerprint;
}

function setAdminFingerprint(fp) {
  memory.adminFingerprint = fp;
  saveMemory(memory);
  console.log(`${colors.green}Admin fingerprint registered: ${fp}${colors.reset}`);
}

function getClientNames() {
  return memory.clientNames || {};
}

function setClientName(clientId, name) {
  if (!memory.clientNames) memory.clientNames = {};
  memory.clientNames[clientId] = name;
  saveMemory(memory);
  console.log(`${colors.green}Client name saved: ${clientId} -> ${name}${colors.reset}`);
}

function getBslMatches() {
  return memory.bslMatches || {};
}

function setBslMatch(clientId, clientFileName, playlistFileName) {
  if (!memory.bslMatches) memory.bslMatches = {};
  if (!memory.bslMatches[clientId]) memory.bslMatches[clientId] = {};
  memory.bslMatches[clientId][clientFileName] = playlistFileName;
  saveMemory(memory);
  console.log(`${colors.green}BSL match saved: ${clientId}/${clientFileName} -> ${playlistFileName}${colors.reset}`);
}

// Legacy compatibility aliases
let persistentBslMatches = getBslMatches();
let clientDisplayNames = getClientNames();

// Admin Fingerprint Lock Configuration
const ADMIN_FINGERPRINT_LOCK = config.admin_fingerprint_lock === 'true';
let registeredAdminFingerprint = ADMIN_FINGERPRINT_LOCK ? getAdminFingerprint() : null;

// Apply helmet security headers with safe configuration
app.use(helmet({
  contentSecurityPolicy: false, // Disabled to allow inline scripts and Socket.io
  crossOriginEmbedderPolicy: false, // Disabled to allow video playback
}));

app.use(express.static(__dirname));
app.use('/videos', express.static(path.join(__dirname, 'videos')));

const PLAYLIST = {
  videos: [],
  currentIndex: -1,
  mainVideoIndex: -1,
  mainVideoStartTime: 0,
  preloadMainVideo: false
};

let videoState = {
  isPlaying: true,
  currentTime: 0,
  lastUpdate: Date.now(),
  audioTrack: 0,
  subtitleTrack: -1
};

function getCurrentTrackSelections() {
  if (PLAYLIST.videos.length > 0 && PLAYLIST.currentIndex >= 0 && PLAYLIST.currentIndex < PLAYLIST.videos.length) {
    const currentVideo = PLAYLIST.videos[PLAYLIST.currentIndex];
    return {
      audioTrack: currentVideo.selectedAudioTrack !== undefined ? currentVideo.selectedAudioTrack : 0,
      subtitleTrack: currentVideo.selectedSubtitleTrack !== undefined ? currentVideo.selectedSubtitleTrack : -1
    };
  }
  return { audioTrack: 0, subtitleTrack: -1 };
}

async function getTracksForFile(filename) {
  const safeFilename = path.basename(filename);
  const filePath = path.join(__dirname, 'videos', safeFilename);
  const tracks = { audio: [], subtitles: [] };

  return new Promise((resolve) => {
    const command = `ffprobe -v quiet -print_format json -show_streams "${filePath}"`;

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('Error running ffprobe:', error);
        resolve(tracks);
        return;
      }

      try {
        const probeData = JSON.parse(stdout);

        if (probeData.streams) {
          probeData.streams.forEach((stream, index) => {
            const trackInfo = {
              index: index,
              codec: stream.codec_name || 'unknown',
              language: (stream.tags && stream.tags.language) || 'und',
              title: (stream.tags && stream.tags.title) || `Track ${index}`,
              default: stream.disposition && stream.disposition.default ? true : false
            };

            if (stream.codec_type === 'audio') {
              tracks.audio.push(trackInfo);
            } else if (stream.codec_type === 'subtitle') {
              tracks.subtitles.push(trackInfo);
            }
          });
        }

        resolve(tracks);
      } catch (parseError) {
        console.error('Error parsing ffprobe output:', parseError);
        resolve(tracks);
      }
    });
  });
}

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/api/files', (req, res) => {
  const videosPath = path.join(__dirname, 'videos');

  fs.readdir(videosPath, async (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Unable to read videos directory' });
    }

    const mediaFiles = [];
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (['.mp4', '.mp3', '.avi', '.mov', '.wmv', '.mkv', '.webm'].includes(ext)) {
        const usesHEVC = ext === '.mkv';
        mediaFiles.push({ filename: file, usesHEVC: usesHEVC });
      }
    }

    res.json(mediaFiles);
  });
});

app.get('/api/tracks/:filename', async (req, res) => {
  const filename = req.params.filename;
  try {
    const tracks = await getTracksForFile(filename);
    res.json(tracks);
  } catch (error) {
    console.error('Error reading track info:', error);
    res.status(500).json({ error: 'Unable to read track information' });
  }
});

// Get Windows temp directory for thumbnails (cleared on reboot)
const os = require('os');
const THUMBNAIL_DIR = path.join(os.tmpdir(), 'sync-player-thumbnails');

// Ensure thumbnail directory exists
if (!fs.existsSync(THUMBNAIL_DIR)) {
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
}

// Serve thumbnails from temp directory
app.use('/thumbnails', express.static(THUMBNAIL_DIR));

// Get video duration using ffprobe
function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    const command = `ffprobe -v quiet -print_format json -show_format "${videoPath}"`;
    exec(command, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      try {
        const data = JSON.parse(stdout);
        const duration = parseFloat(data.format.duration) || 0;
        resolve(duration);
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Generate thumbnail from video using FFmpeg (720p, random frame from first third)
app.get('/api/thumbnail/:filename', async (req, res) => {
  const filename = req.params.filename;
  const safeFilename = path.basename(filename);
  const videoPath = path.join(__dirname, 'videos', safeFilename);
  const thumbnailFilename = safeFilename.replace(/\.[^.]+$/, '.jpg');
  const thumbnailPath = path.join(THUMBNAIL_DIR, thumbnailFilename);

  // Check if thumbnail already exists (cached)
  if (fs.existsSync(thumbnailPath)) {
    return res.json({ thumbnail: `/thumbnails/${thumbnailFilename}` });
  }

  // Check if video exists
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }

  try {
    // Get video duration
    const duration = await getVideoDuration(videoPath);

    // Calculate random position in first third of video (minimum 1 second)
    const firstThird = Math.max(duration / 3, 1);
    const randomTime = Math.random() * firstThird;
    const seekTime = Math.max(1, Math.floor(randomTime)); // At least 1 second in

    console.log(`${colors.cyan}Generating 720p thumbnail for ${safeFilename} at ${seekTime}s (duration: ${duration}s)${colors.reset}`);

    // Generate 720p thumbnail (-vf scale=-1:720 maintains aspect ratio with 720 height)
    const command = `ffmpeg -ss ${seekTime} -i "${videoPath}" -vframes 1 -vf "scale=-1:720" -q:v 2 -y "${thumbnailPath}"`;

    exec(command, (error) => {
      if (error) {
        console.error('FFmpeg thumbnail error:', error.message);
        // Fallback to 1 second
        const fallbackCommand = `ffmpeg -ss 1 -i "${videoPath}" -vframes 1 -vf "scale=-1:720" -q:v 2 -y "${thumbnailPath}"`;
        exec(fallbackCommand, (err2) => {
          if (err2) {
            console.error('FFmpeg fallback error:', err2.message);
            return res.status(500).json({ error: 'Failed to generate thumbnail' });
          }
          res.json({ thumbnail: `/thumbnails/${thumbnailFilename}` });
        });
        return;
      }
      console.log(`${colors.green}Generated 720p thumbnail for: ${safeFilename}${colors.reset}`);
      res.json({ thumbnail: `/thumbnails/${thumbnailFilename}` });
    });
  } catch (error) {
    console.error('Error getting video duration:', error);
    // Fallback: just try at 10 seconds
    const fallbackCommand = `ffmpeg -ss 10 -i "${videoPath}" -vframes 1 -vf "scale=-1:720" -q:v 2 -y "${thumbnailPath}"`;
    exec(fallbackCommand, (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to generate thumbnail' });
      }
      res.json({ thumbnail: `/thumbnails/${thumbnailFilename}` });
    });
  }
});

// Socket.io handling
io.on('connection', (socket) => {
  console.log(`${colors.cyan}A user connected: ${socket.id}${colors.reset}`);

  // Broadcast updated client count to all (excluding admin)
  broadcastClientCount();

  const currentTracks = getCurrentTrackSelections();
  videoState.audioTrack = currentTracks.audioTrack;
  videoState.subtitleTrack = currentTracks.subtitleTrack;

  // Send config values to client
  socket.emit('config', {
    skipSeconds: SKIP_SECONDS,
    volumeStep: VOLUME_STEP / 100,
    videoAutoplay: VIDEO_AUTOPLAY
  });

  // Send playlist to client
  socket.emit('playlist-update', PLAYLIST);

  // Handle join behavior based on config
  if (JOIN_MODE === 'reset') {
    videoState.currentTime = 0;
    videoState.lastUpdate = Date.now();
    io.emit('sync', videoState);
    console.log(`${colors.yellow}New user joined, resetting video to 0 for everyone (reset mode)${colors.reset}`);
  } else {
    socket.emit('sync', videoState);
    console.log(`${colors.cyan}New user joined, syncing to current time: ${videoState.currentTime}${colors.reset}`);
  }

  // Handle request for initial state (from client on connect)
  socket.on('request-initial-state', () => {
    console.log('Client requested initial state');
    socket.emit('initial-state', {
      playlist: PLAYLIST,
      mainVideoStartTime: PLAYLIST.mainVideoStartTime,
      videoState: videoState
    });
  });

  // Handle explicit sync request from client
  socket.on('request-sync', () => {
    console.log('Client requested sync');
    socket.emit('sync', videoState);
  });

  // Listen for control events from clients
  socket.on('control', (data) => {
    if (data.action) {
      if (data.action === 'playpause') {
        videoState.isPlaying = data.state;
        videoState.lastUpdate = Date.now();
        io.emit('sync', videoState);
      } else if (data.action === 'skip') {
        const direction = data.direction === 'forward' ? 1 : -1;
        videoState.currentTime += direction * (data.seconds || SKIP_SECONDS);
        videoState.lastUpdate = Date.now();
        io.emit('sync', videoState);
      } else if (data.action === 'seek') {
        videoState.currentTime = data.time;
        videoState.lastUpdate = Date.now();
        io.emit('sync', videoState);
      } else if (data.action === 'selectTrack') {
        if (data.type === 'audio') {
          videoState.audioTrack = data.trackIndex;
        } else if (data.type === 'subtitle') {
          videoState.subtitleTrack = data.trackIndex;
        }
        videoState.lastUpdate = Date.now();
        io.emit('sync', videoState);
      }
    } else {
      videoState = {
        isPlaying: data.isPlaying,
        currentTime: data.currentTime,
        lastUpdate: Date.now(),
        audioTrack: videoState.audioTrack,
        subtitleTrack: videoState.subtitleTrack
      };
      io.emit('sync', videoState);
      console.log('Broadcasting sync to all clients:', videoState);
    }
  });

  // Handle playlist set from admin
  socket.on('set-playlist', async (data) => {
    console.log('Received playlist data:', data);

    const processedPlaylist = [];

    for (const item of data.playlist) {
      const videoInfo = { ...item };

      try {
        const tracks = await getTracksForFile(item.filename);
        videoInfo.tracks = tracks;
      } catch (error) {
        console.error('Error getting track info:', error);
        videoInfo.tracks = { audio: [], subtitles: [] };
      }

      if (item.selectedAudioTrack !== undefined) {
        videoInfo.selectedAudioTrack = item.selectedAudioTrack;
      }
      if (item.selectedSubtitleTrack !== undefined) {
        videoInfo.selectedSubtitleTrack = item.selectedSubtitleTrack;
      }

      videoInfo.usesHEVC = item.filename.endsWith('.mkv');
      processedPlaylist.push(videoInfo);
    }

    PLAYLIST.videos = processedPlaylist;
    PLAYLIST.mainVideoIndex = data.mainVideoIndex;
    PLAYLIST.mainVideoStartTime = data.startTime;
    PLAYLIST.currentIndex = 0;
    PLAYLIST.preloadMainVideo = true;

    const currentTracks = getCurrentTrackSelections();
    videoState.audioTrack = currentTracks.audioTrack;
    videoState.subtitleTrack = currentTracks.subtitleTrack;
    videoState.currentTime = 0;
    videoState.lastUpdate = Date.now();

    console.log('Playlist updated:');
    console.log('- Total videos:', PLAYLIST.videos.length);
    console.log('- Main video index:', PLAYLIST.mainVideoIndex);
    console.log('- Start time:', PLAYLIST.mainVideoStartTime);

    // Notify all clients about the new playlist
    io.emit('playlist-update', PLAYLIST);

    // Set initial play state based on autoplay config
    videoState.isPlaying = VIDEO_AUTOPLAY;
    io.emit('sync', videoState);

    // Extra pause to make sure if autoplay is off
    if (!VIDEO_AUTOPLAY) {
      setTimeout(() => {
        videoState.isPlaying = false;
        io.emit('sync', videoState);
      }, 500);
    }

    socket.emit('playlist-set', {
      success: true,
      message: VIDEO_AUTOPLAY ? 'Playlist launched - playing!' : 'Playlist launched - paused (autoplay disabled)'
    });
  });

  // Get config (for admin)
  socket.on('get-config', () => {
    socket.emit('config', {
      port: PORT,
      skipSeconds: SKIP_SECONDS,
      volumeStep: VOLUME_STEP / 100,
      joinMode: JOIN_MODE,
      bslS2Mode: BSL_S2_MODE,
      useHttps: config.use_https === 'true',
      videoAutoplay: VIDEO_AUTOPLAY,
      adminFingerprintLock: ADMIN_FINGERPRINT_LOCK
    });
  });

  // Move to next video in playlist
  socket.on('playlist-next', (nextIndex) => {
    PLAYLIST.currentIndex = nextIndex;

    const currentTracks = getCurrentTrackSelections();
    videoState.audioTrack = currentTracks.audioTrack;
    videoState.subtitleTrack = currentTracks.subtitleTrack;
    videoState.lastUpdate = Date.now();

    io.emit('sync', videoState);
    io.emit('playlist-position', nextIndex);
  });

  // Jump to specific video in playlist (from admin)
  socket.on('playlist-jump', (index) => {
    if (index < 0 || index >= PLAYLIST.videos.length) {
      console.log('Invalid playlist jump index:', index);
      return;
    }

    console.log(`${colors.yellow}Jumping to playlist position ${index}${colors.reset}`);
    PLAYLIST.currentIndex = index;

    const currentTracks = getCurrentTrackSelections();
    videoState.audioTrack = currentTracks.audioTrack;
    videoState.subtitleTrack = currentTracks.subtitleTrack;
    videoState.currentTime = 0;  // Reset to start of video
    videoState.lastUpdate = Date.now();

    io.emit('sync', videoState);
    io.emit('playlist-position', index);
    io.emit('playlist-update', PLAYLIST);
  });

  // Handle track selection changes from admin
  socket.on('track-change', (data) => {
    console.log('Track change received:', data);

    if (data.videoIndex === undefined || data.videoIndex < 0) {
      console.error('Invalid video index for track change');
      return;
    }

    if (!data.type || !['audio', 'subtitle'].includes(data.type)) {
      console.error('Invalid track type for track change');
      return;
    }

    if (data.trackIndex === undefined || data.trackIndex < -1) {
      console.error('Invalid track index for track change');
      return;
    }

    if (PLAYLIST.videos.length > data.videoIndex) {
      const video = PLAYLIST.videos[data.videoIndex];

      if (data.type === 'audio') {
        video.selectedAudioTrack = data.trackIndex;
      } else if (data.type === 'subtitle') {
        video.selectedSubtitleTrack = data.trackIndex;
      }

      if (data.videoIndex === PLAYLIST.currentIndex) {
        if (data.type === 'audio') {
          videoState.audioTrack = data.trackIndex;
        } else if (data.type === 'subtitle') {
          videoState.subtitleTrack = data.trackIndex;
        }
        videoState.lastUpdate = Date.now();
        io.emit('sync', videoState);
      }

      console.log(`Updated ${data.type} track for video ${data.videoIndex} to track ${data.trackIndex}`);
      io.emit('track-change', data);
    } else {
      console.error('Video index out of range for track change');
    }
  });

  // Handle playlist reordering from admin
  socket.on('playlist-reorder', (data) => {
    const { fromIndex, toIndex } = data;

    // Validate indices
    if (fromIndex < 0 || fromIndex >= PLAYLIST.videos.length ||
      toIndex < 0 || toIndex >= PLAYLIST.videos.length) {
      console.error('Invalid indices for playlist reorder');
      return;
    }

    console.log(`${colors.yellow}Reordering playlist: ${fromIndex} -> ${toIndex}${colors.reset}`);

    // Swap the videos
    [PLAYLIST.videos[fromIndex], PLAYLIST.videos[toIndex]] =
      [PLAYLIST.videos[toIndex], PLAYLIST.videos[fromIndex]];

    // Update mainVideoIndex if it was affected
    if (PLAYLIST.mainVideoIndex === fromIndex) {
      PLAYLIST.mainVideoIndex = toIndex;
    } else if (PLAYLIST.mainVideoIndex === toIndex) {
      PLAYLIST.mainVideoIndex = fromIndex;
    }

    // Update currentIndex if it was affected
    if (PLAYLIST.currentIndex === fromIndex) {
      PLAYLIST.currentIndex = toIndex;
    } else if (PLAYLIST.currentIndex === toIndex) {
      PLAYLIST.currentIndex = fromIndex;
    }

    // Broadcast updated playlist to all clients
    io.emit('playlist-update', PLAYLIST);
  });

  // BSL-S² (Both Side Local Sync Stream) handlers

  // Helper: Check if socket is a verified admin
  function isVerifiedAdmin(socketId) {
    // If fingerprint lock is disabled, all admins are verified
    if (!ADMIN_FINGERPRINT_LOCK) return true;
    return verifiedAdminSockets.has(socketId);
  }

  // Admin registers itself with optional fingerprint
  socket.on('bsl-admin-register', (data) => {
    const fingerprint = data?.fingerprint;

    // Check fingerprint if lock is enabled
    if (ADMIN_FINGERPRINT_LOCK) {
      if (!fingerprint) {
        console.log(`${colors.red}Admin registration rejected: No fingerprint provided${colors.reset}`);
        socket.emit('admin-auth-result', { success: false, reason: 'No fingerprint provided' });
        return;
      }

      if (registeredAdminFingerprint === null) {
        // First admin - register their fingerprint
        registeredAdminFingerprint = fingerprint;
        setAdminFingerprint(fingerprint);
      } else if (registeredAdminFingerprint !== fingerprint) {
        // Fingerprint mismatch - reject and disconnect
        console.log(`${colors.red}Admin rejected: Fingerprint mismatch (expected: ${registeredAdminFingerprint}, got: ${fingerprint})${colors.reset}`);
        socket.emit('admin-auth-result', {
          success: false,
          reason: 'Unauthorized device. This admin panel is locked to a different machine.'
        });
        // Disconnect the unauthorized socket after a brief delay
        setTimeout(() => socket.disconnect(true), 1000);
        return;
      }

      // Add to verified admins
      verifiedAdminSockets.add(socket.id);
    }

    adminSocketId = socket.id;
    console.log(`${colors.green}Admin registered for BSL-S²: ${socket.id}${fingerprint ? ` (fingerprint: ${fingerprint})` : ''}${colors.reset}`);
    socket.emit('admin-auth-result', { success: true });
  });

  // Admin requests BSL-S² check on all clients
  socket.on('bsl-check-request', () => {
    console.log(`${colors.cyan}BSL-S² check requested by admin${colors.reset}`);

    // Only send to clients who haven't already selected a folder
    let promptedCount = 0;
    io.sockets.sockets.forEach((clientSocket, socketId) => {
      // Skip admin
      if (socketId === adminSocketId) return;

      // Skip clients who already have folder selected
      const status = clientBslStatus.get(socketId);
      if (status && status.folderSelected) {
        console.log(`  Skipping ${socketId} - already has folder selected`);
        return;
      }

      // Send check request to this client
      clientSocket.emit('bsl-check-request', {
        playlistVideos: PLAYLIST.videos.map(v => ({ filename: v.filename }))
      });
      promptedCount++;
    });

    console.log(`${colors.cyan}BSL-S² check sent to ${promptedCount} clients${colors.reset}`);
    socket.emit('bsl-check-started', { clientCount: promptedCount });
  });

  // Admin requests stored BSL-S² status (without triggering check)
  socket.on('bsl-get-status', () => {
    sendBslStatusToAdmin();
  });

  // Client reports their local folder files
  socket.on('bsl-folder-selected', (data) => {
    const clientId = data.clientId || socket.id; // Fallback to socket.id if no clientId
    console.log(`${colors.cyan}Client ${clientId} (${socket.id}) reported ${data.files.length} files${colors.reset}`);

    // Store client's file list
    const matchedVideos = {};

    // Get this client's persistent matches
    const clientMatches = persistentBslMatches[clientId] || {};

    // Auto-match by filename + apply persistent matches
    if (PLAYLIST.videos.length > 0) {
      data.files.forEach(clientFile => {
        PLAYLIST.videos.forEach((playlistVideo, index) => {
          // Check auto-match (exact filename)
          if (clientFile.name.toLowerCase() === playlistVideo.filename.toLowerCase()) {
            matchedVideos[index] = clientFile.name;
            console.log(`${colors.green}  Auto-matched: ${clientFile.name} -> playlist[${index}]${colors.reset}`);
          }
          // Check persistent match for this client (previously saved)
          else if (clientMatches[clientFile.name.toLowerCase()] === playlistVideo.filename.toLowerCase()) {
            matchedVideos[index] = clientFile.name;
            console.log(`${colors.cyan}  Persistent match applied: ${clientFile.name} -> playlist[${index}]${colors.reset}`);
          }
        });
      });
    }

    clientBslStatus.set(socket.id, {
      clientId: clientId, // Store clientId for manual match persistence
      clientName: data.clientName || clientId.slice(-6), // Display name
      folderSelected: true,
      files: data.files,
      matchedVideos: matchedVideos
    });

    // Send updated status to admin
    sendBslStatusToAdmin();

    // Send match results back to the client
    socket.emit('bsl-match-result', {
      matchedVideos: matchedVideos,
      totalMatched: Object.keys(matchedVideos).length,
      totalPlaylist: PLAYLIST.videos.length
    });
  });

  // Admin manually matches a client file to a playlist video
  socket.on('bsl-manual-match', (data) => {
    const { clientSocketId, clientFileName, playlistIndex } = data;
    console.log(`${colors.yellow}Manual BSL-S² match: ${clientFileName} -> playlist[${playlistIndex}]${colors.reset}`);

    const clientStatus = clientBslStatus.get(clientSocketId);
    if (clientStatus) {
      clientStatus.matchedVideos[playlistIndex] = clientFileName;

      // Save persistent match using the client's persistent ID
      if (PLAYLIST.videos[playlistIndex] && clientStatus.clientId) {
        const playlistFileName = PLAYLIST.videos[playlistIndex].filename;
        const clientId = clientStatus.clientId;

        setBslMatch(clientId, clientFileName.toLowerCase(), playlistFileName.toLowerCase());
        // Refresh local cache
        persistentBslMatches = getBslMatches();
      }

      // Notify the specific client about the new match
      io.to(clientSocketId).emit('bsl-match-result', {
        matchedVideos: clientStatus.matchedVideos,
        totalMatched: Object.keys(clientStatus.matchedVideos).length,
        totalPlaylist: PLAYLIST.videos.length
      });

      // Update admin
      sendBslStatusToAdmin();
    }
  });

  // Admin sets a client's display name
  socket.on('set-client-name', (data) => {
    const { clientId, displayName } = data;
    if (clientId && displayName) {
      setClientName(clientId, displayName);
      // Refresh local cache
      clientDisplayNames = getClientNames();
      // Update admin with new names
      sendBslStatusToAdmin();
    }
  });

  // Client registers with their fingerprint
  socket.on('client-register', (data) => {
    const fingerprint = data?.fingerprint || 'unknown';
    connectedClients.set(socket.id, {
      fingerprint,
      connectedAt: Date.now()
    });
    console.log(`${colors.cyan}Client registered: ${socket.id} (fingerprint: ${fingerprint})${colors.reset}`);
  });

  // Admin requests the list of connected clients
  socket.on('get-client-list', () => {
    const clients = [];
    connectedClients.forEach((info, socketId) => {
      // Skip admin sockets
      if (verifiedAdminSockets.has(socketId)) return;

      const displayName = clientDisplayNames[info.fingerprint] || '';
      clients.push({
        socketId,
        fingerprint: info.fingerprint,
        displayName,
        connectedAt: info.connectedAt
      });
    });
    socket.emit('client-list', clients);
  });

  // Admin sets a client's display name (via clients modal)
  socket.on('set-client-display-name', (data) => {
    const { fingerprint, displayName } = data;
    if (fingerprint) {
      setClientName(fingerprint, displayName);
      // Refresh local cache
      clientDisplayNames = getClientNames();
      console.log(`${colors.green}Client display name set: ${fingerprint} -> ${displayName}${colors.reset}`);
    }
  });

  // Helper: Send BSL-S² status to admin
  function sendBslStatusToAdmin() {
    if (!adminSocketId) return;

    const clientStatuses = [];
    clientBslStatus.forEach((status, socketId) => {
      const fingerprint = status.clientId;
      // Use admin-set name, or fallback to fingerprint prefix
      const displayName = clientDisplayNames[fingerprint] || fingerprint.slice(-4);
      clientStatuses.push({
        socketId,
        clientId: fingerprint,
        clientName: displayName,
        folderSelected: status.folderSelected,
        files: status.files,
        matchedVideos: status.matchedVideos
      });
    });

    // Calculate overall BSL-S² status per video
    const videoBslStatus = {};
    PLAYLIST.videos.forEach((_, index) => {
      const clientsWithMatch = [];
      const clientsWithoutMatch = [];

      clientBslStatus.forEach((status, socketId) => {
        if (status.matchedVideos[index]) {
          clientsWithMatch.push(socketId);
        } else if (status.folderSelected) {
          clientsWithoutMatch.push(socketId);
        }
      });

      // Determine if BSL-S² is active based on mode
      const totalClients = clientBslStatus.size;
      let bslActive = false;
      if (BSL_S2_MODE === 'all') {
        bslActive = totalClients > 0 && clientsWithMatch.length === totalClients;
      } else { // 'any'
        bslActive = clientsWithMatch.length > 0;
      }

      videoBslStatus[index] = {
        bslActive,
        clientsWithMatch: clientsWithMatch.length,
        clientsWithoutMatch: clientsWithoutMatch.length,
        totalChecked: clientsWithMatch.length + clientsWithoutMatch.length
      };
    });

    io.to(adminSocketId).emit('bsl-status-update', {
      mode: BSL_S2_MODE,
      clients: clientStatuses,
      videoBslStatus
    });
  }

  socket.on('disconnect', () => {
    console.log('A user disconnected');
    // Clean up BSL-S² status
    clientBslStatus.delete(socket.id);
    // Clean up verified admin status
    verifiedAdminSockets.delete(socket.id);
    // Clean up connected clients tracking
    connectedClients.delete(socket.id);
    if (socket.id === adminSocketId) {
      adminSocketId = null;
    }
    // Update admin if still connected
    sendBslStatusToAdmin();
    // Broadcast updated client count
    broadcastClientCount();
  });
});

// Helper: Broadcast client count to all clients
function broadcastClientCount() {
  // Count all connected sockets, excluding admin
  let count = io.sockets.sockets.size;
  if (adminSocketId && io.sockets.sockets.has(adminSocketId)) {
    count--; // Exclude admin from count
  }
  io.emit('client-count', count);
}

// Global time synchronization interval
const syncInterval = setInterval(() => {
  if (videoState.isPlaying) {
    const now = Date.now();
    const elapsed = (now - videoState.lastUpdate) / 1000;
    videoState.currentTime += elapsed;
    videoState.lastUpdate = now;
  }
}, 5000);

// Graceful shutdown
function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down server...`);
  clearInterval(syncInterval);

  io.close(() => {
    console.log('Socket.io closed');
  });

  server.close((err) => {
    if (err) {
      console.error('Error closing server:', err);
      process.exit(1);
    }
    console.log('Server stopped');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const LOCAL_IP = process.argv[2] || 'localhost';
server.listen(PORT, () => {
  console.log(`${colors.blue}Server running at http://${LOCAL_IP}:${PORT}${colors.reset}`);
  console.log(`${colors.blue}Admin panel available at http://${LOCAL_IP}:${PORT}/admin${colors.reset}`);
});