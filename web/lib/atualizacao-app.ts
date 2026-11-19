/**
 * ADR-188: a atualização do app do Mac na janela web. O processo principal procura, baixa e reinicia; aqui só o que a
 * tela mostra (o cartão da barra e Configurações › Sobre o nod) e os pedidos que ela faz pela ponte
 * (`window.nodDesktop.atualizacaoApp`). Fora do app do Mac a ponte não existe e nada aparece.
 */
import type { AtualizacaoNaTela, PedidoReinicio, PonteAtualizacaoApp } from "../../src/contracts/desktop-atualizacao.ts";

export type PonteAtz = NonNullable<PonteAtualizacaoApp["atualizacaoApp"]>;

/** A pergunta que o cartão faz depois do clique (ou do "Reiniciar agora" de Sobre o nod). */
export type PerguntaReinicio = { tipo: "ocupado"; turnos: number; telas: number } | { tipo: "emLigacao" };

export type TelaAtualizacao = {
  estado: AtualizacaoNaTela;
  pergunta: PerguntaReinicio | null;
  /** O pedido de reinício saiu e a resposta ainda não voltou (os botões não repetem). */
  pedindo: boolean;
  /** O clique no cartão: a tinta está subindo desde este instante (ms); ao encher, o pedido sai. */
  enchendoDesde: number | null;
  /** Quando a versão ficou pronta nesta janela (ms): a entrada do cartão anima a partir daí, uma vez só. */
  prontaDesde: number | null;
};

/** O cartão aparece com a versão pronta (e enquanto pergunta, espera ou reinicia). */
export function cartaoVisivel(t: TelaAtualizacao | null): boolean {
  return !!t && t.estado.fase === "pronta";
}

export function criarAtualizacaoNaWeb(o: {
  ponte: () => PonteAtz | undefined;
  /** O tempo da tinta subindo (web/telas/atualizacao-app.ts, MS_ENCHER_ATUALIZAR); 0 no teste. */
  msEncher?: number;
  agendar?: (f: () => void, ms: number) => void;
  agora?: () => number;
  /** Redesenha (o estado mudou). */
  aoMudar: () => void;
  /** O aviso "nod atualizado para a x.y.z", uma vez depois do reinício. */
  avisarAtualizado: (versao: string) => void;
}) {
  let tela: TelaAtualizacao | null = null;

  function receber(e: AtualizacaoNaTela | null | undefined): void {
    if (!e) return;
    const antes = tela;
    // Saiu de "pronta" (reiniciou, ou um erro raro): a pergunta não vale mais.
    const valendo = e.fase === "pronta" && !e.reiniciando;
    const prontaDesde = e.fase !== "pronta" ? null : antes?.estado.fase === "pronta" ? antes.prontaDesde : (o.agora ?? Date.now)();
    tela = { estado: e, pergunta: valendo ? antes?.pergunta ?? null : null, pedindo: antes?.pedindo === true && !e.reiniciando, enchendoDesde: valendo ? antes?.enchendoDesde ?? null : null, prontaDesde };
    if (e.atualizadoDe) {
      o.avisarAtualizado(e.versaoAtual);
      tela = { ...tela, estado: { ...tela.estado, atualizadoDe: null } };
      void o.ponte()?.avisoVisto().catch(() => undefined);
    }
    o.aoMudar();
  }

  async function carregar(): Promise<void> {
    const p = o.ponte();
    if (!p) return;
    p.aoMudar(receber);
    receber(await p.estado().catch(() => null));
  }

  async function reiniciar(quando: PedidoReinicio["quando"]): Promise<void> {
    const p = o.ponte();
    if (!p || !tela || tela.pedindo) return;
    tela = { ...tela, pedindo: true, enchendoDesde: null };
    o.aoMudar();
    const r = await p.reiniciar({ quando }).catch(() => null);
    if (!tela) return;
    if (!r) { tela = { ...tela, pedindo: false }; o.aoMudar(); return; }
    if (r.ok) {
      // Esperando: o estado novo chega pela ponte (esperandoLivre). Reiniciando: a janela vai fechar; o cartão já mostra.
      tela = { ...tela, pergunta: null, pedindo: false, estado: r.esperando || quando === "cancelarEspera" ? tela.estado : { ...tela.estado, reiniciando: true } };
    } else if (r.motivo === "ocupado") {
      tela = { ...tela, pedindo: false, pergunta: { tipo: "ocupado", turnos: r.turnos, telas: r.telas } };
    } else if (r.motivo === "emLigacao") {
      tela = { ...tela, pedindo: false, pergunta: { tipo: "emLigacao" } };
    } else {
      tela = { ...tela, pedindo: false, pergunta: null };
    }
    o.aoMudar();
  }

  /** O clique no cartão: a tinta sobe e, cheia, o pedido sai (um segundo clique no meio não faz nada). */
  function encher(): void {
    if (!o.ponte() || !tela || tela.estado.fase !== "pronta" || tela.pedindo || tela.enchendoDesde !== null || tela.pergunta || tela.estado.reiniciando) return;
    tela = { ...tela, enchendoDesde: (o.agora ?? Date.now)() };
    o.aoMudar();
    (o.agendar ?? ((f, ms) => { setTimeout(f, ms); }))(() => {
      if (!tela || tela.enchendoDesde === null) return;
      tela = { ...tela, enchendoDesde: null };
      void reiniciar("agora");
    }, o.msEncher ?? 800);
  }

  function fecharPergunta(): void {
    if (!tela?.pergunta) return;
    tela = { ...tela, pergunta: null };
    o.aoMudar();
  }

  async function procurar(): Promise<void> {
    receber(await o.ponte()?.procurar().catch(() => null));
  }

  async function definirSozinho(ligado: boolean): Promise<void> {
    receber(await o.ponte()?.definirSozinho(ligado).catch(() => null));
  }

  return { carregar, receber, encher, reiniciar, fecharPergunta, procurar, definirSozinho, tela: () => tela, temPonte: () => !!o.ponte() };
}
export type AtualizacaoNaWeb = ReturnType<typeof criarAtualizacaoNaWeb>;
