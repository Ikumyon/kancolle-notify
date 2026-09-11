@echo off
cd /d "%~dp0"
daemon\target\release\kancolle-daemon.exe start
pause
