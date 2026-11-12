/**
 * ADR-165 (configuração "Accent" do Grok Bot): o balão da pessoa é preto por padrão; pintar com a cor do bot da conversa
 * (NOD-431) vira opção em Configurações › Geral › Aparência. A escolha é deste computador, como o tema: localStorage na
 * web, e o index.html a aplica antes do primeiro quadro (mesma chave), senão o balão pisca colorido. O CSS lê
 * `data-balao="cor"` no <html> (web/ds.css); sem o atributo, `--balao-pessoa` vence a classe `balao-c-*`.
 */
export const CHAVE_BALAO = "nod.balao";

type Armazem = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

export function lerBalaoCor(armazem: Pick<Armazem, "getItem"> | null = guardado()): boolean {
  try {
    return armazem?.getItem(CHAVE_BALAO) === "cor";
  } catch {
    return false;
  }
}

/** `raiz` é o <html>; passado por quem chama para o módulo não depender do DOM. */
export function aplicarBalaoCor(cor: boolean, raiz: { dataset: Record<string, string | undefined> }, armazem: Pick<Armazem, "setItem" | "removeItem"> | null = guardado()): boolean {
  if (cor) raiz.dataset.balao = "cor";
  else delete raiz.dataset.balao;
  try {
    if (cor) armazem?.setItem(CHAVE_BALAO, "cor");
    else armazem?.removeItem(CHAVE_BALAO);
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
