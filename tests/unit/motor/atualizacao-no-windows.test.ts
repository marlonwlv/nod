import type { ChildProcess, SpawnOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_PARADO, appDeveAtualizar, arquivoDaMarca, arquivoDoSinal, assinaturaDoManifesto, atualizandoAgora, CARENCIA_DO_APP_MS, codificar, comandoDeAtualizarSolto, conferirMotorDoWindows,
  dispararSolto, lerSinalDoMotor, manifestoDoWindows, OPCOES_DO_DISPARO, marcaValida, motorDoWindowsDiferente, motorSeAtualiza, PRAZO_COM_SINAL_MS, PRAZO_DA_TROCA_PEDIDA_MS,
  scriptDaAtualizacao, sinalizarQueSeAtualiza, trocaPedidaPeloMotor, VALIDADE_DA_MARCA_MS, VALIDADE_DO_SINAL_MS,
} from "../../../motor/atualizacao-no-windows.ts";
import { ARQUIVO_LOG_DO_MOTOR, destinoDoLogNoWindows } from "../../../motor/log-no-windows.ts";

const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const MIN = 60_000;

describe("o motor do Windows se atualiza sozinho (2026-11-25)", () => {
  it("o script roda a instalação do servidor com log, grava a marca e a apaga no fim; caminho do usuário nunca entra no texto", () => {
    const s = scriptDaAtualizacao("https://app.nodbot.ai");
    expect(s).toContain("irm 'https://app.nodbot.ai/windows' | iex");
    expect(s).toContain("atualizacao-motor.log");
    expect(s).toContain("'atualizando-motor'");
    expect(s).toMatch(/try \{.*\} finally \{ Remove-Item -LiteralPath \$marca/);
    expect(s).toContain("$env:LOCALAPPDATA");
  });

  it("recusa servidor que quebraria as aspas do PowerShell", () => {
    for (const ruim of ["https://x'; calc; '", "http://exemplo.com", "https://a b", "file:///c"]) expect(() => scriptDaAtualizacao(ruim)).toThrow("servidor_invalido");
    expect(() => scriptDaAtualizacao("http://127.0.0.1:4100")).not.toThrow();
  });

  it("o comando abre um PowerShell que solta outro (Start-Process) com o script codificado, fora da árvore do motor", () => {
    const c = comandoDeAtualizarSolto("https://app.nodbot.ai", "C:\\Windows");
    expect(c.arquivo).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(c.args).toContain("-WindowStyle");
    const cmd = c.args.at(-1)!;
    expect(cmd).toMatch(/^Start-Process -FilePath 'C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe' -WindowStyle Hidden -ArgumentList /);
    const b64 = /'-EncodedCommand','([A-Za-z0-9+/=]+)'/.exec(cmd)![1]!;
    expect(b64).toBe(codificar(scriptDaAtualizacao("https://app.nodbot.ai")));
    expect(Buffer.from(b64, "base64").toString("utf16le")).toBe(scriptDaAtualizacao("https://app.nodbot.ai"));
  });

  it("a marca vale por VALIDADE_DA_MARCA_MS; sem arquivo, não há troca em curso", async () => {
    expect(marcaValida(null, 0)).toBe(false);
    expect(marcaValida(0, VALIDADE_DA_MARCA_MS - 1)).toBe(true);
    expect(marcaValida(0, VALIDADE_DA_MARCA_MS)).toBe(false);
    const pasta = await mkdtemp(join(tmpdir(), "nod-win-"));
    const env = { NOD_PASTA: pasta };
    expect(await atualizandoAgora(env)).toBe(false);
    await writeFile(arquivoDaMarca(env), "x");
    expect(await atualizandoAgora(env)).toBe(true);
    const velha = (Date.now() - VALIDADE_DA_MARCA_MS - MIN) / 1000;
    await utimes(arquivoDaMarca(env), velha, velha);
    expect(await atualizandoAgora(env)).toBe(false);
  });

  it("o manifesto do Windows deixa de fora o computador (não roda no Windows, #337)", () => {
    expect(manifestoDoWindows({ "nod-motor.mjs": "1", "proxy.mjs": "2", "hook-nativas.mjs": "3", "computador-tela.mjs": "4" })).toEqual({ "nod-motor.mjs": "1", "proxy.mjs": "2", "hook-nativas.mjs": "3" });
  });

  it("compara o motor instalado em <pasta>\\motor\\app com o manifesto; servidor fora = não sabe (null)", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "nod-win-"));
    const app = join(pasta, "motor", "app");
    await mkdir(app, { recursive: true });
    for (const n of ["nod-motor.mjs", "proxy.mjs", "hook-nativas.mjs"]) await writeFile(join(app, n), `// ${n}\n`);
    const manifesto = (motor: string) => async () => new Response(JSON.stringify({ versao: "1", arquivos: { "nod-motor.mjs": sha(motor), "proxy.mjs": sha("// proxy.mjs\n"), "hook-nativas.mjs": sha("// hook-nativas.mjs\n") } }));
    const env = { NOD_PASTA: pasta };
    expect(await motorDoWindowsDiferente({ servidor: "https://nod", env, buscar: manifesto("// nod-motor.mjs\n") as typeof fetch })).toBe(false);
    expect(await motorDoWindowsDiferente({ servidor: "https://nod", env, buscar: manifesto("// novo\n") as typeof fetch })).toBe(true);
    expect(await motorDoWindowsDiferente({ servidor: "https://nod", env, buscar: (async () => new Response("", { status: 404 })) as typeof fetch })).toBe(null);
    expect(await motorDoWindowsDiferente({ servidor: "https://nod", env, buscar: (async () => { throw new Error("fora"); }) as typeof fetch })).toBe(null);
  });

  it("o app atualiza na primeira conferência depois de abrir (o motor antigo da Micherlaine)", () => {
    expect(appDeveAtualizar(APP_PARADO, { agora: 0, diferente: true, atualizando: false }).atualizar).toBe(true);
  });

  it("depois da primeira, o app só entra se o motor seguir diferente além da carência (o motor novo cuida antes)", () => {
    let e = appDeveAtualizar(APP_PARADO, { agora: 0, diferente: false, atualizando: false }).estado;
    let d = appDeveAtualizar(e, { agora: 10 * MIN, diferente: true, atualizando: false });
    expect(d.atualizar).toBe(false);
    e = d.estado;
    d = appDeveAtualizar(e, { agora: 10 * MIN + CARENCIA_DO_APP_MS - 1, diferente: true, atualizando: false });
    expect(d.atualizar).toBe(false);
    d = appDeveAtualizar(d.estado, { agora: 10 * MIN + CARENCIA_DO_APP_MS, diferente: true, atualizando: false });
    expect(d.atualizar).toBe(true);
    expect(d.estado.diferenteDesde).toBe(null);
  });

  it("troca em curso ou servidor sem resposta: o app não dispara", () => {
    expect(appDeveAtualizar(APP_PARADO, { agora: 0, diferente: true, atualizando: true }).atualizar).toBe(false);
    const d = appDeveAtualizar(APP_PARADO, { agora: 0, diferente: null, atualizando: false });
    expect(d).toEqual({ estado: APP_PARADO, atualizar: false });
  });

  // Regression: QA-234 — o app derrubava o motor novo no meio do turno da pessoa (ao abrir e depois de 1 h), passando
  // por cima da espera dos turnos (ADR-100/131) que o próprio motor faz. Found by QA Nod (r238) on 2026-11-25.
  it("QA-234: motor novo com o sinal vivo (ele espera os turnos da pessoa): o app não dispara ao abrir nem além da carência", () => {
    const cuida = { diferente: true, atualizando: false, motorCuida: true };
    expect(appDeveAtualizar(APP_PARADO, { agora: 0, ...cuida }).atualizar).toBe(false);
    let e = appDeveAtualizar(APP_PARADO, { agora: 0, ...cuida }).estado;
    for (const agora of [30 * MIN, CARENCIA_DO_APP_MS, PRAZO_COM_SINAL_MS - 1]) {
      const d = appDeveAtualizar(e, { agora, ...cuida });
      expect(d.atualizar).toBe(false);
      e = d.estado;
    }
    // O motor parou de sinalizar (caiu, ou é o antigo que não sabe se atualizar) e segue diferente há horas: o app entra.
    const d = appDeveAtualizar(e, { agora: PRAZO_COM_SINAL_MS - 1 + 30 * MIN, diferente: true, atualizando: false, motorCuida: false });
    expect(d).toMatchObject({ atualizar: true, motivo: "carencia" });
  });

  // Regression: aceite da rc.14 no Windows, achado 1 (bloqueante) — o motor rc.13 renovava o sinal, a troca dele nunca
  // rodava (o `detached` do #358) e o app desistia sempre que havia sinal: a pessoa ficava presa no rc.13. Found by Chico
  // (QA no Windows) on 2026-11-26.
  it("aceite rc.14: sinal vivo, mas a troca que o motor pediu para este manifesto não pegou: o app passa por cima depois do prazo", () => {
    const pedido = 0;
    const cuida = { diferente: true, atualizando: false, motorCuida: true, turnosDaPessoa: null, trocaPedidaEm: pedido };
    // Antes do prazo a troca pode estar rodando (o motor a dispara e sai): o app espera, mesmo na primeira conferência.
    let d = appDeveAtualizar(APP_PARADO, { agora: PRAZO_DA_TROCA_PEDIDA_MS - 1, ...cuida });
    expect(d.atualizar).toBe(false);
    d = appDeveAtualizar(d.estado, { agora: PRAZO_DA_TROCA_PEDIDA_MS, ...cuida });
    expect(d).toMatchObject({ atualizar: true, motivo: "troca_do_motor_nao_pegou" });
    // O app recém-aberto (a rc.14 depois de se atualizar) com o pedido velho do rc.13: troca na primeira conferência.
    expect(appDeveAtualizar(APP_PARADO, { agora: 11 * MIN + PRAZO_DA_TROCA_PEDIDA_MS, ...cuida })).toMatchObject({ atualizar: true, motivo: "troca_do_motor_nao_pegou" });
    // Troca em curso (marca): espera ela acabar.
    expect(appDeveAtualizar(APP_PARADO, { agora: 2 * PRAZO_DA_TROCA_PEDIDA_MS, ...cuida, atualizando: true }).atualizar).toBe(false);
  });

  it("aceite rc.14: sinal vivo e motor diferente além de PRAZO_COM_SINAL_MS, sem pedido de troca: o app passa por cima", () => {
    const cuida = { diferente: true, atualizando: false, motorCuida: true, turnosDaPessoa: null, trocaPedidaEm: null };
    let d = appDeveAtualizar(APP_PARADO, { agora: 0, ...cuida });
    for (const agora of [30 * MIN, CARENCIA_DO_APP_MS, 2 * CARENCIA_DO_APP_MS, PRAZO_COM_SINAL_MS - 1]) {
      d = appDeveAtualizar(d.estado, { agora, ...cuida });
      expect(d.atualizar).toBe(false);
    }
    d = appDeveAtualizar(d.estado, { agora: PRAZO_COM_SINAL_MS, ...cuida });
    expect(d).toMatchObject({ atualizar: true, motivo: "motor_preso_com_sinal" });
    // A troca do app também falhou (o motor segue diferente e sinalizando): tenta de novo só depois da carência.
    d = appDeveAtualizar(d.estado, { agora: PRAZO_COM_SINAL_MS + 30 * MIN, ...cuida });
    expect(d.atualizar).toBe(false);
    d = appDeveAtualizar(d.estado, { agora: PRAZO_COM_SINAL_MS + CARENCIA_DO_APP_MS, ...cuida });
    expect(d).toMatchObject({ atualizar: true, motivo: "motor_preso_com_sinal" });
    // O motor ficou igual ao manifesto: tudo zera.
    expect(appDeveAtualizar(d.estado, { agora: PRAZO_COM_SINAL_MS + 2 * CARENCIA_DO_APP_MS, ...cuida, diferente: false }).estado.diferenteDesde).toBe(null);
  });

  it("#365: com turno da pessoa no sinal, o app nunca passa por cima — nem com a troca do motor que não pegou, nem além do prazo", () => {
    const comTurno = { diferente: true, atualizando: false, motorCuida: true, turnosDaPessoa: 1, trocaPedidaEm: 0 };
    let d = appDeveAtualizar(APP_PARADO, { agora: 0, ...comTurno });
    for (const agora of [PRAZO_DA_TROCA_PEDIDA_MS, PRAZO_COM_SINAL_MS, 2 * PRAZO_COM_SINAL_MS]) {
      d = appDeveAtualizar(d.estado, { agora, ...comTurno });
      expect(d.atualizar).toBe(false);
    }
    // O turno acabou: o app troca na conferência seguinte.
    d = appDeveAtualizar(d.estado, { agora: 2 * PRAZO_COM_SINAL_MS + 30 * MIN, ...comTurno, turnosDaPessoa: 0 });
    expect(d).toMatchObject({ atualizar: true, motivo: "troca_do_motor_nao_pegou" });
  });

  it("aceite rc.14: o app lê o pedido de troca do motor só quando é do manifesto atual", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "nod-win-"));
    expect(await trocaPedidaPeloMotor(pasta, "abc")).toBe(null);
    await writeFile(join(pasta, "atualizacao-pedida.json"), `${JSON.stringify({ assinatura: "abc", em: 1234 })}\n`);
    expect(await trocaPedidaPeloMotor(pasta, "abc")).toBe(1234);
    expect(await trocaPedidaPeloMotor(pasta, "outro")).toBe(null);
    await writeFile(join(pasta, "atualizacao-pedida.json"), "{quebrado");
    expect(await trocaPedidaPeloMotor(pasta, "abc")).toBe(null);
  });

  it("aceite rc.14: a assinatura que o app calcula é a do manifesto sem os arquivos do computador, como o motor do Windows grava", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "nod-win-"));
    const arquivos = { "nod-motor.mjs": sha("a"), "proxy.mjs": sha("b"), "hook-nativas.mjs": sha("c"), "computador-tela.mjs": sha("d") };
    const r = await conferirMotorDoWindows({ servidor: "https://nod", env: { NOD_PASTA: pasta }, buscar: (async () => new Response(JSON.stringify({ arquivos }))) as typeof fetch });
    const { "computador-tela.mjs": _fora, ...semComputador } = arquivos;
    expect(r).toEqual({ diferente: true, assinatura: assinaturaDoManifesto(semComputador) });
  });

  it("aceite rc.14: o sinal novo leva os turnos da pessoa; o do motor até a rc.15 (só a hora) vale como vivo, sem turnos", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "nod-win-"));
    const env = { NOD_PASTA: pasta };
    expect(await lerSinalDoMotor(env)).toEqual({ vivo: false, turnosDaPessoa: null });
    await sinalizarQueSeAtualiza(env, Date.now(), 2);
    expect(await lerSinalDoMotor(env)).toEqual({ vivo: true, turnosDaPessoa: 2 });
    await writeFile(arquivoDoSinal(env), `${new Date().toISOString()}\n`);
    expect(await lerSinalDoMotor(env)).toEqual({ vivo: true, turnosDaPessoa: null });
    // O motor até a rc.15 renova a cada 5 min: 6 min sem renovar ainda vale.
    expect((await lerSinalDoMotor(env, Date.now() + 6 * MIN)).vivo).toBe(true);
    expect((await lerSinalDoMotor(env, Date.now() + VALIDADE_DO_SINAL_MS + MIN)).vivo).toBe(false);
  });

  it("QA-234: o sinal do motor que se atualiza vale por VALIDADE_DO_SINAL_MS; sem arquivo, o motor é o antigo", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "nod-win-"));
    const env = { NOD_PASTA: join(pasta, "ainda-nao-existe") };
    expect(await motorSeAtualiza(env)).toBe(false);
    await sinalizarQueSeAtualiza(env);
    expect(await motorSeAtualiza(env)).toBe(true);
    expect(await motorSeAtualiza(env, Date.now() + VALIDADE_DO_SINAL_MS + MIN)).toBe(false);
  });
});

describe("#358: o disparo da troca no Windows (QA da rc.13)", () => {
  type Ouvinte = (...a: unknown[]) => void;
  const falso = () => {
    const chamadas: { arquivo: string; args: string[]; opcoes: SpawnOptions }[] = [];
    const ouvintes = new Map<string, Ouvinte>();
    let soltou = false;
    const gerar = (arquivo: string, args: string[], opcoes: SpawnOptions) => {
      chamadas.push({ arquivo, args, opcoes });
      const p = { once: (ev: string, fn: Ouvinte) => { ouvintes.set(ev, fn); return p; }, unref: () => { soltou = true; return p; } };
      return p as unknown as ChildProcess;
    };
    return { gerar, chamadas, emitir: (ev: string, ...a: unknown[]) => ouvintes.get(ev)?.(...a), soltou: () => soltou };
  };
  const cmd = comandoDeAtualizarSolto("https://app.nodbot.ai", "C:\\Windows");

  it("as opções do PowerShell externo NÃO têm detached (com ele, o Start-Process interno não sobe no Windows)", () => {
    expect(OPCOES_DO_DISPARO).not.toHaveProperty("detached");
    expect(OPCOES_DO_DISPARO).toEqual({ windowsHide: true, stdio: "ignore" });
  });

  it("dispara com essas opções, solta o filho e só resolve quando o PowerShell externo sai", async () => {
    const f = falso();
    let resolvido = false;
    const d = dispararSolto(cmd, f.gerar).then((r) => { resolvido = true; return r; });
    expect(f.chamadas).toEqual([{ arquivo: cmd.arquivo, args: cmd.args, opcoes: OPCOES_DO_DISPARO }]);
    expect(f.chamadas[0]!.opcoes.detached).toBeUndefined();
    expect(f.soltou()).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(resolvido).toBe(false);
    f.emitir("exit", 0);
    expect(await d).toEqual({ ok: true });
  });

  it("saída diferente de 0, erro do spawn e o prazo viram falha com o motivo", async () => {
    let f = falso();
    let d = dispararSolto(cmd, f.gerar);
    f.emitir("exit", 1);
    expect(await d).toEqual({ ok: false, motivo: "saida", codigo: 1 });
    f = falso();
    d = dispararSolto(cmd, f.gerar);
    f.emitir("error", Object.assign(new Error("x"), { name: "Error" }));
    expect(await d).toEqual({ ok: false, motivo: "erro", erro: "Error" });
    f = falso();
    expect(await dispararSolto(cmd, f.gerar, 5)).toEqual({ ok: false, motivo: "prazo" });
    expect(await dispararSolto(cmd, () => { throw new TypeError("sem powershell"); })).toEqual({ ok: false, motivo: "erro", erro: "TypeError" });
  });

  it("o motor e o app disparam por dispararSolto, e nenhum dos dois volta a usar spawn detached para a troca", async () => {
    const motor = await readFile(join(import.meta.dirname, "../../../motor/main.ts"), "utf8");
    const app = await readFile(join(import.meta.dirname, "../../../desktop/windows/main.ts"), "utf8");
    const corpo = (texto: string, de: string) => texto.slice(texto.indexOf(de), texto.indexOf("\n}\n", texto.indexOf(de)));
    const doMotor = corpo(motor, "async function atualizarNoWindows(");
    const doApp = corpo(app, "async function conferirMotor(");
    expect(doMotor).toContain("await dispararSolto(c)");
    expect(doApp).toContain("await dispararSolto(cmd)");
    for (const t of [doMotor, doApp]) { expect(t).not.toMatch(/detached: true/); expect(t).not.toMatch(/\bspawn\(/); }
  });
});

describe("#358 (achado 9): o log do motor do Windows em disco", () => {
  it("grava motor.log na pasta do nod e gira para motor.1.log no teto", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "nod-win-"));
    const destino = destinoDoLogNoWindows({ NOD_PASTA: pasta }, 250);
    destino(JSON.stringify({ evento: "motor_iniciado", pad: "x".repeat(80) }));
    expect(await readFile(join(pasta, ARQUIVO_LOG_DO_MOTOR), "utf8")).toContain("motor_iniciado");
    destino(JSON.stringify({ evento: "motor_atualizacao", pad: "y".repeat(80) }));
    destino(JSON.stringify({ evento: "pedido_falhou", pad: "z".repeat(80) }));
    expect(await readFile(join(pasta, "motor.1.log"), "utf8")).toContain("motor_iniciado");
    expect(await readFile(join(pasta, ARQUIVO_LOG_DO_MOTOR), "utf8")).toContain("pedido_falhou");
  });

  it("sem NOD_PASTA, fica em %LOCALAPPDATA%\\nod (a pasta da instalação)", async () => {
    const local = await mkdtemp(join(tmpdir(), "nod-local-"));
    destinoDoLogNoWindows({ LOCALAPPDATA: local })(JSON.stringify({ evento: "motor_iniciado" }));
    expect(await readFile(join(local, "nod", "motor.log"), "utf8")).toContain("motor_iniciado");
  });

  it("o motor rodar no Windows liga o destino e registra a saída", async () => {
    const motor = await readFile(join(import.meta.dirname, "../../../motor/main.ts"), "utf8");
    expect(motor).toMatch(/async function rodar\(\): Promise<number> \{\n[^\n]*\n\s+if \(NO_WINDOWS\) \{\n\s+definirDestinoDoLog\(destinoDoLogNoWindows\(process\.env\)\);/);
    expect(motor).toContain('log("info", "motor_saiu", { codigo })');
  });
});
