import type { EventoStream, FaseDoBloco } from "../contracts/evento-stream.ts";
import type { EstadoVivoBot, FalhaDoTurno, FimDoTurnoNoFrame, MotivoAguardando, ResultadoTurno } from "../contracts/estado-vivo.ts";

/**
 * Projeção do estado vivo por bot (definido em 2026-11-12; contrato em src/contracts/estado-vivo.ts). Pura: recebe o
 * frame que o barramento publicou (tipo + dados) ou um sinal do motor (compondo, pensando, texto) e devolve os bots que
 * mudaram. O estado mora num objeto mutável que o serviço guarda por pessoa (src/services/estado-vivo.ts).
 *
 * Regras:
 * - `turno.iniciado` do `turno_despachado` põe o turno entre os vivos do bot; o do `turno_criado` (fila) só indexa o
 *   turno → bot (não existe `na_fila`).
 * - Um bot pode ter vários turnos vivos (frentes em paralelo): `rodando` = algum vivo; atividade e compondo são do último
 *   evento de qualquer um deles.
 * - Frames do plano (atividade, subagentes, fala…) de um turno que já fechou são ignorados: o `parar` dos subagentes sai
 *   depois do fim e não pode religar o bot.
 * - `turno.encerrado`/`turno.interrompido` tiram o turno dos vivos e gravam o desfecho; o turno que nunca rodou
 *   (absorvido, cancelado na fila) não mexe no desfecho.
 * - `decisao.nova` com turno ou conversa conhecidos abre a espera; `decisao.decidida`/`vencida` fecha. `aguardando` é a
 *   mais antiga aberta.
 */

/** definido em 2026-11-12: turnos fechados lembrados para ignorar frame atrasado; acima disso sai o mais antigo. */
const FECHADOS_GUARDADOS = 500;
/** definido em 2026-11-12: teto do índice turno → bot e conversa → bot (o turno que some sem fim sai pelo teto). */
const INDICE_MAX = 2_000;

export type SinalDoMotor = FaseDoBloco | "texto";
export type RefDoTurno = { agenteId: string; turnoId: string; conversaId: string | null };

type Decisao = { agenteId: string; motivo: MotivoAguardando; desde: number; venceEm: number | null };
type Bot = { estado: EstadoVivoBot; vivos: Set<string> };

export type ProjecaoEstadoVivo = {
  bots: Map<string, Bot>;
  turnos: Map<string, { agenteId: string; conversaId: string | null }>;
  conversas: Map<string, string>;
  decisoes: Map<string, Decisao>;
  fechados: Set<string>;
};

export function novaProjecao(): ProjecaoEstadoVivo {
  return { bots: new Map(), turnos: new Map(), conversas: new Map(), decisoes: new Map(), fechados: new Set() };
}

export function estadoParado(agenteId: string, agora: number): EstadoVivoBot {
  return { agenteId, rodando: false, compondo: false, atividade: null, aguardando: null, subagentes_rodando: 0, ultimo_desfecho: null, vence_em: null, turnoId: null, conversaId: null, em: agora };
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

function limitar<K, V>(m: Map<K, V>): void {
  while (m.size > INDICE_MAX) m.delete(m.keys().next().value as K);
}

function bot(p: ProjecaoEstadoVivo, agenteId: string, agora: number): Bot {
  let b = p.bots.get(agenteId);
  if (!b) {
    b = { estado: estadoParado(agenteId, agora), vivos: new Set() };
    p.bots.set(agenteId, b);
  }
  return b;
}

function indexar(p: ProjecaoEstadoVivo, turnoId: string | null, agenteId: string, conversaId: string | null): void {
  if (turnoId) { p.turnos.set(turnoId, { agenteId, conversaId }); limitar(p.turnos); }
  if (conversaId) { p.conversas.set(conversaId, agenteId); limitar(p.conversas); }
}

/** Muda o estado e diz se algo mudou de fato (sem `em`), para não publicar frame igual. */
function mudar(b: Bot, novo: Partial<EstadoVivoBot>, agora: number): boolean {
  const antes = b.estado;
  const depois = { ...antes, ...novo };
  const igual = (Object.keys(novo) as (keyof EstadoVivoBot)[]).every((k) => JSON.stringify(antes[k]) === JSON.stringify(depois[k]));
  if (igual) return false;
  b.estado = { ...depois, em: agora };
  return true;
}

/** O turno começou a rodar (ou um frame do plano chegou de um turno que a projeção não viu começar). */
function ligar(p: ProjecaoEstadoVivo, ref: RefDoTurno, agora: number, extra: Partial<EstadoVivoBot> = {}): boolean {
  indexar(p, ref.turnoId, ref.agenteId, ref.conversaId);
  const b = bot(p, ref.agenteId, agora);
  const novo = !b.vivos.has(ref.turnoId);
  b.vivos.add(ref.turnoId);
  const base: Partial<EstadoVivoBot> = novo ? { rodando: true, compondo: false, atividade: null, subagentes_rodando: 0 } : { rodando: true };
  return mudar(b, { ...base, turnoId: ref.turnoId, conversaId: ref.conversaId ?? b.estado.conversaId, ...extra }, agora);
}

function refDoPlano(p: ProjecaoEstadoVivo, dados: Record<string, unknown>): RefDoTurno | null {
  const turnoId = str(dados.turnoId);
  if (!turnoId || p.fechados.has(turnoId)) return null;
  const agenteId = str(dados.agenteId) ?? str(dados.agente_id) ?? p.turnos.get(turnoId)?.agenteId ?? null;
  if (!agenteId) return null;
  return { agenteId, turnoId, conversaId: str(dados.conversaId) ?? p.turnos.get(turnoId)?.conversaId ?? null };
}

/** O sinal que um evento do CLI acende (o `fase` do parser; o laço local o lê direto do evento). */
export function sinalDoEvento(ev: EventoStream): SinalDoMotor | null {
  return ev.tipo === "fase" ? ev.fase : null;
}

/** Sinal do motor que não vira frame próprio (o texto do modelo não sai mais à pessoa: só o "compondo"). */
export function aplicarSinal(p: ProjecaoEstadoVivo, ref: RefDoTurno, sinal: SinalDoMotor, agora: number): string[] {
  if (p.fechados.has(ref.turnoId)) return [];
  const extra: Partial<EstadoVivoBot> =
    sinal === "pensando" ? { compondo: false, atividade: { tipo: "thinking", ferramenta: null, detalhe: null } }
    : sinal === "fim_bloco" ? { compondo: false }
    : { compondo: true };
  return ligar(p, ref, agora, extra) ? [ref.agenteId] : [];
}

function recomputarEspera(p: ProjecaoEstadoVivo, agenteId: string, agora: number): boolean {
  let maisAntiga: Decisao | null = null;
  for (const d of p.decisoes.values()) if (d.agenteId === agenteId && (!maisAntiga || d.desde < maisAntiga.desde)) maisAntiga = d;
  return mudar(bot(p, agenteId, agora), { aguardando: maisAntiga ? { motivo: maisAntiga.motivo, desde: maisAntiga.desde } : null, vence_em: maisAntiga?.venceEm ?? null }, agora);
}

export function motivoDaDecisao(tipo: unknown): MotivoAguardando {
  if (tipo === "pergunta" || tipo === "pedido_a_pessoa") return "pergunta";
  if (tipo === "credencial") return "segredo";
  return "aprovacao";
}

/**
 * O desfecho do fim do turno a partir dos dados do evento (estado/motivo/motivo_falha, já em código). null = o turno não
 * rodou (absorvido, cancelado ainda na fila): não há desfecho a mostrar.
 */
export function fimDoTurno(tipo: "turno.encerrado" | "turno.interrompido", dados: Record<string, unknown>): { resultado: ResultadoTurno; falha?: FalhaDoTurno } | null {
  if (tipo === "turno.encerrado" && (dados.estado === undefined || dados.estado === "concluido")) return { resultado: "success" };
  const motivo = str(dados.motivo);
  if (motivo === "absorvido" || dados.estava === "pendente" || dados.substituido_por_escolha === true) return null;
  if (motivo === "parado_pela_pessoa") return { resultado: "cancelled" };
  return { resultado: "error", falha: classificarFalha(dados) };
}

export function classificarFalha(dados: Record<string, unknown>): FalhaDoTurno {
  const falha = str(dados.motivo_falha), motivo = str(dados.motivo);
  if (falha === "limite_do_plano" || falha === "sem_conta" || dados.ia_no_limite != null || dados.conta_no_limite != null) return "limite_uso";
  if (dados.espera_no_fundo === "erro_transitorio") return "taxa";
  if (motivo === "reinicio_do_motor" || motivo === "maquina_sem_contato" || motivo === "maquina_removida" || motivo === "reinicio_servidor" || falha === "motor_ausente") return "computador_atualizando";
  if (motivo === "sem_progresso" || motivo === "turno_travado" || motivo === "vencido" || falha === "erro_max_turns") return "timeout";
  if (motivo === "executor_indisponivel" || motivo === "sessao_rejeitada" || motivo === "lancamento_falhou" || falha === "nao_autenticado") return "bloqueio";
  return "outra";
}

/** Os campos aditivos do fim do turno no frame (FimDoTurnoNoFrame); null = o turno não rodou. */
export function fimNoFrame(tipo: "turno.encerrado" | "turno.interrompido", dados: Record<string, unknown>, settledAt: number, idEnvio: string | null): FimDoTurnoNoFrame | null {
  const f = fimDoTurno(tipo, dados);
  return f ? { desfecho: f.resultado, settled_at: settledAt, id_envio: idEnvio, ...(f.falha ? { falha: f.falha } : {}) } : null;
}

/** Aplica um frame publicado. Devolve os ids dos bots cujo estado mudou. */
export function aplicarFrame(p: ProjecaoEstadoVivo, tipo: string, dados: Record<string, unknown>, agora: number): string[] {
  switch (tipo) {
    case "turno.iniciado": {
      const turnoId = str(dados.turnoId), agenteId = str(dados.agente_id) ?? str(dados.agenteId);
      if (!turnoId || !agenteId) return [];
      const conversaId = str(dados.conversaId);
      if (dados.kind !== "turno_despachado") { indexar(p, turnoId, agenteId, conversaId); return []; }
      p.fechados.delete(turnoId);
      return ligar(p, { agenteId, turnoId, conversaId }, agora) ? [agenteId] : [];
    }
    case "turno.atividade": {
      const ref = refDoPlano(p, dados);
      if (!ref) return [];
      const ferramenta = str(dados.nome);
      const detalhe = str(dados.rotulo);
      return ligar(p, ref, agora, { compondo: false, atividade: { tipo: "ferramenta", ferramenta, detalhe } }) ? [ref.agenteId] : [];
    }
    case "turno.subagentes": {
      const ref = refDoPlano(p, dados);
      if (!ref) return [];
      const lista = Array.isArray(dados.subagentes) ? dados.subagentes : [];
      const n = lista.filter((s) => typeof s === "object" && s !== null && (s as { estado?: unknown }).estado === "trabalhando").length;
      return ligar(p, ref, agora, { subagentes_rodando: n }) ? [ref.agenteId] : [];
    }
    case "turno.fala": {
      const ref = refDoPlano(p, dados);
      if (!ref) return [];
      return ligar(p, ref, agora, { compondo: false }) ? [ref.agenteId] : [];
    }
    case "turno.acao_fim":
    case "turno.tarefas":
    case "turno.vigia": {
      const ref = refDoPlano(p, dados);
      if (!ref) return [];
      return ligar(p, ref, agora) ? [ref.agenteId] : [];
    }
    case "turno.encerrado":
    case "turno.interrompido": {
      const turnoId = str(dados.turnoId);
      if (!turnoId) return [];
      const agenteId = p.turnos.get(turnoId)?.agenteId ?? str(dados.agente_id) ?? str(dados.agenteId);
      p.fechados.add(turnoId);
      while (p.fechados.size > FECHADOS_GUARDADOS) p.fechados.delete(p.fechados.values().next().value as string);
      p.turnos.delete(turnoId);
      if (!agenteId) return [];
      const b = bot(p, agenteId, agora);
      const estavaVivo = b.vivos.delete(turnoId);
      const fim = fimDoTurno(tipo, dados);
      const novo: Partial<EstadoVivoBot> = {};
      if (fim) novo.ultimo_desfecho = { resultado: fim.resultado, em: agora, ...(fim.falha ? { falha: fim.falha } : {}) };
      if (estavaVivo && b.vivos.size === 0) Object.assign(novo, { rodando: false, compondo: false, atividade: null, subagentes_rodando: 0 });
      if (fim || estavaVivo) Object.assign(novo, { turnoId });
      return mudar(b, novo, agora) ? [agenteId] : [];
    }
    case "decisao.nova": {
      const decisaoId = str(dados.decisao_id) ?? str(dados.decisaoId);
      if (!decisaoId) return [];
      const turnoId = str(dados.turnoId), conversaId = str(dados.conversaId);
      const agenteId = str(dados.agente_id) ?? (turnoId ? p.turnos.get(turnoId)?.agenteId : undefined) ?? (conversaId ? p.conversas.get(conversaId) : undefined) ?? null;
      if (!agenteId) return [];
      const prazo = typeof dados.prazo_decisao_em === "number" ? dados.prazo_decisao_em : null;
      p.decisoes.set(decisaoId, { agenteId, motivo: motivoDaDecisao(dados.tipo), desde: agora, venceEm: prazo });
      limitar(p.decisoes);
      return recomputarEspera(p, agenteId, agora) ? [agenteId] : [];
    }
    case "decisao.decidida":
    case "decisao.vencida": {
      const decisaoId = str(dados.decisao_id) ?? str(dados.decisaoId);
      const d = decisaoId ? p.decisoes.get(decisaoId) : undefined;
      if (!d || !decisaoId) return [];
      p.decisoes.delete(decisaoId);
      return recomputarEspera(p, d.agenteId, agora) ? [d.agenteId] : [];
    }
    default:
      return [];
  }
}

/**
 * Estado vivo durável (definido em 2026-11-12, item 5): o que o banco sabe e a memória perde num reinício — os turnos
 * `despachando` da pessoa e as decisões abertas em que ela decide. O serviço semeia a projeção com isso na primeira
 * conexão da pessoa depois do processo subir; o resto (atividade, compondo, subagentes) volta no próximo frame do turno.
 */
export type SementeEstadoVivo = {
  vivos: RefDoTurno[];
  decisoes: { decisaoId: string; agenteId: string; tipo: unknown; desde: number; venceEm: number | null }[];
};

/** Semeia sem pisar no que a projeção já viu (turno fechado não religa; decisão já conhecida fica). Devolve os bots que mudaram. */
export function semearProjecao(p: ProjecaoEstadoVivo, s: SementeEstadoVivo, agora: number): string[] {
  const mudaram = new Set<string>();
  for (const ref of s.vivos) {
    if (p.fechados.has(ref.turnoId) || p.bots.get(ref.agenteId)?.vivos.has(ref.turnoId)) continue;
    if (ligar(p, ref, agora)) mudaram.add(ref.agenteId);
  }
  for (const d of s.decisoes) {
    if (p.decisoes.has(d.decisaoId)) continue;
    p.decisoes.set(d.decisaoId, { agenteId: d.agenteId, motivo: motivoDaDecisao(d.tipo), desde: d.desde, venceEm: d.venceEm });
    limitar(p.decisoes);
    if (recomputarEspera(p, d.agenteId, agora)) mudaram.add(d.agenteId);
  }
  return [...mudaram];
}
