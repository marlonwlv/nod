import type { Agente } from "../../src/contracts/agente.ts";
import type { AgendaDto, ItemAgenda } from "../../src/contracts/agenda.ts";
import type { RotinaDto } from "../../src/contracts/api.ts";
import type { DesfechoRotina } from "../../src/contracts/motivos.ts";
import { motivoDaExecucao } from "./execucao.ts";

/**
 * Rotinas em lista (2026-11-19, Paper "Rotinas · lista no lugar da agenda", aprovado): Configurações › Rotinas deixa de
 * ser a agenda da NOD-85 (régua da semana, mini mês, linha do agora) e vira a lista do que cada bot faz sozinho. Três
 * grupos: "Precisa de você" (parada, com o botão que resolve), "Próximas" (as ativas, pela próxima vez) e "Pausadas"
 * (recolhidas). A próxima vez vem de GET rotinas (o servidor calcula, ADR-011); a última vez e as últimas 4, das
 * execuções que GET rotinas/agenda devolve para trás. Peças puras: as datas são as do navegador (o fuso da leitura).
 */

/** Dias para trás que a lista lê (o servidor aceita até 42): cobre a última vez de uma rotina semanal com folga. */
export const DIAS_PARA_TRAS = 28;
/** Quantas ativas aparecem antes de "Mais N ativas · Ver todas". */
export const MAX_PROXIMAS = 6;
/** Quantas execuções a rotina aberta mostra. */
export const MAX_ULTIMAS = 4;

const dois = (n: number) => String(n).padStart(2, "0");
export const DIA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function diaDe(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

function data(dia: string): Date {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(a!, m! - 1, d!);
}

/** Meia-noite do dia no fuso do navegador (o Date local acerta o horário de verão). */
export const inicioDoDia = (dia: string): number => data(dia).getTime();

export function somarDias(dia: string, n: number): string {
  const d = data(dia);
  d.setDate(d.getDate() + n);
  return diaDe(d.getTime());
}

/** O dia existe de fato (o Date rola 31/02 para março). */
export const diaValido = (dia: string): boolean => DIA.test(dia) && somarDias(dia, 0) === dia;

/** A janela lida: os últimos DIAS_PARA_TRAS dias até o fim de hoje (`ate` exclusivo). O futuro vem de GET rotinas. */
export function janelaDaLista(hoje: string): { de: string; ate: string } {
  return { de: somarDias(hoje, -DIAS_PARA_TRAS), ate: somarDias(hoje, 1) };
}

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export const hora = (ms: number): string => {
  const d = new Date(ms);
  return `${dois(d.getHours())}:${dois(d.getMinutes())}`;
};

/** "seg, 17 nov". */
export function dataCurta(ms: number): string {
  const d = new Date(ms);
  return `${SEMANA[d.getDay()]}, ${d.getDate()} ${MESES[d.getMonth()]}`;
}

/** "hoje", "ontem", "amanhã" ou "seg, 17 nov". */
export function diaRelativo(ms: number, agora: number): string {
  const dia = diaDe(ms);
  const hoje = diaDe(agora);
  if (dia === hoje) return "hoje";
  if (dia === somarDias(hoje, -1)) return "ontem";
  if (dia === somarDias(hoje, 1)) return "amanhã";
  return dataCurta(ms);
}

/** A coluna "Próxima vez": a hora e, embaixo, "em 12 min", "hoje", "amanhã" ou "seg, 24 nov". */
export function proximaVez(ms: number, agora: number): { hora: string; quando: string } {
  const falta = ms - agora;
  const quando = falta > 0 && falta < 60 * 60_000 ? `em ${Math.max(1, Math.round(falta / 60_000))} min` : diaRelativo(ms, agora);
  return { hora: hora(ms), quando };
}

export const itemComProblema = (i: ItemAgenda): boolean => (i.tipo === "execucao" ? i.problema : i.tipo === "faixa" ? i.problemas > 0 : false);

/** O começo da instrução, como título curto da rotina (o mesmo corte da mini-agenda do chat). */
export function tituloDaRotina(instrucao: string, max = 48): string {
  const t = instrucao.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export type BotDaAgenda = Pick<Agente, "id" | "nome" | "cor" | "forma">;

/** A única cor da linha: verde rodou, âmbar falhou ou parou no meio, cinza passou em branco, vermelho parada. */
export type Tom = "ok" | "atencao" | "erro" | "neutro";

/** Uma vez que a rotina rodou (ou devia ter rodado). `vezes` = o dia de uma rotina frequente, resumido pelo servidor. */
export type Passagem = { instante: number; tom: Tom; desfecho: DesfechoRotina | null; motivo: string | null; vezes?: { execucoes: number; problemas: number } };

const TOM: Record<DesfechoRotina, Tom> = {
  executou: "ok",
  passou_em_branco: "neutro",
  sem_novidade: "neutro",
  falhou: "atencao",
  interrompida: "atencao",
  bloqueada: "erro",
  nao_rodou: "atencao",
  adiada: "neutro",
};

/** As passagens de cada rotina na janela lida, da mais nova para a mais velha. A prevista não é passagem. */
export function passagensPorRotina(dto: AgendaDto | null, agora: number): Map<string, Passagem[]> {
  const mapa = new Map<string, Passagem[]>();
  for (const i of dto?.itens ?? []) {
    let p: Passagem | null = null;
    if (i.tipo === "execucao") p = { instante: i.instante, tom: TOM[i.desfecho], desfecho: i.desfecho, motivo: i.motivo };
    else if (i.tipo === "faixa" && i.execucoes > 0) p = { instante: Math.min(i.ultima, agora), tom: i.problemas > 0 ? "atencao" : "ok", desfecho: null, motivo: null, vezes: { execucoes: i.execucoes, problemas: i.problemas } };
    if (!p) continue;
    const lista = mapa.get(i.rotinaId) ?? [];
    lista.push(p);
    mapa.set(i.rotinaId, lista);
  }
  for (const lista of mapa.values()) lista.sort((a, b) => b.instante - a.instante);
  return mapa;
}

const motivoEscrito = (p: Passagem): string | null => {
  const m = p.motivo === null ? null : motivoDaExecucao({ motivo: p.motivo });
  return m ? m.charAt(0).toLowerCase() + m.slice(1) : null;
};

/** O fim da linha da rotina: "rodou hoje às 08:00", "falhou ontem: …", "hoje não tinha nada novo". */
export function fraseDaUltima(p: Passagem | undefined, agora: number): string {
  if (!p) return "ainda não rodou";
  const dia = diaRelativo(p.instante, agora);
  if (p.vezes) return `${p.vezes.execucoes} ${p.vezes.execucoes === 1 ? "vez" : "vezes"} ${dia}${p.vezes.problemas ? `, ${p.vezes.problemas} com problema` : ""}`;
  const motivo = motivoEscrito(p);
  switch (p.desfecho) {
    case "executou": return dia === "hoje" || dia === "ontem" ? `rodou ${dia} às ${hora(p.instante)}` : `rodou ${dia}`;
    case "passou_em_branco":
    case "sem_novidade": return `${dia} não tinha nada novo`;
    case "falhou": return `falhou ${dia}${motivo ? `: ${motivo}` : ""}`;
    case "interrompida": return `parou no meio ${dia}`;
    case "bloqueada": return `parada ${dia}`;
    case "nao_rodou": return `não rodou ${dia}${motivo ? `: ${motivo}` : ""}`;
    case "adiada": return `adiada ${dia}`;
    default: return `rodou ${dia}`;
  }
}

const ROTULO: Record<DesfechoRotina, string> = {
  executou: "Rodou",
  passou_em_branco: "Não tinha nada novo",
  sem_novidade: "Não tinha nada novo",
  falhou: "Falhou",
  interrompida: "Parou no meio",
  bloqueada: "Parada",
  nao_rodou: "Não rodou",
  adiada: "Adiada",
};

/** A linha de "Últimas vezes" na rotina aberta: "ontem, 17:00" e "Falhou: o Slack recusou a mensagem". */
export function linhaDaPassagem(p: Passagem, agora: number): { quando: string; texto: string } {
  const dia = diaRelativo(p.instante, agora);
  const quando = dia === "hoje" || dia === "ontem" ? `${dia}, ${hora(p.instante)}` : dia;
  if (p.vezes) return { quando, texto: `${p.vezes.execucoes} ${p.vezes.execucoes === 1 ? "vez" : "vezes"}${p.vezes.problemas ? `, ${p.vezes.problemas} com problema` : ""}` };
  const motivo = motivoEscrito(p);
  return { quando, texto: `${ROTULO[p.desfecho ?? "executou"]}${motivo ? `: ${motivo}` : ""}` };
}

export type VisaoRotinas = "todas" | "ativas" | "pausadas";
export type FiltroLista = { visao: VisaoRotinas; bots: readonly string[]; soProblema: boolean };

export type LinhaRotina = {
  dto: RotinaDto;
  bot: BotDaAgenda | null;
  /** É da pessoa que lê. A de outra pessoa (equipe) aparece, mas sem ação nenhuma (o servidor recusa). */
  minha: boolean;
  passagens: Passagem[];
};

export type ListaRotinas = {
  precisa: LinhaRotina[];
  proximas: LinhaRotina[];
  pausadas: LinhaRotina[];
  /** Depois do filtro de bot e de problema, antes da visão: os números das abas. */
  conta: Record<VisaoRotinas, number>;
  /** Os bots que têm rotina, por nome (o filtro "Todos os bots"). */
  bots: BotDaAgenda[];
};

/** Parada é o que pede a pessoa: falta acesso (bloqueio) ou uma pergunta sem resposta. Só a dona resolve. */
const precisaDeVoce = (r: RotinaDto, minha: boolean): boolean => minha && r.rotina.estado === "ativa" && (r.bloqueio !== null || r.perguntaPendente !== undefined);

/** A rotina webhook não tem hora: vai para o fim das próximas. */
export const ehWebhook = (r: RotinaDto): boolean => r.rotina.gatilho === "webhook";

export function montarLista(entrada: { rotinas: readonly RotinaDto[]; dto: AgendaDto | null; agentes: readonly BotDaAgenda[]; filtro: FiltroLista; pessoaId: string | null; agora: number }): ListaRotinas {
  const { filtro } = entrada;
  const botPorId = new Map(entrada.agentes.map((a) => [a.id, a]));
  const passagens = passagensPorRotina(entrada.dto, entrada.agora);
  const linhas: LinhaRotina[] = entrada.rotinas.map((dto) => ({ dto, bot: botPorId.get(dto.rotina.agenteId) ?? null, minha: dto.rotina.ownerId === entrada.pessoaId, passagens: passagens.get(dto.rotina.id) ?? [] }));
  const bots = [...new Set(linhas.map((l) => l.dto.rotina.agenteId))].map((id) => botPorId.get(id)).filter((b): b is BotDaAgenda => !!b).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const comProblema = (l: LinhaRotina) => precisaDeVoce(l.dto, l.minha) || l.dto.bloqueio !== null || (l.passagens[0] ? l.passagens[0].tom !== "ok" && l.passagens[0].tom !== "neutro" : false);
  const passa = linhas.filter((l) => (filtro.bots.length === 0 || filtro.bots.includes(l.dto.rotina.agenteId)) && (!filtro.soProblema || comProblema(l)));
  const nome = (l: LinhaRotina) => l.bot?.nome ?? "";
  const ativas = passa.filter((l) => l.dto.rotina.estado === "ativa");
  const precisa = ativas.filter((l) => precisaDeVoce(l.dto, l.minha)).sort((a, b) => nome(a).localeCompare(nome(b), "pt-BR"));
  const proximas = ativas
    .filter((l) => !precisaDeVoce(l.dto, l.minha))
    .sort((a, b) => Number(ehWebhook(a.dto)) - Number(ehWebhook(b.dto)) || a.dto.proximaExecucao - b.dto.proximaExecucao || nome(a).localeCompare(nome(b), "pt-BR"));
  const pausadas = passa.filter((l) => l.dto.rotina.estado === "pausada").sort((a, b) => nome(a).localeCompare(nome(b), "pt-BR"));
  const conta = { todas: passa.length, ativas: ativas.length, pausadas: pausadas.length };
  if (filtro.visao === "ativas") return { precisa, proximas, pausadas: [], conta, bots };
  if (filtro.visao === "pausadas") return { precisa: [], proximas: [], pausadas, conta, bots };
  return { precisa, proximas, pausadas, conta, bots };
}

/** O link interno que o bot escreve (`ver_agenda`): `nod:agenda?dia=AAAA-MM-DD[&problema=1]`, exato, nada mais. */
const LINK_AGENDA = /^nod:agenda\?dia=(\d{4}-\d{2}-\d{2})(&problema=1)?$/;

export function lerLinkDaAgenda(href: string): { dia: string; soProblema: boolean } | null {
  const m = LINK_AGENDA.exec(href.trim());
  if (!m || !diaValido(m[1]!)) return null;
  return { dia: m[1]!, soProblema: !!m[2] };
}
