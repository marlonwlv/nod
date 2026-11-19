import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { ICONE_DA_FALA } from "../../telas/acoes-da-fala.ts";

/**
 * ADR-179 (fase 6, o campo de mensagem, pedaço 2): o topo do campo em React — a caixa "Respondendo" de uma pergunta
 * (duas ou mais abertas: Trocar e ×) e a de uma fala citada pelo "Responder" (×). O mesmo DOM do desenho por string
 * (web/telas/pergunta.ts, `renderTopoComposer`, o caminho de volta com `?composer-react=0`); as ações são props. Quem
 * decide o que a caixa diz é o main (o modo do campo e a citação da conversa), como antes.
 */
export type TopoDoCampo = { tipo: "citacao"; trecho: string } | { tipo: "respondendo"; texto: string; trecho: string } | null;
export interface AcoesDoTopo { cancelarCitacao: () => void; trocar: () => void; outro: () => void }

const FECHAR_CITACAO = ICONE_DA_FALA.fechar.replace('width="16" height="16"', 'width="14" height="14"');
const FECHAR_PERGUNTA = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

export function TopoDoCampoRx({ topo, acoes }: { topo: TopoDoCampo; acoes: AcoesDoTopo }) {
  if (!topo) return null;
  if (topo.tipo === "citacao") {
    return (
      <div className="caixa-respondendo caixa-citacao" role="group" aria-label="A próxima mensagem responde a esta mensagem">
        <div className="rp-txt"><span className="rp-rotulo">Respondendo</span><span className="rp-trecho" title={topo.trecho}>{topo.trecho}</span></div>
        <button type="button" className="rp-fechar" aria-label="Cancelar resposta" title="Cancelar resposta (Esc)" onClick={acoes.cancelarCitacao} dangerouslySetInnerHTML={{ __html: FECHAR_CITACAO }} />
      </div>
    );
  }
  return (
    <div className="caixa-respondendo" role="group" aria-label="A próxima mensagem responde a esta pergunta">
      <div className="rp-txt"><span className="rp-rotulo">Respondendo</span><span className="rp-trecho" title={topo.texto}>{topo.trecho}</span></div>
      <button type="button" className="bt link sm" title="Responder a outra pergunta aberta" onClick={acoes.trocar}>Trocar</button>
      <button type="button" className="rp-fechar" aria-label="Cancelar a resposta e mandar como mensagem comum" title="Mandar como mensagem comum (Esc)" onClick={acoes.outro} dangerouslySetInnerHTML={{ __html: FECHAR_PERGUNTA }} />
    </div>
  );
}

/** O topo montado no `#composer-pergunta` do campo à vista (um root por campo; o campo que saiu desmonta). */
export interface TopoNoReact { desenhar: (el: HTMLElement, topo: TopoDoCampo) => void }

export function criarTopoNoReact(acoes: AcoesDoTopo): TopoNoReact {
  const raizes = new Map<HTMLElement, Root>();
  return {
    desenhar(el, topo) {
      for (const [c, r] of raizes) if (!c.isConnected) { r.unmount(); raizes.delete(c); }
      let raiz = raizes.get(el);
      if (!raiz) { el.replaceChildren(); raiz = createRoot(el, { identifierPrefix: "topo-" }); raizes.set(el, raiz); }
      const r = raiz;
      flushSync(() => r.render(<StrictMode><TopoDoCampoRx topo={topo} acoes={acoes} /></StrictMode>));
    },
  };
}
