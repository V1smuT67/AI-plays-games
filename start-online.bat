@echo off
cd /d "%~dp0"
powershell -NoProfile -Command "$exe = $null; $prefix = @(); if (Get-Command py -ErrorAction SilentlyContinue) { $exe = (Get-Command py).Source; $prefix = @('-3') } elseif (Get-Command python -ErrorAction SilentlyContinue) { $exe = (Get-Command python).Source }; if (-not $exe) { Write-Host 'Python 3.10+ is required'; exit 1 }; Start-Process -WindowStyle Hidden -FilePath $exe -WorkingDirectory (Get-Location).Path -ArgumentList ($prefix + @('server.py','--online','--port','0'))"
if errorlevel 1 pause
