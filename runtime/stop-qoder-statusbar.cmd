@echo off
rem 结束用量条注入器（不影响 Qoder 本身）
setlocal
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
node launcher.mjs --stop
pause
endlocal
