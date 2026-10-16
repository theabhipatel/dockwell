@echo off
rem Windows launcher for scripts\dev.ps1 (bypasses PowerShell's script execution policy for this run only).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*
