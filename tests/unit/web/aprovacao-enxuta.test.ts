import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aprovacoesAbertasDaConversa, PLACEHOLDER_COM_APROVACAO, placeholderComAprovacao } from "../../../web/lib/recusa-da-aprovacao.ts";
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

  // revisto em 2026-11-20 (ADR-191): "A Vera espera você", com o que ela pede quando o cartão diz.
  it("um pedido fora: o nome do bot e leva ao cartão", () => {
    const html = pilulaDosPedidos({ decisaoId: "d1", nome: "Vera", total: 1, posicao: "acima" });
    expect(html).toContain("A Vera espera você");
    expect(html).toContain('data-act="ver-decisao"');
    expect(html).toContain('data-id="d1"');
  });

  it("vários: a contagem", () => {
    expect(pilulaDosPedidos({ decisaoId: "d1", nome: "Vera", total: 3, posicao: "abaixo" })).toContain("3 pedidos esperam você");
  });
});

describe("mensagem com aprovação aberta", () => {
  const item = (id: string, conversaId: string, tipo = "aprovacao", estadoColuna = "aguardando") => ({ decisao: { id, conversaId, tipo }, estadoColuna, itensAprovacao: [{ id: `${id}-i` }] });

  it("acha só as aprovações abertas desta conversa", () => {
    const itens = [item("a", "c1"), item("b", "c2"), item("c", "c1", "pergunta"), item("d", "c1", "aprovacao", "vencido"), item("e", "c1")];
    expect(aprovacoesAbertasDaConversa(itens, "c1").map((i) => i.decisao.id)).toEqual(["a", "e"]);
  });

  it("o campo diz o que mandar mensagem faz", () => {
    expect(PLACEHOLDER_COM_APROVACAO).toBe("Ou diga o que fazer em vez disso");
  });

  it("com o navegador aberto ao lado, o curto (a conversa estreita cortava o completo); fechado, o completo", () => {
    expect(placeholderComAprovacao(false)).toBe("Ou diga o que fazer em vez disso");
    expect(placeholderComAprovacao(true)).toBe("Ou diga o que fazer");
  });
});

describe("o pedido substituído pela mensagem nova", () => {
  it("o encolhido diz 'Sem resposta', com a seta neutra, não 'Negado'", async () => {
    const { dadosDoEncolhido, renderCartaoEncolhido } = await import("../../../web/telas/cartao-encolhido.ts");
    const { estadoInicial } = await import("../../../web/estado/reducer.ts");
    const pessoa = { autor_tipo: "pessoa", autor_id: "p", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 } as const;
    const m = { tenantId: "t", id: "r1", conversaId: "c1", turnoId: "t1", autoria: pessoa, kind: "resultado_aprovacao", texto: "sem resposta", confianca: "confiavel", parcial: false, criadoEm: Date.parse("2026-11-16T19:30:00Z"), destino: "chat",
      payload: { kind: "resultado_aprovacao", decisaoId: "d1", frase: "Frida quer rodar um comando no seu Mac", itens: [{ idx: 0, desfecho: "retirado_pela_pessoa", texto: "mkdir x" }], substituida: true } } as never;
    const e = { ...estadoInicial, sessao: { pessoaId: "p" } } as never;
    const d = dadosDoEncolhido(m, e);
    expect(d).toMatchObject({ resultado: "Sem resposta", marca: "sem-resposta" });
    const html = renderCartaoEncolhido(d!, "r1");
    expect(html).toContain("cp-sem-resposta");
    expect(html).not.toContain("Negado");
  });
});

describe("o recibo do pedido decidido", () => {
  it("fica 10 px abaixo do balão, sem margem negativa entrando nele", () => {
    const c = readFileSync(new URL("../../../web/casca.css", import.meta.url), "utf8");
    expect(c).toContain(".timeline .cp-linha.cartao-encolhido, .timeline .cp-linha.cartao-encolhido.cp-com-extra { margin: 10px 0 0; }");
  });
});
