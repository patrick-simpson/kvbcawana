@echo off
title Awana Intro - quick preview
cd /d "%~dp0"
call "%~dp0_find_blender.bat"
if not defined BLENDER (pause & exit /b 1)
echo.
echo  ===============================================================
echo   AWANA INTRO - QUICK PREVIEW  (small, rough, about 10 minutes)
echo   This is just to check the timing. Grainy is normal here.
echo  ===============================================================
echo.
"%BLENDER%" --factory-startup -b -P "%~dp0awana_intro.py" -- --mode preview
echo.
echo  Done! Your preview is in the "output" folder:  Awana Intro - PREVIEW.mp4
start "" "%~dp0output"
pause
