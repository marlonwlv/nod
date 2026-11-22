import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Agente } from "../../src/contracts/agente.ts";
import type { RespostaMutacao } from "../../src/contracts/api.ts";
import type { ContasIaDto } from "../../src/contracts/contas-ia.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { EstadoOnboarding } from "../../src/contracts/onboarding.ts";
import type { Turno } from "../../src/contracts/turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { contaFalsa, maquinaFalsa, PRONTO, type MaquinaFalsa } from "../helpers/maquina-falsa-http.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { telaDaConversa, VARIACOES, type TelaDaConversa } from "../helpers/tela-da-conversa.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * Lote B das Jornadas da IA ("Mandar uma mensagem", 2026-11-22): cada caminho do momento B de ponta a ponta — o servidor
 * compartilhado de verdade, máquinas de mentira pela ponte HTTP devolvendo o erro real do fornecedor, e a conversa aberta
 * no app montado num Chrome headless. O teste confere a tela (a linha ou o cartão, o botão, a resposta que chega depois);
 * com NOD_AUDITORIA_DIR, grava os prints numerados de cada passo em claro, escuro e celular para a auditoria.
 */
const WEB = join(process.cwd(), "dist/web");
const DIR = process.env.NOD_AUDITORIA_DIR ?? null;
const chrome = existsSync(join(WEB, "index.html")) ? (() => { try { return acharChrome(); } catch { return null; } })() : null;
const descrever = chrome ? describeIntegracao : (n: string, f: () => void) => describeIntegracao(`${n} (sem Chrome ou sem a web montada: pulado)`, () => it.skip("sem Chrome", f));

descrever("Jornadas da IA · lote B: mandar uma mensagem", () => {
  let srv: ServidorCompleto;
  let tela: TelaDaConversa;
  const criados = { agentes: [] as string[], conversas: [] as string[] };

  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_MODO: "compartilhado", NOD_STATIC_DIR: WEB, NOD_LONGPOLL_MS: "150" } });
    await srv.json<EstadoOnboarding>("GET", "onboarding");
    await srv.json<EstadoOnboarding>("POST", "onboarding/concluir", {});
    tela = await telaDaConversa({ url: srv.url, cookie: srv.pessoa.cookie });
  }, 60_000);

  afterAll(async () => {
    await tela?.fechar();
    if (!srv) return;
    await srv.fechar();
    await srv.db.begin(async (tx) => { await vincularEscopo(tx, srv.pessoa); await tx`delete from maquina_tokens where owner_id = ${srv.pessoa.pessoaId}`; });
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, criados);
    await srv.desligar();
  }, 60_000);

  async function bot(nome: string): Promise<{ agenteId: string; conversaId: string }> {
    const r = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome });
    criados.agentes.push(r.agente.id);
    criados.conversas.push(r.conversa.id);
    return { agenteId: r.agente.id, conversaId: r.conversa.id };
  }

  async function enviar(conversaId: string, texto: string): Promise<string> {
    const r = await srv.json<RespostaMutacao>("POST", `conversas/${conversaId}/mensagens`, { texto });
    return r.ids.turno ?? "";
  }

  async function assentado(turnoId: string): Promise<Turno> {
    return srv.esperar(async () => {
      const { turno } = await srv.json<{ turno: Turno }>("GET", `turnos/${turnoId}`);
      return ["concluido", "interrompido", "falhou", "cancelado"].includes(turno.estado) ? turno : null;
    }, { nome: `turno ${turnoId} assentado`, timeoutMs: 15_000 });
  }

  /** Os prints de um passo do caminho, nas três variações; `pronto` é o que a tela tem de mostrar. */
  async function printar(caminho: string, passo: string, conversaId: string, pronto: string): Promise<string> {
    let texto = "";
    for (const v of VARIACOES) {
      texto = await tela.abrir({ conversaId, variacao: v, pronto });
      if (DIR) await tela.print(join(DIR, caminho, `${passo}-${v.nome}.png`));
    }
    return texto;
  }

  let mac: MaquinaFalsa;
  beforeAll(async () => {
    // As contas que a máquina tem logadas (ADR-102), como o app anuncia: a do Claude e a do ChatGPT, a 1ª de cada IA na fila.
    mac = await maquinaFalsa(srv, { nome: "MacBook de teste", plataforma: "darwin", harnesses: { "claude-cli": PRONTO("2.1.327"), "codex-cli": PRONTO("0.159.0") }, contas: [contaFalsa(1, "claude-cli", "Pessoal"), contaFalsa(2, "codex-cli", "Pessoal")] });
  }, 30_000);

  const SINAIS_SEM_SAIDA = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false };
  const SESSAO_SUMIU = { desfecho: "falha", motivoFalha: "erro_execucao", erroCru: "error_during_execution | No conversation found with session ID: 6413c71a-b189-4a59-8388-a5738582fdd2", sinais: SINAIS_SEM_SAIDA } as const;
  const ERRO_ESTRANHO = { desfecho: "falha", motivoFalha: "erro_execucao", erroCru: "success | Unexpected token in stream at position 4182", sinais: SINAIS_SEM_SAIDA } as const;
  const NAO_ABRIU = { desfecho: "interrompido", motivoInterrupcao: "lancamento_falhou", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false } } as const;
  // Só a conversa aberta (a barra lateral repete a última linha de cada bot) e já carregada.
  const tem = (t: string) => `(() => { const tl = [...document.querySelectorAll('.timeline')].find((x) => x.offsetParent !== null); return !!tl && !document.querySelector('.carregando-conversa') && tl.innerText.includes(${JSON.stringify(t)}); })()`;

  it("caminho feliz: a pessoa escreve e o bot responde", async () => {
    const { conversaId } = await bot("Bot feliz");
    const turnoId = await enviar(conversaId, "Resume a call de hoje");
    const plano = await mac.puxarAte();
    expect(plano.turnoId).toBe(turnoId);
    expect(await mac.entregar(plano, { desfecho: "sucesso", texto: "Resumi a call: três decisões e dois próximos passos." })).toBe(200);
    expect((await assentado(turnoId)).estado).toBe("concluido");
    await printar("00-caminho-feliz", "01-resposta", conversaId, tem("três decisões"));
  }, 120_000);

  it("desvio 1 · a sessão sumiu: o nod recomeça pelo histórico, com uma linha, e a resposta chega", async () => {
    const { conversaId } = await bot("QA Nod");
    const turnoId = await enviar(conversaId, "Você não está mergeando os PRs que abre?");
    expect(await mac.entregar(await mac.puxarAte(), SESSAO_SUMIU)).toBe(200);
    await assentado(turnoId);
    const repeticao = await mac.puxarAte();
    expect(repeticao.turnoId).not.toBe(turnoId);
    await printar("desvio-01-sessao-sumiu/a-recomecou", "01-linha", conversaId, tem("recomeçou pelo histórico"));
    expect(await mac.entregar(repeticao, { desfecho: "sucesso", texto: "Não, de propósito: merge só sai com pedido seu. Os três PRs estão com a CI verde." })).toBe(200);
    await assentado(repeticao.turnoId);
    const texto = await printar("desvio-01-sessao-sumiu/a-recomecou", "02-resposta", conversaId, tem("CI verde"));
    expect(texto).not.toMatch(/tente de novo|claude-cli|erro_execucao/);
  }, 180_000);

  it("desvio 1 · se o nod falhar: a sessão nova também para — o cartão com o motivo e as saídas", async () => {
    const { conversaId } = await bot("QA Nod 2");
    const turnoId = await enviar(conversaId, "Você não está mergeando os PRs que abre?");
    expect(await mac.entregar(await mac.puxarAte(), SESSAO_SUMIU)).toBe(200);
    await assentado(turnoId);
    const repeticao = await mac.puxarAte();
    expect(await mac.entregar(repeticao, SESSAO_SUMIU)).toBe(200);
    await assentado(repeticao.turnoId);
    const texto = await printar("desvio-01-sessao-sumiu/b-se-falhar", "01-cartao", conversaId, tem("não conseguiu recomeçar"));
    expect(texto).toContain("Responder com o ChatGPT desta vez");
    expect(texto).not.toMatch(/tente de novo|claude-cli|erro_execucao/);
  }, 180_000);

  it("desvio 10 · erro desconhecido: tenta uma vez sozinho, com uma linha, e responde", async () => {
    const { conversaId } = await bot("Bot da planilha");
    const turnoId = await enviar(conversaId, "Atualiza a planilha de custos");
    expect(await mac.entregar(await mac.puxarAte(), ERRO_ESTRANHO)).toBe(200);
    await assentado(turnoId);
    const repeticao = await mac.puxarAte();
    await printar("desvio-10-erro-desconhecido/a-tentou-de-novo", "01-linha", conversaId, tem("Tentando de novo uma vez"));
    expect(await mac.entregar(repeticao, { desfecho: "sucesso", texto: "Atualizei a planilha: a linha de novembro entrou." })).toBe(200);
    await assentado(repeticao.turnoId);
    await printar("desvio-10-erro-desconhecido/a-tentou-de-novo", "02-resposta", conversaId, tem("linha de novembro"));
  }, 180_000);

  it("desvio 10 · o mesmo erro duas vezes: o cartão avisa o relato e responde com a outra IA pelo botão", async () => {
    const { conversaId } = await bot("Bot dos custos");
    const turnoId = await enviar(conversaId, "Atualiza a planilha de custos");
    expect(await mac.entregar(await mac.puxarAte(), ERRO_ESTRANHO)).toBe(200);
    await assentado(turnoId);
    const repeticao = await mac.puxarAte();
    expect(await mac.entregar(repeticao, ERRO_ESTRANHO)).toBe(200);
    await assentado(repeticao.turnoId);
    const texto = await printar("desvio-10-erro-desconhecido/b-duas-vezes", "01-cartao", conversaId, tem("parou duas vezes"));
    expect(texto).toContain("O relato foi para o time do nod");
    // O botão "Responder com o ChatGPT desta vez": o turno volta, fixo no Codex só desta vez.
    await tela.avaliar(`document.querySelector('[data-act="responder-com-outra-ia"]').click()`);
    const outra = await mac.puxarAte();
    expect(outra.harness).toBe("codex-cli");
    expect(await mac.entregar(outra, { desfecho: "sucesso", texto: "Pelo ChatGPT: a planilha de custos está atualizada." })).toBe(200);
    await assentado(outra.turnoId);
    await printar("desvio-10-erro-desconhecido/b-duas-vezes", "02-respondeu-pelo-chatgpt", conversaId, tem("Pelo ChatGPT"));
  }, 180_000);

  const LOGIN_VENCEU = { desfecho: "falha", motivoFalha: "erro_execucao", erroCru: "success | Failed to authenticate: OAuth session expired and could not be refreshed", sinais: SINAIS_SEM_SAIDA } as const;
  /** A pessoa entra de novo na conta do Claude: a máquina reanuncia com um login mais novo que a marca do servidor. */
  const entrarDeNovoNoClaude = () => mac.mudar({ contas: [contaFalsa(1, "claude-cli", "Pessoal", { logadaEm: Date.now() }), contaFalsa(2, "codex-cli", "Pessoal")] });

  it("desvio 2 · o login venceu e há outra conta: segue nela, com a linha e o Entrar de novo", async () => {
    const { conversaId } = await bot("Bot do PR");
    const turnoId = await enviar(conversaId, "Revisa o PR #224?");
    const plano = await mac.puxarAte();
    expect(plano.harness).toBe("claude-cli");
    expect(await mac.entregar(plano, LOGIN_VENCEU)).toBe(200);
    await assentado(turnoId);
    const naOutra = await mac.puxarAte();
    expect(naOutra.harness).toBe("codex-cli");
    await printar("desvio-02-login-vencido/a-outra-conta", "01-linha", conversaId, tem("venceu"));
    expect(await mac.entregar(naOutra, { desfecho: "sucesso", texto: "Revisei. Dois pontos no teste novo, comentei no PR." })).toBe(200);
    await assentado(naOutra.turnoId);
    const texto = await printar("desvio-02-login-vencido/a-outra-conta", "02-resposta", conversaId, tem("Dois pontos"));
    expect(texto).toContain("Respondendo com a ChatGPT · Pessoal");
    expect(texto).toContain("Entrar de novo");
    await entrarDeNovoNoClaude();
  }, 180_000);

  it("desvio 2 · o login venceu e não há outra conta: a mensagem espera, a pessoa entra de novo e ela sai sozinha", async () => {
    const { agenteId, conversaId } = await bot("Bot só Claude");
    await srv.json("PUT", `agentes/${agenteId}/inteligencia`, { modo: "fixa", fixa: "claude-cli" });
    const turnoId = await enviar(conversaId, "Revisa o PR #225?");
    expect(await mac.entregar(await mac.puxarAte(), LOGIN_VENCEU)).toBe(200);
    await assentado(turnoId);
    const texto = await printar("desvio-02-login-vencido/b-sem-outra-conta", "01-cartao", conversaId, tem("Entre de novo"));
    expect(texto).toContain("O login da Claude · Pessoal venceu no MacBook de teste");
    expect(await mac.puxar()).toBeNull();
    // A pessoa entra de novo: a conta fica pronta e a mensagem que esperava sai na hora (regra 1).
    await entrarDeNovoNoClaude();
    const saiu = await mac.puxarAte();
    expect(await mac.entregar(saiu, { desfecho: "sucesso", texto: "Revisei o #225: está pronto para o merge." })).toBe(200);
    await assentado(saiu.turnoId);
    await printar("desvio-02-login-vencido/b-sem-outra-conta", "02-entrou-e-respondeu", conversaId, tem("pronto para o merge"));
  }, 180_000);

  const LIMITE_CLAUDE = (voltaEm: number) => ({ desfecho: "falha", motivoFalha: "limite_do_plano", limiteVoltaEm: voltaEm, erroCru: "success | api_error: usage_limit_reached | You've hit your 5-hour limit", sinais: SINAIS_SEM_SAIDA }) as const;
  const LIMITE_CODEX_SEM_HORA = { desfecho: "falha", motivoFalha: "erro_execucao", erroCru: "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro) to continue.", sinais: SINAIS_SEM_SAIDA } as const;
  // O Codex diz a hora no relógio da máquina, sem fuso; a hora real vem da leitura de cota que o driver anexa ao turno.
  const VOLTA_DO_CODEX = Date.now() + 9 * 3_600_000;
  const LIMITE_CODEX_8H = { desfecho: "falha", motivoFalha: "erro_execucao", erroCru: "You've hit your usage limit. Visit https://chatgpt.com/settings/usage to purchase more credits or try again at 8:00 AM.", sinais: SINAIS_SEM_SAIDA,
    usoDoPlano: { harness: "codex-cli", situacao: "esgotado", cincoHoras: { utilizacao: 0.4, renovaEm: Date.now() + 3_600_000 }, semana: { utilizacao: 1, renovaEm: VOLTA_DO_CODEX }, medidoEm: Date.now() } } as const;

  /** Os cenários de limite começam com as contas livres (o "Tentar de novo" da conta, a mesma rota da tela). */
  async function contasLivres(): Promise<void> {
    const { contas } = await srv.json<ContasIaDto>("GET", "contas-ia");
    for (const c of contas) if (c.noLimiteAte !== null) await srv.json("POST", `contas-ia/${c.id}/tentar-de-novo`, {});
  }

  it("desvio 4 · limite com outra conta pronta: segue nela com a hora real em que a conta volta", async () => {
    await contasLivres();
    const { conversaId } = await bot("Bot do relatório");
    const turnoId = await enviar(conversaId, "Fecha o relatório da semana");
    const plano = await mac.puxarAte();
    expect(await mac.entregar(plano, LIMITE_CLAUDE(Date.now() + 5 * 3_600_000))).toBe(200);
    await assentado(turnoId);
    const naOutra = await mac.puxarAte();
    expect(naOutra.harness).not.toBe(plano.harness);
    expect(await mac.entregar(naOutra, { desfecho: "sucesso", texto: "Fechei. Está na pasta Relatórios, com o resumo no topo." })).toBe(200);
    await assentado(naOutra.turnoId);
    await printar("desvio-04-limite/a-outra-conta", "01-seguiu-e-respondeu", conversaId, tem("resumo no topo"));
  }, 180_000);

  it("desvio 3 · limite com o bot preso ao ChatGPT: a mensagem espera a hora real, com o botão da outra IA", async () => {
    await contasLivres();
    const { agenteId, conversaId } = await bot("Dino");
    await srv.json("PUT", `agentes/${agenteId}/inteligencia`, { modo: "fixa", fixa: "codex-cli" });
    const turnoId = await enviar(conversaId, "Roda os testes do quadro de novo");
    const plano = await mac.puxarAte();
    expect(plano.harness).toBe("codex-cli");
    expect(await mac.entregar(plano, LIMITE_CODEX_8H)).toBe(200);
    await assentado(turnoId);
    const texto = await printar("desvio-03-limite-bot-fixo/a-espera", "01-cartao", conversaId, tem("Esperando o ChatGPT voltar"));
    expect(texto).toContain("Responder com o Claude desta vez");
    expect(texto).not.toMatch(/sem hora/);
    // "Responder com o Claude desta vez": a mensagem sai uma vez no Claude; o bot continua só no ChatGPT.
    await tela.avaliar(`document.querySelector('[data-act="responder-com-outra-ia"]').click()`);
    const noClaude = await mac.puxarAte();
    expect(noClaude.harness).toBe("claude-cli");
    expect(await mac.entregar(noClaude, { desfecho: "sucesso", texto: "Rodei pelo Claude: 214 testes passaram." })).toBe(200);
    await assentado(noClaude.turnoId);
    await printar("desvio-03-limite-bot-fixo/a-espera", "02-respondeu-pelo-claude", conversaId, tem("214 testes"));
  }, 180_000);

  it("desvio 4 · limite sem a hora do fornecedor: nada de hora inventada", async () => {
    await contasLivres();
    const { agenteId, conversaId } = await bot("Bot sem hora");
    await srv.json("PUT", `agentes/${agenteId}/inteligencia`, { modo: "fixa", fixa: "codex-cli" });
    const turnoId = await enviar(conversaId, "Resume a planilha");
    expect(await mac.entregar(await mac.puxarAte(), LIMITE_CODEX_SEM_HORA)).toBe(200);
    await assentado(turnoId);
    const texto = await printar("desvio-04-limite/b-sem-hora", "01-cartao", conversaId, tem("volta sem hora"));
    expect(texto).not.toMatch(/\d{1,2}:\d{2}\./);
  }, 180_000);

  it("desvio 9 · a IA não abriu: o cartão nomeia a máquina e roda na outra pelo botão", async () => {
    const vm = await maquinaFalsa(srv, { nome: "VM do nod", plataforma: "linux", harnesses: { "claude-cli": PRONTO("2.1.327") }, contas: [contaFalsa(1, "claude-cli", "Pessoal")] });
    try {
      const { conversaId } = await bot("Bot do contrato");
      const turnoId = await enviar(conversaId, "Revisa o contrato novo");
      expect(await mac.entregar(await mac.puxarAte(), NAO_ABRIU)).toBe(200);
      await assentado(turnoId);
      const texto = await printar("desvio-09-ia-nao-abriu/a-outra-maquina", "01-cartao", conversaId, tem("não abriu"));
      expect(texto).toContain("MacBook de teste");
      expect(texto).toContain("Rodar na VM do nod desta vez");
      await tela.avaliar(`document.querySelector('[data-act="rodar-desta-vez"]').click()`);
      const naVm = await vm.puxarAte();
      expect(await vm.entregar(naVm, { desfecho: "sucesso", texto: "Revisei na VM: duas cláusulas pedem atenção." })).toBe(200);
      await assentado(naVm.turnoId);
      await printar("desvio-09-ia-nao-abriu/a-outra-maquina", "02-respondeu-na-vm", conversaId, tem("duas cláusulas"));
    } finally {
      await vm.pedir("desconectar").catch(() => undefined);
    }
  }, 180_000);
});
