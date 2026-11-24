import { useEffect, useState, type ReactNode } from "react";
import type { CasoProblemaDto, EventoLinhaDto, PainelPessoaDto, PainelUsoDto, PessoaRefDto, ProblemaRankDto, ResumoPessoaDto } from "../../../src/contracts/admin-uso.ts";

/**
 * Painel admin de uso (definido em 2026-11-23, ADR-193): página à parte (/admin.html), só leitura. Quem decide se a
 * pessoa é admin é o servidor; aqui, um 404 vira "Página não encontrada", sem dizer que o painel existe.
 * Rotas por hash: `#/` é o painel; `#/pessoa/<tenant>/<pessoa>` é a tela de uma pessoa.
 */

export class NaoEncontrado extends Error {}

export type ApiAdmin = {
  painel: (dias: number) => Promise<PainelUsoDto>;
  pessoa: (tenantId: string, pessoaId: string, dias: number) => Promise<PainelPessoaDto>;
};

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "same-origin", headers: { accept: "application/json" } });
  if (r.status === 404 || r.status === 401) throw new NaoEncontrado();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** A API de verdade: a sessão diz o tenant da pessoa logada; as rotas admin ficam sob ele. */
export function apiDoServidor(): ApiAdmin {
  let base: Promise<string> | null = null;
  const prefixo = () => (base ??= json<{ tenantId: string }>("/api/sessao").then((s) => `/api/t/${encodeURIComponent(s.tenantId)}/admin`));
  return {
    painel: async (dias) => json(`${await prefixo()}/uso?dias=${dias}`),
    pessoa: async (tid, pid, dias) => json(`${await prefixo()}/uso/pessoas/${encodeURIComponent(tid)}/${encodeURIComponent(pid)}?dias=${dias}`),
  };
}

type Rota = { tipo: "painel" } | { tipo: "pessoa"; tenantId: string; pessoaId: string };

export function lerRota(hash: string): Rota {
  const m = /^#\/pessoa\/([^/]+)\/([^/]+)$/.exec(hash);
  return m ? { tipo: "pessoa", tenantId: decodeURIComponent(m[1]!), pessoaId: decodeURIComponent(m[2]!) } : { tipo: "painel" };
}

const linkPessoa = (p: Pick<PessoaRefDto, "tenantId" | "pessoaId">) => `#/pessoa/${encodeURIComponent(p.tenantId)}/${encodeURIComponent(p.pessoaId)}`;
const JANELAS = [7, 30, 90] as const;

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const fmtN = (n: number) => numero.format(n);
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
const fmtData = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const fmtDia = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const fmtHoras = (h: number | null) => (h === null ? "—" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${fmtN(h)} h` : `${fmtN(h / 24)} d`);
const curto = (id: string) => id.slice(0, 8);

export function PainelAdmin({ api }: { api: ApiAdmin }) {
  const [rota, setRota] = useState<Rota>(() => lerRota(location.hash));
  const [dias, setDias] = useState<number>(30);
  useEffect(() => {
    const ouvir = () => setRota(lerRota(location.hash));
    addEventListener("hashchange", ouvir);
    return () => removeEventListener("hashchange", ouvir);
  }, []);
  return (
    <div className="adm">
      <header className="adm-topo">
        <div>
          <h1 className="ds-titulo-1">Uso do nod</h1>
          <p className="ds-corpo-2 adm-sub">Só leitura · metadados e contagens, nunca o conteúdo das conversas</p>
        </div>
        <div className="adm-janela" role="group" aria-label="Janela">
          {JANELAS.map((n) => (
            <button key={n} type="button" className="adm-chip" aria-pressed={dias === n} onClick={() => setDias(n)}>
              {n} dias
            </button>
          ))}
        </div>
      </header>
      {rota.tipo === "painel" ? <TelaPainel api={api} dias={dias} /> : <TelaPessoa api={api} dias={dias} tenantId={rota.tenantId} pessoaId={rota.pessoaId} />}
    </div>
  );
}

type Carga<T> = { estado: "carregando" } | { estado: "ok"; dado: T } | { estado: "nao_encontrado" } | { estado: "erro" };

function useCarga<T>(carregar: () => Promise<T>, deps: unknown[]): Carga<T> {
  const [c, setC] = useState<Carga<T>>({ estado: "carregando" });
  useEffect(() => {
    let vivo = true;
    setC({ estado: "carregando" });
    carregar().then(
      (dado) => vivo && setC({ estado: "ok", dado }),
      (e: unknown) => vivo && setC({ estado: e instanceof NaoEncontrado ? "nao_encontrado" : "erro" }),
    );
    return () => {
      vivo = false;
    };
  }, deps);
  return c;
}

function Estado<T>({ carga, children }: { carga: Carga<T>; children: (d: T) => ReactNode }) {
  if (carga.estado === "carregando")
    return (
      <div className="adm-grade" aria-busy="true" aria-label="Carregando">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="adm-cartao ds-esqueleto adm-esqueleto" />
        ))}
      </div>
    );
  if (carga.estado === "nao_encontrado")
    return (
      <div className="adm-vazio">
        <h2 className="ds-titulo-2">Página não encontrada</h2>
      </div>
    );
  if (carga.estado === "erro")
    return (
      <div className="adm-vazio adm-erro" role="alert">
        <h2 className="ds-titulo-3">Não deu para carregar o painel</h2>
        <p className="ds-corpo-2">Recarregue a página em instantes.</p>
      </div>
    );
  return <>{children(carga.dado)}</>;
}

function TelaPainel({ api, dias }: { api: ApiAdmin; dias: number }) {
  const carga = useCarga(() => api.painel(dias), [api, dias]);
  return <Estado carga={carga}>{(p) => <Painel p={p} />}</Estado>;
}

function Kpi({ rotulo, valor, nota, tom }: { rotulo: string; valor: string; nota?: string; tom?: "perigo" | "aviso" }) {
  return (
    <div className="adm-cartao adm-kpi" data-tom={tom}>
      <span className="ds-rotulo adm-kpi-rotulo">{rotulo}</span>
      <strong className="adm-kpi-valor">{valor}</strong>
      {nota ? <span className="ds-legenda adm-kpi-nota">{nota}</span> : null}
    </div>
  );
}

/** Barras por dia, em SVG puro. O rótulo do primeiro e do último dia fica embaixo. */
function Barras({ valores, dias, rotulo }: { valores: number[]; dias: string[]; rotulo: string }) {
  const max = Math.max(1, ...valores);
  const total = valores.reduce((s, x) => s + x, 0);
  const w = 100 / Math.max(1, valores.length);
  return (
    <figure className="adm-barras">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`${rotulo}: ${total} no período`}>
        {valores.map((v, i) => (
          <rect key={dias[i] ?? i} x={i * w + w * 0.15} width={w * 0.7} y={40 - (v / max) * 38} height={(v / max) * 38} rx="0.6">
            <title>{`${fmtDia(dias[i] ?? "")}: ${v}`}</title>
          </rect>
        ))}
      </svg>
      <figcaption className="ds-legenda adm-eixo">
        <span>{dias[0] ? fmtDia(dias[0]) : ""}</span>
        <span>máx. {max}</span>
        <span>{dias.at(-1) ? fmtDia(dias.at(-1)!) : ""}</span>
      </figcaption>
    </figure>
  );
}

function Faisca({ valores }: { valores: number[] }) {
  const max = Math.max(1, ...valores);
  const n = Math.max(1, valores.length - 1);
  const pontos = valores.map((v, i) => `${(i / n) * 100},${20 - (v / max) * 18}`).join(" ");
  return (
    <svg className="adm-faisca" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pontos} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Secao({ titulo, children, nota }: { titulo: string; children: ReactNode; nota?: string }) {
  return (
    <section className="adm-secao">
      <div className="adm-secao-topo">
        <h2 className="ds-titulo-3">{titulo}</h2>
        {nota ? <span className="ds-legenda adm-nota">{nota}</span> : null}
      </div>
      {children}
    </section>
  );
}

function ListaContagem({ itens, vazio }: { itens: { nome: string; total: number }[]; vazio: string }) {
  if (itens.length === 0) return <p className="ds-corpo-2 adm-nota">{vazio}</p>;
  const max = Math.max(1, ...itens.map((i) => i.total));
  return (
    <ul className="adm-contagem">
      {itens.slice(0, 10).map((i) => (
        <li key={i.nome}>
          <span className="adm-contagem-nome">{i.nome}</span>
          <span className="adm-contagem-barra" style={{ inlineSize: `${(i.total / max) * 100}%` }} />
          <span className="adm-num">{i.total}</span>
        </li>
      ))}
    </ul>
  );
}

export function Painel({ p }: { p: PainelUsoDto }) {
  const { crescimento: c, ativacao: a, engajamento: e, saude: s } = p;
  const cadastros = c.cadastrosPorDia.reduce((x, y) => x + y, 0);
  const topo = a.funil[0]?.pessoas ?? 0;
  return (
    <main className="adm-corpo">
      <div className="adm-grade">
        <Kpi rotulo="Pessoas" valor={fmtN(c.totalPessoas)} nota={`${cadastros} novas no período`} />
        <Kpi rotulo="Ativas · 7 dias" valor={fmtN(c.ativosSemana)} nota={`${fmtN(c.ativosMes)} em 30 dias`} />
        <Kpi rotulo="Ativas hoje" valor={fmtN(c.ativosPorDia.at(-1) ?? 0)} />
        <Kpi rotulo="Com problema" valor={fmtN(s.pessoasComProblema)} tom={s.pessoasComProblema > 0 ? "aviso" : undefined} nota="no período" />
      </div>

      <Secao titulo="Crescimento">
        <div className="adm-duas">
          <div className="adm-cartao">
            <span className="ds-rotulo">Cadastros por dia</span>
            <Barras valores={c.cadastrosPorDia} dias={p.dias} rotulo="Cadastros" />
          </div>
          <div className="adm-cartao">
            <span className="ds-rotulo">Ativas por dia</span>
            <Barras valores={c.ativosPorDia} dias={p.dias} rotulo="Ativas" />
          </div>
        </div>
      </Secao>

      <Secao titulo="Ativação" nota="Só quem se cadastrou no período">
        <div className="adm-duas">
          <div className="adm-cartao">
            <span className="ds-rotulo">Funil</span>
            {topo === 0 ? (
              <p className="ds-corpo-2 adm-nota">Ninguém se cadastrou no período.</p>
            ) : (
              <ol className="adm-funil">
                {a.funil.map((f, i) => {
                  const antes = i === 0 ? f.pessoas : (a.funil[i - 1]?.pessoas ?? 0);
                  const perdeu = Math.max(0, antes - f.pessoas);
                  return (
                    <li key={f.passo}>
                      <div className="adm-funil-linha">
                        <span>{f.rotulo}</span>
                        <span className="adm-num">
                          {f.pessoas} · {pct(f.pessoas, topo)}
                        </span>
                      </div>
                      <span className="adm-funil-barra" style={{ inlineSize: `${topo ? (f.pessoas / topo) * 100 : 0}%` }} />
                      {i > 0 && perdeu > 0 ? <span className="ds-legenda adm-perda">−{perdeu} desistiram aqui</span> : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
          <div className="adm-cartao">
            <span className="ds-rotulo">Tempo desde o cadastro</span>
            <table className="adm-tabela">
              <thead>
                <tr>
                  <th scope="col">Até</th>
                  <th scope="col">Mediana</th>
                  <th scope="col">p90</th>
                  <th scope="col">Pessoas</th>
                </tr>
              </thead>
              <tbody>
                {a.tempos.map((t) => (
                  <tr key={t.passo}>
                    <td>{t.rotulo}</td>
                    <td className="adm-num">{fmtHoras(t.medianaHoras)}</td>
                    <td className="adm-num">{fmtHoras(t.p90Horas)}</td>
                    <td className="adm-num">{t.pessoas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Secao>

      <Secao titulo="Engajamento" nota="Médias entre as pessoas ativas no período">
        <div className="adm-grade">
          <Kpi rotulo="Mensagens / pessoa" valor={fmtN(e.mensagensPorPessoa)} />
          <Kpi rotulo="Respostas / pessoa" valor={fmtN(e.turnosPorPessoa)} />
          <Kpi rotulo="Tarefas / pessoa" valor={fmtN(e.tarefasPorPessoa)} />
          <Kpi rotulo="Rotinas ativas / pessoa" valor={fmtN(e.rotinasAtivasPorPessoa)} />
          <Kpi rotulo="Voltaram na 2ª semana" valor={pct(e.retencao.voltaram, e.retencao.coorte)} nota={`${e.retencao.voltaram} de ${e.retencao.coorte}`} />
        </div>
        <div className="adm-duas">
          <div className="adm-cartao">
            <span className="ds-rotulo">Tipos de bot</span>
            <ListaContagem itens={e.tiposDeBot} vazio="Nenhum bot ainda." />
          </div>
          <div className="adm-cartao">
            <span className="ds-rotulo">Apps conectados</span>
            <ListaContagem itens={e.conectores} vazio="Nenhum app conectado." />
          </div>
        </div>
      </Secao>

      <Secao titulo="Saúde" nota="Agora">
        <div className="adm-grade">
          <Kpi rotulo="Tarefas travadas" valor={fmtN(s.travadas)} tom={s.travadas > 0 ? "perigo" : undefined} />
          <Kpi rotulo="Macs sem contato" valor={fmtN(s.macsSemContato)} tom={s.macsSemContato > 0 ? "aviso" : undefined} />
        </div>
      </Secao>

      <Secao titulo="Problemas durante o uso" nota="Do mais frequente ao menos">
        {p.problemas.length === 0 ? <p className="ds-corpo-2 adm-nota">Nenhum problema no período.</p> : <Ranking problemas={p.problemas} dias={p.dias} />}
      </Secao>

      <Secao titulo="Pessoas">
        <TabelaPessoas pessoas={p.pessoas} />
      </Secao>
    </main>
  );
}

function Ids({ c }: { c: Pick<CasoProblemaDto, "conversaId" | "tarefaId" | "turnoId"> }) {
  return (
    <span className="adm-ids">
      {c.conversaId ? <code title={`conversa ${c.conversaId}`}>conv {curto(c.conversaId)}</code> : null}
      {c.tarefaId ? <code title={`tarefa ${c.tarefaId}`}>tarefa {curto(c.tarefaId)}</code> : null}
      {c.turnoId && !c.tarefaId ? <code title={`turno ${c.turnoId}`}>turno {curto(c.turnoId)}</code> : null}
    </span>
  );
}

function Ranking({ problemas, dias }: { problemas: ProblemaRankDto[]; dias: string[] }) {
  return (
    <ol className="adm-ranking">
      {problemas.map((pr) => (
        <li key={pr.chave} className="adm-cartao adm-problema">
          <details>
            <summary>
              <span className="adm-problema-nome">{pr.rotulo}</span>
              <Faisca valores={pr.tendencia} />
              <span className="adm-num" title="ocorrências">
                {pr.ocorrencias}×
              </span>
              <span className="ds-legenda adm-nota">
                {pr.pessoasAfetadas} {pr.pessoasAfetadas === 1 ? "pessoa" : "pessoas"}
              </span>
            </summary>
            <span className="ds-legenda adm-nota">
              {dias[0] ? fmtDia(dias[0]) : ""} a {dias.at(-1) ? fmtDia(dias.at(-1)!) : ""} · casos mais recentes
            </span>
            <ul className="adm-casos">
              {pr.casos.map((c, i) => (
                <li key={`${c.em}-${i}`}>
                  <span className="adm-num">{fmtData(c.em)}</span>
                  <a href={linkPessoa(c.pessoa)}>{c.pessoa.nome}</a>
                  {c.alvo ? <span className="adm-alvo">{c.alvo}</span> : null}
                  <Ids c={c} />
                </li>
              ))}
            </ul>
          </details>
        </li>
      ))}
    </ol>
  );
}

function TabelaPessoas({ pessoas }: { pessoas: ResumoPessoaDto[] }) {
  if (pessoas.length === 0) return <p className="ds-corpo-2 adm-nota">Nenhuma pessoa cadastrada.</p>;
  return (
    <div className="adm-rolagem">
      <table className="adm-tabela">
        <thead>
          <tr>
            <th scope="col">Pessoa</th>
            <th scope="col">Cadastro</th>
            <th scope="col">Último uso</th>
            <th scope="col">Mensagens</th>
            <th scope="col">Tarefas</th>
            <th scope="col">Bots</th>
            <th scope="col">Apps</th>
            <th scope="col">Rotinas</th>
            <th scope="col">Problemas</th>
          </tr>
        </thead>
        <tbody>
          {pessoas.map((x) => (
            <tr key={`${x.tenantId}:${x.pessoaId}`}>
              <td>
                <a href={linkPessoa(x)} className="adm-pessoa">
                  <span className="adm-avatar" aria-hidden="true">
                    {x.iniciais}
                  </span>
                  {x.nome}
                </a>
              </td>
              <td className="adm-num">{fmtData(x.cadastroEm)}</td>
              <td className="adm-num">{fmtData(x.ultimoUsoEm)}</td>
              <td className="adm-num">{x.mensagens}</td>
              <td className="adm-num">{x.tarefas}</td>
              <td className="adm-num">{x.bots}</td>
              <td className="adm-num">{x.apps}</td>
              <td className="adm-num">{x.rotinasAtivas}</td>
              <td className="adm-num" data-tom={x.problemas > 0 ? "aviso" : undefined}>
                {x.problemas}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TelaPessoa({ api, dias, tenantId, pessoaId }: { api: ApiAdmin; dias: number; tenantId: string; pessoaId: string }) {
  const carga = useCarga(() => api.pessoa(tenantId, pessoaId, dias), [api, dias, tenantId, pessoaId]);
  return (
    <>
      <a className="adm-voltar" href="#/">
        ← Voltar ao painel
      </a>
      <Estado carga={carga}>{(p) => <Pessoa p={p} />}</Estado>
    </>
  );
}

const ROTULO_TIPO: Record<EventoLinhaDto["tipo"], string> = {
  cadastro: "Cadastro",
  onboarding_concluido: "Onboarding",
  bot_criado: "Bot",
  app_conectado: "App",
  tarefa_criada: "Tarefa",
  tarefa_entregue: "Tarefa",
  rotina_criada: "Rotina",
  problema: "Problema",
};

export function Pessoa({ p }: { p: PainelPessoaDto }) {
  const x = p.pessoa;
  return (
    <main className="adm-corpo">
      <div className="adm-pessoa-topo">
        <span className="adm-avatar adm-avatar-g" aria-hidden="true">
          {x.iniciais}
        </span>
        <div>
          <h2 className="ds-titulo-2">{x.nome}</h2>
          <p className="ds-corpo-2 adm-nota">
            Cadastro {fmtData(x.cadastroEm)} · último uso {fmtData(x.ultimoUsoEm)} · onboarding {p.onboarding.concluidoEm ? "concluído" : (p.onboarding.etapa ?? "não começou")}
          </p>
        </div>
      </div>
      <div className="adm-grade">
        <Kpi rotulo="Dias ativos" valor={fmtN(p.diasAtivos.length)} nota="no período" />
        <Kpi rotulo="Mensagens" valor={fmtN(x.mensagens)} />
        <Kpi rotulo="Tarefas" valor={fmtN(x.tarefas)} />
        <Kpi rotulo="Bots · apps" valor={`${x.bots} · ${x.apps}`} />
        <Kpi rotulo="Problemas" valor={fmtN(x.problemas)} tom={x.problemas > 0 ? "aviso" : undefined} />
        <Kpi rotulo="Travadas · Macs calados" valor={`${x.travadas} · ${x.macsSemContato}`} tom={x.travadas + x.macsSemContato > 0 ? "perigo" : undefined} />
      </div>
      {p.problemas.length > 0 ? (
        <Secao titulo="Problemas no período">
          <ListaContagem itens={p.problemas.map((q) => ({ nome: q.rotulo, total: q.ocorrencias }))} vazio="" />
        </Secao>
      ) : null}
      <Secao titulo="Linha do tempo" nota="Do mais novo ao mais antigo">
        {p.linhaDoTempo.length === 0 ? (
          <p className="ds-corpo-2 adm-nota">Nada no período.</p>
        ) : (
          <ol className="adm-linha">
            {p.linhaDoTempo.map((ev, i) => (
              <li key={`${ev.em}-${i}`} data-tipo={ev.tipo}>
                <span className="adm-marca" aria-hidden="true" />
                <span className="adm-num adm-quando">{fmtData(ev.em)}</span>
                <span className="adm-tipo ds-legenda">{ROTULO_TIPO[ev.tipo]}</span>
                <span className="adm-ev">{ev.rotulo}</span>
                <Ids c={ev} />
              </li>
            ))}
          </ol>
        )}
      </Secao>
    </main>
  );
}
