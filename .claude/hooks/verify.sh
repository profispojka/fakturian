#!/usr/bin/env bash
# Stop: když tah upravil kód, pustí lint a typecheck, a když sáhl na `desktop/`, i testy projektu
# `desktop`, které na změněné soubory dosáhnou. Tah, který jen četl nebo upravil dokumentaci, projde
# bez kontroly. Při selhání vrátí Claudovi `block` s výstupem. Po úspěchu se jednou zeptá, jestli
# změna v `src/` nebo `desktop/` nechce úpravu testů.

set -u
cd "$(dirname "$0")/../.." || exit 0

payload=$(cat 2>/dev/null || true)

get() {
	if command -v jq >/dev/null 2>&1; then
		printf '%s' "$payload" | jq -r ".$1 // empty"
	else
		printf '%s' "$payload" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const v=JSON.parse(d)[process.argv[1]];process.stdout.write(v==null?"":String(v))}catch{process.stdout.write("")}})' "$1"
	fi
}

emit_block() {
	if command -v jq >/dev/null 2>&1; then
		jq -n --arg r "$1" '{decision:"block", reason:$r}'
	else
		node -e 'process.stdout.write(JSON.stringify({decision:"block", reason: process.argv[1]}))' "$1"
	fi
}

session_id=$(get session_id)
marker="${TMPDIR:-/tmp}/claude-edits-${session_id}.list"

[ -n "$session_id" ] || exit 0
[ -f "$marker" ] || exit 0

touched=$(sort -u "$marker" | sed "s#^$PWD/##" | grep -E '\.(ts|tsx|vue|js|mjs|json|css)$' || true)
if [ -z "$touched" ]; then
	rm -f "$marker"
	exit 0
fi

desktop=$(printf '%s\n' "$touched" | grep -E '^desktop/.*\.ts$' || true)

fail=""
out=""

run() {
	local label="$1"
	shift
	local cmd_out rc
	if cmd_out=$("$@" 2>&1); then
		return 0
	else
		rc=$?
		fail="$fail $label"
		out="$out

=== $label (exit $rc) ===
$cmd_out"
	fi
}

run lint bun run lint:check
run lint:scales bun run lint:scales
run lint:dead-css bun run lint:dead-css
# `typecheck` obsahuje i `tsc -p desktop/tsconfig.json`; hlavní proces importuje typy z `src/`.
run typecheck bun run typecheck

# Vlastní konfigurace projektu, ne kořenová: ta by načetla i Nuxt projekt a sahala do `.nuxt`, kam
# staví běžící dev server.
if [ -n "$desktop" ]; then
	run test:desktop bunx vitest related --run --config vitest.desktop.config.ts --passWithNoTests $desktop
fi

if [ -n "$fail" ]; then
	emit_block "Automatické ověření selhalo:${fail}${out}

Oprav chyby výš, než tah ukončíš."
	exit 0
fi

if [ "$(get stop_hook_active)" = "true" ]; then
	rm -f "$marker"
	exit 0
fi

edited=$(printf '%s\n' "$touched" | grep -E '^(src/.*\.(vue|ts)|desktop/.*\.ts)$' | grep -v '^desktop/test/' || true)
rm -f "$marker"
[ -z "$edited" ] && exit 0

emit_block "Lint i typecheck prošly (testy hook pouští jen pro \`desktop/\`), ale tenhle tah upravil zdrojáky:
$edited

Než skončíš, zkontroluj, jestli změna nechce úpravu testů (test/, test/nuxt/, test/contracts/, desktop/test/, e2e/specs/), ukázkových dat (desktop/examples/demo-vault.ts, showcase/harness/demo-data.ts, e2e/fixtures/vault/) nebo dokumentace (docs/). Co je potřeba, uprav; když nic, řekni to výslovně v závěrečné zprávě. Tuhle kontrolu neopakuj."
exit 0
