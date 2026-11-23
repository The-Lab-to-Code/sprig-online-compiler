$ErrorActionPreference = "Stop"
$dockerHost = "npipe:////./pipe/dockerDesktopLinuxEngine"
$images = @(
  "node:24-alpine", "python:3.14-alpine", "gcc:15", "golang:1.25-alpine",
  "rust:1-slim", "eclipse-temurin:21-jdk-alpine", "ruby:3.4-alpine",
  "php:8.4-cli-alpine", "mcr.microsoft.com/powershell:7.5-ubuntu-24.04",
  "erlang:27-alpine", "elixir:1.18-alpine"
)
foreach ($image in $images) {
  docker --host $dockerHost pull $image
  if ($LASTEXITCODE -ne 0) { throw "Could not pull $image. Start Docker Desktop and try again." }
}
foreach ($build in ([ordered]@{
  "sprig-ai-typescript:1" = "ai-typescript.Dockerfile"
  "sprig-ai-koka:3.2.9" = "ai-koka.Dockerfile"
  "sprig-ai-languages:1" = "ai-languages.Dockerfile"
}).GetEnumerator()) {
  docker --host $dockerHost build -t $build.Key -f (Join-Path $PSScriptRoot $build.Value) $PSScriptRoot
  if ($LASTEXITCODE -ne 0) { throw "Could not build $($build.Key)." }
}
Write-Host "AI code-testing environments are ready. Restart Sprig."
