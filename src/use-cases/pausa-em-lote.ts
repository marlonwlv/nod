import { randomUUID } from "node:crypto";
import type { Autoria, RuntimeEvent } from "../contracts/evento.ts";
import { assertUuid } from "./apoio-l7.ts";
import { pausarRotina } from "./pausar-rotina.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * Desfazer a pausa em lote (definido em 2026-11-19, migração 0178). Caso real: o "Pausar todas as rotinas" do ⌘K pausou
 * 38 rotinas num clique, sem volta pela interface; a pessoa já tinha 56 pausadas de propósito, e "reativar todas as
 * pausadas" religaria essas também. Por isso a pausa em lote ganha um id: o Desfazer do aviso, o "Reativar as N" de
 * Ajustes › Rotinas e a ferramenta reativar_lote_rotinas voltam SÓ as rotinas daquele lote.
 *
 * Executor único das ações rotinas.pausar_todas e rotinas.reativar_lote (ADR-135): a rota e a ferramenta chamam estas
 * funções. Cada rotina passa pelo `pausarRotina` de sempre — corte de fila, card de ritmo, a linha na conversa dela —,
 * na transação de quem chama; o lote é só a marca por cima.
 */

export type LoteDePausa = { id: string; em: number };

/** Pausa todas as rotinas ATIVAS da pessoa (só as dela, nunca as do time) e marca todas com o mesmo lote. */
export const pausarTodasAsRotinas: CasoDeUso<{ autoria?: Autoria }, { lote: LoteDePausa | null; rotinaIds: string[] }> = async (deps, input) => {
  const ativas = (await deps.repos.rotinas.listar()).filter((r) => r.ownerId === deps.escopo.pessoaId && r.estado === "ativa");
  if (ativas.length === 0) return { data: { lote: null, rotinaIds: [] } };
  const events: RuntimeEvent[] = [];
  const pausadas: string[] = [];
  for (const r of ativas) {
    // QA-115: trava a linha e relê. Dois "Pausar todas" ao mesmo tempo (Enter duplo no ⌘K, ⌘K + chat) liam as mesmas
    // ativas; o segundo esperava o primeiro, contava as três como suas e trocava o lote delas, e o Desfazer do primeiro
    // aviso não reativava nada. Agora o segundo espera, vê a rotina já pausada e a deixa no lote de quem a pausou.
    const travada = await deps.repos.rotinas.buscarParaAtualizar(r.id);
    if (!travada || travada.estado !== "ativa") continue;
    const x = await pausarRotina(deps, { rotinaId: r.id, estado: "pausada", ...(input.autoria ? { autoria: input.autoria } : {}) });
    events.push(...(x.events ?? []));
    if (x.data.rotina.estado === "pausada") pausadas.push(r.id);
  }
  // QA-115: nenhuma pausada aqui (outro pedido pausou antes) = sem lote, como quando não havia ativa; senão o aviso
  // ofereceria um Desfazer de um lote vazio.
  if (pausadas.length === 0) return { data: { lote: null, rotinaIds: [] }, events };
  const lote: LoteDePausa = { id: randomUUID(), em: deps.agora() };
  await deps.repos.rotinas.marcarLoteDePausa(pausadas, lote.id, lote.em);
  return { data: { lote, rotinaIds: pausadas }, events };
};

/**
 * Reativa as rotinas que seguem no lote. A que já voltou uma a uma perdeu a marca (trigger da 0178) e não conta. A que não
 * pode voltar (bot excluído ou de outra geração) fica pausada, sem a marca: o bloco "Pausadas juntas" some quando o lote
 * acaba, em vez de ficar oferecendo um "Reativar" que não reativa nada.
 */
export const reativarLoteDePausa: CasoDeUso<{ loteId: string; autoria?: Autoria }, { lote: LoteDePausa | null; reativadas: string[] }> = async (deps, input) => {
  assertUuid(input.loteId, "loteId");
  const doLote = await deps.repos.rotinas.listarDoLoteDePausa(input.loteId);
  const lote = doLote[0]?.pausaLote ?? null;
  const podemVoltar = new Set(await deps.repos.rotinas.podemVoltar(doLote.map((r) => r.id)));
  const events: RuntimeEvent[] = [];
  const reativadas: string[] = [];
  for (const r of doLote) {
    if (r.estado !== "pausada" || !podemVoltar.has(r.id)) continue;
    // QA-115: o mesmo para dois Desfazer ao mesmo tempo (o aviso e o chat): quem chega depois vê a rotina já ativa.
    const travada = await deps.repos.rotinas.buscarParaAtualizar(r.id);
    if (!travada || travada.estado !== "pausada" || travada.pausaLote?.id !== input.loteId) continue;
    const x = await pausarRotina(deps, { rotinaId: r.id, estado: "ativa", ...(input.autoria ? { autoria: input.autoria } : {}) });
    events.push(...(x.events ?? []));
    reativadas.push(r.id);
  }
  await deps.repos.rotinas.limparLoteDePausa(input.loteId);
  return { data: { lote, reativadas }, events };
};
