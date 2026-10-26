@echo off
rem MIDI import sweep (#4046 d): every 15 minutes, convert any .mid dropped in
rem Q:\Personal\piano\library\midi-in, Pinocchio's "MidiTutor Pieces\MIDI drop" or a phone
rem upload, and push the score to Pinocchio. pythonw: no window. Empty inboxes cost a few ms.
schtasks /create /tn "MidiTutorMidiImport" /sc MINUTE /mo 15 /tr "\"Q:\Development\miditutor\.venv\Scripts\pythonw.exe\" \"Q:\Development\miditutor\scripts\midi_to_score.py\" sweep" /f
schtasks /query /tn "MidiTutorMidiImport"
