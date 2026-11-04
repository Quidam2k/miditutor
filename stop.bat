@echo off
rem #9926: put MidiTutor away. Ends the forge/Vite/Electron trees running from this folder; spares the
rem persona MCP server and the scan_pull loops. Same tool agents use (set STOP_PROJECT_PY, e.g. in scripts\local.bat).
cd /d "%~dp0"
if exist "%~dp0scripts\local.bat" call "%~dp0scripts\local.bat"
"%STOP_PY%" "%STOP_PROJECT_PY%" "%~dp0." --only "electron-forge|vite" --keep "miditutor_mcp|scan_pull" --port 5181 --yes
pause
