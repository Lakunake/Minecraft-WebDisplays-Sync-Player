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

// Socket.io handling
io.on('connection', (socket) => {
  console.log(`${colors.cyan}A user connected: ${socket.id}${colors.reset}`);

  const currentTracks = getCurrentTrackSelections();
  videoState.audioTrack = currentTracks.audioTrack;
  videoState.subtitleTrack = currentTracks.subtitleTrack;

  // Send config values to client
  socket.emit('config', {
    skipSeconds: SKIP_SECONDS,
    volumeStep: VOLUME_STEP / 100
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

    socket.emit('playlist-set', {
      success: true,
      message: 'Playlist launched successfully!'
    });
  });

  // Get config (for admin)
  socket.on('get-config', () => {
    socket.emit('config', {
      skipSeconds: SKIP_SECONDS,
      volumeStep: VOLUME_STEP / 100
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

  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});

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
