#!/usr/bin/env bash
# PostToolUse: naformátuje právě upravený soubor přes oxfmt a zapíše ho do seznamu úprav,
# ze kterého Stop hook (verify.sh) pozná, co má ověřit.

set -u
cd "$(dirname "$0")/../.." || exit 0

payload=$(cat)

if command -v jq >/dev/null 2>&1; then
	file_path=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')
	session_id=$(printf '%s' "$payload" | jq -r '.session_id // empty')
else
	file_path=$(printf '%s' "$payload" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const p=JSON.parse(d);process.stdout.write(p.tool_input&&p.tool_input.file_path||"")}catch{process.stdout.write("")}})')
	session_id=$(printf '%s' "$payload" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(JSON.parse(d).session_id||"")}catch{process.stdout.write("")}})')
fi

[ -z "$file_path" ] && exit 0
[ ! -f "$file_path" ] && exit 0

if [ -n "$session_id" ]; then
	printf '%s\n' "$file_path" >>"${TMPDIR:-/tmp}/claude-edits-${session_id}.list" 2>/dev/null || true
fi

case "$file_path" in
	*.ts|*.tsx|*.js|*.mjs|*.vue|*.json|*.css|*.md) ;;
	*) exit 0 ;;
esac

bunx oxfmt --write "$file_path" >/dev/null 2>&1 || true
exit 0
