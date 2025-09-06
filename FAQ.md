**What's a main video?**  
Main videos are usually videos big in size or quality that tend to take long to download, select a video as main to make it preload while other small and optimized videos are playing.

**My video doesn't load. What do I do?**  
Check if your video uses H.265/HEVC codecs. Chromium browsers do not support this. A quick way to check is if the video includes subtitles or multiple audio dubs.
After, use either HandBrake or ffmpeg to convert your file to an mp4 encoded with H.264. Handbrake is the easy choice of two.

**Does the software collect any personal data?**           
No. This software does not transmit usage information, track the files you open, or send data to third parties. 

**My router doesn't support NAT loopback, I can't see the stream. What do I do?**  (thank you @xdcoelite)

Edit your computer’s `hosts` file:  
1. Go to `C:\Windows\System32\drivers\etc`  
2. Open `hosts` as Administrator.  
3. Add:  
   `192.168.x.x yourdomain.ddns.net`  
   (Replace with your PC’s local IP and your public hostname.)  

Now accessing `yourdomain.ddns.net` will connect locally.

Your Question isn't here? Then visit [Questions](https://github.com/Lakunake/Minecraft-WebDisplays-Video-Player/discussions/2) or email **johnwebdisplays@gmail.com**.
