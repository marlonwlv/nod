# Conectar o Nod por MCP

O Nod tem um servidor MCP: outro app (o Grok Bot, o Claude Desktop, o Claude Code, o Cursor, o OpenClaw ou qualquer
cliente MCP) usa os seus bots, o quadro, as aprovações e as rotinas em seu nome, com as mesmas permissões da tela.
Decisão e detalhes técnicos: [ADR-166](adr/adr-166-servidor-mcp-do-nod.md).

## 1. Gerar o token

No Nod, abra **Configurações › Geral › Conectar por MCP**, dê um nome ao app (ex.: "Grok Bot") e clique em **Gerar
token**. Copie o token na hora: ele começa com `nod_mcp_` e **não aparece de novo**. A mesma tela mostra o endereço do
MCP (ex.: `https://app.nodbot.ai/api/mcp`), quando cada token foi usado e por qual app, e o **Revogar**, que corta o
acesso no pedido seguinte.

Trate o token como uma senha: quem tem o token age como você no Nod.

## 2. Conectar o app

O servidor é **remoto, por HTTP** (Streamable HTTP), e autentica pelo cabeçalho `Authorization: Bearer <token>`.

### Grok Bot

Em **Connect apps › Add a custom connector**, escolha **Remote HTTPS URL**, cole o endereço do MCP e adicione o
cabeçalho `Authorization` com o valor `Bearer nod_mcp_…`.

### Claude Desktop, Cursor e clientes com arquivo de configuração

O botão **Copiar configuração** da tela já monta o bloco:

```json
{
  "mcpServers": {
    "nod": {
      "type": "http",
      "url": "https://app.nodbot.ai/api/mcp",
      "headers": { "Authorization": "Bearer nod_mcp_..." }
    }
  }
}
```

Cliente que só fala stdio usa a ponte `mcp-remote`:
`npx mcp-remote https://app.nodbot.ai/api/mcp --header "Authorization: Bearer nod_mcp_..."`.

### Claude Code

```bash
claude mcp add --transport http nod https://app.nodbot.ai/api/mcp --header "Authorization: Bearer nod_mcp_..."
```

### OpenClaw

```bash
openclaw mcp add nod --url https://app.nodbot.ai/api/mcp --transport streamable-http
```

e ponha o cabeçalho `Authorization` em `headers` na configuração do servidor (sem o token na URL).

## 3. O que dá para fazer

| Ferramenta | O que faz |
| --- | --- |
| `nod_listar_bots` | Os seus bots, com não lidos e a última mensagem |
| `nod_conversar` | Manda uma mensagem a um bot e espera a resposta (até 110 s; depois, leia com `nod_ler_conversa`) |
| `nod_ler_conversa` | As últimas mensagens com um bot e se ele ainda está trabalhando |
| `nod_o_que_espera_por_mim` | Aprovações, perguntas dos bots e não lidos |
| `nod_decidir` | Aprova ou recusa um pedido (como os botões da tela) |
| `nod_responder_pedido` | Responde com texto a uma pergunta de um bot |
| `nod_ver_quadro` / `nod_ver_tarefa` | O quadro de um bot e uma tarefa com os comentários |
| `nod_criar_tarefa` / `nod_mudar_tarefa` | Cria, move de coluna, troca o responsável ou edita uma tarefa |
| `nod_comentar_tarefa` / `nod_responder_tarefa` | Comenta numa tarefa ou responde à pergunta deixada nela |
| `nod_listar_rotinas` / `nod_rodar_rotina` | As rotinas e rodar uma agora |
| `nod_chamar_rota` | Qualquer outra ação da tela (o caminho da API, sem `/api/t/<tenant>`) |

Não passam pelo MCP: gerar ou revogar tokens, guardar segredos e credenciais, parear aparelhos, logins OAuth, usar a tela
do computador do bot e o consentimento de voz.

## 4. Testar na mão

Com o token em `NOD_MCP_TOKEN`:

```bash
curl -s https://app.nodbot.ai/api/mcp \
  -H "Authorization: Bearer $NOD_MCP_TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"nod_listar_bots","arguments":{}}}'
```
