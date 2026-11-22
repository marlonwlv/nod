import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import type { DonoDto } from "../../../src/contracts/dono.ts";
import type { Estado, MostrarTarefas } from "../../estado/reducer.ts";
import { temDonos } from "../../lib/dono.ts";
import { avatarDoBot } from "../../lib/mascote.ts";
import { hora, iconeAgente } from "../../lib/render.ts";
import { aberto, agrupar, filtrar, meiaNoiteDe, naFilaDaCota, pilulaDaCota, textoNaFilaDaCota, tituloCurto } from "../../lib/trabalhos.ts";
import { quemPediu } from "../../lib/dono.ts";
import { agente } from "../../telas/trabalhos.ts";
import {
  botsDaNovaTarefa, contasDoBot, esperasDaConversa, GRUPOS_DO_BOT, GRUPOS_DO_ESTADO, ICONE_DO_GRUPO, iconeDaTarefa, linhasDosBots, origemNaTela,
  passoDaTarefa, plural, prontas, trabalhosDaTela, SETA_CIMA, SETA_DIREITA, SETA_MENU, TAREFAS_A_VISTA, tarefasDoBot, tempoDaTarefa, tempoDoBot, tituloDoBot, type LinhaDoBot, type TelaTarefas,
} from "../../telas/tela-tarefas.ts";
import { criarConversor, type ConversorDeHtml } from "../html/html-em-react.tsx";
import type { Loja } from "../loja.ts";
import { useLoja } from "../use-loja.ts";

/**
 * ADR-179 (as telas no lugar da conversa): a tela Tarefas (ADR-187 §8; Paper 5a "Por bot" e 5b "Por estado") em React.
 * O mesmo DOM da tela por string (web/telas/tela-tarefas.ts, `renderTelaTarefas`, o caminho de volta com
 * `?telas-react=0`); as regras (quem vai em que grupo, o título, as contas, o tempo, o passo) são as funções de lá, a
 * mesma fonte das duas. As ações da tela são props; as esperas de colega (Cobrar, Desistir) e a pílula da cota entram
 * pelo conversor da ADR-189, com a ação delas na delegação do main.
 */
export interface AcoesDasTarefasDosBots {
  vista: (porEstado: boolean, bot?: string) => void;
  mostrar: (m: MostrarTarefas) => void;
  /** O "Todos os bots ▾" e o "+ Nova tarefa" abrem o menu junto do botão. */
  menuDeBots: (botao: HTMLElement) => void;
  novaTarefa: (botao: HTMLElement) => void;
  alternarBot: (agenteId: string) => void;
  abrirTrabalho: (id: string) => void;
  abrirConversa: (conversaId: string, agenteId: string) => void;
}

type Agente = NonNullable<Estado["frota"]>["agentes"][number];
type Html = (h: string) => ReactNode;

export function TelaTarefas({ loja, acoes }: { loja: Loja<Estado>; acoes: AcoesDasTarefasDosBots }) {
  const estado = useLoja(loja, (e) => e);
  const conversor = useRef<ConversorDeHtml | null>(null);
  conversor.current ??= criarConversor();
  useLayoutEffect(() => conversor.current?.fecharQuadro());
  const html: Html = (h) => (h ? conversor.current!.converter(h) : null);
  const tela: TelaTarefas = estado.tela.tipo === "trabalhos" ? estado.tela : { tipo: "trabalhos" };
  if (!estado.trabalhos) return <section className="tela-tarefas" aria-label="Tarefas"><p className="tf-vazio">carregando…</p></section>;
  const porBot = temDonos(estado) && !tela.filtro;
  const todos = trabalhosDaTela(estado).filter((t) => !tela.bot || t.agenteId === tela.bot);
  const abertas = todos.filter(aberto).length;
  const mostrar = tela.mostrar ?? "abertas";
  const bot = tela.bot ? agente(estado, tela.bot) : undefined;
  const chip = (id: MostrarTarefas, nome: ReactNode) =>
    <button key={id} type="button" className="tf-chip" aria-pressed={mostrar === id} onClick={() => acoes.mostrar(id)}>{nome}</button>;
  return (
    <section className="tela-tarefas" aria-label="Tarefas" data-vista={porBot ? "por-bot" : "por-estado"}>
      <header className="tf-cab">
        <h1>Tarefas</h1>
        {temDonos(estado) && (
          <div className="tf-vista" role="group" aria-label="Ver as tarefas">
            <button type="button" className="tf-vista-op" aria-pressed={porBot} onClick={() => acoes.vista(false)}>Por bot</button>
            <button type="button" className="tf-vista-op" aria-pressed={!porBot} onClick={() => acoes.vista(true)}>Por estado</button>
          </div>
        )}
        <span className="tf-espaco" />
        {botsDaNovaTarefa(estado).length > 0 && <button type="button" className="tf-nova" aria-haspopup="menu" onClick={(e) => acoes.novaTarefa(e.currentTarget)}>+ Nova tarefa</button>}
      </header>
      <div className="tf-filtros" role="group" aria-label="Filtrar tarefas">
        {chip("abertas", <>Abertas <span className="tf-chip-n">{abertas}</span></>)}{chip("feitas", "Feitas")}{chip("todas", "Todas")}
        <span className="tf-traco" aria-hidden="true" />
        <button type="button" className="tf-chip tf-chip-bots" aria-haspopup="menu" aria-pressed={!!bot} onClick={(e) => acoes.menuDeBots(e.currentTarget)}>{bot?.nome ?? "Todos os bots"}{html(SETA_MENU)}</button>
      </div>
      {html(pilulaDaCota(estado.trabalhos.cota, estado.trabalhos.trabalhos, estado.agora, estado.trabalhos.pedidosNaFila))}
      <div className="tf-lista">{porBot ? <PorBot estado={estado} tela={tela} acoes={acoes} html={html} /> : <PorEstado estado={estado} tela={tela} acoes={acoes} html={html} />}</div>
    </section>
  );
}

const rotuloDoGrupo = (titulo: string, n: number) => <h2 className="tf-rotulo">{`${titulo} · ${plural(n, "bot", "bots")}`}</h2>;

function PorBot({ estado, tela, acoes, html }: { estado: Estado; tela: TelaTarefas; acoes: AcoesDasTarefasDosBots; html: Html }) {
  const todos = trabalhosDaTela(estado);
  const mostrar = tela.mostrar ?? "abertas";
  const hoje = meiaNoiteDe(estado.agora);
  const { linhas: todasAsLinhas, livres: todosOsLivres } = linhasDosBots(estado);
  const linhas = todasAsLinhas.filter((l) => !tela.bot || l.bot.id === tela.bot);
  const comLinha = new Set(linhas.map((l) => l.bot.id));
  const abertoAgora = (id: string): boolean => estado.botAbertoEmTrabalhos === id;
  const secoes = mostrar === "feitas" ? [] : GRUPOS_DO_BOT.flatMap((g) => {
    const pedidos = (l: LinhaDoBot) => (estado.suaVez?.itens ?? []).filter((i) => i.decisao.agenteId === l.bot.id && i.estadoColuna !== "vencido").map((i) => Date.parse(i.decisao.criadoEm));
    const chave = (l: LinhaDoBot): number => (g.chave === "precisa" && pedidos(l).length ? Math.min(...pedidos(l)) : l.dono.estado.desde ?? 0);
    const doGrupo = linhas.filter((l) => l.grupo === g.chave).sort((a, b) => chave(a) - chave(b));
    if (!doGrupo.length) return [];
    return [(
      <section key={g.chave} className="tf-grupo" data-grupo={g.chave}>
        {rotuloDoGrupo(g.titulo, doGrupo.length)}
        <div className="tf-cartao">{doGrupo.map((x) => (
          <LinhaDoBotRx key={x.bot.id} estado={estado} b={{ bot: x.bot, grupo: x.grupo, titulo: tituloDoBot(estado, x, todos), contas: contasDoBot(estado, x, todos, hoje), tempo: tempoDoBot(estado, x) }}
            aberta={abertoAgora(x.bot.id)} acoes={acoes} html={html}>{abertoAgora(x.bot.id) && <TarefasDoBotAberto estado={estado} x={x} todos={todos} mostrar={mostrar} acoes={acoes} html={html} />}</LinhaDoBotRx>
        ))}</div>
      </section>
    )];
  });
  const feitasPorBot = mostrar === "abertas" ? [] : (estado.frota?.agentes ?? []).filter((b) => !b.excluidoEm && (!tela.bot || b.id === tela.bot) && (mostrar === "feitas" || !comLinha.has(b.id)))
    .map((bot) => ({ bot, feitas: tarefasDoBot(todos, bot.id, hoje, "feitas") })).filter((f) => f.feitas.length > 0);
  const nomesFeitas = new Set(feitasPorBot.map((f) => f.bot.id));
  const livres = mostrar === "feitas" || tela.bot ? [] : todosOsLivres.filter((b) => !nomesFeitas.has(b.id));
  const nomes = livres.map((b) => b.nome);
  return (
    <>
      {secoes}
      {feitasPorBot.length > 0 && (
        <section className="tf-grupo" data-grupo="feitas">
          {rotuloDoGrupo("Feitas hoje", feitasPorBot.length)}
          <div className="tf-cartao">{feitasPorBot.map(({ bot, feitas: lista }) => {
            const [ultima] = lista;
            const parada = lista.filter((t) => t.estado === "parado").length;
            const falhou = lista.filter((t) => t.estado === "falhou").length;
            const contas = [prontas(lista, hoje), parada ? plural(parada, "parada", "paradas") : "", falhou ? `${falhou} não terminou` : ""].filter(Boolean).join(" · ");
            const dono = estado.trabalhos?.donos?.find((d) => d.estado.agenteId === bot.id) ?? null;
            return (
              <LinhaDoBotRx key={bot.id} estado={estado} b={{ bot, grupo: "feitas", titulo: tituloCurto(ultima?.titulo ?? ""), contas, tempo: ultima ? hora(ultima.terminadoEm ?? ultima.criadoEm) : "" }}
                aberta={abertoAgora(bot.id)} acoes={acoes} html={html}>{abertoAgora(bot.id) && <TarefasDoBotAberto estado={estado} x={{ bot, dono }} todos={todos} mostrar="feitas" acoes={acoes} html={html} />}</LinhaDoBotRx>
            );
          })}</div>
        </section>
      )}
      {!secoes.length && !feitasPorBot.length && <p className="tf-vazio">{mostrar === "feitas" ? "Nenhuma tarefa terminou hoje." : tela.bot ? "Este bot não está com nada agora." : "Nenhum bot está trabalhando agora. Quando um bot começar uma tarefa, esperar algo ou precisar de você, aparece aqui."}</p>}
      {nomes.length > 0 && <p className="tf-livres">{`Livres: ${nomes.length > 12 ? `${nomes.slice(0, 11).join(", ")} e mais ${nomes.length - 11}` : nomes.join(", ")}`}</p>}
    </>
  );
}

function LinhaDoBotRx({ estado, b, aberta, acoes, html, children }: { estado: Estado; b: { bot: Agente; grupo: LinhaDoBot["grupo"] | "feitas"; titulo: string; contas: string; tempo: string }; aberta: boolean; acoes: AcoesDasTarefasDosBots; html: Html; children: ReactNode }) {
  return (
    <div className="tf-bot">
      <button type="button" className="tf-linha-bot" data-agente={b.bot.id} aria-expanded={aberta} data-grupo={b.grupo} onClick={() => acoes.alternarBot(b.bot.id)}>
        <span className="tf-ic">{html(ICONE_DO_GRUPO[b.grupo])}</span><span className="tf-av">{html(iconeAgente(b.bot, "sm", avatarDoBot(estado, b.bot)))}</span><b className="tf-nome">{b.bot.nome}</b>
        <span className="tf-titulo" title={b.titulo}>{b.titulo}</span>{b.contas && <span className="tf-contas">{b.contas}</span>}<span className="tf-tempo">{b.tempo}</span>{html(aberta ? SETA_CIMA : SETA_DIREITA)}
      </button>
      {children}
    </div>
  );
}

function TarefasDoBotAberto({ estado, x, todos, mostrar, acoes, html }: { estado: Estado; x: { bot: Agente; dono: DonoDto | null }; todos: readonly TrabalhoDto[]; mostrar: MostrarTarefas; acoes: AcoesDasTarefasDosBots; html: Html }) {
  const lista = tarefasDoBot(todos, x.bot.id, meiaNoiteDe(estado.agora), mostrar);
  const aVista = lista.length > TAREFAS_A_VISTA + 1 ? lista.slice(0, TAREFAS_A_VISTA) : lista;
  const resto = lista.slice(aVista.length);
  const lote = resto[0]?.loteId;
  const mesmoPedido = !!lote && resto.every((t) => t.loteId === lote);
  const esperas = mostrar === "feitas" || !x.dono ? "" : esperasDaConversa(estado, x.bot.id, x.dono);
  const fila = mostrar === "feitas" || !x.dono ? [] : x.dono.fila;
  const vazio = !aVista.length && !esperas && !fila.length;
  return (
    <div className="tf-tarefas-do-bot" role="group" aria-label={`Tarefas de ${x.bot.nome}`}>
      <div className="tf-trilho">
        {aVista.map((t) => <TarefaNoBot key={t.id} t={t} todos={todos} estado={estado} acoes={acoes} html={html} />)}
        {html(esperas)}
        {fila.map((p, i) => {
          // NOD-302: o pedido que a cota da IA segura diz "na fila (cota)" e quando volta.
          const cota = naFilaDaCota(estado.trabalhos, p.turnoId);
          return (
            <div key={`${p.turnoId}-${i}`} className="tf-tarefa-bot estatica" data-cota={cota ? "1" : undefined}>
              <span className="tf-ic tf-ordem" aria-hidden="true">{i + 1}</span><span className="tf-t-titulo">{`Na fila: ${quemPediu(p)}`}</span><span className="tf-t-passo">{cota ? textoNaFilaDaCota(cota, estado.agora) : ""}</span><span className="tf-tempo">{hora(p.desde)}</span>
            </div>
          );
        })}
        {vazio && <p className="tf-sub">Nenhuma tarefa aqui.</p>}
        <div className="tf-rodape">
          {resto.length > 0 && <button type="button" className="tf-mais" data-id="por-estado" data-bot={x.bot.id} onClick={() => acoes.vista(true, x.bot.id)}>{`+ ${plural(resto.length, "tarefa", "tarefas")}${mesmoPedido ? " do mesmo pedido" : ""}`}</button>}
          <button type="button" className="tf-abrir-conversa" data-conversa={x.bot.conversaId} data-agente={x.bot.id} onClick={() => acoes.abrirConversa(x.bot.conversaId, x.bot.id)}>{`Abrir a conversa com ${x.bot.nome} ›`}</button>
        </div>
      </div>
    </div>
  );
}

function TarefaNoBot({ t, todos, estado, acoes, html }: { t: TrabalhoDto; todos: readonly TrabalhoDto[]; estado: Estado; acoes: AcoesDasTarefasDosBots; html: Html }) {
  const { passo, dica } = passoDaTarefa(t, todos, estado);
  const curto = tituloCurto(t.titulo);
  return (
    <button type="button" className="tf-tarefa-bot" data-id={t.id} data-estado={t.estado} onClick={() => acoes.abrirTrabalho(t.id)}>
      <span className="tf-ic">{html(iconeDaTarefa(t))}</span>
      <span className="tf-t-titulo" title={curto === t.titulo ? undefined : t.titulo}>{curto}</span>
      <span className="tf-t-passo" title={dica || passo || undefined}>{passo}</span><span className="tf-tempo">{tempoDaTarefa(t, estado.agora)}</span>
    </button>
  );
}

function PorEstado({ estado, tela, acoes, html }: { estado: Estado; tela: TelaTarefas; acoes: AcoesDasTarefasDosBots; html: Html }) {
  const todos = trabalhosDaTela(estado);
  const mostrar = tela.mostrar ?? "abertas";
  const grupos = agrupar(filtrar(todos, tela.filtro).filter((t) => !tela.bot || t.agenteId === tela.bot), estado.agora);
  const secoes = GRUPOS_DO_ESTADO.filter((g) => (mostrar === "todas" || g.mostrar === mostrar) && grupos[g.chave].length > 0);
  if (!secoes.length) {
    const vazio = mostrar === "feitas" ? "Nenhuma tarefa terminou hoje." : tela.bot || (tela.filtro && tela.filtro !== "todos") ? "Nada com este filtro agora." : "Nenhum bot está trabalhando agora. Quando um bot abrir uma tarefa, rodar uma rotina ou atender um colega, aparece aqui.";
    return <p className="tf-vazio">{vazio}</p>;
  }
  return (
    <>{secoes.map((g) => (
      <section key={g.chave} className="tf-grupo" data-grupo={g.chave}>
        <h2 className="tf-rotulo">{`${g.titulo} · ${grupos[g.chave].length}`}</h2>
        <div className="tf-tarefas">{grupos[g.chave].map((t) => {
          const bot = agente(estado, t.agenteId);
          const { passo, dica } = passoDaTarefa(t, todos, estado);
          const curto = tituloCurto(t.titulo);
          const origem = origemNaTela(t);
          return (
            <button key={t.id} type="button" className="tf-tarefa" data-id={t.id} data-grupo={g.chave} onClick={() => acoes.abrirTrabalho(t.id)}>
              <span className="tf-ic">{html(iconeDaTarefa(t))}</span>
              <span className="tf-meio"><span className="tf-t-titulo" title={curto === t.titulo ? undefined : t.titulo}>{curto}</span><span className="tf-t-passo" title={dica || passo || undefined}>{passo}</span></span>
              <span className="tf-quem">{bot && html(iconeAgente(bot, "sm"))}<span>{bot?.nome ?? "bot"}</span></span>
              <span className="tf-origem">{origem && <span className="tf-origem-chip">{origem}</span>}</span>
              <span className="tf-tempo">{tempoDaTarefa(t, estado.agora)}</span>
            </button>
          );
        })}</div>
      </section>
    ))}</>
  );
}
