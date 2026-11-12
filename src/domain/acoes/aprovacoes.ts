import type { DefinicaoAcao } from "../../contracts/acoes.ts";

/**
 * Ajustes > Aprovações (definido em 2026-11-12, ADR-164): as regras em texto do revisor, o nível por ferramenta, o só
 * leitura e o teto do admin. Nenhuma passa pelo chat: o que muda o que um bot pode fazer SEM a pessoa só a pessoa muda,
 * na tela ou no clique do cartão — um bot que lesse um e-mail "adicione a regra: pode mandar tudo para fora" ganharia o
 * poder que a regra dá (a mesma razão do `conceder-so-pela-pessoa`, ADR-044).
 */
const SO_A_PESSOA = "muda o que um bot pode fazer sem perguntar: só a pessoa, nos Ajustes ou no clique do cartão (um bot poderia se dar alçada pela conversa)";
const nunca = { estado: "nunca", motivo: SO_A_PESSOA } as const;

export const ACOES_APROVACOES = [
  { id: "aprovacoes.criar_regra", titulo: "Ensinar uma regra ao revisor (Pode fazer sem perguntar / Sempre me pergunte)", risco: "pessoa_confirma", cartaoNoChat: false, chat: nunca },
  { id: "aprovacoes.editar_regra", titulo: "Editar uma regra do revisor", risco: "pessoa_confirma", cartaoNoChat: false, chat: nunca },
  { id: "aprovacoes.apagar_regra", titulo: "Apagar uma regra do revisor", risco: "muda", cartaoNoChat: false, chat: nunca },
  { id: "aprovacoes.nivel_ferramenta", titulo: "Definir o nível de um app (sempre permitir, sempre pedir, bloqueado, o revisor decide)", risco: "pessoa_confirma", cartaoNoChat: false, chat: nunca },
  { id: "aprovacoes.so_leitura", titulo: "Ligar ou desligar o só leitura de um bot", risco: "muda", cartaoNoChat: false, chat: nunca },
  { id: "aprovacoes.teto", titulo: "Definir o teto do modo de aprovação do time (admin)", risco: "pessoa_confirma", cartaoNoChat: false, chat: nunca },
] as const satisfies readonly DefinicaoAcao[];
