Set objShell = CreateObject("WScript.Shell")
strConsoleScript = WScript.Arguments(0)
strCommand = "wt.exe -w -1 nt --title ""Sync-Player"" powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & strConsoleScript & """"
objShell.Run strCommand, 1, False
