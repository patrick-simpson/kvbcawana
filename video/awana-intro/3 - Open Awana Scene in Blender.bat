@echo off
title Awana Intro - open the 3D scene
cd /d "%~dp0"
call "%~dp0_find_blender.bat"
if not defined BLENDER (pause & exit /b 1)
echo  Building the scene (a few seconds)...
"%BLENDER%" --factory-startup -b -P "%~dp0awana_intro.py" -- --mode build
start "" "%BLENDER%" "%~dp0output\Awana Intro.blend"
