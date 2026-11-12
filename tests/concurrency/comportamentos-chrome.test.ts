import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarCatcherDriver } from "../../src/adapters/executor/drivers/catcher.ts";
import { cookieDeSessao } from "../../src/adapters/http/rotas/tela.ts";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { apiAnthropicFalsa, mensagem, type PedidoNaApiFalsa } from "../helpers/api-anthropic-falsa.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { CHAVE_GASTO_REVISOR, PREFIXO_GASTO_PESSOA } from "../../src/repositories/gasto-revisor.repo.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * Frente "comportamento igual ao Grok" (12/11/2026, docs/grokbot/COMPORTAMENTO.md): um e2e por comportamento que o Marlon
 * decidiu copiar do Grok Bot (docs/grokbot/DECISOES.md), no app inteiro — servidor completo com banco, catcher, a web
 * montada (npx vite build) e o Chrome de verdade por CDP. A referência do Grok é docs/grokbot/TELAS.md e AGENTE.md e os
 * prints 37–39 (aprovação) e 70–72 (onboarding). Seletores por papel, `data-act` ou texto: o visual (CSS) muda em paralelo
 * e não é o que se prova aqui. Sem a web montada ou sem Chrome, pula, como os outros e2e de Chrome.
 */

const WEB = process.env.NOD_E2E_WEB ?? join(process.cwd(), "dist/web");
const chrome = existsSync(join(WEB, "index.html")) ? (() => { try { return acharChrome(); } catch { return null; } })() : null;
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("igual ao Grok: o CI precisa da web montada (npx vite build) e do Chromium");
const MCP_GRAVAR = fileURLToPath(new URL("../fixtures/mcp-somar.mjs", import.meta.url));
const MCP_EXEMPLO = fileURLToPath(new URL("../../scripts/mcp-exemplo.mjs", import.meta.url));
const JORNADA = 180_000;
const CHAVE_REVISOR = "sk-ant-teste-0123456789abcdefghij";

const descrever = chrome ? describeIntegracao : describe.skip;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** O revisor falso: por padrão pede (o teste troca com `api.responder`). */
const PEDE = (sugestao = "") => mensagem(JSON.stringify({ decisao: "pede", motivo: "é a primeira vez que ele grava aqui", regra: "", sugestao }));
const LIBERA_PELA = (regra: string) => mensagem(JSON.stringify({ decisao: "libera", motivo: "a sua regra deixa", regra, sugestao: "" }));
/** A pessoa do teste é admin (NOD_ADMINS) para o teto do item 4. */
const PESSOA = randomUUID();

descrever("nod igual ao Grok Bot (app inteiro, Chrome real)", () => {
  let srv: ServidorCompleto;
  let cdp: Cdp;
  let dir: string;
  let api: Awaited<ReturnType<typeof apiAnthropicFalsa>>;
  let conectorGravar = "";
  let conectorExemplo = "";
  let arquivoGravar = "";
  let arquivoEmails = "";
  const agentes: string[] = [];
  const conversas: string[] = [];

  beforeAll(async () => {
    api = await apiAnthropicFalsa((_p: PedidoNaApiFalsa) => PEDE());
    dir = mkdtempSync(join(tmpdir(), "igual-grok-"));
    arquivoGravar = join(dir, "gravar.txt");
    arquivoEmails = join(dir, "emails.txt");
    writeFileSync(arquivoGravar, "");
    writeFileSync(arquivoEmails, "");
    srv = await servidorCompleto({
      pessoaId: PESSOA,
      env: { NOD_STATIC_DIR: WEB, NOD_PRAZO_DECISAO_MS: "86400000", NOD_REVISOR: "ligado", NOD_REVISOR_CHAVE: CHAVE_REVISOR, NOD_ADMINS: PESSOA },
      revisor: { url: api.url },
      drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod, atrasoMs: 0 })],
    });
    const onb = await srv.json<{ guia: { id: string; conversaId: string } | null }>("GET", "onboarding");
    if (onb.guia) { agentes.push(onb.guia.id); conversas.push(onb.guia.conversaId); }
    conectorGravar = await registrarConector("Gravador", "gravador", MCP_GRAVAR, { NOD_MCP_GRAVAR_ARQUIVO: arquivoGravar });
    conectorExemplo = await registrarConector("Exemplo", "exemplo", MCP_EXEMPLO, { NOD_MCP_EXEMPLO_ARQUIVO: arquivoEmails });
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9500 + (process.pid % 150), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Network.enable");
    const u = new URL(srv.url);
    await cdp.enviar("Network.setCookie", { name: "nod_sessao", value: cookieDeSessao(srv.pessoa.cookie), domain: u.hostname, path: "/" });
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  }, 180_000);

  afterAll(async () => {
    cdp?.fechar();
    await api?.fechar();
    if (!srv) return;
    await srv.fechar();
    // O que a lista fixa da limpeza não conhece: "Sempre permitir" (permissoes_permanentes aponta o item) e os ajustes de
    // aprovação (ADR-166). Como a própria pessoa (nod_app: as policies de RLS são dela), sob o escopo dela.
    const escopo = { tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId };
    await srv.db.begin(async (trx) => {
      await vincularEscopo(trx, escopo);
      for (const t of ["permissoes_permanentes", "regras_revisor", "niveis_ferramenta", "tetos_modo"]) await trx`delete from ${trx(t)} where owner_id = ${escopo.pessoaId}`;
    });
    // O gasto do revisor falso é do dia, fora de escopo (limites_conta): sai como no revisor-ponte, para não somar no dele.
    await srv.db`delete from limites_conta where chave = ${CHAVE_GASTO_REVISOR} or starts_with(chave, ${`${PREFIXO_GASTO_PESSOA}:`})`;
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes, conversas });
    await srv.desligar();
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }, 60_000);

  async function registrarConector(nome: string, slug: string, mcp: string, env: Record<string, string>): Promise<string> {
    const c = await srv.json<{ ids: { conector: string } }>("POST", "conectores", { nome, slug, transporte: "stdio", comando: process.execPath, args: [mcp], env, declaracao: "nao-toca" });
    const s = await srv.json<{ ok: boolean }>("POST", `conectores/${c.ids.conector}/sondar`);
    expect(s.ok).toBe(true);
    return c.ids.conector;
  }

  async function criarBot(nome: string, modo: "manual" | "automatico" | "total", acessos: { conectorId: string; capacidade: string }[] = []): Promise<{ id: string; conversaId: string }> {
    const r = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome, descricao: "Bot do teste igual ao Grok" });
    agentes.push(r.agente.id);
    conversas.push(r.conversa.id);
    for (const a of acessos) await srv.json("POST", `agentes/${r.agente.id}/concessoes`, a);
    await srv.json("POST", `agentes/${r.agente.id}/modo-aprovacao`, { modo, ...(modo === "total" ? { confirmado: true } : {}) });
    return { id: r.agente.id, conversaId: r.conversa.id };
  }

  async function ate(expressao: string, oQue: string, ms = 20_000): Promise<void> {
    for (let t = 0; t < ms; t += 100) {
      if (await avaliar<boolean>(cdp, `!!(${expressao})`)) return;
      await espera(100);
    }
    const html = await avaliar<string>(cdp, `(document.querySelector("#timeline") ?? document.body).innerText.slice(-1200) + " ||| mascotes: " + [...document.querySelectorAll("#sidebar [data-bot-contexto] nod-mascote, .ap-camada nod-mascote")].map((m) => m.getAttribute("aria-label") + "=" + m.dataset.estado).join(" | ")`);
    throw new Error(`esperei ${ms} ms por ${oQue}\n--- tela ---\n${html}`);
  }
  const clicar = (sel: string) => avaliar(cdp, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error("não achei ${sel.replace(/"/g, "'")}"); el.scrollIntoView({ block: "center" }); el.click(); return true; })()`);
  const texto = (sel: string) => avaliar<string | null>(cdp, `document.querySelector(${JSON.stringify(sel)})?.textContent?.replace(/\\s+/g, " ").trim() ?? null`);
  const existe = (sel: string) => avaliar<boolean>(cdp, `!!document.querySelector(${JSON.stringify(sel)})`);

  /** Tecla de verdade pelo CDP (o handler do app vê o KeyboardEvent): modificadores Alt=1, Ctrl=2, Meta=4, Shift=8. */
  async function tecla(key: string, o: { code?: string; vk?: number; mod?: number } = {}): Promise<void> {
    const base = { key, code: o.code ?? key, windowsVirtualKeyCode: o.vk ?? 0, modifiers: o.mod ?? 0 };
    await cdp.enviar("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  /** O item 10 roda o onboarding pela tela; os outros entram com ele concluído (como quem já passou por ele). */
  let onboardingConcluido = false;
  async function abrirApp(hash = ""): Promise<void> {
    if (!onboardingConcluido) { await srv.json("POST", "onboarding/concluir", {}); onboardingConcluido = true; }
    await cdp.enviar("Page.navigate", { url: `${srv.url}/${hash}` });
    await ate(`document.querySelector('[data-act="abrir-conversa"]')`, "a lista de bots");
  }

  async function abrirConversa(bot: { id: string }): Promise<void> {
    await clicar(`[data-bot-contexto="${bot.id}"] [data-act="abrir-conversa"]`);
    await ate(`document.getElementById("composer-texto")`, "a conversa");
  }

  /** A fala da pessoa pela API (o catcher lê as marcas [[tool: …]]); a tela recebe pelo SSE, como de verdade. */
  async function falar(bot: { conversaId: string }, fala: string): Promise<void> {
    await srv.json("POST", `conversas/${bot.conversaId}/mensagens`, { texto: fala });
  }

  /** No nod a escrita passa por pedir_aprovacao (o bot pede; a chamada direta no manual é negada): um item, "gravar". */
  const pedirGravar = (t: string) => JSON.stringify({ resumo: `Gravar "${t}"`, itens: [{ texto: `Gravar "${t}"`, destino: { conector: "gravador", ferramenta: "gravar", argumentos: { texto: t } }, origem_conector: "gravador" }] });

  // ———————————————————————————————————————————————— 10 ———————————————————————————————————————————————
  it("10. onboarding do Grok inteiro em 10 passos: boas-vindas → … → criar (cor e forma) → preparando com %", { timeout: JORNADA }, async () => {
    // Antes de qualquer outro: a pessoa nova, sem o onboarding concluído.
    await cdp.enviar("Page.navigate", { url: `${srv.url}/` });
    // O passo pelo nome (os 10 do Grok, PASSOS de web/telas/apresentacao.ts); onde há os pontos, "Passo N de 10".
    const PASSOS = ["boas-vindas", "conhecer", "computador", "trabalho", "delegar", "funcao", "origem", "apps", "criar", "preparando"];
    const noPasso = (n: number) => ate(`document.querySelector(".ap-camada section.ap.ap-${PASSOS[n - 1]}") && (!document.querySelector(".ap-camada .ap-pontos") || document.querySelector(".ap-camada .ap-pontos").getAttribute("aria-label") === "Passo ${n} de 10")`, `o passo ${n} de 10 (${PASSOS[n - 1]})`);
    await noPasso(1);
    const seguir = () => clicar('[data-act="apres-seguir"]');
    const mascote = () => avaliar<string | null>(cdp, `document.querySelector(".ap-camada .ap-personagem nod-mascote, .ap-camada .cb-preparo-topo nod-mascote, .ap-camada .cb-preparo nod-mascote")?.dataset.estado ?? null`);
    await seguir(); await noPasso(2);
    // Voltar funciona (o ‹ do Grok).
    await clicar('[data-act="apres-voltar"]'); await noPasso(1);
    await seguir(); await noPasso(2);
    await seguir(); await noPasso(3);
    await seguir(); await noPasso(4);
    await seguir(); await noPasso(5);
    await seguir(); await noPasso(6);
    // Função: pensa até escolher; escolhida, comemora.
    expect(await mascote()).toBe("pensando");
    await clicar('[data-act="apres-escolher"][data-campo="funcao"][data-valor="Produto"]');
    await ate(`document.querySelector(".ap-camada .ap-personagem nod-mascote")?.dataset.estado === "comemorando"`, "o personagem comemorando a função");
    await seguir(); await noPasso(7);
    await clicar('[data-act="apres-escolher"][data-campo="origem"][data-valor="Amigo ou colega"]');
    await seguir(); await noPasso(8);
    // Conectar apps: pular (sem contas aqui).
    expect(await existe('[data-act="apres-conectar"]')).toBe(true);
    await clicar('[data-act="apres-pular"]'); await noPasso(9);
    // Criar: o nome sugerido pela função, forma e cor do Grok (sem o preto), e a primeira mensagem.
    expect(await existe('.cb-cores [data-cor="c-black"]')).toBe(false);
    await clicar('[data-act="apres-forma"][data-forma="shape-star"]');
    await clicar('[data-act="apres-cor"][data-cor="c-green"]');
    await ate(`document.querySelector('[data-act="apres-forma"][data-forma="shape-star"]')?.getAttribute("aria-checked") === "true" && document.querySelector('[data-act="apres-cor"][data-cor="c-green"]')?.getAttribute("aria-checked") === "true"`, "forma e cor escolhidas");
    await avaliar(cdp, `(() => { const t = document.querySelector('textarea[data-campo-apres="primeira"]'); t.value = "Organize as ideias desta semana [[texto: Organizei as ideias]]"; t.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await clicar('[data-act="apres-criar"]');
    // Preparando: a barra com % sobe até 100 e o personagem comemora; depois, a conversa do bot novo.
    await noPasso(10);
    await ate(`document.querySelector(".ap-camada .cb-barra[role=progressbar]")`, "a barra do preparo");
    const visto: number[] = [];
    for (let t = 0; t < 300 && !(await existe('.ap-camada .cb-preparo[data-fim="pronto"]')); t++) {
      const v = await avaliar<number | null>(cdp, `Number(document.querySelector(".ap-camada .cb-barra")?.getAttribute("aria-valuenow") ?? NaN)`);
      if (typeof v === "number" && !Number.isNaN(v)) visto.push(v);
      if (await existe('.ap-camada .cb-preparo[data-fim="erro"]')) throw new Error(`o preparo deu erro: ${await texto(".ap-camada .cb-erro")}`);
      await espera(100);
    }
    expect(await texto(".ap-camada .cb-porcento")).toBe("100%");
    expect(await mascote()).toBe("comemorando");
    expect(visto.some((v) => v > 0 && v < 100)).toBe(true);
    await ate(`!document.querySelector(".ap-camada") && document.getElementById("composer-texto")`, "a conversa do bot novo");
    const frota = await srv.json<{ agentes: { id: string; nome: string; forma: string; cor: string; conversaId: string }[] }>("GET", "frota");
    const lia = frota.agentes.find((a) => a.nome === "Lia");
    expect(lia).toMatchObject({ forma: "shape-star", cor: "c-green" });
    if (lia) { agentes.push(lia.id); conversas.push(lia.conversaId); }
    // A primeira mensagem do passo 9 foi para o bot novo (e ele respondeu).
    if (lia) await ateResponder(lia, "Organizei as ideias");
    onboardingConcluido = (await srv.json<{ etapa?: string }>("GET", "onboarding")).etapa === "concluido";
  });

  // ———————————————————————————————————————————————— 1 ————————————————————————————————————————————————
  it("1. cartão de aprovação: Permitir uma vez · Sempre permitir · Negar (Esc); decidido, encolhe numa linha de status", { timeout: JORNADA }, async () => {
    const bot = await criarBot("Cartão Grok", "manual", [{ conectorId: conectorGravar, capacidade: "gravar" }]);
    await abrirApp();
    await abrirConversa(bot);

    // (a) Os três verbos do Grok no cartão (print 37: Permitir uma vez · Sempre permitir · ✕ = Negar uma vez com Esc).
    await falar(bot, `Grave "um". [[tool: pedir_aprovacao ${pedirGravar("um")}]] [[texto: gravei]]`);
    await ate(`document.querySelector("#timeline li.decisao.aprov-card[data-decisao]")`, "o cartão de aprovação");
    expect(await texto('#timeline li.decisao.aprov-card [data-act="decidir-aprovacao"]')).toBe("Permitir uma vez");
    expect(await texto('#timeline li.decisao.aprov-card [data-act="decidir-aprovacao-sempre"]')).toMatch(/^Sempre permitir /);
    expect(await avaliar<string | null>(cdp, `document.querySelector('#timeline li.decisao.aprov-card [data-act="decidir-aprovacao-nenhum"]')?.getAttribute("aria-label") ?? null`)).toBe("Negar");
    expect(await existe('#timeline li.decisao.aprov-card [data-act="decidir-aprovacao-nenhum"] kbd')).toBe(true);

    // (b) Esc com o foco no cartão nega (no campo de texto, o Esc é do campo).
    await avaliar(cdp, `document.querySelector('#timeline li.decisao.aprov-card [data-act="decidir-aprovacao"]').focus()`);
    await tecla("Escape", { vk: 27 });
    await ate(`[...document.querySelectorAll("#timeline .cartao-encolhido .ce-resultado")].some((e) => e.textContent.startsWith("Negado"))`, "a linha de negado");
    expect(await existe("#timeline li.decisao.aprov-card[data-decisao]")).toBe(false);
    expect(readFileSync(arquivoGravar, "utf8")).toBe("");

    // (c) Permitir uma vez: faz e encolhe em "Aprovado por você · feito HH:MM".
    await falar(bot, `Grave "dois". [[tool: pedir_aprovacao ${pedirGravar("dois")}]] [[texto: gravei]]`);
    await ate(`document.querySelector("#timeline li.decisao.aprov-card[data-decisao]")`, "o 2º cartão");
    await clicar('#timeline li.decisao.aprov-card [data-act="decidir-aprovacao"]');
    await ate(`[...document.querySelectorAll("#timeline .cartao-encolhido .ce-resultado")].some((e) => /^Aprovado por você · feito \\d\\d:\\d\\d$/.test(e.textContent))`, "a linha de aprovado");
    for (let t = 0; t < 50 && !readFileSync(arquivoGravar, "utf8").includes("dois"); t++) await espera(100);
    expect(readFileSync(arquivoGravar, "utf8")).toContain("dois");

    // (d) Sempre permitir: encolhe em "Permitido daqui em diante" (Grok: "Allowed from now on: {rule}") e o próximo igual
    // não pede mais.
    await falar(bot, `Grave "três". [[tool: pedir_aprovacao ${pedirGravar("três")}]] [[texto: gravei]]`);
    await ate(`document.querySelector("#timeline li.decisao.aprov-card[data-decisao]")`, "o 3º cartão");
    await clicar('#timeline li.decisao.aprov-card [data-act="decidir-aprovacao-sempre"]');
    await ate(`[...document.querySelectorAll("#timeline .cartao-encolhido .ce-resultado")].some((e) => e.textContent === "Permitido daqui em diante")`, "a linha da regra");
    await falar(bot, `Grave "quatro". [[tool: pedir_aprovacao ${pedirGravar("quatro")}]] [[texto: gravei quatro]]`);
    for (let t = 0; t < 100 && !readFileSync(arquivoGravar, "utf8").includes("quatro"); t++) await espera(100);
    expect(readFileSync(arquivoGravar, "utf8")).toContain("quatro");
    expect(await existe("#timeline li.decisao.aprov-card[data-decisao]")).toBe(false);
  });

  /** Linhas gravadas pelo MCP "gravar" (uma por chamada que rodou). */
  const gravados = () => readFileSync(arquivoGravar, "utf8").split("\n").filter(Boolean);
  async function ateGravar(t: string, ms = 15_000): Promise<void> {
    for (let i = 0; i < ms / 100 && !readFileSync(arquivoGravar, "utf8").includes(t); i++) await espera(100);
    expect(readFileSync(arquivoGravar, "utf8")).toContain(t);
  }
  /** O turno terminou (a resposta do bot chegou): sem cartão pendente nem trabalho vivo para esperar. */
  async function ateResponder(bot: { conversaId: string }, fala: string, ms = 20_000): Promise<void> {
    for (let t = 0; t < ms; t += 150) {
      const r = await srv.json<{ mensagens: { kind: string; texto: string; autoria: { autor_tipo: string } }[] }>("GET", `conversas/${bot.conversaId}/mensagens`);
      if (r.mensagens.some((m) => m.autoria.autor_tipo === "agente" && m.texto.includes(fala))) return;
      await espera(150);
    }
    throw new Error(`o bot não respondeu "${fala}"`);
  }

  /** Até o bot ter `n` pedidos abertos em "Sua vez". */
  async function atePedidos(agenteId: string, n: number, ms = 20_000): Promise<void> {
    for (let t = 0; t < ms; t += 150) {
      const r = await srv.json<{ itens: { decisao: { agenteId: string } }[] }>("GET", "sua-vez");
      if (r.itens.filter((i) => i.decisao.agenteId === agenteId).length >= n) return;
      await espera(150);
    }
    throw new Error(`esperei ${n} pedidos abertos do bot`);
  }

  // ———————————————————————————————————————————————— 2 ————————————————————————————————————————————————
  it("2. regras em texto só no Automático: o cartão sugere e salva a regra; o que passa por ela mostra 'Aprovado pela sua regra · Editar'", { timeout: JORNADA }, async () => {
    const bot = await criarBot("Regras Grok", "automatico", [{ conectorId: conectorGravar, capacidade: "gravar" }]);
    // Uma regra de "Sempre me pergunte" põe toda escrita do bot na mão do revisor (sem ela, a escrita comum roda direto).
    await srv.json("POST", "aprovacoes/regras", { agenteId: bot.id, lista: "perguntar", texto: "Sempre me pergunte antes de apagar algo" });
    api.responder(() => PEDE("Pode gravar notas no Gravador sem perguntar"));
    await abrirApp();
    await abrirConversa(bot);

    // (a) O revisor pede: o cartão vem com "Salvar como regra" marcado e a sugestão editável; "Permitir e salvar regra".
    await falar(bot, `Grave "regra-1". [[tool: gravador__gravar {"texto":"regra-1"}]] [[texto: gravei regra-1]]`);
    await ate(`document.querySelector("#timeline li.decisao.cartao-revisor input[data-cr-regra-marca]")`, "o cartão do revisor com a regra");
    expect(await avaliar<boolean>(cdp, `document.querySelector("#timeline input[data-cr-regra-marca]").checked`)).toBe(true);
    expect(await texto("#timeline li.cartao-revisor .cr-regra-marca span")).toBe("Salvar como regra");
    expect(await avaliar<string>(cdp, `document.querySelector("#timeline input[data-cr-regra-texto]").value`)).toBe("Pode gravar notas no Gravador sem perguntar");
    await avaliar(cdp, `(() => { const i = document.querySelector("#timeline input[data-cr-regra-texto]"); i.value = "Pode gravar notas do teste no Gravador"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await clicar('#timeline [data-act="decidir-aprovacao-com-regra"]');
    await ateGravar("regra-1");
    const ajustes = await srv.json<{ regras: { doBot: { id: string; lista: string; texto: string; origem: string }[] } }>("GET", `aprovacoes/ajustes?agente=${bot.id}`);
    const salva = ajustes.regras.doBot.find((r) => r.lista === "permitir");
    expect(salva).toMatchObject({ texto: "Pode gravar notas do teste no Gravador", origem: "sugestao" });

    // (b) A próxima, liberada pela regra P1: a linha "Aprovado pela sua regra · <regra> · Editar", sem cartão.
    api.responder(() => LIBERA_PELA("P1"));
    await falar(bot, `Grave "regra-2". [[tool: gravador__gravar {"texto":"regra-2"}]] [[texto: gravei regra-2]]`);
    await ateGravar("regra-2");
    await ate(`document.querySelector("#timeline .linha-modo.linha-regra [data-act='apv-editar-da-linha']")`, "a linha da regra");
    expect(await texto("#timeline .linha-modo.linha-regra .linha-modo-txt")).toBe("Aprovado pela sua regra · Pode gravar notas do teste no Gravador");
    expect(await texto("#timeline .linha-modo.linha-regra [data-act='apv-editar-da-linha']")).toBe("Editar");
    expect(await avaliar<string | null>(cdp, `document.querySelector("#timeline [data-act='apv-editar-da-linha']").dataset.regra`)).toBe(salva?.id);
    // Editar abre Configurações › Aprovações com a regra em edição.
    await clicar("#timeline [data-act='apv-editar-da-linha']");
    await ate(`document.querySelector('.cfg-secao.apv [data-act="apv-salvar-regra"][data-regra="${salva?.id}"]')`, "a regra em edição nos Ajustes");

    // (c) No Manual não há regra: o cartão é o comum, sem "Salvar como regra".
    const manual = await criarBot("Manual sem regra", "manual", [{ conectorId: conectorGravar, capacidade: "gravar" }]);
    await abrirApp();
    await abrirConversa(manual);
    await falar(manual, `Grave "manual-1". [[tool: pedir_aprovacao ${pedirGravar("manual-1")}]] [[texto: pedi]]`);
    await ate(`document.querySelector("#timeline li.decisao.aprov-card[data-decisao]")`, "o cartão do manual");
    expect(await existe("#timeline input[data-cr-regra-marca]")).toBe(false);
    expect(await existe('#timeline [data-act="decidir-aprovacao-com-regra"]')).toBe(false);
    await clicar('#timeline li.decisao.aprov-card [data-act="decidir-aprovacao-nenhum"]');
    api.responder(() => PEDE());
  });

  // ———————————————————————————————————————————————— 3 ————————————————————————————————————————————————
  it("3. aprovação em lote: pedidos iguais viram um cartão na conversa, com 'Permitir os N' e 'Negar todos'", { timeout: JORNADA }, async () => {
    const bot = await criarBot("Lote Grok", "manual", [{ conectorId: conectorGravar, capacidade: "gravar" }]);
    await abrirApp();
    await abrirConversa(bot);
    // O pedir_aprovacao encerra o turno: um pedido por fala, três falas (o lote junta pedidos de turnos diferentes).
    for (const [n, t] of ["lote-a", "lote-b", "lote-c"].entries()) {
      await falar(bot, `Grave ${t}. [[tool: pedir_aprovacao ${pedirGravar(t)}]] [[texto: pedi ${t}]]`);
      await atePedidos(bot.id, n + 1);
    }
    await ate(`document.querySelector("#timeline li.aprov-iguais[data-iguais]")`, "o cartão em lote na conversa");
    await ate(`document.querySelector("#timeline li.aprov-iguais").dataset.iguais.split(",").length === 3`, "os 3 no lote");
    expect(await avaliar<number>(cdp, `document.querySelectorAll("#timeline li.decisao.aprov-card:not(.aprov-iguais)").length`)).toBe(0);
    expect(await texto('#timeline [data-act="iguais-permitir"]')).toBe("Permitir os 3");
    // Desmarca um: o botão conta 2, e só os 2 saem; o desmarcado é negado.
    await avaliar(cdp, `(() => { const c = document.querySelectorAll("#timeline li.aprov-iguais input[data-igual]")[2]; c.click(); })()`);
    expect(await texto('#timeline [data-act="iguais-permitir"]')).toBe("Permitir os 2");
    await clicar('#timeline [data-act="iguais-permitir"]');
    await ateGravar("lote-b");
    await ateGravar("lote-a");
    await espera(800);
    expect(gravados().some((l) => l.includes("lote-c"))).toBe(false);
    await ate(`!document.querySelector("#timeline li.aprov-iguais")`, "o lote resolvido");
    // Negar todos (Esc no cartão do lote).
    for (const [n, t] of ["lote-d", "lote-e"].entries()) {
      await falar(bot, `Grave ${t}. [[tool: pedir_aprovacao ${pedirGravar(t)}]] [[texto: pedi ${t}]]`);
      await atePedidos(bot.id, n + 1);
    }
    await ate(`document.querySelector("#timeline li.aprov-iguais[data-iguais]")`, "o 2º lote");
    await avaliar(cdp, `document.querySelector('#timeline [data-act="iguais-permitir"]').focus()`);
    await tecla("Escape", { vk: 27 });
    await ate(`!document.querySelector("#timeline li.aprov-iguais")`, "o lote negado");
    await espera(500);
    expect(gravados().some((l) => l.includes("lote-d") || l.includes("lote-e"))).toBe(false);
  });

  // ———————————————————————————————————————————————— 4 ————————————————————————————————————————————————
  it("4. quatro níveis por ferramenta, só leitura sem cartão e o teto do admin", { timeout: JORNADA }, async () => {
    const acessos = [{ conectorId: conectorGravar, capacidade: "gravar" }, { conectorId: conectorGravar, capacidade: "somar" }];
    const bot = await criarBot("Níveis Grok", "manual", acessos);
    const nivel = (n: string) => srv.json("POST", "aprovacoes/niveis", { agenteId: bot.id, conector: "gravador", ferramenta: "", tipo: "escrita", nivel: n });
    const cartoesAbertos = async () => (await srv.json<{ itens: { decisao: { agenteId: string } }[] }>("GET", "sua-vez")).itens.filter((i) => i.decisao.agenteId === bot.id).length;

    // Sempre permitir: no Manual, roda sem cartão.
    await nivel("sempre_permitir");
    await falar(bot, `Grave. [[tool: pedir_aprovacao ${pedirGravar("nivel-permitir")}]] [[texto: fim-permitir]]`);
    await ateResponder(bot, "fim-permitir");
    await ateGravar("nivel-permitir");
    expect(await cartoesAbertos()).toBe(0);

    // Bloqueado: nem pedindo — sem cartão, nada grava.
    await nivel("bloqueado");
    await falar(bot, `Grave. [[tool: pedir_aprovacao ${pedirGravar("nivel-bloqueado")}]] [[tool: gravador__gravar {"texto":"nivel-bloqueado"}]] [[texto: fim-bloqueado]]`);
    await ateResponder(bot, "fim-bloqueado");
    expect(await cartoesAbertos()).toBe(0);
    expect(gravados().some((l) => l.includes("nivel-bloqueado"))).toBe(false);

    // Sempre pedir: até no Total, o cartão aparece.
    await nivel("sempre_pedir");
    await srv.json("POST", `agentes/${bot.id}/modo-aprovacao`, { modo: "total", confirmado: true });
    await falar(bot, `Grave. [[tool: pedir_aprovacao ${pedirGravar("nivel-pedir")}]] [[texto: fim-pedir]]`);
    await ateResponder(bot, "fim-pedir");
    expect(await cartoesAbertos()).toBe(1);
    const d = (await srv.json<{ itens: { decisao: { id: string; agenteId: string } }[] }>("GET", "sua-vez")).itens.find((i) => i.decisao.agenteId === bot.id);
    await srv.json("POST", `decisoes/${d?.decisao.id}/decidir`, { itens: [] });
    await nivel("revisor");

    // Só leitura: a leitura roda; a escrita é barrada sem cartão.
    await srv.json("POST", `agentes/${bot.id}/so-leitura`, { soLeitura: true });
    await falar(bot, `Some e grave. [[tool: gravador__somar {"a":2,"b":3}]] [[tool: pedir_aprovacao ${pedirGravar("so-leitura")}]] [[texto: fim-leitura]]`);
    await ateResponder(bot, "fim-leitura");
    expect(await cartoesAbertos()).toBe(0);
    expect(gravados().some((l) => l.includes("so-leitura"))).toBe(false);
    await srv.json("POST", `agentes/${bot.id}/so-leitura`, { soLeitura: false });

    // Teto do admin: o bot pediu Total e roda em Manual; a tela avisa.
    await srv.json("POST", "aprovacoes/teto", { teto: "manual" });
    try {
      const aj = await srv.json<{ modoPedido: string; modoEfetivo: string; teto: string; admin: boolean }>("GET", `aprovacoes/ajustes?agente=${bot.id}`);
      expect(aj).toMatchObject({ modoPedido: "total", modoEfetivo: "manual", teto: "manual", admin: true });
      await falar(bot, `Grave. [[tool: pedir_aprovacao ${pedirGravar("teto")}]] [[texto: fim-teto]]`);
      await ateResponder(bot, "fim-teto");
      expect(await cartoesAbertos()).toBe(1);
      // A tela: os quatro níveis no seletor de cada app e o aviso do teto.
      await abrirApp("#ajuste=aprovacoes");
      await ate(`document.querySelector(".cfg-secao.apv select[data-act-change='apv-nivel']")`, "Ajustes › Aprovações");
      const opcoes = await avaliar<string[]>(cdp, `[...document.querySelectorAll(".cfg-secao.apv select[data-act-change='apv-nivel']")].slice(0, 1).flatMap((s) => [...s.querySelectorAll("option")].map((o) => o.textContent.trim()))`);
      expect(opcoes.sort()).toEqual(["Bloqueado", "O revisor decide", "Sempre pedir", "Sempre permitir"].sort());
      await ate(`document.querySelector(".cfg-secao.apv .apv-aviso")`, "o aviso do teto");
      expect(await texto(".cfg-secao.apv .apv-aviso")).toMatch(/^Seu admin limitou os bots do time a /);
    } finally {
      await srv.json("POST", "aprovacoes/teto", { teto: null });
    }
  });

  // ———————————————————————————————————————————————— 6 ————————————————————————————————————————————————
  it("6. ⌘K acha bots, conversas, ajustes e ações; os atalhos ⌘B, ⌘, , ⌘I, ⌘L e ⌘⇧N (no Chrome do Linux: Ctrl+K e Alt)", { timeout: JORNADA }, async () => {
    const bot = await criarBot("Atalhos Grok", "manual");
    // Uma sala (conversa em grupo), para o grupo Conversas ter o que achar.
    const colega = await criarBot("Colega Grok", "manual");
    const sala = await srv.json<{ ids: { sala?: string; conversa?: string } }>("POST", "salas", { nome: "Vendas da semana", agenteIds: [bot.id, colega.id] });
    if (sala.ids.conversa) conversas.push(sala.ids.conversa);
    await abrirApp();
    await abrirConversa(bot);
    // ⌘K (Ctrl+K fora do Mac): a paleta com os quatro grupos.
    await avaliar(cdp, `document.activeElement?.blur()`);
    await tecla("k", { code: "KeyK", vk: 75, mod: 2 });
    await ate(`document.querySelector(".paleta[role=dialog] #paleta-termo")`, "a paleta");
    const grupos = await avaliar<string[]>(cdp, `[...document.querySelectorAll(".paleta .paleta-grupo")].map((g) => g.getAttribute("aria-label"))`);
    for (const g of ["Bots", "Ações"]) expect(grupos).toContain(g);
    const buscar = async (termo: string, grupo: string) => {
      // Digita de novo a cada volta (como quem digita): o grupo Conversas pode chegar depois de a paleta abrir.
      const digitar = `(() => { const i = document.getElementById("paleta-termo"); i.value = ${JSON.stringify(termo)}; i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`;
      const achou = `[...document.querySelectorAll('.paleta .paleta-grupo[aria-label="${grupo}"] .paleta-item')].some((e) => e.textContent.toLowerCase().includes(${JSON.stringify(termo.toLowerCase())}))`;
      await ate(`${digitar} && ${achou}`, `"${termo}" em ${grupo}`);
    };
    await buscar("Atalhos Grok", "Bots");
    await buscar("tema", "Ajustes");
    await buscar("Vendas da semana", "Conversas");
    await buscar("nova", "Ações");
    // Enter no ajuste leva às Configurações já na linha.
    await buscar("tema", "Ajustes");
    await clicar('.paleta .paleta-grupo[aria-label="Ajustes"] .paleta-item');
    await ate(`document.getElementById("ajuste-tema")`, "a linha Tema");
    await tecla("Escape", { vk: 27 });
    await abrirApp();
    await abrirConversa(bot);
    await avaliar(cdp, `document.activeElement?.blur()`);
    // ⌘B: a barra compacta e volta.
    const largura = () => avaliar<string | undefined>(cdp, `document.documentElement.dataset.largura`);
    const antes = await largura();
    await tecla("b", { code: "KeyB", vk: 66, mod: 1 });
    await ate(`document.documentElement.dataset.largura === "recolhida"`, "a barra recolhida");
    await tecla("b", { code: "KeyB", vk: 66, mod: 1 });
    await ate(`document.documentElement.dataset.largura !== "recolhida"`, "a barra de volta");
    expect(await largura()).toBe(antes);
    // ⌘I: foca o campo.
    await tecla("i", { code: "KeyI", vk: 73, mod: 1 });
    await ate(`document.activeElement?.id === "composer-texto"`, "o foco no campo");
    // ⌘L: a seleção da conversa vai para o campo (citação). Primeiro, uma fala do bot para selecionar.
    await falar(bot, "Oi [[texto: Fala do bot para citar]]");
    await ate(`[...document.querySelectorAll("#timeline .message.bot .bubble")].some((b) => b.textContent.includes("Fala do bot para citar"))`, "a fala do bot");
    await avaliar(cdp, `(() => { const b = [...document.querySelectorAll("#timeline .message.bot .bubble")].find((x) => x.textContent.includes("Fala do bot para citar")); const r = document.createRange(); r.selectNodeContents(b); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.activeElement?.blur(); })()`);
    const citado = await avaliar<string>(cdp, `getSelection().toString().trim().slice(0, 20)`);
    await tecla("l", { code: "KeyL", vk: 76, mod: 1 });
    await ate(`document.querySelector(".caixa-citacao .rp-trecho")?.textContent.includes("Fala do bot para citar") && document.activeElement?.id === "composer-texto"`, "a seleção citada no campo");
    expect(citado.length).toBeGreaterThan(0);
    // ⌘, : Configurações.
    await avaliar(cdp, `document.activeElement?.blur()`);
    await tecla(",", { code: "Comma", vk: 188, mod: 1 });
    await ate(`document.getElementById("busca-ajustes")`, "as Configurações");
    await tecla("Escape", { vk: 27 });
    // ⌘⇧N: nova sala.
    await abrirApp();
    await avaliar(cdp, `document.activeElement?.blur()`);
    await tecla("N", { code: "KeyN", vk: 78, mod: 1 | 8 });
    await ate(`document.querySelector(".tela-nova-sala")`, "a tela de nova sala");
  });

  // ———————————————————————————————————————————————— 7 ————————————————————————————————————————————————
  it("7. Configurações com busca e link próprio por ajuste", { timeout: JORNADA }, async () => {
    await abrirApp();
    await avaliar(cdp, `document.activeElement?.blur()`);
    await tecla(",", { code: "Comma", vk: 188, mod: 1 });
    await ate(`document.getElementById("busca-ajustes")`, "a busca dos ajustes");
    const buscarAjuste = (t: string) => avaliar(cdp, `(() => { const i = document.getElementById("busca-ajustes"); i.focus(); i.value = ${JSON.stringify(t)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    // A busca acha por título e por palavra ("escuro" acha Tema), com o caminho.
    await buscarAjuste("escuro");
    await ate(`document.querySelector('.cfg-achado[data-act="ir-ao-ajuste"][data-ajuste="tema"]')`, "Tema pela palavra escuro");
    expect(await texto('.cfg-achado[data-ajuste="tema"] .cfg-achado-caminho')).toBe("Geral › Aparência");
    await buscarAjuste("zzzz nada");
    await ate(`document.querySelector(".cfg-busca-vazia")`, "a busca vazia");
    // Achou "só leitura" (Aprovações): o clique leva à linha dela, realçada.
    await buscarAjuste("só leitura");
    await ate(`document.querySelector('.cfg-achado[data-ajuste="so-leitura"]')`, "Só leitura na busca");
    // Cada linha tem o link copiável e o link abre já na linha.
    await abrirApp("#ajuste=tema");
    await ate(`document.querySelector("#ajuste-tema.realce")`, "a linha Tema realçada pelo link");
    expect(await existe('#ajuste-tema [data-act="copiar-link-ajuste"][data-ajuste="tema"]')).toBe(true);
    for (const id of ["aprovacoes-modo", "regras-revisor", "teto-do-time", "nivel-por-app"]) {
      await abrirApp(`#ajuste=${id}`);
      await ate(`document.querySelector("#ajuste-${id}.realce")`, `a linha ${id} realçada pelo link`);
      expect(await existe(`#ajuste-${id} [data-act="copiar-link-ajuste"][data-ajuste="${id}"]`)).toBe(true);
    }
  });

  // ———————————————————————————————————————————————— 8 ————————————————————————————————————————————————
  it("8. criar bot com cor e forma, e o preparo com %", { timeout: JORNADA }, async () => {
    await abrirApp();
    await clicar('.create-trigger[data-tela="novo-bot"]');
    await ate(`document.querySelector('[data-act="criar-rapido"]')`, "Criar novo bot");
    await clicar('[data-act="criar-rapido"]');
    await ate(`document.querySelector("dialog.criar-bot[open] .cb-nome")`, "o modal Criar novo bot");
    expect(await avaliar<number>(cdp, `document.querySelectorAll('dialog.criar-bot .cb-formas [role=radio][data-forma]').length`)).toBe(13);
    expect(await avaliar<number>(cdp, `document.querySelectorAll('dialog.criar-bot .cb-cores [role=radio][data-cor]').length`)).toBe(14);
    expect(await avaliar<boolean>(cdp, `document.querySelector('dialog.criar-bot [data-cb="criar"]').disabled`)).toBe(true);
    await avaliar(cdp, `(() => { const i = document.querySelector("dialog.criar-bot .cb-nome"); i.value = "Bolota"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await clicar('dialog.criar-bot [data-forma="shape-heart"]');
    await clicar('dialog.criar-bot [data-cor="c-purple"]');
    await ate(`document.querySelector('dialog.criar-bot [data-forma="shape-heart"]').getAttribute("aria-checked") === "true" && document.querySelector('dialog.criar-bot [data-cor="c-purple"]').getAttribute("aria-checked") === "true"`, "forma e cor marcadas");
    // A prévia veste o personagem com a escolha.
    expect(await avaliar<string>(cdp, `document.querySelector("dialog.criar-bot .cb-previa nod-mascote").className`)).toMatch(/c-purple.*shape-heart|shape-heart.*c-purple/);
    expect(await avaliar<string>(cdp, `document.querySelector("dialog.criar-bot .cb-nome").value`)).toBe("Bolota");
    await clicar('dialog.criar-bot [data-cb="criar"]');
    await ate(`document.querySelector("dialog.criar-bot .cb-barra[role=progressbar]")`, "o preparo");
    const visto: number[] = [];
    for (let t = 0; t < 300 && !(await existe('dialog.criar-bot .cb-preparo[data-fim="pronto"]')); t++) {
      const v = await avaliar<number>(cdp, `Number(document.querySelector("dialog.criar-bot .cb-barra")?.getAttribute("aria-valuenow") ?? -1)`);
      if (v >= 0) visto.push(v);
      if (await existe('dialog.criar-bot .cb-preparo[data-fim="erro"]')) throw new Error(`o preparo deu erro: ${await texto("dialog.criar-bot .cb-erro")}`);
      await espera(80);
    }
    expect(await texto("dialog.criar-bot .cb-porcento")).toBe("100%");
    expect(await avaliar<string | null>(cdp, `document.querySelector("dialog.criar-bot .cb-preparo nod-mascote")?.dataset.estado ?? null`)).toBe("comemorando");
    expect(visto.some((v) => v > 0 && v < 100)).toBe(true);
    await ate(`!document.querySelector("dialog.criar-bot") && document.getElementById("composer-texto")`, "a conversa do bot novo");
    const bolota = (await srv.json<{ agentes: { id: string; nome: string; forma: string; cor: string; conversaId: string }[] }>("GET", "frota")).agentes.find((a) => a.nome === "Bolota");
    expect(bolota).toMatchObject({ forma: "shape-heart", cor: "c-purple" });
    if (bolota) { agentes.push(bolota.id); conversas.push(bolota.conversaId); }
  });

  // ———————————————————————————————————————————————— 9 ————————————————————————————————————————————————
  it("9. o personagem muda de estado com o trabalho: disponível → trabalhando → aguardando você → disponível", { timeout: JORNADA }, async () => {
    const bot = await criarBot("Personagem Grok", "manual", [{ conectorId: conectorGravar, capacidade: "gravar" }]);
    await abrirApp();
    await abrirConversa(bot);
    const naBarra = (e: string) => ate(`document.querySelector('#sidebar [data-bot-contexto="${bot.id}"] nod-mascote')?.dataset.estado === "${e}"`, `o personagem ${e}`);
    await naBarra("disponivel");
    await falar(bot, "Trabalhe um pouco [[espera: 4000]] [[texto: terminei o trabalho]]");
    await ate(`["trabalhando", "pensando", "lendo"].includes(document.querySelector('#sidebar [data-bot-contexto="${bot.id}"] nod-mascote')?.dataset.estado)`, "o personagem trabalhando");
    // O mesmo estado na pílula da conversa.
    expect(["trabalhando", "pensando", "lendo"]).toContain(await avaliar<string | null>(cdp, `document.querySelector(".pilula-bot nod-mascote")?.dataset.estado ?? null`));
    await ateResponder(bot, "terminei o trabalho");
    await naBarra("disponivel");
    await falar(bot, `Grave. [[tool: pedir_aprovacao ${pedirGravar("personagem")}]] [[texto: pedi]]`);
    await atePedidos(bot.id, 1);
    await naBarra("aguardando");
    await ate(`document.querySelector('#timeline li.decisao.aprov-card [data-act="decidir-aprovacao-nenhum"]')`, "o cartão do pedido");
    await clicar('#timeline li.decisao.aprov-card [data-act="decidir-aprovacao-nenhum"]');
    await naBarra("disponivel");
  });

  // ———————————————————————————————————————————————— 5 ————————————————————————————————————————————————
  it("5. 'Aguardando você: {motivo}' em laranja na linha do bot; o clique abre a conversa rolada até o cartão", { timeout: JORNADA }, async () => {
    const bot = await criarBot("Espera Grok", "manual");
    const outro = await criarBot("Outro Grok", "manual");
    await abrirApp();
    await abrirConversa(outro);
    await falar(bot, `Pergunte. [[tool: pedir_a_pessoa {"tipo":"pergunta","texto":"Posso arquivar o PR 7?"}]] [[texto: perguntei]]`);
    const linha = `#sidebar [data-bot-contexto="${bot.id}"]`;
    await ate(`document.querySelector('${linha}[data-aguardando] .sub-aguardando')`, "a linha aguardando");
    expect(await texto(`${linha} .sub-aguardando`)).toBe("Aguardando você: Posso arquivar o PR 7?");
    // Laranja: a cor vem de --aguardando (o valor é do CSS; aqui só que é a variável, e não a do não lido).
    const cor = await avaliar<{ sub: string; ref: string }>(cdp, `(() => { const v = getComputedStyle(document.documentElement).getPropertyValue("--aguardando").trim(); const p = document.createElement("i"); p.style.color = v; document.body.append(p); const ref = getComputedStyle(p).color; p.remove(); return { sub: getComputedStyle(document.querySelector('${linha} .sub-aguardando')).color, ref }; })()`);
    expect(cor.ref).not.toBe("");
    expect(cor.sub).toBe(cor.ref);
    expect(await existe(`${linha} .ponto-aguardando`)).toBe(true);
    // O clique abre a conversa do bot e realça o cartão pendente.
    await clicar(`${linha} [data-act="abrir-conversa"]`);
    await ate(`document.querySelector('#timeline [data-pergunta].realce, #timeline [data-decisao].realce')`, "o cartão realçado");
    const visivel = await avaliar<boolean>(cdp, `(() => { const r = document.querySelector('#timeline [data-pergunta].realce, #timeline [data-decisao].realce').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()`);
    expect(visivel).toBe(true);
  });

  // ———————————————————————————————————————————————— 11 ————————————————————————————————————————————————
  it("11. rascunhos de envio editáveis, com 'Enviar todos'", { timeout: JORNADA }, async () => {
    const bot = await criarBot("Rascunhos Grok", "manual", [
      { conectorId: conectorExemplo, capacidade: "listar_contatos" },
      { conectorId: conectorExemplo, capacidade: "enviar_email" },
    ]);
    await abrirApp();
    await abrirConversa(bot);
    const itens = ["ana@exemplo.test", "bia@exemplo.test", "caio@exemplo.test"].map((para) => ({
      texto: `Olá, ${para}`,
      destino: { conector: "exemplo", ferramenta: "enviar_email", argumentos: { para, assunto: "Oi", texto: `Olá, ${para}` } },
      origem_conector: "exemplo",
    }));
    await falar(bot, `Mande 3 e-mails. [[tool: pedir_aprovacao ${JSON.stringify({ resumo: "3 e-mails", itens })}]] [[texto: rascunhos prontos]]`);
    await ate(`document.querySelector('#timeline .re-barra[role=region] [data-act="rascunhos-enviar-todos"]')`, "a barra Enviar todos");
    expect(await avaliar<number>(cdp, `document.querySelectorAll("#timeline textarea.re-corpo").length`)).toBe(3);
    // Edita o corpo de um antes de enviar (Grok: rascunho editável).
    await avaliar(cdp, `(() => { const ta = document.querySelectorAll("#timeline textarea.re-corpo")[1]; ta.value = "Olá, Bia! Corpo editado."; ta.dispatchEvent(new Event("input", { bubbles: true })); ta.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    expect(await existe('#timeline [data-act="rascunhos-descartar-todos"]')).toBe(true);
    await clicar('#timeline [data-act="rascunhos-enviar-todos"]');
    for (let t = 0; t < 100 && readFileSync(arquivoEmails, "utf8").trim().split("\n").filter(Boolean).length < 3; t++) await espera(100);
    const enviados = readFileSync(arquivoEmails, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { para: string; texto: string });
    expect(enviados.map((e) => e.para).sort()).toEqual(["ana@exemplo.test", "bia@exemplo.test", "caio@exemplo.test"]);
    expect(enviados.find((e) => e.para === "bia@exemplo.test")?.texto).toBe("Olá, Bia! Corpo editado.");
  });
});
