import { StrictMode, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Dialog } from "@base-ui/react/dialog";
import type { TelaCheiaDoArtefato } from "../../telas/artefatos-vivos.ts";

/**
 * ADR-179 (item 4): a tela cheia de um artefato (web/telas/artefatos-vivos.ts, a volta com `?dialogos-react=0`) pelo
 * Dialog do Base UI. O mesmo cabeçalho (a marca, o título, a versão, Baixar .html e ✕) e o mesmo iframe vivo: quem o
 * monta segue sendo `artefatos-vivos` (a ponte, o estado, as gravações), no nó do corpo que o componente lhe dá; ao
 * fechar, ele solta o iframe e renova os da conversa. Esc, ✕ e o fundo fecham; o foco volta a quem abriu.
 */
function TelaCheia({ d, sair }: { d: TelaCheiaDoArtefato; sair: () => void }) {
  const acoes = useRef<Dialog.Root.Actions | null>(null);
  // O portal põe o conteúdo depois do 1º efeito: o iframe monta quando o corpo chega (a ref com limpeza do React 19).
  const corpo = useCallback((el: HTMLDivElement | null) => (el ? d.montar(el) : undefined), [d]);
  return (
    <Dialog.Root defaultOpen actionsRef={acoes}
      onOpenChange={(o) => { if (!o) setTimeout(() => { acoes.current?.unmount(); sair(); }, 1000); }}
      onOpenChangeComplete={(o) => { if (!o) sair(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="rx-art-fundo" />
        <Dialog.Popup className="artefato-dialogo rx-art" aria-label={d.titulo} finalFocus={() => (d.origem?.isConnected ? d.origem : true)}>
          <header className="artefato-cab">
            <span className="artefato-marca" aria-hidden="true">▣</span><b className="artefato-titulo">{d.titulo}</b><span className="artefato-meta">{`v${d.versao}`}</span>
            <span className="artefato-acoes">
              <button type="button" className="bt link sm" onClick={d.baixar}>Baixar .html</button>
              <Dialog.Close className="bt sm" data-fechar="" aria-label="Fechar tela cheia">✕</Dialog.Close>
            </span>
          </header>
          <div ref={corpo} className="artefato-dialogo-corpo" />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Abre a tela cheia do artefato num root próprio (desmontado ao fechar). */
export function abrirArtefatoNoReact(doc: Document, d: TelaCheiaDoArtefato): void {
  const host = doc.createElement("div");
  host.className = "rx-art-host";
  host.dataset["rxModal"] = "";
  doc.body.append(host);
  const raiz = createRoot(host, { identifierPrefix: "artefato-" });
  let saiu = false;
  const sair = (): void => { if (saiu) return; saiu = true; queueMicrotask(() => { raiz.unmount(); host.remove(); }); };
  raiz.render(<StrictMode><TelaCheia d={d} sair={sair} /></StrictMode>);
}
