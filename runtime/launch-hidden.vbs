' Launch the Qoder status bar with a hidden window (used by the desktop shortcut).
' On failure a message box points to the log file.
' ASCII only: VBScript reads .vbs as ANSI, so keep this file free of non-ASCII.
Option Explicit
Dim sh, rc, fso, base, logf, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
logf = base & "\logs\launcher.log"
cmd = "cmd /c ""cd /d """ & base & """ && start-qoder-statusbar.cmd > """ & logf & """ 2>&1"""
rc = sh.Run(cmd, 0, True)
If rc <> 0 Then
  MsgBox "Qoder statusbar failed to start." & vbCrLf & vbCrLf & "See:" & vbCrLf & logf, 48, "Qoder statusbar"
End If
