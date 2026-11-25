import type { AbaNavegador, AvisoNavegador, CaixaNavegador, LugarNavegador, PedidoDaVistaNavegador, RespostaNavegador, VistaNavegador } from "../../src/contracts/navegador-do-bot.ts";
import { esc } from "./escape.ts";

// ---- o nome do bot em pt-BR (definido em 2026-11-20: sem saber o gênero, nome terminado em "a" é feminino) -------------

/**
 * "Ada", "Nina" → feminino; "Milton", "Nod" → masculino. Sem o gênero no DTO, a terminação decide. revisto em
 * 2026-11-25 (QA do Windows): decide a primeira palavra, o substantivo que manda no gênero ("Leitor QA" é ele; pela
 * última, o "A" da sigla dava "A Leitor QA precisa de você").
 */
export function feminino(nome: string): boolean {
  const primeira = nome.trim().split(/\s+/u)[0] ?? "";
  return /a$/u.test(primeira.toLowerCase());
}
/** "itau.com.br" → "Itau"; "Itaú" fica "Itaú". O que o bot disse vale mais que o domínio (ele sabe o acento). */
export function nomeDoSite(site: string): string {
  const t = site.trim();
  if (!t) return "o site";
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/iu.test(t)) return t;
  const partes = t.toLowerCase().replace(/^www\./u, "").split(".");
  const raiz = partes[0] ?? t;
  return raiz.charAt(0).toUpperCase() + raiz.slice(1);
}

/** "no Itaú", "na TAP": sigla e nome que termina em "a" pedem "na". definido em 2026-11-20: heurística, sem lista de sites. */
export function noOuNa(nome: string): string {
  const sigla = /^[A-Z0-9]{2,5}$/u.test(nome);
  return sigla || /a$/u.test(nome) ? "na" : "no";
}

/** "a" ou "o" ("Ensinando a Ada", "Recado para o Milton"). */
export function artigo(nome: string): string {
  return feminino(nome) ? "a" : "o";
}
/** "da Ada", "do Milton" ("Navegador da Ada"). */
export function deNome(nome: string): string {
  return `${feminino(nome) ? "da" : "do"} ${nome}`;
}
/** "à Ada", "ao Milton" ("Devolver à Ada"). */
export function aoNome(nome: string): string {
  return `${feminino(nome) ? "à" : "ao"} ${nome}`;
}
/** "a Ada", "o Milton" ("Recado para a Ada"). */
export function comArtigo(nome: string): string {
  return `${artigo(nome)} ${nome}`;
}
/** "ela", "ele". */
export function pronome(nome: string): string {
  return feminino(nome) ? "ela" : "ele";
}
/** 5d (Paper): "Navegador da Ada fechado. Ela continua trabalhando." (o aviso com Desfazer e ⌘⇧T). */
export function avisoDaAbaFechada(nome: string): string {
  return `Navegador ${deNome(nome)} fechado. ${fraseMaiuscula(pronome(nome))} continua trabalhando.`;
}
/** T1: o subtítulo de "Ensinar uma tarefa", igual no + do campo e no ⋯ do navegador. */
export function subtituloDeEnsinar(nome: string): string {
  return `Mostre no navegador ${deNome(nome)}; ${pronome(nome)} aprende`;
}
/** As aspas retas de um nome citado viram curvas ("Faturas" → “Faturas”); aspa sem par fica como está. */
export function aspasCurvas(t: string): string {
  return t.replace(/"([^"\n]*)"/gu, "\u201c$1\u201d");
}

/**
 * A vista do navegador do bot na web (ADR-190; Paper "Navegador, computador e seu Mac", linhas 1, 5 e 1+5, detalhes D1–D8).
 * Tudo aqui é puro (sem DOM): o HTML sai pronto, as contas de tamanho e de coordenada são funções, e o teste unitário lê
 * sem navegador. O controlador que liga o canal ao vivo e desenha os quadros mora em web/telas/navegador-vista.ts; o painel,
 * a aba, a tela cheia e a folha do celular em web/telas/navegador.ts.
 *
 * Regra da D1d (2026-11-20): nada do nod cobre a imagem do site. Por cima dela só o cursor com o nome do bot, o anel no
 * alvo, a ondinha do clique e o realce do botão de uma aprovação (A1). A pílula mora numa faixa de 52 px embaixo, os avisos
 * do site numa faixa fina entre o cabeçalho e a vista, e a legenda do passo sai da vista.
 */

// ---- a pílula (D1b, opção A; D4) ---------------------------------------------------------------------------------------

/** Os estados da pílula: os quatro da tela cheia do computador, mais o login (D4, D) e a aprovação (A1). */
export type EstadoPilula = "assistindo" | "assumindo" | "controle" | "precisa" | "login" | "aprovacao";

/** D4, B: o "Assumindo…" só aparece se o assumir passar disto (igual ao computador, MS_ASSUMINDO_VISIVEL). */
export const MS_ASSUMINDO_VISIVEL = 300;
/** D4, A: a dica "Assumir para mexer" perto do cursor dura isto. */
export const MS_DICA_ASSUMIR = 2_000;

export function estadoDaPilula(v: Pick<VistaNavegador, "controle" | "pedido">, assumindoDesde: number | null, agora: number): EstadoPilula {
  if (v.pedido?.tipo === "aprovacao") return "aprovacao";
  if (v.pedido?.tipo === "login") return "login";
  // definido em 2026-11-21: o pedido de ajuda já entrega o navegador (controle "pessoa"), mas a pílula segue dizendo que a
  // Ada espera — "Precisa de você · Já resolvi", como o login ("espera você entrar · Pronto, pode seguir").
  if (v.pedido?.tipo === "ajuda") return "precisa";
  if (v.controle === "pessoa") return "controle";
  if (assumindoDesde !== null && agora - assumindoDesde >= MS_ASSUMINDO_VISIVEL) return "assumindo";
  if (v.controle === "soltando") return "assumindo";
  return v.controle === "precisa_de_voce" ? "precisa" : "assistindo";
}

const svg12 = (corpo: string) => `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
const OLHO = svg12('<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>');
const CURSOR_NA_JANELA = svg12('<path d="M12.03 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7"/><path d="M3 9h18"/><path d="m14.6 14.6 6.1 2.5-2.6 1-1 2.6z"/>');
const GIRO = '<span class="nv-giro" aria-hidden="true"></span>';

/**
 * revisto em 2026-11-25 (QA do navegador no Windows): os atalhos se mostravam com ⌘ também no Windows, onde a tecla é
 * Ctrl (web/telas/navegador.ts já escuta Ctrl fora do Mac). A tela diz uma vez em que teclado está; o padrão é o do Mac.
 */
let tecladoDoMac = true;
export function definirTecladoDoMac(mac: boolean): void { tecladoDoMac = mac; }
/** "⌘⇧F" no Mac; "Ctrl+Shift+F" fora dele. */
export function tecla(mac: string): string {
  if (tecladoDoMac) return mac;
  return mac.replace("⌘", "Ctrl+").replace("⌥", "Alt+").replace("⇧", "Shift+");
}
/** O aria-keyshortcuts: Meta no Mac, Control fora dele. */
export function ariaTecla(mac: string): string {
  return tecladoDoMac ? mac : mac.replace(/\bMeta\b/g, "Control");
}

/** O rótulo do botão de uma aprovação (A1): pagar com Touch ID, ou o nome do botão do site ("Apagar", "Enviar"). */
/**
 * 2026-11-22 (o navegador no PC): os textos do aparelho da pessoa — cópia de `textosDoAparelho` (src/domain/navegador-cofre.ts;
 * a web só importa tipos de src/, e tests/unit/web/navegador-vista.test.ts confere as duas).
 */
export function textosDoAparelhoNaWeb(a: "mac" | "pc" | undefined) {
  // QA do Windows (2026-11-25): sem o aparelho (o painel "não está ligado aqui"), dizia "no seu Mac" num PC.
  const pc = a ? a === "pc" : !tecladoDoMac;
  const nome = pc ? "PC" : "Mac";
  const confirmacao = pc ? "Windows Hello" : "Touch ID";
  return {
    nome,
    confirmacao,
    semAparelho: `precisa do seu ${nome} ligado`,
    confirmeNoAparelho: `Confirme no seu ${nome}`,
    pedeNaHoraDePagar: `O seu ${nome} pede o ${confirmacao} na hora de pagar.`,
    pedeParaGuardarLimite: `O seu ${nome} pede o ${confirmacao} para guardar o limite.`,
    pedeNoLogin: pc ? "O Windows pede o Windows Hello (ou a senha do Windows). A senha vai direto para a página." : "O seu Mac pede o Touch ID ou a senha do Keychain. A senha vai direto para a página.",
    pagarCom: `Pagar com ${confirmacao}`,
    pagarSem: `Pagar sem ${confirmacao}`,
  };
}

export function rotuloDaAprovacao(p: Extract<PedidoDaVistaNavegador, { tipo: "aprovacao" }>, aparelho?: "mac" | "pc"): string {
  // Achado do crítico (2026-11-20): sem o app do Mac o botão diz que não vai pedir o Touch ID (no PC, o Windows Hello).
  if (p.classe === "pagar") return p.touchId ? textosDoAparelhoNaWeb(aparelho).pagarCom : textosDoAparelhoNaWeb(aparelho).pagarSem;
  const b = p.botao.trim();
  return b ? b.charAt(0).toUpperCase() + b.slice(1, 40) : p.classe === "apagar" ? "Apagar" : "Enviar";
}

/** A pergunta curta da pílula na aprovação, pelo tipo da ação (a inteira vai no cartão). */
const PERGUNTA_CURTA: Readonly<Record<"pagar" | "apagar" | "enviar", string>> = { pagar: "Posso pagar?", apagar: "Posso apagar?", enviar: "Posso enviar?" };

/**
 * A pílula (D1b, A): a mesma da tela cheia do computador (`.ctc-controle`, branca nos dois temas), com o texto do navegador.
 * O botão muda de nome, nunca de lugar (D4). No navegador o devolver diz "Devolver à {Bot}" (D1b, ajuste aceito). Na
 * aprovação (A1) o "sim" é preto como o botão do cartão e, sem o app do Mac, o aviso curto do cartão vai embaixo.
 */
export function htmlPilula(nome: string, estado: EstadoPilula, pedido: PedidoDaVistaNavegador | null = null, terminouEm: number | null = null, devolveEm: number | null = null, aparelho?: "mac" | "pc"): string {
  const nomeE = esc(nome);
  // D4 (Paper): "A Ada espera você entrar", "A Ada está terminando um clique…", "A Ada espera · ⌘⇧A devolve".
  const quem = esc(fraseMaiuscula(comArtigo(nome)));
  const assumir = (desligado = false) => `<button type="button" class="ctc-bt ctc-assumir nv-assumir" data-nv="assumir"${desligado ? ' disabled aria-disabled="true"' : ""}><span class="ctc-pulso" aria-hidden="true"></span>Assumir o controle</button>`;
  let corpo: string;
  switch (estado) {
    case "controle":
      // 2026-11-22: parado há 4 min, o controle está para voltar sozinho (DEVOLVE_SOZINHO_MS no servidor).
      corpo = `<span class="ctc-estado"${devolveEm ? ' role="status"' : ""}>${CURSOR_NA_JANELA}<span>${devolveEm ? `Volta ${esc(aoNome(nome))} em 1 min` : "Você está no controle"}</span></span><button type="button" class="ctc-bt ctc-parar nv-devolver" data-nv="devolver" aria-keyshortcuts="${ariaTecla("Meta+Shift+A")}" title="${quem} espera · ${tecla("⌘⇧A")} devolve">Devolver ${esc(aoNome(nome))}</button>`;
      break;
    case "assumindo":
      corpo = `<span class="ctc-estado" role="status">${GIRO}<span>Assumindo…</span><span class="sr-only"> ${quem} está terminando um clique…</span></span>${assumir(true)}`;
      break;
    case "precisa":
      corpo = `<span class="ctc-estado nv-precisa-txt"><i class="ctc-ponto nv-ponto-precisa" aria-hidden="true"></i><span>Precisa de você</span></span><span class="ctc-acoes"><button type="button" class="ctc-bt ctc-parar" data-nv="resolver">Já resolvi</button>${pedido?.tipo === "ajuda" ? "" : assumir()}</span>`;
      break;
    case "login":
      corpo = `<span class="ctc-estado nv-precisa-txt"><span>${quem} espera você entrar</span></span><button type="button" class="ctc-bt nv-pronto" data-nv="resolver">Pronto, pode seguir</button>`;
      break;
    case "aprovacao": {
      const p = pedido?.tipo === "aprovacao" ? pedido : null;
      const pergunta = p ? esc(p.pergunta) : "Posso seguir?";
      // Ponto 14 dos cenários (2026-11-22): a pergunta inteira cortava ("Checkout no saucedemo.c…"); na pílula vai a curta,
      // pelo tipo da ação, e a inteira fica no title, no leitor de tela e no cartão.
      const curta = p ? PERGUNTA_CURTA[p.classe] : "Posso seguir?";
      const sim = p ? esc(rotuloDaAprovacao(p, aparelho)) : "Sim";
      corpo = `<span class="ctc-estado nv-precisa-txt nv-pergunta" title="${pergunta}"><i class="ctc-ponto nv-ponto-precisa" aria-hidden="true"></i><span aria-hidden="true">${curta}</span><span class="sr-only">${pergunta}</span></span><span class="ctc-acoes"><button type="button" class="ctc-bt ctc-parar" data-nv="recusar">Não</button><button type="button" class="ctc-bt nv-aprovar" data-nv="aprovar">${sim}</button></span>`;
      break;
    }
    default:
      // definido em 2026-11-20 (prova real com o modelo): o "terminou aqui" ficava por cima da imagem, contra a D1d; ele
      // mora na pílula, no lugar do "Assistindo", com a hora no formato da linha de atividade ("10h12").
      corpo = terminouEm !== null
        ? `<span class="ctc-estado nv-terminou-txt" role="status"><span aria-hidden="true">✓</span><span>Terminou às ${horaComH(terminouEm)}</span><span class="sr-only"> ${nomeE} terminou o que fazia no navegador</span></span>${assumir()}`
        : `<span class="ctc-estado">${OLHO}<span>Assistindo</span></span>${assumir()}`;
  }
  const terminou = terminouEm !== null && estado === "assistindo";
  // Ponto 14: o aviso do Touch ID mora só no cartão (embaixo da pílula ele quebrava em duas linhas, fora dela).
  return `<div class="ctc-controle nv-pilula${terminou ? " nv-pilula-terminou" : ""}" data-estado="${estado}" role="group" aria-label="Controle do navegador ${esc(deNome(nome))}">${corpo}</div>`;
}

// ---- a barra do navegador (D2, A e B) -------------------------------------------------------------------------------------

/** D2, A: até 6 abas do Chrome à vista; o resto vira "+N". A ativa sempre fica entre as visíveis. */
export const MAX_ABAS_CHROME = 6;
/** definido em 2026-11-20 (achado 6): a partir de 4 abas à vista as inativas viram só o favicon no painel estreito. */
export const ABAS_PARA_ENCOLHER = 4;

export function abasVisiveis(abas: readonly AbaNavegador[], max = MAX_ABAS_CHROME): { aVista: AbaNavegador[]; mais: number } {
  if (abas.length <= max) return { aVista: [...abas], mais: 0 };
  const i = abas.findIndex((a) => a.ativa);
  const aVista = i < max ? abas.slice(0, max) : [...abas.slice(0, max - 1), abas[i]!];
  return { aVista, mais: abas.length - aVista.length };
}

/** D2, B: o endereço em duas partes (domínio escuro, resto cinza) e se o site é seguro. URL estranha: tudo no domínio. */
export function partesDoEndereco(url: string): { dominio: string; resto: string; seguro: boolean } {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return { dominio: url, resto: "", seguro: u.protocol === "about:" || u.protocol === "chrome:" };
    const host = u.hostname.replace(/^www\./, "");
    const resto = `${u.pathname === "/" ? "" : u.pathname}${u.search}`;
    return { dominio: host, resto, seguro: u.protocol === "https:" };
  } catch {
    return { dominio: url, resto: "", seguro: true };
  }
}

/** O nome do site para a aba e a dica (sem www). */
export function dominioDe(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

/** N4: o lugar baixinho no fim da barra ("no nod", "na vm-sp", "no seu Mac"). Nunca "servidor", "VM" ou "nuvem". */
export function textoDoLugar(l: LugarNavegador, aparelho?: "mac" | "pc"): string {
  if (l.tipo === "nod") return "no nod";
  // 2026-11-22: no PC, "no seu PC" (o nome da máquina do Windows, "DESKTOP-4F2K", não diz nada à pessoa).
  if (l.tipo === "mac") return aparelho === "pc" ? "no seu PC" : /mac/i.test(l.nome) ? "no seu Mac" : `no ${l.nome}`;
  return `na ${l.nome}`;
}

/** A cor estável do favicon de mentira (o quadradinho com a inicial): o servidor não manda o ícone do site. */
export function corDoFavicon(url: string): number {
  const d = dominioDe(url) || url;
  let h = 0;
  for (const c of d) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

const CURSORZINHO = '<svg class="nv-aba-cursor" width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 1.2 10.4 5 6.3 6.3 5 10.4z" fill="currentColor"/></svg>';
const SETA_VOLTAR = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>';
const SETA_AVANCAR = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>';
const RECARREGAR = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 2.8v2.7h-2.7"/></svg>';
const CADEADO = '<svg class="nv-cadeado" width="10" height="10" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><rect x="2.5" y="5.2" width="7" height="5.3" rx="1.2"/><path d="M4 5.2V4a2 2 0 0 1 4 0v1.2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';

function htmlFavicon(a: AbaNavegador): string {
  if (a.carregando) return '<span class="nv-favicon nv-favicon-giro" aria-hidden="true"></span>';
  const inicial = (dominioDe(a.url) || a.titulo || "?").charAt(0).toUpperCase();
  return `<span class="nv-favicon" style="--nv-matiz:${corDoFavicon(a.url)}" aria-hidden="true">${esc(inicial)}</span>`;
}

/**
 * A barra do navegador (D2, A e B): as abas do Chrome do bot e o endereço. Assistindo o endereço é só leitura (domínio
 * escuro, resto cinza, cadeado ou "Não seguro" em vermelho); no controle vira campo de verdade com voltar e recarregar. O
 * lugar fica baixinho no fim (N4). `precisa` (D2, A): o ponto azul na aba que precisa da pessoa (a ativa, com pedido).
 */
export function htmlBarraDoNavegador(v: Pick<VistaNavegador, "abas" | "controle" | "lugar" | "pedido" | "aparelho">, o: { nome: string; editando?: string | null } = { nome: "o bot" }): string {
  const { aVista, mais } = abasVisiveis(v.abas);
  const noControle = v.controle === "pessoa";
  const precisa = v.controle === "precisa_de_voce" || v.pedido !== null;
  const abas = aVista.map((a) => {
    const titulo = a.titulo.trim() || dominioDe(a.url) || "Nova aba";
    const ponto = a.ativa && precisa ? '<i class="nv-aba-ponto" aria-hidden="true"></i>' : "";
    const cursor = a.ativa && !noControle ? CURSORZINHO : "";
    const rotulo = `${titulo}${a.ativa ? `, aba onde ${o.nome} está` : ""}${a.carregando ? ", carregando" : ""}`;
    // Achado 6 do crítico: no painel estreito a aba inativa mostra só o favicon (o CSS esconde o título); o nome fica no
    // `title` e no `aria-label`.
    return `<button type="button" class="nv-aba${a.ativa ? " ativa" : ""}" role="tab" aria-selected="${a.ativa}" data-nv="aba" data-aba="${esc(a.id)}"${noControle ? "" : ' aria-disabled="true"'} title="${esc(titulo)}" aria-label="${esc(rotulo)}">${htmlFavicon(a)}<span class="nv-aba-titulo">${esc(titulo)}</span>${cursor}${ponto}</button>`;
  }).join("");
  const maisAbas = mais > 0 ? `<span class="nv-aba-mais" title="${mais} ${mais === 1 ? "outra aba" : "outras abas"}">+${mais}</span>` : "";
  const ativa = v.abas.find((a) => a.ativa) ?? v.abas[0];
  const url = ativa?.url ?? "";
  const lugar = `<span class="nv-lugar" title="Onde o navegador ${esc(deNome(o.nome))} roda">${esc(textoDoLugar(v.lugar, v.aparelho))}</span>`;
  let endereco: string;
  if (noControle) {
    const valor = o.editando ?? url;
    endereco = `<button type="button" class="nv-seta" data-nv="voltar" aria-label="Voltar" title="Voltar">${SETA_VOLTAR}</button>`
      + `<button type="button" class="nv-seta" data-nv="recarregar" aria-label="Recarregar a página" title="Recarregar">${RECARREGAR}</button>`
      + `<form class="nv-endereco nv-endereco-campo" data-nv-form="endereco"><input class="nv-endereco-input" name="url" type="text" inputmode="url" autocomplete="off" spellcheck="false" aria-label="Endereço" value="${esc(valor)}"></form>`;
  } else {
    const p = partesDoEndereco(url);
    const selo = !url ? "" : p.seguro ? CADEADO : '<span class="nv-inseguro">Não seguro</span>';
    endereco = `<span class="nv-seta" aria-hidden="true">${SETA_VOLTAR}</span><span class="nv-seta" aria-hidden="true">${SETA_AVANCAR}</span>`
      + `<span class="nv-endereco" title="${esc(url)}">${selo}<span class="nv-dominio">${esc(p.dominio)}</span><span class="nv-resto">${esc(p.resto)}</span></span>`;
  }
  // Achado 6 do crítico: com muitas abas (4 ou mais à vista), o painel estreito mostra só o favicon das inativas.
  const muitas = aVista.length >= ABAS_PARA_ENCOLHER ? " nv-abas-muitas" : "";
  return `<div class="nv-abas${muitas}" role="tablist" aria-label="Abas do navegador ${esc(deNome(o.nome))}">${abas}${maisAbas}</div><div class="nv-linha-endereco">${endereco}${lugar}</div>`;
}

// ---- os avisos do site (D2, D; D1d) -------------------------------------------------------------------------------------

const TITULO_DO_AVISO: Readonly<Record<AvisoNavegador["tipo"], string>> = {
  download: "Download",
  pergunta: "Pergunta do site",
  permissao: "Pedido do navegador",
  precisa_de_voce: "Precisa de você",
  janela_nova: "Janela nova",
};

/**
 * A faixa fina entre o cabeçalho e a vista (um aviso por vez). `acao` (o servidor manda o rótulo) vira o botão. O texto
 * quebra em até 2 linhas (achado 2 do crítico: o motivo não some) e vai inteiro no `title`. "Precisa de você" fica só
 * com o motivo (achado 10): a ação é a da pílula, logo embaixo.
 */
export function htmlAvisoDoSite(a: AvisoNavegador | null): string {
  if (!a) return "";
  const botao = a.acao && a.tipo !== "precisa_de_voce" ? `<button type="button" class="nv-aviso-acao" data-nv="aviso" data-tipo="${a.tipo}">${esc(aspasCurvas(a.acao))}</button>` : "";
  const texto = aspasCurvas(a.texto);
  // O título vai na mesma linha do texto (não numa coluna à parte): no painel estreito as 2 linhas cabem o motivo inteiro.
  return `<div class="nv-aviso-site" data-tipo="${a.tipo}" role="status"><span class="nv-aviso-txt" title="${esc(texto)}"><b>${TITULO_DO_AVISO[a.tipo]}</b> ${esc(texto)}</span>${botao}</div>`;
}

/** O pedido de ajuda/login vira a mesma faixa (D3, 8 com a D1d: a ação fora da imagem). */
/** Endereços no texto sem o "www." (o "Www.google.com" do teste de 22/11 vinha da maiúscula em cima do www). */
export function semWww(t: string): string {
  return t.replace(/\b(?:https?:\/\/)?www\./giu, "");
}

/**
 * O que o bot escreveu no pedido de ajuda, sem o "resolva e devolva" do fim (o cartão já diz) e sem "www.": "google.com
 * pede para provar que é gente (CAPTCHA)". O teste de 22/11 mostrou o motivo inteiro como título, em 4 linhas, repetido.
 */
export function motivoDaAjuda(motivo: string): string {
  const s = semWww(motivo).trim()
    .replace(/[.;,]?\s*(?:por favor,?\s*)?(?:resolv[ae]|fa[çc]a|complete|marque|entre)\b[^.]*\b(?:devolv[ae]\w*|me avis[ae]\w*)[^.]*\.?$/iu, "")
    .replace(/[.\s]+$/u, "");
  // Começa por um domínio ("google.com pede…"): fica em minúscula, como se escreve o endereço.
  return /^[a-z0-9-]+\.[a-z]/u.test(s) ? s : (s.charAt(0).toUpperCase() + s.slice(1));
}

export function avisoDoPedido(v: Pick<VistaNavegador, "pedido" | "controle">): AvisoNavegador | null {
  const p = v.pedido;
  // revisto em 2026-11-21: o pedido de login e o de ajuda já entregam o navegador (controle "pessoa"); a faixa que diz o
  // que falta fica enquanto o pedido está aberto — antes ela sumia com a pessoa no controle, justo quando ela age.
  if (!p) return null;
  if (p.tipo === "login") { const site = nomeDoSite(p.site); return { tipo: "precisa_de_voce", texto: `Entrar ${noOuNa(site)} ${site}`, acao: "", em: 0 }; }
  // Ponto 08 (2026-11-22): a faixa diz o motivo limpo, sem "www." e sem o "resolva e devolva" (a pílula já diz).
  if (p.tipo === "ajuda") return { tipo: "precisa_de_voce", texto: motivoDaAjuda(p.motivo) || p.motivo, acao: "", em: 0 };
  return null;
}

// ---- o que a tela mostra (D3) --------------------------------------------------------------------------------------------

/**
 * Os estados da tela do navegador (D3, os que valem para ele): cada um tem uma saída e nenhum é tela preta. `semQuadro`:
 * o canal ainda não trouxe o primeiro quadro; `redeFraca`: o canal parou de trazer quadros (a web mostra o último).
 */
export type EstadoDaTela = "indisponivel" | "conectando" | "ligando" | "ao_vivo" | "rede_fraca" | "terminou" | "pausa" | "desligado" | "erro" | "segredo";

export function estadoDaTela(r: Pick<RespostaNavegador, "disponivel"> & { vista: Pick<VistaNavegador, "estado" | "segredoNaPagina"> } | null, canal: { temQuadro: boolean; redeFraca: boolean }): EstadoDaTela {
  if (!r) return "conectando";
  const v = r.vista;
  if (v.estado === "erro") return "erro";
  if (!r.disponivel && v.estado === "desligado") return "indisponivel";
  if (v.estado === "desligado") return "desligado";
  if (v.estado === "pausa") return "pausa";
  if (v.estado === "ligando") return "ligando";
  if (v.segredoNaPagina) return "segredo";
  if (v.estado === "conectando" || !canal.temQuadro) return v.estado === "terminou" && !canal.temQuadro ? "terminou" : "conectando";
  if (v.estado === "terminou") return "terminou";
  if (v.estado === "rede_fraca" || canal.redeFraca) return "rede_fraca";
  return "ao_vivo";
}

/**
 * "10:12": a hora como a linha de atividade escreve. revisto em 2026-11-25 (QA do Windows): "Terminou · 3h30" de
 * madrugada se lia como duração; o resto do app (conversa, início) escreve 03:30.
 */
export function horaComH(ms: number): string {
  return horaCurta(ms);
}

/** "16:04" no relógio de quem vê. */
export function horaCurta(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const ICONE_MONITOR = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>';
const ICONE_CADEADO = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>';

/**
 * A camada do estado (D3) por cima do palco: o esqueleto do "conectando", o lilás do "ligando", os parados com o botão, o
 * erro com causa, hora e lugar, e o segredo na página (L3). "" = ao vivo, rede fraca (a imagem fica sozinha).
 * "terminou" não desenha nada por cima: o último quadro fica esmaecido pelo CSS e a hora vai na pílula.
 */
export function htmlEstadoDaTela(e: EstadoDaTela, v: Pick<VistaNavegador, "lugar" | "abas" | "atividadeEm" | "erro" | "pedido" | "aparelho"> | null, nome: string): string {
  const n = esc(nome);
  const dn = esc(deNome(nome));
  const lugar = v ? textoDoLugar(v.lugar, v.aparelho) : "";
  switch (e) {
    case "conectando":
      return `<div class="nv-estado nv-estado-conectando" role="status"><span class="nv-esq" aria-hidden="true"><i></i><i></i><i></i></span><span class="nv-estado-sub">Conectando à tela ${dn}…</span></div>`;
    case "ligando":
      // Achado 8 do crítico: o lugar inteiro ("No nod · leva uns 10 s"), não "nod · leva uns 10 s".
      return `<div class="nv-estado nv-estado-ligando" role="status">${GIRO}<b>Ligando o navegador ${dn}</b><span class="nv-estado-sub">${esc(fraseMaiuscula(lugar))}${lugar ? " · " : ""}leva uns 10 s</span></div>`;
    case "terminou":
      // A hora de quando terminou mora na pílula (fora da imagem, D1d); aqui fica só o último quadro esmaecido.
      return "";
    case "pausa": {
      const guardadas = v?.abas.length ?? 0;
      return `<div class="nv-estado nv-estado-parado"><b>Navegador em pausa</b><button type="button" class="nv-estado-bt" data-nv="retomar">Retomar</button>${guardadas ? `<span class="nv-estado-sub">${guardadas} ${guardadas === 1 ? "aba guardada" : "abas guardadas"}</span>` : ""}</div>`;
    }
    case "desligado":
      return `<div class="nv-estado nv-estado-parado"><span class="nv-estado-ic">${ICONE_MONITOR}</span><b>Navegador ${dn} desligado</b><button type="button" class="nv-estado-bt" data-nv="ligar">Ligar</button></div>`;
    case "indisponivel":
      return `<div class="nv-estado nv-estado-parado"><span class="nv-estado-ic">${ICONE_MONITOR}</span><b>O navegador ${dn} não está ligado aqui</b><span class="nv-estado-sub">${n} usa o navegador no seu ${textosDoAparelhoNaWeb(v?.aparelho).nome}.</span><button type="button" class="nv-estado-bt" data-nv="reler">Tentar de novo</button></div>`;
    case "erro": {
      const causa = v?.erro?.causa ?? "A conexão caiu";
      const quando = v?.erro ? ` às ${horaCurta(v.erro.em)}` : "";
      // Achado 8 do crítico: a causa que já cita o lugar ("A conexão com o nod caiu") não o repete no fim.
      const onde = lugar && !causaCitaOLugar(causa, v!.lugar) ? ` · ${lugar}` : "";
      // definido em 2026-11-20: causa que fala da conexão é a vista que caiu, não o trabalho — o bot segue.
      const segue = quedaDaVista(causa) ? ` ${fraseMaiuscula(comArtigo(nome))} continua trabalhando.` : "";
      return `<div class="nv-estado nv-estado-erro" role="alert"><b>Não deu para mostrar a tela</b><span class="nv-estado-sub">${esc(fraseMaiuscula(causa))}${quando}${esc(onde)}${segue ? `.${esc(segue)}` : ""}</span><button type="button" class="nv-estado-bt" data-nv="ligar">Tentar de novo</button></div>`;
    }
    case "segredo": {
      // L3: o campo de senha verde "Campo protegido"; o selo "Entrando com o 1Password…" mora na faixa de baixo.
      return `<div class="nv-estado nv-estado-segredo" role="status"><span class="nv-estado-ic">${ICONE_CADEADO}</span><b>Campo protegido</b><span class="nv-estado-sub">A página tem uma senha. ${n} não vê esta tela até ela mudar.</span></div>`;
    }
    default:
      return "";
  }
}

/** A causa do erro já diz onde ("A conexão com o nod caiu", "Seu Mac está desligado", "A vm-sp está fora do ar")? */
export function causaCitaOLugar(causa: string, l: LugarNavegador): boolean {
  const nome = l.tipo === "nod" ? "nod" : l.nome;
  const c = causa.toLocaleLowerCase("pt-BR");
  // A causa que fala do Mac já diz onde o problema está (o lugar de agora seria outra pista, e confunde).
  return c.includes(nome.toLocaleLowerCase("pt-BR")) || /\bmac\b/u.test(c);
}

/** A queda é da vista (a conexão até a tela), não do navegador: o bot continua no site. */
export function quedaDaVista(causa: string): boolean {
  return /conex[aã]o/iu.test(causa);
}

// ---- a imagem, o letterbox e as coordenadas (D1, 4; D5) -------------------------------------------------------------------

export type Retangulo = { x: number; y: number; w: number; h: number };

/**
 * Onde a imagem (o viewport do Chrome) cabe dentro da vista, mantendo a proporção (`object-fit: contain` com
 * `object-position: top`). A sobra vira a faixa clara do letterbox (nunca preta). `caixa` = o tamanho da área da vista em px CSS.
 */
export function retanguloDaImagem(caixa: { w: number; h: number }, imagem: { w: number; h: number }): Retangulo {
  if (caixa.w <= 0 || caixa.h <= 0 || imagem.w <= 0 || imagem.h <= 0) return { x: 0, y: 0, w: Math.max(0, caixa.w), h: Math.max(0, caixa.h) };
  const escala = Math.min(caixa.w / imagem.w, caixa.h / imagem.h);
  const w = imagem.w * escala;
  const h = imagem.h * escala;
  // Encostada em cima (como o quadro da tela cheia do computador): a sobra fica embaixo, longe da barra do navegador.
  return { x: (caixa.w - w) / 2, y: 0, w, h };
}

/**
 * Do ponto da vista (relativo ao canto da área, px CSS) para o viewport do Chrome (o que `EntradaNavegador` espera).
 * Fora da imagem (no letterbox) → null: o clique não vai ao site.
 */
export function pontoNoViewport(p: { x: number; y: number }, caixa: { w: number; h: number }, viewport: { w: number; h: number }): { x: number; y: number } | null {
  const r = retanguloDaImagem(caixa, viewport);
  if (r.w <= 0 || r.h <= 0) return null;
  const x = (p.x - r.x) / r.w * viewport.w;
  const y = (p.y - r.y) / r.h * viewport.h;
  if (x < 0 || y < 0 || x > viewport.w || y > viewport.h) return null;
  return { x: Math.min(viewport.w - 1, Math.max(0, Math.round(x))), y: Math.min(viewport.h - 1, Math.max(0, Math.round(y))) };
}

/** Do viewport do Chrome para a vista: a caixa do passo (`vista.passo.caixa`) escalada ao tamanho da vista (D2, C). */
export function caixaNaVista(c: CaixaNavegador, caixa: { w: number; h: number }, viewport: { w: number; h: number }): Retangulo {
  const r = retanguloDaImagem(caixa, viewport);
  const k = viewport.w > 0 ? r.w / viewport.w : 0;
  return { x: r.x + c.x * k, y: r.y + c.y * k, w: c.w * k, h: c.h * k };
}

/** D8: o cursor anda até o alvo em 120–400 ms, pela distância (px CSS). */
export function duracaoDoCursor(de: { x: number; y: number } | null, para: { x: number; y: number }): number {
  if (!de) return 0;
  const d = Math.hypot(para.x - de.x, para.y - de.y);
  return Math.round(Math.min(400, Math.max(120, 120 + d * 0.7)));
}

/** Os modificadores do CDP (Alt=1, Ctrl=2, Meta=4, Shift=8). */
export function modificadoresDe(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

/** O botão do mouse no CDP. */
export function botaoDoMouse(b: number): "left" | "middle" | "right" {
  return b === 1 ? "middle" : b === 2 ? "right" : "left";
}

// ---- o painel ao lado (D5, D6) ---------------------------------------------------------------------------------------------

/** D5: mínimo 360; padrão 40 % da área (conversa + painel); máximo deixando a conversa com 420. */
export const PAINEL_MIN = 360;
export const PAINEL_PADRAO = 0.4;
export const CONVERSA_MIN = 420;
/** D5: o ímã dos encaixes 1/3, 1/2 e 2/3. */
export const IMA_PX = 8;
export const ENCAIXES = [1 / 3, 1 / 2, 2 / 3] as const;
/** D6: abaixo disto (largura da janela) o painel cobre a conversa com sombra. */
export const JANELA_LADO_A_LADO = 1180;
export const CHAVE_LARGURA = "nod:navegador:largura";

export type ModoDoPainel = "lado" | "cobre" | "folha";

/** D6: ≥ 1180 px ao lado; 900–1179 (e menos, fora do celular) cobre a conversa; no celular, a folha de baixo. */
export function modoDoPainel(janela: number, celular: boolean, area: number): ModoDoPainel {
  if (celular) return "folha";
  if (janela < JANELA_LADO_A_LADO || area - PAINEL_MIN < CONVERSA_MIN) return "cobre";
  return "lado";
}

/** D6 B (Paper): a janela onde o painel cobre a conversa e a barra lateral fica só com avatares (900–1179 px). */
export const JANELA_BARRA_SO_AVATARES = 900;

/**
 * D6 B: "barra lateral vira só ícones; o painel cobre a conversa com sombra", de 900 a 1179 px, enquanto o painel do
 * navegador cobre a conversa. Não muda a escolha guardada da barra (ADR-179): fechou o painel, ela volta como estava. Só
 * abaixo de 1180, onde o "cobre" vem da janela e não da área (a barra mais estreita não pode desfazer o próprio motivo).
 */
export function barraSoComAvatares(janela: number, cobrindo: boolean): boolean {
  return cobrindo && janela >= JANELA_BARRA_SO_AVATARES && janela < JANELA_LADO_A_LADO;
}

/**
 * D5 (máximo, a conversa com 420 px): abaixo de 600 px de conversa, o seletor de IA do campo fica só com o anel (o nome no
 * title e no leitor). Os controles escondidos do campo guardam o lugar (casca.css) e, estreito, o texto sumia.
 */
export const CONVERSA_ESTREITA = 600;
export function conversaEstreita(area: number, largura: number): boolean {
  return largura > 0 && area - largura < CONVERSA_ESTREITA;
}

export function larguraMaxima(area: number): number {
  return Math.max(PAINEL_MIN, area - CONVERSA_MIN);
}

export function larguraPadrao(area: number): number {
  return limitarLargura(Math.round(area * PAINEL_PADRAO), area);
}

export function limitarLargura(l: number, area: number): number {
  return Math.round(Math.min(larguraMaxima(area), Math.max(PAINEL_MIN, l)));
}

/** D5: perto (8 px) de 1/3, 1/2 ou 2/3 da área, gruda. Devolve a largura e o encaixe em que grudou. */
export function imantar(l: number, area: number): { largura: number; encaixe: number | null } {
  for (const f of ENCAIXES) {
    const alvo = Math.round(area * f);
    if (Math.abs(l - alvo) <= IMA_PX && alvo >= PAINEL_MIN && alvo <= larguraMaxima(area)) return { largura: alvo, encaixe: f };
  }
  return { largura: l, encaixe: null };
}

/** D5: arrastando abaixo do mínimo, "solte para fechar". */
export function soltarFecha(l: number): boolean {
  return l < PAINEL_MIN;
}

/** D5: ⌘⌥← (mais largo) e ⌘⌥→ (mais estreito) andam pelos encaixes que cabem. */
export function proximoEncaixe(atual: number, area: number, passo: -1 | 1): number {
  const cabem = ENCAIXES.map((f) => Math.round(area * f)).filter((l) => l >= PAINEL_MIN && l <= larguraMaxima(area));
  if (!cabem.length) return limitarLargura(atual, area);
  if (passo === -1) return cabem.find((l) => l > atual + 1) ?? cabem[cabem.length - 1]!;
  return [...cabem].reverse().find((l) => l < atual - 1) ?? cabem[0]!;
}

/** A largura lembrada (fração da área, para valer em janelas de tamanhos diferentes). Lixo vira null. */
export function lerLargura(texto: string | null | undefined): number | null {
  const n = Number(texto);
  return texto && Number.isFinite(n) && n > 0 && n < 1 ? n : null;
}

export function gravarLargura(l: number, area: number): string {
  return String(Math.round((l / Math.max(1, area)) * 1000) / 1000);
}

/** D6, C: a folha do celular para em meia, cheia ou fechada; solta perto, vai para a mais próxima (com o embalo). */
export type PosicaoDaFolha = "meia" | "cheia" | "fechada";

export function alturaDaFolha(p: PosicaoDaFolha, tela: number): number {
  return p === "cheia" ? tela : p === "meia" ? Math.round(tela * 0.62) : 0;
}

export function soltarFolha(altura: number, tela: number, velocidade = 0): PosicaoDaFolha {
  // velocidade em px/ms, positiva = para baixo. Um gesto rápido decide sozinho.
  const meia = alturaDaFolha("meia", tela);
  if (velocidade > 0.6) return altura > meia + 40 ? "meia" : "fechada";
  if (velocidade < -0.6) return altura < meia - 40 ? "meia" : "cheia";
  const pontos: [PosicaoDaFolha, number][] = [["fechada", 0], ["meia", meia], ["cheia", tela]];
  return pontos.reduce((m, p) => (Math.abs(p[1] - altura) < Math.abs(m[1] - altura) ? p : m))[0];
}

// ---- o cabeçalho do painel: lugares e ações (D1, 1 e 2; D1c) -------------------------------------------------------------

export type LugarDaVista = "navegador" | "computador";

/** O ponto do lugar ativo (D1, 1): verde ao vivo, azul precisa de você; parado, sem ponto. */
export function pontoDoLugar(v: Pick<VistaNavegador, "estado" | "controle" | "pedido"> | null): "vivo" | "precisa" | null {
  if (!v) return null;
  if (v.controle === "precisa_de_voce" || v.pedido) return "precisa";
  if (v.estado === "ao_vivo" || v.estado === "rede_fraca" || v.estado === "ligando" || v.controle === "pessoa") return "vivo";
  return null;
}

/**
 * O seletor segmentado (D1, 1; D8: a pílula branca desliza). Só os lugares que o bot tem. Com um lugar só (achado 11 do
 * crítico), não há o que escolher: vira o rótulo, sem fundo, sombra nem botão.
 */
export function htmlLugares(lugares: readonly LugarDaVista[], ativo: LugarDaVista, ponto: "vivo" | "precisa" | null, o: { escuro?: boolean } = {}): string {
  const nomes: Record<LugarDaVista, string> = { navegador: "Navegador", computador: "Computador" };
  if (lugares.length <= 1) {
    const marca = ponto ? `<i class="nv-lugar-ponto" data-ponto="${ponto}" aria-hidden="true"></i>` : "";
    return `<span class="nv-lugares nv-lugar-unico${o.escuro ? " nv-lugares-escuro" : ""}">${marca}<span>${nomes[lugares[0] ?? ativo]}</span></span>`;
  }
  const i = Math.max(0, lugares.indexOf(ativo));
  const itens = lugares.map((l) => {
    const marca = l === ativo && ponto ? `<i class="nv-lugar-ponto" data-ponto="${ponto}" aria-hidden="true"></i>` : "";
    return `<button type="button" class="nv-lugar-bt${l === ativo ? " ativo" : ""}" role="tab" aria-selected="${l === ativo}" data-nv="lugar" data-lugar="${l}">${marca}<span>${nomes[l]}</span></button>`;
  }).join("");
  return `<div class="nv-lugares${o.escuro ? " nv-lugares-escuro" : ""}" role="tablist" aria-label="Lugares" style="--nv-i:${i};--nv-n:${lugares.length}"><span class="nv-lugar-fundo" aria-hidden="true"></span>${itens}</div>`;
}

const IC_ABA = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M2 6h12M6 3v3"/></svg>';
const IC_EXPANDIR = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9"/></svg>';
const IC_MAIS = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12.5" cy="8" r="1.2"/></svg>';
const IC_FECHAR = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
export const ICONES_NAVEGADOR = { aba: IC_ABA, expandir: IC_EXPANDIR, mais: IC_MAIS, fechar: IC_FECHAR };

/** As ações do topo do painel (D1, 2): Abrir em aba · Tela cheia · ⋯ · Fechar, ícones com dica. */
export function htmlAcoesDoPainel(o: { celular?: boolean } = {}): string {
  const aba = o.celular ? "" : `<button type="button" class="nv-ic" data-nv="em-aba" aria-label="Abrir em aba" title="Abrir em aba">${IC_ABA}</button>`;
  return `<div class="nv-acoes">${aba}<button type="button" class="nv-ic" data-nv="tela-cheia" aria-label="Tela cheia" title="Tela cheia · ${tecla("⌘⇧F")}" aria-keyshortcuts="${ariaTecla("Meta+Shift+F")}">${IC_EXPANDIR}</button><button type="button" class="nv-ic" data-nv="menu" aria-haspopup="menu" aria-label="Mais ações" title="Mais">${IC_MAIS}</button><button type="button" class="nv-ic" data-nv="fechar" aria-label="Fechar" title="Fechar · ${tecla("⌘\\")}" aria-keyshortcuts="${ariaTecla("Meta+Backslash")}">${IC_FECHAR}</button></div>`;
}

/**
 * O ⋯ do navegador (D1c): Recarregar a página · Copiar endereço · Abrir no meu navegador · Logins deste site… | Encerrar o
 * navegador (vermelho). No modo abas, o clique direito da aba (D7) leva os itens da aba antes (`daAba`).
 */
export function htmlMenuDoNavegador(nome: string, o: { daAba?: boolean; temEndereco?: boolean; controle?: boolean; ensinar?: boolean; trazerDoChrome?: boolean } = {}): string {
  // Achado 15 do crítico: um rótulo só ("Assumir o controle"), atalhos à direita em cinza e "Fechar os outros lugares".
  const aba = o.daAba
    ? `<button type="button" role="menuitem" data-nv-menu="ao-lado">Pôr ao lado da conversa</button>${o.controle ? "" : '<button type="button" role="menuitem" data-nv-menu="assumir">Assumir o controle</button>'}<button type="button" role="menuitem" data-nv-menu="tela-cheia">Abrir em tela cheia<span class="nv-menu-dica">${tecla("⌘⇧F")}</span></button><hr><button type="button" role="menuitem" data-nv-menu="fechar-aba">Fechar aba<span class="nv-menu-dica">${tecla("⌘W")}</span></button><button type="button" role="menuitem" data-nv-menu="fechar-outras">Fechar os outros lugares</button><hr>`
    : "";
  const desligado = o.temEndereco === false ? ' disabled aria-disabled="true"' : "";
  return `<div role="menu" class="nv-menu-corpo" aria-label="Navegador ${esc(deNome(nome))}">${aba}`
    + `<button type="button" role="menuitem" data-nv-menu="recarregar"${desligado}>Recarregar a página</button>`
    + `<button type="button" role="menuitem" data-nv-menu="copiar"${desligado}>Copiar endereço</button>`
    + `<button type="button" role="menuitem" data-nv-menu="abrir-fora"${desligado}>Abrir no meu navegador</button>`
    + '<button type="button" role="menuitem" data-nv-menu="logins">Logins deste site…</button>'
    // 2026-11-23 (o dono no LinkedIn pelo Google): a sessão do site do Chrome da pessoa, a qualquer hora (não só no cartão).
    + (o.trazerDoChrome ? `<button type="button" role="menuitem" class="nv-menu-ensinar" data-nv-menu="trazer-chrome"${desligado}>Trazer do meu Chrome<span class="nv-menu-sub">Entra neste site com o login do seu Chrome</span></button>` : "")
    // T1: "Ensinar uma tarefa" também mora aqui (nunca no celular: um passo a passo longo não cabe ali).
    + (o.ensinar ? `<button type="button" role="menuitem" class="nv-menu-ensinar" data-nv-menu="ensinar">Ensinar uma tarefa<span class="nv-menu-sub">${esc(subtituloDeEnsinar(nome))}</span></button>` : "")
    + `<hr><button type="button" role="menuitem" class="danger" data-nv-menu="encerrar">Encerrar o navegador ${esc(deNome(nome))}</button></div>`;
}

/** Encerrar pergunta antes só se o bot está no meio de algo (D1c): passo recente, carregando ou pedido aberto. */
export const MS_NO_MEIO = 20_000;
export function botNoMeio(v: Pick<VistaNavegador, "estado" | "passo" | "pedido" | "abas">, agora: number): boolean {
  if (v.estado !== "ao_vivo" && v.estado !== "rede_fraca" && v.estado !== "ligando") return false;
  return v.pedido !== null || v.abas.some((a) => a.carregando) || (v.passo !== null && agora - v.passo.em < MS_NO_MEIO);
}

// ---- a legenda do passo, a linha de atividade e a aba de lugar (D1d; 1c; D7) ---------------------------------------------

/** "clicando em Buscar": a frase do passo com a primeira letra minúscula, para depois do "·". */
export function fraseMinuscula(frase: string): string {
  const f = aspasCurvas(frase);
  return f ? f.charAt(0).toLocaleLowerCase("pt-BR") + f.slice(1) : f;
}

/**
 * N4: o passo terminado no passado ("Clicando em \"Baixar\"" → "Clicou em \"Baixar\""), para a linha do ✓. As frases
 * vêm de `fraseDoPasso` (src/domain/navegador-vista.ts), todas no gerúndio; a que não casar fica como veio.
 */
const NO_PASSADO: readonly (readonly [RegExp, string])[] = [
  [/^Abrindo /u, "Abriu "], [/^Lendo /u, "Leu "], [/^Clicando/u, "Clicou"], [/^Preenchendo /u, "Preencheu "], [/^Rolando /u, "Rolou "],
  [/^Esperando /u, "Esperou "], [/^Olhando /u, "Olhou "], [/^Baixando /u, "Baixou "], [/^Enviando /u, "Enviou "], [/^Escolhendo /u, "Escolheu "],
  [/^Mexendo /u, "Mexeu "], [/^Usando /u, "Usou "],
];
export function fraseNoPassado(frase: string): string {
  const f = fraseMaiuscula(frase);
  for (const [de, para] of NO_PASSADO) if (de.test(f)) return f.replace(de, para);
  return f;
}

/** "Baixou 14 notas": a frase do passo com a primeira letra maiúscula, para abrir a linha. */
export function fraseMaiuscula(frase: string): string {
  const f = aspasCurvas(frase);
  return f ? f.charAt(0).toLocaleUpperCase("pt-BR") + f.slice(1) : f;
}

/** O título da aba ativa do Chrome do bot ("Google Voos"), ou o domínio. */
export function tituloDaAbaAtiva(v: Pick<VistaNavegador, "abas">): string {
  const a = v.abas.find((x) => x.ativa) ?? v.abas[0];
  if (!a) return "";
  return a.titulo.trim() || dominioDe(a.url);
}

/** D1d: a legenda da aba ("Navegador da Ada · lendo os voos diretos") e o título da tela cheia ("Ada · clicando em Buscar"). */
export function legendaDoPasso(nome: string, v: Pick<VistaNavegador, "passo" | "controle" | "estado" | "pedido"> | null, onde: "aba" | "tela-cheia"): string {
  // Ponto 10 dos cenários (2026-11-22): terminado, o título diz "terminou", não o último passo ("lendo www.google.com").
  const frase = v?.pedido ? "precisa de você" : v?.controle === "pessoa" ? "você está no controle" : v?.estado === "terminou" ? "terminou" : v?.passo?.frase ? fraseMinuscula(v.passo.frase) : "";
  const quem = onde === "aba" ? `Navegador ${deNome(nome)}` : nome;
  return frase ? `${quem} · ${frase}` : quem;
}

/** A linha de atividade some depois que o bot para (D1, 5: "some 3 s depois"), mas fica enquanto ele precisa da pessoa. */
export const MS_LINHA_DEPOIS = 3_000;
/** definido em 2026-11-20 (N4): a linha do terminado fica até a pausa do navegador (10 min sem uso, D0). */
export const MS_LINHA_TERMINOU = 10 * 60_000;

/**
 * A linha "● Navegador da Ada · Google Voos · lendo os voos diretos · Ver" na conversa (linha 1, 1c, item 2): aparece quando
 * o bot está usando o navegador. "Ver" abre o painel (modo pílula); no modo abas, "Abrir" abre a aba.
 */
export function linhaDoNavegadorVisivel(v: Pick<VistaNavegador, "estado" | "controle" | "pedido" | "passo" | "atividadeEm"> | null, agora: number): boolean {
  if (!v) return false;
  if (v.pedido || v.controle === "precisa_de_voce" || v.controle === "pessoa") return true;
  if (v.estado === "ligando" || v.estado === "conectando") return true;
  // N4/J3: terminado, a linha fica com o ✓, a hora e o lugar ("Baixou 14 notas fiscais · 3h02 · no nod") até a pausa.
  if (v.estado === "terminou") return agora - Math.max(v.atividadeEm, v.passo?.em ?? 0) < MS_LINHA_TERMINOU;
  if (v.estado !== "ao_vivo" && v.estado !== "rede_fraca") return false;
  const ultimo = Math.max(v.atividadeEm, v.passo?.em ?? 0);
  return agora - ultimo < MS_NO_MEIO + MS_LINHA_DEPOIS;
}

/** "03:02": a hora do fim da linha (N4), no mesmo formato da conversa. */
export function horaDaLinha(instante: number): string {
  return horaCurta(instante);
}

/**
 * A linha de atividade do navegador na conversa (1, 5 e N4): "Navegador da Ada", embaixo o site, o passo e o lugar baixinho
 * no fim ("Google Voos · lendo os voos · no nod"); terminado, o ✓ com o último passo, a hora e o lugar. "Ver" abre o painel;
 * no modo abas, "Abrir" (abre a aba de lugar).
 */
export function htmlLinhaDoNavegador(nome: string, agenteId: string, v: Pick<VistaNavegador, "estado" | "controle" | "pedido" | "passo" | "abas" | "atividadeEm" | "aparelho"> & { lugar?: LugarNavegador }, o: { modoAbas: boolean }): string {
  const ponto = pontoDoLugar(v);
  const site = tituloDaAbaAtiva(v);
  const lugar = v.lugar ? textoDoLugar(v.lugar, v.aparelho) : "";
  const rotulo = o.modoAbas ? "Abrir" : "Ver";
  const ver = `<button type="button" class="nv-linha-ver" data-act="navegador-ver" data-agente="${esc(agenteId)}" aria-label="${rotulo} o navegador ${esc(deNome(nome))}">${rotulo}</button>`;
  if (v.estado === "terminou" && !v.pedido && v.controle === "bot") {
    const feito = [v.passo?.frase ? fraseNoPassado(v.passo.frase) : `Terminou${site ? ` em ${site}` : ""}`, horaDaLinha(Math.max(v.atividadeEm, v.passo?.em ?? 0)), lugar].filter(Boolean).join(" · ");
    return `<div class="nv-linha terminou" data-agente="${esc(agenteId)}" data-ponto=""><span class="nv-linha-ok" aria-hidden="true">✓</span><span class="nv-linha-txt"><b>Navegador ${esc(deNome(nome))}</b><small>${esc(feito)}</small></span>${ver}</div>`;
  }
  // O pedido aberto vem antes do controle (2026-11-21): login e ajuda já entregam o navegador, e a linha segue a pílula.
  const frase = v.pedido || v.controle === "precisa_de_voce" ? "precisa de você" : v.controle === "pessoa" ? "você está no controle" : v.passo?.frase ? fraseMinuscula(v.passo.frase) : v.estado === "ligando" ? "ligando" : "";
  const sub = [site, frase, lugar].filter(Boolean).join(" · ");
  return `<div class="nv-linha" data-agente="${esc(agenteId)}" data-ponto="${ponto ?? ""}"><i class="nv-linha-ponto" aria-hidden="true"></i><span class="nv-linha-txt"><b>Navegador ${esc(deNome(nome))}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span>${ver}</div>`;
}

/** O botão da tela no canto do cabeçalho (1c, item 1): só com o lugar; com atividade diz o nome e leva o ponto. */
export function htmlBotaoDoCanto(agenteId: string, v: Pick<VistaNavegador, "estado" | "controle" | "pedido"> | null, aberto: boolean): string {
  const ponto = pontoDoLugar(v);
  const texto = ponto ? '<span class="nv-canto-txt">Navegador</span>' : "";
  return `<button type="button" class="nv-canto${ponto ? " com-texto" : ""}${aberto ? " aberto" : ""}" data-act="navegador-alternar" data-agente="${esc(agenteId)}" aria-pressed="${aberto}" aria-label="${aberto ? "Fechar" : "Abrir"} a tela do navegador" title="Tela · ${tecla("⌘\\")}" aria-keyshortcuts="${ariaTecla("Meta+Backslash")}">${IC_TELA}${ponto ? `<i class="nv-canto-ponto" data-ponto="${ponto}" aria-hidden="true"></i>` : ""}${texto}</button>`;
}
const IC_TELA = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="8.5" rx="1.6"/><path d="M5.5 13.5h5"/></svg>';

/** D7: o estado da aba de lugar. */
export type EstadoDaAbaDeLugar = "vivo" | "precisa" | "controle" | "parada" | "problema";

export function estadoDaAbaDeLugar(v: Pick<VistaNavegador, "estado" | "controle" | "pedido"> | null): EstadoDaAbaDeLugar {
  if (!v) return "parada";
  if (v.estado === "erro") return "problema";
  // O pedido aberto (login, ajuda) diz "precisa de você" mesmo com o navegador já com a pessoa (2026-11-21): a aba e a
  // pílula contam a mesma coisa.
  if (v.controle === "precisa_de_voce" || v.pedido) return "precisa";
  if (v.controle === "pessoa") return "controle";
  if (v.estado === "ao_vivo" || v.estado === "rede_fraca" || v.estado === "ligando" || v.estado === "conectando") return "vivo";
  return "parada";
}

const MAOZINHA = '<svg class="nv-aba-mao" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 8V3.2a1.1 1.1 0 0 1 2.2 0V7m0-1.2a1.1 1.1 0 0 1 2.2 0V7.4m0-.8a1.1 1.1 0 0 1 2.2 0v3.2A4.2 4.2 0 0 1 7.9 14h-.6a4 4 0 0 1-3.2-1.6L2.6 10.4a1.1 1.1 0 0 1 1.7-1.4L5.5 10"/></svg>';
const GLOBO = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c1.8 1.7 2.6 3.7 2.6 6S9.8 12.3 8 14C6.2 12.3 5.4 10.3 5.4 8S6.2 3.7 8 2z"/></svg>';

/** A dica da aba (D7, após 600 ms): "Navegador da Ada · Google Voos · ao vivo". */
export function dicaDaAbaDeLugar(nome: string, v: Pick<VistaNavegador, "estado" | "controle" | "pedido" | "abas" | "erro"> | null): string {
  const e = estadoDaAbaDeLugar(v);
  const como = e === "vivo" ? "ao vivo" : e === "precisa" ? "precisa de você" : e === "controle" ? "você está no controle" : e === "problema" ? (v?.erro?.causa ?? "com problema") : v?.estado === "pausa" ? "em pausa" : "parado";
  return [`Navegador ${deNome(nome)}`, v ? tituloDaAbaAtiva(v) : "", como].filter(Boolean).join(" · ");
}

/**
 * 5e: o lugar fechado continua à mão. A aba fechada some da fileira, mas o bot segue nele: ele entra em "N outras", numa
 * seção "Lugares" ("Navegador da Ada · Google Voos · ao vivo" com o ponto), e clicar reabre a aba. Só os que estão vivos ou
 * esperando a pessoa (parado não precisa estar à mão: o botão do canto abre).
 */
export function lugarFechadoAMao(v: Pick<VistaNavegador, "estado" | "controle" | "pedido"> | null): boolean {
  const e = estadoDaAbaDeLugar(v);
  return e === "vivo" || e === "precisa" || e === "controle";
}

export function htmlLugaresFechados(itens: readonly { agenteId: string; nome: string; vista: Pick<VistaNavegador, "estado" | "controle" | "pedido" | "abas" | "erro"> | null }[]): string {
  if (!itens.length) return "";
  const linhas = itens.map(({ agenteId, nome, vista }) => {
    const e = estadoDaAbaDeLugar(vista);
    const sub = dicaDaAbaDeLugar(nome, vista).split(" · ").slice(1).join(" · ");
    const ponto = e === "vivo" || e === "precisa" ? `<i class="nv-aba-lugar-ponto" data-ponto="${e}" aria-hidden="true"></i>` : "";
    return `<button type="button" role="menuitem" class="at-item nv-lugar-fechado" data-lugar-agente="${esc(agenteId)}">${GLOBO}<span class="nv-lugar-fechado-txt"><span>Navegador ${esc(deNome(nome))}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</span>${ponto}</button>`;
  }).join("");
  return `<p class="menu-nome">Lugares</p>${linhas}<hr><p class="nv-lugar-fechado-dica">Clicar reabre a aba. ${tecla("⌘⇧T")} reabre a última que você fechou.</p>`;
}

/**
 * A aba de lugar no modo abas (D7): depois da conversa e das tarefas; hover com ×; o clique direito abre o menu. Diz
 * "Navegador" (achado 11 do crítico): o título da página já está na aba do Chrome logo abaixo e na dica.
 */
export function htmlAbaDeLugar(agenteId: string, nome: string, v: Pick<VistaNavegador, "estado" | "controle" | "pedido" | "abas" | "erro"> | null, ativa: boolean): string {
  const e = estadoDaAbaDeLugar(v);
  const titulo = "Navegador";
  const marca = e === "controle" ? MAOZINHA : e === "problema" ? '<span class="nv-aba-lugar-erro" aria-hidden="true">!</span>' : e === "parada" ? "" : `<i class="nv-aba-lugar-ponto" data-ponto="${e}" aria-hidden="true"></i>`;
  const dica = dicaDaAbaDeLugar(nome, v);
  return `<div class="at-aba nv-aba-lugar${ativa ? " ativa" : ""}" data-estado="${e}" data-lugar-aba="navegador" data-agente="${esc(agenteId)}">`
    + `<button type="button" class="at-ir" data-act="navegador-aba" data-agente="${esc(agenteId)}"${ativa ? ' aria-current="page"' : ""} data-dica="${esc(dica)}" aria-label="${esc(dica)}">${GLOBO}<span class="at-titulo">${esc(titulo)}</span>${marca}</button>`
    + `<span class="at-acoes"><button type="button" class="at-fechar" data-act="navegador-fechar-aba" data-agente="${esc(agenteId)}" aria-label="Fechar a aba do navegador ${esc(deNome(nome))}" title="Fechar aba · ${tecla("⌘W")}"><span aria-hidden="true">×</span></button></span></div>`;
}

/** A vista mudou de um jeito que a tela precisa redesenhar a barra (abas, controle, lugar) ou só a camada? */
export function chaveDaBarra(v: Pick<VistaNavegador, "abas" | "controle" | "lugar" | "pedido">): string {
  return JSON.stringify([v.abas, v.controle, v.lugar, v.pedido !== null]);
}
