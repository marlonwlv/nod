/**
 * ADR-167 (configuração "Accent"): pintar o balão da pessoa com a cor do bot da conversa (NOD-431) é opção em
 * Configurações › Geral › Aparência. revisto em 2026-11-12 (COP-14, item 3): a cor do bot passa a ser o padrão; o balão
 * preto fica para quem desligar (guardado como "preto"). A escolha é deste computador, como o tema: localStorage na
 * web, e o index.html a aplica antes do primeiro quadro (mesma chave), senão o balão pisca colorido. O CSS lê
 * `data-balao="cor"` no <html> (web/ds.css); sem o atributo, `--balao-pessoa` vence a classe `balao-c-*`.
 */
export const CHAVE_BALAO = "nod.balao";

type Armazem = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

export function lerBalaoCor(armazem: Pick<Armazem, "getItem"> | null = guardado()): boolean {
  try {
    return armazem?.getItem(CHAVE_BALAO) !== "preto";
  } catch {
    return true;
  }
}

/** `raiz` é o <html>; passado por quem chama para o módulo não depender do DOM. */
export function aplicarBalaoCor(cor: boolean, raiz: { dataset: Record<string, string | undefined> }, armazem: Pick<Armazem, "setItem" | "removeItem"> | null = guardado()): boolean {
  if (cor) raiz.dataset.balao = "cor";
  else delete raiz.dataset.balao;
  try {
    if (cor) armazem?.removeItem(CHAVE_BALAO);
    else armazem?.setItem(CHAVE_BALAO, "preto");
  } catch {
    // Armazenamento bloqueado: vale até fechar a janela.
  }
  return cor;
}

function guardado(): Armazem | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
