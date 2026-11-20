import type { TokenMcpEmitidoDto, TokensMcpDto } from "../../src/contracts/mcp.ts";
import type { ConfigUi } from "../estado/reducer.ts";
import { ICONE } from "../lib/icones.ts";
import { grupoConfig, linhaConfig } from "../lib/linha-config.ts";
import { botao, dataHora, esc } from "../lib/render.ts";

/** Servidor MCP do Nod (0173): o que a seção Geral precisa para o grupo "Conectar por MCP". */
export type DadosMcp = { tokens: TokensMcpDto | null; emitido: TokenMcpEmitidoDto | null };

/** O bloco de configuração que a pessoa cola no cliente MCP (Claude Desktop, Cursor e afins; o Grok Bot pede só URL e cabeçalho). */
export function configDoCliente(endpoint: string, token: string): string {
  return JSON.stringify({ mcpServers: { nod: { type: "http", url: endpoint, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
}

/**
 * Configurações › Geral › Conectar por MCP: gerar um token para outro app (o Grok Bot, o Claude Desktop) pilotar o Nod
 * pelo endpoint MCP, ver de onde cada um foi usado e revogar. O token cru aparece uma vez, como a chave de máquina.
 */
export function renderMcp(d: DadosMcp, ui: ConfigUi): string {
  const endpoint = d.tokens?.endpoint ?? d.emitido?.endpoint ?? "";
  const emitido = d.emitido
    ? `<div class="cfg-chave chave-emitida" role="status">
      <p><b>Token "${esc(d.emitido.dados.nome)}"</b>: copie agora. Ele <b>não será mostrado de novo</b>.</p>
      <p>No app, adicione um servidor MCP remoto com a URL <code>${esc(d.emitido.endpoint)}</code> e o cabeçalho <code>Authorization: Bearer</code> seguido do token.</p>
      <code class="chave-crua">${esc(d.emitido.token)}</code>
      <div class="acoes">${botao("copiar-texto", "Copiar token", { classe: "sm", dados: { texto: d.emitido.token } })}${botao("copiar-texto", "Copiar configuração", { classe: "sm", dados: { texto: configDoCliente(d.emitido.endpoint, d.emitido.token) } })}${botao("fechar-token-mcp", "Já copiei", { classe: "sm" })}</div>
    </div>`
    : "";
  const vivos = (d.tokens?.tokens ?? []).filter((t) => t.revogadoEm === null);
  const linhas = vivos.map((t) => linhaConfig({
    titulo: t.nome,
    detalhe: [t.cliente ? `Usado por ${t.cliente}` : null, t.ultimoUsoEm ? `último uso ${dataHora(t.ultimoUsoEm)}` : "ainda não usado", `…${t.prefixo}`].filter(Boolean).join(" · "),
    icone: ICONE.cadeado,
    controle: { tipo: "html", html: botao("revogar-token-mcp", "Revogar", { classe: "sm", id: t.id, dados: { nome: t.nome }, aria: `Revogar o token ${t.nome}` }) },
  }));
  const form = `<form class="cfg-chave-form" data-form="gerar-token-mcp"><label>Nome do app <input name="nome" required maxlength="60" placeholder="ex.: Grok Bot" data-manter-foco="gerar-token-mcp-nome"></label><button class="bt" type="submit">Gerar token</button></form>`;
  linhas.push(linhaConfig({
    titulo: "Conectar um app",
    detalhe: "Gera um token para outro app usar seus bots, o quadro e as aprovações por MCP",
    icone: ICONE.mais,
    controle: { tipo: "recolhe", id: "mcp-novo", acao: "config-recolhe", aberto: ui.abertos.includes("mcp-novo") || vivos.length === 0, conteudo: `<div class="cfg-chave">${form}</div>` },
  }));
  const nota = endpoint ? `Endereço do MCP: ${endpoint}. O app age como você, com as mesmas permissões da tela.` : "O app age como você, com as mesmas permissões da tela.";
  return `${emitido}${grupoConfig("Conectar por MCP", linhas, { nota, id: "mcp" })}`;
}
