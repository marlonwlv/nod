import type { CofreDto } from "../../src/contracts/cofre.ts";
import type { LoginDoCofreNaTela } from "../../src/contracts/navegador-do-bot.ts";
import { casaComFiltro, siteDoFiltro, TELA_COFRE_INICIAL, type TelaCofre } from "../telas/config-cofre.ts";

/** Apagar um login some da lista na hora e só vai ao servidor quando o aviso com Desfazer acaba (D0: desfazer > confirmar). */
export const MS_DESFAZER_LOGIN = 5_500;

const SELETOR_ADICIONAR = '[data-act="cofre-adicionar-login"]';
const seletorDoApagar = (id: string) => `.cofre-apagar[data-id="${id.replace(/["\\]/gu, "\\$&")}"]`;

/**
 * QA-206: para onde vai o foco quando a linha `id` some — o Apagar da linha seguinte que está à vista, senão o da
 * anterior, senão o "Adicionar login" (a lista ficou vazia). Segue a mesma conta de visíveis do desenho (filtro e
 * apagando).
 */
export function destinoAoApagar(t: TelaCofre, id: string): string {
  const visiveis = (t.logins ?? []).filter((l) => !t.apagando?.has(l.id) && (!t.filtro || casaComFiltro(l.site, t.filtro)));
  const i = visiveis.findIndex((l) => l.id === id);
  const vizinho = i < 0 ? undefined : visiveis[i + 1] ?? visiveis[i - 1];
  if (vizinho) return seletorDoApagar(vizinho.id);
  return t.adicionando ? '.cofre-form input[name="site"]' : SELETOR_ADICIONAR;
}

type ApiDoCofre = {
  cofre(): Promise<CofreDto>;
  cofreLogins?(): Promise<{ logins: LoginDoCofreNaTela[] }>;
  guardarNoCofre?(login: { site: string; usuario: string; senha: string }): Promise<{ ok: true; login: LoginDoCofreNaTela }>;
  apagarDoCofre?(id: string): Promise<{ ok: true }>;
};

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
  async function abrir(): Promise<void> {
    const api = o.api();
    if (!api) return;
    const meu = ++pedido;
    // Abrir de novo tira o filtro do "Logins deste site…" (quem filtra chama `filtrar` depois de abrir).
    mudar({ carregando: true, erro: false, erroLogins: false, filtro: null, adicionando: false, erroNovo: null });
    const logins = api.cofreLogins
      ? api.cofreLogins().then((r) => { if (meu === pedido) mudar({ logins: r.logins }); }, () => { if (meu === pedido) mudar({ erroLogins: true }); })
      : Promise.resolve();
    try {
      const r = await api.cofre();
      if (meu === pedido) mudar({ credenciais: r.credenciais, carregando: false });
    } catch {
      if (meu === pedido) mudar({ carregando: false, erro: true });
    }
    await logins;
  }
  return {
    estado: (): TelaCofre => t,
    abrir,
    /** "Logins deste site…" (D1c): o Cofre abre filtrado pelo site da aba do navegador. "" tira o filtro. */
    filtrar(url: string): void { mudar({ filtro: siteDoFiltro(url) || null }); },
    /** "Ver todos" do filtro: o chip some com o botão focado; o foco vai para o "Adicionar login" (ou o campo do site). */
    verTodos(): void { o.focar?.(t.adicionando ? '.cofre-form input[name="site"]' : SELETOR_ADICIONAR); mudar({ filtro: null }); },
    adicionando(sim: boolean): void { mudar({ adicionando: sim, erroNovo: null }); },
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
      mudar({ apagando: new Set([...(t.apagando ?? []), id]) });
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
  };
}
