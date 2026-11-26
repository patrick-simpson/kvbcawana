@echo off
rem Finds blender.exe and stores it in the BLENDER variable. Used by the other .bat files.
set "BLENDER="
if exist "%ProgramFiles%\Blender Foundation\Blender 5.2\blender.exe" set "BLENDER=%ProgramFiles%\Blender Foundation\Blender 5.2\blender.exe"
if not defined BLENDER for /d %%D in ("%ProgramFiles%\Blender Foundation\Blender 5.*") do if exist "%%D\blender.exe" set "BLENDER=%%D\blender.exe"
if not defined BLENDER if exist "%ProgramFiles(x86)%\Steam\steamapps\common\Blender\blender.exe" set "BLENDER=%ProgramFiles(x86)%\Steam\steamapps\common\Blender\blender.exe"
if not defined BLENDER for /f "delims=" %%B in ('where blender 2^>nul') do if not defined BLENDER set "BLENDER=%%B"
if not defined BLENDER (
  echo.
  echo  Couldn't find Blender 5.2 on this computer.
  echo  Open this .bat file in Notepad and paste the full path to blender.exe on the line below, e.g.
  echo    set "BLENDER=D:\Apps\Blender 5.2\blender.exe"
  echo.
  rem set "BLENDER=PASTE\PATH\TO\blender.exe"
)
