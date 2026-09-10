@echo off
cd /d "%~dp0"
node short.js --dry-run %*
