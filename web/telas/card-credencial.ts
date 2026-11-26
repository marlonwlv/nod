import type { PayloadPropostaCredencial, Proposta } from "../../src/contracts/conversa.ts";
import { esc } from "../lib/render.ts";

/**
 * O cartão de pedido de credencial (definido em 2026-10-28, NOD-50; protótipo nod-prototipos/nod-50). O bot chamou
 * pedir_credencial; a pessoa cola a chave num campo de senha e o valor vai direto ao cofre (POST
 * propostas/:id/credencial). O VALOR MORA SÓ NO CAMPO DA TELA: nada no estado do app, no armazenamento do navegador ou
 * na conversa. Aqui fica só a fase da UI de cada cartão (ocupado, qual erro), sem o valor.
 */

export type FaseCredencial = { ocupado: boolean; erro: ErroDoCartao | null; mostrando?: boolean };
export type ErroDoCartao = "vazio" | "recusada" | "formato" | "indisponivel" | "rede" | "resolvido";

const fases = new Map<string, FaseCredencial>();
let versao = 0;

/**
 * Muda a cada `marcarFase`. A conversa desenha o histórico por `lembrar` (web/lib/lembrar.ts), que só enxerga o estado
 * do app; a fase mora aqui fora, então entra nos extras dessa lembrança. Sem isso o erro e o "Guardando…" só
 * apareciam depois de sair e voltar (QA do PR 553).
 */
export function versaoDasFases(): number {
  return versao;
}

export function faseDoCartao(id: string): FaseCredencial {
  return fases.get(id) ?? { ocupado: false, erro: null };
}

export function marcarFase(id: string, fase: FaseCredencial | null): void {
  if (fase === null) fases.delete(id);
  else fases.set(id, fase);
  versao++;
}

/** O que o erro da rota vira no cartão: o código, nunca a mensagem crua. */
export function erroDaResposta(status: number | null, codigo: string | null): ErroDoCartao {
  if (status === null) return "rede";
  if (codigo === "integracao_autenticacao") return "recusada";
  if (codigo === "entrada_invalida") return "formato";
  if (codigo === "estado_invalido" || codigo === "nao_encontrado") return "resolvido";
  return "indisponivel";
}

export function tituloDoCartao(p: PayloadPropostaCredencial): string {
  // ADR-195 (Paper O1): "Chave da Orgo", com o artigo que o servidor mandou no payload.
  if (p.alvo === "app") return `Chave d${p.appNaTela?.artigo ?? "o"} ${p.app}`;
  return p.alvo === "github_token" ? "Token do GitHub" : p.alvo === "composio" ? "Chave do Composio do time" : `Chave para ${p.app}`;
}

/** "O GitHub", "A Orgo": o app com o artigo dele (Paper O3, "A Orgo recusou essa chave"). */
function oApp(p: PayloadPropostaCredencial): string {
  const app = p.alvo === "github_token" ? "GitHub" : p.alvo === "composio" ? "Composio" : p.app;
  return `${p.appNaTela?.artigo === "a" ? "A" : "O"} ${app}`;
}

function fraseDoErro(p: PayloadPropostaCredencial, erro: ErroDoCartao): string {
  const coisa = p.alvo === "github_token" ? "o token" : "a chave";
  switch (erro) {
    case "vazio": return `Cole ${coisa} antes de guardar.`;
    case "recusada": return `${oApp(p)} recusou ${p.alvo === "github_token" ? "esse token" : "essa chave"}. Confira se copiou inteira e cole de novo.`;
    case "formato": return p.alvo === "github_token" ? "Isso não parece um token do GitHub. Ele começa com ghp_ ou github_pat_." : `Isso não parece ${coisa}: confira se não colou espaço ou quebra de linha.`;
    case "indisponivel": return `${oApp(p)} não respondeu agora. Tente de novo em instantes.`;
    case "rede": return `Não deu para confirmar se ${coisa} foi ${p.alvo === "github_token" ? "guardado" : "guardada"}. Tente de novo.`;
    case "resolvido": return "Esse pedido já foi resolvido ou venceu.";
  }
}

const ICONE_CHAVE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M17 6l2.5 2.5M14.5 8.5 16.5 10.5"/></svg>';
const ICONE_FECHAR = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
const ICONE_CADEADO = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

/**
 * O cartão aberto (quem chama só o desenha com a decisão aberta; fechada ou vencida, o recibo encolhido ou o Reabrir de Sua
 * vez ocupam o lugar). `local` separa os ids do mesmo cartão na conversa e em Sua vez (os dois podem estar no DOM).
 * autocomplete="off" + data-1p-ignore/data-lpignore: não é senha do nod — o gerenciador não oferece, não gera nem salva
 * (uma senha gerada ali viraria uma "chave" inválida; revisão 4 do PR #553).
 */
export function renderCardCredencial(p: Proposta & { payload: PayloadPropostaCredencial }, agente: string, local: "c" | "sv" = "c"): string {
  const c = p.payload;
  const id = esc(p.id);
  const base = `cr-${local}-${id}`;
  const fase = faseDoCartao(p.id);
  // ADR-195 (Entrega 3, Paper O1–O3): o app conhecido do Cofre (a Orgo) diz onde achar a chave e como ela começa.
  const doCofre = c.alvo === "app" && c.appNaTela ? { nome: c.app, ...c.appNaTela } : null;
  const erro = fase.erro ? `<p class="p50-erro" id="${base}-erro" role="alert">${esc(fraseDoErro(c, fase.erro))}</p>` : "";
  const rotulo = c.alvo === "github_token" ? "Token pessoal" : c.alvo === "composio" || c.alvo === "app" ? "Chave da API" : `Chave <code>${esc(c.chave ?? "")}</code>`;
  const onde = doCofre ? `<span class="p50-onde">Onde achar: <a href="${esc(doCofre.ondeAchar.url)}" target="_blank" rel="noopener noreferrer">${esc(doCofre.ondeAchar.rotulo)}</a></span>` : "";
  const dica = c.alvo === "github_token" ? "ghp_… ou github_pat_…" : doCofre ? doCofre.dica : c.chave?.toLowerCase() === "authorization" ? "Cole só o token (o Bearer de antes se mantém)" : "Cole a chave aqui";
  const coisa = c.alvo === "github_token" ? "o token" : "a chave";
  const invalido = fase.erro === "vazio" || fase.erro === "recusada" || fase.erro === "formato";
  const guardar = fase.ocupado ? "Guardando…" : fase.erro === "rede" || fase.erro === "indisponivel" ? "Tentar de novo" : "Guardar";
  const app = c.alvo === "github_token" ? "GitHub" : c.alvo === "composio" ? "Composio" : c.app;
  const testando = doCofre ? `Guardando e testando a chave n${doCofre.artigo} ${doCofre.nome}…` : `Guardando e testando o ${app}…`;
  const sigilo = doCofre ? `Vai direto para o Cofre e só ${agente} usa, sem ver a chave.` : `Vai direto para o cofre. ${agente} não vê ${coisa}.`;
  const fechar = fase.ocupado ? "" : `<button type="button" class="p50-fechar" data-act="recusar-credencial" data-id="${id}" aria-label="Deixar de lado">${ICONE_FECHAR}</button>`;
  return `<form class="p50-cartao" role="group" aria-labelledby="${base}-t" data-proposta="${id}" data-decisao="${id}" data-form="guardar-credencial" data-id="${id}" novalidate>
    <div class="p50-cab"><span class="p50-ic">${ICONE_CHAVE}</span><h3 class="p50-titulo" id="${base}-t">${esc(tituloDoCartao(c))}</h3>${fechar}</div>
    <p class="p50-para">${esc(c.para)}</p>
    <label class="cc-campo p50-campo" for="${base}-v"><span class="p50-rotulo"><span>${rotulo}</span>${onde}</span><span class="cc-senha p50-senha"><input id="${base}-v" type="${fase.mostrando ? "text" : "password"}" name="valor" data-resposta="valor" autocomplete="off" data-1p-ignore data-lpignore="true" data-bwignore autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" maxlength="4096" placeholder="${esc(dica)}"${fase.ocupado ? " readonly" : ""}${invalido ? ` aria-invalid="true" aria-describedby="${base}-erro"` : ""} /><button type="button" class="cc-mostrar p50-mostrar" data-act="mostrar-credencial" data-id="${id}" aria-pressed="${fase.mostrando === true}" aria-controls="${base}-v">${fase.mostrando ? "Ocultar" : "Mostrar"}</button></span></label>
    ${erro}${fase.ocupado ? `<p class="p50-status" role="status"><span class="p50-gira" aria-hidden="true"></span>${esc(testando)}</p>` : ""}
    <p class="p50-sigilo">${ICONE_CADEADO}${esc(sigilo)}</p>
    <div class="p50-acoes">${fase.ocupado ? "" : `<button type="button" class="p50-deixar" data-act="recusar-credencial" data-id="${id}">Deixar de lado</button>`}<button type="submit" class="p50-guardar" data-id="${id}"${fase.ocupado ? ' aria-busy="true" disabled' : ""}>${guardar}</button></div>
  </form>`;
}

export function ehCartaoCredencial(p: Proposta | null | undefined): p is Proposta & { payload: PayloadPropostaCredencial } {
  return p?.payload.kind === "credencial";
}
