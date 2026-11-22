import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { alvoDoMotor, binarioAgentBrowser, chaveDoBot, criarMotorAgentBrowser, type ExecutorProcesso, FalhaNavegador, identificacaoComJanela, lerAbas, lerLeitura, lerResposta, nomeDaSessao, nomeDeArquivo } from "../../../src/adapters/navegador/motor-agent-browser.ts";

/**
 * O motor do agent-browser com um executor falso: o argv, o env limpo e o parse das saídas medidas em 2026-11-20
 * (agent-browser 0.43.0 em example.com). Nunca sobe Chrome; o teste de fumaça de verdade é navegador-fumaca.test.ts.
 */
const A = "00000000-0000-4000-8000-00000000000a";
const SEGREDO = Buffer.alloc(32, 7);
const vida = { lifecycle: { launched: false, reused: true } };
const ok = (data: Record<string, unknown>) => JSON.stringify({ success: true, data: { ...vida, ...data }, error: null });

let dados: string;
let recebidos: { bin: string; args: readonly string[]; env: Readonly<Record<string, string>>; prazoMs: number }[];
let respostas: ((args: readonly string[]) => { codigo: number | null; saida: string; estourou?: boolean })[];

let versoesLidas = 0;
const executor: ExecutorProcesso = async (p) => {
  // A versão do Chrome (a identificação com janela) é lida uma vez, à parte da fila dos comandos.
  if (p.bin === "/chrome") { versoesLidas++; return { codigo: 0, saida: "Google Chrome 157.0.8103.79\n", erro: "", estourou: false }; }
  recebidos.push(p);
  const r = respostas.shift()?.(p.args) ?? { codigo: 0, saida: ok({}) };
  return { codigo: r.codigo, saida: r.saida, erro: "", estourou: r.estourou === true };
};
const motor = () => criarMotorAgentBrowser({ dados, segredo: SEGREDO, binario: "/bin/agent-browser-falso", executor, chrome: "/chrome" });
const s = { agenteId: A };

beforeEach(async () => {
  dados = await mkdtemp(join(tmpdir(), "nod-navegador-"));
  recebidos = [];
  respostas = [];
  versoesLidas = 0;
});
afterEach(async () => { await rm(dados, { recursive: true, force: true }); });

describe("argv e ambiente", () => {
  it("todo comando leva a sessão do bot, --json e --no-webmcp; o env é limpo e traz perfil, chave e ociosidade", async () => {
    const antes = { DATABASE_URL: process.env.DATABASE_URL, NOD_CREDENTIAL_KEY: process.env.NOD_CREDENTIAL_KEY };
    process.env.DATABASE_URL = "postgres://segredo";
    process.env.NOD_CREDENTIAL_KEY = "nao-pode-vazar";
    try {
      respostas.push(() => ({ codigo: 0, saida: ok({ title: "Example Domain", url: "https://example.com/", targetId: "X" }) }));
      expect(await motor().abrir(s, "https://example.com")).toEqual({ url: "https://example.com/", titulo: "Example Domain" });
    } finally {
      for (const [k, v] of Object.entries(antes)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    const r = recebidos[0]!;
    expect(r.bin).toBe("/bin/agent-browser-falso");
    expect(r.args).toEqual(["open", "https://example.com", "--session", nomeDaSessao(A), "--json", "--no-webmcp"]);
    expect(r.env).not.toHaveProperty("DATABASE_URL");
    expect(r.env).not.toHaveProperty("NOD_CREDENTIAL_KEY");
    expect(r.env).toMatchObject({
      AGENT_BROWSER_SESSION: nomeDaSessao(A), AGENT_BROWSER_PROFILE: join(dados, nomeDaSessao(A), "perfil"), AGENT_BROWSER_ENCRYPTION_KEY: chaveDoBot(SEGREDO, A),
      AGENT_BROWSER_IDLE_TIMEOUT_MS: "600000", AGENT_BROWSER_NO_VERSION_CHECK: "1", AGENT_BROWSER_EXECUTABLE_PATH: "/chrome",
    });
    expect(Object.values(r.env).join("\n")).not.toContain(SEGREDO.toString("hex"));
  });

  // 2026-11-22 (teste do dono): o IMDb devolvia 403 ao "HeadlessChrome"; o Chrome do bot se apresenta como ele mesmo com janela.
  it("sem a marca de automação e com a identificação que o mesmo Chrome dá com janela (a versão lida uma vez)", async () => {
    const m = motor();
    await m.abrir(s, "https://example.com");
    await m.abrir(s, "https://example.org");
    expect(versoesLidas).toBe(1);
    expect(recebidos[0]!.env.AGENT_BROWSER_ARGS).toBe("--disable-blink-features=AutomationControlled");
    expect(recebidos[0]!.env.AGENT_BROWSER_USER_AGENT).toBe(identificacaoComJanela("Google Chrome 157.0.8103.79", process.platform));
    expect(recebidos[1]!.env.AGENT_BROWSER_USER_AGENT).toBe(recebidos[0]!.env.AGENT_BROWSER_USER_AGENT);
    expect(identificacaoComJanela("Google Chrome 157.0.8103.79", "darwin")).toBe("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36");
    expect(identificacaoComJanela("Chromium 156.0.8078.4 snap", "linux")).toBe("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36");
    expect(identificacaoComJanela("", "darwin")).toBeNull();
    // Sem o caminho do Chrome, fica a identificação do agent-browser; a marca de automação sai mesmo assim.
    const semChrome = criarMotorAgentBrowser({ dados, segredo: SEGREDO, binario: "/bin/agent-browser-falso", executor });
    await semChrome.abrir(s, "https://example.com");
    expect(recebidos.at(-1)!.env).not.toHaveProperty("AGENT_BROWSER_USER_AGENT");
    expect(recebidos.at(-1)!.env.AGENT_BROWSER_ARGS).toBe("--disable-blink-features=AutomationControlled");
  });

  it("a sessão só tem [A-Za-z0-9_-] e a chave é por bot, hex de 64, estável", () => {
    expect(nomeDaSessao("ab/../c d;rm")).toBe("nod-abcdrm");
    expect(() => nomeDaSessao("../")).toThrow(FalhaNavegador);
    expect(chaveDoBot(SEGREDO, A)).toMatch(/^[0-9a-f]{64}$/);
    expect(chaveDoBot(SEGREDO, A)).toBe(chaveDoBot(SEGREDO, A));
    expect(chaveDoBot(SEGREDO, A)).not.toBe(chaveDoBot(SEGREDO, "outro"));
    expect(chaveDoBot(Buffer.alloc(32, 8), A)).not.toBe(chaveDoBot(SEGREDO, A));
  });

  it("refs viram @eN; seletor passa como veio; nome de arquivo perde o caminho", () => {
    expect(alvoDoMotor("e3")).toBe("@e3");
    expect(alvoDoMotor("@e3")).toBe("@e3");
    expect(alvoDoMotor("button.pagar")).toBe("button.pagar");
    expect(nomeDeArquivo("../../etc/passwd")).toBe("passwd");
    expect(nomeDeArquivo(".bashrc")).toBe("bashrc");
  });

  it("o binário do pacote npm desta plataforma existe", () => {
    const bin = binarioAgentBrowser();
    expect(bin).not.toBeNull();
    expect(existsSync(bin!)).toBe(true);
    expect(binarioAgentBrowser("plan9-mips")).toBeNull();
  });
});

describe("parse das saídas (medidas em 2026-11-20)", () => {
  it("snapshot -i: árvore e refs", () => {
    const l = lerLeitura({ origin: "https://example.com/", refs: { e1: { name: "Learn more", role: "link" }, x: { name: "?", role: "?" } }, snapshot: '- link "Learn more" [ref=e1]' });
    expect(l).toEqual({ url: "https://example.com/", arvore: '- link "Learn more" [ref=e1]', refs: { e1: { papel: "link", nome: "Learn more" } } });
  });

  it("tab: as abas com id, título, url e a ativa", () => {
    expect(lerAbas({ tabs: [{ active: false, tabId: "t1", title: "Example Domain", type: "page", url: "https://example.com/" }, { active: true, tabId: "t2", title: "example.org", type: "page", url: "https://example.org/" }, { tabId: "w", type: "service_worker" }] }))
      .toEqual([{ id: "t1", titulo: "Example Domain", url: "https://example.com/", ativa: false }, { id: "t2", titulo: "example.org", url: "https://example.org/", ativa: true }]);
  });

  it("falhas tipadas: ref inexistente, tempo esgotado, saída sem JSON", () => {
    expect(() => lerResposta(JSON.stringify({ success: false, data: null, error: "Unknown ref: e99" }), 1)).toThrow(expect.objectContaining({ motivo: "alvo_invalido", detalhe: "Unknown ref: e99" }));
    expect(() => lerResposta(JSON.stringify({ success: false, data: null, error: "Wait timed out after 25000ms" }), 1)).toThrow(expect.objectContaining({ motivo: "tempo_esgotado" }));
    expect(() => lerResposta("[agent-browser] launched browser\n✓ Example", 0)).toThrow(expect.objectContaining({ motivo: "acao_falhou" }));
    expect(lerResposta(`[agent-browser] launched browser\n${ok({ url: "https://a/" })}`, 0)).toMatchObject({ url: "https://a/" });
  });

  it("ler monta o snapshot com -i e -s; clicar manda a ref; o prazo estourado é tempo esgotado", async () => {
    const m = motor();
    respostas.push(() => ({ codigo: 0, saida: ok({ origin: "https://example.com/", refs: { e1: { name: "Learn more", role: "link" } }, snapshot: '- link "Learn more" [ref=e1]' }) }));
    expect((await m.ler(s, { dentro: "main" })).refs).toEqual({ e1: { papel: "link", nome: "Learn more" } });
    expect(recebidos[0]!.args.slice(0, 4)).toEqual(["snapshot", "-i", "-s", "main"]);
    await m.clicar(s, "e1");
    expect(recebidos[1]!.args.slice(0, 2)).toEqual(["click", "@e1"]);
    respostas.push(() => ({ codigo: null, saida: "", estourou: true }));
    await expect(m.esperar(s, { texto: "Pronto" })).rejects.toMatchObject({ motivo: "tempo_esgotado" });
    expect(recebidos[2]!.args.slice(0, 3)).toEqual(["wait", "--text", "Pronto"]);
    expect(recebidos[2]!.prazoMs).toBeLessThanOrEqual(15_000);
  });

  it("print lê o JPEG que o agent-browser gravou e apaga o arquivo", async () => {
    // O executor falso faz o que o agent-browser faz: grava o arquivo no caminho pedido e devolve `data.path`.
    const m = criarMotorAgentBrowser({ dados, segredo: SEGREDO, binario: "/bin/x", executor: async (p) => { recebidos.push(p); await writeFile(p.args[1]!, Buffer.from([0xff, 0xd8, 0xff])); return { codigo: 0, saida: ok({ path: p.args[1] }), erro: "", estourou: false }; } });
    expect(await m.print(s)).toEqual({ jpeg: Buffer.from([0xff, 0xd8, 0xff]).toString("base64") });
    expect(recebidos.at(-1)!.args[0]).toBe("screenshot");
    expect(await readdir(join(dados, nomeDaSessao(A), "prints"))).toEqual([]);
  });

  it("eval vai em base64; get url, stream status e abas", async () => {
    const m = motor();
    respostas.push(() => ({ codigo: 0, saida: ok({ origin: "https://a/", result: "Example Domain" }) }));
    expect(await m.avaliar(s, "document.title")).toBe("Example Domain");
    expect(recebidos[0]!.args.slice(0, 3)).toEqual(["eval", "-b", Buffer.from("document.title").toString("base64")]);
    respostas.push(() => ({ codigo: 0, saida: ok({ url: "https://www.iana.org/help/example-domains" }) }));
    expect(await m.url(s)).toBe("https://www.iana.org/help/example-domains");
    respostas.push(() => ({ codigo: 0, saida: ok({ connected: true, enabled: true, port: 53460, screencasting: false }) }));
    expect(await m.portaDoStream(s)).toBe(53460);
    respostas.push(() => ({ codigo: 0, saida: ok({ height: 18, width: 82, x: 599, y: 522.28 }) }));
    expect(await m.obter(s, "caixa", "@e1")).toEqual({ x: 599, y: 522.28, w: 82, h: 18 });
  });

  it("descreverElemento (T): o ponto entra como número no JS fixo; o resultado vira ElementoNaPagina; sem elemento, null", async () => {
    const m = motor();
    respostas.push(() => ({ codigo: 0, saida: ok({ result: { papel: "textbox", nome: "", rotulo: "Agência", tipo: "text", autocomplete: null, editavel: true } }) }));
    expect(await m.descreverElemento(s, { x: 40.5, y: 30 })).toEqual({ papel: "textbox", nome: "", rotulo: "Agência", tipo: "text", autocomplete: null, editavel: true });
    const js = Buffer.from(String(recebidos[0]!.args[2]), "base64").toString("utf8");
    expect(js).toContain("document.elementFromPoint(40.5, 30)");
    // O valor só é lido num input de botão (submit, button): nunca o de um campo de digitar.
    expect(js.match(/\.value\b/g)).toEqual([".value"]);
    expect(js).toContain("botaoInput ? e.value : e.innerText");
    expect(() => new Function(`return ${js}`)).not.toThrow();
    respostas.push(() => ({ codigo: 0, saida: ok({ result: null }) }));
    expect(await m.descreverElemento(s, null)).toBeNull();
    expect(Buffer.from(String(recebidos[1]!.args[2]), "base64").toString("utf8")).toContain("document.activeElement");
  });

  it("sem binário, o motor responde indisponível sem rodar nada", async () => {
    const sem = criarMotorAgentBrowser({ dados, segredo: SEGREDO, binario: "", executor });
    await expect(sem.ler(s)).rejects.toMatchObject({ motivo: "indisponivel" });
    expect(recebidos).toEqual([]);
    expect(sem.lugar).toEqual({ tipo: "nod" });
  });
});
