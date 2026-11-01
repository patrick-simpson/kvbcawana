@echo off
title Grand Welcome - look stills
cd /d "%~dp0"
call "%~dp0..\awana-intro\_find_blender.bat"
if not defined BLENDER (pause & exit /b 1)
echo.
echo  ===============================================================
echo   GRAND WELCOME - LOOK STILLS  (rough 3D pictures, about a minute)
echo   Blender opens and makes each still on screen, quickly.
echo   (For a slower look at each one, use Watch Grand Welcome Stills.)
echo   Close Blender when its top line says it is finished.
echo  ===============================================================
echo.
"%BLENDER%" --factory-startup -P "%~dp0stills.py" -- --watch --live 0.4 --show 0.4
echo.
echo  The pictures are in the "output\stills" folder:  contact-sheet.png
pause
