param([Parameter(Mandatory = $true)][string]$Manifest)

$ErrorActionPreference = "Stop"
try {
  $plan = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
  Set-Location -LiteralPath $plan.directory
  if ($plan.compiler) {
    $compileArgs = @($plan.compileArgs)
    & $plan.compiler @compileArgs
    if ($LASTEXITCODE -ne 0) {
      Write-Host "`nBuild failed (exit code $LASTEXITCODE)."
      return
    }
  }
  $programArgs = @($plan.args)
  & $plan.command @programArgs
  Write-Host "`nProgram finished (exit code $LASTEXITCODE)."
} catch {
  Write-Error $_
}
