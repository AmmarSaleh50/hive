# Starts Hive hidden every time you sign in to Windows, by putting a small script in your Startup folder.
#   powershell -ExecutionPolicy Bypass -File scripts\autostart-windows.ps1           # install and start now
#   powershell -ExecutionPolicy Bypass -File scripts\autostart-windows.ps1 -Remove   # remove it again
param([switch]$Remove)

$startup = [Environment]::GetFolderPath('Startup')
$vbs = Join-Path $startup 'Hive.vbs'

if ($Remove) {
  if (Test-Path $vbs) { Remove-Item $vbs; "Removed $vbs. Hive no longer starts when you sign in." } else { 'Hive was not set to start automatically.' }
  return
}

$node = (Get-Command node -ErrorAction Stop).Source
$server = Join-Path (Split-Path $PSScriptRoot -Parent) 'server.cjs'
@"
' Starts Hive (http://localhost:4747) hidden when you sign in. Delete this file to stop that.
CreateObject("WScript.Shell").Run """$node"" ""$server""", 0, False
"@ | Set-Content -Encoding ASCII $vbs
Start-Process wscript.exe -ArgumentList "`"$vbs`""
"Installed $vbs and started Hive. Open http://localhost:4747"
