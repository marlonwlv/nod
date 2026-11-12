import type { AjustesAprovacao, ListaRegra, NivelFerramenta, TetoModo, TipoNivel } from "../../src/contracts/ajustes-aprovacao.ts";
import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import { fraseDoErro, TELA_APROVACOES_INICIAL, type BotDaTela, type TelaAprovacoes } from "../telas/config-aprovacoes.ts";

/**
 * O controlador de Configurações › Aprovações (ADR-166): o estado da tela fica aqui (fora do reducer: é só desta seção),
 * busca os ajustes do "Vale para" escolhido e grava cada mudança pela rota dela. Depois de gravar, relê do servidor — a
 * verdade é o banco, e o próximo desenho mostra o que valeu.
 */

export type ApiAprovacoes = {
  ajustesAprovacao(agenteId: string | null): Promise<AjustesAprovacao>;
  criarRegraRevisor(c: { agenteId: string | null; lista: ListaRegra; texto: string; origem?: "pessoa" | "sugestao" }): Promise<unknown>;
  editarRegraRevisor(id: string, texto: string): Promise<unknown>;
  apagarRegraRevisor(id: string): Promise<unknown>;
  definirNivelFerramenta(c: { agenteId: string | null; conector: string; tipo: TipoNivel; nivel: NivelFerramenta }): Promise<unknown>;
  definirSoLeitura(id: string, soLeitura: boolean): Promise<unknown>;
  definirTetoModo(teto: TetoModo | null): Promise<unknown>;
  mudarModoAprovacao(id: string, modo: ModoAprovacao, confirmado?: boolean): Promise<unknown>;
};

export function criarTelaAprovacoes(o: { api: () => ApiAprovacoes | null; bots: () => readonly BotDaTela[]; render: () => void; botsMudaram: () => void }) {
  let t: TelaAprovacoes = TELA_APROVACOES_INICIAL;
  let pedido = 0;
  const mudar = (p: Partial<TelaAprovacoes>) => {
    t = { ...t, ...p };
    o.render();
  };

  async function carregar(): Promise<void> {
    const api = o.api();
    if (!api) return;
    const meu = ++pedido;
    mudar({ carregando: true });
    try {
      const dados = await api.ajustesAprovacao(t.agenteId);
      if (meu === pedido) mudar({ dados, carregando: false, erro: null });
    } catch {
      if (meu === pedido) mudar({ carregando: false, erro: "Não deu para carregar as aprovações." });
    }
  }

  async function gravar(fn: (api: ApiAprovacoes) => Promise<unknown>, depois: Partial<TelaAprovacoes> = {}): Promise<void> {
    const api = o.api();
    if (!api) return;
    try {
      await fn(api);
      t = { ...t, ...depois, erro: null };
      await carregar();
    } catch (e) {
      mudar({ erro: fraseDoErro(e) });
    }
  }

  /** O modo de um bot, ou de todos os bots da pessoa ("Vale para: Todos os bots"). Total pede o segundo clique. */
  async function escolherModo(modo: ModoAprovacao): Promise<void> {
    if (modo === "total" && !t.confirmandoTotal) {
      mudar({ confirmandoTotal: true });
      return;
    }
    const alvos = t.agenteId ? [t.agenteId] : o.bots().filter((b) => b.modo !== modo).map((b) => b.id);
    await gravar(async (api) => {
      for (const id of alvos) await api.mudarModoAprovacao(id, modo, modo === "total");
    }, { confirmandoTotal: false });
    o.botsMudaram();
  }

  const campo = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>("[data-apv-campo]");
  const focarCampo = () => queueMicrotask(() => {
    const c = campo();
    c?.focus();
    c?.setSelectionRange(c.value.length, c.value.length);
  });

  async function salvarRegra(): Promise<void> {
    const ed = t.editando;
    const texto = (campo()?.value ?? ed?.texto ?? "").trim();
    if (!ed || texto === "") return;
    await gravar((api) => (ed.id ? api.editarRegraRevisor(ed.id, texto) : api.criarRegraRevisor({ agenteId: t.agenteId, lista: ed.lista, texto })), { editando: null });
  }

  const acoes: Record<string, (el: HTMLElement) => void> = {
    "apv-recarregar": () => void carregar(),
    "apv-modo": (el) => void escolherModo(el.dataset.modo as ModoAprovacao),
    "apv-so-leitura": () => {
      const id = t.agenteId;
      if (id && t.dados) void gravar((api) => api.definirSoLeitura(id, !t.dados!.soLeitura));
    },
    "apv-nova-regra": (el) => {
      mudar({ editando: { lista: el.dataset.lista as ListaRegra, id: null, texto: "" }, erro: null });
      focarCampo();
    },
    "apv-editar-regra": (el) => {
      const r = [...(t.dados?.regras.doBot ?? []), ...(t.dados?.regras.padrao ?? [])].find((x) => x.id === el.dataset.regra);
      if (!r) return;
      mudar({ editando: { lista: r.lista, id: r.id, texto: r.texto }, erro: null });
      focarCampo();
    },
    "apv-apagar-regra": (el) => {
      const id = el.dataset.regra;
      if (id) void gravar((api) => api.apagarRegraRevisor(id));
    },
    "apv-salvar-regra": () => void salvarRegra(),
    "apv-cancelar-regra": () => mudar({ editando: null }),
  };

  const change: Record<string, (valor: string, el: HTMLElement) => void> = {
    "apv-vale-para": (valor) => {
      t = { ...t, agenteId: valor === "" ? null : valor, dados: null, editando: null, confirmandoTotal: false };
      void carregar();
    },
    "apv-nivel": (valor, el) => {
      const conector = el.dataset.conector;
      const tipo = el.dataset.tipo as TipoNivel;
      if (conector) void gravar((api) => api.definirNivelFerramenta({ agenteId: t.agenteId, conector, tipo, nivel: valor as NivelFerramenta }));
    },
    "apv-teto": (valor) => void gravar((api) => api.definirTetoModo(valor === "" ? null : (valor as TetoModo))),
  };

  /** Enter salva e Esc cancela a regra em edição (o Esc não fecha as Configurações enquanto houver campo aberto). */
  function tecla(ev: KeyboardEvent): boolean {
    if (!t.editando || !(ev.target instanceof HTMLElement) || !ev.target.matches("[data-apv-campo]")) return false;
    if (ev.key === "Enter") {
      ev.preventDefault();
      void salvarRegra();
      return true;
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      mudar({ editando: null });
      return true;
    }
    return false;
  }

  return {
    estado: () => t,
    /** O texto digitado atravessa os redesenhos (SSE, relógio) sem redesenhar agora: o campo não perde nada. */
    digitar(texto: string): void {
      if (t.editando) t = { ...t, editando: { ...t.editando, texto } };
    },
    /** Abre a seção (e, do cartão, já num bot): relê sempre, como Geral relê os avisos. */
    abrir(agenteId?: string | null): void {
      if (agenteId !== undefined && agenteId !== t.agenteId) t = { ...t, agenteId, dados: null };
      t = { ...t, editando: null, confirmandoTotal: false };
      void carregar();
    },
    /** Do "Editar" da linha "Aprovado pela sua regra": abre já editando a regra. */
    editarRegra(agenteId: string | null, regraId: string): void {
      t = { ...t, agenteId, dados: null, editando: null };
      const achar = () => [...(t.dados?.regras.doBot ?? []), ...(t.dados?.regras.padrao ?? [])].find((x) => x.id === regraId);
      void carregar().then(async () => {
        // A regra do padrão aparece no bot como "Todos os bots" (só leitura ali): edita-se no alcance dela.
        const achada = achar();
        if (achada && achada.agenteId !== t.agenteId) {
          t = { ...t, agenteId: achada.agenteId };
          await carregar();
        }
        const r = achar();
        if (r) {
          mudar({ editando: { lista: r.lista, id: r.id, texto: r.texto } });
          focarCampo();
        }
      });
    },
    acoes,
    change,
    tecla,
  };
}
