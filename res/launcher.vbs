Set objShell = CreateObject("WScript.Shell")
strWTPath = objShell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe")
strConsoleScript = WScript.Arguments(0)
strCommand = """" & strWTPath & """ -w -1 nt --title ""Sync-Player"" powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & strConsoleScript & """"
objShell.Run strCommand, 1, False
