#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PISTON_ORIGIN="http://127.0.0.1:2001"
PISTON_URL="$PISTON_ORIGIN/api/v2/execute"
PISTON_RUNTIMES_URL="$PISTON_ORIGIN/api/v2/runtimes"
PACKAGES_DIR="$ROOT/.piston-data/packages"

mkdir -p "$PACKAGES_DIR"

docker_ready=false
for _ in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then
    docker_ready=true
    break
  fi
  sleep 2
done
if [ "$docker_ready" != true ]; then
  echo "Docker is unavailable in this Codespace." >&2
  exit 1
fi

if docker container inspect piston_api >/dev/null 2>&1; then
  if [ "$(docker inspect --format '{{.State.Running}}' piston_api)" != true ]; then
    docker start piston_api >/dev/null
  fi
else
  docker run -d \
    --name piston_api \
    --restart unless-stopped \
    --privileged \
    -p 127.0.0.1:2001:2000 \
    -v "$PACKAGES_DIR:/piston/packages" \
    ghcr.io/engineer-man/piston >/dev/null
fi

piston_ready=false
for _ in $(seq 1 60); do
  if curl -fsS "$PISTON_RUNTIMES_URL" >/dev/null; then
    piston_ready=true
    break
  fi
  sleep 2
done
if [ "$piston_ready" != true ]; then
  echo "Piston did not become ready at $PISTON_ORIGIN." >&2
  docker logs --tail 50 piston_api >&2
  exit 1
fi

if ! curl -fsS "$PISTON_RUNTIMES_URL" | grep -Eq '"language"[[:space:]]*:[[:space:]]*"powershell"'; then
  if [ ! -f .piston-src/cli/index.js ]; then
    if [ -e .piston-src ]; then
      echo "The existing .piston-src directory is not a valid Piston checkout." >&2
      exit 1
    fi
    git clone --depth 1 https://github.com/engineer-man/piston.git .piston-src
  fi
  npm install --prefix .piston-src/cli --omit=dev
  node .piston-src/cli/index.js -u "$PISTON_ORIGIN" ppman install pwsh
fi

if ! curl -fsS "$PISTON_RUNTIMES_URL" | grep -Eq '"language"[[:space:]]*:[[:space:]]*"powershell"'; then
  echo "PowerShell was not registered by Piston after installation." >&2
  exit 1
fi

if ! curl -fsS http://127.0.0.1:3001/ >/dev/null; then
  nohup env \
    SPRIG_HOST=0.0.0.0 \
    SPRIG_PORT=3001 \
    PISTON_URL="$PISTON_URL" \
    node "$ROOT/sprig-runner.js" \
    >"$ROOT/.piston-data/sprig-runner.log" 2>&1 </dev/null &
fi

sprig_ready=false
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/ >/dev/null; then
    sprig_ready=true
    break
  fi
  sleep 1
done
if [ "$sprig_ready" != true ]; then
  echo "Sprig did not become ready on port 3001." >&2
  tail -n 50 .piston-data/sprig-runner.log >&2
  exit 1
fi

echo "Sprig is ready on port 3001; Piston PowerShell is ready on the private Codespace network."
