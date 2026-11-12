import { describe, expect, it } from "vitest";
import { ALTURA_QUICK_CHAT, LARGURA_QUICK_CHAT, criarQuickChat, lerAtalho, posicaoDaJanela, urlDoQuickChat, type JanelaQuickChat } from "../../../desktop/quick-chat.ts";
import { capturarNoMac, nomeDaCaptura, TETO_CAPTURA_BYTES } from "../../../desktop/captura-mac.ts";
import { writeFile } from "node:fs/promises";
import { dentroDeUmaTela, lerAvatares, MAX_AVATARES, posicaoNova, TAMANHO_AVATAR, urlDoAvatar } from "../../../desktop/avatar-mesa.ts";

describe("Quick Chat: o atalho (ADR-173)", () => {
  it("canoniza o accelerator e aceita os nomes do Mac", () => {
    expect(lerAtalho("Alt+Space")).toBe("Alt+Space");
    expect(lerAtalho("option+space")).toBe("Alt+Space");
    expect(lerAtalho("shift+cmd+k")).toBe("Command+Shift+K");
    expect(lerAtalho("Ctrl+Alt+1")).toBe("Control+Alt+1");
    expect(lerAtalho("F13")).toBe("F13");
  });

  it("recusa letra sozinha, Shift sozinho, duas teclas e lixo", () => {
    for (const ruim of ["K", "Shift+K", "Cmd+K+J", "Cmd+", "", "Cmd+Banana", 42, null, "F5", "a".repeat(80)]) expect(lerAtalho(ruim)).toBeNull();
  });

  it("o atalho em uso por outro app mantém o anterior e diz em_uso", () => {
    const registrados: string[] = [];
    const qc = criarQuickChat({ registrar: (a) => { if (a === "Command+Space") return false; registrados.push(a); return true; }, desregistrar: (a) => { registrados.splice(registrados.indexOf(a), 1); }, criarJanela: () => null }, "Alt+Space");
    expect(qc.atalho()).toBe("Alt+Space");
    expect(qc.definirAtalho("Cmd+Space")).toEqual({ ok: false, motivo: "em_uso", atalho: "Alt+Space" });
    expect(qc.definirAtalho("K")).toEqual({ ok: false, motivo: "invalido", atalho: "Alt+Space" });
    expect(qc.definirAtalho("Cmd+Shift+J")).toEqual({ ok: true, atalho: "Command+Shift+J" });
    expect(registrados).toEqual(["Command+Shift+J"]);
    expect(qc.definirAtalho(null)).toEqual({ ok: true, atalho: null });
    expect(registrados).toEqual([]);
  });

  it("o atalho alterna a janela: cria escondida, mostra, esconde, e recria se foi destruída", () => {
    let fn = (): void => undefined;
    let criadas = 0;
    let visivel = false;
    let destruida = false;
    const janela: JanelaQuickChat = { visivel: () => visivel, mostrar: () => { visivel = true; }, esconder: () => { visivel = false; }, destruida: () => destruida };
    criarQuickChat({ registrar: (_a, f) => { fn = f; return true; }, desregistrar: () => undefined, criarJanela: () => { criadas++; return janela; } }, "Alt+Space");
    fn(); expect(visivel).toBe(true); expect(criadas).toBe(1);
    fn(); expect(visivel).toBe(false);
    destruida = true; fn(); expect(criadas).toBe(2);
  });

  it("nasce com 560×392 (o cartão da tela 10 do Paper), centrada e a um terço da altura; encolhe numa tela menor", () => {
    expect(posicaoDaJanela({ x: 0, y: 25, width: 1440, height: 875 })).toEqual({ x: (1440 - LARGURA_QUICK_CHAT) / 2, y: 25 + Math.round((875 - ALTURA_QUICK_CHAT) / 3), width: LARGURA_QUICK_CHAT, height: ALTURA_QUICK_CHAT });
    expect(posicaoDaJanela({ x: 0, y: 0, width: 500, height: 400 }).width).toBe(500);
  });

  it("a URL é só a origem do servidor com o modo compacto", () => {
    expect(urlDoQuickChat("https://nod.exemplo.com/algum/caminho?x=1#y")).toBe("https://nod.exemplo.com/?janela=quick-chat");
  });
});

describe("Captura de janela ou região (ADR-173)", () => {
  const medir = () => ({ largura: 690, altura: 300 });
  it("fora do Mac não faz nada", async () => {
    expect(await capturarNoMac({ plataforma: "linux", medir, executar: async () => { throw new Error("não devia rodar"); } })).toBeNull();
  });

  it("cancelou (sem arquivo) = null; capturou = PNG em base64 com medida e nome datado", async () => {
    expect(await capturarNoMac({ plataforma: "darwin", medir, executar: async () => undefined })).toBeNull();
    let args: readonly string[] = [];
    const c = await capturarNoMac({ plataforma: "darwin", medir, agora: () => new Date(2026, 10, 12, 10, 24, 5), executar: async (_bin, a) => { args = a; await writeFile(a[a.length - 1]!, Buffer.from([137, 80, 78, 71])); } });
    expect(args.slice(0, 2)).toEqual(["-i", "-x"]);
    expect(c).toEqual({ nome: "captura-2026-11-12-102405.png", mime: "image/png", base64: Buffer.from([137, 80, 78, 71]).toString("base64"), largura: 690, altura: 300 });
  });

  it("acima do teto do anexo volta grande_demais, sem os bytes", async () => {
    const c = await capturarNoMac({ plataforma: "darwin", medir, executar: async (_bin, a) => { await writeFile(a[a.length - 1]!, Buffer.alloc(TETO_CAPTURA_BYTES + 1)); } });
    expect(c).toEqual({ erro: "grande_demais" });
  });

  it("o nome da captura é estável", () => {
    expect(nomeDaCaptura(new Date(2026, 0, 2, 3, 4, 5))).toBe("captura-2026-01-02-030405.png");
  });
});


describe("avatar do bot na área de trabalho (ADR-173)", () => {
  const ID = "0b9c6a8e-3f1d-4c7e-9a2b-5d6e7f8a9b0c";
  it("lê só avatares válidos, sem repetir e até o teto", () => {
    expect(lerAvatares([{ agenteId: ID, x: 10.4, y: 20 }, { agenteId: ID, x: 1, y: 1 }, { agenteId: "x", x: 1, y: 1 }, null, { agenteId: ID.replace("0b", "1b"), x: "1", y: 1 }])).toEqual([{ agenteId: ID, x: 10, y: 20 }]);
    const muitos = Array.from({ length: 10 }, (_, i) => ({ agenteId: ID.slice(0, -1) + i.toString(16), x: 0, y: 0 }));
    expect(lerAvatares(muitos)).toHaveLength(MAX_AVATARES);
    expect(lerAvatares("lixo")).toEqual([]);
  });

  it("nasce no canto de baixo à direita e volta para uma tela que existe", () => {
    const area = { x: 0, y: 25, width: 1440, height: 875 };
    expect(posicaoNova(area, 0)).toEqual({ x: 1440 - 24 - TAMANHO_AVATAR, y: 25 + 875 - 24 - TAMANHO_AVATAR });
    expect(dentroDeUmaTela({ x: 5000, y: 5000 }, [area])).toEqual(posicaoNova(area, 0));
    expect(dentroDeUmaTela({ x: 100, y: 100 }, [area])).toEqual({ x: 100, y: 100 });
  });

  it("a URL do avatar e a do Quick Chat no bot são só da origem do servidor", () => {
    expect(urlDoAvatar("https://nod.exemplo.com/x?y=1", ID)).toBe(`https://nod.exemplo.com/?janela=avatar&bot=${ID}`);
    expect(urlDoQuickChat("https://nod.exemplo.com", ID)).toBe(`https://nod.exemplo.com/?janela=quick-chat&bot=${ID}`);
  });
});
