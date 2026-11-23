@echo off
cd /d "%~dp0"
node sprig-runner.js --open
if errorlevel 1 pause
