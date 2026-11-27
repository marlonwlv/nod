import type { AppDoCofre } from "../../src/contracts/apps-do-cofre.ts";
import type { ChaveDoCofreNaTela, CofreDto, DetalheDaChaveDto, ModoDeUsoDaChave, NovaChaveDoCofre } from "../../src/contracts/cofre.ts";
import type { LoginDoCofreNaTela } from "../../src/contracts/navegador-do-bot.ts";
import { type AbaDoCofre, itensVisiveis, siteDoFiltro, TELA_COFRE_INICIAL, type TelaCofre } from "../telas/config-cofre.ts";

/** Apagar um login some da lista na hora e só vai ao servidor quando o aviso com Desfazer acaba (D0: desfazer > confirmar). */
export const MS_DESFAZER_LOGIN = 5_500;

/** O "Novo item" da barra (Paper C1): com o menu fechado, é por ele que se chega ao "Login de site". */
const SELETOR_NOVO_ITEM = '[data-act="cofre-menu-novo"]';
const SELETOR_SITE_DO_DIALOGO = '.cofre-dialogo input[name="site"]';
/** O "…" da linha do login (o Apagar mora no menu dele). */
const seletorDoApagar = (id: string) => `[data-act="cofre-menu-item"][data-id="login:${id.replace(/["\\]/gu, "\\$&")}"]`;

/**
 * QA-206: para onde vai o foco quando a linha `id` some — o "…" da linha seguinte que está à vista, senão o da
 * anterior, senão o "Novo item" (a lista ficou vazia). Segue a mesma conta de visíveis do desenho (aba, busca, filtro
 * e apagando).
 */
export function destinoAoApagar(t: TelaCofre, id: string): string {
  const visiveis = itensVisiveis(t).logins;
  const i = visiveis.findIndex((l) => l.id === id);
  const vizinho = i < 0 ? undefined : visiveis[i + 1] ?? visiveis[i - 1];
  if (vizinho) return seletorDoApagar(vizinho.id);
  return t.adicionando ? SELETOR_SITE_DO_DIALOGO : SELETOR_NOVO_ITEM;
}

type ApiDoCofre = {
  cofre(): Promise<CofreDto>;
  cofreLogins?(): Promise<{ logins: LoginDoCofreNaTela[] }>;
  guardarNoCofre?(login: { site: string; usuario: string; senha: string }): Promise<{ ok: true; login: LoginDoCofreNaTela }>;
  apagarDoCofre?(id: string): Promise<{ ok: true }>;
  chaveDoCofre?(id: string): Promise<DetalheDaChaveDto>;
  criarChaveNoCofre?(nova: NovaChaveDoCofre): Promise<{ chave: ChaveDoCofreNaTela }>;
  trocarChaveDoCofre?(id: string, valor: string): Promise<{ chave: ChaveDoCofreNaTela }>;
  acessoDaChave?(id: string, agenteId: string, modo: ModoDeUsoDaChave | null): Promise<{ chave: ChaveDoCofreNaTela }>;
  removerChaveDoCofre?(id: string): Promise<{ ok: true }>;
};

/** O código do erro da API (ErroApi), sem importar o cliente: o controlador também roda nos testes de unidade. */
const codigoDoErro = (e: unknown): string | null => (typeof e === "object" && e !== null && typeof (e as { codigo?: unknown }).codigo === "string" ? (e as { codigo: string }).codigo : null);

/**
 * A frase do erro ao guardar ou trocar uma chave (Paper O3 e C3): pelo código, nunca a mensagem crua. `app` é o conhecido
 * ("Orgo"), quando há.
 */
export function fraseDoErroDaChave(codigo: string | null, app: { nome: string; artigo: "a" | "o" } | null, nome = ""): string {
  const oApp = app ? `${app.artigo === "a" ? "A" : "O"} ${app.nome}` : "O app";
  switch (codigo) {
    case "integracao_autenticacao": return `${oApp} recusou essa chave. Confira se copiou inteira e cole de novo.`;
    case "conector_indisponivel": return `${oApp} não respondeu agora. Tente de novo em instantes.`;
    case "estado_invalido": return nome ? `Já existe a chave ${nome} no cofre. Abra ela e use Trocar.` : "Essa chave mudou. Feche e abra de novo.";
    case "entrada_invalida": return "Confira o nome da variável (letras maiúsculas, números e _) e o valor.";
    case "nao_permitido": return "Só quem guardou a chave pode mudar.";
    default: return "Não deu para guardar. Tente de novo.";
  }
}

/**
 * O controlador de Configurações › Cofre (Paper 07, rodada 2): lê `GET cofre` e `GET cofre/logins` ao abrir a seção; o
 * estado é só dela. A senha de um login novo passa por `guardarLogin` direto ao POST e não fica em lugar nenhum daqui.
 */
export function criarTelaCofre(o: {
  api: () => ApiDoCofre | null;
  render: () => void;
  /** O aviso com Desfazer (web/lib/aviso-desfazer.ts no app). */
  avisar?: (texto: string, desfazer: (() => void) | null) => void;
  aoErro?: (e: unknown) => void;
  esperar?: (fn: () => void, ms: number) => unknown;
  cancelar?: (t: unknown) => void;
  /**
   * QA-206: o destino do foco para o próximo desenho (no app, `focoPendente.lembrar`). Apagar, Desfazer e Ver todos tiram
   * da tela o botão focado; sem isto o foco caía no <body> e o teclado voltava ao começo da página.
   */
  focar?: (seletor: string) => void;
}) {
  let t: TelaCofre = TELA_COFRE_INICIAL;
  let pedido = 0;
  const esperar = o.esperar ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  const cancelar = o.cancelar ?? ((x: unknown) => globalThis.clearTimeout(x as ReturnType<typeof setTimeout>));
  const mudar = (p: Partial<TelaCofre>) => { t = { ...t, ...p }; o.render(); };
  const render = () => o.render();
  const appDoCofre = (id: string | null | undefined): AppDoCofre | null => (t.apps ?? []).find((a) => a.id === id) ?? null;
  async function abrir(): Promise<void> {
    const api = o.api();
    if (!api) return;
    const meu = ++pedido;
    // Abrir de novo tira o filtro do "Logins deste site…" (quem filtra chama `filtrar` depois de abrir).
    mudar({ carregando: true, erro: false, erroLogins: false, filtro: null, adicionando: false, erroNovo: null, menu: null, novaChave: null, aberta: null });
    const logins = api.cofreLogins
      ? api.cofreLogins().then((r) => { if (meu === pedido) mudar({ logins: r.logins }); }, () => { if (meu === pedido) mudar({ erroLogins: true }); })
      : Promise.resolve();
    try {
      const r = await api.cofre();
      if (meu === pedido) mudar({ credenciais: r.credenciais, chaves: r.chaves ?? [], apps: r.apps ?? [], carregando: false });
    } catch {
      if (meu === pedido) mudar({ carregando: false, erro: true });
    }
    await logins;
  }
  /** Abre a chave (C2). `trocar` já abre o campo do valor novo (o "Trocar" do "…"). */
  async function abrirChave(id: string, trocar = false): Promise<void> {
    const api = o.api();
    if (!api?.chaveDoCofre) return;
    mudar({ aberta: { id, detalhe: null, erro: false, trocando: trocar, erroTroca: null, guardando: false, dando: false }, menu: null });
    try {
      const detalhe = await api.chaveDoCofre(id);
      if (t.aberta?.id === id) mudar({ aberta: { ...t.aberta, detalhe, erro: false } });
    } catch {
      if (t.aberta?.id === id) mudar({ aberta: { ...t.aberta, erro: true } });
    }
  }
  return {
    estado: (): TelaCofre => t,
    abrir,
    /** Tudo, Chaves ou Logins (Paper C1). Trocar a aba fecha o menu aberto. */
    aba(aba: AbaDoCofre): void { mudar({ aba, menu: null }); },
    /** A busca do Cofre: só filtra o que já veio (nome, app, site, usuário); nada vai ao servidor. */
    buscar(busca: string): void { mudar({ busca }); },
    /** Abre ("novo" ou `login:<id>`) ou fecha (null) o menu; o mesmo valor de novo fecha. */
    menu(qual: string | null): void { mudar({ menu: qual !== null && t.menu === qual ? null : qual }); },
    /** "Logins deste site…" (D1c): o Cofre abre filtrado pelo site da aba do navegador. "" tira o filtro. */
    filtrar(url: string): void { const filtro = siteDoFiltro(url) || null; mudar({ filtro, aba: filtro ? "logins" : "tudo" }); },
    /** "Ver todos" do filtro: o chip some com o botão focado; o foco vai para o "Novo item" (ou o campo do site). */
    verTodos(): void { o.focar?.(t.adicionando ? SELETOR_SITE_DO_DIALOGO : SELETOR_NOVO_ITEM); mudar({ filtro: null, aba: "tudo" }); },
    adicionando(sim: boolean): void { mudar({ adicionando: sim, erroNovo: null, menu: null }); },
    /**
     * Guarda o login novo. O valor da senha só passa por aqui até o POST; quem chama limpa o campo. true = guardou (o
     * formulário fecha e o login entra na lista).
     */
    async guardarLogin(novo: { site: string; usuario: string; senha: string }): Promise<boolean> {
      const api = o.api();
      if (!api?.guardarNoCofre || t.guardando) return false;
      if (!novo.site.trim() || !novo.senha) { mudar({ erroNovo: "Preencha o site e a senha." }); return false; }
      mudar({ guardando: true, erroNovo: null });
      try {
        const r = await api.guardarNoCofre(novo);
        mudar({ guardando: false, adicionando: false, logins: [r.login, ...(t.logins ?? []).filter((l) => l.id !== r.login.id)] });
        o.avisar?.(`Login de ${r.login.site} guardado no cofre do nod`, null);
        return true;
      } catch {
        mudar({ guardando: false, erroNovo: "Não deu para guardar. Confira o site e tente de novo." });
        return false;
      }
    },
    /** Apagar com Desfazer: some já; o DELETE sai quando o aviso acaba. Desfazer cancela e a linha volta. */
    apagarLogin(id: string): void {
      const api = o.api();
      const alvo = t.logins?.find((l) => l.id === id);
      if (!api?.apagarDoCofre || !alvo) return;
      o.focar?.(destinoAoApagar(t, id));
      mudar({ apagando: new Set([...(t.apagando ?? []), id]), menu: null });
      const voltar = () => { const a = new Set(t.apagando ?? []); a.delete(id); mudar({ apagando: a }); };
      const timer = esperar(() => {
        api.apagarDoCofre!(id).then(() => {
          const a = new Set(t.apagando ?? []);
          a.delete(id);
          mudar({ apagando: a, logins: (t.logins ?? []).filter((l) => l.id !== id) });
        }, (e: unknown) => { voltar(); o.aoErro?.(e); });
      }, MS_DESFAZER_LOGIN);
      o.avisar?.(`Login de ${alvo.site} apagado`, () => { cancelar(timer); o.focar?.(seletorDoApagar(id)); voltar(); });
    },

    // ------------------------------------------------------------------ chaves (ADR-195, Entrega 3; Paper C1–C3)

    /** Abre a "Nova chave" (C3) já com o primeiro app conhecido e a variável dele; fecha com false. */
    novaChave(sim: boolean): void {
      // O primeiro app do catálogo (a Orgo) já vem escolhido, com a variável dele (Paper C3).
      const primeiro = (t.apps ?? [])[0] ?? null;
      mudar({ novaChave: sim ? { appId: primeiro?.id ?? "", nome: primeiro?.variavel ?? "", agenteId: "", dicas: "", erro: null, guardando: false } : null, menu: null });
    },
    /**
     * Guarda a chave nova. O valor só passa por aqui até o POST (quem chama limpa o campo); o resto do formulário fica no
     * estado para o redesenho do erro não apagar o que a pessoa escreveu. true = guardou.
     */
    async guardarChave(campos: { appId: string; nome: string; valor: string; agenteId: string; dicas: string }): Promise<boolean> {
      const api = o.api();
      const n = t.novaChave;
      if (!api?.criarChaveNoCofre || !n || n.guardando) return false;
      const app = appDoCofre(campos.appId);
      const nome = campos.nome.trim();
      const base = { appId: app?.id ?? "", nome, agenteId: campos.agenteId, dicas: campos.dicas };
      if (!nome || !campos.valor.trim()) { mudar({ novaChave: { ...base, erro: "Preencha o nome da variável e o valor.", guardando: false } }); return false; }
      mudar({ novaChave: { ...base, erro: null, guardando: true } });
      try {
        const r = await api.criarChaveNoCofre({ appId: app?.id ?? null, nome, valor: campos.valor, quem: campos.agenteId ? [{ agenteId: campos.agenteId, modo: "sempre" }] : [], dicas: campos.dicas.trim() || null });
        mudar({ novaChave: null, chaves: [...(t.chaves ?? []).filter((c) => c.id !== r.chave.id), r.chave] });
        o.avisar?.(`${r.chave.app ?? r.chave.nome} guardada no cofre`, null);
        return true;
      } catch (e) {
        mudar({ novaChave: { ...base, erro: fraseDoErroDaChave(codigoDoErro(e), app, nome), guardando: false } });
        return false;
      }
    },
    abrirChave,
    fecharChave(): void { mudar({ aberta: null }); },
    /** Guarda o que não é segredo da "Nova chave" (o app trocado redesenha a ajuda e o nome). */
    appDoCofre,
    editarNovaChave(p: { appId: string; nome: string; agenteId: string; dicas: string }): void {
      if (t.novaChave) mudar({ novaChave: { ...t.novaChave, ...p, erro: null } });
    },
    trocando(sim: boolean): void { if (t.aberta) mudar({ aberta: { ...t.aberta, trocando: sim, erroTroca: null } }); },
    menuDar(): void { if (t.aberta) mudar({ aberta: { ...t.aberta, dando: !t.aberta.dando } }); },
    /** O valor novo da chave aberta; app conhecido testa antes (o servidor). true = trocou. */
    async trocarValor(valor: string): Promise<boolean> {
      const api = o.api();
      const a = t.aberta;
      if (!api?.trocarChaveDoCofre || !a?.detalhe || a.guardando) return false;
      const app = appDoCofre(a.detalhe.chave.appId);
      if (!valor.trim()) { mudar({ aberta: { ...a, erroTroca: "Cole o valor novo." } }); return false; }
      mudar({ aberta: { ...a, guardando: true, erroTroca: null } });
      try {
        const r = await api.trocarChaveDoCofre(a.id, valor);
        mudar({ chaves: (t.chaves ?? []).map((c) => (c.id === a.id ? r.chave : c)) });
        await abrirChave(r.chave.id);
        o.avisar?.(`${r.chave.app ?? r.chave.nome}: valor trocado`, null);
        return true;
      } catch (e) {
        if (t.aberta?.id === a.id) mudar({ aberta: { ...t.aberta, guardando: false, erroTroca: fraseDoErroDaChave(codigoDoErro(e), app) } });
        return false;
      }
    },
    /** Sempre, Perguntar antes ou tirar o acesso (null) de um bot à chave aberta. */
    async mudarAcesso(id: string, agenteId: string, modo: ModoDeUsoDaChave | null): Promise<void> {
      const api = o.api();
      if (!api?.acessoDaChave) return;
      try {
        const r = await api.acessoDaChave(id, agenteId, modo);
        const aberta = t.aberta?.id === id && t.aberta.detalhe ? { ...t.aberta, dando: false, detalhe: { ...t.aberta.detalhe, chave: r.chave } } : t.aberta;
        mudar({ chaves: (t.chaves ?? []).map((c) => (c.id === id ? r.chave : c)), aberta });
      } catch (e) {
        o.aoErro?.(e);
        render();
      }
    },
    /** Remover com Desfazer (D0): some já; o DELETE sai quando o aviso acaba. */
    removerChave(id: string): void {
      const api = o.api();
      const alvo = t.chaves?.find((c) => c.id === id);
      if (!api?.removerChaveDoCofre || !alvo) return;
      const marca = `chave:${id}`;
      o.focar?.(SELETOR_NOVO_ITEM);
      mudar({ apagando: new Set([...(t.apagando ?? []), marca]), menu: null, aberta: null });
      const voltar = () => { const a = new Set(t.apagando ?? []); a.delete(marca); mudar({ apagando: a }); };
      const timer = esperar(() => {
        api.removerChaveDoCofre!(id).then(() => {
          const a = new Set(t.apagando ?? []);
          a.delete(marca);
          mudar({ apagando: a, chaves: (t.chaves ?? []).filter((c) => c.id !== id) });
        }, (e: unknown) => { voltar(); o.aoErro?.(e); });
      }, MS_DESFAZER_LOGIN);
      o.avisar?.(`${alvo.app ?? alvo.nome} removida do cofre`, () => { cancelar(timer); o.focar?.(`[data-act="cofre-menu-item"][data-id="chave:${id.replace(/["\\]/gu, "\\$&")}"]`); voltar(); });
    },
  };
}
