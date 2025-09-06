My video Doesnt load what do i do?

Check if your video is using h.265 or hevc codecs. Chromium browsers don't support that(unless i sacrifice my soul and code it)  Best way to check for this is checking if the video includes subtitles or Dubs

My Router Does not support NAT loopback. What do i do?   (thank you @xdcoelite)

Edit your computer's hosts file to bypass the public IP.
Go to C:\Windows\System32\drivers\etc
Open the hosts file as Administrator.

Add this line at the bottom:
192.168.x.x yourdomain.ddns.net
(Replace 192.168.x.x with your PC's local IP and yourdomain.ddns.net with your public hostname)

Now, accessing yourdomain.ddns.net on that PC will connect locally instead of trying to use the public IP.

Please go to 
