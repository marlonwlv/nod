#!/bin/bash
# ADR-197 (item 9): a escolha do lugar com um modelo de verdade. Monta o prompt e as ferramentas reais do nod (plano.ts),
# roda cada pedido de pedidos.json no Claude Code só com essas ferramentas (num MCP falso que registra as chamadas e
# responde "ok") e imprime: pedido, lugar esperado, primeira ferramenta, todas. Uma rodada por vez (pouca memória).
# Uso: bash scripts/seu-computador/escolha/rodar.sh [sonnet|haiku|opus]
set -u
MODELO="${1:-sonnet}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
D="$(mktemp -d)"
cp "$AQUI/pedidos.json" "$AQUI/mcp-falso.mjs" "$D/"
npx tsx "$AQUI/plano.ts" "$D" >&2
N=$(python3 -c "import json;print(len(json.load(open('$D/pedidos.json'))))")
for i in $(seq 0 $((N-1))); do
  ID=$(python3 -c "import json;print(json.load(open('$D/pedidos.json'))[$i]['id'])")
  TXT=$(python3 -c "import json;print(json.load(open('$D/pedidos.json'))[$i]['texto'])")
  ESP=$(python3 -c "import json;print(json.load(open('$D/pedidos.json'))[$i]['espera'])")
  LOG="$D/chamadas-$ID.jsonl"; : > "$LOG"
  printf '{"mcpServers":{"nod":{"command":"node","args":["%s/mcp-falso.mjs","%s/ferramentas.json","%s"]}}}' "$D" "$D" "$LOG" > "$D/mcp-$ID.json"
  ( cd "$D" && timeout 240 claude -p "$TXT" --model "$MODELO" --system-prompt "$(cat "$D/prompt.txt")" --mcp-config "$D/mcp-$ID.json" --strict-mcp-config --allowedTools "mcp__nod__*" --disallowedTools "Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite,NotebookEdit" --max-turns 3 --output-format text < /dev/null > "$D/resposta-$ID.txt" 2>&1 )
  PRIMEIRA=$(head -1 "$LOG" | python3 -c "import sys,json; l=sys.stdin.read().strip(); print(json.loads(l)['nome'] if l else '(nenhuma)')")
  TODAS=$(python3 -c "import json; print(','.join(json.loads(l)['nome'] for l in open('$LOG') if l.strip()))")
  printf '%s\t%s\t%s\t%s\n' "$ID" "$ESP" "$PRIMEIRA" "$TODAS"
done
echo "respostas em $D" >&2
