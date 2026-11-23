$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$site = Join-Path $root "site"
$vendor = Join-Path $root "sprig-vendor"
$siteVendor = Join-Path $site "sprig-vendor"
$web = Join-Path $root "web"

if (!(Test-Path $vendor -PathType Container)) {
  throw "Missing runtime assets directory: $vendor"
}

New-Item -ItemType Directory -Force -Path $site, $siteVendor | Out-Null
$editor = [System.IO.File]::ReadAllText((Join-Path $root "index.html"), [System.Text.Encoding]::UTF8)
if (!$editor.Contains("</head>")) { throw "Editor HTML is missing its head element." }
$editor = $editor.Replace("</head>", "<meta name=`"sprig-preview`" content=`"true`">`n</head>")
[System.IO.File]::WriteAllText((Join-Path $site "editor.html"), $editor, [System.Text.UTF8Encoding]::new($false))
Copy-Item (Join-Path $web "*") $site -Force
Copy-Item (Join-Path $vendor "*") $siteVendor -Force
