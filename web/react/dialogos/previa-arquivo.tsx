import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Dialog } from "@base-ui/react/dialog";
import { formatoDaPrevia, type FormatoPrevia } from "../../lib/icones-arquivo.ts";
import { MSG_SEM_PREVIA, NUVEM_DA_PREVIA, PREVIA_MAX_BYTES, PREVIA_TETO_MS, X_DA_PREVIA } from "../../lib/previa-html.ts";
import { reencontrarCardDaPrevia, type ModuloPrevia } from "../../telas/previa-arquivo.ts";

/**
 * ADR-179 (item 4): a prévia de um arquivo da conversa (NOD-327; web/telas/previa-arquivo.ts, a volta com
 * `?dialogos-react=0`) pelo Dialog do Base UI. A mesma casca (o topo com o nome, a contagem, Baixar e ×; o corpo com o
 * "Carregando…"), o mesmo carregamento (a rota de anexos, os limites de tamanho e de 15 s) e os mesmos módulos de formato
 * (`previa-csv`, `previa-pdf`), que desenham por conta própria no nó que o componente lhes entrega. O erro e a contagem
 * são estado. Fechar (Esc, ×, o fundo) cancela o carregamento e devolve o foco ao card — ou ao card novo do mesmo anexo,
 * se a conversa redesenhou com a prévia aberta (`reencontrar`).
 */
const carregar = (f: FormatoPrevia): Promise<ModuloPrevia> => (f === "csv" ? import("../../lib/previa-csv.ts") : import("../../lib/previa-pdf.ts"));
class Sem404 extends Error {}
type Estado = { tipo: "carregando" } | { tipo: "pronto"; contagem: string } | { tipo: "erro"; comBaixar: boolean };

function Previa({ a, origem, reencontrar, sair }: { a: { nome: string; url: string; formato: FormatoPrevia }; origem: HTMLElement; reencontrar: () => HTMLElement | null; sair: () => void }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const alvo = useRef<HTMLDivElement>(null);
  // Um controlador por execução do efeito (o StrictMode o roda duas vezes; o 2º não pode herdar o sinal abortado).
  const ctrl = useRef<AbortController | null>(null);
  const fechar = useRef<HTMLButtonElement>(null);
  const acoes = useRef<Dialog.Root.Actions | null>(null);
  useEffect(() => {
    const c = new AbortController();
    ctrl.current = c;
    const relogio = setTimeout(() => c.abort(new DOMException("tempo", "TimeoutError")), PREVIA_TETO_MS);
    const sinal = c.signal;
    void (async () => {
      try {
        const r = await fetch(a.url, { signal: sinal, credentials: "same-origin" });
        if (r.status === 404) throw new Sem404();
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        if (Number(r.headers.get("content-length") ?? "0") > PREVIA_MAX_BYTES) throw new Error("grande demais");
        const [bytes, modulo] = await Promise.all([r.arrayBuffer(), carregar(a.formato)]);
        if (sinal.aborted) throw sinal.reason;
        if (bytes.byteLength > PREVIA_MAX_BYTES) throw new Error("grande demais");
        const el = alvo.current;
        if (!el) return;
        const feito = await modulo.desenhar(el, bytes, { nome: a.nome, sinal });
        if (!sinal.aborted) setEstado({ tipo: "pronto", contagem: feito.contagem ?? "" });
      } catch (e) {
        // Fechou no meio: nada a mostrar.
        if (sinal.aborted && (sinal.reason as DOMException | undefined)?.name === "AbortError") return;
        setEstado({ tipo: "erro", comBaixar: !(e instanceof Sem404) });
      } finally {
        clearTimeout(relogio);
      }
    })();
    return () => { clearTimeout(relogio); c.abort(new DOMException("fechou", "AbortError")); };
  }, [a]);
  return (
    <Dialog.Root defaultOpen actionsRef={acoes} onOpenChange={(o) => { if (!o) { ctrl.current?.abort(new DOMException("fechou", "AbortError")); setTimeout(() => { acoes.current?.unmount(); sair(); }, 1000); } }} onOpenChangeComplete={(o) => { if (!o) sair(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="rx-prv-fundo" />
        <Dialog.Popup className={`previa-arquivo previa-${a.formato} rx-prv`} aria-label={`Prévia de ${a.nome}`} initialFocus={fechar}
          finalFocus={() => (origem.isConnected ? origem : reencontrar() ?? true)}>
          <div className="previa-arquivo-caixa">
            <header className="previa-topo">
              <div className="previa-titulo"><b title={a.nome}>{a.nome}</b><span className="previa-contagem" aria-live="polite">{estado.tipo === "pronto" ? estado.contagem : ""}</span></div>
              {!(estado.tipo === "erro" && !estado.comBaixar) && <a className="previa-bt previa-baixar" href={a.url} download={a.nome} aria-label={`Baixar ${a.nome}`} title="Baixar" dangerouslySetInnerHTML={{ __html: NUVEM_DA_PREVIA }} />}
              <Dialog.Close ref={fechar} className="previa-bt" data-previa="fechar" aria-label="Fechar prévia" title="Fechar (Esc)" dangerouslySetInnerHTML={{ __html: X_DA_PREVIA }} />
            </header>
            <div className="previa-corpo" aria-busy={estado.tipo === "carregando" ? "true" : undefined}>
              {estado.tipo === "carregando" && <p className="previa-carregando" role="status">Carregando…</p>}
              {estado.tipo === "erro"
                ? <div className="previa-erro" role="alert"><p>{MSG_SEM_PREVIA}</p>{estado.comBaixar && <a className="bt sm" href={a.url} download={a.nome}>Baixar</a>}</div>
                : <div ref={alvo} className={`previa-${a.formato}-corpo`} />}
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Abre a prévia a partir do card (`data-id`, `data-url`, `data-nome`, `data-mime`); null se o formato não tem prévia. */
export function abrirPreviaNoReact(doc: Document, origem: HTMLElement): true | null {
  const { id, url, nome = "arquivo", mime = "" } = origem.dataset;
  if (!id || !url) return null;
  const formato = formatoDaPrevia(mime, nome);
  if (!formato) return null;
  doc.querySelector(".rx-prv-host")?.dispatchEvent(new CustomEvent("rx-fechar"));
  const host = doc.createElement("div");
  host.className = "rx-prv-host";
  host.dataset["rxModal"] = "";
  doc.body.append(host);
  const raiz = createRoot(host, { identifierPrefix: "previa-" });
  let saiu = false;
  const sair = (): void => { if (saiu) return; saiu = true; queueMicrotask(() => { raiz.unmount(); host.remove(); }); };
  host.addEventListener("rx-fechar", sair, { once: true });
  // NOD-326: o mesmo anexo está no chat e na Biblioteca; o foco volta à casa de onde a prévia abriu.
  const reencontrar = (): HTMLElement | null => reencontrarCardDaPrevia(doc, origem, id);
  raiz.render(<StrictMode><Previa a={{ nome, url, formato }} origem={origem} reencontrar={reencontrar} sair={sair} /></StrictMode>);
  return true;
}
