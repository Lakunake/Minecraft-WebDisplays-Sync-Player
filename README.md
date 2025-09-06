# WebDisplays-Video-Player

A FULLY synchronized HTML5 video player for Minecraft's WebDisplays mod using Node.js and Socket.IO. This project allows all players to view the same video in perfect sync—including play, pause, and seek actions—across connected clients.

> Frequently Asked Questions: [FAQ](FAQ.md)

---

## 🚀 Requirements

* [Node.js](https://nodejs.org/) installed on your machine (v16+ recommended)
* [ffmpeg](https://ffmpeg.org/) installed for high bitrate support and video optimization
* Media files placed in the `/videos/` folder (supports MP4, MP3, AVI, MOV, WMV, MKV, WEBM)

---

## 🎮 Features

* 📺 Multi-format streaming (MP4, MP3)            ⚠️ NO H.265 AND HEVC CODECS
* ✨ High Quality streaming with FFmpeg optimization
* 🎵 Playlist support with sequential playback
* 👨‍💼 Admin control panel for remote management
* 🔁 Real-time playback synchronization using Socket.IO
* ⚙️ Lightweight Node.js + Express server
* 🖱️ Custom video control zones (click-based)
* 🔄 Automatic video preloading for smooth transitions

---

## 🕹️ Controls

### Client Controls (Touch/Click Interface):
| Zone                                   | Action                   | Sync Behavior |
| -------------------------------------- | ------------------------ | ------------- |
| **Left Edge (≤ 87px)**                 | ⏪ Rewind 5 seconds       | ✅ Synced      |
| **Right Edge (≥ screen width − 87px)** | ⏩ Skip forward 5 seconds | ✅ Synced      |
| **Center (±75px from center)**         | ⎯️ Toggle Play / Pause   | ✅ Synced      |
| **Between Left Edge and Center**       | 🔈 Decrease volume (5%)  | ❌ Local only  |
| **Between Center and Right Edge**      | 🔊 Increase volume (5%)  | ❌ Local only  |

### Admin Controls (Web Interface):
- 📋 Playlist creation and management
- 🎬 Remote play/pause/skip/seek controls to eliminate desync
- ⭐ Main video selection with custom start time
- 📊 File browser for media management

> ⚠️ All users will see the same video at the same time except for **volume**, which is controlled individually per client.

---

## 🌐 Hosting Tutorials

> ⚠️ All commands are run from Command Prompt (CMD).
> Ensure [Node.js](https://nodejs.org/) is installed before proceeding.

### 🔌 Option 1: LAN or Public IP (Direct Hosting), Best for Many people and Repeated users, complex setup

1. Run `start.bat` in your folder
2. Make sure your selected port is open in your firewall/router
3. Access the video player from devices at the provided links
4. Access admin panel at `http://your-ip:port/admin`

### 🌍 Option 2: Hamachi (Virtual LAN), Basic to setup. Hard if your friends know nothing about computers.

1. Download and install [LogMeIn Hamachi](https://vpn.net)
2. Create a network, have others join it
3. Share your **Hamachi IP address** (shown in Hamachi)
4. Run `start.bat`, then visit the provided network link

### 🚀 Option 3: Cloud Hosting (Render, Heroku, etc.) ⚠️NOT RECOMMENDED!!!

1. Fork the repository: [https://github.com/Lakunake/Minecraft-WebDisplays-Video-Player](https://github.com/Lakunake/Minecraft-WebDisplays-Video-Player)
2. Connect your repository to your hosting service
3. Set build command: `npm install`
4. Set start command: `node server.js`
5. Deploy and access your video player via the provided URL

> Congratulations if you managed to deploy it successfully using Cloud Hosting...
---

## 📁 File Structure

```
/videos/                 # Folder containing media files
server.js               # Node.js backend with Socket.IO
index.html              # Client video player interface
admin.html              # Admin control panel
package.json            # Node.js dependencies and scripts
start.bat               # Windows startup script
config.txt              # Configuration file (port, settings, etc.)
```

---

## ⚙️ Configuration

Edit `config.txt` to customize:

```ini
max_clients: 10         # Amount of Expected Simultaneous clients
chunk_size: 10          # Video chunk size in MB
port: 3000              # Server port
volume_step: 5          # Volume adjustment percentage
skip_seconds: 5         # Skip duration in seconds
```

---

## 📜 License

**Short name**: `CC BY-NC-SA 4.0`
**URL**: [https://creativecommons.org/licenses/by-nc-sa/4.0/](https://creativecommons.org/licenses/by-nc-sa/4.0/)

This project is licensed under **CC BY-NC-SA 4.0**:

* ✅ Free to use and modify
* 🔗 Must credit the original creator (**Lakunake**)
* ❌ Commercial use is **not allowed**
* ♻️ Must share any changes with the same license **if distributed or hosted publicly**

See [LICENSE](LICENSE) for more details.

---

## 🙏 Credits

Created by **Lakunake**
Built with ❤️ using Node.js, Express, and Socket.IO
Contact: johnwebdisplays [at] gmail [dot] com        (Obviously not my real name)
