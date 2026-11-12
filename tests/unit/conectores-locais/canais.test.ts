import { describe, expect, it } from "vitest";
import { criarDriverCanaisTeste } from "../../../src/adapters/conectores-locais/canais/driver-teste.ts";
import { criarServidorCanais, driverDoAmbiente } from "../../../src/adapters/conectores-locais/canais/servidor.ts";
import { validarArgsCanais } from "../../../src/domain/canais.ts";
import { rascunhoDoItem } from "../../../src/domain/rascunho.ts";

let seq = 0;
async function chamar(s: ReturnType<typeof criarServidorCanais>, name: string, args: Record<string, unknown> = {}) {
  const r = JSON.parse((await s.tratarLinha(JSON.stringify({ jsonrpc: "2.0", id: ++seq, method: "tools/call", params: { name, arguments: args } }))) ?? "{}").result as { content: { text: string }[]; isError?: boolean };
  return { erro: r.isError === true, texto: r.content[0]?.text ?? "" };
}

describe("conector local canais (ADR-174)", () => {
  it("e-mail próprio do bot: reivindica a caixa e envia dela; sem caixa, diz o que fazer", async () => {
    const d = criarDriverCanaisTeste();
    const s = criarServidorCanais(d);
    expect((await chamar(s, "enviar_email", { para: ["a@x.co"], assunto: "Oi", corpo: "Olá" })).texto).toContain("chame reivindicar_caixa antes");
    expect(JSON.parse((await chamar(s, "reivindicar_caixa", { nome: "Clarice" })).texto)).toEqual({ endereco: "clarice@bots.nod.test" });
    expect((await chamar(s, "enviar_email", { para: ["a@x.co"], cc: ["b@x.co"], assunto: "Oi", corpo: "Olá,\nTudo bem?" })).erro).toBe(false);
    expect(d.saida[0]).toMatchObject({ canal: "email", de: "clarice@bots.nod.test", para: ["a@x.co", "b@x.co"], texto: "Olá,\nTudo bem?" });
  });

  it("iMessage aceita telefone ou Apple ID; SMS só telefone com DDI", async () => {
    const d = criarDriverCanaisTeste();
    const s = criarServidorCanais(d);
    expect((await chamar(s, "enviar_imessage", { para: "+55 (11) 90000-0000", texto: "Chego às 8" })).erro).toBe(false);
    expect(d.saida[0]?.para).toEqual(["+5511900000000"]);
    expect((await chamar(s, "enviar_imessage", { para: "ana@icloud.com", texto: "oi" })).erro).toBe(false);
    expect((await chamar(s, "enviar_sms", { para: "ana@icloud.com", texto: "oi" })).texto).toContain("telefone com DDI");
  });

  it("validação: e-mail inválido, argumento fora do schema, caixa com caractere proibido", () => {
    expect(validarArgsCanais("enviar_email", { para: ["Ana <a@x.co>"], assunto: "x", corpo: "y" }).ok).toBe(false);
    expect(validarArgsCanais("enviar_email", { para: ["a@x.co"], assunto: "x", corpo: "y", bcc: ["z@x.co"] }).ok).toBe(false);
    expect(validarArgsCanais("reivindicar_caixa", { nome: "../root" }).ok).toBe(false);
  });

  it("o envio do conector vira rascunho na conversa, com o corpo editável (ADR-173)", () => {
    const email = { textoOriginal: "Olá", textoFinal: "Olá", destino: { conector: "canais", ferramenta: "enviar_email", argumentos: { para: ["a@x.co"], assunto: "Oi", corpo: "Olá" } } };
    expect(rascunhoDoItem(email, "Canais do bot")).toMatchObject({ canal: "email", rotulo: "E-mail · Canais do bot", para: ["a@x.co"], assunto: "Oi", editavel: true });
    const sms = { textoOriginal: "ok", textoFinal: "ok", destino: { conector: "canais", ferramenta: "enviar_sms", argumentos: { para: "+5511900000000", texto: "ok" } } };
    expect(rascunhoDoItem(sms, "Canais do bot")).toMatchObject({ canal: "sms", rotulo: "SMS", para: ["+5511900000000"] });
    const reuniao = { textoOriginal: "Oi", textoFinal: "Oi", destino: { conector: "assistente", ferramenta: "enviar_mensagem_na_reuniao", argumentos: { reuniao_id: "r1", texto: "Oi" } } };
    expect(rascunhoDoItem(reuniao, "Assistente")?.canal).toBe("chat");
  });

  it("NOD_CANAIS_REAL=1 sem provedor: catálogo vazio", async () => {
    const s = criarServidorCanais(driverDoAmbiente({ NOD_CANAIS_REAL: "1" }));
    expect(JSON.parse((await s.tratarLinha('{"jsonrpc":"2.0","id":1,"method":"tools/list"}')) ?? "{}").result.tools).toEqual([]);
  });
});
