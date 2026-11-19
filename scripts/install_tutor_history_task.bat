@echo off
rem Tutor practice history (#5853): every 30 minutes, copy anything new in the tutor's day logs
rem on Pinocchio (read-only over ssh: wc and tail only) into the Pantheon folder's data\tutor_history
rem and refresh the session summaries. pythonw: no window. Every run appends a line to pull.log in
rem that folder ("pulled ...", "nothing new" or "unreachable: ...").
rem The tutor_history MCP tool also pulls on each call, so this only keeps it fresh in between.
for %%I in ("%~dp0..") do set "REPO=%%~fI"
schtasks /create /tn "MidiTutorTutorHistory" /sc MINUTE /mo 30 /tr "\"%REPO%\.venv\Scripts\pythonw.exe\" \"%REPO%\scripts\tutor_history.py\" pull" /f
schtasks /query /tn "MidiTutorTutorHistory"
