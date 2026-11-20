/**
 * Leva 2 (2026-11-13, ADR-181): as leituras do `reidratar` em voo, por chave, com um teto de quantas saem ao mesmo tempo.
 *
 * Antes havia uma trava única (`reidratando`): a passada inteira esperava a leitura MAIS LENTA acabar, e o clique num
 * bot no meio dela só disparava a conversa depois do `GET conectores` que foi ao Composio. Aqui cada chave é uma leitura:
 * a chave nova sai na hora (se houver vaga), a chave repetida espera a MESMA promessa (sem GET duplicado do clique
 * durante o prefetch do hover), e o teto limita quantas transações uma pessoa abre de uma vez no servidor (ADR-001: o
 * pool tem 15; duas pessoas abrindo o app juntas ficam em 12).
 *
 *   correr(k) ──► k em voo? ── sim ──► a mesma promessa
 *                   │ não
 *                   ▼
 *             há vaga (< teto)? ── não ──► espera a próxima vaga (FIFO)
 *                   │ sim
 *                   ▼
 *              ler(k) ──► finally: libera a vaga, tira k do mapa, acorda o próximo
 *
 * Puro: sem DOM nem relógio. `ler` nunca deve rejeitar (quem chama trata o erro); se rejeitar, a promessa da chave
 * rejeita para todos que a esperam.
 */
export type LeiturasEmVoo<K> = {
  /** A chave está em voo (lendo ou esperando vaga). */
  emVoo(k: K): boolean;
  /** Roda `ler` para a chave, respeitando o teto; a mesma chave em voo devolve a mesma promessa. */
  correr(k: K, ler: () => Promise<void>): Promise<void>;
  /** Quantas chaves estão em voo (lendo ou esperando vaga). */
  tamanho(): number;
  /** Quantas estão lendo agora (≤ teto). */
  lendo(): number;
};

export function criarLeiturasEmVoo<K>(teto: number): LeiturasEmVoo<K> {
  if (!Number.isInteger(teto) || teto < 1) throw new RangeError(`teto inválido: ${teto}`);
  const vivas = new Map<K, Promise<void>>();
  let rodando = 0;
  const fila: (() => void)[] = [];
  return {
    emVoo: (k) => vivas.has(k),
    tamanho: () => vivas.size,
    lendo: () => rodando,
    correr(k, ler) {
      const ja = vivas.get(k);
      if (ja) return ja;
      const p = (async () => {
        // A vaga é tomada SÍNCRONA (antes do 1º await): duas chamadas seguidas não contam a mesma vaga duas vezes.
        if (rodando < teto) rodando++;
        else await new Promise<void>((r) => fila.push(r));
        try {
          await ler();
        } finally {
          vivas.delete(k);
          // A vaga passa direto a quem espera (sem soltar e retomar: ninguém entra no meio); sem fila, é devolvida.
          const proximo = fila.shift();
          if (proximo) proximo();
          else rodando--;
        }
      })();
      vivas.set(k, p);
      return p;
    },
  };
}
