import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ENTRADA_PARADA,
  MS_REPOUSO_DEPOIS_DE_FECHAR,
  MS_REPOUSO_DEPOIS_DO_BOT,
  TENTAR_V2,
  criarMaquinaDoCartao,
  entradaDoComputador,
  estadoSemEspera,
  htmlCartaoComputador,
  htmlCartaoDoComputador,
  textoDoStatus,
  type EntradaDoCartao,
} from "../../../web/lib/computador-estados.ts";
import type { ComputadorPessoaDto, TelaDaPessoa } from "../../../web/lib/computador-pessoa.ts";

const BOT = { id: "a", nome: "Ada", cor: "c-blue", forma: "gota" };
const AGORA = 1_800_000_000_000;
function pc(p: Partial<ComputadorPessoaDto> = {}): ComputadorPessoaDto {
  return { estado: "pronto", maquina: { id: "m", nome: "Mac do Marlon", contato: AGORA }, telas: [], esperando: [], ...p };
}
const tela = (p: Partial<TelaDaPessoa> = {}): TelaDaPessoa => ({ agenteId: "a", estado: "aberta", controle: "bot", memoriaMb: null, ...p });
const entrada = (p: Partial<EntradaDoCartao> = {}): EntradaDoCartao => ({ ...ENTRADA_PARADA, ...p });

describe("especificação D, item 2: a entrada do cartão vem do computador da pessoa", () => {
  it("fora do ar, sem contato e ligando passam na frente do bot", () => {
    expect(entradaDoComputador(pc({ estado: "fora_do_ar", falha: { motivo: "sem_resposta", desde: AGORA } }), "a", { botTrabalhando: true, telaAberta: false })).toMatchObject({ computador: "fora", semConexao: false, foraDesde: AGORA });
    expect(entradaDoComputador(pc({ semContatoDesde: AGORA - 5_000 }), "a", { botTrabalhando: false, telaAberta: false })).toMatchObject({ computador: "fora", semConexao: true });
    expect(entradaDoComputador(pc({ estado: "ligando" }), "a", { botTrabalhando: true, telaAberta: false }).computador).toBe("ligando");
    expect(entradaDoComputador(pc({ operacao: { tipo: "redefinir", pct: 10, etapa: null } }), "a", { botTrabalhando: false, telaAberta: false }).computador).toBe("ligando");
  });

  it("o bot só está usando a tela se ela está aberta E o turno está vivo (ou abrindo, ou com a pessoa no controle)", () => {
    const usando = (dto: ComputadorPessoaDto, botTrabalhando: boolean) => entradaDoComputador(dto, "a", { botTrabalhando, telaAberta: false }).botUsando;
    expect(usando(pc({ telas: [tela()] }), true)).toBe(true);
    expect(usando(pc({ telas: [tela()] }), false)).toBe(false);
    expect(usando(pc({ telas: [tela({ estado: "abrindo" })] }), false)).toBe(true);
    expect(usando(pc({ telas: [tela({ controle: "pessoa" })] }), false)).toBe(true);
    expect(usando(pc({ telas: [tela({ estado: "fechada" })] }), true)).toBe(false);
    expect(usando(pc({ telas: [tela({ agenteId: "outro" })] }), true)).toBe(false);
  });

  it("os quatro estados sem espera", () => {
    expect(estadoSemEspera(entrada())).toBe("repouso");
    expect(estadoSemEspera(entrada({ botUsando: true }))).toBe("ativo");
    expect(estadoSemEspera(entrada({ telaAberta: true }))).toBe("ativo");
    expect(estadoSemEspera(entrada({ computador: "ligando", botUsando: true }))).toBe("ligando");
    expect(estadoSemEspera(entrada({ computador: "fora", telaAberta: true }))).toBe("fora");
  });
});

describe("especificação D, item 2: a máquina de estados do cartão (19 s e 0,8 s)", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(AGORA); });
  afterEach(() => { vi.useRealTimers(); });

  it("o bot termina com a tela fechada: Ativo por mais 19 s, depois Em repouso (avisando uma vez)", () => {
    const mudou = vi.fn();
    const m = criarMaquinaDoCartao(mudou);
    expect(m.observar(entrada({ botUsando: true }))).toBe("ativo");
    expect(m.observar(entrada())).toBe("ativo");
    vi.advanceTimersByTime(MS_REPOUSO_DEPOIS_DO_BOT - 1);
    expect(m.estado).toBe("ativo");
    expect(mudou).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(m.estado).toBe("repouso");
    expect(mudou).toHaveBeenCalledTimes(1);
    expect(mudou).toHaveBeenCalledWith("repouso");
    expect(MS_REPOUSO_DEPOIS_DO_BOT).toBe(19_000);
  });

  it("fechar a tela com o bot já parado: Em repouso em 0,8 s", () => {
    const mudou = vi.fn();
    const m = criarMaquinaDoCartao(mudou);
    m.observar(entrada({ telaAberta: true }));
    expect(m.observar(entrada())).toBe("ativo");
    vi.advanceTimersByTime(MS_REPOUSO_DEPOIS_DE_FECHAR - 1);
    expect(m.estado).toBe("ativo");
    vi.advanceTimersByTime(1);
    expect(m.estado).toBe("repouso");
    expect(mudou).toHaveBeenCalledTimes(1);
    expect(MS_REPOUSO_DEPOIS_DE_FECHAR).toBe(800);
  });

  it("o bot termina com a tela aberta: fica Ativo enquanto ela está aberta e descansa 0,8 s depois de fechar", () => {
    const m = criarMaquinaDoCartao();
    m.observar(entrada({ botUsando: true, telaAberta: true }));
    m.observar(entrada({ telaAberta: true }));
    vi.advanceTimersByTime(60_000);
    expect(m.estado).toBe("ativo");
    m.observar(entrada());
    vi.advanceTimersByTime(MS_REPOUSO_DEPOIS_DE_FECHAR);
    expect(m.estado).toBe("repouso");
  });

  it("abrir e fechar a tela no meio dos 19 s encurta para 0,8 s (o prazo menor ganha)", () => {
    const m = criarMaquinaDoCartao();
    m.observar(entrada({ botUsando: true }));
    m.observar(entrada());
    vi.advanceTimersByTime(5_000);
    m.observar(entrada({ telaAberta: true }));
    m.observar(entrada());
    vi.advanceTimersByTime(MS_REPOUSO_DEPOIS_DE_FECHAR);
    expect(m.estado).toBe("repouso");
  });

  it("o bot volta a usar a tela antes dos 19 s: continua Ativo e o timer velho não derruba", () => {
    const mudou = vi.fn();
    const m = criarMaquinaDoCartao(mudou);
    m.observar(entrada({ botUsando: true }));
    m.observar(entrada());
    vi.advanceTimersByTime(10_000);
    expect(m.observar(entrada({ botUsando: true }))).toBe("ativo");
    vi.advanceTimersByTime(MS_REPOUSO_DEPOIS_DO_BOT * 2);
    expect(m.estado).toBe("ativo");
    expect(mudou).not.toHaveBeenCalled();
  });

  it("eventos repetidos com a mesma entrada não reiniciam os 19 s nem avisam de novo", () => {
    const mudou = vi.fn();
    const m = criarMaquinaDoCartao(mudou);
    m.observar(entrada({ botUsando: true }));
    m.observar(entrada());
    for (let i = 0; i < 10; i++) { vi.advanceTimersByTime(1_000); m.observar(entrada()); }
    vi.advanceTimersByTime(MS_REPOUSO_DEPOIS_DO_BOT - 10_000);
    expect(m.estado).toBe("repouso");
    m.observar(entrada());
    vi.advanceTimersByTime(60_000);
    expect(mudou).toHaveBeenCalledTimes(1);
  });

  it("fora do ar e ligando entram na hora e cancelam a espera; ao voltar, sem bot, já é Em repouso", () => {
    const mudou = vi.fn();
    const m = criarMaquinaDoCartao(mudou);
    m.observar(entrada({ botUsando: true }));
    m.observar(entrada());
    expect(m.observar(entrada({ computador: "fora", foraDesde: AGORA }))).toBe("fora");
    vi.advanceTimersByTime(MS_REPOUSO_DEPOIS_DO_BOT);
    expect(m.estado).toBe("fora");
    expect(m.observar(entrada({ computador: "ligando" }))).toBe("ligando");
    expect(m.observar(entrada())).toBe("repouso");
    expect(mudou).not.toHaveBeenCalled();
  });

  it("começa em repouso sem bot nem tela", () => {
    expect(criarMaquinaDoCartao().observar(entrada())).toBe("repouso");
  });
});

describe("especificação D, item 2: o HTML do cartão", () => {
  it("a linha inteira é o botão que abre a tela cheia, com o aria-label do Paper", () => {
    const html = htmlCartaoComputador("ativo", BOT, entrada(), TENTAR_V2);
    expect(html).toContain('data-act="abrir-computador" data-id="a" aria-label="Abrir a tela de Ada"');
    expect(html).toContain("Computador de Ada");
    expect(html).toContain('data-miniatura="ativo"');
    expect(html).toContain(">Ativo<");
  });

  it("a miniatura nunca tem imagem nem o data-tela-bot (o laço da miniatura de 3 s não pinta aqui)", () => {
    for (const estado of ["repouso", "ativo", "ligando", "fora"] as const) {
      const html = htmlCartaoComputador(estado, BOT, entrada({ foraDesde: AGORA }), TENTAR_V2);
      expect(html).not.toContain("<img");
      expect(html).not.toContain("data-tela-bot");
    }
  });

  it("em repouso, o personagem dormindo com 3 z; ligando, acordado e sem z; ativo, sem personagem", () => {
    const repouso = htmlCartaoComputador("repouso", BOT, entrada(), TENTAR_V2);
    expect(repouso).toContain('data-estado="pausado"');
    expect(repouso.match(/<i>z<\/i>/g)).toHaveLength(3);
    expect(repouso).toContain("Em repouso");
    const ligando = htmlCartaoComputador("ligando", BOT, entrada(), TENTAR_V2);
    expect(ligando).toContain('data-estado="disponivel"');
    expect(ligando).not.toContain("<i>z</i>");
    expect(ligando).toContain("Ligando…");
    expect(htmlCartaoComputador("ativo", BOT, entrada(), TENTAR_V2)).not.toContain("nod-mascote");
  });

  it("fora do ar: olho riscado e 'Tentar de novo' como link no status, sem 'Ver máquinas'", () => {
    const html = htmlCartaoComputador("fora", BOT, entrada({ foraDesde: new Date(2026, 10, 12, 14, 2).getTime() }), TENTAR_V2);
    expect(html).toContain("Fora do ar desde 14:02");
    expect(html).toContain('class="cpm-tentar" data-act="operar-computador" data-op="tentar_de_novo"');
    expect(html).toContain("Tentar de novo");
    expect(html).toContain("cpm-olho");
    expect(html).not.toContain("Ver máquinas");
    expect(textoDoStatus("fora", { semConexao: true, foraDesde: AGORA })).toBe("Sem conexão");
    expect(textoDoStatus("fora", { semConexao: false, foraDesde: null })).toBe("Fora do ar");
  });

  it("escapa o nome do bot", () => {
    const html = htmlCartaoComputador("repouso", { id: "a", nome: "<i>" }, entrada(), TENTAR_V2);
    expect(html).not.toContain("<i>\"");
    expect(html).toContain("Computador de &lt;i&gt;");
  });

  it("o retrato sem esperas (o nome de antes) segue servindo quem ainda o chama", () => {
    expect(htmlCartaoDoComputador(pc({ estado: "fora_do_ar" }), BOT, AGORA)).toContain('data-estado-miniatura="fora"');
    expect(htmlCartaoDoComputador(pc(), BOT, AGORA)).toContain('data-estado-miniatura="repouso"');
  });
});
