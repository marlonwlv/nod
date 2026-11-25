import { memo, useLayoutEffect, useRef } from "react";
import { criarConversor, type ConversorDeHtml } from "../html/html-em-react.tsx";
import type { ConversaNaoLida } from "../../../src/contracts/nao-lidos.ts";
import type { Estado } from "../../estado/reducer.ts";
import { assinatura } from "../../lib/assinatura.ts";
import { iconeAgente } from "../../lib/render.ts";
import { htmlDaPrevia } from "../../lib/previa-nao-lida.ts";
import { nomesDe } from "../../telas/conversa.ts";
import { CHECK, horaCurta, nomeDaConversa, quando, subtitulo } from "../../telas/nao-lidos.ts";
import { abertasPorAgente, perguntasPorAgente } from "../../telas/sua-vez.ts";
import type { Loja } from "../loja.ts";
import { igualRaso, useLoja } from "../use-loja.ts";

/**
 * ADR-179 (as telas no lugar da conversa): Não lidos em React. O mesmo DOM da tela por string (web/telas/nao-lidos.ts,
 * `renderNaoLidos`, que segue como o caminho de volta com `?telas-react=0`): as classes `nl-*` que o teclado
 * (web/lib/teclado-nao-lidos.ts) e o deslize do celular (web/lib/deslize-lida.ts) usam ficam iguais. O que muda: as ações
 * são props (sem a delegação por atributo do main), e a tela só redesenha quando um dos pedaços do estado que ela lê muda.
 */
export interface AcoesDeNaoLidos {
  abrirConversa: (conversaId: string, agenteId: string) => void;
  abrirSala: (salaId: string, conversaId: string) => void;
  marcarLida: (conversaId: string, nome: string) => void;
  marcarTudo: () => void;
}

type Pedaco = Pick<Estado, "naoLidos" | "frota" | "salas" | "agora" | "suaVez" | "sessao">;
const pedaco = (e: Estado): Pedaco => ({ naoLidos: e.naoLidos, frota: e.frota, salas: e.salas, agora: e.agora, suaVez: e.suaVez, sessao: e.sessao });

/** O HTML que já vem pronto de quem o desenha por string (a prévia formatada, o ✓), no span da própria classe. */
const Html = memo(function Html({ html, classe }: { html: string; classe: string }) {
  return <span className={classe} dangerouslySetInnerHTML={{ __html: html }} />;
});

export function TelaNaoLidos({ loja, acoes }: { loja: Loja<Estado>; acoes: AcoesDeNaoLidos }) {
  const e = useLoja(loja, pedaco, igualRaso);
  // O mascote vem do htmlMascote (o mesmo da barra): o conversor da ADR-189 o devolve como elemento, filho direto do botão
  // (o CSS o põe na grade por `.nl-abrir > .icon.mascote`), e o mesmo nó fica entre desenhos (só os atributos mudam).
  const conversor = useRef<ConversorDeHtml | null>(null);
  conversor.current ??= criarConversor();
  useLayoutEffect(() => conversor.current?.fecharQuadro());
  if (!e.naoLidos) return <div className="tela-nao-lidos"><p className="mudo">carregando…</p></div>;
  const lista = e.naoLidos.conversas;
  if (!lista.length) {
    return (
      <div className="tela-nao-lidos">
        <header className="nl-topo"><div><h1>Não lidos</h1><p>Nada novo</p></div></header>
        <div className="nl-vazio"><Html classe="nl-vazio-ic" html={CHECK} /><b>Tudo em dia</b><p>Quando um bot falar com você, aparece aqui.</p></div>
      </div>
    );
  }
  const maisAntigo = lista.reduce((min, c) => Math.min(min, c.desde), Infinity);
  // Os ajudantes da tela por string leem o Estado inteiro; aqui eles só tocam os pedaços acima.
  const estado = e as Estado;
  const decisoes = abertasPorAgente(estado);
  const perguntas = perguntasPorAgente(estado);
  const nomes = nomesDe(estado);
  return (
    <div className="tela-nao-lidos">
      <header className="nl-topo">
        <div><h1>Não lidos</h1><p>{subtitulo(lista.length, maisAntigo, e.agora)}</p></div>
        <button type="button" className="bt link sm mudo-bt nl-tudo" onClick={acoes.marcarTudo}>Marcar tudo como lido</button>
      </header>
      <ul className="nl-lista" aria-label="Conversas com mensagens novas para você">
        {lista.map((c) => <Linha key={c.conversaId} c={c} estado={estado} esperando={esperandoDe(c, decisoes, perguntas)} nomes={nomes} acoes={acoes} conversor={conversor.current!} />)}
      </ul>
      <p className="nl-kbd" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> anda · <kbd>Enter</kbd> abre · <kbd>E</kbd> marca como lido</p>
    </div>
  );
}

const esperandoDe = (c: ConversaNaoLida, decisoes: Map<string, number>, perguntas: Map<string, number>): "" | "decisao" | "pergunta" =>
  c.agenteId && (decisoes.get(c.agenteId) ?? 0) > 0 ? "decisao" : c.agenteId && (perguntas.get(c.agenteId) ?? 0) > 0 ? "pergunta" : "";

/** NOD-449: uma linha por conversa. A linha inteira abre a conversa; o ✓ aparece com o mouse ou o foco (no toque, sempre). */
function Linha({ c, estado, esperando, nomes, acoes, conversor }: { c: ConversaNaoLida; estado: Estado; esperando: "" | "decisao" | "pergunta"; nomes: Record<string, string>; acoes: AcoesDeNaoLidos; conversor: ConversorDeHtml }) {
  const agente = c.agenteId ? estado.frota?.agentes.find((a) => a.id === c.agenteId) : undefined;
  const nome = nomeDaConversa(c, estado);
  const novas = `${c.total} ${c.total === 1 ? "nova" : "novas"}`;
  const previa = htmlDaPrevia(c.mensagens, c.tipo === "sala" ? (m) => assinatura(m.autoria, nomes) : undefined);
  const marca = c.tipo === "sala" ? <span className="nl-sala" aria-hidden="true">#</span>
    : agente ? conversor.converter(iconeAgente(agente, "sm", "disponivel", esperando ? `data-aviso="${esperando}"` : ""))
      : <span className="nl-sala" aria-hidden="true" />;
  const abrir = (): void => {
    if (c.tipo === "sala" && c.salaId) acoes.abrirSala(c.salaId, c.conversaId);
    else acoes.abrirConversa(c.conversaId, c.agenteId ?? "");
  };
  return (
    <li className="nl-item" data-conversa={c.conversaId} data-nome={nome}>
      <span className="nl-deslize" aria-hidden="true" dangerouslySetInnerHTML={{ __html: `${CHECK}Lido` }} />
      <div className="nl-linha">
        <button type="button" className="nl-abrir" onClick={abrir} aria-label={`${nome}, ${novas}, ${quando(c.ultimaEm, estado.agora)}. Abrir conversa`}>
          {marca}
          <span className="nl-l1"><b>{nome}</b>{agente?.titulo && <i className="chip" title={agente.titulo}>{agente.titulo}</i>}<span className="nl-meta"><span>{novas}</span> · <time>{horaCurta(c.ultimaEm, estado.agora)}</time></span></span>
          <Html classe="nl-previa" html={previa} />
        </button>
        <button type="button" className="nl-check" data-conversa={c.conversaId} data-nome={nome} onClick={() => acoes.marcarLida(c.conversaId, nome)}
          aria-label={`Marcar ${nome} como lido`} aria-keyshortcuts="E" title="Marcar como lido · E" dangerouslySetInnerHTML={{ __html: CHECK }} />
      </div>
    </li>
  );
}
