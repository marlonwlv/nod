// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { CONVERSA_ESCONDIDA } from "../../../web/lib/rolagem.ts";
import { criarRolagem } from "../../../web/lib/rolagem-na-tela.ts";

/**
 * Tasks pontuais (2026-11-25): voltar do quadro (ou de uma página da pílula) para a conversa abria no topo. Escondida
 * (`qd-saiu`, content-visibility: hidden), a timeline perde a altura e o Chrome zera a rolagem com um evento de scroll.
 * O happy-dom não faz layout: a caixa aqui imita o Chrome (sem altura e com o topo preso a 0 enquanto escondida).
 */
const JANELA = 600;
const CONTEUDO = 20_000;
const FIM = CONTEUDO - JANELA;

type Caixa = { el: HTMLElement; escritas: number[]; rolar(topo: number): void };

function montar(): { caixa: Caixa; rolagem: ReturnType<typeof criarRolagem> } {
  document.body.innerHTML = `<div id="timeline"><div class="timeline"><p>conversa longa</p></div></div><div id="pilula"></div>`;
  const el = document.getElementById("timeline") as HTMLElement;
  let topo = 0;
  const escritas: number[] = [];
  const escondida = (): boolean => el.classList.contains(CONVERSA_ESCONDIDA);
  const altura = (): number => (escondida() ? JANELA : CONTEUDO);
  const limitar = (v: number): number => Math.max(0, Math.min(v, altura() - JANELA));
  Object.defineProperty(el, "clientHeight", { get: () => JANELA });
  Object.defineProperty(el, "scrollHeight", { get: altura });
  Object.defineProperty(el, "scrollTop", { get: () => topo, set: (v: number) => { escritas.push(v); topo = limitar(v); } });
  const caixa: Caixa = {
    el,
    escritas,
    // Como o navegador: muda o topo e avisa com o evento de rolagem.
    rolar(v: number) { topo = limitar(v); el.dispatchEvent(new Event("scroll")); },
  };
  const rolagem = criarRolagem(el, document.getElementById("pilula") as HTMLElement, () => false);
  rolagem.depoisDeDesenhar("c1", true);
  return { caixa, rolagem };
}

/** O MutationObserver avisa numa microtarefa (antes do próximo quadro, no navegador). */
const microtarefas = () => new Promise<void>((r) => setTimeout(r, 0));

/** Esconder como o quadro-na-tela: a classe entra e o Chrome zera o topo, com evento. */
async function esconder(c: Caixa): Promise<void> {
  c.el.classList.add(CONVERSA_ESCONDIDA);
  c.rolar(0);
  await microtarefas();
}

async function mostrar(c: Caixa): Promise<void> {
  c.el.classList.remove(CONVERSA_ESCONDIDA);
  await microtarefas();
}

describe("a conversa escondida sob o quadro volta onde estava", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("no fim: volta no fim, no mesmo passo em que reaparece (nunca no topo)", async () => {
    const { caixa } = montar();
    expect(caixa.el.scrollTop).toBe(FIM);
    await esconder(caixa);
    expect(caixa.el.scrollTop).toBe(0);
    await mostrar(caixa);
    expect(caixa.el.scrollTop).toBe(FIM);
  });

  it("lendo mais acima: volta ao mesmo ponto, e o topo zerado enquanto escondida não conta como a pessoa subir", async () => {
    const { caixa, rolagem } = montar();
    caixa.rolar(FIM - 3_000);
    await esconder(caixa);
    await mostrar(caixa);
    expect(caixa.el.scrollTop).toBe(FIM - 3_000);
    // Continua solta: uma resposta que chega depois não a puxa para o fim.
    rolagem.depoisDeDesenhar("c1", true);
    expect(caixa.el.scrollTop).toBe(FIM - 3_000);
  });

  it("chegou mensagem com ela escondida: nada é escrito na caixa sem altura, e a volta vai ao fim", async () => {
    const { caixa, rolagem } = montar();
    await esconder(caixa);
    const antes = caixa.escritas.length;
    rolagem.depoisDeDesenhar("c1", true);
    rolagem.colar();
    expect(caixa.escritas.length).toBe(antes);
    await mostrar(caixa);
    expect(caixa.el.scrollTop).toBe(FIM);
  });

  it("trocou de conversa com ela escondida: a outra abre no fim", async () => {
    const { caixa, rolagem } = montar();
    caixa.rolar(1_000);
    await esconder(caixa);
    rolagem.depoisDeDesenhar("c2", true);
    await mostrar(caixa);
    expect(caixa.el.scrollTop).toBe(FIM);
  });
});
