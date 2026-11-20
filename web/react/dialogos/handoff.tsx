import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Dialog } from "@base-ui/react/dialog";
import { haQuanto, linhaDoResponsavel, type DadosDoHandoff } from "../../telas/dialogo-handoff.ts";

/**
 * ADR-179 (item 4: os diálogos criados por código) e ADR-180 (Base UI para o comportamento difícil): o diálogo de handoff
 * do Quadro (soltar ou mover a tarefa para uma coluna com responsável) com o Dialog do Base UI. O mesmo conteúdo e as
 * mesmas classes do diálogo nativo (web/telas/dialogo-handoff.ts, `abrirDialogoDeHandoff`, o caminho de volta com
 * `?dialogos-react=0`); a resposta é a mesma promessa: null = Cancelar (Esc, fora, Cancelar);
 * senão mover, com ou sem parar o anterior. O foco abre em "Mover para…" e volta a quem estava antes.
 */
type Escolha = { parar: boolean } | null;

function DialogoDeHandoff({ d, agora, responder, sair }: { d: DadosDoHandoff; agora: number; responder: (e: Escolha) => void; sair: () => void }) {
  const acoes = useRef<Dialog.Root.Actions | null>(null);
  const respondeu = useRef(false);
  const mover = useRef<HTMLButtonElement>(null);
  const [parar, setParar] = useState(false);
  const a = d.anterior && d.passa ? d.anterior : null;
  const responderUmaVez = (e: Escolha): void => { if (!respondeu.current) { respondeu.current = true; responder(e); setTimeout(() => { acoes.current?.unmount(); sair(); }, 1000); } };
  // A escolha vale na hora; quem fecha é o Base UI (`close`), para a saída terminar pelo caminho dele e o foco voltar.
  const fechar = (e: Escolha): void => { responderUmaVez(e); acoes.current?.close(); };
  return (
    <Dialog.Root defaultOpen actionsRef={acoes} onOpenChange={(o) => { if (!o) responderUmaVez(null); }} onOpenChangeComplete={(o) => { if (!o) sair(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="rx-ho-fundo" />
        <Dialog.Popup className="qd-handoff rx-ho" id="qd-handoff" initialFocus={mover}>
          <form className="qd-ho-form" onSubmit={(e) => { e.preventDefault(); fechar({ parar }); }}>
            <Dialog.Title className="qd-ho-tit" id="qd-ho-titulo">{`Mover ${d.codigo} para ${d.coluna}?`}</Dialog.Title>
            <Dialog.Description className="qd-ho-linha" id="qd-ho-linha">{linhaDoResponsavel(d)}</Dialog.Description>
            {a && (
              <div className="qd-ho-run">
                <p className="qd-ho-run-tit">{a.estado === "rodando" ? `${a.agenteNome} ainda está trabalhando (${haQuanto(a.desde, agora)})` : `O run do ${a.agenteNome} está na fila`}</p>
                <label className="qd-ho-op"><input type="checkbox" name="parar" checked={parar} onChange={(e) => setParar(e.currentTarget.checked)} />{` ${a.estado === "rodando" ? `Parar o run do ${a.agenteNome}` : `Cancelar o run na fila do ${a.agenteNome}`}`}</label>
                <p className="qd-ho-dica">{a.estado === "rodando" ? "O que ele já fez fica; se não parar, os dois trabalham no card ao mesmo tempo." : "Se não cancelar, ele ainda começa depois."}</p>
              </div>
            )}
            {d.texto && d.paraNome && <details className="qd-ho-recebe"><summary>{`O que o ${d.paraNome} recebe`}</summary><pre className="qd-ho-texto">{d.texto}</pre></details>}
            <div className="qd-ho-bts">
              <button type="button" className="qd-bt" data-ho="cancelar" onClick={() => fechar(null)}>Cancelar</button>
              <button ref={mover} type="submit" className="qd-bt qd-bt-pri" data-ho="mover">{`Mover para ${d.coluna}`}</button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Abre o diálogo num root próprio (desmontado ao fechar) e responde a escolha. */
export function abrirHandoffNoReact(doc: Document, d: DadosDoHandoff, agora = Date.now()): Promise<Escolha> {
  const host = doc.createElement("div");
  host.className = "rx-ho-host";
  host.dataset["rxModal"] = "";
  doc.body.append(host);
  const raiz = createRoot(host, { identifierPrefix: "handoff-" });
  let saiu = false;
  const sair = (): void => {
    if (saiu) return;
    saiu = true;
    queueMicrotask(() => { raiz.unmount(); host.remove(); });
  };
  return new Promise((resolver) => {
    raiz.render(<StrictMode><DialogoDeHandoff d={d} agora={agora} responder={resolver} sair={sair} /></StrictMode>);
  });
}
