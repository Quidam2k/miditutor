@echo off
rem MIDI import sweep (#4046 d): every 15 minutes, convert any .mid dropped in
rem the library's midi-in folder, Pinocchio's "MidiTutor Pieces\MIDI drop" or a phone
rem upload, and push the score to Pinocchio. pythonw: no window. Empty inboxes cost a few ms.
for %%I in ("%~dp0..") do set "REPO=%%~fI"
schtasks /create /tn "MidiTutorMidiImport" /sc MINUTE /mo 15 /tr "\"%REPO%\.venv\Scripts\pythonw.exe\" \"%REPO%\scripts\midi_to_score.py\" sweep" /f
schtasks /query /tn "MidiTutorMidiImport"
