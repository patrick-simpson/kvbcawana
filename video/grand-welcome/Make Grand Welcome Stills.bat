@echo off
title Grand Welcome - look stills
cd /d "%~dp0"
call "%~dp0..\awana-intro\_find_blender.bat"
if not defined BLENDER (pause & exit /b 1)
echo.
echo  ===============================================================
echo   GRAND WELCOME - LOOK STILLS  (rough 3D pictures, a few minutes)
echo   15 stills + one contact sheet, for choosing the film's look.
echo  ===============================================================
echo.
"%BLENDER%" --factory-startup -b -P "%~dp0stills.py" -- --redo
echo.
echo  Done! The pictures are in the "output\stills" folder:  contact-sheet.png
start "" "%~dp0output\stills"
pause
