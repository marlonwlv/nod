import { describe, expect, it } from "vitest";
import type { FrotaDto } from "../../../src/contracts/api.ts";
import type { ContaIa } from "../../../src/contracts/contas-ia.ts";
import { HARNESSES } from "../../../src/contracts/harness.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import type { MaquinaDto } from "../../../src/contracts/maquina.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { capacidadesDe } from "../../../src/domain/harness.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { semIaNaMaquina } from "../../../web/telas/contas-na-maquina.ts";
import { emUsoOnde } from "../../../web/telas/contas-lista.ts";
import { renderMensagem } from "../../../web/telas/conversa.ts";

/**
 * definido em 2026-11-17: a conta aparecia "Em uso" com cota sobrando em Provedores de IA e o bot, que roda na VM, parava
 * com "nenhuma IA está pronta agora" — na VM o login de duas contas tinha vencido, uma nunca entrou e a última estava no
 * limite. O aviso agora nomeia a máquina que recusou e diz o estado de cada conta NELA.
 */
const AGORA = new Date(2026, 10, 17, 14, 0).getTime(); // hora local: a tela mostra a hora local
const VOLTA = new Date(2026, 10, 20, 5, 0).getTime();

const maquina = (id: string, nome: string, extra: Partial<MaquinaDto> = {}): MaquinaDto => ({ id, nome, prefixo: "p", criadaEm: 0, ultimoUsoEm: null, conectada: true, plataforma: "linux", ias: {}, gh: false, ...extra });
const VM = maquina("vm1", "vm-de-teste");
const MAC = maquina("mac1", "Mac-de-teste.local", { plataforma: "darwin" });
const MAC2 = maquina("mac2", "Outro-Mac.local", { plataforma: "darwin" });
const MAQUINAS = [MAC, MAC2, VM];

const conta = (id: string, apelido: string, posicao: number, maquinas: ContaIa["maquinas"], extra: Partial<ContaIa> = {}): ContaIa => ({ id, ia: "claude-cli", impressao: id, apelido, email: null, organizacao: null, plano: "Max", corporativa: false, posicao, entraNaTrocaAutomatica: true, noLimiteAte: null, maquinas, ...extra });
const na = (m: MaquinaDto, estado: ContaIa["maquinas"][number]["estado"]) => ({ maquinaId: m.id, nome: m.nome, estado });

const CONTAS: ContaIa[] = [
  conta("a", "Pessoal 20x", 1, [na(MAC, "pronta"), na(VM, "sem_login")]),
  conta("b", "Trabalho 20x", 2, [na(MAC2, "pronta"), na(VM, "sem_login")]),
  conta("c", "Equipe", 3, [na(MAC2, "pronta")]),
  conta("d", "Conta 1", 4, [na(VM, "pronta")], { noLimiteAte: VOLTA }),
];

describe("semIaNaMaquina: o estado de cada conta na máquina que recusou", () => {
  it("o caso relatado: login vencido, limite e nunca entrou, cada um com o nome da conta", () => {
    const r = semIaNaMaquina({ maquina: VM, maquinas: MAQUINAS, contas: CONTAS, agora: AGORA });
    expect(r.nome).toBe("vm-de-teste");
    expect(r.frase).toBe("Contas nessa máquina: Conta 1 está no limite até 20/11 às 05:00; Pessoal 20x e Trabalho 20x precisam entrar de novo; Equipe nunca entrou nela.");
  });

  it("a conta pronta e livre vem primeiro; a pronta fora da fila diz que está fora da fila", () => {
    const contas = [conta("a", "Pessoal", 1, [na(VM, "pronta")]), conta("b", "Corporativa", 2, [na(VM, "pronta")], { entraNaTrocaAutomatica: false })];
    expect(semIaNaMaquina({ maquina: VM, maquinas: MAQUINAS, contas, agora: AGORA }).frase).toBe("Contas nessa máquina: Pessoal já está pronta; Corporativa está pronta, mas fora da fila.");
  });

  it("o limite lido pela cota (a barra 100%) também conta, sem a marca da conta", () => {
    const contas = [conta("a", "Pessoal", 1, [na(VM, "pronta")], { cota: { cincoHoras: null, semana: null, situacao: "limite", voltaEm: VOLTA, medidoEm: AGORA } })];
    expect(semIaNaMaquina({ maquina: VM, maquinas: MAQUINAS, contas, agora: AGORA }).frase).toContain("Pessoal está no limite até 20/11 às 05:00");
  });

  it("bot fixado numa IA: só as contas dela; com duas IAs, o nome leva o provedor", () => {
    const contas = [...CONTAS.slice(0, 1), conta("x", "Plus", 5, [na(VM, "sem_acesso")], { ia: "codex-cli" })];
    expect(semIaNaMaquina({ maquina: VM, maquinas: MAQUINAS, contas, agora: AGORA, ia: "codex-cli" }).frase).toBe("Contas nessa máquina: Plus perdeu o acesso.");
    expect(semIaNaMaquina({ maquina: VM, maquinas: MAQUINAS, contas, agora: AGORA }).frase).toContain("Claude · Pessoal 20x precisa entrar de novo");
  });

  it("mais de três contas no mesmo grupo: três nomes e 'e mais N'; sem conta, nenhuma frase", () => {
    const contas = ["A", "B", "C", "D", "E"].map((n, i) => conta(n, n, i, []));
    expect(semIaNaMaquina({ maquina: VM, maquinas: MAQUINAS, contas, agora: AGORA }).frase).toBe("Contas nessa máquina: A, B, C e mais 2 nunca entraram nela.");
    expect(semIaNaMaquina({ maquina: VM, maquinas: MAQUINAS, contas: [], agora: AGORA }).frase).toBeNull();
  });
});

describe("emUsoOnde: o selo 'Em uso' diz onde quando a conta não serve a todas as máquinas", () => {
  it("pronta só num Mac: diz qual; pronta em todas as conectadas: 'Em uso'", () => {
    expect(emUsoOnde(CONTAS[0]!, { maquinas: MAQUINAS })).toBe("Em uso na Mac-de-teste.local");
    const todas = conta("t", "T", 1, MAQUINAS.map((m) => na(m, "pronta")));
    expect(emUsoOnde(todas, { maquinas: MAQUINAS })).toBe("Em uso");
    const duas = conta("t", "T", 1, [na(MAC, "pronta"), na(MAC2, "pronta")]);
    expect(emUsoOnde(duas, { maquinas: MAQUINAS })).toBe("Em uso na Mac-de-teste.local e mais 1");
  });

  it("máquina desconectada ou só-computador não entra na conta", () => {
    const maquinas = [MAC, { ...VM, conectada: false }, maquina("c1", "so-tela", { papel: "computador" })];
    expect(emUsoOnde(CONTAS[0]!, { maquinas })).toBe("Em uso");
  });
});

describe("aviso 'nenhuma IA está pronta' na conversa", () => {
  const SEM_LOGIN: Inventario = { estado: "nao_autenticado", motivo: "x", em: 0 };
  const autoria = { autor_tipo: "agente", autor_id: "bot1", conta_de_execucao: "p1", executor: "claude-cli", locality_reason: "motor_ausente" } as unknown as Mensagem["autoria"];
  const negacao = (extra: { maquina?: string } = {}): Mensagem => ({ tenantId: "t", id: "m1", conversaId: "c1", turnoId: "t1", autoria, kind: "negacao", texto: "Nenhum trabalho começa: executor indisponível (nenhuma IA pronta na máquina deste bot) desde 14:51.", payload: { kind: "negacao", classe: "plano_ausente", nome: "claude-cli", motivo: "plano_ausente", terminal: true, ...extra }, confianca: "confiavel", parcial: false, criadoEm: AGORA - 60_000 });
  const estado = (p: { maquinaDoBot?: string | null; maquinas?: MaquinaDto[] } = {}): Estado => {
    const opcoes = HARNESSES.map((h) => ({ ...h, capacidades: capacidadesDe(h.id), inventario: SEM_LOGIN }));
    return {
      ...estadoInicial,
      agora: AGORA,
      sessao: { tenantId: "t", pessoaId: "p1" },
      inventario: SEM_LOGIN,
      frota: { agentes: [{ id: "bot1", nome: "Bot", harness: "auto", modelo: "auto", conversaId: "c1", ownerId: "p1", excluidoEm: null, maquinaId: p.maquinaDoBot ?? null }], negacoes: [] } as unknown as FrotaDto,
      executor: { atual: "claude-cli", opcoes: [], recusa: null, harnesses: { padrao: null, simulacao: false, legado: "claude-cli", opcoes } },
      maquinas: { maquinas: p.maquinas ?? MAQUINAS, padraoId: null },
      contasIa: { disponivel: true, modo: "automatico", contas: CONTAS },
    };
  };

  it("com a máquina na negação: nomeia a máquina, diz o estado das contas nela e abre as contas DELA", () => {
    const html = renderMensagem(negacao({ maquina: "vm1" }), estado());
    expect(html).toContain("Bot não pôde começar: nenhuma IA está pronta agora na vm-de-teste. Contas nessa máquina: Conta 1 está no limite até 20/11 às 05:00; Pessoal 20x e Trabalho 20x precisam entrar de novo; Equipe nunca entrou nela. Sua mensagem fica guardada");
    expect(html).toMatch(/data-act="cl-gerenciar" data-maquina="vm1">Ver contas na vm-de-teste</);
    expect(html).not.toContain(">Conectar IA<");
  });

  it("apelido e nome de máquina com HTML saem escapados", () => {
    const e = estado({ maquinas: [maquina("vm1", "<b>vm</b>")] });
    const html = renderMensagem(negacao({ maquina: "vm1" }), { ...e, contasIa: { disponivel: true, modo: "automatico", contas: [conta("a", "<img src=x>", 1, [])] } });
    expect(html).not.toContain("<img src=x>");
    expect(html).not.toContain("<b>vm</b>");
    expect(html).toContain("&lt;img src=x&gt; nunca entrou nela");
  });

  it("negação antiga, sem a máquina: usa a máquina do bot", () => {
    const html = renderMensagem(negacao(), estado({ maquinaDoBot: "vm1" }));
    expect(html).toContain("nenhuma IA está pronta agora na vm-de-teste.");
  });

  it("máquina sem contato: diz isso e leva a Máquinas", () => {
    const html = renderMensagem(negacao({ maquina: "vm1" }), estado({ maquinas: [MAC, MAC2, { ...VM, conectada: false }] }));
    expect(html).toContain("nenhuma IA está pronta agora na vm-de-teste. A vm-de-teste está sem contato com o Nod.");
    expect(html).toMatch(/data-secao="maquinas">Ver máquinas</);
  });

  it("sem saber a máquina: o aviso de sempre, com Conectar IA", () => {
    const html = renderMensagem(negacao(), estado());
    expect(html).toContain("Bot não pôde começar: nenhuma IA está pronta agora. Sua mensagem fica guardada");
    expect(html).toMatch(/data-secao="conexao">Conectar IA</);
  });
});
