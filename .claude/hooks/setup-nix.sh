#!/bin/bash
set -e

if [ -z "$CLAUDE_ENV_FILE" ]; then
  exit 0
fi

# Capture environment before activation
ENV_BEFORE=$(export -p 2>/dev/null | sort)

# Activate nix develop environment
if [ -f "$CLAUDE_PROJECT_DIR/flake.nix" ]; then
  cd "$CLAUDE_PROJECT_DIR"
  eval "$(nix print-dev-env)"
fi

# Capture new environment variables and persist them
ENV_AFTER=$(export -p 2>/dev/null | sort)
comm -13 <(echo "$ENV_BEFORE") <(echo "$ENV_AFTER") >> "$CLAUDE_ENV_FILE"

exit 0
