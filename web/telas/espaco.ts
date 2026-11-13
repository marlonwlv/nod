import type { Estado, SecaoEspaco } from "../estado/reducer.ts";
import { htmlAjustesDoMac, type AjustesMac } from "./ajustes-mac.ts";
import type { EstadoAvisos } from "../lib/avisos.ts";
import { ehCelular } from "../lib/celular.ts";
import { ICONE } from "../lib/icones.ts";
import { comSaibaMais } from "../lib/linha-config.ts";
import { esc } from "../lib/render.ts";
import type { Volta } from "../lib/volta.ts";
import { pilhaDeAvatares } from "./cartao-ia.ts";
import { renderProvedores } from "./provedores.ts";
import { botsDaPessoa, renderMaquinas } from "./maquinas.ts";
import { renderRelatos } from "./relatos.ts";
import { htmlPainelComputadorDoBot } from "../lib/computador-pessoa.ts";
import type { EscolhaTema } from "../lib/tema.ts";
import { renderConta, renderContaPagina, type DadosConta } from "./config-conta.ts";
import { iniciaisDeQuem } from "./menu-conta.ts";
import { renderAgentes } from "./config-agentes.ts";
import { renderGeral } from "./config-geral.ts";
import { renderAgendaRotinas, tituloDaAgendaCelular, valorDaAgenda } from "./agenda-rotinas.ts";
import { buscarAjustes, caminhoDoAjuste } from "../lib/ajustes.ts";
import type { EscolhaSons } from "../lib/sons.ts";

/**
 * ADR-167 (Configurações): a busca dos ajustes. Com termo, o conteúdo vira a lista do que casa — título, frase e
 * o caminho —, e o clique leva à linha (irAoAjuste em web/main.ts). Sem termo, a seção de sempre.
 */
export function renderBuscaAjustes(termo: string): string {
  const achados = buscarAjustes(termo);
  if (!achados.length) return `<section class="espaco-secao cfg-secao cfg-busca-resultado"><h2>Busca</h2><p class="cfg-busca-vazia" role="status">Nenhum ajuste com “${esc(termo.trim())}”.</p></section>`;
  const linhas = achados.map((a) => `<button type="button" class="cfg-achado" data-act="ir-ao-ajuste" data-ajuste="${esc(a.id)}"><span class="cfg-achado-txt"><b>${esc(a.titulo)}</b><small>${esc(a.frase)}</small></span><span class="cfg-achado-caminho">${caminhoDoAjuste(a).slice(1).map(esc).join(" › ")}</span></button>`).join("");
  return `<section class="espaco-secao cfg-secao cfg-busca-resultado"><h2>Busca</h2><p class="sr-only" role="status">${achados.length} ${achados.length === 1 ? "ajuste" : "ajustes"}</p><div class="cfg-achados">${linhas}</div></section>`;
}

/**
 * "Seu espaço" (definido em 2026-09-18): o que é da CONTA, não de um bot. definido em 2026-09-30 (canvas "Menu, sidebar e
 * gaveta"): abre pelo menu do avatar, em tela cheia por cima da tela atual, já na seção escolhida. As seções ficam na
 * coluna da esquerda, no lugar da barra lateral, e trocar de seção não empilha: o único botão de saída é "‹ <de onde
 * veio>" (mais o Esc), que diz para onde a pessoa volta. Sem ×: os dois fariam a mesma coisa.
 * NOD-367 (protótipo v2 do Gil, aprovado em 2026-10-26): passa a se chamar Configurações, com 6 seções fixas, nesta ordem.
 * Avisos e Preferências viram Geral; Este Mac, Computadores (as chaves) e o computador do bot (v2) viram Máquinas;
 * Relatos vira Feedback. A v2 não acrescenta seção. NOD-85: Rotinas entra entre Agentes e Feedback.
 */
export const SECOES_ESPACO: readonly { id: SecaoEspaco; nome: string; icone: string }[] = [
  { id: "conta", nome: "Conta", icone: ICONE.pessoa },
  { id: "geral", nome: "Geral", icone: ICONE.ajustes },
  // definido em 2026-10-10 (plano das IAs, protótipo Main): "Conexão" vira "Provedores de IA", com os logos das IAs.
  { id: "conexao", nome: "Provedores de IA", icone: pilhaDeAvatares(true) },
  { id: "maquinas", nome: "Máquinas", icone: ICONE.servidor },
  { id: "agentes", nome: "Agentes", icone: ICONE.agentes },
  // NOD-85: a agenda das rotinas, depois de Agentes (rotina é o que os agentes fazem sozinhos).
  { id: "rotinas", nome: "Rotinas", icone: ICONE.relogio },
  // ADR-166 (tela 07 do protótipo): os modos, as regras do revisor e o nível por app, antes de Feedback.
  { id: "aprovacoes", nome: "Aprovações", icone: ICONE.escudo },
  // Paper 07 (rodada 2): as chaves guardadas pelos cartões dos bots, entre Apps e IA no computador.
  { id: "cofre", nome: "Cofre", icone: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5.5" cy="10.5" r="3"/><path d="M7.6 8.4L13.5 2.5M11.5 4.5l1.5 1.5M10 6l1.2 1.2"/></svg>' },
  { id: "feedback", nome: "Feedback", icone: ICONE.bandeira },
];

const IC16 = (corpo: string): string => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
/** ADR-167 (Paper 07): os ícones da coluna das Configurações no computador. */
const ICONE_DA_SECAO: Partial<Record<SecaoEspaco, string>> = {
  geral: IC16('<path d="M6.9 1.8h2.2l.4 1.7 1.3.7 1.6-.6 1.1 1.9-1.3 1.2v1.5l1.3 1.2-1.1 1.9-1.6-.6-1.3.7-.4 1.7H6.9l-.4-1.7-1.3-.7-1.6.6-1.1-1.9 1.3-1.2V7.3L2.5 6.1l1.1-1.9 1.6.6 1.3-.7z"/><circle cx="8" cy="8" r="2"/>'),
  conta: IC16('<circle cx="8" cy="5.5" r="2.8"/><path d="M2.8 14a5.2 5.2 0 0110.4 0"/>'),
  maquinas: IC16('<rect x="2" y="2.5" width="12" height="8.5" rx="1.5"/><path d="M6 14h4M8 11v3"/>'),
  aprovacoes: IC16('<path d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z"/>'),
  conexao: IC16('<path d="M8 2l1.3 3.7L13 7l-3.7 1.3L8 12l-1.3-3.7L3 7l3.7-1.3z"/>'),
};
const ICONE_APPS = IC16('<rect x="2.5" y="2.5" width="4" height="4" rx="1"/><rect x="9.5" y="2.5" width="4" height="4" rx="1"/><rect x="2.5" y="9.5" width="4" height="4" rx="1"/><path d="M11.5 9.5v4M9.5 11.5h4"/>');

/** ADA-245 (jornada D): com o texto do onboarding, "Máquinas" se chama "Computadores". */
export function nomeDaSecao(s: { id: SecaoEspaco; nome: string }, estado: Pick<Estado, "onboardingTexto">): string {
  return s.id === "maquinas" && estado.onboardingTexto ? "Computadores" : s.nome;
}

/** O Entendi da faixa "entre nos sites de novo uma vez" fica neste navegador. */
export const CHAVE_AVISO_RECRIADO = "nod.computador.aviso-recriado";

function avisoRecriadoDispensado(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(CHAVE_AVISO_RECRIADO) === "1";
  } catch {
    return false;
  }
}

export type ExtrasEspaco = {
  conta: DadosConta;
  /** A página de Minha conta aberta dentro de Conta (NOD-346); null = a lista. */
  contaPagina: string | null;
  tema: EscolhaTema;
  /** O valor curto de Provedores de IA na lista do celular ("Conectada", "Simulação"…), o mesmo do menu da conta. */
  conexao?: string;
  /** ADR-167: o balão da pessoa na cor do bot e os sons deste computador. */
  balaoCor?: boolean;
  sons?: EscolhaSons;
  /** ADR-167: o termo da busca dos ajustes (vazio = a seção aberta). */
  buscaAjustes?: string;
  /** ADR-166: a seção Aprovações já desenhada (o estado dela mora em web/lib/ajustes-aprovacao.ts, fora do reducer). */
  aprovacoes?: () => string;
  /** Paper 07 (rodada 2): a seção Cofre já desenhada (o estado mora em web/lib/cofre.ts). */
  cofre?: () => string;
  /** ADR-173: Quick Chat e ferramentas do Mac; só no app do Mac (null/ausente na web, no Windows e na VM). */
  mac?: AjustesMac | null;
};

export function renderEspaco(estado: Estado, avisos: EstadoAvisos, volta: Volta, extras: ExtrasEspaco, celular = ehCelular()): string {
  if (celular) return renderEspacoCelular(estado, avisos, volta, extras);
  const secao = estado.espaco?.secao ?? "conexao";
  // ADR-167 (Paper 07): no computador as Configurações são um modal sobre o app — a busca no topo das seções, na ordem do
  // Paper (Geral, Conta, Máquinas, Aprovações, Apps, IA); Agentes, Rotinas e Feedback, que o Paper não desenhou, vêm depois.
  const item = (s: (typeof SECOES_ESPACO)[number]) => `<button type="button" class="espaco-item" data-act="secao-espaco" data-secao="${s.id}"${s.id === secao ? ' aria-current="page"' : ""}>${ICONE_DA_SECAO[s.id] ?? s.icone}<span>${esc(s.id === "conexao" ? "IA" : nomeDaSecao(s, estado))}</span></button>`;
  const porId = (id: SecaoEspaco) => SECOES_ESPACO.find((s) => s.id === id);
  const apps = `<button type="button" class="espaco-item" data-act="navegar" data-tela="conectores">${ICONE_APPS}<span>Apps</span></button>`;
  const doPaper = (["geral", "conta", "maquinas", "aprovacoes"] as const).map((id) => porId(id)).filter((s) => s !== undefined).map(item).join("") + apps + (["cofre", "conexao"] as const).map((id) => porId(id)).filter((s) => s !== undefined).map(item).join("");
  // Decisão do Marlon (rodada 2): Agentes, Rotinas e Feedback, que o Paper não desenhou, ficam no fim, num grupo à parte.
  const resto = SECOES_ESPACO.filter((s) => !["geral", "conta", "maquinas", "aprovacoes", "cofre", "conexao"].includes(s.id)).map(item).join("");
  const nav = `${doPaper}<span class="espaco-nav-sep" role="separator"></span>${resto}`;
  return `<div class="espaco cfg-espaco cfg-modal" role="dialog" aria-modal="true" aria-labelledby="espaco-titulo">
    <nav class="espaco-nav" aria-label="Seções das Configurações">
      <h1 id="espaco-titulo" class="sr-only">Configurações</h1>
      <label class="cfg-busca"><span aria-hidden="true"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg></span><input id="busca-ajustes" type="search" data-manter-foco="busca-ajustes" placeholder="Buscar ajustes" aria-label="Buscar ajustes" autocomplete="off" spellcheck="false" value="${esc(extras.buscaAjustes ?? "")}" /></label>
      <div class="espaco-itens">${nav}</div>
    </nav>
    <main class="espaco-conteudo"><div class="cfg-modal-topo"><button type="button" class="espaco-voltar cfg-fechar" data-act="fechar-espaco" aria-keyshortcuts="Escape" aria-label="Fechar as Configurações e voltar para ${esc(volta.rotulo)}" title="Fechar (Esc)"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>${extras.buscaAjustes?.trim() ? renderBuscaAjustes(extras.buscaAjustes) : conteudo(estado, secao, avisos, extras)}</main>
  </div>`;
}

/**
 * NOD-383 (critério 3, Gil itens 1-3): no celular as Configurações são uma lista agrupada, estilo Ajustes — a Conta (avatar,
 * nome e e-mail), as quatro do meio e Feedback por último —, e cada seção abre em tela cheia com o ‹ que volta para a lista.
 * A lista volta para onde a pessoa estava. Sem abas, sem atalho de teclado.
 */
function renderEspacoCelular(estado: Estado, avisos: EstadoAvisos, volta: Volta, extras: ExtrasEspaco): string {
  const esp = estado.espaco;
  const secao = esp?.secao ?? "geral";
  if (esp?.lista) {
    return `<div class="espaco cfg-espaco cfg-celular cfg-lista-tela" role="dialog" aria-modal="true" aria-labelledby="espaco-titulo">
      <div class="cfg-topo"><button type="button" class="espaco-voltar cfg-redondo" data-act="fechar-espaco" aria-label="Voltar para ${esc(volta.rotulo)}">${ICONE.voltar}</button></div>
      <main class="espaco-conteudo cfg-lista-secoes">
        <h1 id="espaco-titulo" class="cfg-titulo-grande">Configurações</h1>
        ${listaDeSecoes(estado, extras)}
      </main>
    </div>`;
  }
  const achada = SECOES_ESPACO.find((s) => s.id === secao);
  const nome = achada ? nomeDaSecao(achada, estado) : "Configurações";
  const corpo = comSaibaMais({ celular: true, abertos: estado.configUi.abertos }, () => conteudo(estado, secao, avisos, extras, true));
  return `<div class="espaco cfg-espaco cfg-celular cfg-secao-tela" role="dialog" aria-modal="true" aria-labelledby="espaco-titulo">
    <div class="cfg-topo"><button type="button" class="espaco-voltar cfg-redondo" data-act="cfg-lista" aria-label="Voltar para Configurações">${ICONE.voltar}</button><h1 id="espaco-titulo" class="cfg-topo-tit">${secao === "rotinas" ? tituloDaAgendaCelular(estado) : esc(nome)}</h1></div>
    <main class="espaco-conteudo" data-secao-aberta="${secao}">${corpo}</main>
  </div>`;
}

/** A lista do celular: cada linha é ícone de traço, título, no máximo um valor curto e ›; nada embaixo do título. */
function listaDeSecoes(estado: Estado, extras: ExtrasEspaco): string {
  const linha = (s: (typeof SECOES_ESPACO)[number], valor = "") => `<button type="button" class="cfg-item" data-act="secao-espaco" data-secao="${s.id}"><span class="cfg-item-ic" aria-hidden="true">${s.icone}</span><span class="cfg-item-nome">${esc(nomeDaSecao(s, estado))}</span>${valor ? `<span class="cfg-item-valor">${esc(valor)}</span>` : ""}<span class="cfg-item-seta" aria-hidden="true">${ICONE.seta}</span></button>`;
  const secao = (id: SecaoEspaco) => SECOES_ESPACO.find((s) => s.id === id)!;
  const c = extras.conta;
  const quem = c.nome ?? c.email ?? "Você";
  const conta = `<button type="button" class="cfg-item cfg-item-conta" data-act="secao-espaco" data-secao="conta"><span class="mc-av mc-av-g" aria-hidden="true">${esc(iniciaisDeQuem(c.nome, c.email))}</span><span class="cfg-item-nome"><b>${esc(quem)}</b>${c.nome && c.email ? `<small>${esc(c.email)}</small>` : ""}</span><span class="cfg-item-seta" aria-hidden="true">${ICONE.seta}</span></button>`;
  const maquinas = estado.maquinas ? String(estado.maquinas.maquinas.length) : "";
  const agentes = estado.frota ? String(botsDaPessoa(estado).length) : "";
  const grupo = (html: string) => `<div class="cfg-grupo">${html}</div>`;
  // Toda seção de SECOES_ESPACO entra aqui (a emenda da ADR-094 manda reverter se uma ficar de fora): a Conta no topo, o
  // Feedback sozinho embaixo, as outras no meio, na ordem do desktop.
  const valores: Partial<Record<SecaoEspaco, string>> = { conexao: extras.conexao ?? "", maquinas, agentes, rotinas: valorDaAgenda(estado) };
  const meio = SECOES_ESPACO.filter((s) => s.id !== "conta" && s.id !== "feedback").map((s) => linha(s, valores[s.id])).join("");
  return `<nav aria-label="Seções das Configurações">${grupo(conta)}${grupo(meio)}${grupo(linha(secao("feedback")))}</nav>`;
}

function conteudo(estado: Estado, secao: SecaoEspaco, avisos: EstadoAvisos, extras: ExtrasEspaco, celular = false): string {
  switch (secao) {
    case "conta":
      return extras.contaPagina !== null ? renderContaPagina(extras.contaPagina) : renderConta(extras.conta, celular);
    case "geral":
      return renderGeral({
        tema: extras.tema,
        avisos,
        modoDev: estado.modoDev.ligado,
        experimentos: estado.experimentos,
        quadroLiberado: estado.quadroLiberado ?? false,
        ...(extras.balaoCor !== undefined ? { balaoCor: extras.balaoCor } : {}),
        ...(extras.sons ? { sons: extras.sons } : {}),
      }, estado.configUi, celular);
    case "conexao":
      return renderProvedores(estado);
    case "maquinas":
      return `${renderSecaoMaquinas(estado)}${extras.mac ? htmlAjustesDoMac(extras.mac) : ""}`;
    case "agentes":
      return renderAgentes(estado);
    case "aprovacoes":
      return extras.aprovacoes?.() ?? '<section class="cfg-secao"><h2>Aprovações</h2><p class="lc-vazio">Carregando…</p></section>';
    case "rotinas":
      return renderAgendaRotinas(estado, celular);
    case "cofre":
      return extras.cofre?.() ?? '<section class="cfg-secao"><h2>Cofre</h2><p class="lc-nota">Abrindo o cofre…</p></section>';
    case "feedback":
      return renderRelatos(estado);
  }
}

/** Máquinas: a lista única (com Este Mac e as chaves dentro) e, na v2, o computador do bot. */
function renderSecaoMaquinas(estado: Estado): string {
  const cb = estado.computadorPessoa ? htmlPainelComputadorDoBot(estado.computadorPessoa, estado.frota?.agentes ?? [], estado.computadorUi, estado.agora, avisoRecriadoDispensado()) : "";
  return `${renderMaquinas(estado)}${cb}`;
}
