import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { comandoDaCapacidade, consultaImessage, executarMacNaMaquina, SCRIPT_MOUSE, SCRIPT_TAMANHO_TELA, SCRIPTS_JXA, type Executor } from "../../../src/adapters/conectores-locais/mac/maquina.ts";
import { executarConectorNaMaquina } from "../../../src/adapters/conectores-locais/maquina.ts";
import { TODAS_DESLIGADAS } from "../../../src/adapters/conectores-locais/mac/familias.ts";

const LIGADAS = Object.fromEntries(Object.keys(TODAS_DESLIGADAS).map((k) => [k, true])) as typeof TODAS_DESLIGADAS;
const naoRoda: Executor = async () => { throw new Error("não devia executar"); };

describe("ferramentas do Mac: a máquina (ADR-171)", () => {
  it("fora do Mac não executa nada", async () => {
    const r = await executarMacNaMaquina({ capacidade: "mail_ler", argumentos: {}, plataforma: "linux", familias: LIGADAS, executar: naoRoda });
    expect(r.codigo).toBe("fora_do_mac");
  });

  it("família desligada (o padrão) não executa e diz onde ligar", async () => {
    const r = await executarMacNaMaquina({ capacidade: "imessage_enviar", argumentos: { para: "+5511999998888", texto: "oi" }, plataforma: "darwin", familias: TODAS_DESLIGADAS, executar: naoRoda });
    expect(r).toMatchObject({ codigo: "familia_desligada", isError: true });
    expect(r.conteudo).toContain("Ajustes > Computador");
  });

  it("argumento ruim para antes do osascript", async () => {
    const r = await executarMacNaMaquina({ capacidade: "mail_enviar", argumentos: { para: ["x"], assunto: "a", corpo: "b" }, plataforma: "darwin", familias: LIGADAS, executar: naoRoda });
    expect(r.codigo).toBe("argumento_invalido");
  });

  it("o que vem do modelo entra só como argv; o script é a constante", async () => {
    let visto: { bin: string; args: readonly string[] } | null = null;
    const executar: Executor = async (bin, args) => { visto = { bin, args }; return { ok: true, saida: "[]\n" }; };
    const r = await executarMacNaMaquina({ capacidade: "notas_ler", argumentos: { busca: '"); doShellScript("rm -rf ~' }, plataforma: "darwin", familias: LIGADAS, executar });
    expect(r).toEqual({ conteudo: "[]", isError: false, codigo: "ok" });
    expect(visto!.bin).toBe("/usr/bin/osascript");
    expect(visto!.args.slice(0, 4)).toEqual(["-l", "JavaScript", "-e", SCRIPTS_JXA.notas_ler]);
    expect(visto!.args[4]).toBe('"); doShellScript("rm -rf ~');
  });

  it("automação negada e Acesso Total ao Disco viram frases para a pessoa", async () => {
    const negado: Executor = async () => ({ ok: false, erro: "execution error: Not authorized to send Apple events to Mail. (-1743)", prazo: false });
    expect((await executarMacNaMaquina({ capacidade: "mail_ler", argumentos: {}, plataforma: "darwin", familias: LIGADAS, executar: negado })).codigo).toBe("automacao_negada");
    const disco: Executor = async () => ({ ok: false, erro: "Error: unable to open database file", prazo: false });
    const r = await executarMacNaMaquina({ capacidade: "imessage_ler", argumentos: {}, plataforma: "darwin", home: "/Users/ana", familias: LIGADAS, executar: disco });
    expect(r.codigo).toBe("disco_negado");
    expect(r.conteudo).toContain("Acesso Total ao Disco");
  });

  it("o iMessage lê o chat.db em modo só leitura, com o limite inteiro", () => {
    const c = comandoDaCapacidade({ capacidade: "imessage_ler", limite: 7 }, "/Users/ana");
    expect(c.bin).toBe("/usr/bin/sqlite3");
    expect(c.args.slice(0, 3)).toEqual(["-readonly", "-json", "/Users/ana/Library/Messages/chat.db"]);
    expect(consultaImessage(7)).toMatch(/LIMIT 7;$/);
  });

  it("o despachante só roda capacidade do Mac com nome mac__ e não deixa um nome mac__ cair no gh", async () => {
    expect((await executarConectorNaMaquina({ capacidade: "mail_ler", argumentos: {}, ambiente: {}, nomeFerramenta: "github__mail_ler" })).codigo).toBe("capacidade_desconhecida");
    expect((await executarConectorNaMaquina({ capacidade: "pr_ver", argumentos: {}, ambiente: {}, nomeFerramenta: "mac__pr_ver" })).codigo).toBe("capacidade_desconhecida");
  });
});

describe("controle de tela do macOS (ADR-171)", () => {
  /** Executor falso: responde ao tamanho da tela, escreve o PNG do screencapture e o JPEG do sips. */
  function falso(registro: string[][]): Executor {
    return async (bin, args) => {
      registro.push([bin, ...args]);
      if (bin === "/usr/bin/osascript" && args.includes(SCRIPT_TAMANHO_TELA)) return { ok: true, saida: JSON.stringify({ largura: 1440, altura: 900 }) };
      if (bin === "/usr/sbin/screencapture") { await writeFile(args[args.length - 1]!, "png"); return { ok: true, saida: "" }; }
      if (bin === "/usr/bin/sips") { await writeFile(args[args.length - 1]!, "jpg"); return { ok: true, saida: "" }; }
      return { ok: true, saida: "ok" };
    };
  }

  it("clica pelo CoreGraphics com os números como argv e anexa o print em pontos", async () => {
    const registro: string[][] = [];
    let esperou = 0;
    const r = await executarMacNaMaquina({ capacidade: "tela_clicar", argumentos: { x: 100, y: 200, vezes: 2 }, plataforma: "darwin", familias: LIGADAS, executar: falso(registro), esperar: async (ms) => { esperou = ms; } });
    expect(r.codigo).toBe("ok");
    expect(r.imagem).toEqual({ data: Buffer.from("jpg").toString("base64"), mimeType: "image/jpeg" });
    expect(r.conteudo).toContain("1440 × 900");
    expect(registro[0]).toEqual(["/usr/bin/osascript", "-l", "JavaScript", "-e", SCRIPT_MOUSE, "esquerdo", "100", "200", "2"]);
    expect(registro.some((c) => c[0] === "/usr/bin/sips" && c.includes("1440"))).toBe(true);
    expect(esperou).toBeGreaterThan(0);
  });

  it("tela_ver só tira o print; família desligada não toca na tela", async () => {
    const registro: string[][] = [];
    expect((await executarMacNaMaquina({ capacidade: "tela_ver", argumentos: {}, plataforma: "darwin", familias: LIGADAS, executar: falso(registro) })).imagem).toBeDefined();
    expect(registro.some((c) => c.includes(SCRIPT_MOUSE))).toBe(false);
    const r = await executarMacNaMaquina({ capacidade: "tela_clicar", argumentos: { x: 1, y: 1 }, plataforma: "darwin", familias: TODAS_DESLIGADAS, executar: naoRoda });
    expect(r.codigo).toBe("familia_desligada");
  });

  it("tecla com nome vira key code; letra vai pelo keystroke; texto nunca é interpretado", () => {
    const enter = comandoDaCapacidade({ capacidade: "tela_tecla", tecla: "enter", modificadores: ["comando"] }, "/h");
    expect(enter.args.slice(-3)).toEqual(["36", "comando", "codigo"]);
    const letra = comandoDaCapacidade({ capacidade: "tela_tecla", tecla: "k", modificadores: [] }, "/h");
    expect(letra.args.slice(-3)).toEqual(["k", "", "letra"]);
    const texto = comandoDaCapacidade({ capacidade: "tela_digitar", texto: '" & do shell script "rm' }, "/h");
    expect(texto.args.slice(-3)).toEqual(['" & do shell script "rm', "", "texto"]);
  });

  it("Acessibilidade negada vira a frase do lugar certo nos Ajustes", async () => {
    const negado: Executor = async () => ({ ok: false, erro: "System Events got an error: osascript is not allowed assistive access. (-25211)", prazo: false });
    const r = await executarMacNaMaquina({ capacidade: "tela_digitar", argumentos: { texto: "oi" }, plataforma: "darwin", familias: LIGADAS, executar: negado, esperar: async () => undefined });
    expect(r.codigo).toBe("automacao_negada");
    expect(r.conteudo).toContain("Acessibilidade");
  });
});
