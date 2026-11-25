/**
 * "O outbox ganhou linha", dentro do processo (definido em 2026-10-09, #218). O events.repo avisa ao gravar e o
 * despachante (src/adapters/fundo/despachar-outbox.ts) volta ao passo curto na hora, em vez de esperar o passo ocioso.
 *
 * É só um despertador: o aviso sai ANTES do commit de quem gravou, e quem garante a entrega continua sendo a consulta
 * do despachante (o passo curto dura alguns segundos depois do aviso). Linha gravada por outro processo não avisa e
 * sai no passo ocioso, como antes saía no passo fixo.
 *
 * definido em 2026-11-23: o aviso leva as pessoas donas das linhas (o `owner_id` do outbox, a pessoa de destino). O
 * `puxar` da ponte (src/adapters/http/rotas/ponte.ts) acorda só com as linhas da pessoa dele, em vez de perguntar ao
 * banco a cada 250 ms; o despachante ignora o argumento. Ausente = vale para todo mundo.
 */
const ouvintes = new Set<(pessoas?: readonly string[]) => void>();

export function avisarOutbox(pessoas?: readonly string[]): void {
  for (const ouvinte of ouvintes) ouvinte(pessoas);
}

/** Devolve quem para de ouvir (o `parar()` do despachante, o fim do long-poll do `puxar`). */
export function ouvirOutbox(ouvinte: (pessoas?: readonly string[]) => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}
