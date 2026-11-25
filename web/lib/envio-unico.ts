/**
 * QA-186: os formulários dos Conectores avançados (Conceder, Registrar MCP, chaves e credenciais) não desligavam o botão
 * durante o envio. O duplo clique mandava dois POSTs: o primeiro gravava e o segundo voltava 409 ("Isso não pode ser feito
 * agora. Atualize a página…") por cima de uma ação que deu certo. Uma chave (o handler e o `data-id` do formulário) fica
 * presa enquanto o envio corre; o segundo envio com a mesma chave é ignorado. A chave, e não o nó, porque a versão por
 * string redesenha o formulário no meio do envio. O botão de enviar fica desligado e o formulário com `aria-busy`.
 */
const emEnvio = new Set<string>();

export function chaveDoEnvio(qual: string, form: HTMLFormElement): string {
  return `${qual}:${form.dataset.id ?? ""}`;
}

export async function umEnvioPorVez(qual: string, form: HTMLFormElement, fn: () => Promise<void>): Promise<void> {
  const chave = chaveDoEnvio(qual, form);
  if (emEnvio.has(chave)) return;
  emEnvio.add(chave);
  const botoes = [...form.querySelectorAll<HTMLButtonElement>('button[type="submit"], button:not([type])')].filter((b) => !b.disabled);
  for (const b of botoes) b.disabled = true;
  form.setAttribute("aria-busy", "true");
  try {
    await fn();
  } finally {
    emEnvio.delete(chave);
    for (const b of botoes) b.disabled = false;
    form.removeAttribute("aria-busy");
  }
}
