@echo off
setlocal
set PORT=3000
node "%~dp0src\server.js"
pause