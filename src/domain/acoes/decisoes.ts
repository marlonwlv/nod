import type { DefinicaoAcao } from "../../contracts/acoes.ts";
import { FERRAMENTAS_DECISOES } from "../../contracts/ferramentas-decisoes.ts";

/** NOD-414: a tela e o chat usam o mesmo exportador; no chat, a ferramenta abre confirmação antes de chamá-lo. */
export const ACOES_DECISOES = [
  {
    id: "decisoes.exportar",
    titulo: "Exportar decisões de autorização em CSV",
    schema: FERRAMENTAS_DECISOES.decisoes,
    risco: "pessoa_confirma",
    cartaoNoChat: true,
    chat: { estado: "vivo", via: { ferramenta: "decisoes" }, contrato: "tests/integration/decisoes-no-chat.test.ts" },
    casoDeUso: "decisoes.exportar",
    semRotaDePessoa: "a tela baixa por GET; o chat confirma no cartão e ambos chamam exportarDecisoesCsv",
  },
] as const satisfies readonly DefinicaoAcao[];
