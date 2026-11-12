import { describe, expect, it } from "vitest";
import { arquivoDaCaptura, ehJanelaQuickChat, fraseDaCaptura, htmlBotaoCapturar, htmlTopoQuickChat } from "../../../web/lib/quick-chat.ts";
import { botDaUrl, ehJanelaAvatar, htmlAvatarDaMesa } from "../../../web/lib/quick-chat.ts";

describe("Quick Chat na web (ADR-173)", () => {
  it("o modo compacto liga só com ?janela=quick-chat", () => {
    expect(ehJanelaQuickChat("?janela=quick-chat")).toBe(true);
    expect(ehJanelaQuickChat("?janela=outra")).toBe(false);
    expect(ehJanelaQuickChat("")).toBe(false);
  });

  it("o topo mostra o bot aberto, a lista e os botões ⤢ e ✕; escapa nomes", () => {
    const html = htmlTopoQuickChat([{ id: "a", nome: "Ada", conversaId: "c1" }, { id: "b", nome: "<Chico>", conversaId: "c2" }], "a");
    expect(html).toContain('<span class="qc-bot-nome">Ada</span>');
    expect(html).toContain('<option value="a" selected>Ada</option>');
    expect(html).toContain("&lt;Chico&gt;");
    expect(html).toContain('data-act="quick-expandir"');
    expect(html).toContain('data-act="quick-fechar"');
    expect(htmlTopoQuickChat([], null)).toContain("Escolha um bot");
  });

  it("a captura vira um File de imagem; o teto vira frase; cancelar não diz nada", async () => {
    const f = arquivoDaCaptura({ nome: "captura.png", mime: "image/png", base64: Buffer.from("png").toString("base64"), largura: 1, altura: 1 });
    expect(f?.name).toBe("captura.png");
    expect(f?.type).toBe("image/png");
    expect(await f?.text()).toBe("png");
    expect(arquivoDaCaptura(null)).toBeNull();
    expect(arquivoDaCaptura({ erro: "grande_demais" })).toBeNull();
    expect(fraseDaCaptura({ erro: "grande_demais" })).toContain("10 MB");
    expect(fraseDaCaptura(null)).toBeNull();
    expect(htmlBotaoCapturar()).toContain('data-act="capturar-tela"');
  });
});


describe("avatar da mesa na web (ADR-173)", () => {
  const ID = "0b9c6a8e-3f1d-4c7e-9a2b-5d6e7f8a9b0c";
  it("lê o modo e o bot da URL; recusa id que não é uuid", () => {
    expect(ehJanelaAvatar(`?janela=avatar&bot=${ID}`)).toBe(true);
    expect(botDaUrl(`?janela=avatar&bot=${ID}`)).toBe(ID);
    expect(botDaUrl("?bot=../../x")).toBeNull();
  });

  it("o avatar abre o Quick Chat no bot e tem o × para tirar; o topo oferece montar", () => {
    const html = htmlAvatarDaMesa({ id: ID, nome: "Ada" }, "<i></i>");
    expect(html).toContain('data-act="avatar-abrir"');
    expect(html).toContain('data-act="avatar-tirar"');
    const topo = htmlTopoQuickChat([{ id: ID, nome: "Ada", conversaId: "c" }], ID, { pode: true, montado: false });
    expect(topo).toContain('data-act="quick-montar"');
    expect(htmlTopoQuickChat([{ id: ID, nome: "Ada", conversaId: "c" }], ID, { pode: true, montado: true })).toContain('data-act="quick-desmontar"');
    expect(htmlTopoQuickChat([{ id: ID, nome: "Ada", conversaId: "c" }], ID)).not.toContain("quick-montar");
  });
});
