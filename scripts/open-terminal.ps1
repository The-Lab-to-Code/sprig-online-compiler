param(
  [Parameter(Mandatory = $true)][string]$Script,
  [Parameter(Mandatory = $true)][string]$Manifest
)

$ErrorActionPreference = "Stop"
$arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -NoExit -File "' + $Script + '" "' + $Manifest + '"'
$terminal = Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WindowStyle Normal -PassThru
Write-Output ("STARTED " + $terminal.Id)
$terminal.WaitForExit()
