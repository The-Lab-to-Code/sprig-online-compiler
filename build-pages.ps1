$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$site = Join-Path $root "site"
$vendor = Join-Path $root "sprig-vendor"
$siteVendor = Join-Path $site "sprig-vendor"

if (!(Test-Path $vendor -PathType Container)) {
  throw "Missing runtime assets directory: $vendor"
}

New-Item -ItemType Directory -Force -Path $site, $siteVendor | Out-Null
Copy-Item (Join-Path $root "index.html") (Join-Path $site "index.html") -Force
Copy-Item (Join-Path $vendor "*") $siteVendor -Force
