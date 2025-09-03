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

// Store the current video state globally
let videoState = {
  isPlaying: true,
  currentTime: START_TIME,
  lastUpdate: Date.now()
};

// Socket.io handling - FIXED SYNCHRONIZATION
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Send current state to new client
  socket.emit('sync', videoState);
  // Send config values to client
  socket.emit('config', {
    skipSeconds: SKIP_SECONDS,
    volumeStep: VOLUME_STEP / 100 // Convert percentage to decimal
  });
  
  // Listen for control events from clients
  socket.on('control', (data) => {
    // Update the global state
    videoState = {
      isPlaying: data.isPlaying,
      currentTime: data.currentTime,
      lastUpdate: Date.now()
    };
    
    // Broadcast to ALL clients including the sender
    io.emit('sync', videoState);
    console.log('Broadcasting sync to all clients:', videoState);
  });

  // Time synchronization
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

// Server listening on port 3000
server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
