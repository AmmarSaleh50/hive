# Puts a shortcut on your desktop that runs one of your routines (see "Resume and routines" in the README).
#   powershell -ExecutionPolicy Bypass -File scripts\shortcut-windows.ps1 -Routine Work                      # "Work" on the desktop
#   powershell -ExecutionPolicy Bypass -File scripts\shortcut-windows.ps1 -Routine Work -Name "Start work"   # pick its name
#   powershell -ExecutionPolicy Bypass -File scripts\shortcut-windows.ps1 -Routine Work -Remove              # remove it again
param([Parameter(Mandatory)][string]$Routine, [string]$Name = $Routine, [switch]$Remove)

$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) "$Name.lnk"
if ($Remove) {
  if (Test-Path $lnk) { Remove-Item $lnk; "Removed $lnk." } else { "There is no $lnk." }
  return
}

$root = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node -ErrorAction Stop).Source
& $node (Join-Path $root 'server.cjs') --routine $Routine --dry-run
if ($LASTEXITCODE -ne 0) { "Fix the routine in hive.config.json first."; return }

# Hive's mark as the icon: an .ico file can simply wrap a PNG.
$png = [IO.File]::ReadAllBytes((Join-Path $root 'docs\brand\raster\mark-256.png'))
$ico = Join-Path $root 'data\hive.ico'
New-Item -ItemType Directory -Force (Split-Path $ico) | Out-Null
$head = [byte[]](0,0,1,0,1,0, 0,0,0,0,1,0,32,0) + [BitConverter]::GetBytes([int]$png.Length) + [BitConverter]::GetBytes([int]22)
[IO.File]::WriteAllBytes($ico, $head + $png)

$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = $node
$s.Arguments = "`"$(Join-Path $root 'server.cjs')`" --routine `"$Routine`""
$s.WorkingDirectory = $root
$s.WindowStyle = 7 # minimized: the routine shows its progress in Hive
$s.IconLocation = $ico
$s.Description = "Runs the Hive routine `"$Routine`""
$s.Save()
"Made $lnk"
