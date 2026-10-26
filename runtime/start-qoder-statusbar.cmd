@echo off
rem 启动 Qoder 桌面端（带 CDP 调试端口）并拉起用量条注入器
rem 桌面快捷方式走 launch-hidden.vbs（隐藏窗口），输出重定向到 logs\launcher.log
setlocal
cd /d "%~dp0"

rem ELECTRON_RUN_AS_NODE=1 会让 Qoder.exe 把自己当成 node 跑，必须清掉
set ELECTRON_RUN_AS_NODE=

where node >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\tools\node\node.exe" (
    set "NODE=%USERPROFILE%\tools\node\node.exe"
  ) else (
    echo node not found in PATH.
    exit /b 1
  )
) else (
  set "NODE=node"
)

"%NODE%" launcher.mjs
exit /b %ERRORLEVEL%
