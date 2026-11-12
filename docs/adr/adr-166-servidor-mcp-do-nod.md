# ADR-166 — Servidor MCP do Nod: pilotar o Nod de fora pelas rotas da tela

Status: proposta (2026-11-12, ADA-205 / NOD-152) · Relacionadas: [ADR-135](adr-135-registro-unico-de-acoes-e-paridade.md) (o registro de
ações), [ADR-031](adr-031-a-chave-de-maquina-persiste-carrega-o-proprio-escopo-e-e-rev.md) (o desenho do token), ADA-191 (paridade total) e ADA-177 (o caminho
inverso: o Nod consumindo MCP por URL com OAuth).

## Contexto

O Marlon quer que outras ferramentas pilotem o Nod por MCP. O primeiro caso é quem já usa o Grok Bot (conector MCP
remoto por HTTPS, com cabeçalho ou OAuth): conversar com os bots, ver o que espera por ela, aprovar, mexer no quadro e
rodar rotinas sem abrir o Nod. Depois, qualquer cliente MCP (Claude Desktop, Claude Code, Cursor, OpenClaw).

## Decisão

1. **Endpoint `POST /api/mcp`** no transporte Streamable HTTP do MCP, **sem estado**: cada pedido traz o token, não há
   sessão nem SSE; a resposta é `application/json` (a especificação permite no lugar do stream). Métodos: `initialize`
   (versões 2025-06-18, 2025-03-26 e 2024-11-05), `ping`, `tools/list`, `tools/call`; notificação recebe 202; GET e
   DELETE dão 405. Pedido com `Origin` é 403 antes do token (o cliente é um programa, não uma página; fecha o DNS
   rebinding que a especificação manda evitar), como as rotas internas (ADR-021).
2. **Token próprio da pessoa, revogável** (`mcp_tokens`, 0173): `nod_mcp_` + o desenho da chave de máquina (escopo
   alegado + 32 bytes; o banco guarda só o SHA-256 do token inteiro; validação numa tx escopada pelo escopo alegado).
   Tabela separada de `maquina_tokens`: aquela autoriza o motor, esta as rotas de pessoa. Gerar, listar e revogar ficam
   em Configurações › Geral › Conectar por MCP (`GET|POST /mcp/tokens`, `DELETE /mcp/tokens/:id`); o token cru sai uma
   vez. Revogar derruba o cliente no pedido seguinte. Teto de 20 tokens vivos por pessoa.
3. **As ferramentas chamam as rotas da tela por dentro** (`chamador-interno.ts`): o handler é o MESMO que a tela usa,
   com o escopo do token no lugar da sessão. Mesmo caso de uso, mesma RLS, mesmas recusas, mesmo registro de ações: a
   paridade com a tela vem de graça e nenhuma regra de negócio mora no MCP. A 1ª leva é composição fina: listar bots,
   conversar (manda e espera a resposta até 110 s), ler conversa, o que espera por mim, decidir, responder pedido, ver
   quadro e tarefa, criar, mudar, comentar e responder tarefa, listar e rodar rotinas. `nod_chamar_rota` alcança
   qualquer outra rota de pessoa (o resto da paridade, até a ADA-191 dar ferramentas próprias).
4. **Fica fora do MCP**, inclusive pelo `nod_chamar_rota`: os próprios tokens MCP (um token não gera outro), o SSE, o
   endereço da rotina webhook (o GET devolve o segredo) e as ações que levam segredo (inclusive registrar um app: o `env` sai
   cifrado e o comando stdio roda na sondagem, revisão de QA), pareamento (inclusive o convite de
   máquina, que com `papel: computador` pareia sem a tela e vira chave que sobrevive à revogação do token), instalação
   por SSH e confiança em host key, login de IA na máquina, OAuth no navegador, a troca do endereço webhook, as mãos da
   pessoa no computador do bot e o consentimento de voz (`ACOES_FORA_DO_MCP`, lista explícita; revisão do PR #22). **Não** é "todas as `nunca` do chat": o `nunca` de `conversas.enviar` e
   dos cartões fala do BOT decidir pela conversa; o cliente MCP age em nome da PESSOA, com o token dela, e mandar
   mensagem e aprovar são o que ele existe para fazer (critério de aceite do Marlon). As descrições das ferramentas
   pedem ao modelo do cliente que confirme com a pessoa antes de aprovar algo com efeito externo.
5. **Rastro**: cada chamada loga `mcp_ferramenta` (token, ferramenta, erro, ms; nunca argumentos ou saída, ADR-004) e o
   token guarda o último uso e o nome que o cliente anunciou no `initialize`, que a tela mostra ("Usado por Grok Bot").
   O que uma ferramenta muda (mensagem, decisão, tarefa, rotina, `nod_chamar_rota` fora de GET) vai para `mcp_acoes`
   (0174) com um resumo de uma linha e entra na Atividade do bot como "Pelo MCP · <cliente>" (critério 4 da NOD-152).
6. **Tetos**: lote JSON-RPC de no máximo 16 pedidos e no máximo 8 ferramentas em andamento por token (o `nod_conversar`
   segura a leitura da conversa por até 110 s); o cliente que fecha a conexão para a espera na hora.

## Consequências

- O que a tela ganha de rota nova o MCP alcança no mesmo dia pelo `nod_chamar_rota`.
- **Ainda não**: OAuth (o Grok Bot e o Claude aceitam cabeçalho; OAuth fica para quando um cliente exigir), a marca
  "via MCP" na própria mensagem do chat e no mural do quadro (a Atividade do bot já diz) e notificações do servidor (sem
  SSE, o cliente relê com `nod_ler_conversa`).

## Gatilho de reversão

Se um cliente importante exigir sessão MCP com stream (SSE) ou OAuth, o endpoint ganha esse modo sem mudar as
ferramentas; se o `nod_chamar_rota` virar fonte de incidente (rota que não devia ser alcançável), ele passa a uma lista
de rotas permitidas em vez da lista de exceções.
