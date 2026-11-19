import { StrictMode, useRef, useState, type MouseEvent } from "react";
import { createRoot } from "react-dom/client";
import { Dialog } from "@base-ui/react/dialog";
import type { IaDesktop } from "../../../src/contracts/desktop.ts";
import { htmlDoAvisoDosTermos, type ContaNoAviso } from "../../telas/aviso-termos.ts";

/**
 * ADR-179 (item 4): o aviso dos termos ao ligar a troca de conta sozinha (web/telas/aviso-termos-dialogo.ts, a volta com
 * `?dialogos-react=0`) pelo Dialog do Base UI. Desde as Jornadas da IA (Paper G3, #233) ele é um diálogo próprio
 * (`termos-dialogo`: a conta no topo, as fontes, "Deixar fora da fila" ou "Cancelar" como o principal), não a confirmação
 * genérica: o miolo é o mesmo HTML do nativo (`htmlDoAvisoDosTermos`, montado com `esc`), uma fonte só para os dois.
 * true = "Ligar mesmo assim"; o caminho seguro, Esc e o clique fora respondem false. O foco abre no caminho seguro.
 */
function AvisoDosTermos({ ia, conta, responder, sair }: { ia: IaDesktop; conta?: ContaNoAviso; responder: (sim: boolean) => void; sair: () => void }) {
  const [aberto, setAberto] = useState(true);
  const respondeu = useRef(false);
  const popup = useRef<HTMLDivElement>(null);
  const fechar = (sim: boolean): void => {
    if (!respondeu.current) { respondeu.current = true; responder(sim); }
    setAberto(false);
  };
  const clicar = (ev: MouseEvent<HTMLDivElement>): void => {
    const alvo = ev.target as Element;
    if (alvo.closest("[data-sim]")) fechar(true);
    else if (alvo.closest("[data-nao]")) fechar(false);
  };
  return (
    <Dialog.Root open={aberto} onOpenChange={(o) => { if (!o) fechar(false); }} onOpenChangeComplete={(o) => { if (!o) sair(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="rx-dlg-fundo" />
        <Dialog.Popup ref={popup} className="termos-dialogo rx-dlg" aria-labelledby="aviso-termos-titulo"
          initialFocus={() => popup.current?.querySelector<HTMLElement>("[data-nao]") ?? true} onClick={clicar}
          dangerouslySetInnerHTML={{ __html: htmlDoAvisoDosTermos(ia, conta) }} />
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Abre o aviso num root próprio (desmontado ao fechar) e responde se a pessoa ligou mesmo assim. */
export function avisarTermosNoReact(doc: Document, ia: IaDesktop, conta?: ContaNoAviso): Promise<boolean> {
  const host = doc.createElement("div");
  host.className = "rx-dlg-host";
  host.dataset["rxModal"] = "";
  doc.body.append(host);
  const raiz = createRoot(host, { identifierPrefix: "termos-" });
  let saiu = false;
  const sair = (): void => {
    if (saiu) return;
    saiu = true;
    queueMicrotask(() => { raiz.unmount(); host.remove(); });
  };
  return new Promise((resolver) => {
    raiz.render(<StrictMode><AvisoDosTermos ia={ia} {...(conta ? { conta } : {})} responder={resolver} sair={sair} /></StrictMode>);
  });
}
