import { useLayoutEffect, useRef } from "react";
import type { Estado } from "../../estado/reducer.ts";
import { iconeAgente } from "../../lib/render.ts";
import { criarConversor, type ConversorDeHtml } from "../html/html-em-react.tsx";
import type { Loja } from "../loja.ts";
import { useLoja } from "../use-loja.ts";

/**
 * ADR-179 (as telas no lugar da conversa): a nova conversa (Novo bot) em React. O mesmo DOM da tela por string
 * (web/telas/novo-bot.ts, `renderNovoBot`, o caminho de volta com `?telas-react=0`); as ações são props. O campo "Para:"
 * fica sem controle do React (o texto, o acento e o cursor são do navegador) e o filtro das linhas e as setas seguem com
 * o main, sobre o DOM (`filtrarBots` em `.contact-picker`): `aoDesenhar` o refaz depois de cada desenho, para a linha
 * de um bot que chegou num frame entrar já filtrada.
 */
export interface AcoesDoNovoBot {
  abrirConversa: (conversaId: string, agenteId: string) => void;
  fechar: () => void;
  /** "Criar o bot “<termo>”" (o termo é o do campo "Para:"). */
  criar: () => void;
  novoChatEmGrupo: () => void;
  enviar: () => void;
  aoDesenhar: () => void;
}

const SVG_FECHAR = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
const SVG_GRUPO = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M3 3h10a1 1 0 011 1v6.5a1 1 0 01-1 1H7.5L4.5 14v-2.5H3a1 1 0 01-1-1V4a1 1 0 011-1z"/></svg>';
const SVG_MAIS = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';
const SVG_MIC = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><rect x="6" y="2" width="4" height="8" rx="2"/><path d="M3.5 8a4.5 4.5 0 009 0M8 12.5V14"/></svg>';
const SVG_ENVIAR = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V3.5M4 7.5l4-4 4 4"/></svg>';
const MASCOTE_DO_NOD = iconeAgente({ nome: "nod", cor: "c-black", forma: "shape-pebble" }, "lg");

export function TelaNovoBot({ loja, acoes }: { loja: Loja<Estado>; acoes: AcoesDoNovoBot }) {
  const frota = useLoja(loja, (e) => e.frota);
  const conversor = useRef<ConversorDeHtml | null>(null);
  conversor.current ??= criarConversor();
  useLayoutEffect(() => {
    conversor.current?.fecharQuadro();
    acoes.aoDesenhar();
  });
  const html = (h: string) => conversor.current!.converter(h);
  const bots = (frota?.agentes ?? []).filter((a) => a.confirmado !== false);
  return (
    <section className="tela novo-contato nc-paper">
      <div className="nc-para">
        <label htmlFor="busca-destinatario">Para:</label>
        <input id="busca-destinatario" aria-label="Para: buscar ou criar bots" aria-controls="nc-sugestoes" autoComplete="off" spellCheck={false} />
        <button type="button" className="nc-fechar" aria-label="Fechar a nova conversa" title="Fechar (Esc)" onClick={acoes.fechar} dangerouslySetInnerHTML={{ __html: SVG_FECHAR }} />
      </div>
      <div className="contact-picker nc-pop" id="nc-sugestoes" role="listbox" aria-label="Sugestões">
        {bots.map((a) => {
          const sub = [a.titulo, a.ultimaMensagem?.previa].filter(Boolean).join(" · ");
          return (
            <button key={a.id} type="button" className="picker-row nc-bot" role="option" data-busca={`${a.nome} ${a.titulo ?? ""}`.toLowerCase()}
              data-conversa={a.conversaId} data-agente={a.id} onClick={() => acoes.abrirConversa(a.conversaId, a.id)}>
              {html(iconeAgente(a, "sm"))}
              <span className="nc-txt"><b>{a.nome}</b>{sub && <small>{sub}</small>}</span>
              <kbd className="ds-kbd nc-enter" aria-hidden="true">↵</kbd>
            </button>
          );
        })}
        <div className="nc-sep" role="separator" />
        <button type="button" className="picker-row nc-acao nc-criar" onClick={acoes.criar}>
          <span className="nc-ic nc-ic-mais" aria-hidden="true">＋</span><span className="nc-txt"><span>Criar o bot “<span className="nc-termo" />”</span></span><span className="nc-dica">Novo bot</span>
        </button>
        <button type="button" className="picker-row nc-acao" onClick={acoes.novoChatEmGrupo}>
          <span className="nc-ic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: SVG_GRUPO }} /><span className="nc-txt"><span>Novo chat em grupo</span></span>
        </button>
      </div>
      <div className="nc-vazio" aria-hidden="true">{html(MASCOTE_DO_NOD)}<b>Nova conversa</b><span>Escolha um bot ou digite um nome para criar um.</span></div>
      <div className="nc-campo composer">
        <div className="box">
          <span className="mais-campo nc-mais" aria-hidden="true" dangerouslySetInnerHTML={{ __html: SVG_MAIS }} />
          <textarea id="nc-texto" rows={1} placeholder="Mensagem para o bot" aria-label="Mensagem para o bot escolhido" />
          <span className="mic nc-mic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: SVG_MIC }} />
          <button type="button" className="send" aria-label="Enviar para o bot escolhido" onClick={acoes.enviar} dangerouslySetInnerHTML={{ __html: SVG_ENVIAR }} />
        </div>
      </div>
    </section>
  );
}
