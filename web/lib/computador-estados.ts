import type { ComputadorPessoaDto } from "./computador-pessoa.ts";
import { esc } from "./escape.ts";
import { htmlMascote } from "./mascote.ts";

/**
 * Item 2 da especificação D (Computador do bot, 2026-11-12): o cartão "Computador de {Bot}" do painel de detalhes. A
 * miniatura 64 × 40 NUNCA mostra a imagem da tela; ela diz um de quatro estados:
 *
 * - **Em repouso**: ninguém usa a tela deste bot. Gradiente cinza e o personagem cinza dormindo, com 3 "z".
 * - **Ativo**: o bot usa a tela (navegador ou terminal) ou a pessoa está com ela aberta. Gradiente na cor do bot.
 * - **Ligando**: o computador está acordando (ou sendo trocado por Atualizar/Redefinir). Personagem cinza acordado.
 * - **Fora**: "Sem conexão" ou "Fora do ar desde HH:MM", com o olho riscado e "Tentar de novo" no próprio status.
 *
 * Ativo → Em repouso não é imediato: 19 s depois que o bot termina com a tela fechada, ou 0,8 s depois de fechar a tela
 * se o bot já tinha terminado. Por isso há uma máquina de estados (com timers) por bot; o resto é puro.
 */
export const ESTADOS_DA_MINIATURA = ["repouso", "ativo", "ligando", "fora"] as const;
export type EstadoDaMiniatura = (typeof ESTADOS_DA_MINIATURA)[number];

/** Definido na especificação D, item 2: quanto o "Ativo" dura depois que o bot termina, com a tela fechada. */
export const MS_REPOUSO_DEPOIS_DO_BOT = 19_000;
/** Definido na especificação D, item 2: quanto o "Ativo" dura depois de fechar a tela, com o bot já parado. */
export const MS_REPOUSO_DEPOIS_DE_FECHAR = 800;

/** O que a máquina de estados lê a cada render: o computador, o bot e a tela cheia. */
export type EntradaDoCartao = {
  computador: "ok" | "ligando" | "fora";
  /** Fora: a máquina do computador perdeu contato ("Sem conexão"), em vez de o computador ter caído ("Fora do ar"). */
  semConexao: boolean;
  /** Fora do ar desde (epoch ms); null = sem hora. */
  foraDesde: number | null;
  /** O bot está usando a tela dele agora (navegador ou terminal). */
  botUsando: boolean;
  /** A pessoa está com a tela cheia deste bot aberta. */
  telaAberta: boolean;
};

export const ENTRADA_PARADA: EntradaDoCartao = { computador: "ok", semConexao: false, foraDesde: null, botUsando: false, telaAberta: false };

const OPERACOES_QUE_RELIGAM = new Set(["atualizar", "redefinir", "trocar"]);

/**
 * Lê a entrada do cartão no computador da pessoa (v2). `botTrabalhando` vem do turno (o personagem animado): a tela
 * aberta de um bot parado não é "Ativo" — ela fica aberta um tempo depois do turno, e o cartão já tem de descansar.
 */
export function entradaDoComputador(dto: ComputadorPessoaDto, agenteId: string, p: { botTrabalhando: boolean; telaAberta: boolean }): EntradaDoCartao {
  const semConexao = dto.semContatoDesde != null || (dto.estado === "fora_do_ar" && dto.falha?.motivo === "maquina_sem_contato");
  if (dto.estado === "fora_do_ar" || dto.semContatoDesde != null) {
    return { computador: "fora", semConexao, foraDesde: dto.falha?.desde ?? dto.semContatoDesde ?? null, botUsando: false, telaAberta: p.telaAberta };
  }
  const ligando = dto.estado === "ligando" || (dto.operacao != null && OPERACOES_QUE_RELIGAM.has(dto.operacao.tipo));
  const tela = dto.telas.find((t) => t.agenteId === agenteId && t.estado !== "fechada");
  const botUsando = !!tela && (tela.estado === "abrindo" || tela.controle === "pessoa" || (tela.estado === "aberta" && p.botTrabalhando));
  return { computador: ligando ? "ligando" : "ok", semConexao: false, foraDesde: null, botUsando, telaAberta: p.telaAberta };
}

/** O estado sem esperas (o que a entrada pede agora). O "Ativo" que ainda espera os 19 s / 0,8 s fica com a máquina. */
export function estadoSemEspera(e: EntradaDoCartao): EstadoDaMiniatura {
  if (e.computador === "fora") return "fora";
  if (e.computador === "ligando") return "ligando";
  return e.botUsando || e.telaAberta ? "ativo" : "repouso";
}

export type Relogio = {
  agora(): number;
  esperar(fn: () => void, ms: number): unknown;
  cancelar(id: unknown): void;
};

const RELOGIO_PADRAO: Relogio = {
  agora: () => Date.now(),
  esperar: (fn, ms) => setTimeout(fn, ms),
  cancelar: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export type MaquinaDoCartao = {
  /** Lê a entrada e devolve o estado de agora. Não avisa `aoMudar` (quem chamou já está desenhando). */
  observar(e: EntradaDoCartao): EstadoDaMiniatura;
  readonly estado: EstadoDaMiniatura;
  descartar(): void;
};

/**
 * A máquina de estados de um cartão. `aoMudar` só é chamado quando o estado muda sozinho (o timer do repouso): as
 * mudanças pedidas por `observar` voltam na chamada. Nunca avisa sem mudar (o cartão não pisca nem redesenha à toa).
 */
export function criarMaquinaDoCartao(aoMudar: (e: EstadoDaMiniatura) => void = () => {}, relogio: Relogio = RELOGIO_PADRAO): MaquinaDoCartao {
  let estado: EstadoDaMiniatura | null = null;
  let antes: EntradaDoCartao | null = null;
  let timer: unknown = null;
  let prazo = Infinity;

  const cancelar = (): void => {
    if (timer !== null) relogio.cancelar(timer);
    timer = null;
    prazo = Infinity;
  };
  const agendar = (ms: number): void => {
    const novo = relogio.agora() + ms;
    if (timer !== null && prazo <= novo) return;
    cancelar();
    prazo = novo;
    timer = relogio.esperar(() => {
      timer = null;
      prazo = Infinity;
      if (estado === "repouso") return;
      estado = "repouso";
      aoMudar(estado);
    }, ms);
  };

  return {
    get estado() { return estado ?? "repouso"; },
    observar(e) {
      const pedido = estadoSemEspera(e);
      const anterior = antes;
      antes = e;
      if (pedido !== "repouso" || estado !== "ativo") {
        cancelar();
        estado = pedido;
        return estado;
      }
      // Ativo e nada mais pede o Ativo: espera antes de descansar. Fechar a tela com o bot parado é rápido (0,8 s);
      // o bot terminar com a tela fechada é devagar (19 s). Um prazo mais curto ganha do mais longo já marcado.
      if (anterior?.telaAberta && !e.telaAberta) agendar(MS_REPOUSO_DEPOIS_DE_FECHAR);
      else if (anterior?.botUsando && !e.botUsando) agendar(MS_REPOUSO_DEPOIS_DO_BOT);
      else if (timer === null) agendar(MS_REPOUSO_DEPOIS_DO_BOT);
      return estado;
    },
    descartar: cancelar,
  };
}

// ---- um cartão por bot (o painel de detalhes) ------------------------------------------------------------------------

const maquinas = new Map<string, MaquinaDoCartao>();
let versao = 0;
let ouvinte: (() => void) | null = null;

/** Quem redesenha o painel quando um cartão muda sozinho (web/lib/gaveta-render.ts). */
export function aoMudarOsCartoes(f: (() => void) | null): void {
  ouvinte = f;
}

/** Muda toda vez que um cartão muda sozinho: entra na memória do render do painel para ele não servir o HTML velho. */
export function versaoDosCartoes(): number {
  return versao;
}

function avisar(): void {
  versao++;
  ouvinte?.();
}

/** O estado do cartão de um bot, com a máquina dele (criada na primeira vez). */
export function estadoDoCartaoDoBot(agenteId: string, e: EntradaDoCartao): EstadoDaMiniatura {
  vigiarTelaCheia();
  let m = maquinas.get(agenteId);
  if (!m) {
    m = criarMaquinaDoCartao(avisar);
    maquinas.set(agenteId, m);
  }
  return m.observar(e);
}

/** Para os testes: esquece as máquinas (e os timers delas). */
export function esquecerOsCartoes(): void {
  for (const m of maquinas.values()) m.descartar();
  maquinas.clear();
}

// ---- a tela cheia aberta (o visualizador do item 3) ------------------------------------------------------------------

/** O visualizador de hoje é o `dialog.cb-veu` de web/telas/tela-cheia.ts; o do item 3 é uma região "Tela de {Bot}". */
const SELETOR_TELA = 'dialog.cb-veu[open], [role="region"][aria-label^="Tela de "]';

/*
 * Este módulo também entra na compilação do servidor (reducer → computador-pessoa → aqui), que não tem a lib "dom":
 * o DOM é lido por tipos mínimos em `globalThis`, e sem ele (servidor, testes do HTML) nada é vigiado.
 */
type ElMin = { getAttribute(nome: string): string | null };
type DocMin = { querySelectorAll?(seletor: string): Iterable<ElMin>; body?: unknown };
type VigiaMin = { observe(alvo: unknown, opcoes: object): void };
type ObsMin = new (cb: () => void) => VigiaMin;
const doc = (): DocMin | undefined => (globalThis as { document?: DocMin }).document;
const Observador = (): ObsMin | undefined => (globalThis as { MutationObserver?: ObsMin }).MutationObserver;

/** A tela cheia de `nome` está aberta? (Sem DOM, como nos testes do HTML, não.) */
export function telaCheiaAberta(nome: string): boolean {
  const d = doc();
  if (!d || typeof d.querySelectorAll !== "function") return false;
  const rotulo = `Tela de ${nome}`;
  return [...d.querySelectorAll(SELETOR_TELA)].some((el) => el.getAttribute("aria-label") === rotulo);
}

let vigia: VigiaMin | null = null;
let assinatura = "";

/**
 * Fechar a tela cheia nem sempre muda o estado da web (Assistindo não devolve nada ao servidor). Para os 0,8 s valerem,
 * o painel olha a tela cheia entrar e sair do DOM e se redesenha quando muda o conjunto das telas abertas.
 */
function vigiarTelaCheia(): void {
  const d = doc();
  const Obs = Observador();
  if (vigia || !d || typeof d.querySelectorAll !== "function" || !Obs || !d.body) return;
  const ler = (): string => [...d.querySelectorAll!(SELETOR_TELA)].map((el) => el.getAttribute("aria-label") ?? "").join("|");
  assinatura = ler();
  const conferir = (): void => {
    const agora = ler();
    if (agora === assinatura) return;
    assinatura = agora;
    avisar();
  };
  // A tela cheia entra e sai como filha direta do body (os filhos de baixo não são vistos: cada render do app mexe neles);
  // o `open` do <dialog>, onde estiver. Atributo filtrado é barato: só `open` dispara.
  vigia = new Obs(conferir);
  vigia.observe(d.body, { childList: true });
  new Obs(conferir).observe(d.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
}

// ---- HTML ------------------------------------------------------------------------------------------------------------

const OLHO_RISCADO = '<svg class="cpm-olho" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="m2 2 20 20"/></svg>';

export type BotDoCartao = { id: string; nome: string; cor?: string; forma?: string };

/** "14:02" no fuso de quem vê. */
function hora(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** O texto do status: "Em repouso", "Ativo", "Ligando…", "Sem conexão" ou "Fora do ar desde 14:02". */
export function textoDoStatus(estado: EstadoDaMiniatura, e: Pick<EntradaDoCartao, "semConexao" | "foraDesde">): string {
  switch (estado) {
    case "repouso": return "Em repouso";
    case "ativo": return "Ativo";
    case "ligando": return "Ligando…";
    case "fora": return e.semConexao ? "Sem conexão" : e.foraDesde != null ? `Fora do ar desde ${hora(e.foraDesde)}` : "Fora do ar";
  }
}

/** A miniatura 64 × 40, sem imagem. O personagem só no repouso (dormindo, com 3 "z") e no ligando (acordado). */
export function htmlMiniatura(estado: EstadoDaMiniatura, bot: Pick<BotDoCartao, "nome" | "cor" | "forma">): string {
  const cor = bot.cor ?? "c-gray";
  const personagem = (sono: boolean) => htmlMascote({ nome: bot.nome, cor: cor as never, forma: (bot.forma ?? "") as never }, "", sono ? "pausado" : "disponivel", 'aria-hidden="true"').replace(' role="img"', "");
  const miolo = estado === "repouso"
    ? `<span class="cpm-personagem">${personagem(true)}<span class="cpm-zzz"><i>z</i><i>z</i><i>z</i></span></span>`
    : estado === "ligando"
      ? `<span class="cpm-personagem">${personagem(false)}</span>`
      : estado === "fora"
        ? OLHO_RISCADO
        : "";
  return `<span class="cpm-mini ${esc(cor)}" data-miniatura="${estado}" aria-hidden="true">${miolo}</span>`;
}

/**
 * O cartão: a linha de 52 px com "Computador de {Bot}", o status e a miniatura. A linha inteira é o botão que abre a
 * tela cheia (o botão cobre a linha; "Tentar de novo" fica por cima dele, no status). Sem `data-tela-bot`: nenhuma
 * imagem da tela entra aqui (web/telas/tela-do-bot.ts só pinta em quem tem esse atributo).
 */
export function htmlCartaoComputador(estado: EstadoDaMiniatura, bot: BotDoCartao, e: Pick<EntradaDoCartao, "semConexao" | "foraDesde">, tentar: string): string {
  const status = esc(textoDoStatus(estado, e));
  const link = estado === "fora" ? `<span class="cpm-sep" aria-hidden="true"> · </span><button type="button" class="cpm-tentar" ${tentar}>Tentar de novo</button>` : "";
  return `<div class="cpm-cartao" data-cartao-computador="${esc(bot.id)}" data-estado-miniatura="${estado}"><div class="cpm-linha"><button type="button" class="cpm-abrir" data-act="abrir-computador" data-id="${esc(bot.id)}" aria-label="${esc(`Abrir a tela de ${bot.nome}`)}"></button><span class="cpm-txt"><b>${esc(`Computador de ${bot.nome}`)}</b><small class="cpm-status">${status}${link}</small></span>${htmlMiniatura(estado, bot)}</div></div>`;
}

/** O "Tentar de novo" do computador da pessoa (v2): a operação de sempre. */
export const TENTAR_V2 = 'data-act="operar-computador" data-op="tentar_de_novo"';

/**
 * O cartão sem máquina de estados (sem as esperas do repouso), para quem só precisa do retrato de agora. Mantém o nome
 * e a assinatura de antes (web/lib/computador-pessoa.ts ainda o chama).
 */
export function htmlCartaoDoComputador(dto: ComputadorPessoaDto, bot: BotDoCartao, agora: number = Date.now()): string {
  void agora;
  const e = entradaDoComputador(dto, bot.id, { botTrabalhando: false, telaAberta: false });
  return htmlCartaoComputador(estadoSemEspera(e), bot, e, TENTAR_V2);
}
