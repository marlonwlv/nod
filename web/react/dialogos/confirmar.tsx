import { StrictMode, useRef, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Dialog } from "@base-ui/react/dialog";
import { devolverFocoQuandoPuder } from "../../telas/foco-de-volta.ts";

/**
 * ADR-179 (item 4): o diálogo de confirmação do nod (`bot-dialogo`: título, texto, "Cancelar" com o foco e a ação) com o
 * Dialog do Base UI. O mesmo DOM de dentro dos diálogos nativos que ele substitui — o 1º é o "Rodar mais uma execução?"
 * do Testar agora (web/telas/rodar-mais-uma-dialogo.ts, a volta com `?dialogos-react=0`). Responde true só pela ação;
 * Cancelar, Esc e o clique fora respondem false. Ao fechar, o foco vai para `origem`; se ela saiu do documento enquanto o
 * diálogo estava aberto (o `agir` liga o "ocupado" e a tela redesenha os botões), para o que `reencontrar` achar — o mesmo
 * botão, redesenhado. QA r235: o `origem` não era usado e o foco caía no <body> no Cancelar do "Excluir esta rotina?".
 * QA-162: se `origem` está desligada (o Testar agora com o `ocupado`), o foco volta a ela assim que ela religar
 * (web/telas/foco-de-volta.ts), em vez de cair no `<body>`.
 */
export interface Confirmacao {
  idDoTitulo: string;
  titulo: string;
  /** Um parágrafo; ou `corpo`, o corpo pronto (parágrafos, links). */
  texto?: string;
  corpo?: ReactNode;
  cancelar: string;
  confirmar: string;
  /** O botão principal (o `pri`, por último): a ação (o padrão) ou o Cancelar (o aviso que desaconselha). O foco abre em Cancelar. */
  principal?: "confirmar" | "cancelar";
  origem?: HTMLElement | null;
  /** O botão que pediu, achado de novo no DOM atual (quando `origem` já foi trocado pelo redesenho). */
  reencontrar?: () => HTMLElement | null;
}

/** QA r235: para onde o foco volta quando o diálogo fecha; `true` deixa o padrão do Base UI. */
export function destinoAoFechar(c: Pick<Confirmacao, "origem" | "reencontrar">): HTMLElement | boolean {
  const o = c.origem;
  if (o?.isConnected && (o as HTMLButtonElement).disabled) { queueMicrotask(() => devolverFocoQuandoPuder(o)); return false; }
  if (o?.isConnected) return o;
  return c.reencontrar?.() ?? true;
}

function DialogoDeConfirmar({ c, responder, sair }: { c: Confirmacao; responder: (sim: boolean) => void; sair: () => void }) {
  const acoes = useRef<Dialog.Root.Actions | null>(null);
  const respondeu = useRef(false);
  const cancelar = useRef<HTMLButtonElement>(null);
  const responderUmaVez = (sim: boolean): void => { if (!respondeu.current) { respondeu.current = true; responder(sim); setTimeout(() => { acoes.current?.unmount(); sair(); }, 1000); } };
  return (
    <Dialog.Root defaultOpen actionsRef={acoes} onOpenChange={(o) => { if (!o) responderUmaVez(false); }} onOpenChangeComplete={(o) => { if (!o) sair(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="rx-dlg-fundo" />
        <Dialog.Popup className="bot-dialogo rx-dlg" initialFocus={cancelar} finalFocus={() => destinoAoFechar(c)}>
          <Dialog.Title id={c.idDoTitulo}>{c.titulo}</Dialog.Title>
          {c.corpo ?? <p>{c.texto}</p>}
          <div className="acoes">
            {c.principal === "cancelar"
              ? <><Dialog.Close className="bt" data-sim="" onClick={() => responderUmaVez(true)}>{c.confirmar}</Dialog.Close>{" "}<Dialog.Close ref={cancelar} className="bt pri" data-nao="" onClick={() => responderUmaVez(false)}>{c.cancelar}</Dialog.Close></>
              : <><Dialog.Close ref={cancelar} className="bt" data-nao="" onClick={() => responderUmaVez(false)}>{c.cancelar}</Dialog.Close>{" "}<Dialog.Close className="bt pri" data-sim="" onClick={() => responderUmaVez(true)}>{c.confirmar}</Dialog.Close></>}
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
  host.dataset["rxModal"] = "";
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
