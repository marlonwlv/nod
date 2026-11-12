import type { CofreDto } from "../../src/contracts/cofre.ts";
import { TELA_COFRE_INICIAL, type TelaCofre } from "../telas/config-cofre.ts";

/** O controlador de Configurações › Cofre (Paper 07, rodada 2): lê `GET cofre` ao abrir a seção; o estado é só dela. */
export function criarTelaCofre(o: { api: () => { cofre(): Promise<CofreDto> } | null; render: () => void }) {
  let t: TelaCofre = TELA_COFRE_INICIAL;
  let pedido = 0;
  const mudar = (p: Partial<TelaCofre>) => { t = { ...t, ...p }; o.render(); };
  async function abrir(): Promise<void> {
    const api = o.api();
    if (!api) return;
    const meu = ++pedido;
    mudar({ carregando: true, erro: false });
    try {
      const r = await api.cofre();
      if (meu === pedido) mudar({ credenciais: r.credenciais, carregando: false });
    } catch {
      if (meu === pedido) mudar({ carregando: false, erro: true });
    }
  }
  return { estado: (): TelaCofre => t, abrir };
}
