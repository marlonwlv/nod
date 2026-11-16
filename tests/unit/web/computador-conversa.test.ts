import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ComputadorPessoaDto, TelaDaPessoa } from "../../../web/lib/computador-pessoa.ts";
import { htmlCartaoDestino, htmlFalhaDoComputador, htmlLinhaDeSistemaDoComputador, rotuloDaEsperaDoComputador } from "../../../web/lib/computador-conversa.ts";
import { textoFormatado } from "../../../web/lib/texto-formatado.ts";
import { estadoInicial, type Estado, type TurnoVivo } from "../../../web/estado/reducer.ts";
import { comFerramenta } from "../../../web/lib/atividade.ts";
import { pensarDaFalaViva } from "../../../web/telas/conversa.ts";

/** D · Computador do bot (item 1): o computador na conversa. */

const tela = (agenteId: string, o: Partial<TelaDaPessoa> = {}): TelaDaPessoa => ({ agenteId, estado: "aberta", controle: "bot", memoriaMb: 400, ...o });
const pc = (o: Partial<ComputadorPessoaDto> = {}): ComputadorPessoaDto => ({ estado: "pronto", maquina: { id: "vm", nome: "vm-sp", contato: 1 }, telas: [], esperando: [], ...o });
const AGORA = 1_700_000_000_000;

describe("a espera do computador vira o rótulo da linha de atividade", () => {
  it("ligando: 'Ligando o computador' (sem reticências nem a frase de continuação)", () => {
    expect(rotuloDaEsperaDoComputador(pc({ estado: "ligando", telas: [tela("a", { estado: "abrindo" })] }), { esperas: {} }, "a", AGORA)).toBe("Ligando o computador");
  });

  it("memória cheia: 'Esperando uma tela livre'; passados 10 min, 'Ainda esperando uma tela · N min'", () => {
    const dto = pc({ telas: [tela("b")], esperando: ["a"] });
    expect(rotuloDaEsperaDoComputador(dto, { esperas: { a: { motivo: "memoria", desde: AGORA - 60_000 } } }, "a", AGORA)).toBe("Esperando uma tela livre");
    expect(rotuloDaEsperaDoComputador(dto, { esperas: {} }, "a", AGORA)).toBe("Esperando uma tela livre");
    expect(rotuloDaEsperaDoComputador(dto, { esperas: { a: { motivo: "memoria", desde: AGORA - 12 * 60_000 - 5_000 } } }, "a", AGORA)).toBe("Ainda esperando uma tela · 12 min");
  });

  it("quem não espera não ganha rótulo (nem sem computador)", () => {
    expect(rotuloDaEsperaDoComputador(pc({ telas: [tela("a")] }), { esperas: {} }, "a", AGORA)).toBeNull();
    expect(rotuloDaEsperaDoComputador(pc({ esperando: ["b"] }), { esperas: {} }, "a", AGORA)).toBeNull();
    expect(rotuloDaEsperaDoComputador(null, { esperas: {} }, "a", AGORA)).toBeNull();
  });
});

describe("a falha do computador é a linha de sistema centrada", () => {
  it("'O computador parou de responder' com 'Tentar de novo'", () => {
    const html = htmlFalhaDoComputador(pc({ estado: "fora_do_ar", falha: { motivo: "sem_resposta", desde: AGORA } }));
    expect(html).toContain('class="cc-sistema"');
    expect(html).toContain("O computador parou de responder");
    expect(html).toContain('data-act="operar-computador" data-op="tentar_de_novo">Tentar de novo</button>');
  });

  it("no ar não há aviso; o registro depois que volta não tem link", () => {
    expect(htmlFalhaDoComputador(pc())).toBeNull();
    expect(htmlLinhaDeSistemaDoComputador("O computador voltou a responder", false)).not.toContain("Tentar de novo");
  });
});

describe("o chip [Computador](nod-computador:)", () => {
  it("vira o chip inline com o globo, sem link de verdade", () => {
    const html = textoFormatado("Você pode acompanhar pelo [Computador](nod-computador:).", { agora: new Date(AGORA) });
    expect(html).toContain('<button type="button" class="cc-chip" data-act="computador-chip" aria-haspopup="dialog" aria-expanded="false">');
    expect(html).toContain("<span>Computador</span></button>.");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("nod-computador:");
  });

  it("outro destino com o mesmo texto não vira chip; o texto do link sai escapado", () => {
    expect(textoFormatado("[Computador](nod-computadorx:)", { agora: new Date(AGORA) })).not.toContain("cc-chip");
    expect(textoFormatado("[<b>x</b>](nod-computador:)", { agora: new Date(AGORA) })).toContain("<span>&lt;b&gt;x&lt;/b&gt;</span>");
  });

  it("o cartão 'Destino do link': Computador, o bot e 'Mostrar no painel direito'; o cabeçalho abre a tela cheia", () => {
    const html = htmlCartaoDestino({ id: "a1", nome: 'Ada "<b>' });
    expect(html).toContain('data-act="abrir-computador" data-id="a1"');
    expect(html).toContain("<b>Computador</b><small>Ada &quot;&lt;b&gt;</small>");
    expect(html).toContain('<hr class="cc-cartao-sep" />');
    expect(html).toContain('data-act="computador-mostrar-painel" data-id="a1"><span>Mostrar no painel direito</span>');
  });

  it("o CSS novo está registrado na página e o chip não quebra por dentro", () => {
    const index = readFileSync(new URL("../../../web/index.html", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../../web/computador-conversa.css", import.meta.url), "utf8");
    expect(index).toContain('<link rel="stylesheet" href="/computador-conversa.css" />');
    expect(css).toMatch(/\.cc-chip \{[^}]*white-space: nowrap/);
    expect(css).toMatch(/\.cc-cartao \{[^}]*width: 300px[^}]*padding: 6px[^}]*border-radius: 16px/);
    expect(css).toMatch(/animation: cc-faixa 1\.2s linear infinite/);
    expect(css).toContain("linear-gradient(110deg");
  });
});

describe("na fala viva, a espera do computador ganha da ferramenta em uso", () => {
  const t: TurnoVivo = { turnoId: "t1", conversaId: "c1", estado: "rodando", executor: null, machineId: null, desde: AGORA - 5_000, agenteId: "bot1" };
  const base = (dto: ComputadorPessoaDto | null, dono = "p") => ({ ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" }, computadorPessoa: dto, frota: { agentes: [{ id: "bot1", nome: "Ada", ownerId: dono, cor: "azul", forma: "gota", excluidoEm: null }] } }) as unknown as Estado;
  const abrindo = comFerramenta(undefined, "Usou o computador", { texto: "Abrindo pt.wikipedia.org", frentes: false }, "id-1");

  it("ligando: o cabeçalho diz 'Ligando o computador'; ligado, volta a ser o rótulo da ferramenta", () => {
    expect(pensarDaFalaViva(t, abrindo, base(pc({ estado: "ligando", telas: [tela("bot1", { estado: "abrindo" })] })), undefined)?.cabecalho.texto).toBe("Ligando o computador");
    expect(pensarDaFalaViva(t, abrindo, base(pc({ telas: [tela("bot1")] })), undefined)?.cabecalho.texto).toBe("Abrindo pt.wikipedia.org");
  });

  it("só no chat de um bot da pessoa", () => {
    expect(pensarDaFalaViva(t, abrindo, base(pc({ estado: "ligando", telas: [tela("bot1", { estado: "abrindo" })] }), "outra"), undefined)?.cabecalho.texto).toBe("Abrindo pt.wikipedia.org");
  });
});
