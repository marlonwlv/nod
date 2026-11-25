import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as KeyboardEventReact, type ReactNode } from "react";
import { Mascote } from "../onboarding/pecas.tsx";
import { ROTULO } from "../../telas/acessos-do-app.ts";
import {
  chaveDaConta, fraseDeQuemPerde, LIMITE_CONTAS_POR_APP, nomeComRotulo, normalizarConta, problemaDoRotulo, quemPerde, resumoDeQuemUsa, rotuloDoNome,
  separarChave, sugestoesLivres, TAMANHO_MAXIMO_DA_CONTA, textoDoLimite,
} from "./contas.ts";
import { AvisoDeErro, IconeExterno, Logo } from "./pecas.tsx";
import { Topo } from "./vitrine.tsx";
import type { ApiDoMarketplace, AppDaVitrine, ContaDaVitrine, FotoDoMarketplace } from "./tipos.ts";

/**
 * As contas de um app (ADR-196; Paper "Apps com mais de uma conta", M1–M8). A primeira conta é o conector de sempre; cada
 * conta a mais é outro conector, liberado à parte em "Quem pode usar". Daqui a pessoa adiciona uma conta (o nome antes do
 * login, M2), acompanha o login (M3), abre o menu da linha (M5), renomeia no lugar (M6), remove com a lista de quem perde
 * o acesso (M7) e vê o limite de cinco (M8).
 */

export type PropsDasContas = {
  app: AppDaVitrine;
  foto: FotoDoMarketplace;
  api: ApiDoMarketplace;
  aoVoltar: () => void;
  aoFechar: () => void;
  aoAbrirAcessos: (conta: ContaDaVitrine) => void;
  /** Começou o login de uma conta nova: o Marketplace espera ela conectar para abrir o "Quem pode usar" dela. */
  aoAdicionar: (chave: string, rotulo: string) => void;
  aoEntrarDeNovo: (conta: ContaDaVitrine) => void;
  adicionandoInicial?: boolean | undefined;
};

/** Quem faz o login de cada app: "Continuar no Google" (Paper M2); o resto usa o nome do app. */
export function provedorDoLogin(app: Pick<AppDaVitrine, "slug" | "nome">): string {
  if (app.slug === "gmail" || app.slug.startsWith("google") || app.slug === "youtube") return "Google";
  if (app.slug.startsWith("microsoft") || app.slug.startsWith("outlook") || app.slug === "one-drive" || app.slug === "onedrive") return "Microsoft";
  return app.nome;
}

const ativa = (c: ContaDaVitrine): boolean => c.situacao === "conectado" || c.situacao === "atencao" || c.desligado;
const esperandoLogin = (c: ContaDaVitrine): boolean => c.situacao === "conectando";

function MaisOpcoes({ conta, aberto, aoAbrir, aoMontar }: { conta: ContaDaVitrine; aberto: boolean; aoAbrir: () => void; aoMontar: (b: HTMLButtonElement | null) => void }) {
  return (
    <button ref={aoMontar} type="button" className="rx-mk-mais-opcoes" aria-haspopup="menu" aria-expanded={aberto} aria-label={`Opções do ${conta.nome}`} onClick={aoAbrir}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3" fill="currentColor" /><circle cx="8" cy="8" r="1.3" fill="currentColor" /><circle cx="12.5" cy="8" r="1.3" fill="currentColor" /></svg>
    </button>
  );
}

const svgMenu = (d: string) => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const ICONE_QUEM = svgMenu("M6 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1.8 13.5c.6-2.3 2.3-3.5 4.2-3.5s3.6 1.2 4.2 3.5M11 3.2a2.4 2.4 0 0 1 0 4.6M12.6 10.3c1 .5 1.6 1.6 1.9 3.2");
const ICONE_RENOMEAR = svgMenu("M10.5 3l2.5 2.5-7 7H3.5V10z");
const ICONE_DESCONECTAR = svgMenu("M6.5 9.5l-2 2a2.1 2.1 0 0 1-3-3l2-2M9.5 6.5l2-2a2.1 2.1 0 0 1 3 3l-2 2M2.5 2.5l11 11");
const ICONE_REMOVER = svgMenu("M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5");

/** O menu da linha (Paper M5, o menu de contexto do kit K4-d). Esc ou clique fora fecha e devolve o foco ao "⋯". */
function MenuDaConta({ conta, aoFechar, aoQuem, aoRenomear, aoDesconectar, aoRemover }: { conta: ContaDaVitrine; aoFechar: () => void; aoQuem: () => void; aoRenomear: () => void; aoDesconectar: (() => void) | null; aoRemover: (() => void) | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => { ref.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, []);
  useEffect(() => {
    const fora = (ev: PointerEvent) => { if (ref.current && !ref.current.contains(ev.target as Node) && !(ev.target as Element | null)?.closest?.(".rx-mk-mais-opcoes")) aoFechar(); };
    document.addEventListener("pointerdown", fora);
    return () => document.removeEventListener("pointerdown", fora);
  }, [aoFechar]);
  const teclas = (ev: KeyboardEventReact<HTMLDivElement>) => {
    const itens = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button[role=menuitem]") ?? [])];
    const i = itens.indexOf(document.activeElement as HTMLButtonElement);
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); aoFechar(); }
    else if (ev.key === "ArrowDown") { ev.preventDefault(); itens[(i + 1) % itens.length]?.focus(); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); itens[(i - 1 + itens.length) % itens.length]?.focus(); }
    else if (ev.key === "Tab") aoFechar();
  };
  const item = (rotulo: string, icone: ReactNode, acao: () => void, perigo = false) => (
    <button type="button" role="menuitem" className={`rx-mk-conta-item${perigo ? " rx-mk-perigo" : ""}`} onClick={() => { aoFechar(); acao(); }}>{icone}<span>{rotulo}</span></button>
  );
  return (
    <div ref={ref} className="rx-mk-conta-menu" role="menu" aria-label={`Opções do ${conta.nome}`} onKeyDown={teclas}>
      {item("Quem pode usar", ICONE_QUEM, aoQuem)}
      {item("Renomear", ICONE_RENOMEAR, aoRenomear)}
      {aoDesconectar ? item("Desconectar", ICONE_DESCONECTAR, aoDesconectar) : null}
      {aoRemover ? <><span className="rx-mk-conta-sep" role="separator" />{item("Remover esta conta", ICONE_REMOVER, aoRemover, true)}</> : null}
    </div>
  );
}

/** Renomear no lugar (Paper M6): o nome do app fica fixo, a pessoa troca só o que vai entre parênteses. */
function Renomear({ app, conta, api, aoFechar }: { app: AppDaVitrine; conta: ContaDaVitrine; api: ApiDoMarketplace; aoFechar: () => void }) {
  const [valor, setValor] = useState(() => rotuloDoNome(app.nome, conta.nome));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(false);
  const entrada = useRef<HTMLInputElement | null>(null);
  const dica = useId();
  useLayoutEffect(() => { entrada.current?.focus(); entrada.current?.select(); }, []);
  const limpo = valor.trim();
  const invalido = limpo.length > 40 || /[\p{Cc}\p{Cf}()]/u.test(limpo) || (!conta.principal && !limpo);
  async function salvar(): Promise<void> {
    if (invalido || !conta.conectorId) return;
    setSalvando(true);
    setErro(false);
    try {
      await api.renomearConta(conta.conectorId, nomeComRotulo(app.nome, limpo));
      aoFechar();
    } catch {
      setErro(true);
      setSalvando(false);
    }
  }
  return (
    <li className="rx-mk-conta rx-mk-conta-editando">
      <div className="rx-mk-conta-linha">
        <Logo app={app} tamanho="media" />
        <label className="rx-mk-campo rx-mk-com-sufixo rx-mk-conta-campo">
          <span className="rx-mk-campo-fixo" aria-hidden="true">{app.nome} (</span>
          <input ref={entrada} value={valor} maxLength={40} aria-label="Nome da conta" aria-describedby={dica} aria-invalid={invalido || undefined} disabled={salvando}
            onChange={(ev) => setValor(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); void salvar(); } else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); aoFechar(); } }} />
          <span className="rx-mk-campo-fixo" aria-hidden="true">)</span>
        </label>
        <button type="button" className="rx-mk-bt rx-mk-baixo" onClick={aoFechar} disabled={salvando}>Cancelar</button>
        <button type="button" className="rx-mk-bt rx-mk-pri rx-mk-baixo" onClick={() => void salvar()} disabled={invalido || salvando} aria-busy={salvando || undefined}>{salvando ? "Salvando…" : "Salvar"}</button>
      </div>
      <p className="rx-mk-conta-nota" id={dica}>{conta.email ? `${conta.email} · ` : ""}Muda só o nome. Acessos, regras e histórico continuam valendo.</p>
      {erro ? <AvisoDeErro frase="Não deu para trocar o nome agora." mais="Tente de novo em instantes." /> : null}
    </li>
  );
}

/** O nome da conta nova antes do login (Paper M2). */
function NovaConta({ app, usadas, aoCancelar, aoContinuar }: { app: AppDaVitrine; usadas: readonly string[]; aoCancelar: () => void; aoContinuar: (rotulo: string) => void }) {
  const [valor, setValor] = useState("");
  const entrada = useRef<HTMLInputElement | null>(null);
  const ajuda = useId();
  useLayoutEffect(() => { entrada.current?.focus(); }, []);
  const problema = problemaDoRotulo(valor, usadas);
  const pode = !!valor.trim() && !problema;
  const exemplo = valor.trim() || "pessoal";
  const continuar = () => { if (pode) aoContinuar(valor.trim()); };
  return (
    <li className="rx-mk-conta rx-mk-conta-nova">
      <div className="rx-mk-conta-linha">
        <span className="rx-mk-esmaecido"><Logo app={app} tamanho="media" /></span>
        <div className="rx-mk-conta-texto">
          <b id="rx-mk-conta-nova-t">Como chamar esta conta?</b>
          <span id={ajuda}>Os bots vão ver <b>{app.nome} ({exemplo})</b>. Dá para trocar o nome depois.</span>
        </div>
      </div>
      <div className="rx-mk-conta-recuo">
        <label className={`rx-mk-campo rx-mk-sem-mostrar${problema ? " rx-mk-recusado" : ""}`}>
          <span className="rx-mk-sr">Nome da conta</span>
          <input ref={entrada} value={valor} maxLength={TAMANHO_MAXIMO_DA_CONTA} placeholder="pessoal" aria-labelledby="rx-mk-conta-nova-t" aria-describedby={ajuda} aria-invalid={!!problema || undefined}
            onChange={(ev) => setValor(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); continuar(); } else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); aoCancelar(); } }} />
        </label>
        <div className="rx-mk-sugestoes">
          {sugestoesLivres(usadas).map((s) => <button key={s} type="button" className="rx-mk-sugestao" onClick={() => { setValor(s); entrada.current?.focus(); }}>{s}</button>)}
          <span className={problema ? "rx-mk-sugestoes-erro" : "rx-mk-sugestoes-dica"} role={problema ? "alert" : undefined}>{problema ?? `Até ${TAMANHO_MAXIMO_DA_CONTA} letras`}</span>
        </div>
        <div className="rx-mk-conta-acoes">
          <button type="button" className="rx-mk-bt rx-mk-baixo" onClick={aoCancelar}>Cancelar</button>
          <button type="button" className="rx-mk-bt rx-mk-pri rx-mk-baixo" disabled={!pode} onClick={continuar}>Continuar no {provedorDoLogin(app)}<IconeExterno /></button>
        </div>
      </div>
    </li>
  );
}

/** A confirmação de "Remover esta conta" (Paper M7, o modal pequeno do kit K5-c). Até três bots e "Ver todos". */
function ConfirmarRemocao({ conta, foto, aoCancelar, aoRemover, removendo, erro }: { conta: ContaDaVitrine; foto: FotoDoMarketplace; aoCancelar: () => void; aoRemover: () => void; removendo: boolean; erro: boolean }) {
  const [todos, setTodos] = useState(false);
  const cancelar = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => { cancelar.current?.focus(); }, []);
  const perdem = quemPerde(foto.bots, conta.niveis);
  const visiveis = todos ? perdem : perdem.slice(0, 3);
  const resto = perdem.length - visiveis.length;
  const restoTodosLer = perdem.slice(3).every((b) => b.nivel === "leitura");
  const bot = (id: string) => foto.bots.find((b) => b.id === id);
  return (
    <div className="rx-mk-veu" onClick={(ev) => { if (ev.target === ev.currentTarget && !removendo) aoCancelar(); }}>
      <div className="rx-mk-alerta" role="alertdialog" aria-modal="true" aria-labelledby="rx-mk-alerta-t" aria-describedby="rx-mk-alerta-d"
        onKeyDown={(ev) => { if (ev.key === "Escape" && !removendo) { ev.preventDefault(); ev.stopPropagation(); aoCancelar(); } }}>
        <div className="rx-mk-alerta-topo">
          <h3 id="rx-mk-alerta-t">Remover o {conta.nome}?</h3>
          <button type="button" className="rx-mk-fechar" aria-label="Fechar" onClick={aoCancelar} disabled={removendo}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg></button>
        </div>
        <div className="rx-mk-alerta-corpo">
          <p id="rx-mk-alerta-d">{perdem.length > 0 ? <><b>{perdem.length === 1 ? "1 bot" : `${perdem.length} bots`}</b> {perdem.length === 1 ? "perde" : "perdem"} o acesso a {conta.email ?? "esta conta"}.</> : fraseDeQuemPerde(0, conta.email ?? "esta conta")} O nod esquece a conta; nada muda na conta em si.</p>
          {perdem.length > 0 ? (
            <ul className="rx-mk-caixa rx-mk-alerta-lista" aria-label="Quem perde o acesso">
              {visiveis.map((p) => {
                const b = bot(p.id);
                return <li key={p.id} className="rx-mk-alerta-bot">{b ? <Mascote bot={b} tamanho="sm" /> : null}<span>{p.nome}</span><small>{p.nivel === "personalizado" ? "Personalizado" : ROTULO[p.nivel]}</small></li>;
              })}
              {resto > 0 ? (
                <li className="rx-mk-alerta-mais"><span>e mais {resto} {resto === 1 ? "bot" : "bots"}{restoTodosLer ? ", todos com Ler" : ""}</span><button type="button" className="rx-mk-link" onClick={() => setTodos(true)}>Ver todos</button></li>
              ) : null}
            </ul>
          ) : null}
          <p className="rx-mk-alerta-nota">Não dá para desfazer. Para usar de novo, é preciso conectar e liberar outra vez.</p>
          {erro ? <AvisoDeErro frase="Não deu para remover a conta agora." mais="Tente de novo em instantes." /> : null}
        </div>
        <div className="rx-mk-alerta-rodape">
          <button ref={cancelar} type="button" className="rx-mk-bt rx-mk-sec" onClick={aoCancelar} disabled={removendo}>Cancelar</button>
          <button type="button" className="rx-mk-bt rx-mk-remover" onClick={aoRemover} disabled={removendo} aria-busy={removendo || undefined}>{removendo ? "Removendo…" : "Remover a conta"}</button>
        </div>
      </div>
    </div>
  );
}

export function ContasDoApp({ app, foto, api, aoVoltar, aoFechar, aoAbrirAcessos, aoAdicionar, aoEntrarDeNovo, adicionandoInicial }: PropsDasContas) {
  const contas = app.contas ?? [];
  const [adicionando, setAdicionando] = useState(!!adicionandoInicial);
  const [menu, setMenu] = useState<string | null>(null);
  const [renomeando, setRenomeando] = useState<string | null>(null);
  const [remover, setRemover] = useState<{ chave: string; removendo: boolean; erro: boolean } | null>(null);
  const botoes = useRef(new Map<string, HTMLButtonElement | null>());
  const conectadas = contas.filter(ativa).length;
  const noLimite = contas.length >= LIMITE_CONTAS_POR_APP;
  const usadas = contas.flatMap((c) => { const p = separarChave(c.chave); return p?.conta ? [p.conta] : []; });
  const segunda = contas.find((c) => !c.principal);
  // Paper M3: enquanto o login de uma conta nova não volta, a linha de adicionar sai e a nota diz o que acontece se a
  // pessoa fechar a janela.
  const novaEsperando = contas.some((c) => !c.principal && esperandoLogin(c));
  const fecharMenu = (chave: string) => { setMenu(null); botoes.current.get(chave)?.focus(); };

  async function confirmarRemocao(): Promise<void> {
    const c = contas.find((x) => x.chave === remover?.chave);
    if (!c?.conectorId || !remover) return;
    setRemover({ ...remover, removendo: true, erro: false });
    try {
      await api.removerConta(c.conectorId);
      setRemover(null);
    } catch {
      setRemover({ ...remover, removendo: false, erro: true });
    }
  }

  const contaRemover = remover ? contas.find((c) => c.chave === remover.chave) : undefined;
  return (
    <main className="rx-mk-conteudo" aria-labelledby="rx-mk-titulo">
      <Topo titulo={app.nome} conectados={null} aoFechar={aoFechar} trilha={aoVoltar} />
      <div className="rx-mk-app">
        <Logo app={app} tamanho="grande" />
        <div className="rx-mk-app-texto">
          <p className="rx-mk-app-nome">{app.nome}</p>
          <p className="rx-mk-app-desc"><span className="rx-mk-ok" aria-hidden="true">●</span> {conectadas === 1 ? "1 conta conectada" : `${conectadas} contas conectadas`}</p>
        </div>
      </div>
      <div className="rx-mk-quem">
        <h3>Contas</h3>
        <p>Cada conta é liberada à parte: um bot pode usar uma conta sem chegar nas outras.</p>
      </div>
      <ul className="rx-mk-caixa rx-mk-contas" aria-label={`Contas do ${app.nome}`}>
        {contas.map((c) => {
          if (renomeando === c.chave) return <Renomear key={c.chave} app={app} conta={c} api={api} aoFechar={() => { setRenomeando(null); botoes.current.get(c.chave)?.focus(); }} />;
          const espera = esperandoLogin(c);
          const falhouLogin = !!c.login?.falhou;
          const naoTerminou = !c.principal && !espera && !falhouLogin && c.situacao === "nao_conectado";
          let detalhe: ReactNode = c.email ?? "Pela sua conta";
          if (espera) detalhe = <><span className="rx-mk-giro rx-mk-giro-tinta" aria-hidden="true" />Esperando você entrar no {provedorDoLogin(app)}, na outra janela</>;
          else if (falhouLogin) detalhe = <span className="rx-mk-conta-falha">{c.login?.falhou}</span>;
          else if (naoTerminou) detalhe = <span className="rx-mk-conta-falha">O login não terminou</span>;
          else if (c.situacao === "atencao" && c.falha) detalhe = <><span className="rx-mk-ponto rx-mk-ponto-linha" aria-hidden="true" />{c.falha}</>;
          return (
            <li key={c.chave} className="rx-mk-conta">
              <div className="rx-mk-conta-linha">
                <span className={espera ? "rx-mk-esmaecido" : undefined}><Logo app={app} tamanho="media" /></span>
                <div className="rx-mk-conta-texto">
                  <b>{c.nome}</b>
                  <span className={espera || (c.situacao === "atencao" && c.falha) ? "rx-mk-conta-estado" : undefined} aria-live={espera ? "polite" : undefined}>{detalhe}</span>
                </div>
                {espera ? (
                  <div className="rx-mk-conta-acoes">
                    <button type="button" className="rx-mk-bt rx-mk-baixo" onClick={() => api.cancelarLogin(c.chave)}>Cancelar</button>
                    {c.login?.url ? <a className="rx-mk-bt rx-mk-sec rx-mk-baixo" href={c.login.url} target="_blank" rel="noopener noreferrer">Abrir de novo</a> : null}
                  </div>
                ) : falhouLogin || naoTerminou || c.situacao === "atencao" ? (
                  <button type="button" className="rx-mk-bt rx-mk-sec rx-mk-baixo" onClick={() => aoEntrarDeNovo(c)}>{falhouLogin ? "Tentar de novo" : "Entrar de novo"}</button>
                ) : (
                  <span className="rx-mk-conta-quem">{resumoDeQuemUsa(foto.bots, c.niveis)}</span>
                )}
                {!espera && c.conectorId ? (
                  <div className="rx-mk-conta-mais">
                    <MaisOpcoes conta={c} aberto={menu === c.chave} aoAbrir={() => setMenu(menu === c.chave ? null : c.chave)} aoMontar={(b) => { botoes.current.set(c.chave, b); }} />
                    {menu === c.chave ? (
                      <MenuDaConta conta={c} aoFechar={() => fecharMenu(c.chave)}
                        aoQuem={() => aoAbrirAcessos(c)}
                        aoRenomear={() => setRenomeando(c.chave)}
                        aoDesconectar={c.situacao === "conectado" && c.conectorId ? () => { void api.desconectar(c.conectorId!); } : null}
                        aoRemover={!c.principal ? () => setRemover({ chave: c.chave, removendo: false, erro: false }) : null} />
                    ) : null}
                  </div>
                ) : <span className="rx-mk-conta-mais" aria-hidden="true" />}
              </div>
            </li>
          );
        })}
        {novaEsperando ? null : adicionando && !noLimite ? (
          <NovaConta app={app} usadas={usadas} aoCancelar={() => setAdicionando(false)}
            aoContinuar={(rotulo) => { setAdicionando(false); aoAdicionar(chaveDaConta(app.slug, normalizarConta(rotulo)), rotulo); }} />
        ) : noLimite ? (
          <li className="rx-mk-conta rx-mk-conta-limite" aria-disabled="true">
            <div className="rx-mk-conta-linha">
              <span className="rx-mk-conta-mais-ic" aria-hidden="true">+</span>
              <div className="rx-mk-conta-texto"><b>Até {LIMITE_CONTAS_POR_APP} contas do {app.nome}</b><span>Remova uma conta para adicionar outra.</span></div>
              <span className="rx-mk-conta-quem">{textoDoLimite(contas.length)}</span>
              <span className="rx-mk-conta-mais" aria-hidden="true" />
            </div>
          </li>
        ) : (
          <li className="rx-mk-conta">
            <button type="button" className="rx-mk-conta-linha rx-mk-conta-adicionar" onClick={() => setAdicionando(true)}>
              <span className="rx-mk-conta-mais-ic" aria-hidden="true">+</span>
              <span className="rx-mk-conta-texto"><b>Adicionar outra conta</b><span>Outro {app.nome} seu, como {usadas.includes("pessoal") ? "o de um cliente" : "o pessoal ou o de um cliente"}</span></span>
              <span className="rx-mk-conta-quem" aria-label={`${contas.length} de ${LIMITE_CONTAS_POR_APP} contas`}>{textoDoLimite(contas.length)}</span>
              <span className="rx-mk-conta-mais" aria-hidden="true" />
            </button>
          </li>
        )}
      </ul>
      <p className="rx-mk-conta-nota rx-mk-conta-nota-fora">
        {novaEsperando
          ? `Fechou a janela do ${provedorDoLogin(app)} sem entrar? Nada fica guardado, e dá para tentar de novo com o mesmo nome.`
          : <>Para os bots, cada conta aparece como um app: <b>{contas[0]?.nome ?? app.nome}</b>{segunda ? <> e <b>{segunda.nome}</b></> : <> e <b>{app.nome} (pessoal)</b></>}, cada um com o seu nível.</>}
      </p>
      <div className="rx-mk-rodape">
        <button type="button" className="rx-mk-bt rx-mk-pri" onClick={aoVoltar}>Pronto</button>
      </div>
      {contaRemover && remover ? (
        <ConfirmarRemocao conta={contaRemover} foto={foto} removendo={remover.removendo} erro={remover.erro}
          aoCancelar={() => { setRemover(null); botoes.current.get(contaRemover.chave)?.focus(); }} aoRemover={() => void confirmarRemocao()} />
      ) : null}
    </main>
  );
}
