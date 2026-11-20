import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { Estado } from "../../estado/reducer.ts";
import { avatarAgente, dataHora } from "../../lib/render.ts";
import { botaoDaParada, desdeDaParada, linhaDaEspera, linhaNaoRodaram, linhaOndeRoda, linhaPerguntaPendente, motivoDaExecucao, rotuloDoDesfecho, rotuloExecucao, rotuloVerEspera, TAG_ESPERANDO, tagDaParada, tagEsperaDaCota, tagParadaPergunta } from "../../lib/execucao.ts";
import { interpolar } from "../../lib/relogio.ts";
import { avisoDasJanelasPuladas, introDasRotinas } from "../../telas/rotinas.ts";
import { criarConversor, type ConversorDeHtml } from "../html/html-em-react.tsx";
import type { Loja } from "../loja.ts";
import { igualRaso, useLoja } from "../use-loja.ts";

/**
 * ADR-179 (as telas no lugar da conversa): Rotinas em React. O mesmo DOM da tela por string (web/telas/rotinas.ts,
 * `renderRotinas`, o caminho de volta com `?telas-react=0`). A estrutura e os botões da rotina são componentes, com as
 * ações por prop; os pedaços que `web/lib/execucao.ts` monta para várias telas (a parada, a espera, onde roda, a tag da
 * cota) entram pelo conversor da ADR-189 — sem caixa a mais —, e as ações de dentro deles seguem pela delegação do main
 * até `execucao.ts` virar componente.
 */
export interface AcoesDeRotinas {
  pausar: (id: string) => void;
  ativar: (id: string) => void;
  /** `botao`: o "Testar agora" (o diálogo "rodar mais uma" abre junto dele). */
  testar: (id: string, agenteId: string, botao: HTMLElement) => void;
  alternarExecucoes: (id: string) => void;
  abrirConversa: (conversaId: string, agenteId: string) => void;
  verPergunta: (conversaId: string, agenteId: string, decisaoId: string) => void;
  novaRotina: () => void;
}

type Pedaco = Pick<Estado, "rotinas" | "frota" | "execucoes" | "agora" | "ocupado">;
const pedaco = (e: Estado): Pedaco => ({ rotinas: e.rotinas, frota: e.frota, execucoes: e.execucoes, agora: e.agora, ocupado: e.ocupado });
type Rotina = Estado["rotinas"][number];
type Execucao = NonNullable<Estado["execucoes"][string]>[number];

export function TelaRotinas({ loja, acoes }: { loja: Loja<Estado>; acoes: AcoesDeRotinas }) {
  const e = useLoja(loja, pedaco, igualRaso);
  const conversor = useRef<ConversorDeHtml | null>(null);
  conversor.current ??= criarConversor();
  useLayoutEffect(() => conversor.current?.fecharQuadro());
  const html = (h: string): ReactNode => (h ? conversor.current!.converter(h) : null);
  return (
    <section className="tela tela-rotinas">
      <header className="tela-cab">
        <h1>Rotinas</h1><span className="chip">{e.rotinas.length} rotinas</span>
        <button type="button" className="bt pri" onClick={acoes.novaRotina}>+ Nova rotina</button>
      </header>
      {html(introDasRotinas(e.rotinas))}
      {e.rotinas.length
        ? <ul className="lista">{e.rotinas.map((x) => <LinhaDaRotina key={x.rotina.id} x={x} e={e} acoes={acoes} html={html} />)}</ul>
        : <p className="mudo">Nenhuma rotina. Diga na conversa do bot, por exemplo: «todo dia útil às 8:00 de São Paulo poste aqui um resumo dos PRs abertos». O bot propõe; você confirma em Sua vez.</p>}
    </section>
  );
}

function LinhaDaRotina({ x, e, acoes, html }: { x: Rotina; e: Pedaco; acoes: AcoesDeRotinas; html: (h: string) => ReactNode }) {
  const { rotina: r, proximaExecucao, bloqueio, espera, perguntaPendente, esperaDaCota, janelasPuladas, ondeRoda } = x;
  const a = e.frota?.agentes.find((y) => y.id === r.agenteId);
  const exec = e.execucoes[r.id];
  // definido em 2026-09-24 (emenda da ADR-044): a janela parada lê "parada (sem acesso)", sem o motivo cru ao lado.
  const rotulo = (ex: Execucao) => (ex.desfecho === "bloqueada" || ex.desfecho === "nao_rodou" ? rotuloExecucao(ex, r.fusoIana) : rotuloDoDesfecho(ex.desfecho));
  const motivo = (ex: Execucao) => (ex.motivo && ex.desfecho !== "bloqueada" && ex.desfecho !== "nao_rodou" ? ` · ${motivoDaExecucao(ex) ?? ex.motivo}` : "");
  const tag = bloqueio ? tagDaParada(bloqueio) : perguntaPendente ? tagParadaPergunta(perguntaPendente) : esperaDaCota ? tagEsperaDaCota(esperaDaCota, r.fusoIana, e.agora) : "";
  const parada = !!(bloqueio || perguntaPendente);
  return (
    <li className={`rotina rotina-${r.estado}${parada ? " rotina-parada" : ""}`} data-rotina={r.id}>
      <div className="rt-cab">
        {a && html(avatarAgente(a, "sm"))}<b>{a?.nome ?? "agente"}</b>{" · "}<code>{r.cron}</code>{` (${r.fusoIana}) `}
        <span className={`tag ${r.estado === "ativa" ? "tag-ok" : "tag-cinza"}`}>{r.estado}</span>
        {html(tag)}
        {r.estado === "ativa" && !bloqueio && !perguntaPendente && !esperaDaCota && espera && html(TAG_ESPERANDO)}
        {r.exigeAprovacao && <span className="tag tag-ambar" title="efeito externo só por item aprovado (E7.3)">gate de aprovação ligado</span>}
      </div>
      <div className="rt-linha"><b>próxima execução:</b>{` ${dataHora(proximaExecucao, r.fusoIana)} (${r.fusoIana}) · ${interpolar(proximaExecucao, e.agora)}`}</div>
      {html(linhaOndeRoda(ondeRoda))}
      {html(avisoDasJanelasPuladas(r.estado === "ativa" && !espera ? janelasPuladas : undefined))}
      <div className="rt-linha"><b>instrução:</b>{` ${r.instrucao}`}</div>
      <div className="rt-linha mudo">{`fonte: ${r.fonte} · entregável: ${r.entregavel} · limites: ${r.limitesAprovacao} · sem dado: ${r.politicaSemDado}`}</div>
      {bloqueio ? <><div className="rt-linha">{`Parada ${desdeDaParada(bloqueio, e.agora)}.`}</div>{html(linhaNaoRodaram(bloqueio, e.agora))}</>
        : perguntaPendente ? html(linhaPerguntaPendente(perguntaPendente, e.agora, r.fusoIana)) : null}
      {r.estado === "ativa" && !parada && html(linhaDaEspera(espera ?? null, e.agora, r.fusoIana))}
      <div className="acoes">
        {bloqueio ? html(botaoDaParada(bloqueio))
          : perguntaPendente ? <button type="button" className="bt pri" data-id={perguntaPendente.decisaoId} data-conversa={r.conversaId} data-agente={r.agenteId}
            onClick={() => acoes.verPergunta(r.conversaId, r.agenteId, perguntaPendente.decisaoId)}>{rotuloVerEspera(perguntaPendente)}</button> : null}
        {r.estado === "ativa"
          ? <button type="button" className="bt" data-id={r.id} onClick={() => acoes.pausar(r.id)}>Pausar</button>
          : <button type="button" className={parada ? "bt" : "bt pri"} data-id={r.id} onClick={() => acoes.ativar(r.id)}>Ativar</button>}
        <button type="button" className="bt" data-id={r.id} data-agente={r.agenteId} disabled={e.ocupado} onClick={(ev) => acoes.testar(r.id, r.agenteId, ev.currentTarget)}>Testar agora</button>
        <button type="button" className="bt" data-id={r.id} onClick={() => acoes.alternarExecucoes(r.id)}>{exec ? "atualizar execuções" : "últimas 20 execuções"}</button>
        <button type="button" className="bt" data-conversa={r.conversaId} data-agente={r.agenteId} onClick={() => acoes.abrirConversa(r.conversaId, r.agenteId)}>conversa</button>
      </div>
      {exec && (exec.length
        ? <ul className="execucoes">{exec.map((ex, i) => (
          <li key={`${ex.instanteAgendado}-${i}`} className={`exec exec-${ex.desfecho}`}><b>{rotulo(ex)}</b>{` · agendada ${dataHora(ex.instanteAgendado, r.fusoIana)} · registrada ${dataHora(ex.em, r.fusoIana)}${motivo(ex)}`}</li>
        ))}</ul>
        : <p className="mudo">nunca executou</p>)}
    </li>
  );
}
