import { SLUG_MAC } from "../../contracts/mac.ts";
import { ehCapacidadeMac } from "../../domain/mac.ts";
import { executarGithubNaMaquina } from "./github/maquina.ts";
import { executarMacNaMaquina } from "./mac/maquina.ts";

/**
 * ADR-173: quem executa um efeito "na máquina" (ADR-048) — o `gh` do conector `github` ou o Mail/Notas/Mensagens do
 * conector `mac`. Os nomes das capacidades não se cruzam (os do `mac` estão em src/contracts/mac.ts); quando o nome da
 * ferramenta é conhecido (no proxy), o conector tem de bater também: `mac__<capacidade>` só roda no Mac, e uma
 * capacidade do `mac` com nome de outro conector é recusada.
 */
export type ResultadoNaMaquina = { conteudo: string; isError: boolean; codigo: string; imagem?: { data: string; mimeType: string } };

export async function executarConectorNaMaquina(p: { capacidade: string; argumentos: Readonly<Record<string, unknown>>; ambiente: Readonly<Record<string, string | undefined>>; orcamentoChars?: number; nomeFerramenta?: string }): Promise<ResultadoNaMaquina> {
  if (ehCapacidadeMac(p.capacidade)) {
    if (p.nomeFerramenta !== undefined && p.nomeFerramenta !== `${SLUG_MAC}__${p.capacidade}`) return { conteudo: `capacidade desconhecida: ${p.capacidade}`, isError: true, codigo: "capacidade_desconhecida" };
    return executarMacNaMaquina({ capacidade: p.capacidade, argumentos: p.argumentos, ...(p.ambiente.HOME ? { home: p.ambiente.HOME } : {}) });
  }
  if (p.nomeFerramenta?.startsWith(`${SLUG_MAC}__`)) return { conteudo: `capacidade desconhecida: ${p.capacidade}`, isError: true, codigo: "capacidade_desconhecida" };
  return executarGithubNaMaquina(p);
}
