import type { RuntimeEvent } from "../contracts/evento.ts";
import type { EstadoTarefa, EventoTarefa, TarefaDto, TarefaObjetivo, Thread } from "../contracts/tarefa.ts";
import { ESTADOS_TAREFA } from "../contracts/tarefa.ts";
import type { TrabalhoDetalheDto } from "../contracts/trabalho.ts";
import { atividadeDaTarefa, atividadeNoObjetivo } from "../domain/atividade-da-tarefa.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import type { ComandoTarefa } from "../domain/tarefa.ts";
import { tituloOuNada } from "../domain/trabalho.ts";
import { ehUuid } from "./apoio-l7.ts";
import { abrirTarefaDaPessoa, mensagemParaTrabalho } from "./coordenar-trabalhos.ts";
import { eventoTarefaMudou, pessoaDoEscopo, transicionarTarefa } from "./tarefas.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import { detalharTrabalho, eventoTrabalhoMudou, fecharDecisoesDoTrabalho, pararTrabalho, REGRA_TAREFA_ARQUIVADA, REGRA_TAREFA_RESOLVIDA, sincronizarTrabalho } from "./trabalhos.ts";

/**
 * ADR-192 (definido em 2026-11-22, etapa 3): as rotas de produto da Tarefa. A Tarefa é o objetivo; o trabalho ligado é o
 * runtime (sessão, pasta, máquina, custo) e, no MVP, a Thread primária é o conjunto dos turnos dele (ADR-192, emenda 1):
 * o detalhe da Tarefa reaproveita as mensagens, passos e decisões que o detalhe do trabalho já monta pelos turnos.
 *
 * Ações da pessoa: Continuar (mensagem), Marcar como resolvida, Reabrir, Arquivar/Desarquivar e Renomear. Resolver e
 * Arquivar com um turno vivo exigem a escolha explícita (`turnoVivo: "parar" | "manter"`): o servidor nunca mata uma
 * execução em silêncio nem a deixa rodando sem a pessoa ter dito.
 */

export type EscolhaTurnoVivo = "parar" | "manter";

/** As Tarefas como a lista e o card as mostram: estado do objetivo e, à parte, a atividade projetada dos fatos. */
export async function tarefasParaDto(deps: Pick<Deps, "repos">, tarefas: readonly TarefaObjetivo[]): Promise<TarefaDto[]> {
  const ids = tarefas.map((t) => t.id);
  const [primarias, vinculos] = await Promise.all([deps.repos.tarefas.primariasDe(ids), deps.repos.tarefas.vinculosDe(ids)]);
  const trabalhoIds = [...vinculos.values()].map((v) => v.trabalhoId).filter((x): x is string => x !== null);
  const fatos = await deps.repos.trabalhos.fatosDeVarios(trabalhoIds);
  return tarefas.map((t): TarefaDto => {
    const v = vinculos.get(t.id) ?? { trabalhoId: null, cardId: null };
    const f = v.trabalhoId ? fatos.get(v.trabalhoId) : undefined;
    return {
      id: t.id,
      agenteId: t.agenteId,
      titulo: t.titulo,
      estado: t.estado,
      atividade: atividadeNoObjetivo(t.estado, f ? atividadeDaTarefa(f) : null),
      versao: t.versao,
      entregueEm: t.entregueEm,
      resolvidaEm: t.resolvidaEm,
      arquivadaEm: t.arquivadaEm,
      criadoEm: t.criadoEm,
      atualizadoEm: t.atualizadoEm,
      threadId: primarias.get(t.id)?.id ?? null,
      trabalhoId: v.trabalhoId,
      cardId: v.cardId,
    };
  });
}

async function umaDto(deps: Pick<Deps, "repos">, t: TarefaObjetivo): Promise<TarefaDto> {
  const [dto] = await tarefasParaDto(deps, [t]);
  return dto!;
}

async function tarefaDaPessoa(deps: Pick<Deps, "repos">, tarefaId: string): Promise<TarefaObjetivo> {
  if (!ehUuid(tarefaId)) throw new ErroDeDominio("nao_encontrado");
  const t = await deps.repos.tarefas.buscar(tarefaId);
  if (!t) throw new ErroDeDominio("nao_encontrado");
  return t;
}

/** GET tarefas?agenteId=&estado=&arquivadas= */
export const listarTarefas: CasoDeUso<{ agenteId?: string; estado?: string; arquivadas?: boolean }, { tarefas: TarefaDto[] }> = async (deps, input) => {
  if (input.agenteId !== undefined && !ehUuid(input.agenteId)) throw new ErroDeDominio("nao_encontrado");
  const estado = input.estado === undefined ? undefined : (ESTADOS_TAREFA as readonly string[]).includes(input.estado) ? (input.estado as EstadoTarefa) : null;
  if (estado === null) throw new ErroDeDominio("entrada_invalida", { cause: "estado" });
  const tarefas = await deps.repos.tarefas.listar({ ...(input.agenteId ? { agenteId: input.agenteId } : {}), ...(estado ? { estado } : {}), comArquivadas: input.arquivadas === true });
  return { data: { tarefas: await tarefasParaDto(deps, tarefas) }, events: [] };
};

export type TarefaDetalheDto = { tarefa: TarefaDto; thread: Thread | null; eventos: EventoTarefa[]; detalhe: TrabalhoDetalheDto | null };

/** GET tarefas/:id — a Tarefa, a Thread primária, a trilha e a conversa dela (mensagens, passos, decisões). */
export const detalharTarefa: CasoDeUso<{ tarefaId: string }, TarefaDetalheDto> = async (deps, input) => {
  const t = await tarefaDaPessoa(deps, input.tarefaId);
  const [dto, thread, eventos] = [await umaDto(deps, t), await deps.repos.tarefas.threadPrimaria(t.id), await deps.repos.tarefas.eventos(t.id)];
  const detalhe = dto.trabalhoId ? (await detalharTrabalho(deps, { trabalhoId: dto.trabalhoId })).data : null;
  return { data: { tarefa: dto, thread, eventos, detalhe }, events: [] };
};

/** POST agentes/:id/tarefas — "+ Nova tarefa": Tarefa + Thread + trabalho + primeiro turno, numa transação. */
export const criarTarefa: CasoDeUso<{ agenteId: string; texto: string; levarConversa?: boolean; anexos?: readonly string[]; chaveIdempotencia?: string | null }, { tarefa: TarefaDto; thread: Thread | null; turnoId: string; trabalhoId: string }> = async (deps, input) => {
  // A rota nova é da Tarefa: com a escrita desligada (NOD_TAREFA_OBJETIVO=0) ela não existe — o "+ Nova tarefa" antigo segue.
  if (deps.tarefaObjetivo === false) throw new ErroDeDominio("nao_encontrado", { cause: "NOD_TAREFA_OBJETIVO=0" });
  const r = await abrirTarefaDaPessoa(deps, input);
  if (!r.data.tarefaId) throw new ErroDeDominio("estado_invalido", { cause: "tarefa não criada" });
  const t = await tarefaDaPessoa(deps, r.data.tarefaId);
  return { data: { tarefa: await umaDto(deps, t), thread: await deps.repos.tarefas.threadPrimaria(t.id), turnoId: r.data.turnoId, trabalhoId: r.data.trabalho.id }, events: r.events ?? [] };
};

/** POST tarefas/:id/mensagens — Continuar: a fala vai à Thread (ao trabalho ligado) e vira o próximo turno, ou entra no vivo. */
export const continuarTarefa: CasoDeUso<{ tarefaId: string; texto: string; anexos?: readonly string[] }, { tarefa: TarefaDto; turnoId: string }> = async (deps, input) => {
  const t = await tarefaDaPessoa(deps, input.tarefaId);
  if (t.estado === "arquivada") throw new ErroDeDominio("estado_invalido", { cause: "tarefa arquivada: desarquive antes" });
  const [trabalhoId] = await deps.repos.tarefas.trabalhosDa(t.id);
  if (!trabalhoId) throw new ErroDeDominio("estado_invalido", { cause: "tarefa sem trabalho" });
  // mensagemParaTrabalho → enfileirarNoTrabalho já aplica o Continuar na Tarefa ligada (etapa 2).
  const r = await mensagemParaTrabalho(deps, { trabalhoId, texto: input.texto, ...(input.anexos ? { anexos: input.anexos } : {}) });
  const atual = (await deps.repos.tarefas.buscar(t.id)) ?? t;
  return { data: { tarefa: await umaDto(deps, atual), turnoId: r.data.mensagemTurnoId }, events: r.events ?? [] };
};

/**
 * O turno vivo da Tarefa (despachando, na fila ou a espera dela: volta marcada, comando, colega) e a escolha da pessoa. Sem turno vivo, nada a escolher. Com turno vivo e
 * sem escolha, recusa (`entrada_invalida`, causa `turno_vivo`): a tela pergunta antes. "parar" para o trabalho como o
 * Parar da tarefa; "manter" deixa rodar.
 */
async function aplicarEscolha(deps: Deps, trabalhoId: string | null, escolha: EscolhaTurnoVivo | undefined): Promise<RuntimeEvent[]> {
  if (!trabalhoId) return [];
  if (!(await temTurnoVivo(deps, trabalhoId))) return [];
  if (escolha === undefined) throw new ErroDeDominio("entrada_invalida", { cause: "turno_vivo" });
  if (escolha === "manter") return [];
  return (await pararTrabalho(deps, { trabalhoId })).events ?? [];
}

async function temTurnoVivo(deps: Deps, trabalhoId: string): Promise<boolean> {
  const f = (await deps.repos.trabalhos.fatosDeVarios([trabalhoId])).get(trabalhoId);
  // QA-192 (2026-11-23): a frente que só espera — a volta marcada (me_chame_as), um comando (esperar_comando), um colega
  // ou outra frente (depois_de) — também está viva: a tela já mostra "Resolver e parar" (tarefaComExecucaoViva, estado
  // `rodando`/`na_fila`), e sem isto o "parar" não parava nada e a volta acordava o bot na Tarefa já resolvida.
  return f ? f.despachando + f.pendentes + (f.parando ?? 0) > 0 || f.aguardandoDespertar === true || f.aguardandoComando === true || f.aguardandoColega === true || f.esperandoOutro === true : false;
}

async function comandoDaPessoa(deps: Deps, input: { tarefaId: string; versao?: number; turnoVivo?: EscolhaTurnoVivo }, comando: ComandoTarefa, comEscolha: boolean): Promise<{ data: { tarefa: TarefaDto; mudou: boolean }; events: RuntimeEvent[] }> {
  const t = await tarefaDaPessoa(deps, input.tarefaId);
  const [trabalhoId] = await deps.repos.tarefas.trabalhosDa(t.id);
  const antes = comEscolha ? await aplicarEscolha(deps, trabalhoId ?? null, input.turnoVivo) : [];
  const r = await transicionarTarefa(deps, t.id, comando, pessoaDoEscopo(deps), { ...(input.versao !== undefined ? { versaoEsperada: input.versao } : {}), trabalhoId: trabalhoId ?? null });
  // QA-194: a escolha foi lida sem trava. Uma fala da pessoa que ainda não tinha commitado (ela trava a Tarefa no
  // Continuar) cria um turno que a leitura não viu; com a Tarefa travada aqui, a fala já commitou: relê e decide de novo,
  // para nunca resolver ou arquivar com uma execução viva que a pessoa não escolheu manter nem parar.
  const depois = comEscolha && trabalhoId && r.mudou && input.turnoVivo !== "manter" && (await temTurnoVivo(deps, trabalhoId)) ? await aplicarEscolha(deps, trabalhoId, input.turnoVivo) : [];
  const fechadas = trabalhoId && r.mudou ? await fecharPerguntasQueSobraram(deps, trabalhoId, comando, input.turnoVivo) : [];
  // O frame legado também sai: a tela de antes relê a lista de trabalhos (o `tarefa` do DTO mudou).
  const trabalho = trabalhoId && r.mudou ? await deps.repos.trabalhos.buscar(trabalhoId) : null;
  return { data: { tarefa: await umaDto(deps, (await deps.repos.tarefas.buscar(t.id)) ?? r.tarefa), mudou: r.mudou }, events: [...antes, ...depois, ...r.events, ...fechadas, ...(trabalho ? [eventoTrabalhoMudou(deps, trabalho)] : [])] };
}

/**
 * ADR-192 (emenda 5, achado das jornadas de QA): resolver ou arquivar com uma pergunta do bot ainda aberta deixava o
 * cartão na tela e "1 aguardando" na barra para uma tarefa já decidida. A pergunta fecha por regra, como no Parar
 * (fecharDecisoesDoTrabalho), e o trabalho se ressincroniza. Com "deixar terminar" (`manter`) o bot segue vivo e pode
 * precisar da resposta: nada fecha. Com "parar", o Parar já fechou.
 */
async function fecharPerguntasQueSobraram(deps: Deps, trabalhoId: string, comando: ComandoTarefa, escolha: EscolhaTurnoVivo | undefined): Promise<RuntimeEvent[]> {
  if ((comando !== "resolver" && comando !== "arquivar") || escolha === "manter") return [];
  const fechadas = await fecharDecisoesDoTrabalho(deps, trabalhoId, comando === "resolver" ? REGRA_TAREFA_RESOLVIDA : REGRA_TAREFA_ARQUIVADA);
  return fechadas.length ? [...fechadas, ...(await sincronizarTrabalho(deps, trabalhoId))] : [];
}

/** POST tarefas/:id/resolver {versao?, turnoVivo?} — só a pessoa; idempotente; com a versão, a corrida perde com 409. */
export const resolverTarefa: CasoDeUso<{ tarefaId: string; versao?: number; turnoVivo?: EscolhaTurnoVivo }, { tarefa: TarefaDto; mudou: boolean }> = (deps, input) => comandoDaPessoa(deps, input, "resolver", true);

/** POST tarefas/:id/reabrir — preserva a resolução na trilha e volta a em andamento, na mesma Thread. */
export const reabrirTarefa: CasoDeUso<{ tarefaId: string; versao?: number }, { tarefa: TarefaDto; mudou: boolean }> = (deps, input) => comandoDaPessoa(deps, input, "reabrir", false);

/** POST tarefas/:id/arquivar {turnoVivo?} — esconde da lista padrão sem apagar nada. */
export const arquivarTarefa: CasoDeUso<{ tarefaId: string; versao?: number; turnoVivo?: EscolhaTurnoVivo }, { tarefa: TarefaDto; mudou: boolean }> = (deps, input) => comandoDaPessoa(deps, input, "arquivar", true);

/** POST tarefas/:id/desarquivar — volta ao estado de antes de arquivar. */
export const desarquivarTarefa: CasoDeUso<{ tarefaId: string; versao?: number }, { tarefa: TarefaDto; mudou: boolean }> = (deps, input) => comandoDaPessoa(deps, input, "desarquivar", false);

/** POST tarefas/:id/titulo — renomeia o objetivo (e o trabalho runtime, que a tela de antes mostra); o Card, não. */
export const renomearTarefa: CasoDeUso<{ tarefaId: string; titulo: string }, { tarefa: TarefaDto }> = async (deps, input) => {
  const titulo = tituloOuNada(input.titulo);
  if (!titulo) throw new ErroDeDominio("entrada_invalida", { cause: "titulo" });
  const t = await tarefaDaPessoa(deps, input.tarefaId);
  const renomeada = await deps.repos.tarefas.renomear(t.id, titulo, deps.agora());
  if (!renomeada) throw new ErroDeDominio("nao_encontrado");
  const events: RuntimeEvent[] = [];
  for (const trabalhoId of await deps.repos.tarefas.trabalhosDa(t.id)) {
    const w = await deps.repos.trabalhos.renomear(trabalhoId, titulo);
    if (w) events.push(eventoTrabalhoMudou(deps, w));
  }
  const [trabalhoId] = await deps.repos.tarefas.trabalhosDa(t.id);
  events.push(eventoTarefaMudou(deps, renomeada, "renomeada", { trabalhoId: trabalhoId ?? null }));
  return { data: { tarefa: await umaDto(deps, renomeada) }, events };
};
