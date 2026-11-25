import { StrictMode, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { IaDaLigacao } from "../../../src/contracts/voz.ts";
import { pontoDoAviso, type TomDoAviso } from "../../lib/aviso-estado.ts";
import type { MotivoAvaliacaoLigacao } from "../../lib/ligacao-protocolo.ts";
import { plataformaDaTela } from "../../lib/plataforma-da-tela.ts";
import { duracaoRelogio } from "../../lib/relogio.ts";
import { iconeAgente } from "../../lib/render.ts";
import type { InstantaneoDaLigacao } from "../../telas/ligacao-controle.ts";
import { logoDaIa, semIaNaTela, textoIaVoltou, type BotaoSemIa } from "../../telas/ligacao-sem-ia.ts";
import { botDoAviso, estadoDoMascote, ICONE_LIGACAO, LEGENDAS_NA_TELA, MOTIVOS, textoFase, type AvaliacaoLigacao, type CardJanela, type EstadoTelaLigacao } from "../../telas/ligacao.ts";
import { criarConversor, type ConversorDeHtml } from "../html/html-em-react.tsx";
import { MARCA_REGIAO } from "../regioes.tsx";

/**
 * ADR-179 (item 4): a região `#ligacao` em React (a volta com `?ligacao-react=0`). O mesmo DOM do desenho por string
 * (`partesDaLigacao`, `renderAvaliacao`, `renderRecusa`, a rede de segurança de web/telas/ligacao-sem-ia.ts): as mesmas
 * classes, ids e papéis, os botões com as ações por prop (sem a ação delegada do main). O controlador (web/telas/ligacao-controle.ts)
 * segue dono do estado e do motor; a tela lê o instantâneo dele e assina as mudanças, com o 1º desenho e cada mudança
 * síncronos (`flushSync`): o foco que o controlador põe logo depois (Encolher, Expandir) acha o botão já no documento.
 * O cronômetro e a contagem da janela andam por redesenho a cada segundo; o mascote é o mesmo nó (o conversor).
 */
export interface AcoesDaLigacao {
  encolher: () => void;
  expandir: () => void;
  alternarMudo: () => void;
  alternarTeclado: () => void;
  abrirAjustes: (ancora: HTMLElement) => void;
  desligar: () => void;
  decidir: (decisaoId: string, aprovar: boolean) => void;
  retomarAudio: () => void;
  enviarTexto: (texto: string) => boolean;
  continuarCom: (ia: IaDaLigacao) => void;
  iaNoMac: (ia: IaDaLigacao, acao: "entrar" | "instalar") => void;
  semVoz: () => void;
  avaliar: (nota: "boa" | "ruim") => void;
  motivo: (m: MotivoAvaliacaoLigacao) => void;
  fecharAvaliacao: () => void;
  fecharRecusa: () => void;
  /** O aviso de microfone negado (no app): abre Privacidade › Microfone do sistema. */
  ajustesDoMicrofone: () => void;
}
export interface FonteDaLigacao {
  instantaneo: () => InstantaneoDaLigacao;
  assinar: (f: () => void) => () => void;
}

type Html = (h: string) => ReactNode;

function AvisoDeEstado({ html, tom, titulo, texto, papel, classe, acao, extra }: { html: Html; tom: TomDoAviso; titulo?: string; texto: string; papel?: "alert" | "status"; classe?: string; acao?: ReactNode; extra?: ReactNode }) {
  return (
    // A mesma marcação de avisoDeEstado (web/lib/aviso-estado.ts): cabeça com o ponto, texto, extra e a linha de botões.
    <div className={`aviso-estado tom-${tom}${classe ? ` ${classe}` : ""}`} role={papel}>
      {titulo
        ? <><div className="aviso-estado-cab">{html(pontoDoAviso(tom))}<b className="aviso-estado-tit">{titulo}</b></div><p className="aviso-estado-txt">{texto}</p></>
        : <div className="aviso-estado-cab">{html(pontoDoAviso(tom))}<p className="aviso-estado-txt">{texto}</p></div>}
      {extra}
      {acao && <div className="aviso-estado-acoes">{acao}</div>}
    </div>
  );
}

function BotaoRedondo({ lig, icone, rotulo, pressionado, ativo, classe, onClick, html }: { lig: string; icone: string; rotulo: string; pressionado?: boolean; ativo?: boolean; classe?: string; onClick: (el: HTMLButtonElement) => void; html: Html }) {
  const extra = classe ?? (ativo ? "ativo" : "");
  return (
    <button type="button" className={`lig-bt${extra ? ` ${extra}` : ""}`} data-lig={lig} aria-label={rotulo} title={rotulo} aria-pressed={pressionado}
      onClick={(ev) => onClick(ev.currentTarget)}>{html(icone)}</button>
  );
}

function BotaoDaRede({ b, acoes, html }: { b: BotaoSemIa; acoes: AcoesDaLigacao; html: Html }) {
  switch (b.tipo) {
    case "continuar":
      return (
        <button type="button" className={`bt ${b.primario ? "pri sm lsi-continuar" : "sm"}`} data-ia={b.ia} disabled={b.desabilitado} onClick={() => acoes.continuarCom(b.ia)}>
          {b.primario ? <><span className="lsi-logo" aria-hidden="true">{html(logoDaIa(b.ia))}</span><span>{b.rotulo}</span></> : b.rotulo}
        </button>
      );
    case "entrar":
    case "instalar":
      return <button type="button" className="bt sm" data-ia={b.ia} disabled={b.desabilitado} onClick={() => acoes.iaNoMac(b.ia, b.tipo === "entrar" ? "entrar" : "instalar")}>{b.rotulo}</button>;
    case "sem-voz":
      return <button type="button" className="bt link lsi-saida" disabled={b.desabilitado} onClick={acoes.semVoz}>{b.rotulo}</button>;
    case "desligar":
      return <button type="button" className="bt link lsi-saida" onClick={acoes.desligar}>{b.rotulo}</button>;
  }
}

function AvisoSemIa({ t, acoes, html }: { t: EstadoTelaLigacao; acoes: AcoesDaLigacao; html: Html }) {
  const v = semIaNaTela(t.semIa!, botDoAviso(t));
  const nota = v.nota ? <p className="lsi-nota" role="status">{v.nota}</p> : null;
  const extra = v.modo === "prontas"
    ? <><div className="lsi-acoes">{v.botoes.map((b, k) => <BotaoDaRede key={k} b={b} acoes={acoes} html={html} />)}</div>{v.terminal && <p className="lsi-nota">{v.terminal}</p>}{nota}</>
    : (
      <>
        {v.cards.length > 0 && (
          <div className="lsi-cards">
            {v.cards.map((c) => (
              <div key={c.ia} className="lsi-card">
                <div className="lsi-card-cab"><span className="lsi-logo" aria-hidden="true">{html(logoDaIa(c.ia))}</span><b>{c.nome}</b></div>
                <p className="lsi-card-txt">{c.texto}</p>
                {c.noTerminal && <p className="lsi-card-txt">{c.noTerminal}</p>}
                {c.acao && <BotaoDaRede b={c.acao} acoes={acoes} html={html} />}
              </div>
            ))}
          </div>
        )}
        <div className="lsi-rodape"><BotaoDaRede b={v.saida} acoes={acoes} html={html} /><span>A ligação espera enquanto você resolve.</span></div>
        {nota}
      </>
    );
  return <AvisoDeEstado html={html} tom="alerta" titulo={v.titulo} texto={v.texto} papel="alert" classe="lig-sem-ia" extra={extra} />;
}

function Aviso({ t, acoes, html }: { t: EstadoTelaLigacao; acoes: AcoesDaLigacao; html: Html }) {
  const audio = t.audioSuspenso && (
    <AvisoDeEstado html={html} tom="alerta" texto="O navegador segurou o som da ligação." classe="aviso-compacto"
      acao={<button type="button" className="bt pri sm" onClick={acoes.retomarAudio}>Ouvir</button>} />
  );
  // Esperando a escolha, o aviso da rede de segurança é o único: ele explica o silêncio e traz as saídas.
  if (t.semIa) return <><AvisoSemIa t={t} acoes={acoes} html={html} />{audio}</>;
  const v = t.iaVoltou;
  return (
    <>
      {v && (
        <div className="aviso-estado tom-info aviso-compacto lig-ia-voltou" role="status">
          <div className="aviso-estado-cab">
            {v.ia && <span className="lsi-logo" aria-hidden="true">{html(logoDaIa(v.ia))}</span>}
            <p className="aviso-estado-txt">{textoIaVoltou(v, botDoAviso(t))}</p>
          </div>
        </div>
      )}
      {t.aviso && (
        <AvisoDeEstado html={html} tom={t.aviso.tom} texto={t.aviso.texto} papel={t.aviso.tom === "erro" ? "alert" : "status"} classe="aviso-compacto"
          acao={t.aviso.ajustes ? <button type="button" className="bt pri sm" onClick={acoes.ajustesDoMicrofone}>{plataformaDaTela() === "windows" ? "Abrir Configurações" : "Abrir Ajustes"}</button> : undefined} />
      )}
      {audio}
    </>
  );
}

/** "Diga algo como" (ADR-077): cada chip manda o texto como uma vez da pessoa; sem IA, eles voltam com a ligação. */
function Sugestoes({ t, acoes }: { t: EstadoTelaLigacao; acoes: AcoesDaLigacao }) {
  if (t.semIa || !t.sugestoes.length) return null;
  return (
    <div className="lc-sugestoes"><span>Diga algo como</span>
      {t.sugestoes.map((s, k) => <button key={`${k}-${s}`} type="button" className="bt chip-sugestao" data-texto={s} onClick={() => acoes.enviarTexto(s)}>{s}</button>)}
    </div>
  );
}

function Legenda({ t, acoes }: { t: EstadoTelaLigacao; acoes: AcoesDaLigacao }) {
  const linhas = t.legendas.slice(-LEGENDAS_NA_TELA);
  const ultimaDoBot = [...linhas].reverse().find((l) => l.autor === "bot" && !l.espera)?.chave;
  return (
    <>
      {linhas.map((l) => {
        // Classes com o prefixo lc-: `.espera` e `.parcial` já são de outros componentes (interface.css).
        const classes = ["lc-fala", l.autor === "bot" ? "lc-bot" : "lc-pessoa", l.espera ? "lc-espera" : "", !l.final ? "lc-parcial" : "", l.chave === ultimaDoBot ? "lc-atual" : ""].filter(Boolean).join(" ");
        return <p key={l.chave} className={classes}>{l.texto}</p>;
      })}
      <Sugestoes t={t} acoes={acoes} />
    </>
  );
}

/** O card da janela de aprovação: a frase, a contagem e os botões que também valem por clique. */
function CardDaJanela({ card, nomeBot, acoes }: { card: CardJanela | null; nomeBot: string; acoes: AcoesDaLigacao }) {
  if (!card) return null;
  const d = card.decisao;
  const pergunta = d?.tipo === "pergunta" || d?.tipo === "falta_de_dado" || d?.tipo === "permissao";
  return (
    <section className="ligacao-janela" aria-label="Aprovação durante a ligação">
      <div className="lj-cab"><b>{pergunta ? "Pergunta" : "Aprovação"}</b><span className="lj-contagem" id="ligacao-contagem">{`${card.restanteS}s`}</span></div>
      <p className="lj-frase">{d ? d.frase : `${nomeBot} pediu uma aprovação.`}</p>
      {d && (pergunta
        ? <p className="lj-dica">Responda falando ou pelo teclado.</p>
        : <><p className="lj-dica">Diga “eu aprovo” ou “recuso”.</p><div className="lj-acoes">
          <button type="button" className="bt " data-id={d.id} onClick={() => acoes.decidir(d.id, false)}>Recusar</button>
          <button type="button" className="bt pri" data-id={d.id} onClick={() => acoes.decidir(d.id, true)}>Aprovar</button>
        </div></>)}
    </section>
  );
}

function Teclado({ t, acoes, html }: { t: EstadoTelaLigacao; acoes: AcoesDaLigacao; html: Html }) {
  const campo = useRef<HTMLInputElement>(null);
  // Abriu o teclado: o foco vai para o campo (como no desenho por string).
  useLayoutEffect(() => campo.current?.focus(), []);
  return (
    <form className="lc-teclado" onSubmit={(ev) => {
      ev.preventDefault();
      const c = campo.current;
      if (c && acoes.enviarTexto(c.value)) c.value = "";
      c?.focus();
    }}>
      <input ref={campo} id="ligacao-texto" name="texto" maxLength={2000} autoComplete="off" placeholder={`Escreva para ${t.agente.nome}…`} aria-label={`Mensagem para ${t.agente.nome} durante a ligação`} />
      <button type="submit" className="bt pri" aria-label="Enviar">{html(ICONE_LIGACAO.enviar())}</button>
    </form>
  );
}

function Onda({ t }: { t: EstadoTelaLigacao }) {
  const quem = t.quemFala === "bot" ? `${t.agente.nome} falando` : t.quemFala === "pessoa" ? "Você falando" : "Em silêncio";
  return <span className={`lp-onda${t.quemFala ? ` fala-${t.quemFala}` : ""}`} role="img" aria-label={quem}><i /><i /><i /><i /><i /></span>;
}

function Ligacao({ t, card, acoes, html }: { t: EstadoTelaLigacao; card: CardJanela | null; acoes: AcoesDaLigacao; html: Html }) {
  const nome = t.agente.nome;
  const relogio = duracaoRelogio(t.agora - t.desde);
  const mudo = <BotaoRedondo lig="mudo" html={html} icone={t.mudo ? ICONE_LIGACAO.microfoneMudo() : ICONE_LIGACAO.microfone()} rotulo={t.mudo ? "Ligar o microfone" : "Desligar o microfone"} pressionado={t.mudo} ativo={t.mudo} onClick={acoes.alternarMudo} />;
  const desligar = <BotaoRedondo lig="desligar" html={html} icone={ICONE_LIGACAO.desligar()} rotulo="Desligar" classe="desligar" onClick={acoes.desligar} />;
  const aviso = <Aviso t={t} acoes={acoes} html={html} />;
  const cardJanela = <CardDaJanela card={card} nomeBot={nome} acoes={acoes} />;
  if (t.modo === "cheia") {
    return (
      <div className="ligacao-cheia" role="dialog" aria-modal="true" aria-label={`Ligação com ${nome}`}>
        <div className="lc-topo"><BotaoRedondo lig="encolher" html={html} icone={ICONE_LIGACAO.encolher()} rotulo="Encolher a ligação (Esc)" onClick={acoes.encolher} /></div>
        <div className="lc-identidade">
          <div id="ligacao-mascote" className="lc-mascote">{html(iconeAgente(t.agente, "xxl", estadoDoMascote(t)))}</div>
          <div id="ligacao-info" className="lc-info"><span className="lc-nome">{nome}</span><span className="lc-relogio" data-ligacao-relogio="">{relogio}</span><span className="lc-estado">{textoFase(t.fase, t.rotulo)}</span></div>
        </div>
        <div id="ligacao-aviso" className="lc-aviso">{aviso}</div>
        <div id="ligacao-legenda" className="lc-legenda" aria-live="polite"><Legenda t={t} acoes={acoes} /></div>
        <div id="ligacao-card" className="lc-card">{cardJanela}</div>
        <div id="ligacao-teclado" className="lc-teclado-wrap">{t.teclado && !t.semIa && <Teclado t={t} acoes={acoes} html={html} />}</div>
        <div id="ligacao-controles" className="lc-controles">
          <div className="lc-grupo">
            {mudo}
            <BotaoRedondo lig="teclado" html={html} icone={ICONE_LIGACAO.teclado()} rotulo={t.teclado ? "Fechar o teclado" : "Escrever durante a ligação"} pressionado={t.teclado} ativo={t.teclado} onClick={acoes.alternarTeclado} />
            <BotaoRedondo lig="ajustes" html={html} icone={ICONE_LIGACAO.ajustes()} rotulo="Ajustes da voz" onClick={acoes.abrirAjustes} />
          </div>
          {desligar}
        </div>
      </div>
    );
  }
  return (
    <div className="ligacao-pilula" role="region" aria-label={`Ligação com ${nome}`}>
      <div className="lp-barra">
        <div id="ligacao-mascote" className="lp-mascote">{html(iconeAgente(t.agente, "sm", estadoDoMascote(t)))}</div>
        <div id="ligacao-info" className="lp-info"><span className="lp-nome">{nome}</span><span className="lp-relogio" data-ligacao-relogio="">{relogio}</span><Onda t={t} /></div>
        <div id="ligacao-controles" className="lp-controles">
          {mudo}
          <BotaoRedondo lig="expandir" html={html} icone={ICONE_LIGACAO.expandir()} rotulo="Abrir a ligação em tela cheia" onClick={acoes.expandir} />
          {desligar}
        </div>
      </div>
      <div id="ligacao-aviso" className="lp-aviso">{aviso}</div>
      <div id="ligacao-card" className="lp-card">{cardJanela}</div>
      <div id="ligacao-legenda" className="lp-sugestoes"><Sugestoes t={t} acoes={acoes} /></div><div id="ligacao-teclado" hidden />
    </div>
  );
}

/** "Como foi a ligação?" (protótipo HiFiMac): 👍/👎 e, no 👎, o motivo. */
function Avaliacao({ a, acoes, html }: { a: AvaliacaoLigacao; acoes: AcoesDaLigacao; html: Html }) {
  return (
    <section className="ligacao-avaliacao" role="status" aria-label="Como foi a ligação">
      <div className="la-cab">{html(ICONE_LIGACAO.fone(15))}<b>{`Ligação com ${a.agenteNome} · ${duracaoRelogio(a.duracaoMs)}`}</b>
        <button type="button" className="bt la-fechar" aria-label="Fechar" onClick={acoes.fecharAvaliacao}>{html(ICONE_LIGACAO.fechar())}</button></div>
      {a.motivoFim && <p className="la-motivo">{a.motivoFim}</p>}
      {a.passo === "nota"
        ? <div className="la-pergunta">Como foi a ligação?<span>
          <button type="button" className="bt la-nota" data-nota="boa" aria-label="Foi boa" onClick={() => acoes.avaliar("boa")}>{html(ICONE_LIGACAO.bom())}</button>
          <button type="button" className="bt la-nota" data-nota="ruim" aria-label="Foi ruim" onClick={() => acoes.avaliar("ruim")}>{html(ICONE_LIGACAO.ruim())}</button>
        </span></div>
        : a.passo === "motivo"
          ? <><div className="la-pergunta">O que atrapalhou?</div><div className="la-motivos">{MOTIVOS.map((m) => <button key={m.id} type="button" className="bt chip-sugestao" data-motivo={m.id} onClick={() => acoes.motivo(m.id)}>{m.rotulo}</button>)}</div></>
          : <p className="la-obrigado">Obrigado. Isso ajuda a melhorar as ligações.</p>}
    </section>
  );
}

function Recusa({ texto, acoes, html }: { texto: string; acoes: AcoesDaLigacao; html: Html }) {
  return (
    <div className="ligacao-recusa">
      <AvisoDeEstado html={html} tom="alerta" texto={texto} papel="status"
        acao={<button type="button" className="bt la-fechar" aria-label="Fechar" onClick={acoes.fecharRecusa}>{html(ICONE_LIGACAO.fechar())}</button>} />
    </div>
  );
}

function TelaDaLigacao({ fonte, acoes }: { fonte: FonteDaLigacao; acoes: AcoesDaLigacao }) {
  const assinar = useRef((f: () => void) => fonte.assinar(() => flushSync(f))).current;
  const { t, card, avaliacao, recusa } = useSyncExternalStore(assinar, fonte.instantaneo, fonte.instantaneo);
  const conversor = useRef<ConversorDeHtml | null>(null);
  conversor.current ??= criarConversor();
  useLayoutEffect(() => conversor.current?.fecharQuadro());
  const html: Html = (h) => conversor.current!.converter(h);
  if (t) return <Ligacao t={t} card={card} acoes={acoes} html={html} />;
  if (avaliacao) return <Avaliacao a={avaliacao} acoes={acoes} html={html} />;
  if (recusa) return <Recusa texto={recusa.texto} acoes={acoes} html={html} />;
  return null;
}

/** Monta a tela da ligação na região `#ligacao` (vazia: o controlador já tirou o desenho por string). */
export function montarLigacaoNoReact(raiz: HTMLElement, fonte: FonteDaLigacao, acoes: AcoesDaLigacao): Root {
  raiz.setAttribute(MARCA_REGIAO, "ligacao");
  const r = createRoot(raiz, { identifierPrefix: "ligacao-" });
  flushSync(() => r.render(<StrictMode><TelaDaLigacao fonte={fonte} acoes={acoes} /></StrictMode>));
  return r;
}
