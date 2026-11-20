import { StrictMode, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { ALFINETE, EXPANDIR, FECHAR, SETA, type BotDoQuickChat } from "../../lib/quick-chat.ts";
import { criarConversor, type ConversorDeHtml } from "../html/html-em-react.tsx";

/**
 * ADR-179 (item 4): as janelas pequenas do app do Mac em React (a volta com `?janelas-react=0`): o topo do Quick Chat
 * (ADR-173, tela 10 do Paper; `htmlTopoQuickChat`) e o avatar solto na mesa (`htmlAvatarDaMesa`). O mesmo DOM do desenho
 * por string, as ações por prop. O seletor de bot segue sendo um `<select>` nativo por baixo da pílula (teclado, leitor de
 * tela e a lista do macOS de graça); o mascote é o mesmo nó entre desenhos (o conversor).
 */
export interface AcoesDoQuickChat {
  escolherBot: (id: string) => void;
  montar: (id: string) => void;
  desmontar: (id: string) => void;
  expandir: () => void;
  fechar: () => void;
}
export interface TopoDoQuickChat {
  bots: readonly BotDoQuickChat[];
  atual: string | null;
  mesa: { pode: boolean; montado: boolean };
  /** O mascote do bot na pílula (HTML pronto). */
  avatar: string;
}

const svg = (h: string) => ({ dangerouslySetInnerHTML: { __html: h } });

function useHtml() {
  const conversor = useRef<ConversorDeHtml | null>(null);
  conversor.current ??= criarConversor();
  useLayoutEffect(() => conversor.current?.fecharQuadro());
  return (h: string) => conversor.current!.converter(h);
}

function Topo({ t, acoes }: { t: TopoDoQuickChat; acoes: AcoesDoQuickChat }) {
  const html = useHtml();
  const escolhido = t.bots.find((b) => b.id === t.atual) ?? null;
  const rotuloMesa = t.mesa.montado ? "Tirar da área de trabalho" : "Montar na área de trabalho";
  return (
    <div className="qc-topo">
      <label className="qc-bot">
        {escolhido && t.avatar && <span className="qc-bot-av" aria-hidden="true">{html(t.avatar)}</span>}
        <span className="qc-bot-nome">{escolhido?.nome ?? "Escolha um bot"}</span>{html(SETA)}
        <select className="qc-bot-select" data-quick="bot" aria-label="Bot da conversa" value={escolhido ? escolhido.id : ""} onChange={(ev) => acoes.escolherBot(ev.currentTarget.value)}>
          {!escolhido && <option value="" disabled>Escolha um bot</option>}
          {t.bots.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
        </select>
      </label>
      <span className="qc-espaco" />
      {t.mesa.pode && escolhido && (
        <button type="button" className={`qc-bt${t.mesa.montado ? " ativo" : ""}`} data-id={escolhido.id} aria-pressed={t.mesa.montado} aria-label={rotuloMesa} title={rotuloMesa}
          onClick={() => (t.mesa.montado ? acoes.desmontar(escolhido.id) : acoes.montar(escolhido.id))} {...svg(ALFINETE)} />
      )}
      <button type="button" className="qc-bt" aria-label="Abrir na janela do nod" title="Abrir na janela do nod" onClick={acoes.expandir} {...svg(EXPANDIR)} />
      <button type="button" className="qc-bt" aria-label="Fechar o Quick Chat" title="Fechar (Esc)" onClick={acoes.fechar} {...svg(FECHAR)} />
    </div>
  );
}

export interface AcoesDoAvatar { abrir: (id: string) => void; tirar: (id: string) => void }

function Avatar({ bot, mascote, acoes }: { bot: { id: string; nome: string }; mascote: string; acoes: AcoesDoAvatar }) {
  const html = useHtml();
  return (
    <div className="am">
      <button type="button" className="am-bot" data-id={bot.id} aria-label={`Falar com ${bot.nome}`} title={`${bot.nome} · clique para conversar`} onClick={() => acoes.abrir(bot.id)}>{html(mascote)}</button>
      <button type="button" className="am-tirar" data-id={bot.id} aria-label={`Tirar ${bot.nome} da área de trabalho`} title="Tirar da área de trabalho" onClick={() => acoes.tirar(bot.id)}>×</button>
    </div>
  );
}

/** Um root por janela (o topo ou o avatar), no nó que o main criou; cada desenho é síncrono. */
function criarDesenho<P>(el: HTMLElement, prefixo: string, de: (p: P) => React.ReactNode): (p: P) => void {
  el.replaceChildren();
  const raiz: Root = createRoot(el, { identifierPrefix: `${prefixo}-` });
  return (p) => flushSync(() => raiz.render(<StrictMode>{de(p)}</StrictMode>));
}

export function criarTopoDoQuickChat(el: HTMLElement, acoes: AcoesDoQuickChat): (t: TopoDoQuickChat) => void {
  return criarDesenho(el, "quick-chat", (t: TopoDoQuickChat) => <Topo t={t} acoes={acoes} />);
}

export function criarAvatarDaMesa(el: HTMLElement, acoes: AcoesDoAvatar): (a: { bot: { id: string; nome: string }; mascote: string } | null) => void {
  return criarDesenho(el, "avatar-mesa", (a: { bot: { id: string; nome: string }; mascote: string } | null) => (a ? <Avatar bot={a.bot} mascote={a.mascote} acoes={acoes} /> : null));
}
