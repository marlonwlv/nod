import { FERRAMENTAS_NAVEGADOR_CATALOGO, type NomeFerramentaNavegadorCatalogo } from "../contracts/ferramentas-navegador.ts";
import type { JsonSchema } from "../contracts/json-schema.ts";
import { semAcento } from "./navegador-aprovacao.ts";

/**
 * A busca do catálogo do navegador (ADR-190): o modelo pede por palavra ("aba", "upload", "pixel") e recebe as
 * ferramentas que casam, com o esquema. Puro.
 *
 * definido em 2026-11-20: casa por palavra no nome e na descrição, com sinônimos dos pedidos mais comuns; até 6
 * resultados; sem nenhum casamento, devolve a lista inteira de nomes para o modelo escolher.
 */
const SINONIMOS: Readonly<Record<string, readonly NomeFerramentaNavegadorCatalogo[]>> = {
  aba: ["navegador_abas"], abas: ["navegador_abas"], tab: ["navegador_abas"], janela: ["navegador_abas"],
  voltar: ["navegador_historico"], avancar: ["navegador_historico"], recarregar: ["navegador_historico"], back: ["navegador_historico"], reload: ["navegador_historico"],
  baixar: ["navegador_baixar"], download: ["navegador_baixar"], pdf: ["navegador_pdf", "navegador_baixar"],
  upload: ["navegador_enviar_arquivo"], anexar: ["navegador_enviar_arquivo"], arquivo: ["navegador_enviar_arquivo", "navegador_baixar"],
  select: ["navegador_selecionar"], opcao: ["navegador_selecionar"], dropdown: ["navegador_selecionar"], lista: ["navegador_selecionar"],
  checkbox: ["navegador_marcar"], marcar: ["navegador_marcar"], hover: ["navegador_passar_mouse"], menu: ["navegador_passar_mouse"],
  arrastar: ["navegador_arrastar"], drag: ["navegador_arrastar"],
  pixel: ["navegador_pixel"], coordenada: ["navegador_pixel"], canvas: ["navegador_pixel"], mapa: ["navegador_pixel"],
  css: ["navegador_estilos"], estilo: ["navegador_estilos"], layout: ["navegador_estilos", "navegador_obter"],
  iframe: ["navegador_quadro"], frame: ["navegador_quadro"],
  alert: ["navegador_dialogo"], confirm: ["navegador_dialogo"], dialogo: ["navegador_dialogo"], popup: ["navegador_dialogo", "navegador_abas"],
  javascript: ["navegador_avaliar"], js: ["navegador_avaliar"], eval: ["navegador_avaliar"], script: ["navegador_rodar_script", "navegador_avaliar"], lote: ["navegador_rodar_script"],
  texto: ["navegador_texto"], ler: ["navegador_texto"], url: ["navegador_obter"], titulo: ["navegador_obter"], valor: ["navegador_obter"], atributo: ["navegador_obter"], html: ["navegador_obter"],
  digitar: ["navegador_digitar"], achar: ["navegador_procurar"], encontrar: ["navegador_procurar"], procurar: ["navegador_procurar"], rotulo: ["navegador_procurar"],
  combinar: ["navegador_combinar"], teto: ["navegador_combinar"], limite: ["navegador_combinar"], antemao: ["navegador_combinar"], pagar: ["navegador_combinar"], pagamento: ["navegador_combinar"], comprar: ["navegador_combinar"], compra: ["navegador_combinar"],
  ensinada: ["navegador_tarefa_ensinada"], ensinou: ["navegador_tarefa_ensinada"], habilidade: ["navegador_tarefa_ensinada"], tarefa: ["navegador_tarefa_ensinada"],
};

export type ResultadoBusca = { nome: NomeFerramentaNavegadorCatalogo; descricao: string; esquema: JsonSchema };

export function buscarNoCatalogo(busca: string, limite = 6): { resultados: ResultadoBusca[]; todos: readonly string[] } {
  const termos = semAcento(busca).split(/[^a-z0-9]+/).filter((t) => t.length > 1);
  const pontos = new Map<NomeFerramentaNavegadorCatalogo, number>();
  const somar = (n: NomeFerramentaNavegadorCatalogo, p: number) => pontos.set(n, (pontos.get(n) ?? 0) + p);
  for (const t of termos) {
    for (const n of SINONIMOS[t] ?? []) somar(n, 5);
    for (const [nome, schema] of Object.entries(FERRAMENTAS_NAVEGADOR_CATALOGO) as [NomeFerramentaNavegadorCatalogo, JsonSchema][]) {
      if (nome.includes(t)) somar(nome, 3);
      else if (semAcento(schema.description ?? "").includes(t)) somar(nome, 1);
    }
  }
  const resultados = [...pontos.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limite)
    .map(([nome]) => { const esquema = FERRAMENTAS_NAVEGADOR_CATALOGO[nome] as JsonSchema; return { nome, descricao: esquema.description ?? "", esquema }; });
  return { resultados, todos: Object.keys(FERRAMENTAS_NAVEGADOR_CATALOGO) };
}

export function ehDoCatalogo(nome: string): nome is NomeFerramentaNavegadorCatalogo {
  return Object.hasOwn(FERRAMENTAS_NAVEGADOR_CATALOGO, nome);
}
