@echo off
title Grand Welcome - rough preview of the film
cd /d "%~dp0"
call "%~dp0..\awana-intro\_find_blender.bat"
if not defined BLENDER (pause & exit /b 1)
echo.
echo  ===============================================================
echo   GRAND WELCOME - ROUGH PREVIEW  (20 seconds, about 10 minutes)
echo   Blender opens and renders every frame where you can see it,
echo   then makes the video:  output\Grand Welcome - PREVIEW.mp4
echo   Close Blender when its top line says it is finished.
echo  ===============================================================
echo.
"%BLENDER%" --factory-startup -P "%~dp0grand_welcome.py"
echo.
echo  The video is in the "output" folder:  Grand Welcome - PREVIEW.mp4
pause
