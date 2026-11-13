import type { DecisaoDto } from "./decisoes-do-bot.ts";
import type { JsonSchema } from "./json-schema.ts";

export const FERRAMENTAS_DECISOES = {
  decisoes: {
    type: "object",
    description: "Consulta decisões de autorização ou propõe exportá-las em CSV. consultar põe no chat um card com até 4 linhas. exportar põe o card obrigatório Gerar CSV / Agora não; o arquivo só nasce após confirmação. Datas são YYYY-MM-DD no fuso IANA. Bot comum só consulta as próprias decisões; o Nod também pode receber bot.",
    properties: {
      acao: { type: "string", enum: ["consultar", "exportar"] },
      de: { type: "string", description: "Primeiro dia, YYYY-MM-DD." },
      ate: { type: "string", description: "Último dia, YYYY-MM-DD." },
      fuso: { type: "string", description: "Fuso IANA, por exemplo America/Sao_Paulo." },
      desfecho: { type: "string", enum: ["tudo", "permitida", "negada", "cartao"] },
      bot: { type: "string", description: "Nome exato do bot; só o Nod consulta outro bot." },
    },
    required: ["acao", "de", "ate", "fuso"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ArgsDecisoes = { acao: "consultar" | "exportar"; de: string; ate: string; fuso: string; desfecho?: "tudo" | "permitida" | "negada" | "cartao"; bot?: string };
export type ResultadoDecisoes =
  | { ok: true; total: number; linhas: DecisaoDto[]; instrucao: string }
  | { ok: true; estado: "pendente"; decisao_id: string; arquivos: number; instrucao: string }
  | { ok: false; erro: "fora_da_conversa" | "nao_encontrado" | "entrada_invalida" | "periodo_longo"; instrucao: string };
export type ContratoFerramentasDecisoes = { decisoes: { args: ArgsDecisoes; resultado: ResultadoDecisoes } };

export type PayloadDecisoesResumo = { kind: "decisoes_resumo"; agenteId: string; agenteNome: string; de: string; ate: string; desfecho: ArgsDecisoes["desfecho"]; linhas: DecisaoDto[]; total: number };
export type PayloadPropostaDecisoesExportacao = { kind: "decisoes_exportacao"; agenteId: string; agenteNome: string; de: string; ate: string; fuso: string; desfecho: NonNullable<ArgsDecisoes["desfecho"]>; periodos: { de: string; ate: string }[] };
