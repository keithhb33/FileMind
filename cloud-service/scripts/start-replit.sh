#!/usr/bin/env bash
set -euo pipefail

export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
export FILEMIND_DEFAULT_MODEL="${FILEMIND_DEFAULT_MODEL:-qwen3:14b}"

if command -v ollama >/dev/null 2>&1; then
  ollama serve &
  OLLAMA_PID=$!

  for attempt in $(seq 1 60); do
    if curl -fsS "$OLLAMA_HOST/api/tags" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  if [ "${FILEMIND_SKIP_MODEL_PULL:-0}" != "1" ]; then
    ollama pull qwen3:4b
    ollama pull qwen3:14b
  fi

  trap 'kill "$OLLAMA_PID" 2>/dev/null || true' EXIT
else
  echo "Ollama is not installed in this Replit environment. FileMind Cloud will use rule-based fallback planning."
fi

npm start
