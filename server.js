
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const VIDEOS_DIR = path.join(ROOT, 'videos');
const CONFIG_PATH = path.join(ROOT, 'config.txt');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Read config file (simple key: value)
function readConfig() {
  const cfg = {};
  if (!fs.existsSync(CONFIG_PATH)) return cfg;
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  raw.split(/\r?\n/).forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const idx = line.indexOf(':');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx+1).trim();
    cfg[key] = val;
  });
  return cfg;
}

// CLI args: MAX_CLIENTS CHUNK_SIZE PORT VOLUME_STEP SKIP_SECONDS "VIDEO_FILE" START_TIME ADMIN_TOKEN
const argv = process.argv.slice(2);
const cli = {
  max_clients: argv[0],
  chunk_size: argv[1],
  port: argv[2],
  volume_step: argv[3],
  skip_seconds: argv[4],
  video_file: argv[5],
  start_time: argv[6],
  admin_token: argv[7]
};

const cfg = readConfig();
function coalesce(key, def) {
  if (cli[key] !== undefined && cli[key] !== null && cli[key] !== '') return cli[key];
  if (cfg[key] !== undefined) return cfg[key];
  return def;
}

const PORT = parseInt(coalesce('port', 3000), 10) || 3000;
const MAX_CLIENTS = parseInt(coalesce('max_clients', 20), 10) || 20;
const CHUNK_SIZE = parseInt(coalesce('chunk_size', 10), 10) || 10;

// Volume step normalization: accept percent (e.g., 5) or decimal (0.05)
let rawVolumeStep = parseFloat(coalesce('volume_step', 0.05));
const VOLUME_STEP = (function(){
  if (!isFinite(rawVolumeStep) || rawVolumeStep === null || rawVolumeStep === undefined) return 0.05;
  if (rawVolumeStep > 1) return Math.min(1, rawVolumeStep / 100);
  return Math.max(0, Math.min(1, rawVolumeStep));
})();

const SKIP_SECONDS = parseInt(coalesce('skip_seconds', 5), 10) || 5;
const DEFAULT_VIDEO = coalesce('video_file', '');
const DEFAULT_START = parseFloat(coalesce('start_time', 0)) || 0;
const DEFAULT_CLIENT_VOLUME = parseFloat(coalesce('default_volume', 0.5)) || 0.5;

// Admin token from CLI or config adminpass (treat '0' or empty as none)
const ADMIN_TOKEN = (function(){
  const cfgAdmin = coalesce('adminpass', '0');
  const adminFromConfig = (cfgAdmin && cfgAdmin !== '0') ? cfgAdmin : '';
  return coalesce('admin_token', adminFromConfig);
})();

// Ensure videos dir exists
try {
  if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });
} catch (e) {
  console.error('Could not create videos dir:', e);
}

// Simple static serving: serve public and videos
app.use(express.static(path.join(ROOT, 'public')));
app.use('/videos', express.static(VIDEOS_DIR));

// Blocklist to avoid leaking server files
const BLOCKED = new Set(['server.js','config.txt','package.json','start.bat','start.cmd','start.sh']);
app.use((req,res,next) => {
  const p = req.path.replace(/^\/+/, '');
  if (BLOCKED.has(p)) return res.status(403).send('Forbidden');
  next();
});

// API: files
app.get('/api/files', (req,res) => {
  fs.readdir(VIDEOS_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: 'Could not read videos directory' });
    const good = files.filter(f => !f.startsWith('.')).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ['.mp4','.mp3'].includes(ext);
    });
    res.json({ files: good });
  });
});

// API: admin required
app.get('/api/admin-required', (req,res) => {
  res.json({ adminRequired: !!(ADMIN_TOKEN && ADMIN_TOKEN.length > 0) });
});

// Serve index/admin
app.get('/', (req,res) => res.sendFile(path.join(ROOT,'public','index.html')));
app.get('/admin', (req,res) => res.sendFile(path.join(ROOT,'public','admin.html')));

// Server state
const videoState = {
  playlist: [],
  mainIndex: 0,
  currentTime: DEFAULT_START,
  isPlaying: false,
  lastUpdate: Date.now()
};

function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function safeFilename(name){
  if (!name || typeof name !== 'string') return false;
  if (name.includes('..') || path.isAbsolute(name)) return false;
  const target = path.join(VIDEOS_DIR, name);
  try {
    const resolved = path.resolve(target);
    return resolved.startsWith(path.resolve(VIDEOS_DIR));
  } catch(e){ return false; }
}

// Socket auth: mark socket.isAdmin if token matches
io.use((socket, next) => {
  const token = socket.handshake.query && socket.handshake.query.admin_token;
  socket.isAdmin = false;
  if (ADMIN_TOKEN && ADMIN_TOKEN.length > 0) {
    if (token && token === ADMIN_TOKEN) socket.isAdmin = true;
    else socket.isAdmin = false;
  } else {
    socket.isAdmin = false;
  }
  next();
});

io.on('connection', (socket) => {
  console.log('conn', socket.id, 'isAdmin=', socket.isAdmin);
  // emit state (with legacy playlist shape) and config
  const legacyPlaylist = {
    videos: videoState.playlist,
    mainVideoIndex: videoState.mainIndex,
    currentIndex: videoState.mainIndex,
    mainVideoStartTime: videoState.currentTime
  };
  const statePayload = {
    playlist: legacyPlaylist,
    playlistArray: videoState.playlist,
    mainIndex: videoState.mainIndex,
    currentTime: videoState.currentTime,
    isPlaying: videoState.isPlaying,
    serverTime: Date.now()
  };
  socket.emit('state', statePayload);

  socket.emit('config', {
    skipSeconds: SKIP_SECONDS,
    volumeStep: VOLUME_STEP,
    defaultVolume: DEFAULT_CLIENT_VOLUME
  });

  socket.on('request-files', () => {
    fs.readdir(VIDEOS_DIR, (err, files) => {
      if (err) return socket.emit('files', { files: [] });
      const good = files.filter(f => !f.startsWith('.')).filter(f => {
        const ext = path.extname(f).toLowerCase();
        return ['.mp4','.mp3'].includes(ext);
      });
      socket.emit('files', { files: good });
    });
  });

  socket.on('set-playlist', (data) => {
    if (!socket.isAdmin && ADMIN_TOKEN) { socket.emit('error','unauthorized'); return; }
    try {
      const playlist = Array.isArray(data.playlist) ? data.playlist : [];
      const mainIndex = parseInt(data.mainIndex || 0,10);
      const startTime = parseFloat(data.startTime || 0) || 0;
      const sanitized = playlist.map(p => ({ filename: p.filename })).filter(p => safeFilename(p.filename));
      if (sanitized.length === 0) { socket.emit('error','empty or invalid playlist'); return; }
      const mi = clamp(mainIndex, 0, sanitized.length-1);
      videoState.playlist = sanitized;
      videoState.mainIndex = mi;
      videoState.currentTime = startTime;
      videoState.isPlaying = false;
      videoState.lastUpdate = Date.now();
      // broadcast new state (compat)
      const legacy = {
        videos: videoState.playlist,
        mainVideoIndex: videoState.mainIndex,
        currentIndex: videoState.mainIndex,
        mainVideoStartTime: videoState.currentTime
      };
      const newState = {
        playlist: legacy,
        playlistArray: videoState.playlist,
        mainIndex: videoState.mainIndex,
        currentTime: videoState.currentTime,
        isPlaying: videoState.isPlaying,
        serverTime: Date.now()
      };
      io.emit('state', newState);
      socket.emit('ok','playlist set');
      socket.emit('playlist-set');
      io.emit('playlist-set');
    } catch(e) {
      socket.emit('error','invalid payload');
    }
  });

  // Compatibility: accept older 'control' events and forward to action handler
  socket.on('control', (data) => {
    if (!socket.isAdmin && ADMIN_TOKEN) { socket.emit('error','unauthorized'); return; }
    if (!data || !data.action) return;
    if (data.action === 'skip') {
      const seconds = parseFloat(data.seconds || SKIP_SECONDS) || SKIP_SECONDS;
      socket.emit('action', { action: 'skip', seconds: seconds });
    } else if (data.action === 'seek') {
      const t = parseFloat(data.time || data.seconds || 0) || 0;
      socket.emit('action', { action: 'seek', time: t });
    } else if (data.action === 'play') {
      socket.emit('action', { action: 'play' });
    } else if (data.action === 'pause') {
      socket.emit('action', { action: 'pause' });
    }
  });

  socket.on('action', (data) => {
    if (!socket.isAdmin && ADMIN_TOKEN) { socket.emit('error','unauthorized'); return; }
    if (!data || !data.action) return;
    const action = data.action;
    if (action === 'play') {
      videoState.isPlaying = true;
      videoState.lastUpdate = Date.now();
    } else if (action === 'pause') {
      if (videoState.isPlaying) {
        const now = Date.now();
        const elapsed = (now - videoState.lastUpdate) / 1000;
        videoState.currentTime += elapsed;
      }
      videoState.isPlaying = false;
      videoState.lastUpdate = Date.now();
    } else if (action === 'seek') {
      const t = parseFloat(data.time || 0) || 0;
      videoState.currentTime = Math.max(0, t);
      videoState.lastUpdate = Date.now();
    } else if (action === 'skip') {
      const s = parseFloat(data.seconds || SKIP_SECONDS) || SKIP_SECONDS;
      videoState.currentTime += s;
      videoState.lastUpdate = Date.now();
    } else if (action === 'rewind') {
      const s = parseFloat(data.seconds || SKIP_SECONDS) || SKIP_SECONDS;
      videoState.currentTime = Math.max(0, videoState.currentTime - s);
      videoState.lastUpdate = Date.now();
    } else if (action === 'setIndex') {
      const idx = parseInt(data.index || 0,10);
      if (Number.isFinite(idx) && videoState.playlist.length > 0) {
        videoState.mainIndex = clamp(idx, 0, videoState.playlist.length - 1);
        videoState.currentTime = 0;
        videoState.lastUpdate = Date.now();
      }
    } else if (action === 'setTime') {
      const t = parseFloat(data.time || 0) || 0;
      videoState.currentTime = Math.max(0, t);
      videoState.lastUpdate = Date.now();
    }
    // broadcast updated state
    const legacy2 = {
      videos: videoState.playlist,
      mainVideoIndex: videoState.mainIndex,
      currentIndex: videoState.mainIndex,
      mainVideoStartTime: videoState.currentTime
    };
    const state2 = {
      playlist: legacy2,
      playlistArray: videoState.playlist,
      mainIndex: videoState.mainIndex,
      currentTime: videoState.currentTime,
      isPlaying: videoState.isPlaying,
      serverTime: Date.now()
    };
    io.emit('state', state2);
  });

  socket.on('sync-request', () => {
    const legacy3 = {
      videos: videoState.playlist,
      mainVideoIndex: videoState.mainIndex,
      currentIndex: videoState.mainIndex,
      mainVideoStartTime: videoState.currentTime
    };
    const state3 = {
      playlist: legacy3,
      playlistArray: videoState.playlist,
      mainIndex: videoState.mainIndex,
      currentTime: videoState.currentTime,
      isPlaying: videoState.isPlaying,
      serverTime: Date.now()
    };
    socket.emit('state', state3);
  });

});

// Periodic sync update
setInterval(() => {
  if (videoState.isPlaying) {
    const now = Date.now();
    const elapsed = (now - videoState.lastUpdate) / 1000;
    videoState.currentTime += elapsed;
    videoState.lastUpdate = now;
  }
}, 5000);

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Videos dir: ${VIDEOS_DIR}`);
  if (ADMIN_TOKEN && ADMIN_TOKEN.length > 0) {
    console.log('Admin token configured.');
  } else {
    console.log('No admin token configured; admin actions unrestricted.');
  }
});
