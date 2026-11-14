import { fireEvent, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import type { AcoesDoCartaoIa } from "../../../../../web/react/onboarding/cartao-ia.tsx";
import type { DadosDaAcao, Executar } from "../../../../../web/react/onboarding/tipos.ts";

/**
 * ADR-179 (fase 5): o que os testes das telas do onboarding em React repetem. `desenhar` monta o componente com as ações
 * espiãs; `cliques` aperta cada botão ligado e devolve o que chegou ao controlador — o lugar do antigo
 * `data-act="…" data-ia="…"` no HTML.
 */
export type Clique = { acao: string; dados: DadosDaAcao; rotulo: string };
export type Acoes = { executar: Executar; copiar: (t: string) => Promise<boolean>; cartao: AcoesDoCartaoIa };

export function desenhar(no: (a: Acoes) => ReactElement) {
  const executar = vi.fn<Executar>();
  const copiar = vi.fn(async () => true);
  const cartao = { agir: vi.fn<AcoesDoCartaoIa["agir"]>(), digitarCodigo: vi.fn(), colarCodigo: vi.fn(), copiar };
  const r = render(no({ executar, copiar, cartao }));
  const cliques = (): Clique[] => {
    const lista: Clique[] = [];
    for (const b of [...r.container.querySelectorAll<HTMLButtonElement>("button:not([disabled])")]) {
      executar.mockClear();
      cartao.agir.mockClear();
      const rotulo = (b.textContent ?? "").trim();
      fireEvent.click(b);
      for (const [acao, dados] of executar.mock.calls) lista.push({ acao, dados: dados ?? {}, rotulo });
      for (const [acao, ia, extra] of cartao.agir.mock.calls) lista.push({ acao, dados: { ia, ...(extra ?? {}) } as unknown as DadosDaAcao, rotulo });
    }
    return lista;
  };
  return { ...r, html: r.container.innerHTML, executar, copiar, cartao, cliques };
}
