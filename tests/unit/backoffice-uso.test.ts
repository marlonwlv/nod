import { describe, expect, it } from "vitest";
import { casosDaPessoa, diasDaJanela, janelaDias, montarPainel, montarPainelPessoa, rotuloProblema, type FatosPessoa } from "../../src/domain/backoffice-uso.ts";

const DIA = 86_400_000;
const AGORA = Date.parse("2026-11-23T12:00:00Z");

function fatos(over: Partial<FatosPessoa> & { id: string }): FatosPessoa {
  const { id, ...resto } = over;
  return {
    ref: { tenantId: "00000000-0000-4000-8000-000000000001", pessoaId: id, nome: `Pessoa ${id}`, iniciais: "P" },
    cadastroEm: null,
    ultimoUsoEm: null,
    onboardingEtapa: null,
    onboardingConcluidoEm: null,
    diasAtivos: [],
    mensagens: 0,
    turnos: 0,
    rotinasAtivas: 0,
    bots: [],
    apps: [],
    primeiraTarefaEm: null,
    tarefas: [],
    rotinas: [],
    problemas: [],
    travadas: 0,
    macsSemContato: 0,
    ...resto,
  };
}

const caso = (fonte: FatosPessoa["problemas"][number]["fonte"], motivo: string, em: number, extra: Partial<FatosPessoa["problemas"][number]> = {}) => ({
  fonte, motivo, em, conversaId: null, turnoId: null, tarefaId: null, alvo: null, ...extra,
});

describe("janela", () => {
  it("limita a 1..90 e cai no padrão com valor inválido", () => {
    expect(janelaDias(null)).toBe(30);
    expect(janelaDias("7")).toBe(7);
    expect(janelaDias("500")).toBe(90);
    expect(janelaDias("0")).toBe(30);
    expect(janelaDias("abc")).toBe(30);
  });
  it("os dias terminam hoje, do mais antigo ao mais novo", () => {
    expect(diasDaJanela(AGORA, 3)).toEqual(["2026-11-21", "2026-11-22", "2026-11-23"]);
  });
});

describe("casosDaPessoa", () => {
  const ini = AGORA - 30 * DIA;
  it("três falhas da mesma rotina somam o caso de falha repetida", () => {
    const f = fatos({ id: "a", problemas: [1, 2, 3].map((i) => ({ ...caso("rotina_falhou", "falhou", AGORA - i * DIA), grupo: "r1" })) });
    const c = casosDaPessoa(f, ini, AGORA);
    expect(c.filter((x) => x.motivo === "falha_repetida")).toHaveLength(1);
    expect(c.find((x) => x.motivo === "falha_repetida")?.em).toBe(AGORA - DIA);
  });
  it("onboarding parado há mais de um dia vira abandono; recente ainda não", () => {
    expect(casosDaPessoa(fatos({ id: "a", cadastroEm: AGORA - 2 * DIA, onboardingEtapa: "entrevista" }), ini, AGORA).map((c) => c.fonte)).toEqual(["onboarding_abandonado"]);
    expect(casosDaPessoa(fatos({ id: "a", cadastroEm: AGORA - 3_600_000, onboardingEtapa: "entrevista" }), ini, AGORA)).toEqual([]);
  });
  it("caso fora da janela não conta", () => {
    expect(casosDaPessoa(fatos({ id: "a", problemas: [caso("relato", "lento", ini - DIA)] }), ini, AGORA)).toEqual([]);
  });
});

describe("montarPainel", () => {
  const a = fatos({
    id: "a",
    cadastroEm: AGORA - 20 * DIA,
    onboardingConcluidoEm: AGORA - 20 * DIA + 3_600_000,
    diasAtivos: [new Date(AGORA - 20 * DIA).toISOString().slice(0, 10), new Date(AGORA - 10 * DIA).toISOString().slice(0, 10), "2026-11-23"],
    mensagens: 10,
    turnos: 6,
    bots: [{ tipo: "auto", criadoEm: AGORA - 20 * DIA + 2 * 3_600_000 }],
    apps: [{ slug: "github", criadoEm: AGORA - 19 * DIA }],
    primeiraTarefaEm: AGORA - 20 * DIA + 4 * 3_600_000,
    problemas: [caso("ferramenta_negada", "capacidade_desligada", AGORA - DIA, { alvo: "Bash" }), caso("turno_falhou", "erro_execucao", AGORA - 2 * DIA)],
  });
  const b = fatos({
    id: "b",
    cadastroEm: AGORA - 15 * DIA,
    onboardingEtapa: "entrevista",
    diasAtivos: [new Date(AGORA - 15 * DIA).toISOString().slice(0, 10)],
    mensagens: 2,
    bots: [{ tipo: "auto", criadoEm: AGORA - 15 * DIA }],
    problemas: [caso("ferramenta_negada", "capacidade_desligada", AGORA - 3 * DIA, { alvo: "Bash" })],
    travadas: 1,
  });
  const antiga = fatos({ id: "c", cadastroEm: AGORA - 200 * DIA, apps: [{ slug: "github", criadoEm: AGORA - 199 * DIA }], macsSemContato: 1 });
  const painel = montarPainel([a, b, antiga], AGORA, 30);

  it("crescimento: cadastros e ativos por dia, semana e mês", () => {
    expect(painel.dias).toHaveLength(30);
    expect(painel.crescimento.totalPessoas).toBe(3);
    expect(painel.crescimento.cadastrosPorDia.reduce((s, x) => s + x, 0)).toBe(2);
    expect(painel.crescimento.ativosPorDia.at(-1)).toBe(1);
    expect(painel.crescimento.ativosSemana).toBe(1);
    expect(painel.crescimento.ativosMes).toBe(2);
  });

  it("ativação: o funil é só da coorte da janela e os tempos em horas", () => {
    expect(painel.ativacao.funil.map((p) => p.pessoas)).toEqual([2, 1, 2, 1, 1]);
    const bot = painel.ativacao.tempos.find((t) => t.passo === "primeiro_bot");
    expect(bot?.pessoas).toBe(2);
    expect(bot?.medianaHoras).toBe(0);
    expect(bot?.p90Horas).toBe(2);
  });

  it("engajamento: médias das pessoas ativas, tipos de bot, apps e retenção", () => {
    expect(painel.engajamento.mensagensPorPessoa).toBe(6);
    expect(painel.engajamento.conectores).toEqual([{ nome: "github", total: 2 }]);
    expect(painel.engajamento.tiposDeBot).toEqual([{ nome: "auto", total: 2 }]);
    expect(painel.engajamento.retencao).toEqual({ coorte: 2, voltaram: 1 });
  });

  it("problemas: ranking por ocorrências com pessoas afetadas, tendência e casos", () => {
    const [topo] = painel.problemas;
    expect(topo?.chave).toBe("ferramenta_negada:capacidade_desligada");
    expect(topo?.ocorrencias).toBe(2);
    expect(topo?.pessoasAfetadas).toBe(2);
    expect(topo?.tendencia.reduce((s, x) => s + x, 0)).toBe(2);
    expect(topo?.casos[0]?.pessoa.pessoaId).toBe("a");
    expect(topo?.rotulo).toBe("Ferramenta negada: capacidade desligada");
    expect(painel.problemas.map((p) => p.chave)).toContain("onboarding_abandonado:entrevista");
  });

  it("saúde soma travadas e Macs, e as pessoas com problema vêm primeiro", () => {
    expect(painel.saude).toEqual({ travadas: 1, macsSemContato: 1, pessoasComProblema: 2 });
    expect(painel.pessoas[0]?.pessoaId).toBe("a");
  });
});

describe("montarPainelPessoa", () => {
  it("linha do tempo do mais novo ao mais antigo, com os problemas", () => {
    const f = fatos({
      id: "a",
      cadastroEm: AGORA - 5 * DIA,
      bots: [{ tipo: "auto", criadoEm: AGORA - 4 * DIA }],
      tarefas: [{ id: "t1", criadoEm: AGORA - 3 * DIA, entregueEm: AGORA - 2 * DIA }],
      problemas: [caso("ferramenta_negada", "capacidade_desligada", AGORA - DIA, { alvo: "Bash", conversaId: "c1" })],
    });
    const p = montarPainelPessoa(f, AGORA, 30);
    expect(p.linhaDoTempo.map((e) => e.tipo)).toEqual(["problema", "tarefa_entregue", "tarefa_criada", "bot_criado", "cadastro"]);
    expect(p.linhaDoTempo[0]?.rotulo).toBe("Ferramenta negada: capacidade desligada (Bash)");
    expect(p.linhaDoTempo[0]?.conversaId).toBe("c1");
    expect(p.problemas).toEqual([{ chave: "ferramenta_negada:capacidade_desligada", rotulo: "Ferramenta negada: capacidade desligada", ocorrencias: 1 }]);
  });
  it("rótulo de motivo desconhecido vira texto legível", () => {
    expect(rotuloProblema("pedido_recusado", "colunas_quadro")).toBe("Pedido recusado: colunas quadro");
    expect(rotuloProblema("mac_sem_contato", "geral")).toBe("Mac sem contato");
  });
});
