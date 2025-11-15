@echo off
setlocal
set PORT=%PORT%
if not exist "%~dp0node.exe" (
  echo [错误] 未找到 node.exe，请将 node.exe 放到本文件同目录
  pause
  exit /b 1
)
"%~dp0node.exe" "%~dp0src\server.js"
pause