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

/**
 * Estados em que há Chrome para assistir (o canal ao vivo liga o stream só neles). definido em 2026-11-20: "ligando" fica
 * de fora — o Chrome ainda está subindo pelo comando do bot, e pedir o stream no meio abriria um segundo comando na
 * mesma sessão antes de o daemon existir.
 */
export function temChromeVivo(estado: EstadoNavegador): boolean {
  return estado === "ao_vivo" || estado === "rede_fraca" || estado === "terminou";
}

/**
 * O tamanho do Chrome do bot acompanha quem assiste (emenda de 2026-11-20 da ADR-190, item 4). A web manda o tamanho da
 * área da vista em CSS px; o Chrome fica um pouco maior que a área (a página cabe como num notebook, e a vista reduz).
 *
 * definido em 2026-11-20: largura = clamp(round(w × 1,6), 800, 1440); altura = largura × h / w, arredondada, até 2400. O
 * 1,6 põe um painel de 560 px em ~900 px de página (o "notebook pequeno" em que os sites não viram celular); 800 é o piso
 * em que os sites ainda mostram o layout de computador; 1440 e 2400 seguram o tamanho do quadro JPEG.
 * revisto em 2026-11-22 (ponto 12 dos cenários): o piso passa a 640. No painel de ~410 px, 800 px de página viravam metade
 * do tamanho (o Google Voos ilegível); em 640 os sites já usam o layout estreito, que se lê no painel.
 */
export const VIEWPORT_ESCALA = 1.6;
export const VIEWPORT_LARGURA_MIN = 640;
export const VIEWPORT_LARGURA_MAX = 1440;
export const VIEWPORT_ALTURA_MAX = 2400;
/**
 * definido em 2026-11-20: o Chrome só muda de tamanho quando a diferença passa de 4% em algum lado (arrastar a alça manda
 * um só no fim, e a faixa do aviso do site não conta). Era 8%: na revisão lado a lado com o Paper, o que ficava abaixo do
 * limiar aparecia como uma faixa cinza de até ~50 px embaixo da imagem, contra a vista que enche a área.
 */
export const VIEWPORT_DIFERENCA_MIN = 0.04;

export function viewportDeQuemAssiste(area: { w: number; h: number }): { w: number; h: number } {
  const w = Math.min(VIEWPORT_LARGURA_MAX, Math.max(VIEWPORT_LARGURA_MIN, Math.round(area.w * VIEWPORT_ESCALA)));
  const h = Math.max(1, Math.min(VIEWPORT_ALTURA_MAX, Math.round((w * area.h) / area.w)));
  return { w, h };
}

/** O tamanho novo muda mais de 8% em algum lado (vale a pena mudar o Chrome). */
export function viewportMudouMuito(atual: { w: number; h: number }, novo: { w: number; h: number }): boolean {
  const d = (a: number, b: number) => Math.abs(a - b) / Math.max(1, a);
  return d(atual.w, novo.w) > VIEWPORT_DIFERENCA_MIN || d(atual.h, novo.h) > VIEWPORT_DIFERENCA_MIN;
}
