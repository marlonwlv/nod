import { useLayoutEffect, useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import type { MenuDoIr } from "../../lib/ir-para-a-fala.ts";
import { itensDoMenu, NOTA_FALA_DEMOROU, NOTA_FALA_FORA, TEXTO_IR, TEXTO_IR_CARREGANDO } from "../../telas/biblioteca.ts";
import { MenuAncorado, montarMenu } from "./menu-ancorado.tsx";

/**
 * ADR-179 (item 4): o "…" de um arquivo da Biblioteca (NOD-363; `abrirMenuDaBiblioteca` no main, a volta com
 * `?dialogos-react=0`) pelo Menu do Base UI. O mesmo conteúdo de `htmlDoMenuDaBiblioteca` (Baixar e Ir para a mensagem; a
 * região de status só para o leitor de tela; a nota da falha, focável, fora dos itens). A espera do "Ir" (`criarMenuDoIr`,
 * `irParaFalaDaBiblioteca`) é a de sempre: o item carregando e a nota são estado aqui. Carregando, o Ir fica desligado
 * e focável (o `aria-disabled` de antes: o foco não cai no body e as setas seguem). Embaixo do "…", alinhado à direita.
 */
export interface MenuDaBiblioteca {
  ancora: HTMLElement;
  /** O "…" que está na tela agora (a Biblioteca redesenha durante a espera e troca o botão). */
  ancoraViva: () => HTMLElement;
  nome: string;
  baixar: boolean;
  aoBaixar: () => void;
  /** O clique no Ir: começa a espera com a `ui` deste menu e devolve como soltá-la. */
  ir: (ui: MenuDoIr<HTMLElement>) => { soltar(): void } | null;
  /** Ir até a fala (o menu já pediu para fechar). */
  irAte: (fala: HTMLElement, vizinha: boolean) => void;
}

function MenuDaBibliotecaRx({ m, sair }: { m: MenuDaBiblioteca; sair: () => void }) {
  const escolhida = useRef<(() => void) | null>(null);
  const acoes = useRef<{ close: () => void; unmount: () => void } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [nota, setNota] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const aberto = useRef(true);
  const espera = useRef<{ soltar(): void } | null>(null);
  const notaRef = useRef<HTMLParagraphElement>(null);
  const focarNota = useRef(false);
  useLayoutEffect(() => { if (focarNota.current && nota) { notaRef.current?.focus(); focarNota.current = false; } }, [nota]);
  const fechar = (): void => { if (aberto.current) acoes.current?.close(); };
  const ui: MenuDoIr<HTMLElement> = {
    aberto: () => aberto.current,
    carregando: () => { setCarregando(true); setNota(null); setStatus(TEXTO_IR_CARREGANDO); },
    falhou: (antiga) => { setCarregando(false); setStatus(""); focarNota.current = true; setNota(antiga ? NOTA_FALA_FORA : NOTA_FALA_DEMOROU); },
    fechar,
    irAte: (fala, vizinha) => { fechar(); m.irAte(fala, vizinha); },
  };
  const viva = m.ancoraViva;
  return (
    <MenuAncorado a={{
      ancora: m.ancora, lado: "bottom", alinhar: "end", distancia: 6, classe: "menu-compartilhar", acoes,
      aoFechar: () => {
        aberto.current = false;
        const v = viva();
        v.setAttribute("aria-expanded", "false");
        espera.current?.soltar();
        if (!m.ancora.isConnected && v.isConnected && (document.activeElement === document.body || document.activeElement === null)) v.focus();
      },
    }} rotulo={`Ações de ${m.nome}`} escolhida={escolhida} sair={sair}>
      {itensDoMenu({ baixar: m.baixar }).map((i) => (i === "baixar"
        ? <Menu.Item key="baixar" nativeButton render={<button type="button" />} data-gestao="baixar" onClick={() => { escolhida.current = m.aoBaixar; }}>Baixar</Menu.Item>
        : <Menu.Item key="ir" nativeButton render={<button type="button" />} data-gestao="ir" disabled={carregando} closeOnClick={false}
          onClick={() => { if (!carregando) espera.current = m.ir(ui); }}>{carregando ? TEXTO_IR_CARREGANDO : TEXTO_IR}</Menu.Item>))}
      <p className="menu-status sr-only" role="status">{status}</p>
      {nota && <p ref={notaRef} className="menu-nota" role="status" tabIndex={-1}>{nota}</p>}
    </MenuAncorado>
  );
}

export function abrirMenuDaBibliotecaNoReact(doc: Document, m: MenuDaBiblioteca): void {
  m.ancora.setAttribute("aria-expanded", "true");
  montarMenu(doc, "menu-biblioteca", (sair) => <MenuDaBibliotecaRx m={m} sair={sair} />);
}
