import type { RuntimeEvent } from "../contracts/evento.ts";
import type { TarefaObjetivo, Thread } from "../contracts/tarefa.ts";
import type { EstadoTrabalho, Trabalho } from "../contracts/trabalho.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { estadoInicialDaTarefa, transicaoDaTarefa, type AutorDaTransicao, type ComandoTarefa } from "../domain/tarefa.ts";
import { tituloDoTrabalho } from "../domain/trabalho.ts";
import { log } from "../obs/log.ts";
import { autoriaAgente, evento } from "./autoria-evento.ts";
import type { Deps } from "./tipos.ts";

/**
 * ADR-192 (definido em 2026-11-22, etapa 2): o núcleo da Tarefa como objetivo. Três peças, todas dentro da transação de
 * quem chama:
 *
 * - `criarTarefaComThread`: a Tarefa e a Thread primária juntas (o trigger adiado da 0180 recusa o COMMIT sem a Thread);
 * - `transicionarTarefa`: um comando do domínio (src/domain/tarefa.ts) aplicado com a versão lida, mais a trilha e o frame;
 * - `sincronizarTarefaDoTrabalho`: o adaptador do runtime — o trabalho começou → `iniciar`; terminou → `entregar`.
 *   Interrompido, parado ou falho não mudam o objetivo (a atividade é que muda). Nunca resolve.
 */

type DepsTarefa = Pick<Deps, "repos" | "escopo" | "agora">;

/** O frame `tarefa.mudou` sai pelo outbox: só ids, estado e o motivo (KindEvento `tarefa_mudou`). */
export function eventoTarefaMudou(deps: DepsTarefa, t: Pick<TarefaObjetivo, "id" | "agenteId" | "estado">, motivo: string, extra: { trabalhoId?: string | null; conversaId?: string | null } = {}): RuntimeEvent {
  return evento(deps.escopo, {
    kind: "tarefa_mudou",
    autoria: autoriaAgente({ agenteId: t.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: "regra:tarefas" }),
    agora: deps.agora(),
    ...(extra.conversaId ? { conversaId: extra.conversaId } : {}),
    dados: { tarefaId: t.id, agenteId: t.agenteId, estado: t.estado, motivo, trabalhoId: extra.trabalhoId ?? null },
  });
}

export type NovaTarefaComThread = {
  agenteId: string;
  titulo: string;
  /** A conversa onde as mensagens da Thread moram (ver a emenda do ADR-192 sobre a conversa da Thread no MVP). */
  conversaId: string;
  /** O primeiro turno nasce junto: a Tarefa já começa `em_andamento`. */
  comPrimeiroTurno: boolean;
  chaveIdempotencia?: string | null;
  autor: AutorDaTransicao;
};

/**
 * Cria a Tarefa e a Thread primária. `existente` vem preenchido (e nada é escrito) quando a chave de idempotência já foi
 * usada por esta dona: o segundo pedido devolve o primeiro. O insert da Tarefa vai antes de tudo, então a corrida de dois
 * pedidos com a mesma chave espera no índice único e o perdedor vê a Tarefa do vencedor.
 */
export async function criarTarefaComThread(deps: DepsTarefa, n: NovaTarefaComThread): Promise<{ existente: TarefaObjetivo; tarefa?: undefined; thread?: undefined; events: RuntimeEvent[] } | { existente?: undefined; tarefa: TarefaObjetivo; thread: Thread; events: RuntimeEvent[] }> {
  const chave = n.chaveIdempotencia ?? null;
  if (chave) {
    const ja = await deps.repos.tarefas.buscarPorChave(chave);
    if (ja) return { existente: ja, events: [] };
  }
  const tarefa = await deps.repos.tarefas.criar({ agenteId: n.agenteId, titulo: tituloDoTrabalho(n.titulo), estado: estadoInicialDaTarefa(n.comPrimeiroTurno), chaveIdempotencia: chave });
  if (!tarefa) {
    const vencedora = chave ? await deps.repos.tarefas.buscarPorChave(chave) : null;
    if (vencedora) return { existente: vencedora, events: [] };
    throw new ErroDeDominio("estado_invalido", { cause: "tarefa não criada" });
  }
  const thread = await deps.repos.tarefas.criarThread({ tarefaId: tarefa.id, conversaId: n.conversaId, tipo: "primaria" });
  if (!thread) throw new ErroDeDominio("estado_invalido", { cause: "thread primária não criada" });
  await deps.repos.tarefas.registrarEvento({ tarefaId: tarefa.id, tipo: "criada", autorTipo: n.autor.tipo, autorId: n.autor.id, dados: { estado: tarefa.estado } });
  await deps.repos.tarefas.registrarEvento({ tarefaId: tarefa.id, tipo: "thread_criada", autorTipo: "sistema", autorId: deps.escopo.pessoaId, dados: { thread_id: thread.id, tipo: thread.tipo } });
  return { tarefa, thread, events: [eventoTarefaMudou(deps, tarefa, "criada", { conversaId: n.conversaId })] };
}

export type ResultadoComando = { tarefa: TarefaObjetivo; mudou: boolean; events: RuntimeEvent[] };

/**
 * Aplica um comando à Tarefa: trava a linha, decide pelo domínio, grava com a versão lida e registra a trilha. Com
 * `versaoEsperada` (o ETag de Resolver), a Tarefa que mudou desde que a pessoa a viu é recusada com `estado_invalido` (causa `conflito_de_versao`, 409 "atualize a página")
 * — salvo quando o comando já não muda nada (o segundo clique em Resolver é idempotente, não erro).
 */
export async function transicionarTarefa(deps: DepsTarefa, tarefaId: string, comando: ComandoTarefa, autor: AutorDaTransicao, opcoes: { turnoId?: string | null; versaoEsperada?: number; trabalhoId?: string | null } = {}): Promise<ResultadoComando> {
  const atual = await deps.repos.tarefas.buscarTravado(tarefaId);
  if (!atual) throw new ErroDeDominio("nao_encontrado");
  const agora = deps.agora();
  const r = transicaoDaTarefa(atual, comando, autor, agora);
  if (!r.ok) throw new ErroDeDominio(r.erro === "autor_invalido" ? "nao_permitido" : "estado_invalido", { cause: `tarefa ${atual.estado} + ${comando}` });
  if (!r.mudou) return { tarefa: atual, mudou: false, events: [] };
  if (opcoes.versaoEsperada !== undefined && opcoes.versaoEsperada !== atual.versao) throw new ErroDeDominio("estado_invalido", { cause: "conflito_de_versao" });
  const gravada = await deps.repos.tarefas.aplicar(atual.id, r.linha, atual.versao, agora);
  // A linha está travada (FOR UPDATE): a versão não muda entre a leitura e a escrita; null aqui é erro de programação.
  if (!gravada) throw new ErroDeDominio("estado_invalido", { cause: "tarefa mudou sob a trava" });
  for (const e of r.eventos) {
    await deps.repos.tarefas.registrarEvento({ tarefaId: atual.id, tipo: e.tipo, autorTipo: autor.tipo, autorId: autor.id, turnoId: opcoes.turnoId ?? null, ...(e.dados ? { dados: e.dados } : {}) });
  }
  return { tarefa: gravada, mudou: true, events: [eventoTarefaMudou(deps, gravada, comando, { trabalhoId: opcoes.trabalhoId ?? null })] };
}

/** O comando que um estado novo do trabalho runtime implica na Tarefa ligada (ou nenhum). */
export function comandoDoTrabalho(estado: EstadoTrabalho): "iniciar" | "entregar" | null {
  if (estado === "rodando" || estado === "precisa_de_voce" || estado === "fechado_ocioso") return "iniciar";
  if (estado === "terminado") return "entregar";
  // na_fila, parado e falhou: o objetivo não muda (a atividade mostra a fila ou a interrupção).
  return null;
}

/**
 * O adaptador do runtime (dual-write): o trabalho mudou de estado; a Tarefa ligada a ele, se houver, recebe `iniciar` ou
 * `entregar`. Terminar é a entrega do bot — a Tarefa fica `entregue`, esperando a avaliação da pessoa, mesmo com `falta`
 * no resumo; nunca `resolvida`. Falhar aqui não derruba o trabalho: o estado legado é a fonte da tela até a etapa 5, e a
 * divergência fica no log.
 */
export async function sincronizarTarefaDoTrabalho(deps: DepsTarefa, t: Pick<Trabalho, "id" | "agenteId">, novo: EstadoTrabalho): Promise<RuntimeEvent[]> {
  const comando = comandoDoTrabalho(novo);
  if (!comando) return [];
  const tarefa = await deps.repos.tarefas.doTrabalho(t.id);
  if (!tarefa) return [];
  const turnoId = comando === "entregar" ? await ultimoTurnoConcluido(deps, t.id) : null;
  const autor: AutorDaTransicao = comando === "entregar" ? { tipo: "agente", id: t.agenteId } : { tipo: "sistema", id: deps.escopo.pessoaId };
  try {
    return (await transicionarTarefa(deps, tarefa.id, comando, autor, { turnoId, trabalhoId: t.id })).events;
  } catch (e) {
    if (!(e instanceof ErroDeDominio)) throw e;
    log("aviso", "tarefa_sincronizacao_recusada", { tarefa_id: tarefa.id, trabalho_id: t.id, comando, codigo: e.codigo });
    return [];
  }
}

async function ultimoTurnoConcluido(deps: DepsTarefa, trabalhoId: string): Promise<string | null> {
  const turnos = await deps.repos.turnos.doTrabalho(trabalhoId);
  return turnos.filter((x) => x.estado === "concluido").at(-1)?.id ?? null;
}

/**
 * A pessoa falou na Tarefa pelo caminho legado (a tela da task, `POST trabalhos/:id/mensagens`): é o Continuar. Entregue
 * ou resolvida voltam a `em_andamento` (resolvida reabre primeiro, com o evento). Arquivada não muda pelo caminho legado
 * (a tela antiga não conhece o arquivo); a rota nova recusa.
 */
export async function continuarPeloTrabalho(deps: DepsTarefa, t: Pick<Trabalho, "id">): Promise<RuntimeEvent[]> {
  const tarefa = await deps.repos.tarefas.doTrabalho(t.id);
  if (!tarefa || tarefa.estado === "arquivada") return [];
  return (await transicionarTarefa(deps, tarefa.id, "continuar", { tipo: "pessoa", id: deps.escopo.pessoaId }, { trabalhoId: t.id })).events;
}

/** "Encerrar a tarefa" (ADR-187 §6) é um gesto explícito da pessoa: na Tarefa ligada, é Resolver. */
export async function resolverPeloTrabalho(deps: DepsTarefa, t: Pick<Trabalho, "id">): Promise<RuntimeEvent[]> {
  const tarefa = await deps.repos.tarefas.doTrabalho(t.id);
  if (!tarefa || tarefa.estado === "arquivada") return [];
  return (await transicionarTarefa(deps, tarefa.id, "resolver", { tipo: "pessoa", id: deps.escopo.pessoaId }, { trabalhoId: t.id })).events;
}

/** O autor "pessoa" do escopo (as ações da tela). */
export function pessoaDoEscopo(deps: DepsTarefa): AutorDaTransicao {
  return { tipo: "pessoa", id: deps.escopo.pessoaId };
}
