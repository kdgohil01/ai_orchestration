@echo off
cd /d "%~dp0"
node long.js --dry-run %*
