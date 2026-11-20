import type { CausaCerebroCaiu, EstadoIaDaLigacao, IaDaLigacao, IAS_DA_LIGACAO as IasDaLigacao } from "../../src/contracts/voz.ts";
import { avisoDeEstado } from "../lib/aviso-estado.ts";
import { desteMac, nesteMac, plataformaDaTela, terminalDaqui } from "../lib/plataforma-da-tela.ts";
import { botao, esc } from "../lib/render.ts";
import { COMANDO_ATUALIZAR_IA, versaoLegivel } from "./ia-fora.ts";
import { LOGOS_IA } from "./onboarding-logos.ts";

/**
 * A rede de segurança da ligação na tela (definido em 2026-10-05; protótipos "2A · A IA caiu no meio da ligação, e há
 * outra pronta", "2B · Depois de escolher" e "2C · Nenhuma outra IA pronta no Mac", aprovados no mesmo dia). O servidor
 * manda só códigos (`sem-ia`: a causa, a IA que caiu, o estado das IAs do Mac); as frases e o desenho são daqui. Funções
 * puras, sem DOM (tests/unit/web/ligacao-sem-ia.test.ts); os cliques são de web/telas/ligacao-controle.ts.
 */

// Repetido de src/contracts/voz.ts (a web só faz import type; o tipo da origem trava a cópia).
export const IAS: typeof IasDaLigacao = ["claude-cli", "codex-cli"];

/** O nome que a pessoa conhece (a assinatura) e o do programa no Mac (o que ela vê no Terminal). */
const NOME_IA: Record<IaDaLigacao, string> = { "claude-cli": "Claude", "codex-cli": "ChatGPT" };
const NOME_CLI: Record<IaDaLigacao, string> = { "claude-cli": "Claude Code", "codex-cli": "Codex" };
const LOGO: Record<IaDaLigacao, string> = { "claude-cli": LOGOS_IA.claude, "codex-cli": LOGOS_IA.chatgpt };
const LOGIN_NO_TERMINAL: Record<IaDaLigacao, string> = { "claude-cli": "claude auth login", "codex-cli": "codex login" };
const ONDE_INSTALAR: Record<IaDaLigacao, string> = { "claude-cli": "claude.com/product/claude-code", "codex-cli": "developers.openai.com/codex/cli" };

export const nomeDaIa = (ia: IaDaLigacao): string => NOME_IA[ia];

/** O que a tela guarda enquanto a ligação espera a escolha. */
export type EstadoSemIa = {
  causa: CausaCerebroCaiu;
  /** A IA que respondia; null = o servidor não sabe qual era. */
  ia: IaDaLigacao | null;
  ias: EstadoIaDaLigacao[];
  /** Até quando a ligação espera (epoch ms). */
  ate: number;
  /** A pessoa abriu o login desta IA pelo app: o botão vira "Tentar de novo". */
  entrando: IaDaLigacao | null;
  /** O resultado do último clique (o login abriu, não deu para continuar…). */
  nota: string | null;
  /** Um clique em curso: os botões ficam desabilitados. */
  ocupado: boolean;
  /** A ponte do app do Mac (`window.nodDesktop.iaEntrar`/`iaInstalar`): fora do app, o texto diz o que fazer no Terminal. */
  ponte: { entrar: boolean; instalar: boolean };
  /** Ligação do onboarding: a saída é "Configurar sem voz"; numa ligação comum, "Desligar". */
  onboarding: boolean;
};

/** Depois da escolha: qual IA atendeu e se é outra (o aviso neutro some sozinho). */
export type EstadoIaVoltou = { ia: IaDaLigacao | null; trocou: boolean };

/**
 * O motivo, com o que se sabe: a causa "conta sem acesso" só quando o turno a trouxe e se sabe de qual IA; em qualquer
 * outra falha, um texto verdadeiro e genérico (nunca o texto do fornecedor, nunca um palpite).
 */
export function motivoSemIa(causa: CausaCerebroCaiu, ia: IaDaLigacao | null): string {
  if (causa === "conta_sem_acesso" && ia) return `A conta do ${NOME_CLI[ia]} ${desteMac()} está sem acesso: a organização dela desativou o uso por assinatura.`;
  // NOD-168 (ADR-078): a assinatura no teto é dita como é; "parou de responder" faria a pessoa tentar de novo à toa.
  if (causa === "limite") return ia ? `A assinatura do ${NOME_CLI[ia]} ${desteMac()} chegou ao limite.` : `A assinatura de IA ${desteMac()} chegou ao limite.`;
  return `A IA ${desteMac()} parou de responder.`;
}

/** As IAs prontas no Mac que podem assumir: a outra, quando se sabe qual caiu; sem saber, qualquer uma pronta. */
export function iasQuePodemAssumir(s: Pick<EstadoSemIa, "ia" | "ias">): IaDaLigacao[] {
  return IAS.filter((id) => id !== s.ia && s.ias.some((i) => i.id === id && i.estado === "pronto"));
}

/** O que fazer no Terminal quando o clique não chega a um app do Mac (navegador comum ou app antigo). */
export function notaNoTerminal(ia: IaDaLigacao, acao: "entrar" | "instalar"): string {
  const entrar = `rode “${LOGIN_NO_TERMINAL[ia]}” e entre na conta`;
  return acao === "entrar"
    ? `${terminalDaqui()}, ${entrar}. Depois, tente de novo com o ${NOME_IA[ia]}.`
    : `Instale o ${NOME_CLI[ia]} (${ONDE_INSTALAR[ia]}) e, ${terminalDaqui().replace(/^No/, "no")}, ${entrar}. A ligação percebe quando ficar pronto.`;
}

export const artigoDoBot = (genero: "feminina" | "masculina"): string => (genero === "feminina" ? "A" : "O");

function logo(ia: IaDaLigacao): string {
  return `<span class="lsi-logo" aria-hidden="true">${LOGO[ia]}</span>`;
}
/** O logo da IA (o SVG), para quem desenha fora daqui. */
export const logoDaIa = (ia: IaDaLigacao): string => LOGO[ia];

/** Um botão da rede de segurança, como dado: o desenho por string e o do React leem o mesmo. */
export type BotaoSemIa =
  | { tipo: "continuar"; ia: IaDaLigacao; rotulo: string; primario: boolean; desabilitado: boolean }
  | { tipo: "entrar" | "instalar"; ia: IaDaLigacao; rotulo: string; desabilitado: boolean }
  | { tipo: "sem-voz"; rotulo: string; desabilitado: boolean }
  | { tipo: "desligar"; rotulo: string };

const continuar = (ia: IaDaLigacao, rotulo: string, s: EstadoSemIa, primario: boolean): BotaoSemIa => ({ tipo: "continuar", ia, rotulo, primario, desabilitado: s.ocupado });

/** A saída que não depende de IA nenhuma: no onboarding, seguir sem voz; numa ligação comum, desligar. */
function saida(s: EstadoSemIa): BotaoSemIa {
  return s.onboarding ? { tipo: "sem-voz", rotulo: "Configurar sem voz", desabilitado: s.ocupado } : { tipo: "desligar", rotulo: "Desligar" };
}

/** O que a pessoa faz com a IA que caiu: entrar com outra conta (pelo app) ou tentar de novo. */
function daQueCaiu(ia: IaDaLigacao, s: EstadoSemIa, curto: boolean): BotaoSemIa {
  const tentar = continuar(ia, curto ? "Tentar de novo" : `Tentar de novo com o ${NOME_IA[ia]}`, s, false);
  // Falha sem causa conhecida: o mais útil é tentar de novo. Conta sem acesso: tentar de novo só depois de trocar de conta.
  if (s.causa !== "conta_sem_acesso" || s.entrando === ia || !s.ponte.entrar) return tentar;
  return { tipo: "entrar", ia, rotulo: curto ? "Entrar com outra conta" : `Entrar com outra conta do ${NOME_IA[ia]}`, desabilitado: s.ocupado };
}

/** O card de uma IA (2C), como dado. */
export type CardSemIa = { ia: IaDaLigacao; nome: string; texto: string; noTerminal: string; acao: BotaoSemIa | null };

function cardDaIa(ia: IaDaLigacao, s: EstadoSemIa): CardSemIa {
  const daIa = s.ias.find((i) => i.id === ia);
  const estado = daIa?.estado ?? "ausente";
  const cli = NOME_CLI[ia];
  let texto: string;
  let acao: BotaoSemIa | null;
  // Sem a ponte do app (navegador comum, app antigo), o card diz o que fazer no Terminal no lugar do botão que falta.
  let noTerminal = "";
  if (ia === s.ia) {
    texto = s.causa === "conta_sem_acesso"
      ? `Entre com uma conta que tenha acesso, ou peça ao administrador da organização para liberar o ${cli}.`
      : s.causa === "limite"
        ? `O ${cli} chegou ao limite da assinatura. Dá para tentar de novo quando o limite renovar.`
        : `O ${cli} parou de responder nesta ligação. Dá para tentar de novo.`;
    acao = daQueCaiu(ia, s, true);
    if (s.causa === "conta_sem_acesso" && !s.ponte.entrar) noTerminal = notaNoTerminal(ia, "entrar");
  } else if (daIa?.causa === "sonda_lenta") {
    // NOD-178: o CLI só demorou para responder; nem "Instalar" nem "Entrar", o app do Mac sonda de novo sozinho.
    texto = `O ${cli} demorou para responder; ${plataformaDaTela() === "windows" ? "o computador" : "o Mac"} está carregado. A ligação percebe quando ficar pronto.`;
    acao = null;
  } else if (daIa?.causa === "atualizando") {
    // NOD-9: o nod está trocando o CLI por um mais novo; nem "Instalar" nem "não está neste Mac".
    texto = `Atualizando o ${cli} ${desteMac()}. A ligação percebe quando ficar pronto.`;
    acao = null;
  } else if (daIa?.causa === "cli_antigo" && daIa.versao && daIa.minima) {
    // NOD-171: o CLI está no Mac, abaixo do piso. Nem "Instalar" nem "não está neste Mac": a versão, a mínima e o comando.
    texto = `O ${cli} ${desteMac()} está na versão ${daIa.versao}; o nod precisa da ${versaoLegivel(daIa.minima)} ou mais nova. A ligação percebe quando ficar pronto.`;
    acao = null;
    noTerminal = `${terminalDaqui()}, rode “${COMANDO_ATUALIZAR_IA[ia]}”.`;
  } else if (estado === "nao_autenticado") {
    texto = s.ponte.entrar ? `O ${cli} está ${nesteMac()}; falta entrar na conta.` : `O ${cli} está ${nesteMac()}; falta entrar na conta. A ligação percebe quando ficar pronto.`;
    acao = s.ponte.entrar ? { tipo: "entrar", ia, rotulo: "Entrar", desabilitado: s.ocupado } : null;
    if (!s.ponte.entrar) noTerminal = `${terminalDaqui()}, rode “${LOGIN_NO_TERMINAL[ia]}” e entre na conta.`;
  } else {
    texto = s.ponte.instalar ? `O ${cli} não está ${nesteMac()}. Instale e entre na conta; a ligação percebe quando ficar pronto.` : `O ${cli} não está ${nesteMac()}.`;
    acao = s.ponte.instalar ? { tipo: "instalar", ia, rotulo: "Instalar e entrar", desabilitado: s.ocupado } : null;
    if (!s.ponte.instalar) noTerminal = notaNoTerminal(ia, "instalar");
  }
  return { ia, nome: NOME_IA[ia], texto, noTerminal, acao };
}

/**
 * O aviso enquanto a ligação espera a escolha, como dado. Com outra IA pronta (2A): o motivo e os botões. Sem nenhuma
 * (2C): um card por IA e a saída.
 */
export type SemIaNaTela = { titulo: string; nota: string | null } & (
  | { modo: "prontas"; texto: string; botoes: BotaoSemIa[]; terminal: string | null }
  | { modo: "cards"; texto: string; cards: CardSemIa[]; saida: BotaoSemIa }
);

export function semIaNaTela(s: EstadoSemIa, bot: { nome: string; genero: "feminina" | "masculina" }): SemIaNaTela {
  const titulo = `${artigoDoBot(bot.genero)} ${bot.nome} não conseguiu responder`;
  const motivo = motivoSemIa(s.causa, s.ia);
  const prontas = iasQuePodemAssumir(s);
  if (prontas.length > 0) {
    const assume = prontas.length === 1 && prontas[0] ? `O ${NOME_IA[prontas[0]]} está pronto ${nesteMac()} e pode assumir agora.` : `Há outra IA pronta ${nesteMac()}, que pode assumir agora.`;
    const botoes = [...prontas.map((ia, i) => continuar(ia, `Continuar com o ${NOME_IA[ia]}`, s, i === 0)), ...(s.ia ? [daQueCaiu(s.ia, s, false)] : []), saida(s)];
    // Fora do app não há botão de entrar: o texto diz o que fazer no Terminal.
    const terminal = s.ia && s.causa === "conta_sem_acesso" && !s.ponte.entrar && !s.nota ? notaNoTerminal(s.ia, "entrar") : null;
    return { titulo, nota: s.nota, modo: "prontas", texto: `${motivo} ${assume}`, botoes, terminal };
  }
  // Um card para a IA que caiu e um para cada IA que o servidor listou (uma IA fora da lista não atende ligação aqui).
  const cards = IAS.filter((ia) => ia === s.ia || s.ias.some((i) => i.id === ia)).map((ia) => cardDaIa(ia, s));
  return { titulo, nota: s.nota, modo: "cards", texto: `${motivo} Não há outra IA pronta ${nesteMac()}.`, cards, saida: saida(s) };
}

function htmlBotao(b: BotaoSemIa): string {
  switch (b.tipo) {
    case "continuar": return botao("ligacao-continuar-ia", b.primario ? `${logo(b.ia)}<span>${esc(b.rotulo)}</span>` : esc(b.rotulo), { classe: b.primario ? "pri sm lsi-continuar" : "sm", dados: { ia: b.ia }, desabilitado: b.desabilitado });
    case "entrar": return botao("ligacao-ia-entrar", b.rotulo, { classe: "sm", dados: { ia: b.ia }, desabilitado: b.desabilitado });
    case "instalar": return botao("ligacao-ia-instalar", b.rotulo, { classe: "sm", dados: { ia: b.ia }, desabilitado: b.desabilitado });
    case "sem-voz": return botao("ligacao-sem-voz", b.rotulo, { classe: "link lsi-saida", desabilitado: b.desabilitado });
    case "desligar": return botao("ligacao-desligar", b.rotulo, { classe: "link lsi-saida" });
  }
}

/** O aviso enquanto a ligação espera a escolha. Nasce como `alert`: é ele que explica o silêncio do bot. */
export function htmlSemIa(s: EstadoSemIa, bot: { nome: string; genero: "feminina" | "masculina" }): string {
  const v = semIaNaTela(s, bot);
  const nota = v.nota ? `<p class="lsi-nota" role="status">${esc(v.nota)}</p>` : "";
  if (v.modo === "prontas") {
    const terminal = v.terminal ? `<p class="lsi-nota">${esc(v.terminal)}</p>` : "";
    return avisoDeEstado({ tom: "alerta", titulo: v.titulo, texto: v.texto, papel: "alert", classe: "lig-sem-ia", extra: `<div class="lsi-acoes">${v.botoes.map(htmlBotao).join("")}</div>${terminal}${nota}` });
  }
  const cards = v.cards.map((c) => `<div class="lsi-card"><div class="lsi-card-cab">${logo(c.ia)}<b>${esc(c.nome)}</b></div><p class="lsi-card-txt">${esc(c.texto)}</p>${c.noTerminal ? `<p class="lsi-card-txt">${esc(c.noTerminal)}</p>` : ""}${c.acao ? htmlBotao(c.acao) : ""}</div>`).join("");
  const rodape = `<div class="lsi-rodape">${htmlBotao(v.saida)}<span>A ligação espera enquanto você resolve.</span></div>`;
  return avisoDeEstado({ tom: "alerta", titulo: v.titulo, texto: v.texto, papel: "alert", classe: "lig-sem-ia", extra: `${cards ? `<div class="lsi-cards">${cards}</div>` : ""}${rodape}${nota}` });
}

/** O texto do aviso neutro depois da escolha (2B). */
export function textoIaVoltou(v: EstadoIaVoltou, bot: { nome: string; genero: "feminina" | "masculina" }): string {
  const quem = `${artigoDoBot(bot.genero)} ${bot.nome}`;
  return v.ia === null ? `${quem} voltou a responder.` : v.trocou ? `${quem} agora usa o ${NOME_IA[v.ia]} ${nesteMac()}. Vale para esta ligação.` : `${quem} voltou a responder pelo ${NOME_IA[v.ia]}.`;
}

/**
 * O aviso neutro depois da escolha (2B). O harness foi forçado só no turno-cérebro desta ligação: o texto não promete
 * mais que isso (a preferência do bot e a dos outros bots não mudam aqui).
 */
export function htmlIaVoltou(v: EstadoIaVoltou, bot: { nome: string; genero: "feminina" | "masculina" }): string {
  const marca = v.ia ? logo(v.ia) : "";
  return `<div class="aviso-estado tom-info aviso-compacto lig-ia-voltou" role="status">${marca}<div class="aviso-estado-txt">${esc(textoIaVoltou(v, bot))}</div></div>`;
}
