import { describe, expect, it } from "vitest";
import { decidirNoNavegador, juntarLiberacoes, SEM_LIBERACOES } from "../../../src/domain/navegador-aprovacao.ts";
import { aplicarDigitacao, codigoValido, cookieServeAoHost, destinoNaPagina, dominioRegistravel, hostDoSite, itemCasaComHost, mascararUsuario, MOTIVO_SEM_MAC, ordenarOpcoes, reais, rotuloDoItem, textoDoCombinar, type Digitado } from "../../../src/domain/navegador-cofre.ts";
import type { EntradaNavegador } from "../../../src/contracts/navegador-do-bot.ts";

/** O login com os cofres e as respostas de antemão do navegador do bot (ADR-190, L e A2/A3): só regras, sem segredo. */
describe("sites, domínios e cookies", () => {
  it("o host sai do site ou do endereço; o domínio registrável conhece os sufixos de dois níveis", () => {
    expect(hostDoSite("itau.com.br")).toBe("itau.com.br");
    expect(hostDoSite("https://WWW.Itau.com.br/pf?x=1")).toBe("www.itau.com.br");
    expect(hostDoSite("Itaú")).toBe("");
    expect(hostDoSite("")).toBe("");
    expect(dominioRegistravel("internetpf.itau.com.br")).toBe("itau.com.br");
    expect(dominioRegistravel("www.flytap.com")).toBe("flytap.com");
    expect(dominioRegistravel("a.b.bbc.co.uk")).toBe("bbc.co.uk");
    expect(dominioRegistravel("10.0.0.1")).toBe("10.0.0.1");
  });
  it("o item do cofre casa pelo site, nunca por um domínio parecido", () => {
    expect(itemCasaComHost("https://www.itau.com.br/login", "internetpf.itau.com.br")).toBe(true);
    expect(itemCasaComHost("itau.com.br", "itau.com.br.evil.com")).toBe(false);
    expect(itemCasaComHost("bradesco.com.br", "itau.com.br")).toBe(false);
    expect(itemCasaComHost("", "itau.com.br")).toBe(false);
  });
  it("só os cookies do host e dos pais dele até o domínio registrável", () => {
    expect(cookieServeAoHost(".itau.com.br", "www.itau.com.br")).toBe(true);
    expect(cookieServeAoHost("www.itau.com.br", "www.itau.com.br")).toBe(true);
    expect(cookieServeAoHost(".com.br", "www.itau.com.br")).toBe(false);
    expect(cookieServeAoHost(".outro.itau.com.br", "www.itau.com.br")).toBe(false);
    expect(cookieServeAoHost(".bradesco.com.br", "www.itau.com.br")).toBe(false);
  });
});

describe("o cartão de login (L1, M4)", () => {
  it("o usuário vai mascarado no rótulo", () => {
    expect(mascararUsuario("marlon@exemplo.com")).toBe("marlon@…");
    expect(mascararUsuario("12345678900")).toBe("123…");
    expect(mascararUsuario("ana")).toBe("ana");
    expect(rotuloDoItem("Itaú", "marlon@exemplo.com")).toBe("Itaú · marlon@…");
    expect(rotuloDoItem("Itaú", "")).toBe("Itaú");
  });
  it("o que roda agora vem primeiro (1Password, nod, Bitwarden); com o Mac desligado o cofre do nod lidera", () => {
    const op = { fonte: "1password" as const, ref: "op://v/i/password", rotulo: "Itaú", disponivel: true };
    const nod = { fonte: "nod" as const, ref: "x", rotulo: "Itaú", disponivel: true };
    const bw = { fonte: "bitwarden" as const, ref: "y", rotulo: "Itaú", disponivel: true };
    expect(ordenarOpcoes([bw, nod, op]).map((o) => o.fonte)).toEqual(["1password", "nod", "bitwarden"]);
    const cinza = { ...op, disponivel: false, motivoIndisponivel: MOTIVO_SEM_MAC };
    expect(ordenarOpcoes([cinza, nod]).map((o) => o.fonte)).toEqual(["nod", "1password"]);
  });
  it("o código de uso único é uma linha curta", () => {
    expect(codigoValido("123456")).toBe(true);
    expect(codigoValido("12 34")).toBe(true);
    expect(codigoValido("")).toBe(false);
    expect(codigoValido("  ")).toBe(false);
    expect(codigoValido("12\n34")).toBe(false);
    expect(codigoValido("x".repeat(65))).toBe(false);
    expect(codigoValido(123456)).toBe(false);
  });
});

describe("o que a pessoa digita (L5)", () => {
  const tecla = (tecla: string, modificadores = 0): EntradaNavegador => ({ t: "tecla", evento: "keyDown", tecla, modificadores });
  const aplicar = (es: EntradaNavegador[]) => es.reduce<Digitado>((d, e) => aplicarDigitacao(d, e), { texto: "", tudo: false }).texto;
  it("letras, colar, apagar e selecionar tudo", () => {
    expect(aplicar([tecla("a"), tecla("b"), tecla("Backspace"), tecla("c")])).toBe("ac");
    expect(aplicar([{ t: "tecla", evento: "char", texto: "senha colada" }])).toBe("senha colada");
    expect(aplicar([tecla("x"), tecla("a", 4), tecla("n"), tecla("o")])).toBe("no");
    expect(aplicar([tecla("x"), tecla("a", 2), tecla("Backspace")])).toBe("");
    expect(aplicar([tecla("x"), tecla("Shift"), tecla("Tab"), tecla("ArrowLeft"), { t: "tecla", evento: "keyUp", tecla: "y" }])).toBe("x");
    expect(aplicar([tecla("x"), tecla("c", 4)])).toBe("x");
  });
});

describe("respostas de antemão (A2, A3)", () => {
  it("o teto do site vale para o host da aba no mesmo site; acima ou sem valor pergunta de novo", () => {
    const lib = juntarLiberacoes(SEM_LIBERACOES, { pagar: { host: "flytap.com", ateCentavos: 400_000 } });
    const base = { modo: "manual" as const, classe: "pagar" as const, destino: null, liberacoes: lib, revisorLigado: false };
    expect(decidirNoNavegador({ ...base, host: "www.flytap.com", rotulo: "Pagar R$ 3.780" })).toEqual({ tipo: "passa", motivo: "liberado_antes" });
    expect(decidirNoNavegador({ ...base, host: "www.flytap.com", rotulo: "Pagar R$ 4.100" }).tipo).toBe("pede");
    expect(decidirNoNavegador({ ...base, host: "www.flytap.com", rotulo: "Pagar" }).tipo).toBe("pede");
    expect(decidirNoNavegador({ ...base, host: "www.outra.com", rotulo: "Pagar R$ 10" }).tipo).toBe("pede");
  });
  it("o teto novo troca o do mesmo site; o destino não repete", () => {
    const a = juntarLiberacoes(SEM_LIBERACOES, { pagar: { host: "flytap.com", ateCentavos: 100 }, enviar: { host: "web.whatsapp.com", destino: "Pedro" } });
    const b = juntarLiberacoes(a, { pagar: { host: "www.flytap.com", ateCentavos: 200 }, enviar: { host: "web.whatsapp.com", destino: "pedro" } });
    expect(b).toEqual({ pagar: [{ host: "www.flytap.com", ateCentavos: 200 }], enviar: [{ host: "web.whatsapp.com", destino: "Pedro" }] });
  });
  it("o destino só vale se aparece na página ou no título; sem acento e sem caixa", () => {
    expect(destinoNaPagina("Pedro", "Conversa com Pedro Álvares", "WhatsApp")).toBe("Pedro");
    expect(destinoNaPagina("joão", "Mensagem para JOAO", "")).toBe("joão");
    expect(destinoNaPagina("Pedro", "Conversa com Ana", "WhatsApp")).toBeNull();
    expect(destinoNaPagina("P", "P", "")).toBeNull();
    expect(destinoNaPagina(42, "42", "")).toBeNull();
    const lib = juntarLiberacoes(SEM_LIBERACOES, { enviar: { host: "web.whatsapp.com", destino: "Pedro" } });
    expect(decidirNoNavegador({ modo: "manual", classe: "enviar", host: "web.whatsapp.com", rotulo: "Enviar", destino: "pedro", liberacoes: lib, revisorLigado: false })).toEqual({ tipo: "passa", motivo: "liberado_antes" });
  });
  it("o cartão de antemão diz o que, onde e o teto", () => {
    expect(reais(400_000)).toBe("R$ 4.000");
    expect(reais(378_050)).toBe("R$ 3.780,50");
    expect(textoDoCombinar({ host: "www.flytap.com", oQue: "1 passagem", ateCentavos: 400_000, destino: null })).toEqual({ titulo: "Vou comprar em flytap.com: 1 passagem, até R$ 4.000", texto: "Com isso eu pago sem perguntar de novo, se o valor ficar dentro do limite.", sim: "Pode, até R$ 4.000", nao: "Me pergunte antes de pagar" });
    expect(textoDoCombinar({ host: "web.whatsapp.com", oQue: "o relatório", ateCentavos: null, destino: "Pedro" }).sim).toBe("Pode enviar para Pedro");
  });
});
