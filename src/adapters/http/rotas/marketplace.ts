import { COMANDO_GITHUB_NATIVO, ENV_TOKEN_GITHUB, SLUG_GITHUB } from "../../../contracts/github.ts";
import { APPS_MARKETPLACE, type CampoDeConexao } from "../../../contracts/marketplace.ts";
import { chaveDaConta, LIMITE_CONTAS_POR_APP, nomeDaConta, normalizarConta, rotuloValido, separarChave } from "../../../domain/contas-do-app.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { fraseSemJeito } from "../../../domain/github.ts";
import { garantirGithubSemConfiguracao, guardarComposioGithub, guardarTokenGithub } from "../../../use-cases/conectar-github.ts";
import { registrarConector } from "../../../use-cases/registrar-conector.ts";
import { sondarConector, type SaidaSondarConector } from "../../../use-cases/sondar-conector.ts";
import { aoConectarApp } from "../../../use-cases/ao-conectar-app.ts";
import { criarClienteComposio, type EsquemaDeChave } from "../../integracoes/composio.ts";
import { criarCatalogoComposio } from "../../integracoes/catalogo-composio.ts";
import { chavePrivadaValida, criarTokenDeInstalacao } from "../../integracoes/github-app.ts";
import { log } from "../../../obs/log.ts";
import { ESPERAS_SONDA_VERIFICAR_MS, VERIFICAR_TETO_MS } from "../../../shared/constantes.ts";
import type { Escopo } from "../../../shared/types.ts";
import type { Rota } from "../roteador.ts";
import { executar, type DentroDeTx } from "./dentro-de-tx.ts";
import { conferirChaveComposio, conferirTokenGithub } from "./segredos-de-app.ts";

/** Os campos de um app de chave valem uma hora (o esquema muda com o provedor, não com a pessoa). */
const JANELA_CAMPOS_MS = 60 * 60_000;
/**
 * O conectar por chave faz config, conta, sessão, fixação e sonda numa chamada: o mesmo teto do `verificar` mais uma
 * folga para as três chamadas antes da sonda. A sonda continua cortada no VERIFICAR_TETO_MS contado do início.
 */
const CONECTAR_COM_CHAVE_TETO_MS = VERIFICAR_TETO_MS + 15_000;

export type OpcoesRotasMarketplace = {
  dentro: DentroDeTx;
  cifrar: (s: string) => string;
  decifrar: (s: string) => string;
  fetchImpl?: typeof fetch;
  /**
   * definido em 2026-09-24 (ADR-048): quem pode cadastrar o GitHub App da organização — e-mails ou ids
   * em NOD_ADMINS. O nod não tem papel de admin no cadastro (pessoas é só identidade, ADR-030); vazio =
   * ninguém cadastra pela tela.
   */
  admins?: readonly string[];
  /** Base da API do GitHub; só teste. */
  apiGithub?: string;
  /** O App do tenant mudou: o token de instalação guardado em memória deixa de valer. */
  aoTrocarApp?: (tenantId: string) => void;
  /** Espera entre as tentativas de sonda do `verificar` (NOD-208); default setTimeout. Injetável no teste. */
  esperar?: (ms: number) => Promise<void>;
  /** Relógio do teto do `verificar` (NOD-208); default Date.now. */
  agora?: () => number;
};

export function rotasMarketplace(op: OpcoesRotasMarketplace): Rota[] {
  const cliente = (chave: string) => criarClienteComposio(chave, op.fetchImpl);
  const esperar = op.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const agora = op.agora ?? (() => Date.now());
  const catalogo = criarCatalogoComposio({ decifrar: op.decifrar, fetchImpl: op.fetchImpl });
  /**
   * revisto em 2026-09-21 (ADR-041): a curadoria deixou de ser a lista do que EXISTE, então
   * recusar por ausência nela barraria justamente o app recém-criado no painel. Quem valida é o
   * provedor — o `criarSessao` falha para toolkit que ele não conhece. Daqui sai só o nome exibido.
   */
  /** NOD_ADMINS lista e-mails ou ids de pessoa; comparação sem caixa. */
  const ehAdmin = async (escopo: { tenantId: string; pessoaId: string }): Promise<boolean> => {
    const admins = op.admins ?? [];
    if (admins.length === 0) return false;
    if (admins.includes(escopo.pessoaId.toLowerCase())) return true;
    const email = (await op.dentro(escopo, (d) => d.repos.pessoas.buscar(escopo.pessoaId)))?.email?.toLowerCase();
    return !!email && admins.includes(email);
  };
  const acharApp = (slug: string) => {
    if (!/^[a-z0-9_-]{1,64}$/.test(slug) || slug.includes("--")) throw new ErroDeDominio("nao_encontrado");
    return APPS_MARKETPLACE.find((a) => a.slug === slug) ?? { slug, nome: slug, descricao: "", categoria: "" };
  };
  /** Os campos mudam quando o Composio muda o esquema do app, não a cada abertura: uma hora por toolkit. */
  const esquemaPorSlug = new Map<string, { em: number; esquema: EsquemaDeChave }>();
  const esquemaDe = async (slug: string, cifrada: string): Promise<EsquemaDeChave> => {
    const posto = esquemaPorSlug.get(slug);
    if (posto && agora() - posto.em < JANELA_CAMPOS_MS) return posto.esquema;
    const esquema = await cliente(op.decifrar(cifrada)).esquemaDaChave(slug);
    esquemaPorSlug.set(slug, { em: agora(), esquema });
    return esquema;
  };
  /** Só os campos que o app pede, texto de uma linha; o obrigatório vazio é entrada_invalida, não recusa do app. */
  const validarValores = (campos: readonly CampoDeConexao[], bruto: unknown): Record<string, string> => {
    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) throw new ErroDeDominio("entrada_invalida");
    const entrada = bruto as Record<string, unknown>;
    const conhecidos = new Set(campos.map((c) => c.nome));
    if (Object.keys(entrada).some((k) => !conhecidos.has(k))) throw new ErroDeDominio("entrada_invalida");
    const valores: Record<string, string> = {};
    for (const c of campos) {
      const v = entrada[c.nome];
      if (v === undefined || v === null || v === "") { if (c.obrigatorio) throw new ErroDeDominio("entrada_invalida"); continue; }
      if (typeof v !== "string" || v.length > 4096 || /[\r\n]/.test(v) || !v.trim()) throw new ErroDeDominio("entrada_invalida");
      valores[c.nome] = v.trim();
    }
    return valores;
  };
  /** definido em 2026-09-25: conectou, os cards "Conecte o X" abertos viram o de permitir na mesma transação. */
  const sondarUmaVez = (escopo: Escopo, conectorId: string, slug: string, orcamentoMs: number): Promise<SaidaSondarConector> =>
    op.dentro(escopo, async (d) => {
      const s = await executar(d, sondarConector, { conectorId, orcamentoMs });
      if (s.ok) await executar(d, aoConectarApp, { slug });
      return s;
    });
  /**
   * O conector do app aponta para a sessão do Composio, e a sessão guardada liga conta e conector. Mesmo dono e mesma
   * sessão anterior, senão recusa (conector de outra pessoa ou registrado à mão com o mesmo slug). ADR-196: a conta a
   * mais (`conta`) vira o conector `<app>--<conta>`; a que a pessoa tirou antes volta no mesmo conector, sem acesso.
   */
  const guardarConector = (escopo: Escopo, p: { slug: string; nome: string; chave: string; sessao: { id: string; url: string }; contaId: string; conta?: string | null }): Promise<string> =>
    op.dentro(escopo, async (d) => {
      if (p.slug === SLUG_GITHUB) {
        // ADR-048: o Composio é um jeito DENTRO do GitHub nativo; os nomes estáveis e as concessões ficam.
        const g = await guardarComposioGithub(d, { url: p.sessao.url, chave: p.chave, cifrar: op.cifrar, decifrar: op.decifrar });
        await d.repos.composio.salvarSessao({ toolkit: p.slug, sessaoId: p.sessao.id, contaId: p.contaId, conectorId: g.id });
        return g.id;
      }
      const slugDoConector = chaveDaConta(p.slug, p.conta ?? null);
      if (p.conta) {
        // Revisão do PR: a contagem do limite e a gravação na mesma transação, com a trava por pessoa e app.
        await d.repos.composio.travarApp(p.slug);
        const outras = (await d.repos.composio.sessoesDoApp(p.slug)).filter((s) => s.conta !== p.conta).length;
        if (outras + 1 > LIMITE_CONTAS_POR_APP) throw new ErroDeDominio("estado_invalido", { cause: "limite de contas do app" });
      }
      const existente = await d.repos.conectores.buscarPorSlug(slugDoConector);
      if (existente && existente.ownerId !== escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
      const anterior = await d.repos.composio.sessao(slugDoConector);
      const tirada = !!existente?.removidoEm && !anterior;
      if (existente && !tirada && anterior?.conectorId !== existente.id) throw new ErroDeDominio("estado_invalido");
      const env = { "x-api-key": p.chave };
      const conector = existente
        ? await d.repos.conectores.atualizarEndpoint(existente.id, p.sessao.url, op.cifrar(JSON.stringify(env)), Object.keys(env))
        : await executar(d, registrarConector, { nome: p.nome, slug: slugDoConector, transporte: "http", url: p.sessao.url, env, declaracao: "toca", cifrar: op.cifrar });
      if (!conector) throw new ErroDeDominio("estado_invalido");
      if (tirada) {
        // Um cartão antigo pode ter concedido depois do remover: a conta volta sem acesso nenhum.
        await d.repos.conectores.limparAcessos(conector.id, slugDoConector, agora());
        await d.repos.conectores.restaurar(conector.id);
        await d.repos.conectores.renomear(conector.id, p.nome);
      }
      await d.repos.composio.salvarSessao({ toolkit: p.slug, conta: p.conta ?? null, sessaoId: p.sessao.id, contaId: p.contaId, conectorId: conector.id });
      return conector.id;
    });
  /**
   * ADR-196 §6: um "Conectar" anterior que não terminou deixou uma conta pela metade no Composio (cada `link` cria uma).
   * Antes do login novo da mesma conta, a que o nod guardou e não ficou ativa sai. A ativa fica: quem troca a conta é o
   * login novo, e apagar a que funciona antes dele terminar deixaria a pessoa sem nenhuma. Falha aqui só vai ao log.
   */
  const apagarContaPelaMetade = async (escopo: Escopo, c: ReturnType<typeof cliente>, chave: string, toolkit: string): Promise<void> => {
    const anterior = await op.dentro(escopo, (d) => d.repos.composio.sessao(chave));
    if (!anterior) return;
    try {
      const { ativo } = await c.lerConta(anterior.contaId, `nod:${escopo.tenantId}:${escopo.pessoaId}`, toolkit);
      if (ativo) return;
      const removida = await c.removerConta(anterior.contaId);
      log(removida ? "info" : "aviso", "marketplace_conta_pela_metade", { toolkit, removida });
    } catch {
      log("aviso", "marketplace_conta_pela_metade", { toolkit, removida: false });
    }
  };
  /**
   * definido em 2026-10-12 (NOD-208): logo depois do fixarConta a sessão do Composio pode ainda não expor o
   * toolkit; a sonda se repete com espera crescente até o teto. Cada tentativa é uma transação: a espera
   * fica FORA dela e não segura conexão do pool. A falha intermediária grava ultimaFalha; o sucesso a limpa.
   * A conta não é reconsultada a cada volta: revogada no meio, cai no `falhou` e o "Tentar de novo" refaz o login.
   */
  const sondarAteOTeto = async (escopo: Escopo, conectorId: string, slug: string, inicio: number): Promise<SaidaSondarConector> => {
    let r: SaidaSondarConector | null = null;
    for (const [i, espera] of ESPERAS_SONDA_VERIFICAR_MS.entries()) {
      if (i > 0 && agora() - inicio + espera >= VERIFICAR_TETO_MS) break;
      if (espera > 0) await esperar(espera);
      // Revisão do PR #264: a sonda http sozinha pode levar até ORCAMENTO_CONECTOR_MS (30 s, com nova tentativa
      // por dentro); sem este corte, uma tentativa começada aos ~19 s levava a resposta para perto de 50 s.
      r = await sondarUmaVez(escopo, conectorId, slug, VERIFICAR_TETO_MS - (agora() - inicio));
      log(r.ok ? "info" : "aviso", "marketplace_verificar_tentativa", { toolkit: slug, tentativa: i + 1, ok: r.ok, motivo: r.ok ? null : r.conector.ultimaFalha?.motivo ?? null, decorrido_ms: agora() - inicio });
      if (r.ok) break;
    }
    if (!r) throw new ErroDeDominio("estado_invalido");
    return r;
  };
  return [
    /**
     * Jeito 3 (ADR-048): token pessoal no campo avançado. O GitHub é perguntado ANTES de guardar
     * (GET /user): token recusado não vira conector "conectado" que falha na primeira chamada. Guardar
     * e sondar são duas transações — a sonda decifra o env da linha já gravada.
     */
    { metodo: "POST", acao: "apps.github_token", padrao: /^\/marketplace\/github\/token$/, async handler(ctx) {
      const body = await ctx.corpo() as { token?: unknown } | null;
      const token = await conferirTokenGithub(body?.token, op);
      const salvo = await op.dentro(ctx.escopo, (d) => guardarTokenGithub(d, { token, cifrar: op.cifrar, decifrar: op.decifrar }));
      const s = await op.dentro(ctx.escopo, async (d) => {
        const r = await executar(d, sondarConector, { conectorId: salvo.id });
        if (r.ok) await executar(d, aoConectarApp, { slug: SLUG_GITHUB });
        return r;
      });
      ctx.json(200, { conectado: s.ok, conectorId: salvo.id, conector: s.conector });
    } },
    /**
     * Jeito 5 (ADR-048): o GitHub App da organização, para as rotinas no executor de servidor. A
     * chave privada nunca volta: o GET diz só se há App e quais números. O POST gera um token de
     * instalação ANTES de guardar — app, instalação ou chave errados não viram configuração muda.
     */
    { metodo: "GET", padrao: /^\/marketplace\/github\/app$/, async handler(ctx) {
      const c = await op.dentro(ctx.escopo, (d) => d.repos.githubApp.config());
      const admin = await ehAdmin(ctx.escopo);
      ctx.json(200, c ? { configurado: true, appId: c.appId, instalacaoId: c.instalacaoId, podeTrocar: admin && c.ownerId === ctx.escopo.pessoaId } : { configurado: false, podeCadastrar: admin });
    } },
    { metodo: "POST", acao: "apps.github_app", padrao: /^\/marketplace\/github\/app$/, async handler(ctx) {
      const body = await ctx.corpo() as { appId?: unknown; instalacaoId?: unknown; chavePrivada?: unknown } | null;
      const appId = typeof body?.appId === "string" || typeof body?.appId === "number" ? String(body.appId).trim() : "";
      const instalacaoId = typeof body?.instalacaoId === "string" || typeof body?.instalacaoId === "number" ? String(body.instalacaoId).trim() : "";
      const chavePem = typeof body?.chavePrivada === "string" ? body.chavePrivada.trim() : "";
      if (!(await ehAdmin(ctx.escopo))) throw new ErroDeDominio("nao_permitido");
      if (!/^[0-9]{1,12}$/.test(appId) || !/^[0-9]{1,15}$/.test(instalacaoId) || chavePem.length > 16_384 || !chavePrivadaValida(chavePem)) throw new ErroDeDominio("entrada_invalida");
      const atual = await op.dentro(ctx.escopo, (d) => d.repos.githubApp.config());
      if (atual && atual.ownerId !== ctx.escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
      await criarTokenDeInstalacao({ appId, instalacaoId, chavePem, agora: Date.now(), base: op.apiGithub, fetchImpl: op.fetchImpl });
      await op.dentro(ctx.escopo, (d) => d.repos.githubApp.salvar({ appId, instalacaoId, chavePrivadaCifrada: op.cifrar(chavePem) }));
      op.aoTrocarApp?.(ctx.escopo.tenantId);
      ctx.json(200, { configurado: true, appId, instalacaoId });
    } },
    { metodo: "POST", acao: "apps.configurar_marketplace", padrao: /^\/marketplace\/configurar$/, async handler(ctx) {
      const body = await ctx.corpo() as { chave?: unknown } | null;
      const chave = await conferirChaveComposio(body?.chave, op.fetchImpl);
      await op.dentro(ctx.escopo, async (d) => { await d.repos.composio.salvarChave(op.cifrar(chave)); });
      ctx.json(200, { configurado: true });
    } },
    /**
     * ADR-196: `slug` é a chave do conector. "gmail" conecta (ou refaz) a primeira conta; "gmail--pessoal" a conta a mais,
     * com o nome que a pessoa deu (`rotulo` no corpo, "Pessoal" → "Gmail (Pessoal)"). A conta a mais só nasce com a
     * primeira conectada, fora do GitHub e até LIMITE_CONTAS_POR_APP contando a primeira.
     */
    { metodo: "POST", acao: "apps.conectar", padrao: /^\/marketplace\/(?<slug>[a-z0-9-]+)\/conectar$/, async handler(ctx) {
      const partes = separarChave(ctx.params.slug ?? "");
      if (!partes) throw new ErroDeDominio("nao_encontrado");
      const app = acharApp(partes.app);
      const conta = partes.conta;
      if (conta && app.slug === SLUG_GITHUB) throw new ErroDeDominio("entrada_invalida");
      let rotulo: string | null = null;
      if (conta) {
        // O slug da conta entra em niveis_ferramenta.conector_slug, que aceita até 64 (0173).
        if (chaveDaConta(app.slug, conta).length > 64) throw new ErroDeDominio("entrada_invalida");
        const body = await ctx.corpo() as { rotulo?: unknown } | null;
        const bruto = typeof body?.rotulo === "string" ? body.rotulo.trim() : conta;
        if (!rotuloValido(bruto) || normalizarConta(bruto) !== conta) throw new ErroDeDominio("entrada_invalida");
        rotulo = bruto;
        const sessoes = await op.dentro(ctx.escopo, (d) => d.repos.composio.sessoesDoApp(app.slug));
        if (!sessoes.some((s) => !s.conta)) throw new ErroDeDominio("estado_invalido", { cause: "a primeira conta do app ainda não foi conectada" });
        const outras = sessoes.filter((s) => s.conta !== conta).length;
        if (outras + 1 > LIMITE_CONTAS_POR_APP) throw new ErroDeDominio("estado_invalido", { cause: "limite de contas do app" });
      }
      if (!conta && app.slug === SLUG_GITHUB) {
        // ADR-048: o que já está pronto ganha. gh logado nesta máquina (ou o App da organização no
        // servidor) = conectado agora, sem login nem campo.
        const r = await op.dentro(ctx.escopo, async (d) => {
          const g = await garantirGithubSemConfiguracao(d, { pelaPessoa: true });
          if (g.ok) await executar(d, aoConectarApp, { slug: SLUG_GITHUB });
          return g;
        });
        if (r.ok) { ctx.json(200, { conectado: true, conectorId: r.conector.id }); return; }
        if (r.motivo === "manual") { ctx.json(200, { conectado: false, frase: "Você já tem um conector com o slug github registrado à mão. O nod não o troca: remova ou renomeie esse conector para usar o GitHub do nod." }); return; }
        // Sem gh: o token já colado serve sem nova tela; a sonda escolhe o jeito (token antes do Composio na máquina).
        const comToken = await op.dentro(ctx.escopo, async (d) => {
          const c = await d.repos.conectores.buscarPorSlug(SLUG_GITHUB);
          return c && c.ownerId === ctx.escopo.pessoaId && c.comando === COMANDO_GITHUB_NATIVO && c.env[ENV_TOKEN_GITHUB] ? c.id : null;
        });
        if (comToken) {
          const s = await op.dentro(ctx.escopo, async (d) => {
            const r2 = await executar(d, sondarConector, { conectorId: comToken });
            if (r2.ok) await executar(d, aoConectarApp, { slug: SLUG_GITHUB });
            return r2;
          });
          if (s.ok) { ctx.json(200, { conectado: true, conectorId: comToken, jeito: "token" }); return; }
        }
      }
      const cifrada = await op.dentro(ctx.escopo, (d) => d.repos.composio.chave());
      if (!cifrada && app.slug === SLUG_GITHUB) { ctx.json(200, { conectado: false, frase: fraseSemJeito(false) }); return; }
      if (!cifrada) throw new ErroDeDominio("integracao_nao_configurada");
      const chave = op.decifrar(cifrada);
      // definido em 2026-09-29 (ADR-057): app do catálogo público não tem curadoria; o conector nasce com
      // o nome que a grade mostrou, não com o slug. O catálogo acabou de ser lido pela tela: sai do cache.
      const nomeDoApp = APPS_MARKETPLACE.some((a) => a.slug === app.slug) ? app.nome : (await catalogo(ctx.escopo.tenantId, cifrada)).find((a) => a.slug === app.slug)?.nome ?? app.nome;
      const nome = rotulo ? nomeDaConta(nomeDoApp, rotulo) : nomeDoApp;
      const c = cliente(chave);
      const userId = `nod:${ctx.escopo.tenantId}:${ctx.escopo.pessoaId}`;
      await apagarContaPelaMetade(ctx.escopo, c, chaveDaConta(app.slug, conta), app.slug);
      const sessao = await c.criarSessao(userId, app.slug);
      const link = await c.autorizar(sessao.id, app.slug);
      const conectorId = await guardarConector(ctx.escopo, { slug: app.slug, nome, chave, sessao, contaId: link.contaId, conta });
      ctx.json(200, { url: link.url, conectorId });
    } },
    /**
     * Emenda ADR-057 (2026-11-18): o que um app de chave pede (a chave, o subdomínio…), para a tela montar o
     * formulário. Leitura; sem chave do Composio no tenant, integracao_nao_configurada.
     */
    { metodo: "GET", padrao: /^\/marketplace\/(?<slug>[a-z0-9-]+)\/campos$/, async handler(ctx) {
      const app = acharApp(ctx.params.slug ?? "");
      const cifrada = await op.dentro(ctx.escopo, (d) => d.repos.composio.chave());
      if (!cifrada) throw new ErroDeDominio("integracao_nao_configurada");
      ctx.json(200, { campos: (await esquemaDe(app.slug, cifrada)).campos });
    } },
    /**
     * Emenda ADR-057 (2026-11-18): conectar com a chave que a pessoa colou, numa chamada só, sem login. A auth
     * config do app nasce aqui na primeira vez (sem nada a configurar); a conta nasce com os valores; a sessão usa
     * essa config e fica presa à conta; depois a mesma sonda do `verificar`. Os valores passam e não ficam: nada
     * deles vai ao banco nem ao log (o conector guarda só a chave do Composio, como no login).
     */
    { metodo: "POST", acao: "apps.conectar_com_chave", padrao: /^\/marketplace\/(?<slug>[a-z0-9-]+)\/conectar-com-chave$/, async handler(ctx) {
      const app = acharApp(ctx.params.slug ?? "");
      if (app.slug === SLUG_GITHUB) throw new ErroDeDominio("entrada_invalida");
      const body = await ctx.corpo() as { campos?: unknown } | null;
      const cifrada = await op.dentro(ctx.escopo, (d) => d.repos.composio.chave());
      if (!cifrada) throw new ErroDeDominio("integracao_nao_configurada");
      const esquema = await esquemaDe(app.slug, cifrada);
      const valores = validarValores(esquema.campos, body?.campos);
      const inicio = agora();
      const chave = op.decifrar(cifrada);
      const c = criarClienteComposio(chave, op.fetchImpl, { agora, prazoFinal: inicio + CONECTAR_COM_CHAVE_TETO_MS });
      const userId = `nod:${ctx.escopo.tenantId}:${ctx.escopo.pessoaId}`;
      const authConfigId = await c.garantirConfigDeChave(app.slug);
      const contaId = await c.conectarComChave(authConfigId, userId, valores);
      if (!(await c.conectado(contaId, userId, app.slug))) throw new ErroDeDominio("integracao_autenticacao");
      // Teste real de 18/11/2026: o Composio aceitou chave inválida do Fireflies (conta ACTIVE, sessão com 26
      // ferramentas). Sem conferir aqui, a tela diria "Conectado" e a falha só viria no primeiro uso do bot.
      const conferida = await c.conferirChave(contaId, esquema.conferencia, valores);
      log(conferida === "recusada" ? "aviso" : "info", "marketplace_conferir_chave", { toolkit: app.slug, resultado: conferida });
      if (conferida === "recusada") {
        const removida = await c.removerConta(contaId);
        if (!removida) log("aviso", "marketplace_conta_recusada_ficou", { toolkit: app.slug });
        throw new ErroDeDominio("integracao_autenticacao");
      }
      const nome = APPS_MARKETPLACE.some((a) => a.slug === app.slug) ? app.nome : (await catalogo(ctx.escopo.tenantId, cifrada)).find((a) => a.slug === app.slug)?.nome ?? app.nome;
      const sessao = await c.criarSessao(userId, app.slug, authConfigId);
      const conectorId = await guardarConector(ctx.escopo, { slug: app.slug, nome, chave, sessao, contaId });
      const fixada = await c.fixarConta(sessao.id, app.slug, contaId);
      log("info", "marketplace_conectar_com_chave", { toolkit: app.slug, ferramentas_sessao: fixada.ferramentas, avisos: fixada.avisos.join(",") || null });
      // A sonda ganha o próprio teto, contado de agora: config, conta e sessão já gastaram parte do orçamento da chamada.
      const r = await sondarAteOTeto(ctx.escopo, conectorId, app.slug, agora());
      const causa = r.ok ? null : fixada.ferramentas === 0 ? "composio" : "app";
      if (!r.ok) log("aviso", "marketplace_verificar_falhou", { toolkit: app.slug, causa, motivo: r.conector.ultimaFalha?.motivo ?? null, ferramentas_sessao: fixada.ferramentas, decorrido_ms: agora() - inicio });
      ctx.json(200, { conectado: r.ok, conectorId, ...(r.ok ? {} : { falhou: true, causa }), conector: r.conector });
    } },
    { metodo: "POST", acao: "apps.verificar", padrao: /^\/marketplace\/(?<slug>[a-z0-9-]+)\/verificar$/, async handler(ctx) {
      // ADR-196: `slug` é a chave do conector ("gmail--pessoal" verifica a conta a mais).
      const partes = separarChave(ctx.params.slug ?? "");
      if (!partes) throw new ErroDeDominio("nao_encontrado");
      const app = acharApp(partes.app);
      const chaveDoConector = chaveDaConta(app.slug, partes.conta);
      const { cifrada, sessao } = await op.dentro(ctx.escopo, async (d) => ({ cifrada: await d.repos.composio.chave(), sessao: await d.repos.composio.sessao(chaveDoConector) }));
      if (!cifrada || !sessao) throw new ErroDeDominio("estado_invalido");
      // Revisão do PR #264: o teto de 20 s conta desde aqui; a consulta da conta e o fixarConta saem dele também.
      const inicio = agora();
      const c = criarClienteComposio(op.decifrar(cifrada), op.fetchImpl, { agora, prazoFinal: inicio + VERIFICAR_TETO_MS });
      const conta = await c.lerConta(sessao.contaId, `nod:${ctx.escopo.tenantId}:${ctx.escopo.pessoaId}`, app.slug);
      if (!conta.ativo) { ctx.json(200, { conectado: false }); return; }
      if (conta.email !== (sessao.email ?? null)) await op.dentro(ctx.escopo, (d) => d.repos.composio.salvarEmail(sessao.conectorId, conta.email));
      const fixada = await c.fixarConta(sessao.sessaoId, app.slug, sessao.contaId);
      // NOD-212: o que o próprio Composio diz que a sessão expõe depois de fixar a conta; separa no log a falha dele da nossa.
      log("info", "marketplace_fixar_conta", { toolkit: app.slug, ferramentas_sessao: fixada.ferramentas, avisos: fixada.avisos.join(",") || null });
      const r = await sondarAteOTeto(ctx.escopo, sessao.conectorId, chaveDoConector, inicio);
      // NOD-212: falha final com a sessão sem nenhuma ferramenta concreta segundo o próprio Composio é dele, não do app nem
      // do nod: a web diz isso e o "Tentar de novo" vai direto a um login novo (sessão nova), sem re-sondar esta.
      const causa = r.ok ? null : fixada.ferramentas === 0 ? "composio" : "app";
      if (!r.ok) log("aviso", "marketplace_verificar_falhou", { toolkit: app.slug, causa, motivo: r.conector.ultimaFalha?.motivo ?? null, ferramentas_sessao: fixada.ferramentas, decorrido_ms: agora() - inicio });
      // definido em 2026-09-25 (revisão do PR #68): conta ativa e sonda falhou = `falhou`, para a web parar de
      // perguntar — sem isso ela repetia fixarConta + sonda a cada 2,5 s por 10 min, com o spinner na tela.
      ctx.json(200, { conectado: r.ok, ...(r.ok ? {} : { falhou: true, causa }), conector: r.conector });
    } },
    /**
     * ADR-196: tira uma conta a mais ("Remover esta conta"). A primeira sai pelo Desconectar de sempre, que guarda as
     * escolhas. Na transação, os acessos dos bots saem e o conector fica marcado (conectores.remover); depois do commit, a
     * conta é apagada no Composio. Falha lá só vai ao log: a conta já não alcança nada pelo nod.
     */
    { metodo: "DELETE", acao: "apps.remover_conta", padrao: /^\/marketplace\/contas\/(?<id>[^/]+)$/, async handler(ctx) {
      const id = ctx.params.id ?? "";
      const r = await op.dentro(ctx.escopo, async (d) => {
        const conector = await d.repos.conectores.buscar(id);
        if (!conector || conector.ownerId !== ctx.escopo.pessoaId || conector.removidoEm) throw new ErroDeDominio("nao_encontrado");
        const partes = separarChave(conector.slug);
        if (!partes?.conta) throw new ErroDeDominio("entrada_invalida", { cause: "a primeira conta sai pelo Desconectar" });
        // Só conta do Composio: um MCP registrado à mão com `--` no slug não sai por aqui (revisão do PR).
        if ((await d.repos.composio.sessao(conector.slug))?.conectorId !== conector.id) throw new ErroDeDominio("entrada_invalida", { cause: "não é uma conta do Marketplace" });
        const removido = await d.repos.conectores.remover(id, agora());
        if (!removido) throw new ErroDeDominio("nao_encontrado");
        return { ...removido, cifrada: await d.repos.composio.chave(), toolkit: partes.app };
      });
      if (r.contaComposio && r.cifrada) {
        const removida = await cliente(op.decifrar(r.cifrada)).removerConta(r.contaComposio);
        log(removida ? "info" : "aviso", "marketplace_conta_removida", { toolkit: r.toolkit, removida_no_composio: removida });
      }
      ctx.json(200, { ok: true, ids: { conector: id } });
    } },
  ];
}
