import type { CodigoErro } from "./motivos.ts";
import type { JsonSchema } from "./json-schema.ts";

/**
 * Desfazer a pausa em lote (2026-11-19, migração 0178): as duas ferramentas da pausa em lote. Moram fora de
 * ferramentas-rotina.ts porque aquele arquivo bateu no gatilho de revisão de 200 linhas (EMENDA 26); a lista continua
 * FECHADA e única — estas entradas são espalhadas em FERRAMENTAS_NOD, ao lado das de rotina.
 */
export const FERRAMENTAS_ROTINA_LOTE = {
  // O mesmo executor do "Pausar todas as rotinas" do ⌘K e do Desfazer/"Reativar as N" de Ajustes › Rotinas
  // (src/use-cases/pausa-em-lote.ts).
  pausar_todas_rotinas: {
    type: "object",
    description: "Pausa de uma vez TODAS as rotinas ativas da pessoa, de todos os bots dela, só quando ela pedir isso com todas as letras (\"pausa tudo\", \"para todas as rotinas\"). Ficam marcadas como uma pausa só: reativar_lote_rotinas desfaz exatamente esta pausa, sem religar as que ela já tinha pausado antes. Para uma rotina, use pausar_rotina.",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  reativar_lote_rotinas: {
    type: "object",
    description: "Desfaz uma pausa em lote (\"reativa as rotinas que eu pausei sem querer\", \"volta as rotinas de hoje cedo\"): reativa só as rotinas que foram pausadas juntas pelo \"Pausar todas as rotinas\"; as que a pessoa pausou uma a uma ficam como estão. Sem lote_id, desfaz a pausa em lote mais recente. O próximo horário de cada uma conta a partir de agora; o que caiu durante a pausa não é refeito.",
    properties: {
      lote_id: { type: "string", description: "Opcional: o lote_id devolvido por pausar_todas_rotinas. Omitido = a pausa em lote mais recente da pessoa.", minLength: 1 },
    },
    required: [],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

/** Pausa em lote (0178): sem argumentos — vale para todas as rotinas ativas da pessoa. */
export type ArgsPausarTodasRotinas = object;
/** `pausadas` = quantas este pedido pausou; `lote_id` null quando não havia nenhuma ativa. */
export type ResultadoPausarTodasRotinas = { lote_id: string | null; pausadas: number; pausado_em: number | null } | { erro: CodigoErro };
/** Omitido o lote_id, a pausa em lote mais recente da pessoa. */
export type ArgsReativarLoteRotinas = { lote_id?: string };
/** `reativadas` = quantas voltaram agora; `pausado_em` = quando a pausa em lote aconteceu (null: não havia lote). */
export type ResultadoReativarLoteRotinas = { lote_id: string | null; pausado_em: number | null; reativadas: number } | { erro: CodigoErro };
