@echo off
title Awana Intro - FULL QUALITY render
cd /d "%~dp0"
call "%~dp0_find_blender.bat"
if not defined BLENDER (pause & exit /b 1)
echo.
echo  ===============================================================
echo   AWANA INTRO - FULL QUALITY 1080p  (about 2 to 5 hours) 
echo.
echo   * Plug the laptop in and set it to never sleep while plugged in
echo     (Settings ^> System ^> Power ^> Screen and sleep).
echo   * Interrupted? Just double-click this file again - it picks up
echo     where it left off. Finished frames are never re-rendered.
echo   * To start completely over, delete the output\frames_final folder.
echo  ===============================================================
echo.
"%BLENDER%" --factory-startup -b -P "%~dp0awana_intro.py" -- --mode final
echo.
echo  Done! Your video is in the "output" folder:  Awana Intro.mp4
start "" "%~dp0output"
pause
