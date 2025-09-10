**It just... does not work?**

Open Command Prompt(CMD), and write these commands in order

```cmd
md (Your path to the code)
npm install express@5.1.0
npm install socket.io@4.8.1
```

**How do I properly use the admin panel?**
Open the admin panel on your default browser, chrome or safari for example, then launch your playlist, after you can freely watch the videos you want while using the admin panel through your default browser like a remote that overrides the other ones to ensure sync

**What's a main video?**  
Main videos are typically large or high-quality files that may take longer to load. Selecting one as the “main” video lets the player preload it in the background while smaller, faster videos are playing.

**My video doesn't load. What do I do?**  
Check if your video uses H.265/HEVC codecs. Chromium browsers do not support this. To check your file, you can use a tool like MediaInfo
 or check its properties in your OS. After, use either HandBrake or ffmpeg to convert your file to an mp4 encoded with H.264. Handbrake is the easy choice of two. Also check if your video file is renamed to filmeva.mp4 and is under the videos folder if you're on an older version of the software

**Can I use this outside of Minecraft and on normal browsers?**
Althought it is originally designed for the WebDisplays mod, it should have *ALMOST* no problems doing that.(Mod's custom browser lets me do some things general browsers wont allow)

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

⚠️ Editing your hosts file can affect how your system resolves domains. Only make changes if you’re comfortable, and double-check the entries.

Your Question isn't here? Then visit [Questions](https://github.com/Lakunake/Minecraft-WebDisplays-Video-Player/discussions/2) or email **johnwebdisplays [at] gmail [dot] com**.
