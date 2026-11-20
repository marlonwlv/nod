type ContextoDoNavegador = {
  browser(): { isConnected(): boolean } | null;
  pages(): Array<{ isClosed(): boolean }>;
};

type FalhaDoRuntime = { codigo: string; detalhe: string };

export function navegadorEstaVivo(context: ContextoDoNavegador | null): boolean;
export function reconciliarSaudeDoNavegador(
  pronto: boolean,
  falha: FalhaDoRuntime | null,
  context: ContextoDoNavegador | null,
): { pronto: boolean; falha: FalhaDoRuntime | null };
