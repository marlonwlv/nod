/**
 * O processo do runtime sobrevive ao Chromium para continuar respondendo ao ping. O navegador pode, porém, fechar
 * sem derrubar o PID 1 (por exemplo, pelo botão da própria janela). Nesse caso o ping precisa pedir um reinício do
 * container, em vez de anunciar `pronto` e deixar todas as ações falharem genericamente.
 */
export function navegadorEstaVivo(context) {
  try {
    const browser = context?.browser?.();
    return Boolean(browser?.isConnected() && context.pages().some((pagina) => !pagina.isClosed()));
  } catch {
    return false;
  }
}

export function reconciliarSaudeDoNavegador(pronto, falha, context) {
  if (!pronto || navegadorEstaVivo(context)) return { pronto, falha };
  return { pronto: false, falha: falha ?? { codigo: 'navegador_nao_abriu', detalhe: 'o navegador fechou' } };
}
