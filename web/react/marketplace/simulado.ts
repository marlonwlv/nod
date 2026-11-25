import type { NivelPedido, NivelVisto } from "../../lib/acessos-otimistas.ts";
import { notasGenericas } from "./modelo.ts";
import { aceitaContas, separarChave } from "./contas.ts";
import type { AcessosDoConector, ApiDoMarketplace, AppDaVitrine, BotDaVitrine, CampoNaTela, ContaDaVitrine, FormularioDaChave, FotoDoMarketplace, ResultadoDaChave } from "./tipos.ts";

/**
 * O Marketplace de mentira (web/marketplace-simulador.html): a mesma interface do adaptador real, com os apps, os bots
 * e as respostas do protótipo do Paper, para ver cada estado sem chave nem login de verdade. Nada daqui vai ao app.
 *
 * O que ele simula, com a latência de uma rede de verdade (1,5 s por padrão):
 * - chave "recusar" ou qualquer valor com "errad" → o app recusou (403 integracao_autenticacao);
 * - "indisponivel" → o app não respondeu; qualquer outra coisa → conectado;
 * - o login: espera, ganha o "Abrir o login" e conecta sozinho; Cancelar desiste;
 * - o nível por bot, o lote e o padrão ficam guardados na memória da página.
 */

type AppSimulado = Omit<AppDaVitrine, "situacao" | "conectorId" | "falha" | "login" | "niveis" | "logo"> & { estado?: "conectado" | "desligado" | "atencao"; formulario?: FormularioDaChave; notas?: { ler: string; escrita: string; verbos: string } };

const app = (slug: string, nome: string, categoria: string, cor: string, descricao: string, extra: Partial<AppSimulado> = {}): AppSimulado => ({ slug, nome, categoria, cor, descricao, chave: false, ...extra });

const CHAVE_SIMPLES = (nome: string): FormularioDaChave => ({ campos: [{ nome: "api_key", rotulo: "API Key", descricao: `Your ${nome} API key, found in the account settings.`, segredo: true, obrigatorio: true }] });

/** Os apps do protótipo, na ordem em que aparecem nos artboards (a ordem decide Recomendados e a busca). */
export const APPS_SIMULADOS: readonly AppSimulado[] = [
  app("github", "GitHub", "Desenvolvimento", "#1C1C1C", "Revise pull requests, leia código e acompanhe issues.", { resumo: "Código e pull requests", estado: "desligado" }),
  app("googledrive", "Google Drive", "Conhecimento", "#1FA463", "Encontre arquivos, leia documentos e organize as pastas do time.", { resumo: "Arquivos do time", estado: "conectado" }),
  app("slack", "Slack", "Comunicação", "#4A154B", "Encontre conversas, acompanhe sua equipe e prepare mensagens.", { resumo: "Conversas do time", estado: "conectado" }),
  app("fathom", "Fathom", "Reuniões", "#00BEAE", "Grava, resume e organiza as suas reuniões.", { resumo: "Resume reuniões", recomendado: true }),
  app("fireflies", "Fireflies", "Reuniões", "#7B3FE4", "Transcreve, resume e busca as suas reuniões.", {
    chave: true, resumo: "Reuniões", estado: "atencao", site: "https://app.fireflies.ai",
    formulario: {
      campos: [{ nome: "api_key", rotulo: "API Key", descricao: "Your Fireflies API key from Settings > Developer settings.", segredo: true, obrigatorio: true }], // idioma-fixo: a frase do provedor, que chega em inglês
      passos: [["Entre no Fireflies e abra ", { destaque: "Settings › Developer settings" }], ["Em ", { destaque: "API key" }, ", clique em copiar"], ["Volte aqui e cole no campo abaixo"]], // idioma-fixo: o nome do menu no app do Fireflies
    },
    notas: { ler: "busca reuniões, resumos e transcrições.", escrita: "também põe o robô do Fireflies numa reunião e envia áudio. Apagar fica de fora.", verbos: "pôr o robô numa reunião e enviar áudio" },
  }),
  app("pipedrive", "Pipedrive", "Vendas", "#017737", "Acompanhe negócios, contatos e o funil de vendas.", { chave: true, resumo: "Vendas", recomendado: true }),
  app("microsoft-teams", "Microsoft Teams", "Comunicação", "#5059C9", "Equipes, canais, mensagens e reuniões da sua organização.", { resumo: "Equipes e mensagens", recomendado: true }),
  app("freshdesk", "Freshdesk", "Suporte", "#25C16F", "Chamados e atendimento ao cliente.", {
    chave: true, resumo: "Suporte", recomendado: true, site: "https://www.freshdesk.com",
    formulario: {
      campos: [
        { nome: "subdominio", rotulo: "Endereço da conta", descricao: "Your Freshdesk subdomain (e.g. acme for acme.freshdesk.com).", segredo: false, obrigatorio: true, dica: "É o começo do endereço que você abre no navegador.", naFrase: "endereço da sua conta", prefixo: "https://", sufixo: ".freshdesk.com", exemplo: "suaempresa" },
        { nome: "api_key", rotulo: "API Key", descricao: "Your Freshdesk API key, under Profile settings.", segredo: true, obrigatorio: true },
      ],
      passos: [["Entre no Freshdesk, clique na sua foto e abra ", { destaque: "Configurações do perfil" }], ["Em ", { destaque: "Sua chave de API" }, ", clique em ver e copie"], ["Volte aqui e cole no campo abaixo"]],
    },
  }),
  app("asana", "Asana", "Projetos", "#F06A6A", "Projetos, tarefas e prazos do time.", { resumo: "Tarefas do time", recomendado: true }),
  app("firecrawl", "Firecrawl", "Desenvolvimento", "#F2542D", "Transforma páginas da web em texto que os bots conseguem ler.", { chave: true, resumo: "Lê sites", recomendado: true }),
  app("notion", "Notion", "Produtividade", "#1C1C1C", "Encontre documentos e mantenha as informações do time organizadas.", { resumo: "Documentos do time" }),
  app("clockify", "Clockify", "Produtividade", "#03A9F4", "Registre e consulte as horas do time por projeto.", { chave: true, resumo: "Horas" }),
  app("clickup", "ClickUp", "Produtividade", "#7B68EE", "Acompanhe tarefas, prazos e prioridades dos seus projetos.", { resumo: "Tarefas e prazos" }),
  app("googlecalendar", "Google Calendar", "Produtividade", "#4285F4", "Consulte sua agenda e organize compromissos.", { resumo: "Agenda e compromissos", sigla: "31" }),
  app("todoist", "Todoist", "Produtividade", "#E44332", "Listas de tarefas pessoais e do time.", { chave: true, resumo: "Listas de tarefas" }),
  app("granola", "Granola", "Reuniões", "#5B8C3A", "Notas e transcrições das suas chamadas.", { resumo: "Notas de chamadas" }),
  app("otter", "Otter.ai", "Reuniões", "#1F6FEB", "Transcrições de chamadas e entrevistas.", { resumo: "Transcrições" }),
  app("read-ai", "Read AI", "Reuniões", "#6B4EFF", "Relatórios e resumos das suas chamadas de vídeo.", { resumo: "Resumos de chamadas" }),
  app("tldv", "tl;dv", "Reuniões", "#0A0A0A", "Grava chamadas do Meet e do Zoom e marca os momentos.", { chave: true, resumo: "Momentos das chamadas" }),
  app("zoom", "Zoom", "Reuniões", "#2D8CFF", "Chamadas de vídeo, gravações e agenda de salas.", { resumo: "Chamadas de vídeo" }),
  app("gmail", "Gmail", "Comunicação", "#EA4335", "Leia e organize emails, prepare respostas e acompanhe sua caixa de entrada.", { resumo: "E-mails" }),
  app("outlook", "Microsoft Outlook", "Comunicação", "#0078D4", "Leia emails e consulte calendários da organização.", { resumo: "E-mails e calendário" }),
  app("discord", "Discord", "Comunicação", "#5865F2", "Canais e mensagens da comunidade.", { chave: true, resumo: "Canais e mensagens" }),
  app("whatsapp", "WhatsApp Business", "Comunicação", "#25D366", "Mensagens com clientes pelo número da empresa.", { chave: true, resumo: "Mensagens com clientes" }),
  app("hubspot", "HubSpot", "Vendas", "#FF7A59", "Contatos, empresas e negócios do CRM.", { resumo: "CRM" }),
  app("salesforce", "Salesforce", "Vendas", "#00A1E0", "Oportunidades, contas e relatórios de vendas.", { resumo: "Oportunidades" }),
  app("rdstation", "RD Station", "Vendas", "#1A3D6D", "Leads, funil e automação de marketing.", { chave: true, resumo: "Leads e funil" }),
  app("close", "Close", "Vendas", "#2B2B2B", "Ligações, e-mails e funil de vendas num lugar.", { chave: true, resumo: "Funil de vendas" }), // idioma-fixo: nome da marca
  app("zohocrm", "Zoho CRM", "Vendas", "#E42527", "Contatos, negócios e previsões de venda.", { chave: true, resumo: "CRM" }),
  app("linear", "Linear", "Projetos", "#5E6AD2", "Acompanhe projetos, organize issues e descubra o que está bloqueado.", { resumo: "Issues e ciclos" }),
  app("jira", "Jira", "Projetos", "#0052CC", "Issues, sprints e quadros do time de produto.", { resumo: "Issues e sprints" }),
  app("trello", "Trello", "Projetos", "#0079BF", "Quadros e cartões do time.", { chave: true, resumo: "Quadros e cartões" }),
  app("zendesk", "Zendesk", "Suporte", "#03363D", "Tickets, macros e a central de ajuda.", { chave: true, resumo: "Tickets" }),
  app("intercom", "Intercom", "Suporte", "#1F8DED", "Conversas com clientes e a central de ajuda.", { resumo: "Conversas com clientes" }),
  app("sentry", "Sentry", "Desenvolvimento", "#362D59", "Investigue erros em produção, veja o impacto e priorize correções.", { resumo: "Erros em produção" }),
  app("supabase", "Supabase", "Desenvolvimento", "#3ECF8E", "Consulte tabelas e acompanhe o estado do banco.", { chave: true, resumo: "Banco de dados" }),
  app("confluence", "Confluence", "Conhecimento", "#1868DB", "Páginas e espaços de documentação do time.", { resumo: "Documentação" }),
  app("dropbox", "Dropbox", "Conhecimento", "#0061FF", "Arquivos e pastas compartilhadas.", { resumo: "Arquivos" }),
  app("stripe", "Stripe", "Finanças", "#635BFF", "Pagamentos, assinaturas e faturas.", { chave: true, resumo: "Pagamentos" }),
  app("quickbooks", "QuickBooks", "Finanças", "#2CA01C", "Contas, notas e o fluxo de caixa.", { resumo: "Contabilidade" }),
  app("contaazul", "Conta Azul", "Finanças", "#0079FF", "Financeiro e notas fiscais da empresa.", { chave: true, resumo: "Financeiro" }),
  app("mailchimp", "Mailchimp", "Marketing", "#FFE01B", "Listas, campanhas e relatórios de e-mail.", { chave: true, resumo: "Campanhas de e-mail" }),
  app("googleanalytics", "Google Analytics", "Marketing", "#E37400", "Visitas, conversões e origem do tráfego.", { resumo: "Tráfego do site" }),
  app("metaads", "Meta Ads", "Marketing", "#0866FF", "Campanhas e resultados de anúncios.", { resumo: "Anúncios" }),
  app("airtable", "Airtable", "Integrações", "#18BFFF", "Bases e tabelas do time.", { chave: true, resumo: "Bases e tabelas" }),
  app("typeform", "Typeform", "Integrações", "#262627", "Formulários e respostas.", { chave: true, resumo: "Formulários" }),
];

/** "Buscar entre 1.445 apps" (Capa do Paper: 132 de login gerenciado + 1.313 de chave, catálogo de 18/11/2026). */
export const TOTAL_SIMULADO = 1445;

export const BOTS_SIMULADOS: readonly BotDaVitrine[] = [
  { id: "clarice", nome: "Clarice", titulo: "Assistente pessoal", forma: "shape-circle", cor: "c-blue" },
  { id: "ada", nome: "Ada", titulo: "PM", forma: "shape-circle", cor: "c-purple" },
  { id: "frida", nome: "Frida", titulo: "Acompanhamento do time", forma: "shape-circle", cor: "c-amber" },
  { id: "cecilia", nome: "Cecília", titulo: "Fiscal", forma: "shape-circle", cor: "c-green" },
  { id: "dante", nome: "Dante", titulo: "Dev Sr", forma: "shape-circle", cor: "c-orange" },
];

export type OpcoesDoSimulado = {
  /** Milissegundos de "rede" de cada chamada (1500 por padrão; os testes usam 0). */
  latenciaMs?: number;
  /** O Fireflies já conectado (T6 e T6b); sem isto ele está em "Precisa de atenção" (D1). */
  firefliesConectado?: boolean;
  aoAbrirAvancado?: () => void;
  /**
   * ADR-196 (Paper "Apps com mais de uma conta"): o Gmail já conectado, com estas contas a mais ("pessoal", "acme"…).
   * Lista vazia = só a primeira conta.
   */
  contasDoGmail?: readonly string[];
  /** Paper M4: mais bots além dos cinco do protótipo, para ver o "Quem pode usar" de um time grande. */
  botsAMais?: number;
};

const NOMES_A_MAIS = ["Gil", "Chico", "Teodora", "Elis", "Leonardo", "Cartola", "Tarsila", "Doze", "Bruna", "Caio", "Davi", "Eva", "Fábio", "Gabi", "Hugo", "Iara", "João", "Kai", "Lia", "Malu", "Nina", "Otto", "Paula", "Rui", "Sara", "Téo", "Vera"];
const CORES_A_MAIS = ["c-pink", "c-teal", "c-red", "c-blue", "c-purple", "c-amber", "c-green", "c-orange"] as const;
/** Os bots do protótipo e, se pedido, mais alguns (Paper M4: 32 bots). */
export function botsSimulados(aMais = 0): BotDaVitrine[] {
  const extra = Array.from({ length: Math.max(0, aMais) }, (_, i): BotDaVitrine => ({ id: `bot-${i}`, nome: NOMES_A_MAIS[i % NOMES_A_MAIS.length]! + (i >= NOMES_A_MAIS.length ? ` ${Math.floor(i / NOMES_A_MAIS.length) + 1}` : ""), titulo: "Bot do time", forma: "shape-circle", cor: CORES_A_MAIS[i % CORES_A_MAIS.length]! }));
  return [...BOTS_SIMULADOS, ...extra];
}
const EMAILS_DO_GMAIL: Record<string, string> = { principal: "voce@empresa.example", pessoal: "maria@pessoal.example", familia: "familia@pessoal.example", acme: "voce@acme.example", vendas: "vendas@empresa.example" };

type Conexao = { conectorId: string; niveis: Record<string, NivelVisto>; acessos: { padrao: NivelPedido; seguePadrao: Set<string> } };

const FALHA_DA_CHAVE = (nome: string) => `A chave parou de funcionar · foi apagada ou trocada no ${nome}`;

export function criarApiSimulada(o: OpcoesDoSimulado = {}): ApiDoMarketplace & { valoresRecebidos: () => number } {
  const latencia = o.latenciaMs ?? 1500;
  const bots = botsSimulados(o.botsAMais ?? 0);
  /** ADR-196: as contas a mais por app (a primeira é a conexão de sempre). */
  const contasAMais = new Map<string, { chave: string; nome: string; email: string | null; conexao: Conexao }[]>();
  const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const ouvintes = new Set<() => void>();
  const conexoes = new Map<string, Conexao>();
  const desligados = new Set<string>();
  const atencao = new Set<string>();
  const logins = new Map<string, { url: string | null; timers: ReturnType<typeof setTimeout>[] }>();
  let envios = 0;
  let contadorDeLotes = 0;
  const lotesSimulados = new Map<string, { conectorId: string; antes: Record<string, { nivel: NivelVisto | undefined; seguia: boolean }> }>();
  const slugDoConector = (conectorId: string): string | undefined => [...conexoes.entries()].find(([, c]) => c.conectorId === conectorId)?.[0];
  const nomeDoConector = (conectorId: string): string => APPS_SIMULADOS.find((a) => a.slug === slugDoConector(conectorId))?.nome ?? "app";
  const todosNenhum = (): Record<string, NivelVisto> => Object.fromEntries(bots.map((b) => [b.id, "nenhum"]));
  const novaConexao = (slug: string, niveis: Record<string, NivelVisto> = todosNenhum()): Conexao => ({ conectorId: `sim-${slug}`, niveis, acessos: { padrao: "nenhum", seguePadrao: new Set(bots.filter((b) => niveis[b.id] === "nenhum").map((b) => b.id)) } });

  for (const a of APPS_SIMULADOS) {
    if (a.estado === "conectado") conexoes.set(a.slug, novaConexao(a.slug, { ...todosNenhum(), clarice: "leitura", ada: "escrita" }));
    if (a.estado === "desligado") { conexoes.set(a.slug, novaConexao(a.slug)); desligados.add(a.slug); }
    if (a.estado === "atencao") { conexoes.set(a.slug, novaConexao(a.slug, { ...todosNenhum(), clarice: "leitura" })); atencao.add(a.slug); }
  }
  if (o.firefliesConectado) {
    atencao.delete("fireflies");
    // Paper T6: Clarice lê, Ada ainda não tem acesso, e Frida, Cecília e Dante seguem o padrão (Nenhum).
    const c = novaConexao("fireflies", { ...todosNenhum(), clarice: "leitura" });
    c.acessos.seguePadrao = new Set(["frida", "cecilia", "dante"]);
    conexoes.set("fireflies", c);
  }

  if (o.contasDoGmail) {
    // Paper M1/M5: a primeira conta com a Clarice e mais 2; a pessoal com a Clarice (Ler e alterar) e a Frida.
    conexoes.set("gmail", novaConexao("gmail", { ...todosNenhum(), clarice: "escrita", ada: "leitura", frida: "leitura" }));
    contasAMais.set("gmail", o.contasDoGmail.map((conta) => {
      const chave = `gmail--${conta}`;
      const c = novaConexao(chave, conta === "pessoal" ? { ...todosNenhum(), clarice: "escrita", frida: "leitura" } : conta === "acme" ? { ...todosNenhum(), ada: "leitura" } : todosNenhum());
      return { chave, nome: `Gmail (${conta === "familia" ? "família" : conta === "acme" ? "Acme" : conta})`, email: EMAILS_DO_GMAIL[conta] ?? null, conexao: c };
    }));
  }

  let foto: FotoDoMarketplace | null = null;
  const contaDe = (chave: string, nome: string, email: string | null, c: Conexao | undefined, principal: boolean): ContaDaVitrine => {
    const login = logins.get(chave);
    return {
      chave, conectorId: c?.conectorId ?? null, nome, principal, email,
      situacao: login ? "conectando" : c ? "conectado" : "nao_conectado", desligado: false, falha: null,
      login: login ? { url: login.url, falhou: null, semJanela: true } : null, niveis: c ? { ...c.niveis } : {},
    };
  };
  const montar = (): FotoDoMarketplace => {
    const acessos: Record<string, AcessosDoConector> = {};
    const apps = APPS_SIMULADOS.map((a): AppDaVitrine => {
      const { estado: _e, formulario: _f, notas: _n, ...resto } = a;
      const c = conexoes.get(a.slug);
      const login = logins.get(a.slug);
      if (c) acessos[c.conectorId] = { padrao: c.acessos.padrao, seguePadrao: new Set(c.acessos.seguePadrao) };
      const situacao = login ? "conectando" : atencao.has(a.slug) ? "atencao" : c && !desligados.has(a.slug) ? "conectado" : "nao_conectado";
      const multiconta = aceitaContas(a.slug, a.chave);
      let contas: ContaDaVitrine[] | undefined;
      if (multiconta && c && situacao === "conectado") {
        const extras = contasAMais.get(a.slug) ?? [];
        for (const x of extras) acessos[x.conexao.conectorId] = { padrao: x.conexao.acessos.padrao, seguePadrao: new Set(x.conexao.acessos.seguePadrao) };
        const novas = [...logins.keys()].filter((k) => separarChave(k)?.app === a.slug && !extras.some((x) => x.chave === k));
        contas = [
          contaDe(a.slug, a.nome, a.slug === "gmail" ? EMAILS_DO_GMAIL.principal! : null, c, true),
          ...extras.map((x) => contaDe(x.chave, x.nome, x.email, x.conexao, false)),
          ...novas.map((k) => contaDe(k, `${a.nome} (${separarChave(k)?.conta ?? ""})`, null, undefined, false)),
        ];
      }
      return { ...resto, logo: null, situacao, conectorId: c?.conectorId ?? null, desligado: desligados.has(a.slug), falha: atencao.has(a.slug) ? FALHA_DA_CHAVE(a.nome) : null, login: login ? { url: login.url, falhou: null, semJanela: true } : null, niveis: c ? { ...c.niveis } : {}, ...(multiconta ? { multiconta: true } : {}), ...(contas ? { contas } : {}) };
    });
    return { apps, total: TOTAL_SIMULADO, bots, acessos, composioConfigurado: true };
  };
  const mudou = () => { foto = null; for (const f of [...ouvintes]) f(); };
  const doApp = (slug: string) => APPS_SIMULADOS.find((a) => a.slug === slug);
  const conexaoPorId = (conectorId: string) => [...conexoes.values(), ...[...contasAMais.values()].flat().map((x) => x.conexao)].find((c) => c.conectorId === conectorId);
  const rotulos = new Map<string, string>();

  return {
    ler: () => (foto ??= montar()),
    assinar(f) { ouvintes.add(f); return () => { ouvintes.delete(f); }; },
    async campos(slug) {
      await esperar(Math.round(latencia / 6));
      const a = doApp(slug);
      return a?.formulario ?? CHAVE_SIMPLES(a?.nome ?? slug);
    },
    async conectarComChave(slug, valores): Promise<ResultadoDaChave> {
      envios++;
      // Só olha os valores para decidir a resposta; nada deles é guardado.
      const todos = Object.values(valores).map((v) => v.toLowerCase());
      await esperar(latencia);
      if (todos.some((v) => v === "recusar" || v.includes("errad"))) return { tipo: "recusada" };
      if (todos.some((v) => v === "indisponivel")) return { tipo: "indisponivel" };
      atencao.delete(slug);
      desligados.delete(slug);
      const c = conexoes.get(slug) ?? novaConexao(slug);
      conexoes.set(slug, c);
      mudou();
      return { tipo: "conectado", conectorId: c.conectorId };
    },
    conectarLogin(slug, rotulo) {
      if (logins.has(slug)) return;
      if (rotulo) rotulos.set(slug, rotulo);
      const timers = [
        setTimeout(() => { const l = logins.get(slug); if (l) { l.url = "https://login.exemplo.invalid/autorizar"; mudou(); } }, Math.round(latencia / 2)),
        setTimeout(() => {
          logins.delete(slug);
          const partes = separarChave(slug);
          if (partes?.conta) {
            // ADR-196: a conta a mais nasce com o nome que a pessoa deu e um e-mail de exemplo.
            const lista = contasAMais.get(partes.app) ?? [];
            if (!lista.some((x) => x.chave === slug)) lista.push({ chave: slug, nome: `${doApp(partes.app)?.nome ?? partes.app} (${rotulos.get(slug) ?? partes.conta})`, email: `${partes.conta}@exemplo.com`, conexao: novaConexao(slug) });
            contasAMais.set(partes.app, lista);
            mudou();
            return;
          }
          atencao.delete(slug);
          desligados.delete(slug);
          if (!conexoes.has(slug)) conexoes.set(slug, novaConexao(slug));
          mudou();
        }, latencia * 2),
      ];
      logins.set(slug, { url: null, timers });
      mudou();
    },
    cancelarLogin(slug) {
      const l = logins.get(slug);
      if (!l) return;
      for (const t of l.timers) clearTimeout(t);
      logins.delete(slug);
      mudou();
    },
    abrirAcessos: () => undefined,
    definirNivel(agenteId, conectorId, nivel) {
      const c = conexaoPorId(conectorId);
      if (!c) return;
      c.niveis[agenteId] = nivel;
      c.acessos.seguePadrao.delete(agenteId);
      mudou();
    },
    async aplicarLote(conectorId, nivel, alvo) {
      await esperar(Math.round(latencia / 3));
      const c = conexaoPorId(conectorId);
      if (!c) return null;
      const alvos: string[] = [];
      const antes: Record<string, { nivel: NivelVisto | undefined; seguia: boolean }> = {};
      for (const id of alvo === "todos" ? bots.map((b) => b.id) : alvo) {
        // "Todos" com Ler não rebaixa quem tem Ler e alterar (a regra do servidor, alvosDoLote).
        if (alvo === "todos" && nivel === "leitura" && c.niveis[id] === "escrita") continue;
        antes[id] = { nivel: c.niveis[id], seguia: c.acessos.seguePadrao.has(id) };
        c.niveis[id] = nivel;
        c.acessos.seguePadrao.delete(id);
        alvos.push(id);
      }
      mudou();
      const loteId = `lote_sim_${++contadorDeLotes}`;
      lotesSimulados.set(loteId, { conectorId, antes });
      const nomes = alvos.map((id) => bots.find((b) => b.id === id)?.nome ?? id);
      const quem = nomes.length <= 2 ? nomes.join(" e ") : `${nomes.length} bots`;
      const verbo = nivel === "escrita" ? "agora leem e alteram" : nivel === "leitura" ? "agora leem" : "ficaram sem acesso";
      return { frase: `${quem} ${nomes.length === 1 ? verbo.replace("leem e alteram", "lê e altera").replace("leem", "lê").replace("ficaram", "ficou") : verbo} no ${nomeDoConector(conectorId)}.`, loteId, alvos };
    },
    async desfazerLote(_conectorId, recibo) {
      await esperar(Math.round(latencia / 3));
      const lote = recibo.loteId ? lotesSimulados.get(recibo.loteId) : undefined;
      const c = lote ? conexaoPorId(lote.conectorId) : undefined;
      if (!lote || !c) return null;
      for (const [id, a] of Object.entries(lote.antes)) {
        if (a.nivel === undefined) delete c.niveis[id]; else c.niveis[id] = a.nivel;
        if (a.seguia) c.acessos.seguePadrao.add(id);
      }
      lotesSimulados.delete(recibo.loteId!);
      mudou();
      return null;
    },
    async desconectar(conectorId) {
      await esperar(Math.round(latencia / 3));
      const slug = slugDoConector(conectorId);
      if (!slug) return;
      desligados.add(slug);
      mudou();
    },
    async renomearConta(conectorId, nome) {
      await esperar(Math.round(latencia / 3));
      for (const lista of contasAMais.values()) for (const x of lista) if (x.conexao.conectorId === conectorId) x.nome = nome;
      mudou();
    },
    async removerConta(conectorId) {
      await esperar(Math.round(latencia / 2));
      for (const [app, lista] of contasAMais) contasAMais.set(app, lista.filter((x) => x.conexao.conectorId !== conectorId));
      mudou();
    },
    async definirPadrao(conectorId, nivel) {
      await esperar(Math.round(latencia / 3));
      const c = conexaoPorId(conectorId);
      if (!c) return;
      c.acessos.padrao = nivel;
      for (const id of c.acessos.seguePadrao) c.niveis[id] = nivel;
      mudou();
    },
    notas(a) {
      const n = doApp(a.slug)?.notas;
      return n ? { ler: n.ler, escrita: n.escrita, verbosDaEscrita: n.verbos } : notasGenericas(a.nome);
    },
    abrirAvancado: () => o.aoAbrirAvancado?.(),
    valoresRecebidos: () => envios,
  };
}

/** Os campos de um app simulado (para os testes do formulário). */
export const camposSimulados = (slug: string): CampoNaTela[] => (APPS_SIMULADOS.find((a) => a.slug === slug)?.formulario ?? CHAVE_SIMPLES(slug)).campos;
