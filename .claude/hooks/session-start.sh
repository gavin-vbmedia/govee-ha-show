#!/bin/bash
# Cloud sessions start from a fresh container: install what the tests need.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
pip install -q -r haliday_show/requirements.txt pytest pytest-aiohttp
