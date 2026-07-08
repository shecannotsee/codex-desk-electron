$ErrorActionPreference = 'Stop'

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartScript = Join-Path $ProjectDir 'start.ps1'

if (!(Test-Path -LiteralPath $StartScript -PathType Leaf)) {
  Write-Error "start.ps1 not found: $StartScript"
  exit 1
}

$Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`""
Start-Process -FilePath 'powershell.exe' `
  -ArgumentList $Arguments `
  -WorkingDirectory $ProjectDir `
  -WindowStyle Hidden

Start-Sleep -Seconds 2
try {
  $shell = New-Object -ComObject WScript.Shell
  [void]$shell.AppActivate('Conductor')
} catch {
  # Best-effort focus only.
}
