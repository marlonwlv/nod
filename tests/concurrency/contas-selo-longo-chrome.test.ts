import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import type { ContaIa, ContasIaDto } from "../../src/contracts/contas-ia.ts";
import type { MaquinaDto } from "../../src/contracts/maquina.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { renderListaDeContas, UI_CONTAS_INICIAL } from "../../web/telas/contas-lista.ts";

/**
 * XUM-4 (print do Marlon, 2026-11-26): em Ajustes → IA o selo longo ("No limite até 27/11 às 13:00", "Em uso na
 * nod-motor-teste") passava por cima da barra de uso e o nome da conta cortava cedo. Mede no Chromium, com os estilos
 * reais, as sete contas do print na largura do modal de 900 px, num modal mais estreito e no celular.
 */
const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("o CI precisa do Chromium para conferir a lista de contas de IA");
const descrever = chrome ? describe : describe.skip;

const AGORA = Date.UTC(2026, 10, 26, 3, 0);
const VM = "11111111-1111-4111-8111-111111111111";
const MAC = "22222222-2222-4222-8222-222222222222";
const VM_LONGA = "44444444-4444-4444-8444-444444444444";
const maquina = (id: string, nome: string, o: Partial<MaquinaDto> = {}): MaquinaDto => ({ id, nome, prefixo: id.slice(0, 8), criadaEm: 1, ultimoUsoEm: null, conectada: true, plataforma: "linux", ias: {}, gh: false, ...o });
const janela = (utilizacao: number) => ({ utilizacao, renovaEm: AGORA + 86_400_000 });
let n = 0;
const conta = (ia: ContaIa["ia"], apelido: string, maquinas: string[], o: Partial<ContaIa> = {}): ContaIa => {
  n += 1;
  const id = `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return {
    id, ia, impressao: String(n).padStart(64, "a"), apelido, email: null, organizacao: null, plano: "Max", corporativa: false, posicao: n,
    entraNaTrocaAutomatica: true, noLimiteAte: null, maquinas: maquinas.map((m) => ({ maquinaId: m, nome: m, estado: "pronta" as const })),
    cota: { cincoHoras: janela(0.2), semana: janela(0.4), situacao: "livre", voltaEm: null, medidoEm: AGORA - 60_000 }, ...o,
  };
};

/** As sete do print: a 1ª no limite (semana 100%), a 2ª em uso só na VM (semana 51%), as outras disponíveis. */
function cenario(nomeDaVm: string): { contas: ContasIaDto; maquinas: MaquinaDto[] } {
  n = 0;
  const vm = nomeDaVm === "nod-motor-teste" ? VM : VM_LONGA;
  const maquinas = [maquina(vm, nomeDaVm), maquina(MAC, "MacBook de Marlon", { plataforma: "darwin" })];
  const contas = [
    conta("claude-cli", "Marlon (pessoal)", [vm, MAC], { noLimiteAte: Date.UTC(2026, 10, 27, 16, 0), cota: { cincoHoras: janela(0.3), semana: janela(1), situacao: "limite", voltaEm: Date.UTC(2026, 10, 27, 16, 0), medidoEm: AGORA } }),
    conta("codex-cli", "Contato Gamefik", [vm], { plano: "Pro", cota: { cincoHoras: janela(0.12), semana: janela(0.51), situacao: "livre", voltaEm: null, medidoEm: AGORA } }),
    conta("claude-cli", "Leapy", [vm, MAC], { plano: "Team", corporativa: true }),
    conta("codex-cli", "Pessoal", [MAC], { plano: "Plus" }),
    conta("claude-cli", "Gamefik Tech", [MAC]),
    conta("codex-cli", "Leapy", [MAC], { plano: "Team" }),
    conta("claude-cli", "Reserva", [MAC], { entraNaTrocaAutomatica: false }),
  ];
  return { contas: { disponivel: true, modo: "automatico", contas }, maquinas };
}

type Linha = {
  estado: string; title: string | null; truncado: boolean; dentro: boolean; nomeLargura: number;
  selo: [number, number, number, number]; uso: [number, number, number, number][]; usoCortado: boolean; fio: number;
  nomeCortado: boolean; sobraNoNome: number; transborda: boolean;
};
const MEDIR = `[...document.querySelectorAll(".cl-linha-g1")].map((li) => {
  const r = (el) => { const b = el.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
  const selo = li.querySelector(".cl-dir .contas-estado");
  const rot = li.querySelector(".cl-uso-rot");
  const fios = li.querySelector(".cl-uso-fios");
  const nome = li.querySelector(".cl-nome-bt b");
  const col = li.querySelector(".cl-corpo");
  return {
    estado: selo.textContent.trim(), title: selo.getAttribute("title"),
    truncado: selo.scrollWidth > selo.clientWidth + 0.5,
    dentro: [selo, li.querySelector(".cl-fila"), nome].every((el) => { const a = el.getBoundingClientRect(), b = li.getBoundingClientRect(); return a.left >= b.left - 0.5 && a.right <= b.right + 0.5; }),
    nomeLargura: nome.getBoundingClientRect().width,
    selo: r(selo), uso: [rot, fios].filter(Boolean).map(r),
    usoCortado: rot ? rot.scrollWidth > rot.clientWidth + 0.5 || rot.getBoundingClientRect().right > li.querySelector(".cl-uso-col").getBoundingClientRect().right + 0.5 : false,
    fio: fios ? fios.getBoundingClientRect().width : 0,
    nomeCortado: nome.scrollWidth > nome.clientWidth + 0.5,
    sobraNoNome: col.getBoundingClientRect().right - Math.max(...[...li.querySelectorAll(".cl-nome > *")].map((e) => e.getBoundingClientRect().right)),
    transborda: li.scrollWidth > li.clientWidth + 0.5,
  };
})`;
const cruza = (a: number[], b: number[]) => a[0]! < b[2]! - 0.5 && b[0]! < a[2]! - 0.5 && a[1]! < b[3]! - 0.5 && b[1]! < a[3]! - 0.5;

descrever("Lista de contas de IA com selo longo (Chrome real)", () => {
  let cdp: Cdp;
  let processoChrome: ChildProcess;
  let perfil: string;

  beforeAll(async () => {
    perfil = mkdtempSync(join(tmpdir(), "nod-selo-longo-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp, chrome: processoChrome } = await abrirChrome(9910 + (process.pid % 40), perfil));
    await cdp.enviar("Page.enable");
    const estilos = [...readFileSync("web/index.html", "utf8").matchAll(/href="\/([^"]+\.css)"/g)].map((m) => `web/${m[1]}`).filter(existsSync);
    const css = estilos.map((p) => readFileSync(p, "utf8")).join("\n");
    await avaliar(cdp, `document.open();document.write(${JSON.stringify(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><main id="app" class="espaco-corpo"></main>`)});document.close()`);
  }, 30_000);

  afterAll(async () => {
    const saiu = processoChrome?.exitCode === null && processoChrome.signalCode === null
      ? new Promise<void>((ok) => processoChrome.once("exit", () => ok()))
      : Promise.resolve();
    cdp?.fechar();
    await saiu;
    if (perfil) rmSync(perfil, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
  });

  /** `largura` é a da área de conteúdo: 639 px é a do modal de 900 (900 − 200 da coluna − 59 de respiro − 2 de borda). */
  const medir = async (vm: string, largura: number, celular = false): Promise<Linha[]> => {
    const tela = celular ? largura : largura + 400;
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: tela, height: 900, deviceScaleFactor: 1, mobile: celular });
    const { contas, maquinas } = cenario(vm);
    const html = renderListaDeContas({ contas, maquinas, detalhes: null, agora: AGORA, noApp: false, botsNaMaquina: () => [], cartaoDoMac: () => "", ui: UI_CONTAS_INICIAL });
    await avaliar(cdp, `(() => { const a = document.querySelector("#app"); a.style.width = ${JSON.stringify(celular ? "auto" : `${largura}px`)}; a.innerHTML = ${JSON.stringify(html)}; })()`);
    return avaliar<Linha[]>(cdp, MEDIR);
  };

  const casos: [string, string, number, boolean][] = [
    ["modal de 900 px (o print)", "nod-motor-teste", 639, false],
    ["modal de 900 px, máquina de nome longo", "maquina-de-build-do-time-de-dados-sp", 639, false],
    ["modal estreito (janela de 760 px)", "nod-motor-teste", 451, false],
    ["modal estreito, máquina de nome longo", "maquina-de-build-do-time-de-dados-sp", 451, false],
    ["celular de 390 px", "maquina-de-build-do-time-de-dados-sp", 390, true],
    ["celular de 320 px", "nod-motor-teste", 320, true],
  ];
  for (const [nome, vm, largura, celular] of casos) {
    it(`o selo não cobre o uso, que fica inteiro (${nome})`, async () => {
      const linhas = await medir(vm, largura, celular);
      expect(linhas).toHaveLength(7);
      expect(linhas[0]!.estado).toMatch(/^No limite até /);
      expect(linhas[1]!.estado).toBe(`Em uso na ${vm}`);
      for (const l of linhas) {
        expect(l.uso.filter((u) => cruza(l.selo, u)), `${l.estado} cobre o uso`).toEqual([]);
        expect(l.usoCortado, `${l.estado}: o rótulo do uso cortou`).toBe(false);
        expect(l.fio, `${l.estado}: a barra de uso encolheu demais`).toBeGreaterThanOrEqual(48);
        expect(l.transborda, `${l.estado}: a linha transborda`).toBe(false);
        expect(l.dentro, `${l.estado}: o selo, a chave ou o nome saem da linha`).toBe(true);
        expect(l.nomeLargura, `${l.estado}: o nome some`).toBeGreaterThanOrEqual(80);
        // O texto inteiro do estado continua no DOM e, quando corta, no title.
        if (l.truncado) expect(l.title).toBe(l.estado);
      }
      // "Disponível" nunca corta e segue sem title (a linha fica como era).
      for (const l of linhas.filter((x) => x.estado === "Disponível")) { expect(l.truncado).toBe(false); expect(l.title).toBeNull(); }
      expect(linhas[0]!.title).toBe(linhas[0]!.estado);
      // No modal de 900 o limite cabe inteiro (a hora é o que importa nele).
      if (largura >= 639) expect(linhas[0]!.truncado).toBe(false);
    });
  }

  it("sem selo longo, a coluna do estado encolhe e o nome usa o espaço (modal de 900 px)", async () => {
    const longas = await medir("nod-motor-teste", 639);
    const { contas, maquinas } = cenario("nod-motor-teste");
    const curtas = { ...contas, contas: contas.contas.map((c, i) => (i < 2 ? { ...c, noLimiteAte: null, maquinas: c.maquinas.map((m) => ({ ...m, maquinaId: MAC })) } : c)) };
    const html = renderListaDeContas({ contas: curtas, maquinas, detalhes: null, agora: AGORA, noApp: false, botsNaMaquina: () => [], cartaoDoMac: () => "", ui: UI_CONTAS_INICIAL });
    await avaliar(cdp, `document.querySelector("#app").innerHTML = ${JSON.stringify(html)}`);
    const linhas = await avaliar<Linha[]>(cdp, MEDIR);
    expect(linhas.map((l) => l.estado)).not.toContain("No limite até 27/11 às 13:00");
    // "Claude · Marlon (pessoal)" e "ChatGPT · Contato Gamefik" cabem inteiros quando nenhum selo pede espaço.
    expect(linhas[0]!.nomeCortado).toBe(false);
    expect(linhas[1]!.nomeCortado).toBe(false);
    expect(linhas[2]!.nomeLargura).toBeGreaterThanOrEqual(longas[2]!.nomeLargura);
    // E nunca corta o nome com sobra na coluna.
    for (const l of [...longas, ...linhas]) if (l.nomeCortado) expect(l.sobraNoNome).toBeLessThan(4);
  });
});
