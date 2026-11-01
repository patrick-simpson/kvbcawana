@echo off
title Grand Welcome - watch the stills being made
cd /d "%~dp0"
call "%~dp0..\awana-intro\_find_blender.bat"
if not defined BLENDER (pause & exit /b 1)
echo.
echo  ===============================================================
echo   GRAND WELCOME - WATCH IT WORK  (2 to 3 minutes)
echo   Blender opens full-screen and builds each still in front of you.
echo   Leave this black window open; close Blender when it says done.
echo  ===============================================================
echo.
"%BLENDER%" --factory-startup -P "%~dp0stills.py" -- --watch
