/** Serializa operações que criam ou trocam a sessão desta aba. */
export function criarTravaDeSessao() {
  let cauda: Promise<void> = Promise.resolve();

  return {
    executar<T>(acao: () => Promise<T>): Promise<T> {
      const anterior = cauda;
      let liberar!: () => void;
      cauda = new Promise<void>((resolve) => { liberar = resolve; });
      return anterior.then(acao).finally(liberar);
    },
  };
}

const VERIFICADOR = /^[A-Za-z0-9_-]{32,128}$/;

/** Reaproveita o verificador válido e só guarda um novo depois que o servidor abriu o espaço. */
export async function comVerificadorDoProvisorio(p: {
  ler: () => string | null;
  gravar: (valor: string) => void;
  gerar: () => string;
  abrir: (valor: string) => Promise<boolean>;
}): Promise<boolean> {
  const guardado = p.ler();
  const novo = !guardado || !VERIFICADOR.test(guardado);
  const valor = novo ? p.gerar() : guardado;
  const abriu = await p.abrir(valor);
  if (abriu && novo) p.gravar(valor);
  return abriu;
}
