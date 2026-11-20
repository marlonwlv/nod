import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Dialog } from "@base-ui/react/dialog";

/**
 * ADR-179 (item 4): "Conectar este Mac?" (ADR-069; web/telas/parear-mac.ts, a volta com `?dialogos-react=0`) pelo Dialog do
 * Base UI. O mesmo conteúdo do nativo; o "Conectar" fica desligado enquanto o pedido vai e, se falhar, o diálogo diz por
 * quê e o botão volta. Quem conecta e o que acontece depois (o navegador leva o código ao app) é de quem abre (`conectar`).
 * Fechar (Agora não, Esc, fora) chama `aoFechar`.
 */
const ERRO = "Não foi possível conectar. Abra o app e clique em Entrar com Google de novo.";

function DialogoDoMac({ nome, conectar, aoFechar, sair }: { nome: string; conectar: () => Promise<void>; aoFechar: () => void; sair: () => void }) {
  const acoes = useRef<Dialog.Root.Actions | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const fechou = useRef(false);
  const fechar = (): void => { if (!fechou.current) { fechou.current = true; aoFechar(); setTimeout(() => { acoes.current?.unmount(); sair(); }, 1000); } };
  return (
    <Dialog.Root defaultOpen actionsRef={acoes} onOpenChange={(o) => { if (!o) fechar(); }} onOpenChangeComplete={(o) => { if (!o) sair(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="rx-dlg-fundo" />
        <Dialog.Popup className="bot-dialogo rx-dlg">
          <Dialog.Title id="parear-titulo">Conectar este Mac?</Dialog.Title>
          <p>O app do nod em <b>{nome}</b> vai trabalhar pela sua conta: seus bots rodam nele, com o Claude Code ou o Codex desse Mac.</p>
          <p>Só confirme se foi você quem clicou em <b>Entrar com Google</b> no app agora.</p>
          <p data-estado="" className="dialogo-erro" role="status">{erro}</p>
          <div className="acoes">
            <Dialog.Close className="bt" data-nao="">Agora não</Dialog.Close>{" "}
            <button className="bt pri" data-sim="" type="button" disabled={enviando} onClick={() => {
              setEnviando(true);
              setErro("");
              conectar().catch(() => { setEnviando(false); setErro(ERRO); });
            }}>Conectar este Mac</button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function abrirPareamentoNoReact(doc: Document, o: { nome: string; conectar: () => Promise<void>; aoFechar: () => void }): void {
  const host = doc.createElement("div");
  host.className = "rx-dlg-host";
  host.dataset["rxModal"] = "";
  doc.body.append(host);
  const raiz = createRoot(host, { identifierPrefix: "parear-" });
  let saiu = false;
  const sair = (): void => { if (saiu) return; saiu = true; queueMicrotask(() => { raiz.unmount(); host.remove(); }); };
  raiz.render(<StrictMode><DialogoDoMac nome={o.nome} conectar={o.conectar} aoFechar={o.aoFechar} sair={sair} /></StrictMode>);
}
