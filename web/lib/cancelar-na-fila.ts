/**
 * Cancelar só a mensagem que está na fila (definido em 2026-11-16, revê em parte o item 1 da COP-14). A fala mandada com
 * o bot trabalhando fica `pendente` no servidor até a sessão viva a confirmar (`confirmarNaSessao`), o que costuma
 * acontecer no próximo passo do bot. Por isso a chamada sai NA HORA do clique: os 5 s locais de antes perdiam a corrida
 * para a absorção. O Desfazer vem depois do OK: por 5 s ele manda o mesmo texto de novo (ou, com anexo, devolve o texto
 * e os arquivos ao campo vazio). Sem `window`/DOM aqui: o main.ts passa a api, o despacho, o relógio e o foco.
 */
import { ErroApi } from "./erro-api.ts";

/** Quanto tempo o Desfazer fica na linha depois do OK do servidor. */
export const CANCELAR_DESFAZER_MS = 5_000;
/** O "Já entrou no turno" fica pelo menos isto antes de a releitura da conversa o tirar (a que já estava no ar não o apaga). */
export const TARDE_MINIMO_MS = 3_000;

/**
 * cancelando: o POST está no ar. cancelada: o servidor cancelou (com `desfazivel` enquanto o Desfazer vale). voltou: o
 * Desfazer devolveu o texto e os anexos ao campo. desfeita: o Desfazer reenviou o texto (o balão cancelado se esconde).
 * tarde: o turno já tinha saído do pendente (409). erro: a rede ou o servidor falhou e o Cancelar volta como "Tentar de novo".
 */
export type FaseDoCancelamento = "cancelando" | "cancelada" | "voltou" | "desfeita" | "tarde" | "erro";

export type Cancelamento = {
  fase: FaseDoCancelamento;
  /** Quando a fase começou (o clique, o OK, a recusa). */
  em: number;
  conversaId: string;
  mensagemId: string;
  desfazivel?: boolean;
  /** Uma frase curta que entra na linha (ex.: o campo ocupado no Desfazer com anexo). */
  aviso?: string;
};

export type AcaoDoCancelamento =
  | { tipo: "cancelando-turno"; turnoId: string; conversaId: string; mensagemId: string; agora: number }
  | { tipo: "turno-cancelado"; turnoId: string; agora: number }
  | { tipo: "cancelamento-recusado"; turnoId: string; fase: "tarde" | "erro"; agora: number }
  | { tipo: "desfazer-expirou"; turnoId: string }
  | { tipo: "desfazer-cancelamento"; turnoId: string; como: "desfeita" | "voltou" | "campo-ocupado" };

/** As transições do `estado.cancelando` (o reducer só as chama). */
export function reduzirCancelamento(atual: Readonly<Record<string, Cancelamento>>, acao: AcaoDoCancelamento): Readonly<Record<string, Cancelamento>> {
  const c = atual[acao.turnoId];
  const com = (novo: Cancelamento): Readonly<Record<string, Cancelamento>> => ({ ...atual, [acao.turnoId]: novo });
  switch (acao.tipo) {
    case "cancelando-turno":
      return com({ fase: "cancelando", em: acao.agora, conversaId: acao.conversaId, mensagemId: acao.mensagemId });
    case "turno-cancelado":
      return c ? com({ ...c, fase: "cancelada", em: acao.agora, desfazivel: true }) : atual;
    case "cancelamento-recusado":
      return c ? com({ fase: acao.fase, em: acao.agora, conversaId: c.conversaId, mensagemId: c.mensagemId }) : atual;
    case "desfazer-expirou": {
      if (!c || c.fase !== "cancelada" || !c.desfazivel) return atual;
      const { desfazivel: _d, aviso: _a, ...resto } = c;
      return com(resto);
    }
    case "desfazer-cancelamento": {
      if (!c || c.fase !== "cancelada" || !c.desfazivel) return atual;
      if (acao.como === "campo-ocupado") return com({ ...c, aviso: "esvazie o campo para desfazer" });
      const { desfazivel: _d, aviso: _a, ...resto } = c;
      return com({ ...resto, fase: acao.como });
    }
  }
}

/** A releitura da conversa tira o "Já entrou no turno" que já ficou o mínimo na tela; o resto fica. */
export function aposReleitura(atual: Readonly<Record<string, Cancelamento>>, conversaId: string, agora: number): Readonly<Record<string, Cancelamento>> {
  const sai = Object.entries(atual).filter(([, c]) => c.conversaId === conversaId && c.fase === "tarde" && agora - c.em >= TARDE_MINIMO_MS);
  if (sai.length === 0) return atual;
  const novo = { ...atual };
  for (const [id] of sai) delete novo[id];
  return novo;
}

/** O 409 (estado_invalido) e o 404 dizem que o turno já não está pendente: não há o que cancelar. */
export function ehTarde(e: unknown): boolean {
  return e instanceof ErroApi && (e.codigo === "estado_invalido" || e.status === 409 || e.codigo === "nao_encontrado");
}

export type DepsDoCancelar = {
  cancelarTurno(turnoId: string): Promise<unknown>;
  dispatch(acao: AcaoDoCancelamento): void;
  estado(): Readonly<Record<string, Cancelamento>>;
  agora(): number;
  agendar(fn: () => void, ms: number): void;
  /** Relê a conversa (o turno sai de `turnosEmCurso` e entra em `turnosCancelados`). */
  invalidar(conversaId: string): void;
  /** A sessão caiu (401): a faixa de sempre, de toda a tela. */
  mostrarErro(e: unknown): void;
  focarDesfazer(turnoId: string): void;
  focarTentarDeNovo(turnoId: string): void;
  /** O Desfazer sumiu: o foco que estava nele (ou se perdeu com ele) volta ao campo de mensagem. */
  focarCampoSeSaiu(turnoId: string): void;
};

/** O clique em Cancelar (ou em "Tentar de novo"): o POST sai na hora; o OK abre os 5 s do Desfazer. */
export async function cancelarNaFila(d: DepsDoCancelar, alvo: { turnoId: string; conversaId: string; mensagemId: string }): Promise<void> {
  if (!alvo.turnoId || d.estado()[alvo.turnoId]?.fase === "cancelando") return;
  d.dispatch({ tipo: "cancelando-turno", ...alvo, agora: d.agora() });
  try {
    await d.cancelarTurno(alvo.turnoId);
  } catch (e) {
    const tarde = ehTarde(e);
    d.dispatch({ tipo: "cancelamento-recusado", turnoId: alvo.turnoId, fase: tarde ? "tarde" : "erro", agora: d.agora() });
    if (!tarde) {
      if (e instanceof ErroApi && e.status === 401) d.mostrarErro(e);
      d.focarTentarDeNovo(alvo.turnoId);
    }
    return;
  }
  d.dispatch({ tipo: "turno-cancelado", turnoId: alvo.turnoId, agora: d.agora() });
  d.invalidar(alvo.conversaId);
  d.focarDesfazer(alvo.turnoId);
  d.agendar(() => {
    if (!d.estado()[alvo.turnoId]?.desfazivel) return;
    d.dispatch({ tipo: "desfazer-expirou", turnoId: alvo.turnoId });
    d.focarCampoSeSaiu(alvo.turnoId);
  }, CANCELAR_DESFAZER_MS);
}

export type DepsDoDesfazer = {
  dispatch(acao: AcaoDoCancelamento): void;
  estado(): Readonly<Record<string, Cancelamento>>;
  /** A fala cancelada (texto, anexos e a citação que ela levava), ou null se a conversa não a tem mais. */
  fala(conversaId: string, mensagemId: string): { texto: string; anexos: readonly { id: string; nome: string; mime: string }[]; respondeA?: string } | null;
  /** O mesmo caminho do envio pelo campo (journal, `conversas.enviar`): a fala nova entra no fim da fila. false = outro envio em voo. */
  reenviar(conversaId: string, texto: string, respondeA?: string): boolean;
  /** O campo da conversa está na tela e vazio (texto e anexos). */
  campoVazio(conversaId: string): boolean;
  devolverAoCampo(conversaId: string, texto: string, anexos: readonly { id: string; nome: string; mime: string }[]): void;
  focarCampo(): void;
};

/** O Desfazer: sem anexo, reenvia; com anexo, devolve ao campo só se ele estiver vazio (como o recoverDraft). */
export function desfazerCancelamento(d: DepsDoDesfazer, turnoId: string): void {
  const c = d.estado()[turnoId];
  if (!c || c.fase !== "cancelada" || !c.desfazivel) return;
  const fala = d.fala(c.conversaId, c.mensagemId);
  if (!fala) return;
  if (fala.anexos.length > 0) {
    if (!d.campoVazio(c.conversaId)) {
      d.dispatch({ tipo: "desfazer-cancelamento", turnoId, como: "campo-ocupado" });
      return;
    }
    d.devolverAoCampo(c.conversaId, fala.texto, fala.anexos);
    d.dispatch({ tipo: "desfazer-cancelamento", turnoId, como: "voltou" });
    d.focarCampo();
    return;
  }
  if (!d.reenviar(c.conversaId, fala.texto, fala.respondeA)) return;
  d.dispatch({ tipo: "desfazer-cancelamento", turnoId, como: "desfeita" });
  d.focarCampo();
}
