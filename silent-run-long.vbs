Set WshShell = CreateObject("WScript.Shell")
' Launch the long-form Node script with window style 0 (completely hidden)
WshShell.Run "node long-form.js", 0, True