import { StrictMode, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { Dialog } from "@base-ui/react/dialog";
import { duracaoHumana, familiaWeb, lembrancaDaMidia, type ItemLuz } from "../../lib/midia.ts";
import { lerLuz, reencontrarMidia, type OpcoesLuz } from "../../telas/luz.ts";
import { baixarUrl, destinoDaSeta, ICONE, proximaVel, rotuloVel, temFinder } from "../../telas/luz-html.ts";

/**
 * ADR-179 (item 4): a tela cheia da mídia do bot (NOD-323; web/telas/luz.ts, a volta com `?dialogos-react=0`) pelo
 * Dialog do Base UI. O mesmo DOM de `htmlDaLuz` (as classes e os `data-luz` que o CSS e os testes leem), o mesmo
 * comportamento: as setas (que somem nas pontas, passando o foco para a outra), ← →, o deslize, as miniaturas, o duplo
 * clique no tamanho real, o clique fora da mídia que fecha, o vídeo com a barra mínima e as velocidades, Mostrar no
 * Finder no Mac do arquivo. O item da vez, o tamanho real e o estado do vídeo são estado; o foco volta ao botão da mídia
 * (ou ao botão novo da mesma mídia, se a conversa redesenhou com a tela aberta).
 */
const svg = (h: string) => ({ dangerouslySetInnerHTML: { __html: h } });

function estiloDoItem(it: ItemLuz): CSSProperties {
  const ar = it.w && it.h ? it.w / it.h : familiaWeb(it.mime) === "video" ? 16 / 9 : 4 / 3;
  return { "--ar": String(Math.round(ar * 1000) / 1000), "--w": it.w ? `${it.w}px` : "1600px" } as CSSProperties;
}

function Video({ it, aoAlternar, aoFora }: { it: ItemLuz; aoAlternar: (v: HTMLVideoElement | null) => void; aoFora: (ev: { target: EventTarget; currentTarget: EventTarget }) => void }) {
  const v = useRef<HTMLVideoElement>(null);
  const [tempo, setTempo] = useState<{ agoraMs: number; totalMs: number; pausado: boolean } | null>(null);
  const [vel, setVel] = useState(1);
  const ler = (): void => {
    const el = v.current;
    if (!el) return;
    setTempo({ agoraMs: el.currentTime * 1000, totalMs: Number.isFinite(el.duration) ? el.duration * 1000 : (it.dur ?? 0), pausado: el.paused });
  };
  const dur = duracaoHumana(it.dur) ?? "0:00";
  const agora = tempo ? duracaoHumana(tempo.agoraMs) ?? "0:00" : "0:00";
  const fim = tempo ? duracaoHumana(tempo.totalMs) ?? "0:00" : dur;
  const p = tempo && tempo.totalMs > 0 ? tempo.agoraMs / tempo.totalMs : 0;
  const pausado = tempo?.pausado ?? true;
  return (
    <div className="luz-video" onClick={aoFora}>
      <video ref={v} src={it.url} preload="metadata" playsInline autoPlay data-luz="video" aria-label={it.nome} onClick={() => aoAlternar(v.current)}
        onTimeUpdate={ler} onLoadedMetadata={ler} onPlay={ler} onPause={ler} onEnded={ler} />
      <div className="ctl" data-luz-ctl="">
        <button type="button" className="ctl-play" data-luz="play" aria-label={pausado ? "Reproduzir" : "Pausar"} onClick={() => aoAlternar(v.current)} {...svg(pausado ? ICONE.play : ICONE.pausa)} />
        <input type="range" className="ctl-trilha" min="0" max="1000" step="1" value={String(Math.round(p * 1000))} data-luz="ir" aria-label="Posição no vídeo" aria-valuetext={`${agora} de ${fim}`}
          style={tempo ? ({ "--p": `${p * 100}%` } as CSSProperties) : undefined}
          onChange={(ev) => { const el = v.current; if (el && Number.isFinite(el.duration)) el.currentTime = (Number(ev.currentTarget.value) / 1000) * el.duration; }} />
        <span className="ctl-tempo" data-luz="tempo">{`${agora} / ${fim}`}</span>
        <button type="button" className="ctl-vel" data-luz="vel" aria-label={`Velocidade ${rotuloVel(vel)}`}
          onClick={() => { const el = v.current; if (!el) return; const nova = proximaVel(el.playbackRate); el.playbackRate = nova; setVel(nova); }}>{rotuloVel(vel)}</button>
      </div>
    </div>
  );
}

const alternar = (v: HTMLVideoElement | null): void => {
  if (!v) return;
  if (v.paused) void v.play().catch(() => undefined);
  else v.pause();
};

function Luz({ itens, inicio, esteMac, finder, origem, reencontrar, sair }: {
  itens: ItemLuz[]; inicio: number; esteMac: string | null; finder: OpcoesLuz["finder"]; origem: HTMLElement;
  reencontrar: (anexoId: string) => HTMLElement | null; sair: () => void;
}) {
  const [i, setI] = useState(inicio);
  const [cem, setCem] = useState(false);
  const acoes = useRef<Dialog.Root.Actions | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const fechar = useRef<HTMLButtonElement>(null);
  const ant = useRef<HTMLButtonElement>(null);
  const prox = useRef<HTMLButtonElement>(null);
  const minis = useRef<HTMLDivElement>(null);
  const passarFoco = useRef<"ant" | "prox" | null>(null);
  const x0 = useRef<number | null>(null);
  const atual = useRef(i);
  atual.current = i;
  const [entra] = useState(() => !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const n = itens.length;
  const it = itens[i]!;
  const video = familiaWeb(it.mime) === "video";
  const pausarVideos = (): void => popup.current?.querySelectorAll("video").forEach((v) => v.pause());

  const ir = (k: number): void => {
    if (n < 2 || k < 0 || k >= n || k === i) return;
    pausarVideos();
    // Nas pontas a seta daquele lado some; se o foco estava nela, passa para a outra.
    const focoNa = document.activeElement;
    passarFoco.current = focoNa === ant.current && k === 0 ? "prox" : focoNa === prox.current && k === n - 1 ? "ant" : null;
    setCem(false);
    setI(k);
  };
  useLayoutEffect(() => {
    if (passarFoco.current) (passarFoco.current === "prox" ? prox : ant).current?.focus();
    passarFoco.current = null;
    minis.current?.children[i]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [i]);
  const fecharJa = (): void => acoes.current?.close();

  const pos = n > 1 ? ` · ${i + 1} / ${n}` : "";
  const legenda = <p className="luz-legenda" id="luz-legenda">{`${it.nome}${pos}`}</p>;
  const naFigura = (ev: { target: EventTarget; currentTarget: EventTarget }): void => { if (ev.target === ev.currentTarget) fecharJa(); };

  return (
    <Dialog.Root defaultOpen actionsRef={acoes}
      onOpenChange={(o) => { if (!o) { pausarVideos(); setTimeout(() => { acoes.current?.unmount(); sair(); }, 1000); } }}
      onOpenChangeComplete={(o) => { if (!o) sair(); }}>
      <Dialog.Portal>
        <Dialog.Popup ref={popup} className={`luz rx-luz${entra ? " entra" : ""}${cem ? " cem" : ""}`} aria-label="Mídia em tela cheia" aria-describedby="luz-legenda" initialFocus={fechar}
          finalFocus={() => (origem.isConnected ? origem : reencontrar(itens[atual.current]?.id ?? "") ?? true)}
          onKeyDown={(ev) => {
            if ((ev.target as HTMLElement).matches?.("input[type=range]")) return;
            if (ev.key === "ArrowLeft") { ev.preventDefault(); ir(i - 1); }
            else if (ev.key === "ArrowRight") { ev.preventDefault(); ir(i + 1); }
          }}
          // Deslizar (toque): passa para o lado, se a imagem não está no tamanho real.
          onPointerDown={(ev) => { x0.current = ev.pointerType === "mouse" ? null : ev.clientX; }}
          onPointerUp={(ev) => {
            if (x0.current === null || cem) return;
            const dx = ev.clientX - x0.current;
            x0.current = null;
            if (Math.abs(dx) > 50) ir(dx < 0 ? i + 1 : i - 1);
          }}>
          {/* Clicar fora da mídia (no escuro do palco ou em volta da figura) fecha; na mídia e nos controles, não. */}
          <div className="luz-palco" data-luz="palco" onClick={naFigura}>
            <div className="luz-topo">
              {esteMac && <button type="button" className="luz-bt" data-luz="finder" aria-label="Mostrar no Finder" title="Mostrar no Finder" hidden={!temFinder(it, esteMac)}
                onClick={() => { if (temFinder(it, esteMac)) finder?.(it); }} {...svg(ICONE.pasta)} />}
              <a className="luz-bt" data-luz="baixar" href={baixarUrl(it.url)} download={it.nome} aria-label={`Baixar ${it.nome}`} title="Baixar" {...svg(ICONE.baixar)} />
              <Dialog.Close ref={fechar} className="luz-bt" data-luz="fechar" aria-label="Fechar" title="Fechar" {...svg(ICONE.fechar)} />
            </div>
            {n > 1 && <>
              <button ref={ant} type="button" className="luz-seta ant" data-luz="ant" aria-label="Anterior" hidden={i === 0} onClick={() => { const k = destinoDaSeta(i, -1, n); if (k !== null) ir(k); }} {...svg(ICONE.ant)} />
              <button ref={prox} type="button" className="luz-seta prox" data-luz="prox" aria-label="Próxima" hidden={i === n - 1} onClick={() => { const k = destinoDaSeta(i, 1, n); if (k !== null) ir(k); }} {...svg(ICONE.prox)} />
            </>}
            <div data-luz="item">
              <figure key={i} className="luz-fig" style={estiloDoItem(it)} onClick={naFigura}>
                {video
                  ? <Video it={it} aoAlternar={alternar} aoFora={naFigura} />
                  : <img className="luz-midia" src={it.url} alt={familiaWeb(it.mime) === "gif" ? `GIF: ${it.nome}` : `Imagem: ${it.nome}`} draggable="false" data-luz="midia"
                    onDoubleClick={() => setCem((c) => !c)} />}
                {legenda}
              </figure>
            </div>
          </div>
          {n > 1 && (
            <div ref={minis} className="luz-minis" role="group" aria-label="Mídias desta mensagem">
              {itens.map((x, k) => (
                <button key={`${k}-${x.id}`} type="button" className="luz-mini" data-luz-ir={k} aria-label={`${x.nome}, ${k + 1} de ${n}`} aria-current={k === i ? "true" : undefined} onClick={() => ir(k)}>
                  {familiaWeb(x.mime) === "video"
                    ? <video src={`${x.url}#t=0.1`} preload="metadata" muted playsInline tabIndex={-1} aria-hidden="true" />
                    : <img src={x.url} alt="" loading="lazy" draggable="false" />}
                </button>
              ))}
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Abre a tela cheia na mídia em que a pessoa clicou (o botão tem data-i; a lista vem do data-luz do grupo). */
export function abrirLuzNoReact(doc: Document, origem: HTMLElement, o: OpcoesLuz = {}): true | null {
  const lida = lerLuz(origem, o.indice);
  if (!lida) return null;
  doc.querySelector(".rx-luz-host")?.dispatchEvent(new CustomEvent("rx-fechar"));
  const host = doc.createElement("div");
  host.className = "rx-luz-host";
  host.dataset["rxModal"] = "";
  doc.body.append(host);
  const raiz = createRoot(host, { identifierPrefix: "luz-" });
  let saiu = false;
  const sair = (): void => { if (saiu) return; saiu = true; queueMicrotask(() => { raiz.unmount(); host.remove(); }); };
  host.addEventListener("rx-fechar", sair, { once: true });
  const esteMac = o.finder ? lembrancaDaMidia.esteMac : null;
  raiz.render(
    <StrictMode>
      <Luz itens={lida.itens} inicio={lida.i} esteMac={esteMac} finder={o.finder} origem={origem} reencontrar={(id) => reencontrarMidia(doc, lida.casa, id)} sair={sair} />
    </StrictMode>,
  );
  return true;
}
