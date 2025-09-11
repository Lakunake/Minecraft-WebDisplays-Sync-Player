const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Read and parse config file
function readConfig() {
  const configPath = path.join(__dirname, 'config.txt');
  const configData = fs.readFileSync(configPath, 'utf8');
  const config = {};
  
  configData.split('\n').forEach(line => {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      const [key, value] = line.split(':').map(part => part.trim());
      config[key] = value;
    }
  });
  
  return config;
}

const config = readConfig();

// Use config values
const PORT = parseInt(config.port) || 3000;
const SKIP_SECONDS = parseInt(config.skip_seconds) || 5;
const VOLUME_STEP = parseInt(config.volume_step) || 5;
const START_TIME = parseInt(config.start_time) || 1;

// Serve static and video files
app.use(express.static(__dirname));
app.use('/videos', express.static(path.join(__dirname, 'videos')));

// Playlist state
const PLAYLIST = {
  videos: [],
  currentIndex: 0,
  mainVideoIndex: -1,
  mainVideoStartTime: 0,
  preloadMainVideo: false
};

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// API endpoint to get available files
app.get('/api/files', (req, res) => {
  const videosPath = path.join(__dirname, 'videos');
  
  fs.readdir(videosPath, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Unable to read videos directory' });
    }
    
    // Filter for video and audio files
    const mediaFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.mp4', '.mp3', '.avi', '.mov', '.wmv', '.mkv', '.webm'].includes(ext);
    });
    
    res.json(mediaFiles);
  });
});

// Store the current video state globally
let videoState = {
  isPlaying: true,
  currentTime: START_TIME,
  lastUpdate: Date.now()
};

// Socket.io handling
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Send current state to new client
  socket.emit('sync', videoState);
  // Send config values to client
  socket.emit('config', {
    skipSeconds: SKIP_SECONDS,
    volumeStep: VOLUME_STEP / 100
  });
  // Send playlist to client
  socket.emit('playlist-update', PLAYLIST);
  
  // Listen for control events from clients
  socket.on('control', (data) => {
    if (data.action) {
      // Handle admin remote control actions
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
      }
    } else {
      // Handle regular client control events
      videoState = {
        isPlaying: data.isPlaying,
        currentTime: data.currentTime,
        lastUpdate: Date.now()
      };
      io.emit('sync', videoState);
      console.log('Broadcasting sync to all clients:', videoState);
    }
  });

   // New event for setting the playlist
  socket.on('set-playlist', (data) => {
    console.log('Received playlist data:', data);
    
    PLAYLIST.videos = data.playlist;
    PLAYLIST.mainVideoIndex = data.mainVideoIndex;
    PLAYLIST.mainVideoStartTime = data.startTime;
    PLAYLIST.currentIndex = 0;
    PLAYLIST.preloadMainVideo = true;
    
    // Debug output
    console.log('Playlist updated:');
    console.log('- Total videos:', PLAYLIST.videos.length);
    console.log('- Main video index:', PLAYLIST.mainVideoIndex);
    if (PLAYLIST.mainVideoIndex >= 0 && PLAYLIST.videos.length > PLAYLIST.mainVideoIndex) {
      console.log('- Main video:', PLAYLIST.videos[PLAYLIST.mainVideoIndex].filename);
    } else {
      console.log('- No main video selected');
    }
    console.log('- Start time:', PLAYLIST.mainVideoStartTime);
    
    // Notify all clients about the new playlist
    io.emit('playlist-update', PLAYLIST);
    
    // Send confirmation to admin
    socket.emit('playlist-set');
  }); 

  // New event for getting config (for admin)
  socket.on('get-config', () => {
    socket.emit('config', {
      skipSeconds: SKIP_SECONDS,
      volumeStep: VOLUME_STEP / 100
    });
  });

  // New event for moving to the next video in the playlist
  socket.on('playlist-next', (nextIndex) => {
    PLAYLIST.currentIndex = nextIndex;
    io.emit('playlist-position', nextIndex);
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

// Server listening
server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
