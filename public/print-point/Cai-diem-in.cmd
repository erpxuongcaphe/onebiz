@echo off
cd /d "%~dp0"
echo ONEBIZ - Cai bo ket noi may in chi nhanh
powershell.exe -NoProfile -File "%~dp0setup.ps1"
if errorlevel 1 echo Chua hoan tat. Doc thong bao ben tren; khong can tai lai ma chi nhanh.
pause
