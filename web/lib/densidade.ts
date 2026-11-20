/**
 * A largura da barra lateral (ADR-179, que substitui o ADR-060 na parte da barra; antes NOD-119 com densidades).
 * A barra é redimensionável: a pessoa arrasta a borda entre 240 e 400 px (limitado pela janela, o chat nunca fica com
 * menos de 424), recolhe para a compacta de 88 px arrastando abaixo de 208 ou com ⌘B, e reabre a partir de 216.
 * O estado guardado é {larguraExpandida, compacta}: recolher não perde a largura. Vale para este computador, como o tema
 * (web/lib/tema.ts): localStorage na web; no app do Mac, o preload repõe o valor de userData antes da página (o
 * localStorage é apagado a cada conexão). O index.html aplica a barra antes do primeiro quadro com as mesmas chaves, a
 * mesma migração e as mesmas contas (o teste confere). No celular nada muda: pintarBarra tira os atributos e a gaveta
 * segue a de hoje.
 */
import type { BarraDesktop } from "../../src/contracts/desktop-barra.ts";

export type Barra = { larguraExpandida: number; compacta: boolean };
export type PedidoBarra = "compacta" | "so_avatares" | "normal";

/** A chave nova (JSON) e a do modelo antigo de densidades, migrada uma vez. */
export const CHAVE_BARRA = "nod.barra.largura";
export const CHAVE_DENSIDADE_ANTIGA = "nod.densidade";

export const LARGURA_PADRAO = 340;
/** Os mesmos limites de LIMITES_BARRA_DESKTOP (src/contracts/desktop-barra.ts); a web só importa tipos de lá (ADR-018). */
export const LARGURA_MIN = 240;
export const LARGURA_MAX = 400;
export const LARGURA_COMPACTA = 88;
/** O chat nunca fica mais estreito que isto: o máximo da barra desconta ele e o painel da direita. */
export const CHAT_MIN = 424;
/** O painel de detalhes (3ª coluna) quando aberto. */
export const PAINEL_DETALHES = 360;
/** Arrastando: abaixo de 208 (240 − 32) recolhe; a compacta reabre a partir de 216. */
export const LIMIAR_RECOLHER = LARGURA_MIN - 32;
export const LIMIAR_REABRIR = 216;
/** ← e → com o puxador em foco. */
export const PASSO_TECLA = 16;

export const BARRA_PADRAO: Barra = { larguraExpandida: LARGURA_PADRAO, compacta: false };

/** O modelo antigo (ADR-060/NOD-119) → o novo: as recolhidas viram a compacta; a Compacta, 240; o resto, 340. */
const MIGRACAO: Record<string, Barra> = {
  "compacta:recolhida": { larguraExpandida: LARGURA_PADRAO, compacta: true },
  "confortavel:recolhida": { larguraExpandida: LARGURA_PADRAO, compacta: true },
  compacta: { larguraExpandida: LARGURA_MIN, compacta: false },
};

type Armazem = { getItem(chave: string): string | null; setItem(chave: string, valor: string): void; removeItem(chave: string): void };

const prender = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** O máximo da barra expandida para a janela e o painel da direita: min(400, janela − 424 − painel), nunca menos de 240. */
export function maximo(janela: number, painel = 0): number {
  return Math.max(LARGURA_MIN, Math.min(LARGURA_MAX, Math.floor(janela - CHAT_MIN - painel)));
}

/** A largura expandida dentro dos limites; sem janela, só 240–400. */
export function limitar(largura: number, janela = Infinity, painel = 0): number {
  const n = Number.isFinite(largura) ? Math.round(largura) : LARGURA_PADRAO;
  return prender(n, LARGURA_MIN, maximo(janela, painel));
}

/** Os px na tela: 88 compacta; a expandida limitada pela janela (a guardada não muda quando a janela encolhe). */
export function pxDaBarra(b: Barra, janela = Infinity, painel = 0): number {
  return b.compacta ? LARGURA_COMPACTA : limitar(b.larguraExpandida, janela, painel);
}

/**
 * O arrasto do puxador, 1:1: `ponteiroX` é a largura que o ponteiro pede (a posição na borda), `inicio` a barra quando o
 * botão desceu e `atual` a de agora (a compacta tem a histerese 208/216). Recolher guarda a largura do início.
 */
export function arrasto(ponteiroX: number, inicio: Barra, atual: Barra, janela = Infinity, painel = 0): Barra {
  if (atual.compacta) {
    if (ponteiroX < LIMIAR_REABRIR) return { larguraExpandida: atual.larguraExpandida, compacta: true };
    return { larguraExpandida: limitar(Math.max(LARGURA_MIN, ponteiroX), janela, painel), compacta: false };
  }
  if (ponteiroX < LIMIAR_RECOLHER) return { larguraExpandida: limitar(inicio.larguraExpandida), compacta: true };
  return { larguraExpandida: limitar(ponteiroX, janela, painel), compacta: false };
}

/** ← e → com o puxador em foco: ±16 px, parado nas pontas; → na compacta abre em 240. null = a tecla não é do puxador. */
export function barraPelaTecla(b: Barra, tecla: string, janela = Infinity, painel = 0): Barra | null {
  if (tecla !== "ArrowLeft" && tecla !== "ArrowRight") return null;
  if (b.compacta) return tecla === "ArrowRight" ? { larguraExpandida: LARGURA_MIN, compacta: false } : b;
  const passo = tecla === "ArrowRight" ? PASSO_TECLA : -PASSO_TECLA;
  return { larguraExpandida: limitar(pxDaBarra(b, janela, painel) + passo, janela, painel), compacta: false };
}

/** ⌘B: compacta ↔ expandida, voltando à última largura expandida. */
export function alternarCompacta(b: Barra): Barra {
  return { larguraExpandida: b.larguraExpandida, compacta: !b.compacta };
}

/** O pedido pelo chat: só avatares = a compacta; compacta = 240 expandida; normal = a última largura expandida. */
export function pedidoDoChat(atual: Barra, pedido: PedidoBarra): Barra {
  if (pedido === "so_avatares") return { larguraExpandida: atual.larguraExpandida, compacta: true };
  if (pedido === "compacta") return { larguraExpandida: LARGURA_MIN, compacta: false };
  return { larguraExpandida: atual.larguraExpandida, compacta: false };
}

export function iguais(a: Barra, b: Barra): boolean {
  return a.compacta === b.compacta && limitar(a.larguraExpandida) === limitar(b.larguraExpandida);
}

/** Uma chave curta da barra (dependência do `lembrar` e do que a conversa acompanha). */
export function chaveDaBarra(b: Barra): string {
  return `${limitar(b.larguraExpandida)}${b.compacta ? ":compacta" : ""}`;
}

/** A barra em palavras (o Antes → Depois do card e o aria-valuetext do puxador). */
export function rotuloDaLargura(b: Barra, janela = Infinity, painel = 0): string {
  if (b.compacta) return "Só avatares";
  const px = pxDaBarra(b, janela, painel);
  return px <= LARGURA_MIN ? `Compacta, ${px} px` : `${px} px`;
}

/** O valor guardado (o mesmo que vai ao app do Mac): sempre dentro dos limites, em px inteiros. */
export function serializar(b: Barra): BarraDesktop {
  return { larguraExpandida: limitar(b.larguraExpandida), compacta: b.compacta === true };
}

/** O JSON guardado → a barra; qualquer coisa estranha volta ao padrão. */
export function desserializar(v: string | null | undefined): Barra {
  if (!v) return BARRA_PADRAO;
  try {
    const o: unknown = JSON.parse(v);
    if (typeof o !== "object" || o === null) return BARRA_PADRAO;
    const { larguraExpandida: l, compacta: c } = o as Record<string, unknown>;
    if (typeof l !== "number" || !Number.isFinite(l) || typeof c !== "boolean") return BARRA_PADRAO;
    return { larguraExpandida: limitar(l), compacta: c };
  } catch {
    return BARRA_PADRAO;
  }
}

/** A chave antiga → a barra nova (desconhecido = o padrão, 340). */
export function migrarAntiga(v: string | null | undefined): Barra {
  return v && Object.hasOwn(MIGRACAO, v) ? MIGRACAO[v]! : BARRA_PADRAO;
}

/**
 * A barra guardada. Sem a chave nova e com a antiga, migra uma vez: grava a nova e apaga a antiga (o app do Mac fica
 * sabendo na primeira gravação, com aplicarBarra).
 */
export function lerBarra(armazem: Partial<Armazem> & Pick<Armazem, "getItem"> | null = guardado()): Barra {
  try {
    const nova = armazem?.getItem(CHAVE_BARRA);
    if (nova) return desserializar(nova);
    const antiga = armazem?.getItem(CHAVE_DENSIDADE_ANTIGA);
    if (antiga === null || antiga === undefined) return BARRA_PADRAO;
    const b = migrarAntiga(antiga);
    armazem?.setItem?.(CHAVE_BARRA, JSON.stringify(serializar(b)));
    armazem?.removeItem?.(CHAVE_DENSIDADE_ANTIGA);
    return b;
  } catch {
    return BARRA_PADRAO;
  }
}

type Raiz = { dataset: Record<string, string | undefined>; style: { setProperty(n: string, v: string): void; removeProperty(n: string): void } };

/**
 * Só os atributos do <html> (o que o CSS lê). No computador: data-barra ("expandida" | "compacta") e --largura-barra;
 * a compacta também leva data-largura="recolhida" (o gancho de sempre dos CSS da barra só com avatares).
 * `buscando` na compacta abre a barra expandida POR CIMA da conversa, já com a busca: a coluna continua em 88, o desenho
 * é o da expandida (sem data-largura) e data-sobreposta/--largura-sobreposta dão a largura dela. No celular, nenhum.
 */
export function pintarBarra(b: Barra, raiz: Raiz, celular: boolean, buscando = false, janela = Infinity, painel = 0): void {
  delete raiz.dataset.sobreposta;
  raiz.style.removeProperty("--largura-sobreposta");
  if (celular) {
    delete raiz.dataset.barra;
    delete raiz.dataset.largura;
    raiz.style.removeProperty("--largura-barra");
    return;
  }
  raiz.dataset.barra = b.compacta ? "compacta" : "expandida";
  raiz.style.setProperty("--largura-barra", `${pxDaBarra(b, janela, painel)}px`);
  if (!b.compacta) delete raiz.dataset.largura;
  else if (buscando) {
    delete raiz.dataset.largura;
    const px = limitar(b.larguraExpandida, janela, painel);
    raiz.dataset.sobreposta = String(px);
    raiz.style.setProperty("--largura-sobreposta", `${px}px`);
  } else raiz.dataset.largura = "recolhida";
}

/** Grava neste computador (a chave nova; a antiga sai) e manda para fora (o app do Mac), quando há. */
export function gravarBarra(b: Barra, armazem: Pick<Armazem, "setItem" | "removeItem"> | null = guardado(), gravarFora?: (v: BarraDesktop) => void): void {
  const v = serializar(b);
  try {
    armazem?.setItem(CHAVE_BARRA, JSON.stringify(v));
    armazem?.removeItem(CHAVE_DENSIDADE_ANTIGA);
  } catch {
    // Armazenamento bloqueado: vale até fechar a janela.
  }
  gravarFora?.(v);
}

/**
 * O executor único (o puxador ao soltar, as teclas, o ⌘B e o card do chat passam por aqui): pinta o <html> e grava
 * neste computador. `gravarFora` leva ao processo principal do app do Mac, quando há.
 */
export function aplicarBarra(b: Barra, raiz: Raiz, celular: boolean, armazem: Pick<Armazem, "setItem" | "removeItem"> | null = guardado(), gravarFora?: (v: BarraDesktop) => void, janela = Infinity, painel = 0): Barra {
  const n = serializar(b);
  pintarBarra(n, raiz, celular, false, janela, painel);
  gravarBarra(n, armazem, gravarFora);
  return n;
}

function guardado(): Armazem | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * NOD-119 (revisão 7): roda `fn` uma vez, `ms` depois da última chamada. A conversa (o "Antes"/"já está" do card) e o
 * preferencias.json do Mac só acompanham quando a barra para de mudar (as teclas em sequência).
 */
export function adiar<T>(ms: number, fn: (v: T) => void, relogio: Pick<typeof globalThis, "setTimeout" | "clearTimeout"> = globalThis): ((v: T) => void) & { agora(v: T): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancelar = () => { if (timer !== undefined) relogio.clearTimeout(timer); timer = undefined; };
  /** `agora` cancela o pendente e roda já: a escolha de um clique vence o que ainda não gravou (revisão 9). */
  return Object.assign((v: T) => { cancelar(); timer = relogio.setTimeout(() => { timer = undefined; fn(v); }, ms); }, { agora: (v: T) => { cancelar(); fn(v); } });
}
