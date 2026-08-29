Set FSO = CreateObject("Scripting.FileSystemObject")
Set Shell = CreateObject("WScript.Shell")
ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
Shell.Run "cmd.exe /c """ & ScriptDir & "\run-agent.bat""", 0, False
