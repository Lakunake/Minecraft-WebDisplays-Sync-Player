const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const helmet = require('helmet');

// Root directory (parent of res/ where server.js lives)
const ROOT_DIR = path.join(__dirname, '..');
// Memory directory for persistent data
const MEMORY_DIR = path.join(ROOT_DIR, 'memory');

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

// =================================================================
// Startup Validation - Check if server is run from expected location
// =================================================================
function validateStartupLocation() {
  const configPath = path.join(ROOT_DIR, 'config.txt');
  const resFolder = path.basename(__dirname);

  // Check if we're actually in a 'res' folder
  if (resFolder !== 'res') {
    console.log(`${colors.yellow}========================================${colors.reset}`);
    console.log(`${colors.yellow}NOTE: Unexpected server location${colors.reset}`);
    console.log(`${colors.yellow}========================================${colors.reset}`);
    console.log('');
    console.log(`This server is designed to run from a 'res' folder.`);
    console.log(`Current folder: ${resFolder}`);
    console.log('');
    console.log(`${colors.cyan}Recommended: Use launcher scripts for best experience:${colors.reset}`);
    console.log(`  Windows: run.bat`);
    console.log(`  Linux/Mac: ./start.sh`);
    console.log('');
  }

  // Check if parent directory has expected structure
  if (!fs.existsSync(configPath) && !fs.existsSync(path.join(ROOT_DIR, 'media'))) {
    console.log(`${colors.yellow}========================================${colors.reset}`);
    console.log(`${colors.yellow}NOTE: Could not find project files${colors.reset}`);
    console.log(`${colors.yellow}========================================${colors.reset}`);
    console.log('');
    console.log(`Could not locate config.txt or media folder in parent.`);
    console.log(`Looking in: ${ROOT_DIR}`);
    console.log('');
    console.log(`${colors.cyan}Recommended: Run from project root:${colors.reset}`);
    console.log(`  Windows: run.bat`);
    console.log(`  Linux/Mac: ./start.sh`);
    console.log(`  Manual: node res/server.js`);
    console.log('');
  }
}

// Check startup location (warnings only)
validateStartupLocation();

// Ensure memory directory exists
if (!fs.existsSync(MEMORY_DIR)) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

// Read and parse config file
function readConfig() {
  const configPath = path.join(ROOT_DIR, 'config.txt');
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
    ssl_cert_file: 'cert.pem',
    bsl_s2_mode: 'any',
    video_autoplay: 'false',
    admin_fingerprint_lock: 'false',
    bsl_advanced_match: 'true',
    bsl_advanced_match_threshold: '1',
    skip_intro_seconds: '87',
    client_controls_disabled: 'false',
    client_sync_disabled: 'false',
    server_mode: 'false',
    chat_enabled: 'true',
    data_hydration: 'true'
  };
}

// Helper to escape HTML to prevent XSS
function escapeHTML(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const config = readConfig();

const app = express();
let server;

if (config.use_https === 'true') {
  try {
    const keyPath = path.join(ROOT_DIR, config.ssl_key_file || 'key.pem');
    const certPath = path.join(ROOT_DIR, config.ssl_cert_file || 'cert.pem');

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
const BSL_ADVANCED_MATCH = config.bsl_advanced_match === 'true'; // defaults to true
const BSL_ADVANCED_MATCH_THRESHOLD = Math.min(4, Math.max(1, parseInt(config.bsl_advanced_match_threshold) || 1)); // 1-4, defaults to 1
const SKIP_INTRO_SECONDS = parseInt(config.skip_intro_seconds) || 90;
const CLIENT_CONTROLS_DISABLED = config.client_controls_disabled === 'true'; // defaults to false
const CLIENT_SYNC_DISABLED = config.client_sync_disabled === 'true'; // defaults to false
const SERVER_MODE = config.server_mode === 'true'; // defaults to false
const CHAT_ENABLED = config.chat_enabled !== 'false'; // defaults to true
const DATA_HYDRATION = config.data_hydration !== 'false'; // defaults to true

// Server mode - disable console logs and enable room-based architecture
if (SERVER_MODE) {
  console.log(`${colors.cyan}Server mode activated, Logs are disabled!${colors.reset}`);
  console.log(`${colors.cyan}Multi-room system enabled. Join mode forced to 'sync'.${colors.reset}`);
  // Override console.log to suppress output (keep console.error for critical errors)
  console.log = () => { };
}

// ==================== Room Logger System ====================
class RoomLogger {
  constructor() {
    this.generalLogFile = path.join(MEMORY_DIR, 'general.json');
    this.ensureGeneralLog();
  }

  ensureGeneralLog() {
    if (!fs.existsSync(this.generalLogFile)) {
      this.saveLog(this.generalLogFile, { logs: [] });
    }
  }

  loadLog(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (error) {
      console.error('Error loading log:', error);
    }
    return { logs: [] };
  }

  saveLog(filePath, data) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error saving log:', error);
    }
  }

  logGeneral(event, details = {}) {
    const logData = this.loadLog(this.generalLogFile);
    logData.logs.push({
      timestamp: new Date().toISOString(),
      event,
      ...details
    });
    // Keep only last 1000 entries
    if (logData.logs.length > 1000) {
      logData.logs = logData.logs.slice(-1000);
    }
    this.saveLog(this.generalLogFile, logData);
  }

  logRoom(roomCode, event, details = {}) {
    const roomLogFile = path.join(MEMORY_DIR, `${roomCode}.json`);
    let logData = this.loadLog(roomLogFile);

    if (!logData.roomCode) {
      logData.roomCode = roomCode;
      logData.logs = [];
    }

    logData.logs.push({
      timestamp: new Date().toISOString(),
      event,
      ...details
    });

    // Keep only last 500 entries per room
    if (logData.logs.length > 500) {
      logData.logs = logData.logs.slice(-500);
    }

    this.saveLog(roomLogFile, logData);
  }

  initRoomLog(roomCode, roomName, createdAt) {
    const roomLogFile = path.join(MEMORY_DIR, `${roomCode}.json`);
    const logData = {
      roomCode,
      roomName,
      createdAt,
      logs: [{
        timestamp: createdAt,
        event: 'room_created'
      }]
    };
    this.saveLog(roomLogFile, logData);
  }

  deleteRoomLog(roomCode) {
    const roomLogFile = path.join(MEMORY_DIR, `${roomCode}.json`);
    try {
      if (fs.existsSync(roomLogFile)) {
        fs.unlinkSync(roomLogFile);
      }
    } catch (error) {
      console.error('Error deleting room log:', error);
    }
  }

  // ==================== Admin Fingerprint Persistence ====================
  getAdminsFile() {
    return path.join(MEMORY_DIR, 'room_admins.json');
  }

  loadAdmins() {
    try {
      const adminsFile = this.getAdminsFile();
      if (fs.existsSync(adminsFile)) {
        return JSON.parse(fs.readFileSync(adminsFile, 'utf8'));
      }
    } catch (error) {
      console.error('Error loading room admins:', error);
    }
    return {};
  }

  saveAdmins(admins) {
    try {
      fs.writeFileSync(this.getAdminsFile(), JSON.stringify(admins, null, 2));
    } catch (error) {
      console.error('Error saving room admins:', error);
    }
  }

  saveAdminFingerprint(roomCode, fingerprint) {
    const admins = this.loadAdmins();
    admins[roomCode] = {
      fingerprint,
      savedAt: new Date().toISOString()
    };
    this.saveAdmins(admins);
    console.log(`Admin fingerprint saved for room ${roomCode}`);
  }

  getAdminFingerprint(roomCode) {
    const admins = this.loadAdmins();
    return admins[roomCode]?.fingerprint || null;
  }

  deleteAdminFingerprint(roomCode) {
    const admins = this.loadAdmins();
    if (admins[roomCode]) {
      delete admins[roomCode];
      this.saveAdmins(admins);
      console.log(`Admin fingerprint deleted for room ${roomCode}`);
    }
  }
}

const roomLogger = SERVER_MODE ? new RoomLogger() : null;

// ==================== Room Class ====================
class Room {
  constructor(code, name, isPrivate, adminFingerprint) {
    this.code = code;
    this.name = name;
    this.isPrivate = isPrivate;
    this.createdAt = new Date().toISOString();
    this.adminFingerprint = adminFingerprint;
    this.adminSocketId = null;
    this.clients = new Map(); // socketId -> { fingerprint, name, connectedAt }

    // Room-specific playlist and video state
    this.playlist = {
      videos: [],
      currentIndex: -1,
      mainVideoIndex: -1,
      mainVideoStartTime: 0,
      preloadMainVideo: false
    };

    this.videoState = {
      isPlaying: true,
      currentTime: 0,
      lastUpdate: Date.now(),
      audioTrack: 0,
      subtitleTrack: -1
    };

    // BSL-S² state for this room
    this.clientBslStatus = new Map();
    this.clientDriftValues = new Map();
  }

  addClient(socketId, fingerprint, name) {
    this.clients.set(socketId, {
      fingerprint,
      name: name || `Guest-${socketId.slice(-4)}`,
      connectedAt: new Date().toISOString()
    });
  }

  removeClient(socketId) {
    this.clients.delete(socketId);
    this.clientBslStatus.delete(socketId);
  }

  getClientCount() {
    return this.clients.size;
  }

  isAdmin(fingerprint) {
    // First check RAM
    if (this.adminFingerprint === fingerprint) {
      return true;
    }
    // Fallback: check persisted fingerprint from disk
    if (roomLogger) {
      const persistedFp = roomLogger.getAdminFingerprint(this.code);
      if (persistedFp && persistedFp === fingerprint) {
        // Update RAM to match disk for future checks
        this.adminFingerprint = persistedFp;
        console.log(`Admin fingerprint restored from disk for room ${this.code}`);
        return true;
      }
    }
    console.log(`Admin check failed for room ${this.code}: provided='${fingerprint}', expected='${this.adminFingerprint}'`);
    return false;
  }

  getCurrentTrackSelections() {
    if (this.playlist.videos.length > 0 && this.playlist.currentIndex >= 0 && this.playlist.currentIndex < this.playlist.videos.length) {
      const currentVideo = this.playlist.videos[this.playlist.currentIndex];
      return {
        audioTrack: currentVideo.selectedAudioTrack !== undefined ? currentVideo.selectedAudioTrack : 0,
        subtitleTrack: currentVideo.selectedSubtitleTrack !== undefined ? currentVideo.selectedSubtitleTrack : -1
      };
    }
    return { audioTrack: 0, subtitleTrack: -1 };
  }
}

// ==================== Rooms Manager ====================
const rooms = new Map(); // roomCode -> Room

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // Ensure uniqueness
  if (rooms.has(code)) {
    return generateRoomCode();
  }
  return code;
}

function createRoom(name, isPrivate, adminFingerprint) {
  const code = generateRoomCode();
  const room = new Room(code, name, isPrivate, adminFingerprint);
  rooms.set(code, room);

  if (roomLogger) {
    roomLogger.logGeneral('room_created', { roomCode: code, roomName: name, isPrivate });
    roomLogger.initRoomLog(code, name, room.createdAt);
    // Persist admin fingerprint to disk for reliable verification
    roomLogger.saveAdminFingerprint(code, adminFingerprint);
  }

  return room;
}

function getRoom(code) {
  return rooms.get(code?.toUpperCase());
}

function deleteRoom(code) {
  const room = rooms.get(code);
  if (room) {
    if (roomLogger) {
      roomLogger.logGeneral('room_deleted', { roomCode: code, roomName: room.name });
      roomLogger.deleteRoomLog(code);
      // Also delete persisted fingerprint
      roomLogger.deleteAdminFingerprint(code);
    }
    rooms.delete(code);
    return true;
  }
  return false;
}

function getPublicRooms() {
  const publicRooms = [];
  rooms.forEach((room, code) => {
    if (!room.isPrivate) {
      publicRooms.push({
        code: room.code,
        name: room.name,
        viewers: room.getClientCount(),
        createdAt: room.createdAt
      });
    }
  });
  return publicRooms;
}

// Track which room each socket is in (for server mode)
const socketRoomMap = new Map(); // socketId -> roomCode

// ==================== Legacy Single-Room State (Non-Server Mode) ====================
// BSL-S² (Both Side Local Sync Stream) state tracking
// Maps socketId -> { folderSelected: bool, files: [{name, size}], matchedVideos: {playlistIndex: localFileName} }
const clientBslStatus = new Map();
// Track admin socket for BSL-S² status updates
let adminSocketId = null;
// Track verified admin sockets (for fingerprint lock security)
const verifiedAdminSockets = new Set();
// Track connected clients with their fingerprints
const connectedClients = new Map(); // socketId -> { fingerprint, connectedAt }
// BSL-S² drift values per client per video (fingerprint -> { playlistIndex: driftSeconds })
const clientDriftValues = new Map();

// BSL-S² Persistent matches file (legacy, now in memory.json)
const BSL_MATCHES_FILE = path.join(MEMORY_DIR, 'bsl_matches.json');

// ==================== Unified Memory Storage ====================
const MEMORY_FILE = path.join(MEMORY_DIR, 'memory.json');

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
    if (fs.existsSync(path.join(ROOT_DIR, 'admin_fingerprint.txt'))) {
      legacy.adminFingerprint = fs.readFileSync(path.join(ROOT_DIR, 'admin_fingerprint.txt'), 'utf8').trim();
    }
    if (fs.existsSync(path.join(ROOT_DIR, 'client_names.json'))) {
      legacy.clientNames = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'client_names.json'), 'utf8'));
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

app.use(express.static(ROOT_DIR));
app.use('/media', express.static(path.join(ROOT_DIR, 'media')));

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
  const filePath = path.join(ROOT_DIR, 'media', safeFilename);
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

app.get('/', (req, res) => {
  if (SERVER_MODE) {
    // Server mode: landing page for room selection
    res.sendFile(path.join(__dirname, 'landing.html'));
  } else {
    // Legacy mode: direct to client
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

let adminTemplateCache = null;

// Helper for serving admin page with hydration
async function serveHydratedAdmin(req, res, roomCode = null) {
  const adminPath = path.join(__dirname, 'admin.html');
  if (!fs.existsSync(adminPath)) return res.status(404).send('Admin page not found');

  if (!DATA_HYDRATION) {
    return res.sendFile(adminPath);
  }

  try {
    // RAM Cache optimization: read once from disk
    if (!adminTemplateCache) {
      adminTemplateCache = fs.readFileSync(adminPath, 'utf8');
    }

    let html = adminTemplateCache;
    const files = await getMediaFiles();

    // Determine state based on room or legacy
    let initialState = { files: files };
    if (SERVER_MODE && roomCode) {
      const room = getRoom(roomCode);
      if (room) {
        initialState.playlist = room.playlist.videos;
        initialState.currentVideoIndex = room.playlist.currentIndex;
      }
    } else {
      initialState.playlist = PLAYLIST.videos;
      initialState.currentVideoIndex = PLAYLIST.currentIndex;
    }

    // Securely stringify and escape </script> to prevent script injection
    const jsonState = JSON.stringify(initialState).replace(/<\/script>/g, '<\\/script>');
    const hydrationScript = `<script>window.INITIAL_DATA = ${jsonState};</script>`;
    // Inject before first script or head
    html = html.replace('<head>', `<head>\n    ${hydrationScript}`);

    res.send(html);
  } catch (error) {
    console.error('Hydration error:', error);
    res.sendFile(adminPath);
  }
}

app.get('/admin', (req, res) => {
  if (SERVER_MODE) {
    res.redirect('/');
  } else {
    serveHydratedAdmin(req, res);
  }
});

app.get('/admin/:roomCode', (req, res) => {
  if (!SERVER_MODE) {
    return res.redirect('/admin');
  }
  const room = getRoom(req.params.roomCode);
  if (!room) {
    return res.redirect('/?error=room_not_found');
  }
  serveHydratedAdmin(req, res, req.params.roomCode);
});

app.get('/watch/:roomCode', (req, res) => {
  if (!SERVER_MODE) {
    return res.redirect('/');
  }
  const room = getRoom(req.params.roomCode);
  if (!room) {
    return res.redirect('/?error=room_not_found');
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Room API endpoints (server mode only)
app.get('/api/rooms', (req, res) => {
  if (!SERVER_MODE) {
    return res.status(404).json({ error: 'Server mode not enabled' });
  }
  res.json(getPublicRooms());
});

app.get('/api/rooms/:roomCode', (req, res) => {
  if (!SERVER_MODE) {
    return res.status(404).json({ error: 'Server mode not enabled' });
  }
  const room = getRoom(req.params.roomCode);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  res.json({
    code: room.code,
    name: room.name,
    isPrivate: room.isPrivate,
    viewers: room.getClientCount(),
    createdAt: room.createdAt
  });
});

// Server mode status endpoint
app.get('/api/server-mode', (req, res) => {
  res.json({ serverMode: SERVER_MODE });
});

let mediaFilesCache = { data: null, lastUpdate: 0 };

// Helper to get media files
function getMediaFiles() {
  // Prevent disk-spamming with a 20-second cache
  if (mediaFilesCache.data && (Date.now() - mediaFilesCache.lastUpdate < 20000)) {
    return Promise.resolve(mediaFilesCache.data);
  }

  const mediaPath = path.join(ROOT_DIR, 'media');
  return new Promise((resolve) => {
    fs.readdir(mediaPath, (err, files) => {
      if (err) return resolve([]);
      const mediaFiles = [];
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (['.mp4', '.mp3', '.avi', '.mov', '.wmv', '.mkv', '.webm', '.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
          mediaFiles.push({
            filename: file,
            escapedFilename: escapeHTML(file),
            usesHEVC: ext === '.mkv'
          });
        }
      }
      mediaFilesCache = { data: mediaFiles, lastUpdate: Date.now() };
      resolve(mediaFiles);
    });
  });
}

app.get('/api/files', async (req, res) => {
  const files = await getMediaFiles();
  res.json(files);
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
  const videoPath = path.join(ROOT_DIR, 'media', safeFilename);
  const thumbnailFilename = safeFilename.replace(/\.[^.]+$/, '.jpg');
  const thumbnailPath = path.join(THUMBNAIL_DIR, thumbnailFilename);

  // Check if thumbnail already exists (cached)
  if (fs.existsSync(thumbnailPath)) {
    return res.json({ thumbnail: `/thumbnails/${thumbnailFilename}` });
  }

  // Check if file exists
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Check if this is an audio file (MP3, etc.) - extract embedded cover art
  const audioExtensions = ['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav'];
  const isAudioFile = audioExtensions.some(ext => safeFilename.toLowerCase().endsWith(ext));

  if (isAudioFile) {
    console.log(`${colors.cyan}Extracting cover art from audio file: ${safeFilename}${colors.reset}`);

    // Extract embedded cover art from audio file
    const coverCommand = `ffmpeg -i "${videoPath}" -an -vcodec copy -y "${thumbnailPath}"`;

    exec(coverCommand, (error) => {
      if (error) {
        console.log(`${colors.yellow}No embedded cover art found in: ${safeFilename}${colors.reset}`);
        // Return a default audio icon or null
        return res.json({ thumbnail: null, isAudio: true });
      }
      console.log(`${colors.green}Extracted cover art from: ${safeFilename}${colors.reset}`);
      res.json({ thumbnail: `/thumbnails/${thumbnailFilename}`, isAudio: true });
    });
    return;
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

  // ==================== Server Mode Room Events ====================
  if (SERVER_MODE) {
    // Create a new room
    socket.on('create-room', (data, callback) => {
      const { name, isPrivate, fingerprint } = data;
      const roomName = name || 'Watch Party';

      const room = createRoom(roomName, isPrivate === true, fingerprint);
      room.adminSocketId = socket.id;
      room.addClient(socket.id, fingerprint, 'Admin');

      // Join socket.io room
      socket.join(room.code);
      socketRoomMap.set(socket.id, room.code);

      if (roomLogger) {
        roomLogger.logRoom(room.code, 'admin_connected', { socketId: socket.id });
        roomLogger.logGeneral('room_admin_joined', { roomCode: room.code });
      }

      if (callback) {
        callback({ success: true, roomCode: room.code, roomName: room.name });
      }

      // Emit public rooms update
      io.emit('rooms-updated', getPublicRooms());
    });

    // Join an existing room
    socket.on('join-room', (data, callback) => {
      const { roomCode, name, fingerprint } = data;
      const room = getRoom(roomCode);

      if (!room) {
        if (callback) {
          callback({ success: false, error: 'Room not found' });
        }
        return;
      }

      // Check if this is the admin reconnecting
      const isAdmin = room.isAdmin(fingerprint);
      if (isAdmin) {
        room.adminSocketId = socket.id;
      }

      room.addClient(socket.id, fingerprint, name);
      socket.join(room.code);
      socketRoomMap.set(socket.id, room.code);

      if (roomLogger) {
        roomLogger.logRoom(room.code, 'client_joined', {
          socketId: socket.id,
          name: name || 'Guest',
          isAdmin
        });
      }

      // Send room config (server mode forces sync join mode)
      socket.emit('config', {
        skipSeconds: SKIP_SECONDS,
        volumeStep: VOLUME_STEP / 100,
        videoAutoplay: VIDEO_AUTOPLAY,
        clientControlsDisabled: CLIENT_CONTROLS_DISABLED,
        serverMode: true,
        roomCode: room.code,
        roomName: room.name,
        isAdmin,
        chatEnabled: CHAT_ENABLED
      });

      // Send current room state
      socket.emit('playlist-update', room.playlist);
      socket.emit('sync', room.videoState);

      if (callback) {
        callback({
          success: true,
          roomCode: room.code,
          roomName: room.name,
          isAdmin,
          viewers: room.getClientCount()
        });
      }

      // Broadcast updated viewer count to room
      io.to(room.code).emit('viewer-count', room.getClientCount());
      io.emit('rooms-updated', getPublicRooms());
    });

    // Leave room
    socket.on('leave-room', () => {
      const roomCode = socketRoomMap.get(socket.id);
      if (roomCode) {
        const room = getRoom(roomCode);
        if (room) {
          room.removeClient(socket.id);
          socket.leave(roomCode);

          if (roomLogger) {
            roomLogger.logRoom(roomCode, 'client_left', { socketId: socket.id });
          }

          io.to(roomCode).emit('viewer-count', room.getClientCount());
          io.emit('rooms-updated', getPublicRooms());
        }
        socketRoomMap.delete(socket.id);
      }
    });

    // Delete room (admin only)
    socket.on('delete-room', (data, callback) => {
      const { roomCode, fingerprint } = data;
      const room = getRoom(roomCode);

      if (!room) {
        if (callback) callback({ success: false, error: 'Room not found' });
        return;
      }

      if (!room.isAdmin(fingerprint)) {
        if (callback) callback({ success: false, error: 'Not authorized' });
        return;
      }

      // Notify all clients in the room
      io.to(roomCode).emit('room-deleted', { roomCode });

      // Remove all sockets from room
      room.clients.forEach((_, socketId) => {
        const clientSocket = io.sockets.sockets.get(socketId);
        if (clientSocket) {
          clientSocket.leave(roomCode);
        }
        socketRoomMap.delete(socketId);
      });

      deleteRoom(roomCode);

      if (callback) callback({ success: true });
      io.emit('rooms-updated', getPublicRooms());
    });

    // Handle disconnect in server mode
    socket.on('disconnect', () => {
      const roomCode = socketRoomMap.get(socket.id);
      if (roomCode) {
        const room = getRoom(roomCode);
        if (room) {
          room.removeClient(socket.id);

          if (roomLogger) {
            roomLogger.logRoom(roomCode, 'client_disconnected', { socketId: socket.id });
          }

          io.to(roomCode).emit('viewer-count', room.getClientCount());
          io.emit('rooms-updated', getPublicRooms());
        }
        socketRoomMap.delete(socket.id);
      }
    });

    // Get public rooms list
    socket.on('get-rooms', (callback) => {
      if (callback) {
        callback(getPublicRooms());
      }
    });

    // Chat message handler (server mode)
    socket.on('chat-message', (data) => {
      if (!CHAT_ENABLED) return;

      const roomCode = socketRoomMap.get(socket.id);
      if (roomCode) {
        const room = getRoom(roomCode);
        if (room) {
          // Broadcast message to all clients in the room (properly escaped)
          io.to(roomCode).emit('chat-message', {
            sender: escapeHTML(data.sender || 'Guest'),
            message: escapeHTML(data.message?.substring(0, 500) || ''),
            timestamp: Date.now()
          });
        }
      }
    });

    // Server mode: don't run legacy initialization, but continue to register event handlers below
  }

  // ==================== Legacy Single-Room Mode Initialization ====================
  // Only run legacy initialization for non-server mode
  if (!SERVER_MODE) {
    // Broadcast updated client count to all (excluding admin)
    broadcastClientCount();

    const currentTracks = getCurrentTrackSelections();
    videoState.audioTrack = currentTracks.audioTrack;
    videoState.subtitleTrack = currentTracks.subtitleTrack;

    // Send config values to client
    socket.emit('config', {
      skipSeconds: SKIP_SECONDS,
      volumeStep: VOLUME_STEP / 100,
      videoAutoplay: VIDEO_AUTOPLAY,
      clientControlsDisabled: CLIENT_CONTROLS_DISABLED,
      serverMode: false,
      chatEnabled: CHAT_ENABLED
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
  } // End of !SERVER_MODE block

  // ==================== Shared Event Handlers (Both Modes) ====================

  // Handle request for initial state (from client on connect)
  socket.on('request-initial-state', () => {
    if (SERVER_MODE) {
      const roomCode = socketRoomMap.get(socket.id);
      if (roomCode) {
        const room = getRoom(roomCode);
        if (room) {
          console.log(`Client requested initial state for room ${roomCode}`);
          socket.emit('initial-state', {
            playlist: room.playlist,
            mainVideoStartTime: room.playlist.mainVideoStartTime,
            videoState: room.videoState
          });
          return;
        }
      }
    }

    console.log('Client requested initial state');
    socket.emit('initial-state', {
      playlist: PLAYLIST,
      mainVideoStartTime: PLAYLIST.mainVideoStartTime,
      videoState: videoState
    });
  });

  // Handle explicit sync request from client
  socket.on('request-sync', () => {
    if (SERVER_MODE) {
      const roomCode = socketRoomMap.get(socket.id);
      if (roomCode) {
        const room = getRoom(roomCode);
        if (room) {
          socket.emit('sync', room.videoState);
          return;
        }
      }
    }

    console.log('Client requested sync');
    socket.emit('sync', videoState);
  });

  // Chat message handler (legacy mode - only if not in server mode room)
  if (!SERVER_MODE) {
    socket.on('chat-message', (data) => {
      if (!CHAT_ENABLED) return;

      // Broadcast message to all clients (properly escaped)
      io.emit('chat-message', {
        sender: escapeHTML(data.sender || 'Guest'),
        message: escapeHTML(data.message?.substring(0, 500) || ''),
        timestamp: Date.now()
      });
    });
  }

  // Listen for control events from clients
  socket.on('control', (data) => {
    if (SERVER_MODE) {
      const roomCode = socketRoomMap.get(socket.id);
      if (!roomCode) return;
      const room = getRoom(roomCode);
      if (!room) return;

      // Allow control if client controls are enabled OR if it's the admin
      const isAdmin = room.adminSocketId === socket.id;
      if (CLIENT_CONTROLS_DISABLED && !isAdmin) {
        console.log(`${colors.yellow}Ignoring non-admin control event in room ${roomCode}${colors.reset}`);
        return;
      }

      if (data.action) {
        if (data.action === 'playpause') {
          room.videoState.isPlaying = data.state;
          room.videoState.lastUpdate = Date.now();
          io.to(roomCode).emit('sync', room.videoState);
        } else if (data.action === 'skip') {
          const direction = data.direction === 'forward' ? 1 : -1;
          room.videoState.currentTime += direction * (data.seconds || SKIP_SECONDS);
          room.videoState.lastUpdate = Date.now();
          io.to(roomCode).emit('sync', room.videoState);
        } else if (data.action === 'seek') {
          room.videoState.currentTime = data.time;
          room.videoState.lastUpdate = Date.now();
          io.to(roomCode).emit('sync', room.videoState);
        } else if (data.action === 'selectTrack') {
          if (data.type === 'audio') {
            room.videoState.audioTrack = data.trackIndex;
          } else if (data.type === 'subtitle') {
            room.videoState.subtitleTrack = data.trackIndex;
          }
          room.videoState.lastUpdate = Date.now();
          io.to(roomCode).emit('sync', room.videoState);
        }
      } else {
        // Direct sync from client (sync-player mode)
        room.videoState = {
          isPlaying: data.isPlaying,
          currentTime: data.currentTime,
          lastUpdate: Date.now(),
          audioTrack: room.videoState.audioTrack,
          subtitleTrack: room.videoState.subtitleTrack
        };
        io.to(roomCode).emit('sync', room.videoState);
      }
      return;
    }

    // Legacy Mode logic
    // Block client sync events if disabled (admin controls still work via action-based events)
    if (CLIENT_SYNC_DISABLED && !data.action) {
      console.log(`${colors.yellow}Ignoring client sync event (client_sync_disabled)${colors.reset}`);
      return;
    }
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

    let targetPlaylist, targetVideoState, targetRoomCode;

    if (SERVER_MODE) {
      targetRoomCode = socketRoomMap.get(socket.id);
      if (!targetRoomCode) return;
      const room = getRoom(targetRoomCode);
      if (!room) return;

      // Only allow admin to set playlist (unless it's a public room with some other rule, but usually admin only)
      if (room.adminSocketId !== socket.id) {
        console.log(`${colors.red}Non-admin attempted to set playlist in room ${targetRoomCode}${colors.reset}`);
        socket.emit('playlist-set', { success: false, message: 'Only admins can set the playlist' });
        return;
      }

      targetPlaylist = room.playlist;
      targetVideoState = room.videoState;
    } else {
      targetPlaylist = PLAYLIST;
      targetVideoState = videoState;
    }

    const processedPlaylist = [];

    for (const item of data.playlist) {
      const videoInfo = { ...item };

      try {
        let tracks = { audio: [], subtitles: [] };
        if (!item.isExternal) {
          tracks = await getTracksForFile(item.filename);
        }
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

    targetPlaylist.videos = processedPlaylist;
    targetPlaylist.mainVideoIndex = data.mainVideoIndex;
    targetPlaylist.mainVideoStartTime = data.startTime;
    targetPlaylist.currentIndex = 0;
    targetPlaylist.preloadMainVideo = true;

    // Set initial track selections for the first video
    if (processedPlaylist.length > 0) {
      const firstVideo = processedPlaylist[0];
      targetVideoState.audioTrack = firstVideo.selectedAudioTrack !== undefined ? firstVideo.selectedAudioTrack : 0;
      targetVideoState.subtitleTrack = firstVideo.selectedSubtitleTrack !== undefined ? firstVideo.selectedSubtitleTrack : -1;
    }

    targetVideoState.currentTime = 0;
    targetVideoState.lastUpdate = Date.now();

    console.log(`Playlist updated (Room: ${targetRoomCode || 'Legacy'}):`);
    console.log('- Total videos:', targetPlaylist.videos.length);
    console.log('- Main video index:', targetPlaylist.mainVideoIndex);
    console.log('- Start time:', targetPlaylist.mainVideoStartTime);

    // Notify clients about the new playlist
    if (SERVER_MODE) {
      io.to(targetRoomCode).emit('playlist-update', targetPlaylist);
    } else {
      io.emit('playlist-update', targetPlaylist);
    }

    // Set initial play state based on autoplay config
    targetVideoState.isPlaying = VIDEO_AUTOPLAY;

    if (SERVER_MODE) {
      io.to(targetRoomCode).emit('sync', targetVideoState);
    } else {
      io.emit('sync', targetVideoState);
    }

    // Extra pause to make sure if autoplay is off
    if (!VIDEO_AUTOPLAY) {
      setTimeout(() => {
        targetVideoState.isPlaying = false;
        if (SERVER_MODE) {
          io.to(targetRoomCode).emit('sync', targetVideoState);
        } else {
          io.emit('sync', targetVideoState);
        }
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
      skipIntroSeconds: SKIP_INTRO_SECONDS,
      volumeStep: VOLUME_STEP / 100,
      joinMode: JOIN_MODE,
      bslS2Mode: BSL_S2_MODE,
      bslAdvancedMatch: BSL_ADVANCED_MATCH,
      useHttps: config.use_https === 'true',
      videoAutoplay: VIDEO_AUTOPLAY,
      adminFingerprintLock: ADMIN_FINGERPRINT_LOCK
    });
  });

  // Skip to next video in playlist (from admin skip button)
  socket.on('skip-to-next-video', () => {
    let targetPlaylist, targetVideoState, targetRoomCode;

    if (SERVER_MODE) {
      targetRoomCode = socketRoomMap.get(socket.id);
      if (!targetRoomCode) return;
      const room = getRoom(targetRoomCode);
      if (!room) return;

      if (room.adminSocketId !== socket.id) return;

      targetPlaylist = room.playlist;
      targetVideoState = room.videoState;
    } else {
      targetPlaylist = PLAYLIST;
      targetVideoState = videoState;
    }

    if (targetPlaylist.videos.length === 0) {
      console.log('No videos in playlist to skip');
      return;
    }

    const nextIndex = (targetPlaylist.currentIndex + 1) % targetPlaylist.videos.length;
    console.log(`${colors.yellow}Skipping to video ${nextIndex + 1}/${targetPlaylist.videos.length} (Room: ${targetRoomCode || 'Legacy'})${colors.reset}`);

    targetPlaylist.currentIndex = nextIndex;

    // Set initial track selections for the new video
    const video = targetPlaylist.videos[nextIndex];
    targetVideoState.audioTrack = video.selectedAudioTrack !== undefined ? video.selectedAudioTrack : 0;
    targetVideoState.subtitleTrack = video.selectedSubtitleTrack !== undefined ? video.selectedSubtitleTrack : -1;
    targetVideoState.currentTime = 0;
    targetVideoState.lastUpdate = Date.now();

    if (SERVER_MODE) {
      io.to(targetRoomCode).emit('sync', targetVideoState);
      io.to(targetRoomCode).emit('playlist-position', nextIndex);
      io.to(targetRoomCode).emit('playlist-update', targetPlaylist);
    } else {
      io.emit('sync', targetVideoState);
      io.emit('playlist-position', nextIndex);
      io.emit('playlist-update', targetPlaylist);
    }
  });

  // Move to next video in playlist
  socket.on('playlist-next', (nextIndex) => {
    let targetPlaylist, targetVideoState, targetRoomCode;

    if (SERVER_MODE) {
      targetRoomCode = socketRoomMap.get(socket.id);
      if (!targetRoomCode) return;
      const room = getRoom(targetRoomCode);
      if (!room) return;

      targetPlaylist = room.playlist;
      targetVideoState = room.videoState;
    } else {
      targetPlaylist = PLAYLIST;
      targetVideoState = videoState;
    }

    targetPlaylist.currentIndex = nextIndex;

    // Set initial track selections for the new video
    if (targetPlaylist.videos[nextIndex]) {
      const video = targetPlaylist.videos[nextIndex];
      targetVideoState.audioTrack = video.selectedAudioTrack !== undefined ? video.selectedAudioTrack : 0;
      targetVideoState.subtitleTrack = video.selectedSubtitleTrack !== undefined ? video.selectedSubtitleTrack : -1;
    }
    targetVideoState.lastUpdate = Date.now();

    if (SERVER_MODE) {
      io.to(targetRoomCode).emit('sync', targetVideoState);
      io.to(targetRoomCode).emit('playlist-position', nextIndex);
    } else {
      io.emit('sync', targetVideoState);
      io.emit('playlist-position', nextIndex);
    }
  });

  // Jump to specific video in playlist (from admin)
  socket.on('playlist-jump', (index) => {
    let targetPlaylist, targetVideoState, targetRoomCode;

    if (SERVER_MODE) {
      targetRoomCode = socketRoomMap.get(socket.id);
      if (!targetRoomCode) return;
      const room = getRoom(targetRoomCode);
      if (!room) return;

      if (room.adminSocketId !== socket.id) return;

      targetPlaylist = room.playlist;
      targetVideoState = room.videoState;
    } else {
      targetPlaylist = PLAYLIST;
      targetVideoState = videoState;
    }

    if (index < 0 || index >= targetPlaylist.videos.length) {
      console.log('Invalid playlist jump index:', index);
      return;
    }

    console.log(`${colors.yellow}Jumping to playlist position ${index} (Room: ${targetRoomCode || 'Legacy'})${colors.reset}`);
    targetPlaylist.currentIndex = index;

    // Set initial track selections for the new video
    const video = targetPlaylist.videos[index];
    targetVideoState.audioTrack = video.selectedAudioTrack !== undefined ? video.selectedAudioTrack : 0;
    targetVideoState.subtitleTrack = video.selectedSubtitleTrack !== undefined ? video.selectedSubtitleTrack : -1;
    targetVideoState.currentTime = 0;  // Reset to start of video
    targetVideoState.lastUpdate = Date.now();

    if (SERVER_MODE) {
      io.to(targetRoomCode).emit('sync', targetVideoState);
      io.to(targetRoomCode).emit('playlist-position', index);
      io.to(targetRoomCode).emit('playlist-update', targetPlaylist);
    } else {
      io.emit('sync', targetVideoState);
      io.emit('playlist-position', index);
      io.emit('playlist-update', targetPlaylist);
    }
  });

  // Handle track selection changes from admin
  socket.on('track-change', (data) => {
    console.log('Track change received:', data);

    let targetPlaylist, targetVideoState, targetRoomCode;

    if (SERVER_MODE) {
      targetRoomCode = socketRoomMap.get(socket.id);
      if (!targetRoomCode) return;
      const room = getRoom(targetRoomCode);
      if (!room) return;

      if (room.adminSocketId !== socket.id) return;

      targetPlaylist = room.playlist;
      targetVideoState = room.videoState;
    } else {
      targetPlaylist = PLAYLIST;
      targetVideoState = videoState;
    }

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

    if (targetPlaylist.videos.length > data.videoIndex) {
      const video = targetPlaylist.videos[data.videoIndex];

      if (data.type === 'audio') {
        video.selectedAudioTrack = data.trackIndex;
      } else if (data.type === 'subtitle') {
        video.selectedSubtitleTrack = data.trackIndex;
      }

      if (data.videoIndex === targetPlaylist.currentIndex) {
        if (data.type === 'audio') {
          targetVideoState.audioTrack = data.trackIndex;
        } else if (data.type === 'subtitle') {
          targetVideoState.subtitleTrack = data.trackIndex;
        }
        targetVideoState.lastUpdate = Date.now();

        if (SERVER_MODE) {
          io.to(targetRoomCode).emit('sync', targetVideoState);
        } else {
          io.emit('sync', targetVideoState);
        }
      }

      console.log(`Updated ${data.type} track for video ${data.videoIndex} to track ${data.trackIndex} (Room: ${targetRoomCode || 'Legacy'})`);

      if (SERVER_MODE) {
        io.to(targetRoomCode).emit('track-change', data);
      } else {
        io.emit('track-change', data);
      }
    } else {
      console.error('Video index out of range for track change');
    }
  });

  // Handle playlist reordering from admin
  socket.on('playlist-reorder', (data) => {
    const { fromIndex, toIndex } = data;

    let targetPlaylist, targetRoomCode;

    if (SERVER_MODE) {
      targetRoomCode = socketRoomMap.get(socket.id);
      if (!targetRoomCode) return;
      const room = getRoom(targetRoomCode);
      if (!room) return;

      if (room.adminSocketId !== socket.id) return;

      targetPlaylist = room.playlist;
    } else {
      targetPlaylist = PLAYLIST;
    }

    // Validate indices
    if (fromIndex < 0 || fromIndex >= targetPlaylist.videos.length ||
      toIndex < 0 || toIndex >= targetPlaylist.videos.length) {
      console.error('Invalid indices for playlist reorder');
      return;
    }

    console.log(`${colors.yellow}Reordering playlist: ${fromIndex} -> ${toIndex} (Room: ${targetRoomCode || 'Legacy'})${colors.reset}`);

    // Swap the videos
    [targetPlaylist.videos[fromIndex], targetPlaylist.videos[toIndex]] =
      [targetPlaylist.videos[toIndex], targetPlaylist.videos[fromIndex]];

    // Update mainVideoIndex if it was affected
    if (targetPlaylist.mainVideoIndex === fromIndex) {
      targetPlaylist.mainVideoIndex = toIndex;
    } else if (targetPlaylist.mainVideoIndex === toIndex) {
      targetPlaylist.mainVideoIndex = fromIndex;
    }

    // Update currentIndex if it was affected
    if (targetPlaylist.currentIndex === fromIndex) {
      targetPlaylist.currentIndex = toIndex;
    } else if (targetPlaylist.currentIndex === toIndex) {
      targetPlaylist.currentIndex = fromIndex;
    }

    // Broadcast updated playlist to clients
    if (SERVER_MODE) {
      io.to(targetRoomCode).emit('playlist-update', targetPlaylist);
    } else {
      io.emit('playlist-update', targetPlaylist);
    }
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
    let targetRoomCode, targetPlaylist, targetClientBslStatus, targetAdminSocketId;

    if (SERVER_MODE) {
      targetRoomCode = socketRoomMap.get(socket.id);
      if (!targetRoomCode) return;
      const room = getRoom(targetRoomCode);
      if (!room) return;
      if (room.adminSocketId !== socket.id) return;

      targetPlaylist = room.playlist;
      targetClientBslStatus = room.clientBslStatus;
      targetAdminSocketId = room.adminSocketId;
    } else {
      targetPlaylist = PLAYLIST;
      targetClientBslStatus = clientBslStatus;
      targetAdminSocketId = adminSocketId;
    }

    console.log(`${colors.cyan}BSL-S² check requested by admin (Room: ${targetRoomCode || 'Legacy'})${colors.reset}`);

    // Only send to clients who haven't already selected a folder
    let promptedCount = 0;

    // In server mode, only check clients in this room
    const socketsToPoll = SERVER_MODE ?
      Array.from(getRoom(targetRoomCode).clients.keys()) :
      Array.from(io.sockets.sockets.keys());

    socketsToPoll.forEach((socketId) => {
      // Skip admin
      if (socketId === targetAdminSocketId) return;

      // Skip clients who already have folder selected
      const status = targetClientBslStatus.get(socketId);
      if (status && status.folderSelected) {
        console.log(`  Skipping ${socketId} - already has folder selected`);
        return;
      }

      const clientSocket = io.sockets.sockets.get(socketId);
      if (clientSocket) {
        // Send check request to this client
        clientSocket.emit('bsl-check-request', {
          playlistVideos: targetPlaylist.videos.map(v => ({ filename: v.filename }))
        });
        promptedCount++;
      }
    });

    console.log(`${colors.cyan}BSL-S² check sent to ${promptedCount} clients${colors.reset}`);
    socket.emit('bsl-check-started', { clientCount: promptedCount });
  });

  // Admin requests stored BSL-S² status (without triggering check)
  socket.on('bsl-get-status', () => {
    if (SERVER_MODE) {
      const roomCode = socketRoomMap.get(socket.id);
      if (roomCode) sendBslStatusToAdmin(roomCode);
    } else {
      sendBslStatusToAdmin();
    }
  });

  // Client reports their local folder files
  socket.on('bsl-folder-selected', (data) => {
    let targetRoomCode, targetPlaylist, targetClientBslStatus;

    if (SERVER_MODE) {
      targetRoomCode = socketRoomMap.get(socket.id);
      if (!targetRoomCode) return;
      const room = getRoom(targetRoomCode);
      if (!room) return;

      targetPlaylist = room.playlist;
      targetClientBslStatus = room.clientBslStatus;
    } else {
      targetPlaylist = PLAYLIST;
      targetClientBslStatus = clientBslStatus;
    }

    const clientId = data.clientId || socket.id; // Fallback to socket.id if no clientId
    console.log(`${colors.cyan}Client ${clientId} (${socket.id}) reported ${data.files.length} files (Room: ${targetRoomCode || 'Legacy'})${colors.reset}`);

    // Store client's file list
    const matchedVideos = {};

    // Get this client's persistent matches
    const clientMatches = persistentBslMatches[clientId] || {};

    // Auto-match by filename + apply persistent matches
    if (targetPlaylist.videos.length > 0) {
      data.files.forEach(clientFile => {
        targetPlaylist.videos.forEach((playlistVideo, index) => {
          // Check persistent match for this client (previously saved)
          if (clientMatches[clientFile.name.toLowerCase()] === playlistVideo.filename.toLowerCase()) {
            matchedVideos[index] = clientFile.name;
            console.log(`${colors.cyan}  Persistent match applied: ${clientFile.name} -> playlist[${index}]${colors.reset}`);
            return; // Skip further checks for this file
          }

          // Advanced matching (3 of 4 criteria)
          if (BSL_ADVANCED_MATCH) {
            let matchScore = 0;
            const SIZE_TOLERANCE = 1.5 * 1024 * 1024; // 1.5 MB in bytes

            // 1. Filename match (case-insensitive)
            const clientBasename = clientFile.name.toLowerCase();
            const serverBasename = playlistVideo.filename.toLowerCase();
            if (clientBasename === serverBasename) {
              matchScore++;
            }

            // 2. Extension match (case-insensitive)
            const clientExt = clientFile.name.substring(clientFile.name.lastIndexOf('.')).toLowerCase();
            const serverExt = playlistVideo.filename.substring(playlistVideo.filename.lastIndexOf('.')).toLowerCase();
            if (clientExt === serverExt) {
              matchScore++;
            }

            // 3. Size match (within ±1.5MB tolerance)
            if (clientFile.size !== undefined) {
              try {
                const serverFilePath = path.join(ROOT_DIR, 'media', playlistVideo.filename);
                const serverStats = fs.statSync(serverFilePath);
                const sizeDiff = Math.abs(clientFile.size - serverStats.size);
                if (sizeDiff <= SIZE_TOLERANCE) {
                  matchScore++;
                }
              } catch (err) {
                // If we can't stat the file, skip this criterion
                console.log(`${colors.yellow}  Could not stat server file: ${playlistVideo.filename}${colors.reset}`);
              }
            }

            // 4. MIME type match
            if (clientFile.type && clientFile.type.length > 0) {
              // Derive expected MIME from extension
              const mimeMap = {
                '.mp4': 'video/mp4',
                '.mkv': 'video/x-matroska',
                '.webm': 'video/webm',
                '.avi': 'video/x-msvideo',
                '.mov': 'video/quicktime',
                '.wmv': 'video/x-ms-wmv',
                '.mp3': 'audio/mpeg',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.webp': 'image/webp'
              };
              const expectedMime = mimeMap[serverExt] || '';
              if (clientFile.type === expectedMime || clientFile.type.startsWith(expectedMime.split('/')[0])) {
                matchScore++;
              }
            }

            // Match if threshold or more criteria pass
            if (matchScore >= BSL_ADVANCED_MATCH_THRESHOLD) {
              matchedVideos[index] = clientFile.name;
              console.log(`${colors.green}  Advanced match (${matchScore}/4, threshold: ${BSL_ADVANCED_MATCH_THRESHOLD}): ${clientFile.name} -> playlist[${index}]${colors.reset}`);
            }
          } else {
            // Simple filename-only matching (original behavior)
            if (clientFile.name.toLowerCase() === playlistVideo.filename.toLowerCase()) {
              matchedVideos[index] = clientFile.name;
              console.log(`${colors.green}  Auto-matched: ${clientFile.name} -> playlist[${index}]${colors.reset}`);
            }
          }
        });
      });
    }

    targetClientBslStatus.set(socket.id, {
      clientId: clientId, // Store clientId for manual match persistence
      clientName: data.clientName || clientId.slice(-6), // Display name
      folderSelected: true,
      files: data.files,
      matchedVideos: matchedVideos
    });

    // Send updated status to admin
    if (SERVER_MODE) {
      sendBslStatusToAdmin(targetRoomCode);
    } else {
      sendBslStatusToAdmin();
    }

    // Send match results back to the client
    socket.emit('bsl-match-result', {
      matchedVideos: matchedVideos,
      totalMatched: Object.keys(matchedVideos).length,
      totalPlaylist: targetPlaylist.videos.length
    });
  });

  // Admin manually matches a client file to a playlist video
  socket.on('bsl-manual-match', (data) => {
    let targetRoomCode, targetPlaylist, targetClientBslStatus;

    if (SERVER_MODE) {
      targetRoomCode = socketRoomMap.get(socket.id);
      if (!targetRoomCode) return;
      const room = getRoom(targetRoomCode);
      if (!room) return;
      if (room.adminSocketId !== socket.id) return;

      targetPlaylist = room.playlist;
      targetClientBslStatus = room.clientBslStatus;
    } else {
      targetPlaylist = PLAYLIST;
      targetClientBslStatus = clientBslStatus;
    }

    const { clientSocketId, clientFileName, playlistIndex } = data;
    console.log(`${colors.yellow}Manual BSL-S² match: ${clientFileName} -> playlist[${playlistIndex}] (Room: ${targetRoomCode || 'Legacy'})${colors.reset}`);

    const clientStatus = targetClientBslStatus.get(clientSocketId);
    if (clientStatus) {
      clientStatus.matchedVideos[playlistIndex] = clientFileName;

      // Save persistent match using the client's persistent ID
      if (targetPlaylist.videos[playlistIndex] && clientStatus.clientId) {
        const playlistFileName = targetPlaylist.videos[playlistIndex].filename;
        const clientId = clientStatus.clientId;

        setBslMatch(clientId, clientFileName.toLowerCase(), playlistFileName.toLowerCase());
        // Refresh local cache
        persistentBslMatches = getBslMatches();
      }

      // Notify the specific client about the new match
      io.to(clientSocketId).emit('bsl-match-result', {
        matchedVideos: clientStatus.matchedVideos,
        totalMatched: Object.keys(clientStatus.matchedVideos).length,
        totalPlaylist: targetPlaylist.videos.length
      });

      // Update admin
      if (SERVER_MODE) {
        sendBslStatusToAdmin(targetRoomCode);
      } else {
        sendBslStatusToAdmin();
      }
    }
  });

  // Admin sets drift for a specific client and playlist video
  socket.on('bsl-set-drift', (data) => {
    let targetRoomCode, targetClientDriftValues;

    if (SERVER_MODE) {
      targetRoomCode = socketRoomMap.get(socket.id);
      if (!targetRoomCode) return;
      const room = getRoom(targetRoomCode);
      if (!room) return;
      if (room.adminSocketId !== socket.id) return;

      targetClientDriftValues = room.clientDriftValues;
    } else {
      targetClientDriftValues = clientDriftValues;
    }

    const { clientFingerprint, playlistIndex, driftSeconds } = data;
    if (!clientFingerprint || playlistIndex === undefined) return;

    // Clamp drift to reasonable range (-60 to +60 seconds)
    const clampedDrift = Math.max(-60, Math.min(60, parseInt(driftSeconds) || 0));

    // Get or create drift object for this client
    let clientDrifts = targetClientDriftValues.get(clientFingerprint);
    if (!clientDrifts) {
      clientDrifts = {};
      targetClientDriftValues.set(clientFingerprint, clientDrifts);
    }

    // Store drift value
    clientDrifts[playlistIndex] = clampedDrift;
    console.log(`${colors.yellow}BSL-S² drift set: ${clientFingerprint} video[${playlistIndex}] = ${clampedDrift}s (Room: ${targetRoomCode || 'Legacy'})${colors.reset}`);

    // If in Server Mode, only notify clients in the specific room
    if (SERVER_MODE) {
      const room = getRoom(targetRoomCode);
      room.clients.forEach((c, socketId) => {
        if (c.fingerprint === clientFingerprint) {
          io.to(socketId).emit('bsl-drift-update', {
            driftValues: clientDrifts
          });
        }
      });
    } else {
      // Find the client socket and notify them (legacy)
      connectedClients.forEach((info, socketId) => {
        if (info.fingerprint === clientFingerprint) {
          io.to(socketId).emit('bsl-drift-update', {
            driftValues: clientDrifts
          });
        }
      });
    }

    // Update admin with new drift values
    if (SERVER_MODE) {
      sendBslStatusToAdmin(targetRoomCode);
    } else {
      sendBslStatusToAdmin();
    }
  });

  // Admin sets a client's display name
  socket.on('set-client-name', (data) => {
    let targetRoomCode;
    if (SERVER_MODE) {
      targetRoomCode = socketRoomMap.get(socket.id);
      if (!targetRoomCode) return;
      const room = getRoom(targetRoomCode);
      if (!room) return;
      if (room.adminSocketId !== socket.id) return;
    }

    const { clientId, displayName } = data;
    if (clientId && displayName) {
      setClientName(clientId, displayName);
      // Refresh local cache
      clientDisplayNames = getClientNames();
      // Update admin with new names
      if (SERVER_MODE) {
        sendBslStatusToAdmin(targetRoomCode);
      } else {
        sendBslStatusToAdmin();
      }
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
    let targetRoomCode;
    const clients = [];

    if (SERVER_MODE) {
      targetRoomCode = socketRoomMap.get(socket.id);
      if (!targetRoomCode) return;
      const room = getRoom(targetRoomCode);
      if (!room) return;

      room.clients.forEach((c, socketId) => {
        // Skip admin sockets
        if (room.adminSocketId === socketId) return;

        const displayName = clientDisplayNames[c.fingerprint] || '';
        clients.push({
          socketId,
          fingerprint: c.fingerprint,
          displayName,
          connectedAt: c.connectedAt
        });
      });
    } else {
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
    }
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
  function sendBslStatusToAdmin(roomCode = null) {
    let targetAdminSocketId, targetClientBslStatus, targetClientDriftValues, targetPlaylist;

    if (SERVER_MODE && roomCode) {
      const room = getRoom(roomCode);
      if (!room) return;
      targetAdminSocketId = room.adminSocketId;
      targetClientBslStatus = room.clientBslStatus;
      targetClientDriftValues = room.clientDriftValues;
      targetPlaylist = room.playlist;
    } else {
      targetAdminSocketId = adminSocketId;
      targetClientBslStatus = clientBslStatus;
      targetClientDriftValues = clientDriftValues;
      targetPlaylist = PLAYLIST;
    }

    if (!targetAdminSocketId) return;

    const clientStatuses = [];
    targetClientBslStatus.forEach((status, socketId) => {
      const fingerprint = status.clientId;
      // Use admin-set name, or fallback to fingerprint prefix
      const displayName = clientDisplayNames[fingerprint] || fingerprint.slice(-4);
      // Get drift values for this client
      const driftValues = targetClientDriftValues.get(fingerprint) || {};
      clientStatuses.push({
        socketId,
        clientId: fingerprint,
        clientName: displayName,
        folderSelected: status.folderSelected,
        files: status.files,
        matchedVideos: status.matchedVideos,
        driftValues: driftValues
      });
    });

    // Calculate overall BSL-S² status per video
    const videoBslStatus = {};
    targetPlaylist.videos.forEach((_, index) => {
      const clientsWithMatch = [];
      const clientsWithoutMatch = [];

      targetClientBslStatus.forEach((status, socketId) => {
        if (status.matchedVideos[index]) {
          clientsWithMatch.push(socketId);
        } else if (status.folderSelected) {
          clientsWithoutMatch.push(socketId);
        }
      });

      // Determine if BSL-S² is active based on mode
      const totalClients = targetClientBslStatus.size;
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

    io.to(targetAdminSocketId).emit('bsl-status-update', {
      mode: BSL_S2_MODE,
      clients: clientStatuses,
      videoBslStatus
    });
  }

  socket.on('disconnect', () => {
    console.log('A user disconnected');

    if (SERVER_MODE) {
      const roomCode = socketRoomMap.get(socket.id);
      if (roomCode) {
        const room = getRoom(roomCode);
        if (room) {
          // Clean up room-specific BSL status
          room.clientBslStatus.delete(socket.id);
          // If this was an admin, we don't necessarily delete the room here 
          // (that's handled by delete-room or room timeout logic if implemented)

          // Update room admin
          sendBslStatusToAdmin(roomCode);
          // Broadcast updated client count for this room
          broadcastClientCount(roomCode);
        }
        socketRoomMap.delete(socket.id);
      }
    } else {
      // Legacy Mode cleanup
      clientBslStatus.delete(socket.id);
      verifiedAdminSockets.delete(socket.id);
      connectedClients.delete(socket.id);
      if (socket.id === adminSocketId) {
        adminSocketId = null;
      }
      sendBslStatusToAdmin();
      broadcastClientCount();
    }
  });
});

// Helper: Broadcast client count to all clients
function broadcastClientCount(roomCode = null) {
  if (SERVER_MODE && roomCode) {
    const room = getRoom(roomCode);
    if (room) {
      let count = room.clients.size;
      if (room.adminSocketId && room.clients.has(room.adminSocketId)) {
        count--; // Exclude admin from count
      }
      io.to(roomCode).emit('client-count', count);
    }
  } else {
    // Count all connected sockets, excluding admin (legacy)
    let count = io.sockets.sockets.size;
    if (adminSocketId && io.sockets.sockets.has(adminSocketId)) {
      count--; // Exclude admin from count
    }
    io.emit('client-count', count);
  }
}

// Global time synchronization interval
const syncInterval = setInterval(() => {
  if (SERVER_MODE) {
    // Update videoState for all active rooms
    rooms.forEach(room => {
      if (room.videoState.isPlaying) {
        const now = Date.now();
        const elapsed = (now - room.videoState.lastUpdate) / 1000;
        room.videoState.currentTime += elapsed;
        room.videoState.lastUpdate = now;
      }
    });
  } else {
    // Legacy Mode sync
    if (videoState.isPlaying) {
      const now = Date.now();
      const elapsed = (now - videoState.lastUpdate) / 1000;
      videoState.currentTime += elapsed;
      videoState.lastUpdate = now;
    }
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

// ==================== VPN/Proxy Detection ====================
// Check for ACTIVE VPN connections by detecting connected VPN network adapters
function checkForVpnProxy() {
  const detectedItems = [];

  // Step 1: Check for active VPN network adapters using netsh
  // This detects if a VPN tunnel is actually connected, not just if the app is open
  exec('netsh interface show interface', { encoding: 'utf8', timeout: 5000 }, (error, stdout) => {
    if (!error && stdout) {
      // VPN adapter name patterns that indicate an active connection
      const vpnAdapterPatterns = [
        { pattern: /connected\s+.*\s+(tap-windows|tap-nordvpn|tap-protonvpn|tap-expressvpn)/i, display: 'VPN (TAP Adapter)' },
        { pattern: /connected\s+.*\s+warp/i, display: 'Cloudflare WARP' },
        { pattern: /connected\s+.*\s+wireguard/i, display: 'WireGuard' },
        { pattern: /connected\s+.*\s+nordlynx/i, display: 'NordVPN (NordLynx)' },
        { pattern: /connected\s+.*\s+mullvad/i, display: 'Mullvad VPN' },
        { pattern: /connected\s+.*\s+proton/i, display: 'ProtonVPN' },
        { pattern: /connected\s+.*\s+windscribe/i, display: 'Windscribe' },
        { pattern: /connected\s+.*\s+surfshark/i, display: 'Surfshark' },
        { pattern: /connected\s+.*\s+pia/i, display: 'Private Internet Access' },
        { pattern: /connected\s+.*\s+expressvpn/i, display: 'ExpressVPN' },
        { pattern: /connected\s+.*\s+cyberghost/i, display: 'CyberGhost' },
        { pattern: /connected\s+.*\s+tun/i, display: 'VPN (TUN Adapter)' },
      ];

      vpnAdapterPatterns.forEach(({ pattern, display }) => {
        if (pattern.test(stdout)) {
          if (!detectedItems.includes(display)) {
            detectedItems.push(display);
          }
        }
      });
    }

    // Step 2: Check for DPI bypass tools that work at packet level (always active when running)
    exec('tasklist /FO CSV /NH', { encoding: 'utf8', timeout: 5000 }, (error2, stdout2) => {
      if (!error2 && stdout2) {
        const runningProcesses = new Set();
        stdout2.split('\n').forEach(line => {
          const match = line.match(/^"([^"]+\.exe)"/i);
          if (match) {
            runningProcesses.add(match[1].toLowerCase().replace(/\.exe$/i, ''));
          }
        });

        // DPI bypass and proxy tools (these are always active when the process runs)
        const alwaysActiveProcesses = [
          { name: 'goodbyedpi', display: 'GoodbyeDPI' },
          { name: 'zapret', display: 'Zapret' },
          { name: 'byedpi', display: 'ByeDPI' },
          { name: 'v2ray', display: 'V2Ray' },
          { name: 'v2rayn', display: 'V2RayN' },
          { name: 'xray', display: 'Xray' },
          { name: 'clash', display: 'Clash' },
          { name: 'clash-verge', display: 'Clash Verge' },
          { name: 'clashforwindows', display: 'Clash for Windows' },
          { name: 'sing-box', display: 'sing-box' },
          { name: 'shadowsocks', display: 'Shadowsocks' },
          { name: 'ss-local', display: 'Shadowsocks' },
          { name: 'tor', display: 'Tor' },
          { name: 'obfs4proxy', display: 'Tor Bridge (obfs4)' },
          { name: 'privoxy', display: 'Privoxy' },
          { name: 'psiphon3', display: 'Psiphon' },
          { name: 'lantern', display: 'Lantern' },
          { name: 'cloudflared', display: 'Cloudflare Tunnel' },
          { name: 'dnscrypt-proxy', display: 'DNSCrypt' },
        ];

        alwaysActiveProcesses.forEach(proc => {
          if (runningProcesses.has(proc.name.toLowerCase())) {
            if (!detectedItems.includes(proc.display)) {
              detectedItems.push(proc.display);
            }
          }
        });
      }

      // Output results
      if (detectedItems.length > 0) {
        console.log('');
        console.log(`${colors.yellow}⚠️  Active VPN/Proxy Connections Detected:${colors.reset}`);
        detectedItems.forEach(app => {
          console.log(`${colors.yellow}   • ${app}${colors.reset}`);
        });
        console.log(`${colors.yellow}   These active connections may cause issues for clients on your network.${colors.reset}`);
        console.log(`${colors.yellow}   Consider disconnecting when hosting Sync-Player sessions.${colors.reset}`);
        console.log('');

        // Store for admin panel notification
        detectedVpnProxy = detectedItems;
      }
    });
  });
}

// Store detected VPN/proxy for admin notification
let detectedVpnProxy = [];

// API endpoint for admin to check VPN/proxy status
app.get('/api/vpn-check', (req, res) => {
  res.json({ detected: detectedVpnProxy });
});

server.listen(PORT, () => {
  console.log(`${colors.blue}Server running at http://${LOCAL_IP}:${PORT}${colors.reset}`);
  console.log(`${colors.blue}Admin panel available at http://${LOCAL_IP}:${PORT}/admin${colors.reset}`);

  // Check for VPN/proxy software after server starts
  checkForVpnProxy();
});