import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { MIMES_IMAGEM, MIME_PDF, nomeLegivelDoAnexo, tamanhoHumano, type ItemAnexo } from "../../lib/anexos.ts";

/**
 * ADR-179 (fase 6, o campo de mensagem, pedaço 1): a fila de anexos em React. O mesmo DOM do desenho por string
 * (web/lib/anexos.ts, `renderItens`, o caminho de volta com `?composer-react=0`). A cada passo do upload o desenho por
 * string regravava a fila inteira (a miniatura nascia de novo e a imagem era decodificada outra vez); aqui só a barra do
 * item que andou muda. Os itens continuam no main (`anexosPendentes`, o progresso mudado no lugar): quem desenha passa
 * uma cópia, e a chave de cada item é a dele. O "remover" é prop.
 */
const ehImagem = (mime: string) => (MIMES_IMAGEM as readonly string[]).includes(mime);
const rotuloTipo = (mime: string) => (mime === MIME_PDF ? "PDF" : ehImagem(mime) ? "IMG" : "TXT");
const X = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

export function FilaDeAnexos({ itens, remover }: { itens: readonly ItemAnexo[]; remover: (chave: string) => void }) {
  return <>{itens.map((i) => <ItemDaFila key={i.chave} i={i} remover={remover} />)}</>;
}

function ItemDaFila({ i, remover }: { i: ItemAnexo; remover: (chave: string) => void }) {
  const x = <button type="button" className="anexo-x" data-id={i.chave} aria-label={`Remover ${i.nome}`} onClick={() => remover(i.chave)} dangerouslySetInnerHTML={{ __html: X }} />;
  const barra = <span className="anexo-barra"><span style={{ width: `${Math.round(i.progresso * 100)}%` }} /></span>;
  if (i.estado === "erro") return <div className="anexo-chip anexo-erro" role="alert"><div className="anexo-info"><b>{i.nome}</b><span>{i.erro ?? "Não enviado."}</span></div>{x}</div>;
  if (ehImagem(i.mime) && i.previa) {
    return (
      <div className={`anexo-thumb${i.estado === "enviando" ? " enviando" : ""}`}>
        <img src={i.previa} alt={i.nome} />
        <span className="anexo-info anexo-info-img" aria-hidden="true"><b>{nomeLegivelDoAnexo(i.nome)}</b><span>{tamanhoHumano(i.tamanho)}</span></span>
        {i.estado === "enviando" && barra}{x}
      </div>
    );
  }
  return (
    <div className="anexo-chip">
      <span className={`anexo-tipo tipo-${rotuloTipo(i.mime).toLowerCase()}`}>{rotuloTipo(i.mime)}</span>
      <div className="anexo-info"><b>{i.nome}</b>{i.estado === "enviando" ? barra : <span>{tamanhoHumano(i.tamanho)}</span>}</div>{x}
    </div>
  );
}

/** As filas montadas (a do campo do chat e a da pílula do Quadro): um root por contêiner; o contêiner que saiu desmonta. */
export interface FilasNoReact { desenhar: (el: HTMLElement, itens: readonly ItemAnexo[]) => void }

export function criarFilasNoReact(remover: (chave: string) => void): FilasNoReact {
  const raizes = new Map<HTMLElement, Root>();
  return {
    desenhar(el, itens) {
      for (const [c, r] of raizes) if (!c.isConnected) { r.unmount(); raizes.delete(c); }
      let raiz = raizes.get(el);
      if (!raiz) {
        // O que o desenho por string tinha posto ali sai: o React começa do contêiner vazio.
        el.replaceChildren();
        raiz = createRoot(el, { identifierPrefix: "anexos-" });
        raizes.set(el, raiz);
      }
      const r = raiz;
      // Uma cópia: o main muda o progresso no próprio item, e o React compara por valor.
      const copia = itens.map((i) => ({ ...i }));
      flushSync(() => r.render(<StrictMode><FilaDeAnexos itens={copia} remover={remover} /></StrictMode>));
    },
  };
}
