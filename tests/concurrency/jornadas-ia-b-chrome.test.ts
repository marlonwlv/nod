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
import type { Tx } from "../../src/shared/types.ts";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { varrer } from "../../src/adapters/fundo/varredor-lease.ts";
import { LEASE_MS } from "../../src/shared/constantes.ts";
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

  /** Clica no botão visível da conversa (o do cartão ou o link da linha). */
  const clicar = (seletor: string) => tela.avaliar(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(seletor)})].find((x) => x.offsetParent !== null); if (!b) throw new Error("sem ${seletor.replace(/"/g, "'")}"); b.click(); return true; })()`);
  /** O destino de um botão que só navega (abre Provedores de IA, abre o erro): clica em cada variação e fotografa. */
  async function printarDestino(caminho: string, passo: string, conversaId: string, pronto: string, seletor: string, destino: string): Promise<void> {
    for (const v of VARIACOES) {
      await tela.abrir({ conversaId, variacao: v, pronto });
      await clicar(seletor);
      await tela.esperar(destino);
      if (DIR) await tela.print(join(DIR, caminho, `${passo}-${v.nome}.png`));
    }
  }
  /** Configurações › Provedores de IA aberta (o destino de "Entrar de novo", "Conectar uma IA", "Conectar outra conta"). */
  const PROVEDORES = `(() => { const e = document.querySelector('#espaco'); return !!e && e.getBoundingClientRect().width > 0 && /Provedores de IA/.test(e.innerText); })()`;
  const ERRO_ABERTO = `!!document.querySelector('details.desvio-erro[open]')`;
  /** O cartão fechou: nenhum cartão de desvio aberto na conversa e a linha encolhida com o resultado. */
  const fechou = (resultado: string) => `(() => { const tl = [...document.querySelectorAll('.timeline')].find((x) => x.offsetParent !== null); return !!tl && !tl.querySelector('.aviso-desvio') && [...tl.querySelectorAll('.msg-encolhido')].some((e) => e.innerText.includes(${JSON.stringify(resultado)})); })()`;

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

  it("caminho feliz: a pessoa escreve e o bot responde, sem linha nenhuma a mais (auditoria de 2026-11-22)", async () => {
    const { conversaId } = await bot("Bot feliz");
    const turnoId = await enviar(conversaId, "Resume a call de hoje");
    const plano = await mac.puxarAte(undefined, conversaId);
    expect(plano.turnoId).toBe(turnoId);
    const trabalhando = await printar("00-caminho-feliz", "01-trabalhando", conversaId, tem("Resume a call de hoje"));
    expect(trabalhando).not.toMatch(/Claude · Pessoal|MacBook de teste/);
    expect(await mac.entregar(plano, { desfecho: "sucesso", texto: "Resumi a call: três decisões e dois próximos passos." })).toBe(200);
    expect((await assentado(turnoId)).estado).toBe("concluido");
    await printar("00-caminho-feliz", "02-resposta", conversaId, tem("três decisões"));
  }, 120_000);

  it("desvio 1 · a sessão sumiu: o nod recomeça pelo histórico, com uma linha, e a resposta chega", async () => {
    const { conversaId } = await bot("QA Nod");
    const turnoId = await enviar(conversaId, "Você não está mergeando os PRs que abre?");
    expect(await mac.entregar(await mac.puxarAte(undefined, conversaId), SESSAO_SUMIU)).toBe(200);
    await assentado(turnoId);
    const repeticao = await mac.puxarAte(undefined, conversaId);
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
    expect(await mac.entregar(await mac.puxarAte(undefined, conversaId), SESSAO_SUMIU)).toBe(200);
    await assentado(turnoId);
    const repeticao = await mac.puxarAte(undefined, conversaId);
    expect(await mac.entregar(repeticao, SESSAO_SUMIU)).toBe(200);
    await assentado(repeticao.turnoId);
    const texto = await printar("desvio-01-sessao-sumiu/b-se-falhar", "01-cartao", conversaId, tem("não conseguiu recomeçar"));
    expect(texto).toContain("Responder com o ChatGPT desta vez");
    expect(texto).not.toMatch(/tente de novo|claude-cli|erro_execucao/);
    await printarDestino("desvio-01-sessao-sumiu/b-se-falhar", "02-ver-o-erro", conversaId, tem("não conseguiu recomeçar"), "details.desvio-erro > summary", ERRO_ABERTO);
    // "Responder com o ChatGPT desta vez": a mensagem sai uma vez no ChatGPT, sem sessão; o bot segue no Automático.
    await clicar('[data-act="responder-com-outra-ia"]');
    const outra = await mac.puxarAte(undefined, conversaId);
    expect(outra.harness).toBe("codex-cli");
    // O cartão fecha na hora: a linha diz o que foi escolhido e o bot aparece trabalhando.
    await printar("desvio-01-sessao-sumiu/b-se-falhar", "03-respondendo-pelo-chatgpt", conversaId, fechou("Respondendo pelo ChatGPT"));
    expect(await mac.entregar(outra, { desfecho: "sucesso", texto: "Pelo ChatGPT: não, merge só sai com pedido seu." })).toBe(200);
    await assentado(outra.turnoId);
    await printar("desvio-01-sessao-sumiu/b-se-falhar", "04-respondeu-pelo-chatgpt", conversaId, `${tem("merge só sai com pedido seu")} && ${fechou("Respondido pelo ChatGPT")}`);
  }, 180_000);

  it("desvio 10 · erro desconhecido: tenta uma vez sozinho, com uma linha, e responde", async () => {
    const { conversaId } = await bot("Bot da planilha");
    const turnoId = await enviar(conversaId, "Atualiza a planilha de custos");
    expect(await mac.entregar(await mac.puxarAte(undefined, conversaId), ERRO_ESTRANHO)).toBe(200);
    await assentado(turnoId);
    const repeticao = await mac.puxarAte(undefined, conversaId);
    await printar("desvio-10-erro-desconhecido/a-tentou-de-novo", "01-linha", conversaId, tem("Tentando de novo uma vez"));
    expect(await mac.entregar(repeticao, { desfecho: "sucesso", texto: "Atualizei a planilha: a linha de novembro entrou." })).toBe(200);
    await assentado(repeticao.turnoId);
    await printar("desvio-10-erro-desconhecido/a-tentou-de-novo", "02-resposta", conversaId, tem("linha de novembro"));
  }, 180_000);

  it("desvio 10 · o mesmo erro duas vezes: o cartão avisa o relato e responde com a outra IA pelo botão", async () => {
    const { conversaId } = await bot("Bot dos custos");
    const turnoId = await enviar(conversaId, "Atualiza a planilha de custos");
    expect(await mac.entregar(await mac.puxarAte(undefined, conversaId), ERRO_ESTRANHO)).toBe(200);
    await assentado(turnoId);
    const repeticao = await mac.puxarAte(undefined, conversaId);
    expect(await mac.entregar(repeticao, ERRO_ESTRANHO)).toBe(200);
    await assentado(repeticao.turnoId);
    const texto = await printar("desvio-10-erro-desconhecido/b-duas-vezes", "01-cartao", conversaId, tem("parou duas vezes"));
    expect(texto).toContain("O relato foi para o time do nod");
    await printarDestino("desvio-10-erro-desconhecido/b-duas-vezes", "02-ver-o-erro", conversaId, tem("parou duas vezes"), "details.desvio-erro > summary", ERRO_ABERTO);
    // O botão "Responder com o ChatGPT desta vez": o turno volta, fixo no Codex só desta vez.
    await clicar('[data-act="responder-com-outra-ia"]');
    const outra = await mac.puxarAte(undefined, conversaId);
    expect(outra.harness).toBe("codex-cli");
    await printar("desvio-10-erro-desconhecido/b-duas-vezes", "03-respondendo-pelo-chatgpt", conversaId, fechou("Respondendo pelo ChatGPT"));
    expect(await mac.entregar(outra, { desfecho: "sucesso", texto: "Pelo ChatGPT: a planilha de custos está atualizada." })).toBe(200);
    await assentado(outra.turnoId);
    await printar("desvio-10-erro-desconhecido/b-duas-vezes", "04-respondeu-pelo-chatgpt", conversaId, `${tem("Pelo ChatGPT")} && ${fechou("Respondido pelo ChatGPT")}`);
  }, 180_000);

  const LOGIN_VENCEU = { desfecho: "falha", motivoFalha: "erro_execucao", erroCru: "success | Failed to authenticate: OAuth session expired and could not be refreshed", sinais: SINAIS_SEM_SAIDA } as const;
  /** A pessoa entra de novo na conta do Claude: a máquina reanuncia com um login mais novo que a marca do servidor. */
  const entrarDeNovoNoClaude = () => mac.mudar({ contas: [contaFalsa(1, "claude-cli", "Pessoal", { logadaEm: Date.now() }), contaFalsa(2, "codex-cli", "Pessoal")] });

  it("desvio 2 · o login venceu e há outra conta: segue nela, com a linha e o Entrar de novo", async () => {
    const { conversaId } = await bot("Bot do PR");
    const turnoId = await enviar(conversaId, "Revisa o PR #224?");
    const plano = await mac.puxarAte(undefined, conversaId);
    expect(plano.harness).toBe("claude-cli");
    expect(await mac.entregar(plano, LOGIN_VENCEU)).toBe(200);
    await assentado(turnoId);
    const naOutra = await mac.puxarAte(undefined, conversaId);
    expect(naOutra.harness).toBe("codex-cli");
    await printar("desvio-02-login-vencido/a-outra-conta", "01-linha", conversaId, tem("venceu"));
    expect(await mac.entregar(naOutra, { desfecho: "sucesso", texto: "Revisei. Dois pontos no teste novo, comentei no PR." })).toBe(200);
    await assentado(naOutra.turnoId);
    const texto = await printar("desvio-02-login-vencido/a-outra-conta", "02-resposta", conversaId, tem("Dois pontos"));
    expect(texto).toContain("Respondendo com a ChatGPT · Pessoal");
    expect(texto).toContain("Entrar de novo");
    // O link "Entrar de novo" da linha leva a Provedores de IA, no login daquela conta.
    await printarDestino("desvio-02-login-vencido/a-outra-conta", "03-entrar-de-novo", conversaId, tem("Dois pontos"), '.linha-desvio [data-act="cl-entrar-chat"]', PROVEDORES);
    await entrarDeNovoNoClaude();
  }, 180_000);

  it("desvio 2 · o login venceu e não há outra conta: a mensagem espera, a pessoa entra de novo e ela sai sozinha", async () => {
    const { agenteId, conversaId } = await bot("Bot só Claude");
    await srv.json("PUT", `agentes/${agenteId}/inteligencia`, { modo: "fixa", fixa: "claude-cli" });
    const turnoId = await enviar(conversaId, "Revisa o PR #225?");
    expect(await mac.entregar(await mac.puxarAte(undefined, conversaId), LOGIN_VENCEU)).toBe(200);
    await assentado(turnoId);
    const texto = await printar("desvio-02-login-vencido/b-sem-outra-conta", "01-cartao", conversaId, tem("Entre de novo"));
    expect(texto).toContain("O login da Claude · Pessoal venceu no MacBook de teste");
    expect(await mac.puxar()).toBeNull();
    await printarDestino("desvio-02-login-vencido/b-sem-outra-conta", "02-entrar-de-novo", conversaId, tem("Entre de novo"), '.aviso-desvio [data-act="cl-entrar-chat"]', PROVEDORES);
    // A pessoa entra de novo: a conta fica pronta e a mensagem que esperava sai na hora (regra 1).
    await entrarDeNovoNoClaude();
    const saiu = await mac.puxarAte(undefined, conversaId);
    expect(await mac.entregar(saiu, { desfecho: "sucesso", texto: "Revisei o #225: está pronto para o merge." })).toBe(200);
    await assentado(saiu.turnoId);
    await printar("desvio-02-login-vencido/b-sem-outra-conta", "03-entrou-e-respondeu", conversaId, `${tem("pronto para o merge")} && ${fechou("A mensagem saiu")}`);
  }, 180_000);

  it("desvio 2 · o login venceu e não há outra conta: o Cancelar tira a mensagem da espera", async () => {
    const { agenteId, conversaId } = await bot("Bot só Claude 3");
    await srv.json("PUT", `agentes/${agenteId}/inteligencia`, { modo: "fixa", fixa: "claude-cli" });
    const turnoId = await enviar(conversaId, "Revisa o PR #226?");
    expect(await mac.entregar(await mac.puxarAte(undefined, conversaId), LOGIN_VENCEU)).toBe(200);
    await assentado(turnoId);
    try {
      await printar("desvio-02-login-vencido/c-cancelar", "01-cartao", conversaId, tem("Entre de novo"));
      await clicar('.aviso-desvio [data-act="cancelar-turno"]');
      // O cartão fecha como "Cancelada" (o balão da pessoa diz "Cancelada · não rodou", com o Desfazer).
      await printar("desvio-02-login-vencido/c-cancelar", "02-cancelada", conversaId, fechou("Cancelada"));
    } finally {
      await entrarDeNovoNoClaude();
    }
    expect(await mac.puxar()).toBeNull();
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
    const plano = await mac.puxarAte(undefined, conversaId);
    expect(await mac.entregar(plano, LIMITE_CLAUDE(Date.now() + 5 * 3_600_000))).toBe(200);
    await assentado(turnoId);
    const naOutra = await mac.puxarAte(undefined, conversaId);
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
    const plano = await mac.puxarAte(undefined, conversaId);
    expect(plano.harness).toBe("codex-cli");
    expect(await mac.entregar(plano, LIMITE_CODEX_8H)).toBe(200);
    await assentado(turnoId);
    const texto = await printar("desvio-03-limite-bot-fixo/a-espera", "01-cartao", conversaId, tem("Esperando o ChatGPT voltar"));
    expect(texto).toContain("Responder com o Claude desta vez");
    expect(texto).not.toMatch(/sem hora/);
    // "Responder com o Claude desta vez": a mensagem sai uma vez no Claude; o bot continua só no ChatGPT.
    await clicar('[data-act="responder-com-outra-ia"]');
    const noClaude = await mac.puxarAte(undefined, conversaId);
    expect(noClaude.harness).toBe("claude-cli");
    await printar("desvio-03-limite-bot-fixo/a-espera", "02-respondendo-pelo-claude", conversaId, fechou("Respondendo pelo Claude"));
    expect(await mac.entregar(noClaude, { desfecho: "sucesso", texto: "Rodei pelo Claude: 214 testes passaram." })).toBe(200);
    await assentado(noClaude.turnoId);
    const depois = await printar("desvio-03-limite-bot-fixo/a-espera", "03-respondeu-pelo-claude", conversaId, `${tem("214 testes")} && ${fechou("Respondido pelo Claude")}`);
    // A cópia que esperava saiu da fila porque o botão refez a fala: a mensagem da pessoa não aparece como cancelada.
    expect(depois).not.toContain("Cancelada");
  }, 180_000);

  it("desvio 3 · limite com o bot preso ao ChatGPT: o Cancelar tira a mensagem da espera", async () => {
    await contasLivres();
    const { agenteId, conversaId } = await bot("Dino 2");
    await srv.json("PUT", `agentes/${agenteId}/inteligencia`, { modo: "fixa", fixa: "codex-cli" });
    const turnoId = await enviar(conversaId, "Roda os testes do quadro de novo");
    expect(await mac.entregar(await mac.puxarAte(undefined, conversaId), LIMITE_CODEX_8H)).toBe(200);
    await assentado(turnoId);
    await printar("desvio-03-limite-bot-fixo/b-cancelar", "01-cartao", conversaId, tem("Esperando o ChatGPT voltar"));
    await clicar('.aviso-desvio [data-act="cancelar-turno"]');
    await printar("desvio-03-limite-bot-fixo/b-cancelar", "02-cancelada", conversaId, fechou("Cancelada"));
  }, 180_000);

  it("desvio 3 · a pessoa segue conversando: o cartão fecha como 'Você seguiu a conversa' e a mensagem nova vai junto", async () => {
    await contasLivres();
    const { agenteId, conversaId } = await bot("Dino 3");
    await srv.json("PUT", `agentes/${agenteId}/inteligencia`, { modo: "fixa", fixa: "codex-cli" });
    const turnoId = await enviar(conversaId, "Roda os testes do quadro de novo");
    expect(await mac.entregar(await mac.puxarAte(undefined, conversaId), LIMITE_CODEX_8H)).toBe(200);
    await assentado(turnoId);
    await printar("desvio-03-limite-bot-fixo/c-conversa-segue", "01-cartao", conversaId, tem("Esperando o ChatGPT voltar"));
    await enviar(conversaId, "Deixa, me lembra amanhã");
    await printar("desvio-03-limite-bot-fixo/c-conversa-segue", "02-voce-seguiu", conversaId, `${tem("me lembra amanhã")} && ${fechou("Você seguiu a conversa")}`);
  }, 180_000);

  it("desvio 4 · limite sem a hora do fornecedor: nada de hora inventada", async () => {
    await contasLivres();
    const { agenteId, conversaId } = await bot("Bot sem hora");
    await srv.json("PUT", `agentes/${agenteId}/inteligencia`, { modo: "fixa", fixa: "codex-cli" });
    const turnoId = await enviar(conversaId, "Resume a planilha");
    expect(await mac.entregar(await mac.puxarAte(undefined, conversaId), LIMITE_CODEX_SEM_HORA)).toBe(200);
    await assentado(turnoId);
    const texto = await printar("desvio-04-limite/b-sem-hora", "01-cartao", conversaId, tem("volta sem hora"));
    expect(texto).not.toMatch(/\d{1,2}:\d{2}\./);
    await clicar('.aviso-desvio [data-act="cancelar-turno"]');
    await printar("desvio-04-limite/b-sem-hora", "02-cancelada", conversaId, fechou("Cancelada"));
  }, 180_000);

  /** O banco do teste, no escopo da pessoa: só para simular o tempo (a escada do instável, o lease, o contato). */
  const noBanco = <T,>(fn: (tx: Tx) => Promise<T>): Promise<T> => srv.db.begin(async (tx) => { await vincularEscopo(tx, srv.pessoa); return fn(tx); }) as Promise<T>;
  /** A espera da escada passou (30 s, 2 min): a repetição sai agora. */
  const acordarAgora = (conversaId: string) => noBanco((tx) => tx`update turnos set acordar_em = null where conversa_id = ${conversaId} and estado = 'pendente'`);
  const INSTAVEL = { desfecho: "falha", motivoFalha: "erro_execucao", erroCru: "API Error: 529 {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}", sinais: SINAIS_SEM_SAIDA } as const;

  it("desvio 5 · instável: tenta de novo (30 s, 2 min) e passa para a outra IA, com uma linha a cada vez", async () => {
    await contasLivres();
    const { conversaId } = await bot("Bot da call");
    const turnoId = await enviar(conversaId, "Resume a call de hoje");
    expect(await mac.entregar(await mac.puxarAte(undefined, conversaId), INSTAVEL)).toBe(200);
    await assentado(turnoId);
    await printar("desvio-05-instavel/a-outra-ia", "01-tentando-de-novo", conversaId, tem("(1 de 3)"));
    await acordarAgora(conversaId);
    const segunda = await mac.puxarAte(undefined, conversaId);
    expect(await mac.entregar(segunda, INSTAVEL)).toBe(200);
    await assentado(segunda.turnoId);
    await acordarAgora(conversaId);
    const terceira = await mac.puxarAte(undefined, conversaId);
    expect(await mac.entregar(terceira, INSTAVEL)).toBe(200);
    await assentado(terceira.turnoId);
    const naOutra = await mac.puxarAte(undefined, conversaId);
    expect(naOutra.harness).toBe("codex-cli");
    expect(await mac.entregar(naOutra, { desfecho: "sucesso", texto: "Resumo da call: o lançamento fica para terça." })).toBe(200);
    await assentado(naOutra.turnoId);
    await printar("desvio-05-instavel/a-outra-ia", "02-respondeu-pela-outra-ia", conversaId, tem("fica para terça"));
  }, 240_000);

  it("desvio 5 · instável com o bot preso ao Claude: depois de 3 tentativas, o cartão com a outra IA desta vez", async () => {
    await contasLivres();
    const { agenteId, conversaId } = await bot("Bot só Claude 2");
    await srv.json("PUT", `agentes/${agenteId}/inteligencia`, { modo: "fixa", fixa: "claude-cli" });
    const turnoId = await enviar(conversaId, "Resume a call de hoje");
    let plano = await mac.puxarAte(undefined, conversaId);
    expect(await mac.entregar(plano, INSTAVEL)).toBe(200);
    await assentado(turnoId);
    for (let i = 0; i < 2; i++) {
      await acordarAgora(conversaId);
      plano = await mac.puxarAte(undefined, conversaId);
      expect(await mac.entregar(plano, INSTAVEL)).toBe(200);
      await assentado(plano.turnoId);
    }
    const texto = await printar("desvio-05-instavel/b-se-falhar", "01-cartao", conversaId, tem("continua instável"));
    expect(texto).toContain("Responder com o ChatGPT desta vez");
    await printarDestino("desvio-05-instavel/b-se-falhar", "02-ver-o-erro", conversaId, tem("continua instável"), "details.desvio-erro > summary", ERRO_ABERTO);
    // "Responder com o ChatGPT desta vez": sai uma vez no ChatGPT; o bot continua só no Claude.
    await clicar('[data-act="responder-com-outra-ia"]');
    const outra = await mac.puxarAte(undefined, conversaId);
    expect(outra.harness).toBe("codex-cli");
    await printar("desvio-05-instavel/b-se-falhar", "03-respondendo-pelo-chatgpt", conversaId, fechou("Respondendo pelo ChatGPT"));
    expect(await mac.entregar(outra, { desfecho: "sucesso", texto: "Pelo ChatGPT: o lançamento fica para terça." })).toBe(200);
    await assentado(outra.turnoId);
    await printar("desvio-05-instavel/b-se-falhar", "04-respondeu-pelo-chatgpt", conversaId, `${tem("Pelo ChatGPT")} && ${fechou("Respondido pelo ChatGPT")}`);
  }, 240_000);

  it("desvio 11 · o nod atualizou no meio: a conversa volta sozinha, com a linha, e a resposta chega", async () => {
    await contasLivres();
    const { conversaId } = await bot("Bot do post");
    const turnoId = await enviar(conversaId, "Escreve o post da semana");
    expect(await mac.entregar(await mac.puxarAte(undefined, conversaId), { desfecho: "interrompido", causa: "reinicio_do_motor", texto: "Começando o rascunho…", sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true } })).toBe(200);
    await assentado(turnoId);
    const volta = await mac.puxarAte(undefined, conversaId);
    await printar("desvio-11-nod-atualizou/a-voltou-sozinho", "01-linha", conversaId, tem("O nod atualizou no meio da resposta"));
    expect(await mac.entregar(volta, { desfecho: "sucesso", texto: "Pronto, o rascunho está no documento “Post da semana”." })).toBe(200);
    await assentado(volta.turnoId);
    const texto = await printar("desvio-11-nod-atualizou/a-voltou-sozinho", "02-resposta", conversaId, tem("Post da semana"));
    expect(texto).not.toContain("Retomar");
  }, 180_000);

  /** A máquina sai do ar de vez: desconecta e o último contato fica velho (senão ela seria a "outra máquina" dos próximos). */
  async function desligar(m: MaquinaFalsa): Promise<void> {
    await m.pedir("desconectar").catch(() => undefined);
    await noBanco((tx) => tx`update maquina_tokens set ultimo_uso_em = now() - interval '3 hours' where id = ${m.id}`);
  }

  /** A máquina do turno dormiu: o lease vence e o varredor passa (o tempo do servidor adiantado além do lease). */
  async function dormir(turnoId: string): Promise<void> {
    await varrer(srv.db, Date.now() + LEASE_MS + 1, { listarPessoas: async () => [{ tenantId: srv.pessoa.tenantId, id: srv.pessoa.pessoaId }] });
    expect((await assentado(turnoId)).motivoInterrupcao).toBe("maquina_sem_contato");
  }

  it("desvio 12 · a máquina dormiu no meio: a resposta continua quando ela volta", async () => {
    await contasLivres();
    const { conversaId } = await bot("Bot da migração");
    const turnoId = await enviar(conversaId, "Roda a migração na VM");
    const plano = await mac.puxarAte(undefined, conversaId);
    expect(plano.turnoId).toBe(turnoId);
    // A máquina dormiu: o lease vence e o varredor (o mesmo do servidor, sem a carência do boot) encerra o turno com a
    // máquina sem contato.
    await dormir(turnoId);
    await printar("desvio-12-computador-dormiu/a-voltou", "01-linha", conversaId, tem("A resposta continua quando"));
    const volta = await mac.puxarAte(undefined, conversaId);
    expect(await mac.entregar(volta, { desfecho: "sucesso", texto: "Migração aplicada: 3 tabelas novas." })).toBe(200);
    await assentado(volta.turnoId);
    await printar("desvio-12-computador-dormiu/a-voltou", "02-resposta", conversaId, tem("3 tabelas novas"));
  }, 180_000);

  it("desvio 12 · a máquina dormiu e há outra com IA pronta: o link 'Rodar em outra máquina' leva a resposta para ela", async () => {
    await contasLivres();
    const vm = await maquinaFalsa(srv, { nome: "VM sp-01", plataforma: "linux", harnesses: { "claude-cli": PRONTO("2.1.327") }, contas: [contaFalsa(3, "claude-cli", "VM")] });
    try {
      const { conversaId } = await bot("Bot da migração 2");
      const turnoId = await enviar(conversaId, "Roda a migração na VM");
      const plano = await mac.puxarAte(undefined, conversaId);
      // A VM teve contato agora (puxou), então ela é a outra máquina que o link oferece.
      await vm.puxar();
      expect(plano.turnoId).toBe(turnoId);
      await dormir(turnoId);
      const texto = await printar("desvio-12-computador-dormiu/b-outra-maquina", "01-linha", conversaId, tem("Rodar em outra máquina"));
      expect(texto).toContain("A resposta continua quando ele voltar");
      await clicar('.linha-desvio [data-act="rodar-desta-vez"]');
      const naVm = await vm.puxarAte(undefined, conversaId);
      // A linha diz que a resposta foi para a outra máquina (o link vira "Respondido na VM sp-01" quando ela responde).
      await printar("desvio-12-computador-dormiu/b-outra-maquina", "02-rodando-na-outra", conversaId, `${tem("Rodando na VM sp-01")} && !document.querySelector('.linha-desvio .linha-link')`);
      expect(await vm.entregar(naVm, { desfecho: "sucesso", texto: "Rodei na VM: 3 tabelas novas." })).toBe(200);
      await assentado(naVm.turnoId);
      await printar("desvio-12-computador-dormiu/b-outra-maquina", "03-respondeu-na-outra", conversaId, `${tem("Rodei na VM")} && ${tem("Respondido na VM sp-01")}`);
      // A volta automática na máquina que dormiu foi substituída pela escolha: o Mac não recebe a mesma mensagem.
      expect(await mac.puxar()).toBeNull();
    } finally {
      await desligar(vm);
    }
  }, 180_000);

  it("desvio 7 · a máquina do bot está fora do ar no envio: avisa na hora e roda na outra pelo botão", async () => {
    await contasLivres();
    const desligada = await maquinaFalsa(srv, { nome: "Mac da sala", plataforma: "darwin", harnesses: { "claude-cli": PRONTO("2.1.327") }, contas: [contaFalsa(1, "claude-cli", "Pessoal")] });
    const { agenteId, conversaId } = await bot("Bot do time");
    await srv.json("PUT", `agentes/${agenteId}/maquina`, { maquinaId: desligada.id });
    await desligada.pedir("desconectar").catch(() => undefined);
    await noBanco((tx) => tx`update maquina_tokens set ultimo_uso_em = now() - interval '3 hours' where id = ${desligada.id}`);
    await enviar(conversaId, "Manda o resumo pro time");
    const texto = await printar("desvio-07-computador-fora/a-outra-maquina", "01-cartao", conversaId, tem("está fora do ar"));
    expect(texto).toContain("O Mac da sala está fora do ar");
    await clicar('[data-act="rodar-desta-vez"]');
    const noMac = await mac.puxarAte(undefined, conversaId);
    await printar("desvio-07-computador-fora/a-outra-maquina", "02-rodando-no-macbook", conversaId, fechou("Rodando no MacBook de teste"));
    expect(await mac.entregar(noMac, { desfecho: "sucesso", texto: "Mandei o resumo no canal do time." })).toBe(200);
    await assentado(noMac.turnoId);
    await printar("desvio-07-computador-fora/a-outra-maquina", "03-respondeu-na-outra", conversaId, `${tem("canal do time")} && ${fechou("Respondido no MacBook de teste")}`);
  }, 180_000);

  it("desvio 8 · a organização tirou o acesso e não há outra conta: o aviso com a causa e o botão, sem termos internos", async () => {
    await contasLivres();
    const { agenteId, conversaId } = await bot("Bot do ajuste");
    await srv.json("PUT", `agentes/${agenteId}/inteligencia`, { modo: "fixa", fixa: "claude-cli" });
    const turnoId = await enviar(conversaId, "Abre o PR do ajuste");
    expect(await mac.entregar(await mac.puxarAte(undefined, conversaId), { desfecho: "falha", motivoFalha: "nao_autenticado", causaSemIa: "conta_sem_acesso", texto: "", erroCru: "success | Your organization has disabled Claude subscription access for Claude Code", sinais: SINAIS_SEM_SAIDA })).toBe(200);
    await assentado(turnoId);
    const texto = await printar("desvio-08-sem-acesso/a-sem-outra-conta", "01-aviso", conversaId, tem("sem acesso"));
    expect(texto).not.toMatch(/claude-cli|nao_autenticado|executor/);
    await printarDestino("desvio-08-sem-acesso/a-sem-outra-conta", "02-conectar-outra-conta", conversaId, tem("sem acesso"), '.aviso-desvio [data-act="secao-espaco"]', PROVEDORES);
    await entrarDeNovoNoClaude();
  }, 180_000);

  it("desvio 6 · nenhuma IA pronta na máquina do bot: o cartão com o Conectar; a IA entra e a mensagem sai sozinha", async () => {
    const vazia = await maquinaFalsa(srv, { nome: "VM nova", plataforma: "linux", harnesses: { "claude-cli": { estado: "ausente", motivo: "não instalado", causa: "nao_instalado", em: Date.now() } as never } });
    try {
      const { agenteId, conversaId } = await bot("Bot novo");
      await srv.json("PUT", `agentes/${agenteId}/maquina`, { maquinaId: vazia.id });
      await enviar(conversaId, "Organiza minha agenda de amanhã");
      expect(await vazia.puxar()).toBeNull();
      const texto = await printar("desvio-06-sem-ia-pronta/a-guardada", "01-cartao", conversaId, tem("Nenhuma IA conectada na VM nova"));
      expect(texto).toContain("A mensagem fica guardada e sai assim que uma conta entrar");
      expect(texto).toContain("Conectar uma IA");
      expect(texto).not.toMatch(/claude-cli|nao_autenticado|executor indispon/);
      await printarDestino("desvio-06-sem-ia-pronta/a-guardada", "02-conectar-uma-ia", conversaId, tem("Nenhuma IA conectada"), '.aviso-desvio [data-act="secao-espaco"]', PROVEDORES);
      // A pessoa conecta o Claude na VM: a máquina anuncia a IA pronta e a mensagem guardada sai.
      await vazia.mudar({ harnesses: { "claude-cli": PRONTO("2.1.327") }, contas: [contaFalsa(4, "claude-cli", "VM nova")] });
      const saiu = await vazia.puxarAte(undefined, conversaId);
      expect(await vazia.entregar(saiu, { desfecho: "sucesso", texto: "Organizei: três reuniões e uma hora livre às 15h." })).toBe(200);
      await assentado(saiu.turnoId);
      await printar("desvio-06-sem-ia-pronta/a-guardada", "03-conectou-e-respondeu", conversaId, tem("uma hora livre"));
    } finally {
      await desligar(vazia);
    }
  }, 180_000);

  it("desvio 9 · a IA não abriu: 'Reinstalar e tentar' pede a reinstalação e a mensagem sai quando a IA abre", async () => {
    const escritorio = await maquinaFalsa(srv, { nome: "MacBook do escritório", plataforma: "darwin", atualizaIas: true, harnesses: { "claude-cli": PRONTO("2.1.327") }, contas: [contaFalsa(5, "claude-cli", "Escritório")] });
    try {
      const { agenteId, conversaId } = await bot("Bot do contrato");
      await srv.json("PUT", `agentes/${agenteId}/maquina`, { maquinaId: escritorio.id });
      const turnoId = await enviar(conversaId, "Revisa o contrato novo");
      expect(await escritorio.entregar(await escritorio.puxarAte(undefined, conversaId), NAO_ABRIU)).toBe(200);
      await assentado(turnoId);
      const texto = await printar("desvio-09-ia-nao-abriu/a-reinstalar", "01-cartao", conversaId, tem("não abriu"));
      expect(texto).toContain("O Claude não abriu no MacBook do escritório");
      expect(texto).toContain("Reinstalar e tentar");
      await clicar('[data-act="reinstalar-e-tentar"]');
      // Enquanto a máquina reinstala, o botão gira ("Reinstalando…") e os outros param.
      await printar("desvio-09-ia-nao-abriu/a-reinstalar", "02-reinstalando", conversaId, `${tem("Reinstalando o Claude")} && !!document.querySelector('.aviso-desvio [aria-busy="true"]')`);
      // A fala espera a IA: nada sai antes de a máquina anunciar o Claude reinstalado.
      expect(await escritorio.puxar()).toBeNull();
      await escritorio.mudar({ harnesses: { "claude-cli": PRONTO("2.1.330") } });
      const saiu = await escritorio.puxarAte(undefined, conversaId);
      expect(await escritorio.entregar(saiu, { desfecho: "sucesso", texto: "Revisei: duas cláusulas pedem atenção." })).toBe(200);
      await assentado(saiu.turnoId);
      await printar("desvio-09-ia-nao-abriu/a-reinstalar", "03-reinstalou-e-respondeu", conversaId, `${tem("duas cláusulas")} && ${fechou("Reinstalado · a mensagem saiu")}`);
    } finally {
      await desligar(escritorio);
    }
  }, 180_000);

  it("desvio 9 · a IA não abriu: a outra máquina pelo botão", async () => {
    const vm = await maquinaFalsa(srv, { nome: "VM do nod", plataforma: "linux", harnesses: { "claude-cli": PRONTO("2.1.327") }, contas: [contaFalsa(1, "claude-cli", "Pessoal")] });
    try {
      const { conversaId } = await bot("Bot do contrato 2");
      const turnoId = await enviar(conversaId, "Revisa o contrato novo");
      expect(await mac.entregar(await mac.puxarAte(undefined, conversaId), NAO_ABRIU)).toBe(200);
      await assentado(turnoId);
      const texto = await printar("desvio-09-ia-nao-abriu/b-outra-maquina", "01-cartao", conversaId, tem("não abriu"));
      expect(texto).toContain("MacBook de teste");
      expect(texto).toContain("Rodar na VM do nod");
      await clicar('[data-act="rodar-desta-vez"]');
      const naVm = await vm.puxarAte(undefined, conversaId);
      await printar("desvio-09-ia-nao-abriu/b-outra-maquina", "02-rodando-na-vm", conversaId, fechou("Rodando na VM do nod"));
      expect(await vm.entregar(naVm, { desfecho: "sucesso", texto: "Revisei na VM: duas cláusulas pedem atenção." })).toBe(200);
      await assentado(naVm.turnoId);
      await printar("desvio-09-ia-nao-abriu/b-outra-maquina", "03-respondeu-na-vm", conversaId, `${tem("Revisei na VM")} && ${fechou("Respondido na VM do nod")}`);
    } finally {
      await desligar(vm);
    }
  }, 180_000);
});
