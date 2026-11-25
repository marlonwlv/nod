import type { DefinicaoAcao } from "../../contracts/acoes.ts";

/** As contas de IA da pessoa: a fila, o modo e o login nas máquinas (NOD-391, ADR-135; tudo da Onda 4b, NOD-400). */

const falta = { estado: "falta", onda: "NOD-400" } as const;

export const ACOES_CONTAS_IA = [
  { id: "contas_ia.ordenar", titulo: "Ordenar a fila das contas de IA", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "contas_ia.mudar_modo", titulo: "Mudar o modo das contas de IA", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "contas_ia.editar", titulo: "Editar uma conta de IA", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "contas_ia.sair", titulo: "Sair de uma conta de IA", risco: "arriscada", cartaoNoChat: false, chat: falta },
  { id: "contas_ia.remover", titulo: "Remover uma conta de IA", risco: "arriscada", cartaoNoChat: false, chat: falta },
  { id: "contas_ia.seguir", titulo: "Seguir com a próxima conta de IA", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "contas_ia.tentar_de_novo", titulo: "Tentar a conta de IA de novo", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "contas_ia.entrar", titulo: "Entrar numa IA numa máquina", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "contas_ia.codigo_do_login", titulo: "Mandar o código do login da IA", risco: "pessoa_confirma", cartaoNoChat: false, chat: falta },
  { id: "contas_ia.cancelar_login", titulo: "Cancelar o login da IA", risco: "muda", cartaoNoChat: false, chat: falta },
  // Lote B das Jornadas da IA (2026-11-22): o botão do cartão de desvio. Pelo chat não: quem parou foi a IA da conversa —
  // a pessoa escolhe a IA no seletor do campo e manda de novo.
  { id: "contas_ia.responder_com_outra_ia", titulo: "Responder com a outra IA desta vez", risco: "muda", cartaoNoChat: false, chat: { estado: "nunca", motivo: "a IA da conversa parou: o caminho é o botão do cartão ou o seletor de IA do campo" } },
  { id: "contas_ia.reinstalar_e_tentar", titulo: "Reinstalar a IA e tentar de novo", risco: "muda", cartaoNoChat: false, chat: { estado: "nunca", motivo: "a IA não abriu na máquina: o caminho é o botão do cartão, ou Provedores de IA › Atualizar" } },
  { id: "contas_ia.trocar_executor", titulo: "Trocar a IA deste Mac (modo local)", risco: "muda", cartaoNoChat: false, chat: falta },
] as const satisfies readonly DefinicaoAcao[];
