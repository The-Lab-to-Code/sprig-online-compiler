$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT" -or -not [Environment]::Is64BitOperatingSystem) {
  throw "The bundled local AI setup requires 64-bit Windows."
}

$root = Join-Path $env:LOCALAPPDATA "Sprig\AI"
$runtime = Join-Path $root "llama-b12633"
$model = Join-Path $root "qwen2.5-coder-3b-instruct-q4_k_m.gguf"
$runtimeHash = "BAD9FE0C1B554BCB1CE5630D66AD34A2285A8B390400513CC02F56FEAFD62C8E"
$modelHash = "724FB256BEC1FF062B2F65E4569E871AD2E95AB2A3989723D1769C54294730B7"
$runtimeUrl = "https://github.com/ggml-org/llama.cpp/releases/download/b12633/llama-b12633-bin-win-cpu-x64.zip"
$modelUrl = "https://huggingface.co/Qwen/Qwen2.5-Coder-3B-Instruct-GGUF/resolve/main/qwen2.5-coder-3b-instruct-q4_k_m.gguf"

New-Item -ItemType Directory -Force -Path $root | Out-Null
$temp = Join-Path $root ("setup-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  if (!(Test-Path -LiteralPath (Join-Path $runtime "llama-server.exe") -PathType Leaf)) {
    if (Test-Path -LiteralPath $runtime) { throw "The runtime directory already exists but is incomplete: $runtime" }
    $zip = Join-Path $temp "runtime.zip"
    Write-Output "Downloading local AI runtime (25 MB)..."
    & curl.exe -fL --retry 2 -o $zip $runtimeUrl
    if ($LASTEXITCODE -ne 0) { throw "Failed to download the local AI runtime." }
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $runtimeHash) { throw "Local AI runtime checksum mismatch." }
    $extracted = Join-Path $temp "runtime"
    Expand-Archive -LiteralPath $zip -DestinationPath $extracted
    if (!(Test-Path -LiteralPath (Join-Path $extracted "llama-server.exe") -PathType Leaf)) { throw "The runtime archive is missing llama-server.exe." }
    Move-Item -LiteralPath $extracted -Destination $runtime
  }
  if (Test-Path -LiteralPath $model) {
    if ((Get-FileHash -LiteralPath $model -Algorithm SHA256).Hash -ne $modelHash) { throw "The existing local AI model does not match the expected checksum: $model" }
  } else {
    $download = Join-Path $temp "model.gguf"
    Write-Output "Downloading local coding model (about 2.1 GB)..."
    & curl.exe -fL --retry 2 -o $download $modelUrl
    if ($LASTEXITCODE -ne 0) { throw "Failed to download the local coding model." }
    if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $modelHash) { throw "Local AI model checksum mismatch." }
    Move-Item -LiteralPath $download -Destination $model
  }
  Write-Output "Local AI is ready. Restart start-sprig.bat to load the updated runner."
} finally {
  if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
}
