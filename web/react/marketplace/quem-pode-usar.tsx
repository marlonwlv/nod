import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { NivelPedido } from "../../lib/acessos-otimistas.ts";
import { Mascote } from "../onboarding/pecas.tsx";
import { alternar, alternarTodos, alvoDoLote, caixaDoLote, fraseDaConfirmacao, lotePedeConfirmacao, normalizar, rotuloDoAplicar, textoDaSelecao } from "./modelo.ts";
import { ROTULO } from "../../telas/acessos-do-app.ts";
import { IconeBusca, IconeSeguir, Logo, Segmentado } from "./pecas.tsx";
import { Topo } from "./vitrine.tsx";
import type { ApiDoMarketplace, AppDaVitrine, BotDaVitrine, ContaDaVitrine, FotoDoMarketplace, ReciboDoLote } from "./tipos.ts";

/**
 * "Quem pode usar o {App}?" (Paper T6) e a confirmação do lote (T6b). Um segmentado por bot (o mesmo clique de sempre,
 * POST agentes/:id/acessos), a caixinha de cada bot e a do cabeçalho em três estados, o "Aplicar aos N" (o lote,
 * POST conectores/:id/acessos/lote) e "Bots novos começam com" (o padrão do app). Ler e alterar para mais de um bot pede
 * confirmação no lugar do cabeçalho, como a barra de antes (web/telas/acessos-do-app.ts, `barraDeLote`); Esc cancela.
 * A seleção e a confirmação são da tela aberta: moram aqui, e somem com ela.
 */

type Confirmacao = { alvo: "lote"; bots: "todos" | string[] } | { alvo: "padrao" };

/**
 * definido em 2026-11-25 (Paper M4, "Quem pode usar" para dezenas de bots): até oito bots a lista é a de sempre; com mais,
 * ganha a busca, o filtro e recolhe num grupo os bots que seguem o padrão (o normal num time grande), deixando à vista
 * os que a pessoa mudou.
 */
export const LISTA_CHEIA = 8;
type Filtro = "todos" | "com_acesso" | "mudados";

/** Os bots que a lista mostra, os que ficam no grupo recolhido e as contagens do filtro. */
export function arrumarBots(bots: readonly BotDaVitrine[], niveis: Readonly<Record<string, string>>, segue: (id: string) => boolean, filtro: Filtro, busca: string, abertos: boolean): { visiveis: BotDaVitrine[]; recolhidos: BotDaVitrine[]; comAcesso: number; mudados: number } {
  const comAcesso = bots.filter((b) => (niveis[b.id] ?? "nenhum") !== "nenhum");
  const mudados = bots.filter((b) => !segue(b.id));
  const t = normalizar(busca);
  if (t) return { visiveis: bots.filter((b) => normalizar(`${b.nome} ${b.titulo}`).includes(t)), recolhidos: [], comAcesso: comAcesso.length, mudados: mudados.length };
  if (filtro === "com_acesso") return { visiveis: comAcesso, recolhidos: [], comAcesso: comAcesso.length, mudados: mudados.length };
  if (filtro === "mudados") return { visiveis: mudados, recolhidos: [], comAcesso: comAcesso.length, mudados: mudados.length };
  const recolhidos = bots.filter((b) => segue(b.id));
  return { visiveis: abertos ? [...bots] : mudados, recolhidos: abertos ? [] : recolhidos, comAcesso: comAcesso.length, mudados: mudados.length };
}

export type PropsDoQuemPodeUsar = {
  app: AppDaVitrine;
  conectorId: string | null;
  conectadoAgora: boolean;
  foto: FotoDoMarketplace;
  api: ApiDoMarketplace;
  aoVoltar: () => void;
  aoFechar: () => void;
  selecionadosIniciais?: readonly string[] | undefined;
  confirmarEscrita?: boolean | undefined;
  /** ADR-196: a conta deste "Quem pode usar" ("Gmail (pessoal)"), quando o app tem mais de uma. */
  conta?: ContaDaVitrine | undefined;
  /** O nome do app sem a conta ("Gmail"), para a frase das outras contas. */
  nomeDoApp?: string | undefined;
};

function CaixaDoCabecalho({ marcados, total, aoMudar }: { marcados: number; total: number; aoMudar: () => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const caixa = caixaDoLote(marcados, total);
  // O HTML não tem atributo para o estado misto: só a propriedade.
  useLayoutEffect(() => { if (ref.current) ref.current.indeterminate = caixa === "misto"; }, [caixa]);
  return <input ref={ref} type="checkbox" className="rx-mk-caixinha" checked={caixa === "todos"} aria-label={caixa === "todos" ? "Desmarcar todos" : "Selecionar todos"} onChange={aoMudar} />;
}

export function QuemPodeUsar({ app, conectorId, conectadoAgora, foto, api, aoVoltar, aoFechar, selecionadosIniciais, confirmarEscrita, conta, nomeDoApp }: PropsDoQuemPodeUsar) {
  const ids = foto.bots.map((b) => b.id);
  const [sel, setSel] = useState<ReadonlySet<string>>(() => new Set(selecionadosIniciais ?? []));
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(() => (confirmarEscrita ? { alvo: "lote", bots: alvoDoLote(new Set(selecionadosIniciais ?? []), ids) } : null));
  const [ocupado, setOcupado] = useState(false);
  // O recibo do último lote fica DENTRO do modal: o aviso solto da página fica por baixo do <dialog>.
  const [recibo, setRecibo] = useState<{ lote: ReciboDoLote; fase: "aplicado" | "desfazendo" | "desfeito"; frase: string } | null>(null);
  const [desconectando, setDesconectando] = useState(false);
  const liberar = useRef<HTMLButtonElement | null>(null);
  const notas = api.notas(app);
  const acessos = conectorId ? foto.acessos[conectorId] : undefined;
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [abertos, setAbertos] = useState(false);
  const cheia = foto.bots.length > LISTA_CHEIA;
  const arrumados = useMemo(
    () => arrumarBots(foto.bots, app.niveis, (id) => acessos?.seguePadrao.has(id) === true, filtro, busca, abertos || !cheia),
    [foto.bots, app.niveis, acessos, filtro, busca, abertos, cheia],
  );

  useEffect(() => { if (conectorId) api.abrirAcessos(conectorId); }, [api, conectorId]);
  useEffect(() => { if (confirmacao) liberar.current?.focus(); }, [confirmacao]);

  const marcados = ids.filter((id) => sel.has(id)).length;
  const nomeDe = (id: string): string => foto.bots.find((b) => b.id === id)?.nome ?? "";

  async function aplicar(nivel: NivelPedido, bots: "todos" | string[], confirmado: boolean): Promise<void> {
    if (!conectorId) return;
    setOcupado(true);
    try {
      const r = await api.aplicarLote(conectorId, nivel, bots, confirmado);
      setRecibo(r ? { lote: r, fase: "aplicado", frase: r.frase } : null);
      setSel(new Set());
    } finally {
      setOcupado(false);
    }
  }

  async function desfazer(): Promise<void> {
    if (!conectorId || !recibo?.lote.loteId) return;
    setRecibo({ ...recibo, fase: "desfazendo" });
    try {
      const depois = await api.desfazerLote(conectorId, recibo.lote);
      setRecibo({ ...recibo, fase: "desfeito", frase: depois ?? "Desfeito. Voltou como estava." });
    } catch {
      setRecibo({ ...recibo, fase: "aplicado", frase: `${recibo.lote.frase} Não deu para desfazer agora; tente de novo.` });
    }
  }

  async function desconectar(): Promise<void> {
    if (!conectorId) return;
    setDesconectando(true);
    try {
      await api.desconectar(conectorId);
      aoVoltar();
    } finally {
      setDesconectando(false);
    }
  }

  function noLote(nivel: NivelPedido): void {
    const alvo = alvoDoLote(sel, ids);
    if (lotePedeConfirmacao(nivel, alvo, ids.length)) { setConfirmacao({ alvo: "lote", bots: alvo }); return; }
    void aplicar(nivel, alvo, nivel === "escrita");
  }

  function noPadrao(nivel: NivelPedido): void {
    if (!conectorId) return;
    if (nivel === "escrita") { setConfirmacao({ alvo: "padrao" }); return; }
    void api.definirPadrao(conectorId, nivel, false);
  }

  function confirmar(): void {
    const c = confirmacao;
    setConfirmacao(null);
    if (!c || !conectorId) return;
    if (c.alvo === "padrao") void api.definirPadrao(conectorId, "escrita", true);
    else void aplicar("escrita", c.bots, true);
  }

  // Logo depois de conectar, a foto ainda pode trazer o estado de antes (a releitura dos conectores vem em seguida).
  const status = app.situacao === "atencao" && !conectadoAgora
    ? <><span className="rx-mk-ponto rx-mk-ponto-linha" aria-hidden="true" />{app.falha ?? "Precisa de atenção"}</>
    : app.desligado && !conectadoAgora ? "Desligado · nenhum bot usa enquanto estiver assim"
    : <><span className="rx-mk-ok" aria-hidden="true">●</span> {conectadoAgora ? "Conectado agora" : "Conectado"} · {app.chave ? "a chave está guardada" : conta?.email ?? "pela sua conta"}</>;
  const outrasContas = conta && (app.contas?.length ?? 0) > 1;
  const explicacao = conta && nomeDoApp
    ? `Vale só para esta conta. ${conta.principal ? `As outras contas do ${nomeDoApp}` : `O ${nomeDoApp} e as outras contas`} continuam com os acessos que já tinham.`
    : "Libere só para quem precisa. Os outros bots seguem sem acesso, e dá para mudar depois em Apps.";

  let cabecalho;
  if (confirmacao) {
    const nomes = confirmacao.alvo === "padrao" ? [] : (confirmacao.bots === "todos" ? ids : confirmacao.bots).map(nomeDe);
    const f = fraseDaConfirmacao(app.nome, confirmacao.alvo, nomes, notas.verbosDaEscrita);
    cabecalho = (
      <div className="rx-mk-confirma" role="alertdialog" aria-labelledby="rx-mk-confirma-t" aria-describedby="rx-mk-confirma-d"
        onKeyDown={(ev) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); setConfirmacao(null); } }}>
        <div className="rx-mk-confirma-texto">
          <b id="rx-mk-confirma-t">{f.titulo}</b>
          <span id="rx-mk-confirma-d">{f.detalhe}</span>
        </div>
        <button type="button" className="rx-mk-bt rx-mk-baixo" aria-keyshortcuts="Escape" onClick={() => setConfirmacao(null)}>Cancelar</button>
        <button ref={liberar} type="button" className="rx-mk-bt rx-mk-pri rx-mk-baixo" onClick={confirmar}>Liberar</button>
      </div>
    );
  } else {
    cabecalho = (
      <div className="rx-mk-lote">
        <CaixaDoCabecalho marcados={marcados} total={ids.length} aoMudar={() => setSel(alternarTodos(sel, ids))} />
        <p className="rx-mk-lote-texto" aria-live="polite">{textoDaSelecao(marcados, ids.length)}</p>
        <span className="rx-mk-lote-aplicar" id="rx-mk-aplicar">{rotuloDoAplicar(marcados)}</span>
        <Segmentado rotulo={rotuloDoAplicar(marcados).replace(":", "")} atual={null} acao ocupado={ocupado} aoEscolher={noLote} />
      </div>
    );
  }

  return (
    <main className="rx-mk-conteudo" aria-labelledby="rx-mk-titulo">
      <Topo titulo={app.nome} conectados={null} aoFechar={aoFechar} trilha={aoVoltar} />
      <div className="rx-mk-app">
        <Logo app={app} tamanho="grande" />
        <div className="rx-mk-app-texto">
          <p className="rx-mk-app-nome">{app.nome}</p>
          <p className="rx-mk-app-desc">{status}</p>
        </div>
      </div>
      <div className="rx-mk-quem">
        <h3>Quem pode usar o {app.nome}?</h3>
        <p>{outrasContas ? explicacao : "Libere só para quem precisa. Os outros bots seguem sem acesso, e dá para mudar depois em Apps."}</p>
      </div>
      {conectorId && cheia ? (
        <div className="rx-mk-filtros">
          <label className="rx-mk-busca rx-mk-busca-bots">
            <IconeBusca />
            <span className="rx-mk-sr">Buscar bots</span>
            <input type="search" value={busca} placeholder={`Buscar entre ${foto.bots.length} bots`} onChange={(ev) => setBusca(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === "Escape" && busca) { ev.preventDefault(); ev.stopPropagation(); setBusca(""); } }} />
          </label>
          <div className="segmentado rx-mk-seg rx-mk-filtro" role="group" aria-label="Mostrar">
            {([["todos", `Todos ${foto.bots.length}`], ["com_acesso", `Com acesso ${arrumados.comAcesso}`], ["mudados", `Mudados por você ${arrumados.mudados}`]] as const).map(([f, rotulo]) => (
              <button key={f} type="button" className={`seg${filtro === f ? " ativo" : ""}`} aria-pressed={filtro === f} onClick={() => { setFiltro(f); setAbertos(false); }}>{rotulo}</button>
            ))}
          </div>
        </div>
      ) : null}
      {!conectorId ? <p className="rx-mk-vazio">Ainda conferindo a conexão do {app.nome}…</p> : null}
      {conectorId && foto.bots.length === 0 ? <p className="rx-mk-vazio">Você ainda não tem bots. Quem você criar segue o padrão abaixo.</p> : null}
      {conectorId && foto.bots.length > 0 ? (
        <div className="rx-mk-caixa" role="group" aria-label={`Quem pode usar o ${app.nome}`}>
          {cabecalho}
          {arrumados.visiveis.length === 0 ? <p className="rx-mk-vazio">{busca.trim() ? `Nenhum bot para “${busca.trim()}”.` : filtro === "com_acesso" ? "Nenhum bot usa este app ainda." : "Nenhum bot mudado por você: todos seguem o padrão."}</p> : null}
          {arrumados.visiveis.map((b) => {
            const nivel = app.niveis[b.id] ?? "nenhum";
            const segue = acessos?.seguePadrao.has(b.id) === true;
            const sub = nivel === "personalizado" ? "Personalizado · ações escolhidas uma a uma" : segue ? `${b.titulo || "Seu bot"} · segue o padrão` : b.titulo || "Seu bot";
            return (
              <div key={b.id} className="rx-mk-bot">
                <input type="checkbox" className="rx-mk-caixinha" checked={sel.has(b.id)} aria-label={`Selecionar ${b.nome}`} onChange={() => setSel(alternar(sel, b.id))} />
                <Mascote bot={b} tamanho="sm" />
                <div className="rx-mk-bot-texto"><b>{b.nome}</b><span>{sub}</span></div>
                <Segmentado rotulo={`Acesso de ${b.nome}`} atual={nivel} aoEscolher={(n) => api.definirNivel(b.id, conectorId, n)} />
              </div>
            );
          })}
          {arrumados.recolhidos.length > 0 ? (
            <button type="button" className="rx-mk-bot rx-mk-recolhidos" aria-expanded={false} onClick={() => setAbertos(true)}>
              <span className="rx-mk-recolhidos-seta" aria-hidden="true"><IconeSeguir /></span>
              <span className="rx-mk-bot-texto">
                <b>{arrumados.recolhidos.length === 1 ? "1 bot segue o padrão" : `${arrumados.recolhidos.length} bots seguem o padrão`}</b>
                <span>{arrumados.recolhidos.slice(0, 4).map((b) => b.nome).join(", ")}{arrumados.recolhidos.length > 4 ? ` e mais ${arrumados.recolhidos.length - 4}` : ""}{acessos ? ` · todos em ${ROTULO[acessos.padrao]}` : ""}</span>
              </span>
              <span className="rx-mk-recolhidos-mostrar">Mostrar</span>
            </button>
          ) : null}
        </div>
      ) : null}
      {recibo ? (
        <div className="rx-mk-recibo" role="status">
          <span>{recibo.frase}</span>
          {recibo.fase !== "desfeito" && recibo.lote.loteId ? (
            <button type="button" className="rx-mk-bt rx-mk-baixo" onClick={() => void desfazer()} disabled={recibo.fase === "desfazendo"} aria-busy={recibo.fase === "desfazendo" || undefined}>{recibo.fase === "desfazendo" ? "Desfazendo…" : "Desfazer"}</button>
          ) : null}
        </div>
      ) : null}
      {conectorId ? (
        <div className="rx-mk-padrao">
          <div className="rx-mk-padrao-texto">
            <b id="rx-mk-padrao-t">Bots novos começam com</b>
            <span>Vale também para quem segue o padrão no {app.nome}.</span>
          </div>
          <Segmentado rotulo="Bots novos começam com" atual={acessos?.padrao ?? null} ocupado={!acessos} aoEscolher={noPadrao} />
        </div>
      ) : null}
      <div className="rx-mk-legenda">
        <p><b>Ler</b> {notas.ler}</p>
        <p><b>Ler e alterar</b> {notas.escrita}</p>
      </div>
      <div className="rx-mk-rodape">
        {conectorId ? <button type="button" className="rx-mk-bt rx-mk-perigo" onClick={() => void desconectar()} disabled={desconectando} aria-busy={desconectando || undefined}>{desconectando ? "Desconectando…" : `Desconectar o ${app.nome}`}</button> : null}
        <button type="button" className="rx-mk-bt rx-mk-pri" onClick={aoVoltar}>Pronto</button>
      </div>
    </main>
  );
}
