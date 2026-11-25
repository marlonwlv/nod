import type { JsonSchema } from "./json-schema.ts";

/**
 * ajustar_navegador (ADR-190, quadro N; NOD-391, ADR-135): a pessoa pede ao bot, na conversa, "pode continuar com o Mac
 * desligado", "só trabalha com o Mac ligado", "usa a vm-rio", "volta para o nod" ou "só na vm-sp, mesmo que atrase". É o
 * caminho no chat de `navegador.lugar` (POST /agentes/:id/navegador/lugar): o mesmo executor da tela
 * (`mudarLugarDoNavegador`), só para o próprio bot, só a pedido da pessoa. Mora fora de ferramentas-nod.ts pelo gatilho
 * de 200 linhas da EMENDA 26 e é espalhada em FERRAMENTAS_NOD.
 */
export const FERRAMENTAS_NAVEGADOR_LUGAR = {
  ajustar_navegador: {
    type: "object",
    description:
      "Muda onde o SEU navegador (navegador_*) roda, a pedido da pessoa nesta conversa. continuar_sem_mac: true = você continua com o computador dela desligado (no nod ou numa máquina sempre ligada dela); false = você só usa o navegador com o computador dela ligado. maquina: o nome de uma máquina sempre ligada dela (\"vm-rio\") para continuar lá, \"nod\" para voltar ao nod, ou \"automatica\" (a mesma do seu computador, ou a primeira). so_na_maquina: true = só na máquina escolhida, mesmo que atrase (fora do ar, você espera). Mande só o que ela pediu; responda com a frase `onde` que voltar. Se a máquina não bater, a ferramenta devolve as opções: pergunte qual.",
    properties: {
      continuar_sem_mac: { type: "boolean", description: "true: continua com o computador da pessoa desligado. false: só com ele ligado." },
      maquina: { type: "string", minLength: 1, maxLength: 80, description: "Nome (ou id) de uma máquina sempre ligada da pessoa, \"nod\" ou \"automatica\"." },
      so_na_maquina: { type: "boolean", description: "true: só na máquina escolhida, mesmo que atrase." },
    },
    required: [],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ArgsAjustarNavegador = { continuar_sem_mac?: boolean; maquina?: string; so_na_maquina?: boolean };
/** fora_do_turno: não é a conversa da pessoa com este bot, ou o turno leu conteúdo de fora / é a pedido de outro. */
export type ErroAjustarNavegador = "fora_do_turno" | "entrada_invalida" | "maquina_inexistente";
export type ResultadoAjustarNavegador =
  | { ok: true; onde: string; instrucao: string }
  | { ok: false; erro: ErroAjustarNavegador; opcoes?: string[]; instrucao: string };

export type ContratoFerramentasNavegadorLugar = {
  ajustar_navegador: { args: ArgsAjustarNavegador; resultado: ResultadoAjustarNavegador };
};
