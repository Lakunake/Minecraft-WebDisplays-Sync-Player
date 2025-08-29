const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static and video files
app.use(express.static(__dirname));
app.use('/videos', express.static(path.join(__dirname, 'videos')));

// Store the current video state globally
let videoState = {
  isPlaying: true,
  currentTime: 1,
  lastUpdate: Date.now()
};

// Socket.io handling - FIXED SYNCHRONIZATION
io.on('connection', (socket) => {
  console.log('A user connected');

  // Send current state to new client
  socket.emit('sync', videoState);
  
  // Listen for control events from clients
  socket.on('control', (data) => {
    // Update the global state
    videoState = {
      isPlaying: data.isPlaying,
      currentTime: data.currentTime,
      lastUpdate: Date.now()
    };
    
    // Broadcast to all other clients except the sender
    socket.broadcast.emit('sync', videoState);
  });

  // Time synchronization
  const syncInterval = setInterval(() => {
    if (videoState.isPlaying) {
      const now = Date.now();
      const elapsed = (now - videoState.lastUpdate) / 1000;
      videoState.currentTime += elapsed;
      videoState.lastUpdate = now;
    }
  }, 5000);

  socket.on('disconnect', () => {
    console.log('A user disconnected');
    clearInterval(syncInterval);
  });
});

// Server listening on port 3000
const PORT = 3000;
server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
