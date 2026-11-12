import { describe, expect, it } from "vitest";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import type { Rascunho } from "../../../src/contracts/item-aprovacao.ts";
import { estadoInicial } from "../../../web/estado/reducer.ts";
import { atalhoEnviarTodos, ehDecisaoDeRascunhos, renderBarraRascunhos, renderDecisaoDeRascunhos } from "../../../web/telas/rascunhos-de-envio.ts";
import { renderDecisoesDaConversa } from "../../../web/telas/sua-vez.ts";

type Item = SuaVezDto["itens"][number];
type ItemAp = Item["itensAprovacao"][number];
const CONVERSA = "c1";

const rascunho = (p: Partial<Rascunho> = {}): Rascunho => ({ canal: "email", rotulo: "E-mail · Gmail", para: ["mateus@lipe.com.br"], assunto: "Re: LGPD", corpo: "Oi, <Mateus>!", editavel: true, ...p });
const itemAp = (decisaoId: string, idx: number, r: Rascunho | undefined, selecionado = true): ItemAp => ({
  tenantId: "t1" as ItemAp["tenantId"], id: `${decisaoId}:item:${idx}`, decisaoId, idx, textoOriginal: r?.corpo ?? "x", textoFinal: r?.corpo ?? "x",
  destino: { conector: "gmail", ferramenta: "send_email", argumentos: {} }, selecionado, origemSensivel: false, justificativa: null,
  marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: "regra_padrao" as ItemAp["motivoManual"], ...(r ? { rascunho: r } : {}),
});
function decisao(id: string, itens: ItemAp[], estadoColuna: Item["estadoColuna"] = "pendente"): Item {
  return {
    decisao: { tenantId: "t1", id, ownerId: "p1", decisorId: "p1", agenteId: "a1", conversaId: CONVERSA, turnoId: "t-1", tipo: "aprovacao", estado: "pendente", prazoDecisaoEm: new Date(Date.now() + 86_400_000).toISOString(), prazoExecucaoEm: null, frase: "Clarice quer usar Gmail", desfecho: null, vistaEm: null, criadoEm: new Date().toISOString(), fioId: null } as Item["decisao"],
    estadoColuna, agenteNome: "Clarice", aguardandoHaMs: 1000, recusaAutomaticaEmMs: 86_400_000, gemeas: [], itensAprovacao: itens, proposta: null, fio: null, rotinaParada: null,
  } as Item;
}
const comFila = (itens: Item[]) => ({ ...estadoInicial, suaVez: { itens, incidentes: [], foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null } });

describe("rascunhos de envio na conversa (ADR-173)", () => {
  it("só vira rascunho a aprovação aberta em que TODO item é mensagem que sai", () => {
    expect(ehDecisaoDeRascunhos(decisao("d1", [itemAp("d1", 0, rascunho())]))).toBe(true);
    expect(ehDecisaoDeRascunhos(decisao("d1", [itemAp("d1", 0, rascunho()), itemAp("d1", 1, undefined)]))).toBe(false);
    expect(ehDecisaoDeRascunhos(decisao("d1", [itemAp("d1", 0, rascunho())], "vencido"))).toBe(false);
  });

  it("um rascunho: cabeçalho, Para, Assunto, corpo escapado e editável, Descartar/Enviar da própria decisão", () => {
    const html = renderDecisaoDeRascunhos(decisao("d1", [itemAp("d1", 0, rascunho())]));
    expect(html).toContain("E-mail · Gmail");
    expect(html).toContain("mateus@lipe.com.br");
    expect(html).toContain("Re: LGPD");
    expect(html).toContain('textarea class="re-corpo texto-final" data-item-texto="d1:item:0"');
    expect(html).toContain("Oi, &lt;Mateus&gt;!");
    expect(html).not.toContain("<Mateus>");
    expect(html).toContain('data-act="decidir-aprovacao"');
    expect(html).toContain('data-act="decidir-aprovacao-nenhum"');
    expect(html).toContain('data-item="d1:item:0" checked');
  });

  it("corpo não editável vira texto fixo, sem caixa", () => {
    const html = renderDecisaoDeRascunhos(decisao("d1", [itemAp("d1", 0, rascunho({ editavel: false }))]));
    expect(html).not.toContain("<textarea");
    expect(html).toContain("re-corpo-fixo");
  });

  it("vários na mesma decisão: cada um só se descarta; o envio é pela barra", () => {
    const html = renderDecisaoDeRascunhos(decisao("d1", [itemAp("d1", 0, rascunho()), itemAp("d1", 1, rascunho({ canal: "slack", rotulo: "Mensagem · Slack", assunto: undefined }), false)]));
    expect(html.match(/data-act="rascunho-alternar"/g)).toHaveLength(2);
    expect(html).not.toContain('data-act="decidir-aprovacao"');
    expect(html).toContain("re-descartado");
    expect(html).toContain("Desfazer");
  });

  it("a conversa desenha os rascunhos no lugar do cartão de aprovação", () => {
    const html = renderDecisoesDaConversa(comFila([decisao("d1", [itemAp("d1", 0, rascunho())])]), CONVERSA, new Set());
    expect(html).toContain("re-decisao");
    expect(html).not.toContain("precisa do seu ok");
  });

  it("a barra aparece com dois ou mais rascunhos na conversa e leva as decisões", () => {
    expect(renderBarraRascunhos(comFila([decisao("d1", [itemAp("d1", 0, rascunho())])]), CONVERSA)).toBe("");
    const html = renderBarraRascunhos(comFila([decisao("d1", [itemAp("d1", 0, rascunho()), itemAp("d1", 1, rascunho())]), decisao("d2", [itemAp("d2", 0, rascunho())])]), CONVERSA);
    expect(html).toContain("3 rascunhos prontos");
    expect(html).toContain('data-decisoes="d1,d2"');
    expect(html).toContain("Descartar todos");
    expect(html).toContain("Enviar todos");
    expect(html).toContain("⌘↵");
  });

  it("⌘↵ só vale com a barra e o foco num rascunho ou no campo vazio; Ctrl+↵ fora do Mac", () => {
    const t = { key: "Enter", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false };
    expect(atalhoEnviarTodos(t, { noMac: true, temBarra: true, foco: "rascunho" })).toBe(true);
    expect(atalhoEnviarTodos(t, { noMac: true, temBarra: true, foco: "campo-vazio" })).toBe(true);
    expect(atalhoEnviarTodos(t, { noMac: true, temBarra: true, foco: "campo-com-texto" })).toBe(false);
    expect(atalhoEnviarTodos(t, { noMac: true, temBarra: false, foco: "rascunho" })).toBe(false);
    expect(atalhoEnviarTodos({ ...t, isComposing: true }, { noMac: true, temBarra: true, foco: "rascunho" })).toBe(false);
    expect(atalhoEnviarTodos(t, { noMac: false, temBarra: true, foco: "rascunho" })).toBe(false);
    expect(atalhoEnviarTodos({ ...t, metaKey: false, ctrlKey: true }, { noMac: false, temBarra: true, foco: "rascunho" })).toBe(true);
  });
});
