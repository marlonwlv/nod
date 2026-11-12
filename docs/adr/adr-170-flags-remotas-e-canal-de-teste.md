# ADR-170 — Flags remotas por pessoa e o canal de teste do app

Status: proposta · Data: 2026-11-12 (decisão 3 do Marlon: "flags remotas e versões de teste") · Convive com a
[ADR-111](adr-111-chaves-de-experimento-calibracao-e-memoria-longa.md) (chaves de experimento) e emenda a
[ADR-149](adr-149-atualizacao-automatica-do-app-do-mac.md) (feed do app).

## Contexto

Assistentes de referência ligam e desligam comportamento por pessoa sem publicar versão (gates e configs dinâmicas, inclusive
prazos de stream) e têm canais de atualização (stable, nightly, dogfood, lab). No nod, flag é `NOD_*` no env do servidor:
vale para todo mundo e muda só reiniciando; o app tem um canal só.

## Decisão

1. **Regras num JSON do servidor** (`src/domain/flags-remotas.ts`, puro): `NOD_FLAGS_ARQUIVO` (relido quando o mtime
   muda, conferido no máximo a cada 5 s) ou `NOD_FLAGS` (env, no boot). Cada regra: `flag`, `valor`, e o público —
   `pessoas`, `tenants`, `porcentagem` (balde FNV-1a estável por pessoa e flag) e `ate` (prazo). A primeira que casa ganha;
   nenhuma casa, vale o padrão do catálogo `FLAGS_CONHECIDAS`. Flag do catálogo só aceita valor do tipo do padrão.
2. **Arquivo inválido não apaga nada**: uma regra torta derruba o arquivo inteiro, a fonte mantém a última versão válida e
   loga `flags_invalidas`. Nenhuma meia configuração.
3. **Entrega já avaliada**: `GET /api/t/:t/flags` → `{flags, canal}` com `no-store`. A web e o app nunca veem as regras nem
   quem mais está num teste.
4. **Canal de teste do app**: a versão de teste sai no MESMO bucket da estável (`NOD_APP_VERSAO_TESTE` +
   `NOD_APP_ATUALIZACAO_TESTE_SHA256`). O feed `GET /api/maquina/atualizacao` pergunta às flags da pessoa da chave
   (`app.canal`); quem está em `teste` recebe a de teste **só se ela for mais nova que a estável** (nunca volta de versão);
   o resto segue igual. Entrar e sair do teste é uma linha no arquivo de flags, sem release.
5. Statsig ou outra ferramenta paga ficam de fora por ora: o volume de pessoas não justifica e o arquivo resolve o caso
   "esta pessoa no teste". A fonte é uma função (`FonteDeFlags`), trocável por um cliente de serviço sem mudar quem lê.

## Consequências

- Ligar a tela nova para o Marlon e mais duas pessoas, ou o Orgo como computador de um bot, vira editar um arquivo.
- O app desktop ainda não lê `/flags` (frente de desktop): por ora o canal de teste é decidido no servidor, no feed.

## Gatilho de reversão

Se o arquivo de flags passar de 100 regras ativas ou precisar de edição mais de uma vez por dia por 2 semanas, migrar as
regras para uma tabela com tela de admin (ou um serviço de flags).
