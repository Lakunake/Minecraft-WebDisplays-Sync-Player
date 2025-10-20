const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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
          const [key, value] = line.split(':').map(part => part.trim());
          if (key && value) config[key] = value;
        }
      });
      
      return config;
    }
  } catch (error) {
    console.error('Error reading config file:', error);
  }
  
  // Return default config if file doesn't exist or is invalid
  return {
    port: '3000',
    volume_step: '5',
    skip_seconds: '5'
  };
}

const config = readConfig();

// Use config values
const PORT = parseInt(config.port) || 3000;
const SKIP_SECONDS = parseInt(config.skip_seconds) || 5;
const VOLUME_STEP = parseInt(config.volume_step) || 5;

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

// Store the current video state globally
let videoState = {
  isPlaying: true,
  currentTime: 0,
  lastUpdate: Date.now(),
  audioTrack: 0,
  subtitleTrack: -1
};

// Function to get current track selections from playlist
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

// Function to get track information for a file using ffprobe
async function getTracksForFile(filename) {
  const filePath = path.join(__dirname, 'videos', filename);
  const tracks = {
    audio: [],
    subtitles: []
  };

  return new Promise((resolve) => {
    // Use ffprobe to extract track information
    const command = `ffprobe -v quiet -print_format json -show_streams "${filePath}"`;
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('Error running ffprobe:', error);
        resolve(tracks); // Return empty tracks if ffprobe fails
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
        resolve(tracks); // Return empty tracks if parsing fails
      }
    });
  });
}


// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// API endpoint to get available files
app.get('/api/files', (req, res) => {
  const videosPath = path.join(__dirname, 'videos');
  
  fs.readdir(videosPath, async (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Unable to read videos directory' });
    }
    
    // Filter for video files
    const mediaFiles = [];
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (['.mp4', '.mp3', '.avi', '.mov', '.wmv', '.mkv', '.webm'].includes(ext)) {
        // For simplicity, we'll assume all MKV files work with HEVC extensions
        const usesHEVC = ext === '.mkv';
        mediaFiles.push({
          filename: file,
          usesHEVC: usesHEVC
        });
      }
    }
    
    res.json(mediaFiles);
  });
});

// API endpoint to get track information for files
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
  console.log('A user connected:', socket.id);

  // Get current track selections from playlist
  const currentTracks = getCurrentTrackSelections();
  videoState.audioTrack = currentTracks.audioTrack;
  videoState.subtitleTrack = currentTracks.subtitleTrack;
  
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
      // Handle regular client control events
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

  // New event for setting the playlist
  socket.on('set-playlist', async (data) => {
    console.log('Received playlist data:', data);
    console.log('Track selections in received data:');
    data.playlist.forEach((item, index) => {
      if (item.selectedAudioTrack !== undefined || item.selectedSubtitleTrack !== undefined) {
        console.log(`  Video ${index} (${item.filename}): audio=${item.selectedAudioTrack}, subtitle=${item.selectedSubtitleTrack}`);
      }
    });
    
    // Process each video to get track information
    const processedPlaylist = [];
    
    for (const item of data.playlist) {
      const videoInfo = { ...item };
      
      // For all video files, get track information
      try {
        const tracks = await getTracksForFile(item.filename);
        videoInfo.tracks = tracks;
      } catch (error) {
        console.error('Error getting track info:', error);
        videoInfo.tracks = { audio: [], subtitles: [] };
      }
      
      // Preserve user's track selections if they exist
      if (item.selectedAudioTrack !== undefined) {
        videoInfo.selectedAudioTrack = item.selectedAudioTrack;
      }
      if (item.selectedSubtitleTrack !== undefined) {
        videoInfo.selectedSubtitleTrack = item.selectedSubtitleTrack;
      }
      
      // Assume HEVC works with user extensions (mainly for MKV)
      videoInfo.usesHEVC = item.filename.endsWith('.mkv');
      
      processedPlaylist.push(videoInfo);
    }
    
    PLAYLIST.videos = processedPlaylist;
    PLAYLIST.mainVideoIndex = data.mainVideoIndex;
    PLAYLIST.mainVideoStartTime = data.startTime;
    PLAYLIST.currentIndex = 0;
    PLAYLIST.preloadMainVideo = true;
    
    // Update videoState with the first video's track selections
    const currentTracks = getCurrentTrackSelections();
    videoState.audioTrack = currentTracks.audioTrack;
    videoState.subtitleTrack = currentTracks.subtitleTrack;
    videoState.lastUpdate = Date.now();
    
    // Debug output
    console.log('Playlist updated:');
    console.log('- Total videos:', PLAYLIST.videos.length);
    console.log('- Main video index:', PLAYLIST.mainVideoIndex);
    if (PLAYLIST.mainVideoIndex >= 0 && PLAYLIST.videos.length > PLAYLIST.mainVideoIndex) {
      console.log('- Main video:', PLAYLIST.videos[PLAYLIST.mainVideoIndex].filename);
    } else {
      console.log('- No main video selected, will start with first video');
    }
    console.log('- Start time:', PLAYLIST.mainVideoStartTime);
    console.log('- Audio track:', videoState.audioTrack);
    console.log('- Subtitle track:', videoState.subtitleTrack);
    
    // Notify all clients about the new playlist
    io.emit('playlist-update', PLAYLIST);
    
    // Send confirmation to admin
    socket.emit('playlist-set', { 
      success: true,
      message: 'Playlist launched successfully!' 
    });
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
    
    // Update videoState with the new video's track selections
    const currentTracks = getCurrentTrackSelections();
    videoState.audioTrack = currentTracks.audioTrack;
    videoState.subtitleTrack = currentTracks.subtitleTrack;
    videoState.lastUpdate = Date.now();
    
    // Broadcast updated state to all clients
    io.emit('sync', videoState);
    io.emit('playlist-position', nextIndex);
  });

  // Handle track selection changes from admin
  socket.on('track-change', (data) => {
    console.log('Track change received:', data);
    
    // Validate the data
    if (!data.videoIndex && data.videoIndex !== 0) {
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
    
    // Update the playlist with the new track selection
    if (PLAYLIST.videos.length > data.videoIndex) {
      const video = PLAYLIST.videos[data.videoIndex];
      
      if (data.type === 'audio') {
        video.selectedAudioTrack = data.trackIndex;
      } else if (data.type === 'subtitle') {
        video.selectedSubtitleTrack = data.trackIndex;
      }
      
      // Update videoState if this is the currently playing video
      if (data.videoIndex === PLAYLIST.currentIndex) {
        if (data.type === 'audio') {
          videoState.audioTrack = data.trackIndex;
        } else if (data.type === 'subtitle') {
          videoState.subtitleTrack = data.trackIndex;
        }
        videoState.lastUpdate = Date.now();
        
        // Broadcast updated state to all clients
        io.emit('sync', videoState);
      }
      
      console.log(`Updated ${data.type} track for video ${data.videoIndex} to track ${data.trackIndex}`);
      
      // Broadcast the track change to all clients
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

// Error handling for server
server.on('error', (error) => {
  console.error('Server error:', error);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  clearInterval(syncInterval);
  server.close(() => {
    console.log('Server stopped');
    process.exit(0);
  });
});

// Server listening
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Admin panel available at http://localhost:${PORT}/admin`);
});
