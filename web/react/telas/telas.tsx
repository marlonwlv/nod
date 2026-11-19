import { StrictMode, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { Estado } from "../../estado/reducer.ts";
import type { Loja } from "../loja.ts";
import { MARCA_REGIAO } from "../regioes.tsx";
import { TelaNaoLidos, type AcoesDeNaoLidos } from "./nao-lidos.tsx";
import { TelaRotinas, type AcoesDeRotinas } from "./rotinas.tsx";
import { TelaNovoBot, type AcoesDoNovoBot } from "./novo-bot.tsx";
import { TelaTarefasDeTodos, type AcoesDasTarefas } from "./tarefas-de-todos.tsx";
import { TelaTarefas, type AcoesDasTarefasDosBots } from "./tarefas.tsx";
import { TelaNovaRotina, type AcoesDaNovaRotina } from "./nova-rotina.tsx";
import { TelaNovaSala, type AcoesDaNovaSala } from "./nova-sala.tsx";
import { TelaSuaVez, type AcoesDeSuaVez } from "./sua-vez.tsx";

/**
 * ADR-179 (as telas no lugar da conversa): a tela que ocupa a região `#timeline` no lugar da conversa, em React. O main
 * escreve na região só a vaga da tela (`vagaDaTela`), e a tela monta nela um root próprio, que fica enquanto a vaga
 * fica (o mesmo HTML não regrava a região). Trocar de tela desmonta o root ANTES de a região ser regravada: um root
 * cujo nó saiu do documento sem `unmount` segue vivo, assinando a loja.
 *
 * O 1º desenho de cada tela é síncrono (`flushSync`): o foco que o main põe no fim do render (o campo da nova conversa,
 * a linha de Não lidos) acha os nós já no documento.
 *
 * As telas migradas até aqui: Sua vez, Não lidos, Rotinas, Nova rotina, a nova conversa (Novo bot), o novo chat em grupo
 * (Nova sala), Tarefas de todos (Cards) e Tarefas (`trabalhos`). As outras seguem pelo desenho por string.
 */
export type TelaNoReact = "nao-lidos" | "rotinas" | "novo-bot" | "tarefas" | "trabalhos" | "nova-rotina" | "nova-sala" | "sua-vez";
export interface AcoesDasTelas { naoLidos: AcoesDeNaoLidos; rotinas: AcoesDeRotinas; novoBot: AcoesDoNovoBot; tarefas: AcoesDasTarefas; trabalhos: AcoesDasTarefasDosBots; novaRotina: AcoesDaNovaRotina; novaSala: AcoesDaNovaSala; suaVez: AcoesDeSuaVez }

const CLASSE = "rx-tela";
/** A classe do casco que o CSS da tela lê (`.timeline-wrap:has(> .tdt-casco)`), na própria vaga. */
const CASCO: Partial<Record<TelaNoReact, string>> = { tarefas: "tdt-casco" };
/** O HTML que o main põe na região no lugar do desenho por string da tela. */
export const vagaDaTela = (tela: TelaNoReact): string => `<div class="${CLASSE}${CASCO[tela] ? ` ${CASCO[tela]}` : ""}" data-rx-tela="${tela}"></div>`;

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
      const conteudo: ReactNode = tela === "nao-lidos" ? <TelaNaoLidos loja={loja} acoes={acoes.naoLidos} />
        : tela === "rotinas" ? <TelaRotinas loja={loja} acoes={acoes.rotinas} />
          : tela === "novo-bot" ? <TelaNovoBot loja={loja} acoes={acoes.novoBot} />
            : tela === "tarefas" ? <TelaTarefasDeTodos acoes={acoes.tarefas} />
              : tela === "trabalhos" ? <TelaTarefas loja={loja} acoes={acoes.trabalhos} />
                : tela === "nova-rotina" ? <TelaNovaRotina loja={loja} acoes={acoes.novaRotina} />
                  : tela === "nova-sala" ? <TelaNovaSala loja={loja} acoes={acoes.novaSala} />
                    : <TelaSuaVez loja={loja} acoes={acoes.suaVez} />;
      flushSync(() => raiz.render(<StrictMode>{conteudo}</StrictMode>));
    },
    antesDeRegravar(html) {
      if (atual && !html.includes(vagaDaTela(atual.tela))) desmontar();
    },
    montada: () => atual?.tela ?? null,
  };
}
