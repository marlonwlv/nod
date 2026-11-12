/**
 * ADR-171 (definido em 2026-11-12): a fila de envio offline da web, como um diário de envio (acked / failed /
 * queued_offline). A fala pendente já existia (enviando / falhou, com "Tentar de novo" pela mesma chave de idempotência,
 * NOD-156); o que faltava:
 *   - a fala que falhou SEM INTERNET vai para uma fila no `localStorage` da pessoa e sobrevive a recarregar a página;
 *   - quando a conexão volta (`online`), cada uma é reenviada sozinha, pela MESMA chave (o servidor não duplica);
 *   - recarregou sem internet: as falas da fila voltam à conversa como pendentes, com o motivo dizendo que vão sozinhas.
 * Só texto, citação e ids de anexos já enviados (nunca o arquivo). Teto de 50 itens e 7 dias: o resto é descartado.
 */
export type ItemDaFila = { conversaId: string; idEnvio: string; texto: string; anexos: string[]; respondeA?: string; em: number };
export type Armazem = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

export const MOTIVO_OFFLINE = "Sem internet: ela vai sozinha quando a conexão voltar.";
const TETO_ITENS = 50;
const VALIDADE_MS = 7 * 24 * 3600_000;

const chaveDa = (pessoaId: string) => `nod.fila-envio.${pessoaId}`;

/** O envio caiu por falta de rede (e não por uma recusa do servidor, que repetir não resolve). */
export function falhouPorRede(online: boolean, erro: unknown): boolean {
  if (!online) return true;
  const e = erro as { status?: unknown; name?: unknown } | null;
  return !!e && typeof e === "object" && (e.status === 0 || e.name === "TypeError");
}

export function criarFilaOffline(armazem: Armazem | null, pessoaId: string, agora: () => number = Date.now) {
  const chave = chaveDa(pessoaId);
  function ler(): ItemDaFila[] {
    if (!armazem) return [];
    try {
      const lido = JSON.parse(armazem.getItem(chave) ?? "[]") as unknown;
      if (!Array.isArray(lido)) return [];
      return lido.filter((i): i is ItemDaFila => !!i && typeof i === "object" && typeof i.conversaId === "string" && typeof i.idEnvio === "string"
        && typeof i.texto === "string" && Array.isArray(i.anexos) && typeof i.em === "number" && agora() - i.em < VALIDADE_MS);
    } catch {
      return [];
    }
  }
  function gravar(itens: ItemDaFila[]): void {
    if (!armazem) return;
    try {
      if (itens.length === 0) armazem.removeItem(chave);
      else armazem.setItem(chave, JSON.stringify(itens.slice(-TETO_ITENS)));
    } catch { /* armazenamento cheio ou bloqueado: a fala continua pendente na tela, só não sobrevive a recarregar */ }
  }
  return {
    listar: ler,
    guardar(item: ItemDaFila): void {
      gravar([...ler().filter((i) => i.idEnvio !== item.idEnvio), item]);
    },
    tirar(idEnvio: string): void {
      const antes = ler();
      const depois = antes.filter((i) => i.idEnvio !== idEnvio);
      if (depois.length !== antes.length) gravar(depois);
    },
    daConversa: (conversaId: string) => ler().filter((i) => i.conversaId === conversaId),
  };
}
export type FilaOffline = ReturnType<typeof criarFilaOffline>;
