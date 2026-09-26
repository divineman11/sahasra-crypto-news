' Starts the news supervisor with no visible window; add --with-ui after supervisor.js to also run the web terminal
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "node.exe supervisor.js", 0, False