import { describe, expect, it } from "vitest";
import { IDS_DESVIO, type IdDesvio } from "../../../src/contracts/desvio.ts";
import { cartaoDoDesvio, decidirRecuperacao, DESVIOS, linhaDaRecuperacao, reconhecerDesvio, TETO_TENTATIVAS_DA_MENSAGEM, type ContextoDaTentativa, type FatosDoFim, IA_SEM_NOME, type NomesDoDesvio } from "../../../src/domain/desvios-da-conversa.ts";

/**
 * Lote B das Jornadas da IA (2026-11-22): a tabela dos 12 desvios do momento B, caminho por caminho. Estes testes travam
 * as regras do lote: como cada desvio se reconhece, a ordem da recuperação, os tetos e que nenhuma frase mostra termo
 * interno.
 */
const AGORA = Date.UTC(2026, 10, 22, 15, 0);
const fim = (f: Partial<FatosDoFim>): FatosDoFim => ({ estado: "interrompido", motivoInterrupcao: "sem_progresso", motivoFalha: "erro_execucao", erroCru: null, ...f });
const ctx = (c: Partial<ContextoDaTentativa> = {}): ContextoDaTentativa => ({ tentativas: 0, repetidasPorEste: 0, pararSolicitado: false, proximaConta: false, outraIa: false, ...c });

describe("a tabela tem os 12 desvios do Paper, na ordem", () => {
  it("números 1 a 12, um por id", () => {
    expect(IDS_DESVIO.map((id) => DESVIOS[id].numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
  it("outra máquina nunca é automática (regra 5: sempre botão)", () => {
    for (const id of IDS_DESVIO) expect(DESVIOS[id].recuperacao, id).not.toContain("outra_maquina");
  });
});

describe("reconhecer o desvio pelo fim do turno", () => {
  const casos: [string, Partial<FatosDoFim>, IdDesvio | null][] = [
    ["1 · No conversation found (com result de erro)", { erroCru: "error_during_execution | No conversation found with session ID: abc" }, "sessao_sumiu"],
    ["1 · sessão rejeitada antes de começar", { motivoInterrupcao: "sessao_rejeitada", motivoFalha: null }, "sessao_sumiu"],
    ["2 · OAuth session expired", { erroCru: "success | Failed to authenticate: OAuth session expired and could not be refreshed" }, "login_vencido"],
    ["2 · 401 do Codex", { erroCru: "401 Unauthorized" }, "login_vencido"],
    ["3 · limite com o bot preso a uma IA", { motivoFalha: "limite_do_plano", botFixo: true }, "limite_bot_fixo"],
    ["3 · limite do Codex em texto, bot preso", { erroCru: "You've hit your usage limit. Try again at 8:00 AM.", botFixo: true }, "limite_bot_fixo"],
    ["4 · limite pelo protocolo", { motivoFalha: "limite_do_plano" }, "limite"],
    ["4 · limite do Codex em texto", { erroCru: "You've hit your usage limit." }, "limite"],
    ["5 · sobrecarga", { erroCru: "API Error: 529 overloaded_error" }, "instavel"],
    ["5 · rede caiu", { erroCru: "stream disconnected before completion" }, "instavel"],
    ["6 · nenhuma IA pronta", { motivoInterrupcao: "executor_indisponivel", motivoFalha: "nao_autenticado" }, "sem_ia_pronta"],
    ["8 · a organização tirou o acesso", { motivoFalha: "nao_autenticado", causaSemIa: "conta_sem_acesso" }, "sem_acesso"],
    ["9 · a IA não abriu", { motivoInterrupcao: "lancamento_falhou", motivoFalha: null }, "ia_nao_abriu"],
    ["10 · erro sem texto", { erroCru: null }, "erro_desconhecido"],
    ["10 · erro que o nod não conhece", { erroCru: "success | something odd happened" }, "erro_desconhecido"],
    ["11 · o servidor reiniciou", { queda: "reinicio_servidor", motivoInterrupcao: "reinicio_servidor", motivoFalha: null }, "nod_atualizou"],
    ["11 · o motor reiniciou", { queda: "reinicio_do_motor", motivoInterrupcao: "reinicio_do_motor", motivoFalha: null }, "nod_atualizou"],
    ["12 · a máquina parou de responder", { queda: "maquina_sem_contato", motivoInterrupcao: "maquina_sem_contato", motivoFalha: null }, "computador_dormiu"],
    ["não é desvio · concluiu", { estado: "concluido", motivoInterrupcao: null, motivoFalha: null }, null],
    ["não é desvio · a pessoa parou", { motivoInterrupcao: "parado_pela_pessoa", motivoFalha: null }, null],
    ["não é desvio · contexto cheio (a frase própria manda compactar)", { erroCru: "Prompt is too long" }, null],
    ["não é desvio · teto de gasto da organização", { erroCru: "You've hit your monthly spend limit" }, null],
  ];
  for (const [nome, f, esperado] of casos) it(nome, () => expect(reconhecerDesvio(fim(f))).toBe(esperado));
});

describe("a recuperação segue a ordem e para nos tetos", () => {
  it("1 · sessão sumiu: repete uma vez na mesma conta; na segunda, o cartão", () => {
    expect(decidirRecuperacao("sessao_sumiu", ctx())).toEqual({ tipo: "repetir", onde: "mesma_conta", esperaMs: 0 });
    expect(decidirRecuperacao("sessao_sumiu", ctx({ tentativas: 1, repetidasPorEste: 1 }))).toEqual({ tipo: "parar", forma: "cartao" });
  });
  it("2 · login vencido: próxima conta; sem ela, outra IA; sem nenhuma, a mensagem espera o login", () => {
    expect(decidirRecuperacao("login_vencido", ctx({ proximaConta: true, outraIa: true }))).toMatchObject({ tipo: "repetir", onde: "proxima_conta" });
    expect(decidirRecuperacao("login_vencido", ctx({ outraIa: true }))).toMatchObject({ tipo: "repetir", onde: "outra_ia" });
    expect(decidirRecuperacao("login_vencido", ctx())).toEqual({ tipo: "parar", forma: "espera" });
  });
  it("2 · login vencido nunca repete na mesma conta (repetir dá o mesmo)", () => {
    expect(DESVIOS.login_vencido.repeticoes).toBe(0);
  });
  it("3 · bot preso a uma IA: só a próxima conta DESSA IA; nunca outra IA sozinho (regra 5)", () => {
    expect(decidirRecuperacao("limite_bot_fixo", ctx({ proximaConta: true, outraIa: true }))).toMatchObject({ onde: "proxima_conta" });
    expect(decidirRecuperacao("limite_bot_fixo", ctx({ outraIa: true }))).toEqual({ tipo: "parar", forma: "espera" });
  });
  it("4 · limite: próxima conta, outra IA, senão espera a hora real", () => {
    expect(decidirRecuperacao("limite", ctx({ proximaConta: true }))).toMatchObject({ onde: "proxima_conta" });
    expect(decidirRecuperacao("limite", ctx({ outraIa: true }))).toMatchObject({ onde: "outra_ia" });
    expect(decidirRecuperacao("limite", ctx())).toEqual({ tipo: "parar", forma: "espera" });
  });
  it("5 · instável: 30 s, 2 min, depois a próxima IA, depois o cartão", () => {
    expect(decidirRecuperacao("instavel", ctx({ outraIa: true }))).toEqual({ tipo: "repetir", onde: "mesma_conta", esperaMs: 30_000 });
    expect(decidirRecuperacao("instavel", ctx({ outraIa: true, tentativas: 1, repetidasPorEste: 1 }))).toEqual({ tipo: "repetir", onde: "mesma_conta", esperaMs: 120_000 });
    expect(decidirRecuperacao("instavel", ctx({ outraIa: true, tentativas: 2, repetidasPorEste: 2 }))).toMatchObject({ onde: "outra_ia" });
    expect(decidirRecuperacao("instavel", ctx({ tentativas: 2, repetidasPorEste: 2 }))).toEqual({ tipo: "parar", forma: "cartao" });
  });
  it("6 e 7 · sem IA e computador fora: nada automático, a mensagem espera", () => {
    expect(decidirRecuperacao("sem_ia_pronta", ctx({ outraIa: true }))).toEqual({ tipo: "parar", forma: "espera" });
    expect(decidirRecuperacao("computador_fora", ctx({ outraIa: true }))).toEqual({ tipo: "parar", forma: "espera" });
  });
  it("8 · sem acesso: próxima conta, outra IA, senão espera uma conta nova", () => {
    expect(decidirRecuperacao("sem_acesso", ctx({ proximaConta: true }))).toMatchObject({ onde: "proxima_conta" });
    expect(decidirRecuperacao("sem_acesso", ctx())).toEqual({ tipo: "parar", forma: "espera" });
  });
  it("9 · a IA não abriu: direto o cartão (outra máquina só por botão)", () => {
    expect(decidirRecuperacao("ia_nao_abriu", ctx({ outraIa: true, proximaConta: true }))).toEqual({ tipo: "parar", forma: "cartao" });
  });
  it("10 · erro desconhecido: uma repetição, depois o cartão", () => {
    expect(decidirRecuperacao("erro_desconhecido", ctx())).toEqual({ tipo: "repetir", onde: "mesma_conta", esperaMs: 0 });
    expect(decidirRecuperacao("erro_desconhecido", ctx({ tentativas: 1, repetidasPorEste: 1, outraIa: true }))).toEqual({ tipo: "parar", forma: "cartao" });
  });
  it("11 · o nod atualizou: volta sozinho uma vez; o cartão só se a volta falhar", () => {
    expect(decidirRecuperacao("nod_atualizou", ctx())).toMatchObject({ tipo: "repetir", onde: "mesma_conta" });
    expect(decidirRecuperacao("nod_atualizou", ctx({ tentativas: 1, repetidasPorEste: 1 }))).toEqual({ tipo: "parar", forma: "cartao" });
  });
  it("12 · o computador dormiu: espera ele voltar", () => {
    expect(decidirRecuperacao("computador_dormiu", ctx({ outraIa: true }))).toEqual({ tipo: "parar", forma: "espera" });
  });
  it(`teto da mensagem: com ${TETO_TENTATIVAS_DA_MENSAGEM} tentativas somadas, nenhum desvio tenta mais`, () => {
    for (const id of IDS_DESVIO) expect(decidirRecuperacao(id, ctx({ tentativas: TETO_TENTATIVAS_DA_MENSAGEM, proximaConta: true, outraIa: true })).tipo, id).toBe("parar");
  });
  it("a pessoa pediu para parar: nada se repete", () => {
    for (const id of IDS_DESVIO) expect(decidirRecuperacao(id, ctx({ pararSolicitado: true, proximaConta: true, outraIa: true })).tipo, id).toBe("parar");
  });
});

describe("as frases (regra 7): sem termos internos, com a conta e a máquina certas", () => {
  const nomes: NomesDoDesvio[] = [
    { bot: "Dino", ia: "Claude", conta: "Claude · Pessoal", contaQueSeguiu: "Claude · Trabalho", outraIa: "ChatGPT", maquina: "MacBook do escritório", outraMaquina: { id: "m2", nome: "VM do nod" }, organizacao: "Exemplo Ltda" },
    { bot: "Dino", ia: "ChatGPT", maquina: "VM sp-01" },
    { bot: "Dino", ia: "Claude" },
    // O Automático antes do plano: o turno não diz a IA e a frase leva o artigo feminino ("a sua IA", "da sua IA").
    { bot: "Dino", ia: IA_SEM_NOME },
  ];
  const PROIBIDO = /claude-cli|codex-cli|executor|nao_autenticado|erro_execucao|undefined|null|NaN|tente de novo|\b(o|do|no) sua IA/i;
  for (const id of IDS_DESVIO) {
    it(`${DESVIOS[id].numero} · ${DESVIOS[id].titulo}`, () => {
      for (const n of nomes) {
        const cartao = cartaoDoDesvio(id, n, { agora: AGORA, ate: AGORA + 3 * 3_600_000, turnoId: "t1", contaId: "c1", maquinaId: "m1", relatado: true });
        expect(`${cartao.titulo} ${cartao.texto} ${cartao.botoes.map((b) => b.rotulo).join(" ")}`).not.toMatch(PROIBIDO);
        expect(cartao.titulo.length, "todo cartão tem título").toBeGreaterThan(0);
        for (const onde of ["mesma_conta", "proxima_conta", "outra_ia"] as const) {
          expect(linhaDaRecuperacao(id, onde, n, { agora: AGORA, esperaMs: 30_000, tentativa: 1 }).texto).not.toMatch(PROIBIDO);
        }
      }
    });
  }
  it("a VM leva artigo feminino e o MacBook, masculino", () => {
    expect(cartaoDoDesvio("computador_dormiu", { bot: "Dino", ia: "Claude", maquina: "VM sp-01" }, { agora: AGORA }).titulo).toBe("A VM sp-01 parou de responder");
    expect(cartaoDoDesvio("computador_dormiu", { bot: "Dino", ia: "Claude", maquina: "MacBook do escritório" }, { agora: AGORA }).titulo).toBe("O MacBook do escritório parou de responder");
  });
  it("sem o nome da IA, o artigo é feminino: 'A sua IA está instável', 'conta da sua IA'", () => {
    expect(linhaDaRecuperacao("instavel", "mesma_conta", { bot: "Dino", ia: IA_SEM_NOME }, { agora: AGORA, esperaMs: 30_000, tentativa: 1 }).texto).toBe("A sua IA está instável. Tentando de novo em 30 s (1 de 3).");
    expect(linhaDaRecuperacao("erro_desconhecido", "mesma_conta", { bot: "Dino", ia: IA_SEM_NOME }, { agora: AGORA }).texto).toBe("A conta da sua IA parou com um erro. Tentando de novo uma vez.");
  });
  it("9 · a IA não abriu: 'Reinstalar e tentar' (a máquina e a IA do turno) e a outra máquina como segunda saída", () => {
    const c = cartaoDoDesvio("ia_nao_abriu", { bot: "Dino", ia: "Claude", maquina: "MacBook do escritório", outraMaquina: { id: "m2", nome: "VM do nod" } }, { agora: AGORA, turnoId: "t1", maquinaId: "m1", ia: "claude-cli" });
    expect(c.titulo).toBe("O Claude não abriu no MacBook do escritório");
    expect(c.texto).toBe("O nod reinstala a cópia dele e tenta de novo. Se preferir, roda em outra máquina agora.");
    expect(c.botoes).toEqual([
      { acao: "reinstalar_e_tentar", rotulo: "Reinstalar e tentar", dados: { turnoId: "t1", maquinaId: "m1", ia: "claude-cli" } },
      expect.objectContaining({ acao: "rodar_em_outra_maquina", rotulo: "Rodar na VM do nod" }),
    ]);
    // Sem a IA do turno (o Automático antes do plano), não há o que reinstalar: fica o caminho de antes.
    expect(cartaoDoDesvio("ia_nao_abriu", { bot: "Dino", ia: "Claude", maquina: "MacBook do escritório" }, { agora: AGORA, turnoId: "t1", maquinaId: "m1", ia: "auto" }).botoes).toEqual([]);
  });
  it("4 · sem a hora do fornecedor: 'volta sem hora', nunca uma hora inventada", () => {
    const c = cartaoDoDesvio("limite", { bot: "Dino", ia: "ChatGPT", conta: "ChatGPT · Pessoal" }, { agora: AGORA, ate: null, turnoId: "t1" });
    expect(c.titulo).toBe("A ChatGPT · Pessoal chegou ao limite · volta sem hora");
    expect(c.texto).not.toMatch(/\d{1,2}:\d{2}/);
  });
  it("todo cartão de espera traz a espera (a mensagem sai sozinha)", () => {
    for (const id of IDS_DESVIO) {
      if (DESVIOS[id].semSaida !== "espera") continue;
      expect(cartaoDoDesvio(id, nomes[0]!, { agora: AGORA, turnoId: "t1" }).espera, id).toBeDefined();
    }
  });
  it("10 · o cartão do erro desconhecido diz que o relato foi para o time quando foi", () => {
    expect(cartaoDoDesvio("erro_desconhecido", nomes[0]!, { agora: AGORA, relatado: true }).texto).toContain("O relato foi para o time do nod");
    expect(cartaoDoDesvio("erro_desconhecido", nomes[0]!, { agora: AGORA, relatado: false }).texto).not.toContain("relato");
  });
});

describe("4 · a hora real do limite pela leitura de cota (regra 4)", () => {
  it("a janela cheia que renova por último; sem janela cheia com hora, null (nunca um palpite)", async () => {
    const { voltaPelaLeituraDaCota } = await import("../../../src/domain/uso-do-plano.ts");
    const uso = (c: number, s: number, rc: number | null, rs: number | null) => ({ harness: "codex-cli" as const, situacao: "esgotado" as const, cincoHoras: { utilizacao: c, renovaEm: rc }, semana: { utilizacao: s, renovaEm: rs }, medidoEm: AGORA });
    expect(voltaPelaLeituraDaCota(uso(1, 1, AGORA + 3_600_000, AGORA + 9 * 3_600_000), AGORA)).toBe(AGORA + 9 * 3_600_000);
    expect(voltaPelaLeituraDaCota(uso(0.4, 1, AGORA + 3_600_000, AGORA + 9 * 3_600_000), AGORA)).toBe(AGORA + 9 * 3_600_000);
    expect(voltaPelaLeituraDaCota(uso(0.4, 0.98, AGORA + 3_600_000, AGORA + 9 * 3_600_000), AGORA)).toBeNull();
    expect(voltaPelaLeituraDaCota(uso(1, 0.2, null, AGORA + 9 * 3_600_000), AGORA)).toBeNull();
    expect(voltaPelaLeituraDaCota(undefined, AGORA)).toBeNull();
  });
});
