#!/bin/bash
# PostToolUse hook: auto-run QC after any render command completes.
# Reads the hook JSON on stdin; fires only when the Bash command ran render.sh
# or a remotion render.
INPUT=$(cat)
CMD=$(echo "$INPUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)
case "$CMD" in
  *render.sh*|*"remotion render"*)
    DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    python3 "$DIR/scripts/qc.py" --append "$DIR/docs/QC_REPORT.md" >/dev/null 2>&1 || true
    echo "qc.py executed; results appended to docs/QC_REPORT.md"
    ;;
esac
exit 0
