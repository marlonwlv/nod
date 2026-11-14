import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { trilhaDaColuna } from "../../lib/quadro.ts";
import { confiar, partesDaColuna, partesDoCard, type Card, type Coluna, type ExtraDaGrade, type Html } from "../../telas/quadro.ts";
import type { DesenharGrade } from "../../telas/quadro-real.ts";
import { MARCA_REGIAO } from "../regioes.tsx";
import type { DadosDoCard } from "./card-da-grade.tsx";
import { GradeDoQuadro, type AcoesDaGrade, type ItemDaGrade, type PropsDaGrade } from "./grade-do-quadro.tsx";

/**
 * ADR-180 (fase 2 do React): a ponte entre o quadro-na-tela (que regrava `.qd-conteudo` inteira a cada desenho) e a grade
 * em React. O desenho por string deixa uma vaga (`.rx-qd-vaga`) no lugar da grade; `encaixar` põe ali o MESMO nó do
 * React de sempre (um createRoot só, criado no 1º desenho) e redesenha com as props novas, síncrono (flushSync), para a
 * rolagem e o foco que o quadro-na-tela restaura logo depois acharem os nós. O arrasto, o menu aberto e os cards que não
 * mudaram sobrevivem ao frame: o React só troca o que mudou.
 */
export interface GradeNaTela {
  desenhar: DesenharGrade;
  encaixar: (conteudo: HTMLElement) => void;
  arrastando: () => boolean;
  desmontar: () => void;
}

const VAGA = "rx-qd-vaga";

export function dadosDoCard(c: Card): DadosDoCard {
  const p = partesDoCard(c);
  return { id: c.id, titulo: c.titulo, classe: p.classe, corpo: p.corpo, arrastavel: !!c.arrastavel, ...(c.priAberta && c.menu ? { menu: c.menu } : {}) };
}

/** As colunas e os extras (o "+", a coluna nova) na ordem e com as trilhas do `quadro()` por string. */
export function itensDaGrade(colunas: readonly Coluna[], extras: readonly ExtraDaGrade[]): { itens: ItemDaGrade[]; trilhas: string } {
  const itens: { item: ItemDaGrade; trilha: string }[] = colunas.map((c) => ({
    item: { tipo: "coluna", coluna: { partes: partesDaColuna(c), antes: c.antesDosCards ?? [], cards: (c.cartoes ?? []).map(dadosDoCard) } },
    trilha: trilhaDaColuna(c),
  }));
  [...extras].reverse().forEach((x, i) => itens.splice(Math.min(x.em ?? itens.length, itens.length), 0, { item: { tipo: "extra", chave: `extra-${extras.length - 1 - i}`, html: x.html }, trilha: x.trilha }));
  return { itens: itens.map((x) => x.item), trilhas: itens.map((x) => x.trilha).join(" ") };
}

export function criarGradeNaTela(doc: Document, acoes: AcoesDaGrade): GradeNaTela {
  let host: HTMLElement | null = null;
  let raiz: Root | null = null;
  let props: PropsDaGrade | null = null;
  let arrastando = false;
  const estaveis: AcoesDaGrade = { ...acoes, arrastando: (a) => { arrastando = a; acoes.arrastando(a); } };
  return {
    desenhar(o): Html {
      const { itens, trilhas } = itensDaGrade(o.colunas, o.extras);
      props = { rotulo: o.rotulo, classe: o.classe, trilhas, itens, acoes: estaveis };
      return confiar(`<div class="${VAGA}"></div>`);
    },
    encaixar(conteudo) {
      const vaga = conteudo.querySelector(`.${VAGA}`);
      if (!vaga || !props) return;
      if (!host || !raiz) {
        host = doc.createElement("div");
        host.className = "rx-qd-grade";
        host.setAttribute(MARCA_REGIAO, "quadro-grade");
        raiz = createRoot(host, { identifierPrefix: "quadro-" });
      }
      vaga.replaceWith(host);
      const p = props;
      const r = raiz;
      flushSync(() => r.render(<StrictMode><GradeDoQuadro {...p} /></StrictMode>));
    },
    arrastando: () => arrastando,
    desmontar() {
      raiz?.unmount();
      host?.remove();
      raiz = null;
      host = null;
      arrastando = false;
    },
  };
}
