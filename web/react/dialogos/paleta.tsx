import { StrictMode, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { filtrarPaleta, moverNaPaleta, ORDEM_DOS_GRUPOS, type ItemPaleta } from "../../lib/paleta.ts";
import type { DepsPaleta } from "../../lib/paleta-na-tela.ts";
import { ICONES, idDoItem, PLACEHOLDER_DA_PALETA } from "../../telas/paleta.ts";

/**
 * ADR-179 (item 4): a paleta ⌘K (ADR-167, tela 08) em React. O mesmo DOM e o mesmo comportamento da paleta por string
 * (web/lib/paleta-na-tela.ts + web/telas/paleta.ts, a volta com `?dialogos-react=0`): o campo no topo (combobox com
 * `aria-activedescendant`), os grupos, ↑ ↓ andam, Enter abre, Esc e o fundo fecham, o Tab volta ao campo e o foco volta
 * a quem estava ao fechar. O termo e a seleção são estado; as regras (o filtro, o andar) são as de `web/lib/paleta.ts`.
 * Os itens são relidos a cada busca: os trabalhos (o grupo Conversas) podem chegar depois de a paleta abrir.
 */
function Paleta({ deps, fechar, escolher }: { deps: DepsPaleta; fechar: () => void; escolher: (item: ItemPaleta) => void }) {
  const [termo, setTermo] = useState("");
  const [sel, setSel] = useState(0);
  const campo = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  // Relidos a cada busca, de propósito (deps.itens() lê o estado de agora).
  const vistos = useMemo(() => filtrarPaleta(deps.itens(), termo), [termo]);
  const atual = Math.min(sel, Math.max(0, vistos.length - 1));
  useEffect(() => { campo.current?.focus(); }, []);
  useEffect(() => { lista.current?.querySelector(`#${idDoItem(atual)}`)?.scrollIntoView?.({ block: "nearest" }); }, [atual]);
  const teclas = (ev: KeyboardEvent<HTMLDivElement>): void => {
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); fechar(); return; }
    if (ev.key === "Enter" && !ev.nativeEvent.isComposing) { ev.preventDefault(); ev.stopPropagation(); const item = vistos[atual]; if (item) escolher(item); return; }
    // O foco não sai da paleta: Tab volta ao campo.
    if (ev.key === "Tab") { ev.preventDefault(); campo.current?.focus(); return; }
    const prox = moverNaPaleta(atual, vistos.length, ev.key);
    if (prox !== null && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) { ev.preventDefault(); ev.stopPropagation(); setSel(prox); }
  };
  let n = 0;
  return (
    <div className="paleta-fundo" data-paleta-fundo="" onKeyDown={teclas} onClick={(ev) => { if ((ev.target as HTMLElement).hasAttribute("data-paleta-fundo")) fechar(); }}>
      <div className="paleta" role="dialog" aria-modal="true" aria-label="Buscar bots, conversas, ajustes e ações">
        <label className="paleta-campo">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></svg>
          <input ref={campo} id="paleta-termo" type="text" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="paleta-lista" placeholder={PLACEHOLDER_DA_PALETA}
            autoComplete="off" spellCheck={false} value={termo} onChange={(e) => { setTermo(e.currentTarget.value); setSel(0); }}
            aria-activedescendant={vistos.length ? idDoItem(atual) : undefined} />
        </label>
        <div ref={lista} className="paleta-lista" id="paleta-lista" role="listbox" aria-label="Resultados">
          {!vistos.length ? <p className="paleta-vazia" role="status">{`Nada encontrado para “${termo.trim()}”.`}</p>
            : ORDEM_DOS_GRUPOS.map((g) => {
              const doGrupo = vistos.filter((i) => i.grupo === g);
              if (!doGrupo.length) return null;
              return (
                <div key={g} className="paleta-grupo" role="group" aria-label={g}>
                  <p className="paleta-grupo-tit" aria-hidden="true">{g}</p>
                  {doGrupo.map((i) => {
                    const k = n++;
                    return (
                      <div key={i.chave} className="paleta-item" role="option" id={idDoItem(k)} data-indice={k} aria-selected={k === atual}
                        onMouseDown={(e) => e.preventDefault()} onMouseMove={() => { if (k !== atual) setSel(k); }} onClick={() => escolher(i)}>
                        {i.agenteId ? <span className="paleta-av" dangerouslySetInnerHTML={{ __html: deps.avatar(i.agenteId) }} />
                          : <span className="paleta-ic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: i.icone ? ICONES[i.icone] : "" }} />}
                        <span className="paleta-txt"><b>{i.titulo}</b>{i.sub && <small>{i.sub}</small>}</span>
                        {i.teclas?.length ? <span className="ds-teclas" aria-hidden="true">{i.teclas.map((t, j) => <kbd key={j} className="ds-kbd">{t}</kbd>)}</span> : null}
                      </div>
                    );
                  })}
                </div>
              );
            })}
        </div>
        <div className="paleta-rodape" aria-hidden="true"><span><kbd className="ds-kbd">↑</kbd><kbd className="ds-kbd">↓</kbd> navegar</span><span><kbd className="ds-kbd">↵</kbd> abrir</span><span><kbd className="ds-kbd">esc</kbd> fechar</span></div>
      </div>
    </div>
  );
}

/** A mesma interface da paleta por string: um elemento próprio no <body>, fora do render da página. */
export function criarPaletaNoReact(deps: DepsPaleta): { abrir(): void; fechar(): void; aberta(): boolean } {
  let casca: HTMLElement | null = null;
  let raiz: Root | null = null;
  let antes: HTMLElement | null = null;
  const fechar = (devolverFoco = true): void => {
    if (!casca || !raiz) return;
    raiz.unmount();
    casca.remove();
    casca = null;
    raiz = null;
    if (devolverFoco && antes?.isConnected) antes.focus();
    antes = null;
  };
  return {
    abrir() {
      if (casca) { casca.querySelector<HTMLInputElement>("#paleta-termo")?.select(); return; }
      antes = deps.doc.activeElement instanceof HTMLElement ? deps.doc.activeElement : null;
      casca = deps.doc.createElement("div");
      casca.className = "paleta-camada";
      casca.dataset["rxModal"] = "";
      deps.doc.body.append(casca);
      raiz = createRoot(casca, { identifierPrefix: "paleta-" });
      const r = raiz;
      flushSync(() => r.render(<StrictMode><Paleta deps={deps} fechar={() => fechar()} escolher={(item) => { fechar(false); deps.executar(item); }} /></StrictMode>));
    },
    fechar: () => fechar(),
    aberta: () => casca !== null,
  };
}
