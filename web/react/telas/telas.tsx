import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Estado } from "../../estado/reducer.ts";
import type { Loja } from "../loja.ts";
import { MARCA_REGIAO } from "../regioes.tsx";
import { TelaNaoLidos, type AcoesDeNaoLidos } from "./nao-lidos.tsx";

/**
 * ADR-179 (as telas no lugar da conversa): a tela que ocupa a região `#timeline` no lugar da conversa, em React. O main
 * escreve na região só a vaga da tela (`vagaDaTela`), e a tela monta nela um root próprio, que fica enquanto a vaga
 * fica (o mesmo HTML não regrava a região). Trocar de tela desmonta o root ANTES de a região ser regravada: um root
 * cujo nó saiu do documento sem `unmount` segue vivo, assinando a loja.
 *
 * As telas migradas até aqui: Não lidos. As outras seguem pelo desenho por string (o `corpo` de sempre).
 */
export type TelaNoReact = "nao-lidos";
export interface AcoesDasTelas { naoLidos: AcoesDeNaoLidos }

const CLASSE = "rx-tela";
/** O HTML que o main põe na região no lugar do desenho por string da tela. */
export const vagaDaTela = (tela: TelaNoReact): string => `<div class="${CLASSE}" data-rx-tela="${tela}"></div>`;

export interface TelasNoReact {
  /** Depois de a região ser escrita: monta a tela na vaga (no-op se já montada nela) ou desmonta, sem vaga. */
  sincronizar: (regiao: HTMLElement | null) => void;
  /** Antes de a região ser regravada com outro HTML: desmonta, se a vaga vai sair. */
  antesDeRegravar: (html: string) => void;
  montada: () => TelaNoReact | null;
}

export function criarTelasNoReact(loja: Loja<Estado>, acoes: AcoesDasTelas): TelasNoReact {
  let atual: { tela: TelaNoReact; vaga: HTMLElement; raiz: Root } | null = null;
  const desmontar = (): void => {
    if (!atual) return;
    atual.raiz.unmount();
    atual.vaga.removeAttribute(MARCA_REGIAO);
    atual = null;
  };
  return {
    sincronizar(regiao) {
      const vaga = regiao?.querySelector<HTMLElement>(`:scope > .${CLASSE}[data-rx-tela]`) ?? null;
      const tela = (vaga?.dataset["rxTela"] ?? null) as TelaNoReact | null;
      if (atual && (atual.vaga !== vaga || atual.tela !== tela)) desmontar();
      if (!vaga || !tela || atual) return;
      vaga.setAttribute(MARCA_REGIAO, `tela-${tela}`);
      const raiz = createRoot(vaga, { identifierPrefix: `tela-${tela}-` });
      atual = { tela, vaga, raiz };
      raiz.render(<StrictMode>{tela === "nao-lidos" ? <TelaNaoLidos loja={loja} acoes={acoes.naoLidos} /> : null}</StrictMode>);
    },
    antesDeRegravar(html) {
      if (atual && !html.includes(vagaDaTela(atual.tela))) desmontar();
    },
    montada: () => atual?.tela ?? null,
  };
}
