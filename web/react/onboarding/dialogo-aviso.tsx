import { Dialog } from "@base-ui/react/dialog";
import type { AvisoOnboarding } from "../../telas/onboarding.ts";

/**
 * ADR-179 (fase 5): o aviso de leitura do onboarding ("Sua voz na ligação", "Como liberar o …") no Dialog do Base UI —
 * foco preso, Esc e clique fora fecham, o foco volta a quem abriu. Antes era o `<dialog>` montado à mão por
 * web/telas/gestao-agentes.ts; a cara é a mesma (.bot-dialogo, um "Entendi" só).
 */
export function DialogoAviso({ aviso, aoFechar }: { aviso: AvisoOnboarding | null; aoFechar: () => void }) {
  return (
    <Dialog.Root open={aviso !== null} onOpenChange={(aberto) => { if (!aberto) aoFechar(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="rx-fundo-dialogo" />
        <Dialog.Popup className="bot-dialogo rx-dialogo ligacao-consentimento">
          {aviso ? (
            <>
              <Dialog.Title render={<h2 />}>{aviso.titulo}</Dialog.Title>
              {aviso.paragrafos.map((p) => <p key={p}>{p}</p>)}
              <div className="acoes">
                <Dialog.Close className="bt pri">Entendi</Dialog.Close>
              </div>
            </>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
