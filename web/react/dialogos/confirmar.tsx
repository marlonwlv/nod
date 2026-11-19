import { StrictMode, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Dialog } from "@base-ui/react/dialog";

/**
 * ADR-179 (item 4): o diálogo de confirmação do nod (`bot-dialogo`: título, texto, "Cancelar" com o foco e a ação) com o
 * Dialog do Base UI. O mesmo DOM de dentro dos diálogos nativos que ele substitui — o 1º é o "Rodar mais uma execução?"
 * do Testar agora (web/telas/rodar-mais-uma-dialogo.ts, a volta com `?dialogos-react=0`). Responde true só pela ação;
 * Cancelar, Esc e o clique fora respondem false. O foco volta a quem estava com ele antes (o padrão do Base UI); `origem`
 * recebe o foco se ele se perdeu (o botão que pediu saiu do documento enquanto o diálogo estava aberto).
 */
export interface Confirmacao { idDoTitulo: string; titulo: string; texto: string; cancelar: string; confirmar: string; origem?: HTMLElement | null }

function DialogoDeConfirmar({ c, responder, sair }: { c: Confirmacao; responder: (sim: boolean) => void; sair: () => void }) {
  const acoes = useRef<Dialog.Root.Actions | null>(null);
  const respondeu = useRef(false);
  const cancelar = useRef<HTMLButtonElement>(null);
  const responderUmaVez = (sim: boolean): void => { if (!respondeu.current) { respondeu.current = true; responder(sim); setTimeout(() => { acoes.current?.unmount(); sair(); }, 1000); } };
  return (
    <Dialog.Root defaultOpen actionsRef={acoes} onOpenChange={(o) => { if (!o) responderUmaVez(false); }} onOpenChangeComplete={(o) => { if (!o) sair(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="rx-dlg-fundo" />
        <Dialog.Popup className="bot-dialogo rx-dlg" initialFocus={cancelar}>
          <Dialog.Title id={c.idDoTitulo}>{c.titulo}</Dialog.Title>
          <p>{c.texto}</p>
          <div className="acoes">
            <Dialog.Close ref={cancelar} className="bt" data-nao="" onClick={() => responderUmaVez(false)}>{c.cancelar}</Dialog.Close>{" "}
            <Dialog.Close className="bt pri" data-sim="" onClick={() => responderUmaVez(true)}>{c.confirmar}</Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Abre o diálogo num root próprio (desmontado ao fechar) e responde se a pessoa confirmou. */
export function confirmarNoReact(doc: Document, c: Confirmacao): Promise<boolean> {
  const host = doc.createElement("div");
  host.className = "rx-dlg-host";
  doc.body.append(host);
  const raiz = createRoot(host, { identifierPrefix: "confirmar-" });
  let saiu = false;
  const sair = (): void => {
    if (saiu) return;
    saiu = true;
    queueMicrotask(() => { raiz.unmount(); host.remove(); });
  };
  return new Promise((resolver) => {
    raiz.render(<StrictMode><DialogoDeConfirmar c={c} responder={resolver} sair={sair} /></StrictMode>);
  });
}
