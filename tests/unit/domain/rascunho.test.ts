import { describe, expect, it } from "vitest";
import { argumentosComTextoFinal } from "../../../src/domain/aprovacao-desfecho.ts";
import { rascunhoDoItem } from "../../../src/domain/rascunho.ts";

const item = (conector: string, ferramenta: string, argumentos: Record<string, unknown>, texto: string, textoFinal = texto) =>
  ({ textoOriginal: texto, textoFinal, destino: { conector, ferramenta, argumentos } });

describe("rascunhoDoItem (ADR-173)", () => {
  it("e-mail do Gmail: cabeçalho, Para, Assunto e o corpo editável quando o corpo é o texto do item", () => {
    const corpo = "Oi, Mateus! Respondi as 12 perguntas.";
    const r = rascunhoDoItem(item("gmail", "GMAIL_SEND_EMAIL", { recipient_email: "mateus@lipe.com.br", subject: "Re: Formulário de LGPD", body: corpo }, corpo), "Gmail");
    expect(r).toEqual({ canal: "email", rotulo: "E-mail · Gmail", para: ["mateus@lipe.com.br"], assunto: "Re: Formulário de LGPD", corpo, editavel: true });
  });

  it("a edição da pessoa (textoFinal) aparece no corpo e chega ao argumento pela regra de sempre", () => {
    const i = item("gmail", "send_email", { to: "a@x.co", body: "Oi" }, "Oi", "Oi, tudo bem?");
    expect(rascunhoDoItem(i, "Gmail")?.corpo).toBe("Oi, tudo bem?");
    expect(argumentosComTextoFinal(i).body).toBe("Oi, tudo bem?");
  });

  it("corpo diferente do texto do item: aparece como vai, sem edição", () => {
    const r = rascunhoDoItem(item("gmail", "send_email", { to: "a@x.co", body: "Corpo real" }, "Enviar e-mail para a@x.co"), "Gmail");
    expect(r?.editavel).toBe(false);
    expect(r?.corpo).toBe("Corpo real");
  });

  it("Slack: canal no Para e o cabeçalho 'Mensagem · Slack'", () => {
    const r = rascunhoDoItem(item("slack", "SLACK_CHAT_POST_MESSAGE", { channel: "#produto", text: "Formulário respondido." }, "Formulário respondido."), "Slack");
    expect(r).toMatchObject({ canal: "slack", rotulo: "Mensagem · Slack", para: ["#produto"], editavel: true });
    expect(r?.assunto).toBeUndefined();
  });

  it("iMessage e SMS pelo nome do app ou da ferramenta", () => {
    expect(rascunhoDoItem(item("imessage", "enviar_mensagem", { para: "+55 11 90000-0000", texto: "Chego às 8" }, "Chego às 8"), "iMessage")?.rotulo).toBe("iMessage");
    expect(rascunhoDoItem(item("telefone", "send_sms", { phone_number: "+5511900000000", message: "ok" }, "ok"), "Telefone")?.canal).toBe("sms");
  });

  it("cópia e cópia oculta entram no Para com o prefixo (nada de fora fica escondido)", () => {
    const r = rascunhoDoItem(item("gmail", "send_email", { to: ["a@x.co"], cc: "b@x.co", bcc: ["c@fora.co"], body: "x" }, "x"), "Gmail");
    expect(r?.para).toEqual(["a@x.co", "Cc b@x.co", "Cco c@fora.co"]);
  });

  it("não é rascunho: sem verbo de envio, criar rascunho no app, sem corpo, sem canal, terminal e computador", () => {
    expect(rascunhoDoItem(item("gmail", "GMAIL_FETCH_EMAILS", { query: "x" }, "x"), "Gmail")).toBeNull();
    expect(rascunhoDoItem(item("gmail", "GMAIL_CREATE_EMAIL_DRAFT", { to: "a@x.co", body: "x" }, "x"), "Gmail")).toBeNull();
    expect(rascunhoDoItem(item("gmail", "send_email", { to: "a@x.co", attachment: "f.pdf" }, "x"), "Gmail")).toBeNull();
    expect(rascunhoDoItem(item("linear", "create_comment", { body: "x" }, "x"), "Linear")).toBeNull();
    expect(rascunhoDoItem(item("github", "send_review", { body: "x" }, "x"), "GitHub")).toBeNull();
    expect(rascunhoDoItem(item("terminal", "send_email", { body: "x" }, "x"), "Terminal")).toBeNull();
  });

  it("tira invisíveis do Para e do Assunto (dado não confiável)", () => {
    const r = rascunhoDoItem(item("gmail", "send_email", { to: "a@x.co‮", subject: "Oi​ lá", body: "x" }, "x"), "Gmail");
    expect(r?.para).toEqual(["a@x.co"]);
    expect(r?.assunto).toBe("Oi lá");
  });
});
