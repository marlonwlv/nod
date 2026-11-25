import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { alvoDoMotor, ARGS_CHROME_DO_BOT, cookieVale, binarioAgentBrowser, CACHES_DO_PERFIL, chaveDoBot, criarMotorAgentBrowser, type ExecutorProcesso, FalhaNavegador, identificacaoComJanela, lerAbas, SESSAO_IDENTIDADE, lerLeitura, lerResposta, nomeDaSessao, nomeDeArquivo, pastaDoBot, caminhoDoSocket, dirSocketPadrao, LIMITE_CAMINHO_SOCKET, prepararDirSocket } from "../../../src/adapters/navegador/motor-agent-browser.ts";

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

let identidades: (readonly string[])[] = [];
const UA_SEM_JANELA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/157.0.0.0 Safari/537.36";
const executor: ExecutorProcesso = async (p) => {
  // A sessão à parte que pergunta ao Chrome como ele se apresenta (uma vez por motor) fica fora da fila dos comandos.
  if (p.args.includes(nomeDaSessao(SESSAO_IDENTIDADE))) { identidades.push(p.args); return { codigo: 0, saida: ok(p.args[0] === "eval" ? { result: UA_SEM_JANELA } : {}), erro: "", estourou: false }; }
  recebidos.push(p);
  const r = respostas.shift()?.(p.args) ?? { codigo: 0, saida: ok({}) };
  return { codigo: r.codigo, saida: r.saida, erro: "", estourou: r.estourou === true };
};
const motor = (dirSocket?: string | null) => criarMotorAgentBrowser({ dados, segredo: SEGREDO, binario: "/bin/agent-browser-falso", executor, chrome: "/chrome", dirSocket: dirSocket === undefined ? null : dirSocket });
const s = { agenteId: A };

beforeEach(async () => {
  dados = await mkdtemp(join(tmpdir(), "nod-navegador-"));
  recebidos = [];
  respostas = [];
  identidades = [];
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
      AGENT_BROWSER_SESSION: nomeDaSessao(A), AGENT_BROWSER_PROFILE: join(dados, pastaDoBot(A), "perfil"), AGENT_BROWSER_ENCRYPTION_KEY: chaveDoBot(SEGREDO, A),
      AGENT_BROWSER_IDLE_TIMEOUT_MS: "600000", AGENT_BROWSER_NO_VERSION_CHECK: "1", AGENT_BROWSER_EXECUTABLE_PATH: "/chrome",
    });
    expect(Object.values(r.env).join("\n")).not.toContain(SEGREDO.toString("hex"));
  });

  // 2026-11-22 (teste do dono): o IMDb devolvia 403 ao "HeadlessChrome"; o Chrome do bot se apresenta como ele mesmo com janela.
  it("sem a marca de automação e com a identificação que o próprio Chrome dá, sem o Headless (perguntada uma vez, à parte)", async () => {
    const m = criarMotorAgentBrowser({ dados, segredo: SEGREDO, binario: "/bin/agent-browser-falso", executor });
    await m.abrir(s, "https://example.com");
    await m.abrir(s, "https://example.org");
    expect(identidades.map((a) => a[0])).toEqual(["eval", "close"]);
    const comJanela = UA_SEM_JANELA.replace("HeadlessChrome/", "Chrome/");
    for (const r of recebidos) expect(r.env).toMatchObject({ AGENT_BROWSER_ARGS: ARGS_CHROME_DO_BOT.join(","), AGENT_BROWSER_USER_AGENT: comJanela });
    expect(identificacaoComJanela(UA_SEM_JANELA)).toBe(comJanela);
    // Já com janela (ou não é Chrome): nada a trocar.
    expect(identificacaoComJanela(comJanela)).toBeNull();
    expect(identificacaoComJanela("curl/8.4.0")).toBeNull();
  });

  it("se a pergunta falha, segue com a identificação do agent-browser e só tira a marca de automação", async () => {
    const falha: ExecutorProcesso = async (p) => (p.args.includes(nomeDaSessao(SESSAO_IDENTIDADE)) ? { codigo: 1, saida: "", erro: "x", estourou: false } : executor(p));
    const m = criarMotorAgentBrowser({ dados, segredo: SEGREDO, binario: "/bin/agent-browser-falso", executor: falha });
    await m.abrir(s, "https://example.com");
    expect(recebidos.at(-1)!.env).not.toHaveProperty("AGENT_BROWSER_USER_AGENT");
    expect(recebidos.at(-1)!.env.AGENT_BROWSER_ARGS).toBe(ARGS_CHROME_DO_BOT.join(","));
    expect(ARGS_CHROME_DO_BOT[0]).toBe("--disable-blink-features=AutomationControlled");
  });


  it("a sessão só tem [A-Za-z0-9_-] e a chave é por bot, hex de 64, estável", () => {
    expect(nomeDaSessao("ab/../c d;rm")).toMatch(/^nod-[0-9a-f]{12}$/);
    expect(nomeDaSessao("ab/../c d;rm")).toBe(nomeDaSessao("abcdrm"));
    expect(nomeDaSessao(A)).toBe(nomeDaSessao(A));
    expect(nomeDaSessao(A)).not.toBe(nomeDaSessao("00000000-0000-4000-8000-00000000000b"));
    expect(() => nomeDaSessao("../")).toThrow(FalhaNavegador);
    expect(() => pastaDoBot("../")).toThrow(FalhaNavegador);
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

describe("o disco do perfil (cenários 22/11, ponto 09)", () => {
  it("limpar tira os caches e mantém cookies, logins e dados dos sites; apagar tira a pasta do bot", async () => {
    const m = motor();
    const perfil = join(dados, pastaDoBot(A), "perfil");
    const { mkdir } = await import("node:fs/promises");
    for (const c of CACHES_DO_PERFIL) { await mkdir(join(perfil, c), { recursive: true }); await writeFile(join(perfil, c, "x"), "0".repeat(1000)); }
    await mkdir(join(perfil, "Default", "IndexedDB"), { recursive: true });
    await writeFile(join(perfil, "Default", "Cookies"), "c".repeat(100));
    await writeFile(join(perfil, "Default", "IndexedDB", "site"), "i".repeat(50));
    expect(await m.espaco!(s)).toBe(CACHES_DO_PERFIL.length * 1000 + 150);
    expect(await m.limparCache!(s)).toBe(150);
    expect(existsSync(join(perfil, "Default", "Cookies"))).toBe(true);
    expect(existsSync(join(perfil, "Default", "Cache"))).toBe(false);
    await m.apagarPerfil!(s);
    expect(existsSync(join(dados, pastaDoBot(A)))).toBe(false);
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

  it("baixar que estoura o prazo fecha o Chrome do bot e apaga o download pela metade (QA-207: seguia enchendo o disco)", async () => {
    const m = motor();
    // O agent-browser morre no prazo, mas o Chrome do bot já gravava o .crdownload e seguiria baixando.
    respostas.push(() => ({ codigo: null, saida: "", estourou: true }));
    const baixando = m.baixar(s, "e3", "grande.bin");
    await expect(baixando).rejects.toMatchObject({ motivo: "tempo_esgotado", detalhe: expect.stringContaining("cancelado") });
    expect(recebidos.map((r) => r.args[0])).toEqual(["download", "get", "close"]);
    expect(recebidos[0]!.args[0]).toBe("download");
    const arquivos = dirname(String(recebidos[0]!.args[2]));
    // O arquivo pela metade que existia antes do close sai; um arquivo pronto de antes fica.
    await mkdir(arquivos, { recursive: true });
    await writeFile(join(arquivos, "pronto.pdf"), "x");
    await writeFile(join(arquivos, "a1b2.crdownload"), "metade");
    respostas.push(() => ({ codigo: null, saida: "", estourou: true }));
    await expect(m.baixar(s, "e3", "grande.bin")).rejects.toMatchObject({ motivo: "tempo_esgotado" });
    expect(await readdir(arquivos)).toEqual(["pronto.pdf"]);
    // Outra falha do download não fecha o navegador.
    respostas.push(() => ({ codigo: 1, saida: JSON.stringify({ success: false, data: null, error: "Element not found" }) }));
    const antes = recebidos.length;
    await expect(m.baixar(s, "e9", "x.bin")).rejects.toBeInstanceOf(FalhaNavegador);
    expect(recebidos.slice(antes).map((r) => r.args[0])).toEqual(["download"]);
  });

  it("print lê o JPEG que o agent-browser gravou e apaga o arquivo", async () => {
    // O executor falso faz o que o agent-browser faz: grava o arquivo no caminho pedido e devolve `data.path`.
    const m = criarMotorAgentBrowser({ dados, segredo: SEGREDO, binario: "/bin/x", executor: async (p) => { if (p.args.includes(nomeDaSessao(SESSAO_IDENTIDADE))) return { codigo: 0, saida: ok({}), erro: "", estourou: false }; recebidos.push(p); await writeFile(p.args[1]!, Buffer.from([0xff, 0xd8, 0xff])); return { codigo: 0, saida: ok({ path: p.args[1] }), erro: "", estourou: false }; } });
    expect(await m.print(s)).toEqual({ jpeg: Buffer.from([0xff, 0xd8, 0xff]).toString("base64") });
    expect(recebidos.at(-1)!.args[0]).toBe("screenshot");
    expect(await readdir(join(dados, pastaDoBot(A), "prints"))).toEqual([]);
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

// 2026-11-24: no Mac (app desktop), todo navegador_abrir falhava com "Session name 'nod-<uuid>' is too long. Socket path
// would be 104 bytes (max 103)". O socket do agent-browser 0.43.0 fica em <dir>/namespaces/nod/run/<sessão>.sock.
describe("socket do daemon cabe no sun_path do macOS", () => {
  const UUID = "991c1bb1-8a64-43ff-8a00-3c86f0d4deb8";
  const HOME_MAC = "/Users/marlonwanderllich";
  const TMPDIR_MAC = "/var/folders/t8/wzsw02kn58134qxsv33ynq240000gn/T/";

  it("reproduz o bug: o nome antigo sob ~/.agent-browser dava 104 bytes", () => {
    expect(Buffer.byteLength(caminhoDoSocket(join(HOME_MAC, ".agent-browser"), `nod-${UUID}`))).toBe(104);
  });

  it("com o nome novo e o diretório curto fica < 104 bytes, mesmo com HOME ou TMPDIR compridos do macOS", () => {
    const sessao = nomeDaSessao(UUID);
    expect(sessao).toMatch(/^nod-[0-9a-f]{12}$/);
    const dir = dirSocketPadrao("darwin", 501)!;
    expect(dir).toBe("/tmp/nod-ab-501");
    expect(Buffer.byteLength(caminhoDoSocket(dir, sessao))).toBeLessThanOrEqual(LIMITE_CAMINHO_SOCKET);
    // Sem o diretório curto (o padrão do agent-browser), só o nome curto já cabe no HOME e no TMPDIR típicos.
    expect(Buffer.byteLength(caminhoDoSocket(join(HOME_MAC, ".agent-browser"), sessao))).toBeLessThan(104);
    expect(Buffer.byteLength(caminhoDoSocket(join(TMPDIR_MAC, "agent-browser"), sessao))).toBeLessThan(104);
    expect(Buffer.byteLength(caminhoDoSocket(dir, nomeDaSessao("identidade")))).toBeLessThan(104);
  });

  it("a pasta do perfil continua a de antes (nod-<id>): os logins já salvos não se perdem", () => {
    expect(pastaDoBot(UUID)).toBe(`nod-${UUID}`);
    expect(pastaDoBot("identidade")).toBe("nod-identidade");
  });

  it("no Windows não define AGENT_BROWSER_SOCKET_DIR", () => {
    expect(dirSocketPadrao("win32", undefined)).toBeNull();
  });

  it("o env leva AGENT_BROWSER_SOCKET_DIR 0700 e a sessão curta; o perfil segue na pasta antiga", async () => {
    const dir = join(dados, "ab");
    await motor(dir).abrir(s, "https://example.com");
    const r = recebidos.at(-1)!;
    expect(r.env.AGENT_BROWSER_SOCKET_DIR).toBe(dir);
    expect(r.env.AGENT_BROWSER_SESSION).toBe(nomeDaSessao(A));
    expect(r.env.AGENT_BROWSER_PROFILE).toBe(join(dados, `nod-${A}`, "perfil"));
    if (process.platform !== "win32") expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });

  it.skipIf(process.platform === "win32")("recusa diretório de socket que é link (fica o padrão do agent-browser)", async () => {
    const alvo = join(dados, "alvo");
    const link = join(dados, "link");
    await (await import("node:fs/promises")).mkdir(alvo);
    await symlink(alvo, link);
    expect(await prepararDirSocket(link)).toBeNull();
    await motor(link).abrir(s, "https://example.com");
    expect(recebidos.at(-1)!.env).not.toHaveProperty("AGENT_BROWSER_SOCKET_DIR");
  });

  // r207 (QA-208): a checagem era feita uma vez por processo. Se a limpeza do /tmp (macOS: 3 dias; systemd-tmpfiles: 10)
  // apaga a pasta com o motor vivo, quem a refaz é o agent-browser (medido no Chromium real: 0755) ou outro usuário que a
  // crie antes (link ou pasta dele), e os comandos do bot — inclusive o `fill` com a senha do cofre — vão ao socket de lá.
  it.skipIf(process.platform === "win32")("confere a pasta dos sockets a cada comando: apagada e trocada por link, sai do env", async () => {
    const fsp = await import("node:fs/promises");
    const dir = join(dados, "sock");
    const m = motor(dir);
    await m.abrir(s, "https://example.com");
    expect(recebidos.at(-1)!.env.AGENT_BROWSER_SOCKET_DIR).toBe(dir);
    await rm(dir, { recursive: true, force: true });
    const alheia = join(dados, "alheia");
    await fsp.mkdir(alheia, { mode: 0o777 });
    await symlink(alheia, dir);
    await m.abrir(s, "https://example.com");
    expect(recebidos.at(-1)!.env).not.toHaveProperty("AGENT_BROWSER_SOCKET_DIR");
  });

  it.skipIf(process.platform === "win32")("a pasta apagada volta 0700 no comando seguinte", async () => {
    const dir = join(dados, "sock2");
    const m = motor(dir);
    await m.abrir(s, "https://example.com");
    await rm(dir, { recursive: true, force: true });
    await m.url(s).catch(() => undefined);
    expect(((await stat(dir)).mode & 0o777).toString(8)).toBe("700");
  });
});

describe("baixar: o download direto quando o do agent-browser falha (QA do navegador no Windows, 2026-11-25)", () => {
  const falha = (erro: string) => () => ({ codigo: 1, saida: JSON.stringify({ success: false, data: null, error: erro }) });
  const respondeA = (args: readonly string[]) => {
    if (args[0] === "get" && args[1] === "attr") return { codigo: 0, saida: ok({ origin: "https://www.exemplo.com.br/docs/", value: "relatorio.pdf" }) };
    if (args[0] === "cookies") return { codigo: 0, saida: ok({ cookies: [{ name: "sessao", value: "abc", domain: ".exemplo.com.br", path: "/", secure: true }, { name: "outro", value: "x", domain: "outro.com", path: "/" }] }) };
    return { codigo: 0, saida: ok({}) };
  };

  it("\"Download was canceled\": segue o href do alvo com os cookies do perfil que valem para o site e grava em arquivos/", async () => {
    respostas.push(falha("Download was canceled"), respondeA, respondeA);
    const pedidos: { url: string; cookie: string | null }[] = [];
    const buscar = (async (url: string, init?: RequestInit) => {
      pedidos.push({ url, cookie: new Headers(init?.headers).get("cookie") });
      return new Response(Buffer.from("%PDF-1.4 teste"), { status: 200, headers: { "content-length": "14" } });
    }) as typeof fetch;
    const m = criarMotorAgentBrowser({ dados, segredo: SEGREDO, binario: "/bin/agent-browser-falso", executor, chrome: "/chrome", dirSocket: null, buscar });
    const r = await m.baixar(s, "@e5", "relatorio.pdf");
    expect(r).toEqual({ nome: "relatorio.pdf", bytes: 14 });
    expect(pedidos).toEqual([{ url: "https://www.exemplo.com.br/docs/relatorio.pdf", cookie: "sessao=abc" }]);
    expect((await stat(join(dados, pastaDoBot(A), "arquivos", "relatorio.pdf"))).size).toBe(14);
  });

  it("redirecionamento para a rede de dentro é recusado; alvo inválido não cai no download direto", async () => {
    respostas.push(falha("Download was canceled"), respondeA, respondeA);
    const buscar = (async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } })) as typeof fetch;
    const m = criarMotorAgentBrowser({ dados, segredo: SEGREDO, binario: "/bin/agent-browser-falso", executor, chrome: "/chrome", dirSocket: null, buscar });
    await expect(m.baixar(s, "@e5", "x.pdf")).rejects.toMatchObject({ motivo: "acao_falhou", detalhe: expect.stringMatching(/endereço que o navegador do bot não abre/) });
    respostas.push(falha("Unknown ref: e99"));
    await expect(m.baixar(s, "@e99", "x.pdf")).rejects.toMatchObject({ motivo: "alvo_invalido" });
  });

  it("corpo sem content-length (chunked) para no teto de 200 MB sem ler o resto e não deixa arquivo pela metade (QA Nod r216)", async () => {
    respostas.push(falha("Download was canceled"), respondeA, respondeA);
    const MB = 1024 * 1024;
    let lidos = 0;
    const corpo = new ReadableStream<Uint8Array>({
      pull(ctl) {
        if (lidos >= 1024 * MB) { ctl.close(); return; }
        lidos += MB;
        ctl.enqueue(new Uint8Array(MB));
      },
    });
    const buscar = (async () => new Response(corpo, { status: 200 })) as typeof fetch;
    const m = criarMotorAgentBrowser({ dados, segredo: SEGREDO, binario: "/bin/agent-browser-falso", executor, chrome: "/chrome", dirSocket: null, buscar });
    await expect(m.baixar(s, "@e5", "grande.pdf")).rejects.toMatchObject({ motivo: "acao_falhou", detalhe: expect.stringMatching(/200 MB/) });
    // Na main o `arrayBuffer()` lia o GB inteiro antes de olhar o tamanho.
    expect(lidos).toBeLessThanOrEqual(202 * MB);
    expect(existsSync(join(dados, pastaDoBot(A), "arquivos", "grande.pdf"))).toBe(false);
  });

  it("cookieVale: domínio com e sem ponto, caminho e seguro só em https", () => {
    const u = new URL("https://app.exemplo.com.br/a/b");
    expect(cookieVale({ domain: ".exemplo.com.br", path: "/" }, u)).toBe(true);
    expect(cookieVale({ domain: "app.exemplo.com.br", path: "/a" }, u)).toBe(true);
    expect(cookieVale({ domain: "exemplo.com", path: "/" }, u)).toBe(false);
    expect(cookieVale({ domain: "app.exemplo.com.br", path: "/c" }, u)).toBe(false);
    expect(cookieVale({ domain: "app.exemplo.com.br", path: "/", secure: true }, new URL("http://app.exemplo.com.br/"))).toBe(false);
  });

  it("cookieVale: cookie só do site não vai ao subdomínio e caminho casa por segmento, como no Chrome (QA r217)", () => {
    // Formato real do `cookies` no Chromium: "lvh.me" (sem Domain=) e ".lvh.me" (Domain=lvh.me).
    const sub = new URL("http://a.lvh.me/arquivo.pdf");
    expect(cookieVale({ domain: "lvh.me", path: "/" }, sub)).toBe(false);
    expect(cookieVale({ domain: ".lvh.me", path: "/" }, sub)).toBe(true);
    expect(cookieVale({ domain: "lvh.me", path: "/" }, new URL("http://lvh.me/x"))).toBe(true);
    expect(cookieVale({ domain: "lvh.me", path: "/conta" }, new URL("http://lvh.me/contas-falsas"))).toBe(false);
    expect(cookieVale({ domain: "lvh.me", path: "/conta" }, new URL("http://lvh.me/conta"))).toBe(true);
    expect(cookieVale({ domain: "lvh.me", path: "/conta" }, new URL("http://lvh.me/conta/x"))).toBe(true);
    expect(cookieVale({ domain: "lvh.me", path: "/conta/" }, new URL("http://lvh.me/conta/x"))).toBe(true);
  });
});

describe("abas: o stream acompanha a aba nova (QA do navegador no Windows, 2026-11-25)", () => {
  it("depois de abrir ou fechar, seleciona de novo a aba ativa; se a lista falhar, a aba nova continua aberta", async () => {
    const lista = () => ({ codigo: 0, saida: ok({ tabs: [{ tabId: "t1", title: "A", url: "https://a.com/", active: false }, { tabId: "t2", title: "B", url: "https://b.com/", active: true }] }) });
    respostas.push(() => ({ codigo: 0, saida: ok({}) }), lista, () => ({ codigo: 0, saida: ok({}) }));
    await motor().abaNova(s, "https://b.com/");
    expect(recebidos.map((r) => r.args.slice(0, 3))).toEqual([["tab", "new", "https://b.com/"], ["tab", "--session", nomeDaSessao(A)], ["tab", "t2", "--session"]]);
    recebidos = [];
    respostas.push(() => ({ codigo: 0, saida: ok({}) }), () => ({ codigo: 1, saida: JSON.stringify({ success: false, data: null, error: "falhou" }) }));
    await expect(motor().abaFechar(s, "t1")).resolves.toBeUndefined();
    expect(recebidos.map((r) => r.args[1])).toEqual(["close", "--session"]);
  });
});
