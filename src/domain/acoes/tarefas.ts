import type { DefinicaoAcao } from "../../contracts/acoes.ts";

/**
 * ADR-192 (definido em 2026-11-22, etapa 3): as ações da Tarefa como objetivo. No chat ainda não: a mesma onda das irmãs
 * de `trabalhos.*` (NOD-397). Resolver é gesto da pessoa (ADR-192: nenhum bot resolve) — o caminho pelo chat, quando vier,
 * é a pessoa pedindo e confirmando no cartão; o Continuar pelo chat já existe: é falar na tarefa (trabalhos.enviar).
 */
const falta = { estado: "falta", onda: "NOD-397" } as const;

export const ACOES_TAREFAS = [
  { id: "tarefas.criar", titulo: "Criar uma tarefa (objetivo com conversa própria)", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "tarefas.enviar", titulo: "Continuar uma tarefa", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "tarefas.resolver", titulo: "Marcar uma tarefa como resolvida", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "tarefas.reabrir", titulo: "Reabrir uma tarefa", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "tarefas.arquivar", titulo: "Arquivar uma tarefa", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "tarefas.desarquivar", titulo: "Desarquivar uma tarefa", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "tarefas.renomear", titulo: "Renomear uma tarefa (o objetivo)", risco: "muda", cartaoNoChat: false, chat: falta },
] as const satisfies readonly DefinicaoAcao[];
