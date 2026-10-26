@echo off
rem Start Qoder with the CDP debug port, then start the background injector.
rem Usually invoked by launch-hidden.vbs (desktop shortcut); output goes to logs\launcher.log.
rem ASCII only: this file is stored as GBK for cmd.exe, keep it free of non-ASCII.
setlocal
cd /d "%~dp0"

rem ELECTRON_RUN_AS_NODE=1 makes Qoder.exe behave like node, which breaks the client.
set ELECTRON_RUN_AS_NODE=

set "NODE="
where node >nul 2>nul
if not errorlevel 1 set "NODE=node"

if not defined NODE if exist "%USERPROFILE%\tools\node\node.exe" set "NODE=%USERPROFILE%\tools\node\node.exe"

rem The runtime needs Node 18+ (global fetch). Older Node falls through to the bundled one.
if defined NODE (
  "%NODE%" -e "process.exit((+process.versions.node.split('.')[0])>=18?0:1)" >nul 2>nul
  if errorlevel 1 set "NODE="
)

rem Node-less machines: the installer drops a hard link to Qoder.exe here named node.exe,
rem together with icudtl.dat / v8_context_snapshot.bin. ELECTRON_RUN_AS_NODE turns it
rem into a real Node runtime (v24), so nothing else needs to be installed.
if not defined NODE if exist "%~dp0node.exe" (
  set "NODE=%~dp0node.exe"
  set "ELECTRON_RUN_AS_NODE=1"
)

rem Last resort: Qoder.exe itself as node.
if not defined NODE (
  set "QODER=%LOCALAPPDATA%\Programs\Qoder\Qoder.exe"
  if exist "%~dp0qoder-path.txt" set /p QODER=<"%~dp0qoder-path.txt"
  if exist "%QODER%" (
    set "NODE=%QODER%"
    set "ELECTRON_RUN_AS_NODE=1"
  )
)

if not defined NODE (
  echo Neither node.exe nor Qoder.exe was found.
  exit /b 1
)

"%NODE%" launcher.mjs
exit /b %ERRORLEVEL%
