#!/bin/sh
set -eu

provider="${CYBERBOSS_CODEX_MODEL_PROVIDER:-}"
model="${CYBERBOSS_CODEX_MODEL:-}"

if [ "$provider" = "ollama" ]; then
  if [ -n "$model" ]; then
    exec codex --oss --local-provider ollama -m "$model" "$@"
  fi
  exec codex --oss --local-provider ollama "$@"
fi

if [ -n "$model" ]; then
  exec codex -m "$model" "$@"
fi

exec codex "$@"
