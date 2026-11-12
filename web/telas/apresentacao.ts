import type { CorAgente, FormaAgente } from "../../src/contracts/agente.ts";
import { esc, iconeAgente } from "../lib/render.ts";
import type { EstadoMascote } from "../lib/mascote.ts";
import type { EstadoPreparo } from "../lib/preparo.ts";
import { COR_PADRAO, FORMA_PADRAO, NOME_MAX, htmlPreparo, htmlSeletorCor, htmlSeletorForma } from "./criar-bot.ts";

/**
 * ADR-174 (2026-11-12, tela 13 do Paper): o onboarding inteiro, em 10 passos curtos com o personagem como fio
 * condutor — boas-vindas, conhecer, "tem o próprio computador", dar um trabalho, delegar, função, como conheceu, conectar
 * apps, criar o bot (cor e forma) e preparando com %. Comportamento e visual de referência; os textos são os do protótipo do
 * Paper. Substitui o "olá" de 3,3 s da ADR-077: a ligação continua como opção ("Prefiro conversar por voz"), que segue o
 * caminho de antes (a IA dos bots, a ligação e os cards).
 *
 * Aqui só o modelo e o desenho, puros e sem DOM (tests/unit/web/apresentacao.test.ts). Quem guarda o passo, roda o
 * preparo e fala com o servidor é web/telas/onboarding-controle.ts.
 */

export const PASSOS = ["boas-vindas", "conhecer", "computador", "trabalho", "delegar", "funcao", "origem", "apps", "criar", "preparando"] as const;
export type PassoApresentacao = (typeof PASSOS)[number];

export const FUNCOES = ["Produto", "Vendas", "Atendimento", "Finanças", "Operações", "Vida pessoal"] as const;
export const ORIGENS = ["X", "Instagram", "YouTube", "LinkedIn", "Busca", "Amigo ou colega", "Assistente de IA"] as const;
/** Os apps do passo 8: o Google primeiro (o mais comum), marcado "Sugerido" quando o e-mail é do Google. */
export const APPS = [
  { slug: "gmail", nome: "Gmail" },
  { slug: "googlecalendar", nome: "Google Agenda" },
  { slug: "slack", nome: "Slack" },
  { slug: "linear", nome: "Linear" },
] as const;

/** Por função, um nome e um primeiro trabalho sugeridos para o bot do passo 9 (a pessoa troca os dois). */
export const SUGESTAO_POR_FUNCAO: Record<(typeof FUNCOES)[number], { nome: string; tarefa: string }> = {
  Produto: { nome: "Lia", tarefa: "Organize as ideias desta semana em issues" },
  Vendas: { nome: "Bia", tarefa: "Liste os leads sem resposta há mais de 3 dias" },
  Atendimento: { nome: "Téo", tarefa: "Resuma os chamados abertos de hoje" },
  Finanças: { nome: "Nina", tarefa: "Cobre as faturas vencidas desta semana" },
  Operações: { nome: "Rui", tarefa: "Faça a daily do time com o que andou ontem" },
  "Vida pessoal": { nome: "Lua", tarefa: "Organize minha semana na agenda" },
};

export type EstadoApresentacao = {
  passo: number;
  funcao: string | null;
  origem: string | null;
  /** Os slugs dos apps conectados neste onboarding. */
  apps: string[];
  nome: string;
  forma: FormaAgente;
  cor: CorAgente;
  /** A primeira mensagem para o bot (o campo do passo 9). */
  primeira: string;
  preparo: EstadoPreparo | null;
  /** O slug do app cujo login está aberto agora. */
  conectando: string | null;
};

export function apresentacaoInicial(): EstadoApresentacao {
  return { passo: 0, funcao: null, origem: null, apps: [], nome: "", forma: FORMA_PADRAO, cor: COR_PADRAO, primeira: "", preparo: null, conectando: null };
}

/** Os passos que dá para pular (6 e 7, como no protótipo; e "Agora não" nos apps). */
export const PULAVEIS: ReadonlySet<PassoApresentacao> = new Set(["funcao", "origem", "apps"]);

export const passoAtual = (e: Pick<EstadoApresentacao, "passo">): PassoApresentacao => PASSOS[Math.max(0, Math.min(PASSOS.length - 1, e.passo))] ?? "boas-vindas";

/** Anda um passo (±1), sem sair dos limites nem voltar do preparo para trás. */
export function andar(e: EstadoApresentacao, delta: 1 | -1): EstadoApresentacao {
  if (passoAtual(e) === "preparando") return e;
  const passo = Math.max(0, Math.min(PASSOS.indexOf("criar"), e.passo + delta));
  // Chegando ao passo 9 com a função escolhida e sem nome ainda: o nome e o trabalho sugeridos já vêm preenchidos.
  if (PASSOS[passo] === "criar" && !e.nome) {
    const s = e.funcao ? SUGESTAO_POR_FUNCAO[e.funcao as keyof typeof SUGESTAO_POR_FUNCAO] : undefined;
    return { ...e, passo, nome: s?.nome ?? "", primeira: e.primeira || "" };
  }
  return { ...e, passo };
}

/** O nome que o bot leva (o digitado, ou "seu bot" sem nome). */
export const nomeDoBot = (e: Pick<EstadoApresentacao, "nome">): string => e.nome.trim().slice(0, NOME_MAX);

/** O personagem de cada passo: dorme e acorda no 2, trabalha no 3, pensa na função, lê nos apps, comemora no fim. */
export function personagemDoPasso(e: EstadoApresentacao): EstadoMascote {
  switch (passoAtual(e)) {
    case "boas-vindas": return "disponivel";
    // O Paper mostra o nod grande e de olhos abertos: o "pensando" do Bloub vira três pontos e esconde o personagem.
    case "conhecer": return "disponivel";
    case "computador": return "trabalhando";
    case "trabalho": return "disponivel";
    case "delegar": return "trabalhando";
    case "funcao": return e.funcao ? "comemorando" : "pensando";
    case "origem": return e.origem ? "comemorando" : "pensando";
    case "apps": return e.conectando ? "aguardando" : "lendo";
    case "criar": return "disponivel";
    case "preparando": return e.preparo?.pronto ? "comemorando" : e.preparo?.erro ? "aguardando" : "lendo";
  }
}

const NOD = { nome: "nod", cor: "c-black" as CorAgente, forma: "shape-pebble" as FormaAgente };
const SETA = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Os pontinhos de progresso (o atual é um traço), como no protótipo. */
function pontos(passo: number): string {
  const itens = PASSOS.map((_, i) => `<span class="ap-ponto${i === passo ? " atual" : ""}"></span>`).join("");
  return `<div class="ap-pontos" role="img" aria-label="Passo ${passo + 1} de ${PASSOS.length}">${itens}</div>`;
}

const botaoSeguir = (rotulo = "Continuar", desligado = false): string => `<button type="button" class="bt pri ap-seguir" data-act="apres-seguir"${desligado ? " disabled" : ""}>${esc(rotulo)}</button>`;
const botaoPular = (rotulo = "Pular"): string => `<button type="button" class="bt link ap-pular" data-act="apres-pular">${esc(rotulo)}</button>`;

function rodape(e: EstadoApresentacao, acoes: string): string {
  return `<footer class="ap-rodape">${pontos(e.passo)}<div class="ap-acoes">${acoes}</div></footer>`;
}

function fichas(lista: readonly string[], atual: string | null, campo: "funcao" | "origem"): string {
  return `<div class="ap-fichas" role="radiogroup">${lista.map((v) => `<button type="button" class="ap-ficha" role="radio" aria-checked="${v === atual}" data-act="apres-escolher" data-campo="${campo}" data-valor="${esc(v)}">${esc(v)}</button>`).join("")}</div>`;
}

/** A cena do passo 3: uma janela do computador do bot com um cursor que anda e clica. */
const CENA_COMPUTADOR = `<div class="ap-cena-pc" aria-hidden="true"><div class="ap-pc-barra"></div><div class="ap-pc-tela"><span class="ap-pc-linha l1"></span><span class="ap-pc-linha l2"></span><span class="ap-pc-linha l3"></span><span class="ap-pc-cursor"></span></div></div>`;

/** O desfile do passo 4: três bots de exemplo, cada um com uma função. */
function desfile(): string {
  const bots = [
    { nome: "Cobra faturas", cor: "c-green" as CorAgente, forma: "shape-capsule" as FormaAgente },
    { nome: "Daily do time", cor: "c-blue" as CorAgente, forma: "shape-circle" as FormaAgente },
    { nome: "Triagem de e-mail", cor: "c-purple" as CorAgente, forma: "shape-hex" as FormaAgente },
  ];
  return `<div class="ap-desfile">${bots.map((b, i) => `<div class="ap-exemplo" style="--atraso:${i * 120}ms">${iconeAgente(b, "lg", i === 1 ? "lendo" : "disponivel")}<span>${esc(b.nome)}</span></div>`).join("")}</div>`;
}

/** O quadro do passo 5: A fazer, Fazendo, Feito com bots nos cartões. */
function quadro(): string {
  const cartao = (cor: CorAgente, forma: FormaAgente, estado: EstadoMascote = "disponivel") => `<span class="ap-cartao">${iconeAgente({ nome: "", cor, forma }, "sm", estado)}<i></i></span>`;
  return `<div class="ap-quadro" aria-hidden="true">
    <div><b>A fazer</b>${cartao("c-purple", "shape-hex")}${cartao("c-blue", "shape-circle")}</div>
    <div><b>Fazendo</b>${cartao("c-orange", "shape-star", "lendo")}</div>
    <div><b>Feito</b>${cartao("c-green", "shape-drop")}${cartao("c-pink", "shape-cloud")}</div></div>`;
}

/** Tela 13 do Paper: o ícone de traço de cada app na linha (envelope, agenda, a cerquilha do Slack, o quadro do Linear). */
const tracoApp = (d: string): string => `<svg class="ap-app-ic" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONE_APP: Record<(typeof APPS)[number]["slug"], string> = {
  gmail: tracoApp('<rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M2.5 4.5 8 9l5.5-4.5"/>'),
  googlecalendar: tracoApp('<rect x="2.5" y="3" width="11" height="10.5" rx="1.5"/><path d="M2.5 6.5h11M5.5 1.8v2.4M10.5 1.8v2.4"/>'),
  slack: tracoApp('<path d="M6 2.5v11M10 2.5v11M2.5 6h11M2.5 10h11"/>'),
  linear: tracoApp('<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M6 2.5v11"/>'),
};

function htmlApps(e: EstadoApresentacao, emailGoogle: boolean): string {
  const linhas = APPS.map((a, i) => {
    const feito = e.apps.includes(a.slug);
    const sugerido = emailGoogle && i < 2 && !feito ? '<span class="ap-sugerido">Sugerido</span>' : "";
    const botao = feito
      ? '<span class="ap-conectado">Conectado</span>'
      : `<button type="button" class="bt${i === 0 ? " pri" : ""}" data-act="apres-conectar" data-slug="${a.slug}"${e.conectando === a.slug ? ' aria-busy="true" disabled' : ""}>${e.conectando === a.slug ? "Conectando…" : "Conectar"}</button>`;
    return `<li class="ap-app">${ICONE_APP[a.slug]}<span class="ap-app-nome">${esc(a.nome)}</span>${sugerido}${botao}</li>`;
  }).join("");
  return `<ul class="ap-apps">${linhas}</ul>`;
}

/**
 * A camada inteira de um passo. `ctx.emailGoogle` liga o "Sugerido" do Google; `ctx.ligacao` mostra "Prefiro conversar
 * por voz" na abertura (o caminho da ADR-077).
 */
export function htmlApresentacao(e: EstadoApresentacao, ctx: { emailGoogle: boolean; ligacao: boolean }): string {
  const p = passoAtual(e);
  const nome = nomeDoBot(e) || "seu bot";
  const bot = { nome, cor: e.cor, forma: e.forma };
  const personagem = (tamanho: "lg" | "xl" | "xxl" = "xl", quem = NOD) => `<div class="ap-personagem">${iconeAgente(quem, tamanho, personagemDoPasso(e))}</div>`;
  let corpo = "";
  let acoes = botaoSeguir();
  switch (p) {
    case "boas-vindas":
      return `<section class="ap ap-boas-vindas" aria-labelledby="ap-titulo">
        <div class="ap-marca">${iconeAgente(NOD, "lg", "disponivel")}<h1 id="ap-titulo" tabindex="-1">nod</h1></div>
        <p class="ap-sub">Sua equipe de bots, sempre ligada, para quem você dá trabalho de verdade.</p>
        <button type="button" class="bt pri ap-entrar" data-act="apres-seguir">Entrar ${SETA}</button>
        ${ctx.ligacao ? '<button type="button" class="bt link ap-voz" data-act="apres-ligacao">Prefiro conversar por voz</button>' : ""}
        <p class="ap-termos">Ao usar o nod, você concorda com os Termos.</p></section>`;
    case "conhecer":
      corpo = `${personagem("xxl")}<h1 id="ap-titulo" tabindex="-1">Este é o nod</h1><p class="ap-sub">Ele ouve, pensa e faz. Você aprova o que sai daqui.</p>`;
      break;
    case "computador":
      corpo = `${CENA_COMPUTADOR}<h1 id="ap-titulo" tabindex="-1">Ele tem o próprio computador</h1><p class="ap-sub">Roda no seu Mac, numa VM sua ou numa VM do nod.</p>`;
      break;
    case "trabalho":
      corpo = `${desfile()}<h1 id="ap-titulo" tabindex="-1">Dê um trabalho a cada bot</h1><p class="ap-sub">Um bot, uma função. Eles se ajudam entre si.</p>`;
      break;
    case "delegar":
      corpo = `${quadro()}<h1 id="ap-titulo" tabindex="-1">Passe qualquer tarefa ao seu time</h1><p class="ap-sub">O quadro mostra quem está com o quê.</p>`;
      break;
    case "funcao":
      // Tela 13 do Paper: os passos 6, 7 e 8 não têm o personagem (só a pergunta e as fichas).
      corpo = `<h1 id="ap-titulo" tabindex="-1">No que você mais vai trabalhar?</h1><p class="ap-sub">Sugerimos bots para começar.</p>${fichas(FUNCOES, e.funcao, "funcao")}`;
      acoes = `${botaoPular()}${botaoSeguir("Continuar", !e.funcao)}`;
      break;
    case "origem":
      corpo = `<h1 id="ap-titulo" tabindex="-1">Como você conheceu o nod?</h1>${fichas(ORIGENS, e.origem, "origem")}`;
      acoes = `${botaoPular()}${botaoSeguir("Continuar", !e.origem)}`;
      break;
    case "apps":
      corpo = `<h1 id="ap-titulo" tabindex="-1">Conecte seus apps</h1><p class="ap-sub">${ctx.emailGoogle ? "Vimos que seu e-mail é Google." : "O bot só vê o que você liberar."}</p>${htmlApps(e, ctx.emailGoogle)}`;
      acoes = e.apps.length ? botaoSeguir() : botaoPular("Agora não");
      break;
    case "criar":
      corpo = `<div class="ap-personagem ap-previa">${iconeAgente(bot, "xxl", "disponivel")}</div>
        <h1 id="ap-titulo" class="ap-titulo-discreto" tabindex="-1">Crie o seu bot</h1>
        <input class="ap-nome" data-campo-apres="nome" value="${esc(e.nome)}" maxlength="${NOME_MAX}" placeholder="Nome do bot" aria-label="Nome do bot" autocomplete="off" />
        ${htmlSeletorForma(e.forma, e.cor, "apres-forma")}
        ${htmlSeletorCor(e.cor, "apres-cor", true)}
        <div class="ap-composer"><textarea data-campo-apres="primeira" rows="1" maxlength="2000" placeholder="${esc(`O que ${nome} deve fazer primeiro?`)}" aria-label="${esc(`O que ${nome} deve fazer primeiro?`)}">${esc(e.primeira)}</textarea><button type="button" class="ap-enviar" data-act="apres-criar" aria-label="Criar e mandar"${nomeDoBot(e) ? "" : " disabled"}>${SETA}</button></div>`;
      acoes = "";
      break;
    case "preparando":
      corpo = e.preparo ? htmlPreparo(e.preparo, bot, { tentar: 'data-act="apres-tentar"', ver: 'data-act="apres-ver"' }) : "";
      acoes = "";
      break;
  }
  const voltar = e.passo > 0 && p !== "preparando" ? '<button type="button" class="ap-voltar" data-act="apres-voltar" aria-label="Voltar">‹</button>' : "";
  return `<section class="ap ap-${p}" aria-labelledby="ap-titulo">${voltar}<div class="ap-palco" data-passo="${p}">${corpo}</div>${rodape(e, acoes)}</section>`;
}

/** O e-mail é do Google (gmail.com ou googlemail.com): o passo dos apps sugere Gmail e Agenda. */
export function emailDoGoogle(email: string | null | undefined): boolean {
  return /@(gmail|googlemail)\.com$/i.test(email ?? "");
}
