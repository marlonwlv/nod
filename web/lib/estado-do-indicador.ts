/**
 * COP-14 (item 2, revisto em 2026-11-12): a função única do estado do bot no indicador do chat. Puro: recebe o estado vivo
 * do bot (hoje montado a partir do turno vivo e da atividade; com o frame de estado vivo do backend, lido direto dele) e
 * devolve o rótulo, ou null quando o bot está parado (a linha some).
 *
 * Ordem: rodando — compondo → "Digitando…"; senão pelo tipo da atividade (thinking → "Refletindo" em 3 variantes que
 * trocam a cada 2,5 s; ferramenta → o rótulo dela); sem atividade → "Trabalhando" em 5 variantes que trocam a cada 5 s.
 * Depois: aguardando a pessoa → o desfecho por menos de 8 s → parado. Cada rótulo fica no mínimo 800 ms na tela
 * (`rotuloComPermanencia`); a troca de variante é do relógio da tela (web/lib/fala-viva.ts, `escreverVariantes`).
 */

export type AtividadeDoBot = { tipo: "thinking" } | { tipo: "ferramenta"; rotulo: string; frentes?: boolean };
export type DesfechoDoBot = { tipo: "respondeu" | "parou" | "falhou"; em: number };

export type EstadoVivoDoBot = {
  rodando: boolean;
  compondo: boolean;
  atividade: AtividadeDoBot | null;
  aguardando: "aprovacao" | "resposta" | null;
  desfecho: DesfechoDoBot | null;
};

export type RotuloDoIndicador = {
  id: string;
  texto: string;
  brilho: boolean;
  /** As variantes que o relógio da tela alterna no lugar (a primeira é `texto`), e de quanto em quanto tempo. */
  variantes?: readonly string[];
  periodoMs?: number;
  mascote: "trabalhando" | "pensando" | "aguardando" | "disponivel";
  state: string;
};

/** definido em 2026-11-12 (COP-14): as variantes e os períodos do plano do chat. */
export const VARIANTES_REFLETINDO = ["Refletindo", "Pensando", "Ponderando"] as const;
export const VARIANTES_TRABALHANDO = ["Trabalhando", "Cuidando disso", "Organizando", "Seguindo com isso", "Ainda nisso"] as const;
export const PERIODO_REFLETINDO_MS = 2_500;
export const PERIODO_TRABALHANDO_MS = 5_000;
/** O desfecho fica à vista por menos de 8 s depois que o bot para. */
export const DESFECHO_MS = 8_000;
/** Nenhum rótulo fica menos que isto na tela (a troca rápida de ferramentas não pisca). */
export const PERMANENCIA_MS = 800;

const TEXTO_DO_DESFECHO: Record<DesfechoDoBot["tipo"], string> = { respondeu: "Respondeu", parou: "Parou", falhou: "Não terminou" };

/**
 * Um verbo curto por ferramenta. O servidor já manda o rótulo no presente (src/domain/rotulo-ferramenta.ts); aqui só os
 * que o chat pede diferente. O resto ("Pesquisando na web", "Usando Gmail") passa como veio.
 */
const VERBO_DA_FERRAMENTA: Readonly<Record<string, string>> = {
  "Lendo um arquivo": "Lendo arquivos",
  "Procurando arquivos": "Pesquisando no código",
  "Procurando nos arquivos": "Pesquisando no código",
  "Rodando um comando": "Rodando no terminal",
  "Lendo a saída de um comando": "Rodando no terminal",
  "Usando o navegador": "Abrindo o navegador",
};
export function verboDaFerramenta(texto: string): string {
  return Object.hasOwn(VERBO_DA_FERRAMENTA, texto) ? VERBO_DA_FERRAMENTA[texto]! : texto;
}

export function estadoDoIndicador(e: EstadoVivoDoBot, agora: number): RotuloDoIndicador | null {
  if (e.aguardando) {
    const texto = e.aguardando === "resposta" ? "Esperando sua resposta" : "Esperando sua aprovação";
    return { id: `aguardando:${e.aguardando}`, texto, brilho: true, mascote: "aguardando", state: "notify" };
  }
  if (e.rodando) {
    if (e.compondo) return { id: "digitando", texto: "Digitando…", brilho: false, mascote: "disponivel", state: "idle" };
    if (e.atividade?.tipo === "ferramenta") {
      const texto = verboDaFerramenta(e.atividade.rotulo);
      return { id: `ferramenta:${texto}`, texto, brilho: true, mascote: "trabalhando", state: e.atividade.frentes ? "comet" : "orbit" };
    }
    if (e.atividade?.tipo === "thinking") return { id: "refletindo", texto: VARIANTES_REFLETINDO[0], brilho: true, variantes: VARIANTES_REFLETINDO, periodoMs: PERIODO_REFLETINDO_MS, mascote: "pensando", state: "thinking" };
    return { id: "trabalhando", texto: VARIANTES_TRABALHANDO[0], brilho: true, variantes: VARIANTES_TRABALHANDO, periodoMs: PERIODO_TRABALHANDO_MS, mascote: "trabalhando", state: "orbit" };
  }
  if (e.desfecho && agora - e.desfecho.em < DESFECHO_MS) {
    return { id: `desfecho:${e.desfecho.tipo}`, texto: TEXTO_DO_DESFECHO[e.desfecho.tipo], brilho: false, mascote: "disponivel", state: "idle" };
  }
  return null;
}

/** A variante da vez, contada desde que o rótulo entrou. */
export function varianteDaVez(r: Pick<RotuloDoIndicador, "texto" | "variantes" | "periodoMs">, desde: number, agora: number): string {
  if (!r.variantes?.length || !r.periodoMs) return r.texto;
  const i = Math.floor(Math.max(0, agora - desde) / r.periodoMs) % r.variantes.length;
  return r.variantes[i]!;
}

export type NaTela = { rotulo: RotuloDoIndicador; desde: number };
export type Permanencia = { atual: NaTela; pendente: RotuloDoIndicador | null };

/**
 * O rótulo que fica na tela: o novo entra se o anterior já ficou PERMANENCIA_MS; senão o anterior fica e o novo espera
 * (`pendente`, que o relógio da tela escreve quando der o tempo). Puro: quem chama guarda o `NaTela` por turno.
 */
export function rotuloComPermanencia(anterior: NaTela | undefined, novo: RotuloDoIndicador, agora: number): Permanencia {
  if (!anterior || anterior.rotulo.id === novo.id) return { atual: { rotulo: novo, desde: anterior?.rotulo.id === novo.id ? anterior.desde : agora }, pendente: null };
  if (agora - anterior.desde >= PERMANENCIA_MS) return { atual: { rotulo: novo, desde: agora }, pendente: null };
  return { atual: anterior, pendente: novo };
}
