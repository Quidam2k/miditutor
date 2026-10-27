@echo off
rem #9926: put MidiTutor away. Ends the forge/Vite/Electron trees running from this folder; spares the
rem persona MCP server and the scan_pull loops. Same tool agents use (Q:\Pantheon\scripts\stop_project.py).
cd /d "%~dp0"
C:\Python311\python.exe Q:\Pantheon\scripts\stop_project.py "%~dp0." --only "electron-forge|vite" --keep "miditutor_mcp|scan_pull" --port 5181 --yes
pause
