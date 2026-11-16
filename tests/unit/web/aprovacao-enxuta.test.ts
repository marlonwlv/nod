import { describe, expect, it } from "vitest";
import { aprovacoesAbertasDaConversa, PLACEHOLDER_COM_APROVACAO } from "../../../web/lib/recusa-da-aprovacao.ts";
import { pilulaDosPedidos } from "../../../web/lib/rolagem.ts";
import { comandoEmUmaLinha, porqueCurto } from "../../../web/telas/sua-vez.ts";

/**
 * Item 10 dos acessos devolvidos, rodada 2 (2026-11-16): o cartão de aprovação do terminal fica enxuto, a pílula dos
 * pedidos só aparece com o cartão fora da tela, e mandar mensagem com aprovação aberta a recusa (o bot lê na hora).
 */
describe("o comando no cartão", () => {
  it("curto: uma linha, sem 'Ver o comando'", () => {
    const html = comandoEmUmaLinha("rm -r /tmp/teste");
    expect(html).toContain('class="ap-comando ap-uma-linha"');
    expect(html).toContain("rm -r /tmp/teste");
    expect(html).not.toContain("Ver o comando");
  });

  it("longo ou com várias linhas: a primeira linha à vista e o inteiro atrás de 'Ver o comando'", () => {
    const html = comandoEmUmaLinha("cd /repo &&\nnpm test -- --run tests/unit/muito/longo.test.ts");
    expect(html).toContain("<details");
    expect(html).toContain("Ver o comando");
    expect(html).toMatch(/<summary><code class="ap-comando ap-uma-linha">cd \/repo &amp;&amp;<\/code>/);
    expect(html).toContain("npm test -- --run");
  });

  it("escapa o comando", () => {
    expect(comandoEmUmaLinha('echo "<b>"')).toContain("echo &quot;&lt;b&gt;&quot;");
  });
});

describe("o porquê curto", () => {
  it("no arriscado, só o risco; a frase inteira no title", () => {
    const html = porqueCurto({ motivoManual: "acao_arriscada", justificativa: "apaga pastas inteiras", origemSensivel: false });
    expect(html).toContain("<span>Apaga pastas inteiras.</span>");
    expect(html).toContain('title="Parou para você: apaga pastas inteiras. Na aprovação automática, o arriscado sempre pergunta."');
  });

  it("outro motivo: a frase de sempre", () => {
    const html = porqueCurto({ motivoManual: "gate_de_rotina", justificativa: null, origemSensivel: false });
    expect(html).toContain("a rotina de onde isto veio pede a sua aprovação");
  });
});

describe("a pílula dos pedidos fora da tela", () => {
  it("nada sem pedido ou com um cartão à vista", () => {
    expect(pilulaDosPedidos(null)).toBe("");
    expect(pilulaDosPedidos({ decisaoId: "", nome: "", total: 2, posicao: "visivel" })).toBe("");
  });

  it("um pedido fora: o nome do bot e leva ao cartão", () => {
    const html = pilulaDosPedidos({ decisaoId: "d1", nome: "Vera", total: 1, posicao: "acima" });
    expect(html).toContain("Vera precisa de você");
    expect(html).toContain('data-act="ver-decisao"');
    expect(html).toContain('data-id="d1"');
  });

  it("vários: a contagem", () => {
    expect(pilulaDosPedidos({ decisaoId: "d1", nome: "Vera", total: 3, posicao: "abaixo" })).toContain("3 pedidos precisam de você");
  });
});

describe("mensagem com aprovação aberta", () => {
  const item = (id: string, conversaId: string, tipo = "aprovacao", estadoColuna = "aguardando") => ({ decisao: { id, conversaId, tipo }, estadoColuna, itensAprovacao: [{ id: `${id}-i` }] });

  it("recusa só as aprovações abertas desta conversa", () => {
    const itens = [item("a", "c1"), item("b", "c2"), item("c", "c1", "pergunta"), item("d", "c1", "aprovacao", "vencido"), item("e", "c1")];
    expect(aprovacoesAbertasDaConversa(itens, "c1").map((i) => i.decisao.id)).toEqual(["a", "e"]);
  });

  it("o campo diz o que mandar mensagem faz", () => {
    expect(PLACEHOLDER_COM_APROVACAO).toBe("Ou diga o que fazer em vez disso");
  });
});
