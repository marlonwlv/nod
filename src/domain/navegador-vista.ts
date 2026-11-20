import type { ControleNavegador, EstadoNavegador, VistaNavegador } from "../contracts/navegador-do-bot.ts";

/**
 * As regras da vista do navegador do bot (ADR-190; D3 e D4 do Paper). Puro: `agora` por parâmetro.
 */

/** definido em 2026-11-19 (D0, decisão 6): 10 min sem uso, o navegador fica "em pausa" com as abas guardadas. */
export const PAUSA_APOS_MS = 10 * 60_000;
/** D4, B: soltar o controle espera o clique em curso por até 3 s. */
export const SOLTAR_ATE_MS = 3_000;
/** D3, 4: sem quadro por 4 s com o navegador vivo, a web passa a pedir imagens a cada 2 s. */
export const REDE_FRACA_SEM_QUADRO_MS = 4_000;
export const IMAGEM_REDE_FRACA_MS = 2_000;

export function deveriaPausar(v: Pick<VistaNavegador, "estado" | "controle" | "atividadeEm" | "gravacao" | "pedido">, agora: number): boolean {
  if (v.estado !== "ao_vivo" && v.estado !== "terminou" && v.estado !== "rede_fraca") return false;
  if (v.controle === "pessoa" || v.gravacao || v.pedido) return false;
  return agora - v.atividadeEm >= PAUSA_APOS_MS;
}

/** As transições de quem mexe. Devolver só vale para quem está com a pessoa; assumir não vale do meio de um pedido de
 * aprovação (a resposta é pelos botões). */
export type OperacaoControle = "assumir" | "devolver" | "pedir" | "resolver";

export function proximoControle(atual: ControleNavegador, op: OperacaoControle): ControleNavegador | null {
  switch (op) {
    case "assumir": return atual === "pessoa" ? null : "pessoa";
    case "devolver": return atual === "pessoa" || atual === "precisa_de_voce" ? "bot" : null;
    case "pedir": return atual === "bot" || atual === "soltando" ? "precisa_de_voce" : null;
    case "resolver": return atual === "precisa_de_voce" || atual === "pessoa" ? "bot" : null;
  }
}

/** O bot só age com o controle dele. Com a pessoa (ou esperando ela), a chamada volta "aguardando_pessoa". */
export function botPodeAgir(controle: ControleNavegador): boolean {
  return controle === "bot" || controle === "soltando";
}

/** Estados parados (D3): cada um tem botão e nenhum mostra tela preta. */
export const ESTADOS_PARADOS: readonly EstadoNavegador[] = ["desligado", "pausa", "erro"];

/** A frase curta do que o bot faz agora, a mesma da linha de atividade (D1, 5). */
export function fraseDoPasso(ferramenta: string, alvo: string | null, host: string | null): string {
  const a = alvo ? `"${alvo.slice(0, 50)}"` : null;
  switch (ferramenta) {
    case "navegador_abrir": return host ? `Abrindo ${host}` : "Abrindo uma página";
    case "navegador_ler": case "navegador_texto": return host ? `Lendo ${host}` : "Lendo a página";
    case "navegador_clicar": case "navegador_procurar": return a ? `Clicando em ${a}` : "Clicando";
    case "navegador_preencher": case "navegador_digitar": return a ? `Preenchendo ${a}` : "Preenchendo um campo";
    case "navegador_rolar": return "Rolando a página";
    case "navegador_esperar": return "Esperando o site responder";
    case "navegador_ver": return "Olhando a página";
    case "navegador_baixar": return "Baixando um arquivo";
    case "navegador_enviar_arquivo": return "Enviando um arquivo";
    case "navegador_selecionar": return a ? `Escolhendo em ${a}` : "Escolhendo uma opção";
    case "navegador_abas": return "Mexendo nas abas";
    default: return "Usando o navegador";
  }
}

/** A frase da linha de tempo "terminou aqui · 16:04" (D3, 5). */
export function horaCurta(ms: number, fusoMin = -180): string {
  const d = new Date(ms + fusoMin * 60_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** Os campos de topo da vista que mudaram (o frame `navegador.mudou` diz só isto; a web relê por REST). */
export function camposQueMudaram(antes: VistaNavegador | null, depois: VistaNavegador): (keyof VistaNavegador)[] {
  const chaves = Object.keys(depois) as (keyof VistaNavegador)[];
  if (!antes) return chaves;
  return chaves.filter((k) => antes[k] !== depois[k] && JSON.stringify(antes[k]) !== JSON.stringify(depois[k]));
}

/** Estados em que há Chrome para assistir (o canal ao vivo liga o stream só neles). */
export function temChromeVivo(estado: EstadoNavegador): boolean {
  return estado === "ligando" || estado === "conectando" || estado === "ao_vivo" || estado === "rede_fraca" || estado === "terminou";
}
