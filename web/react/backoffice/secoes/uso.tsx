import type { PainelUsoDto } from "../../../../src/contracts/backoffice.ts";
import { Barras, Estado, fmtHoras, fmtN, Kpi, ListaContagem, pct, Secao, useCarga, type ContextoSecao } from "../comum.tsx";

/** Seção Uso (padrão do backoffice): crescimento, ativação, engajamento e saúde. */
export function SecaoUso({ api, dias }: ContextoSecao) {
  const carga = useCarga(() => api.uso(dias), [api, dias]);
  return <Estado carga={carga}>{(p) => <PainelUso p={p} />}</Estado>;
}

export function PainelUso({ p }: { p: PainelUsoDto }) {
  const { crescimento: c, ativacao: a, engajamento: e, saude: s } = p;
  const cadastros = c.cadastrosPorDia.reduce((x, y) => x + y, 0);
  const topo = a.funil[0]?.pessoas ?? 0;
  return (
    <div className="bko-corpo">
      <div className="bko-grade">
        <Kpi rotulo="Pessoas" valor={fmtN(c.totalPessoas)} nota={`${cadastros} novas no período`} />
        <Kpi rotulo="Ativas · 7 dias" valor={fmtN(c.ativosSemana)} nota={`${fmtN(c.ativosMes)} em 30 dias`} />
        <Kpi rotulo="Ativas hoje" valor={fmtN(c.ativosPorDia.at(-1) ?? 0)} />
        <Kpi rotulo="Com problema" valor={fmtN(s.pessoasComProblema)} tom={s.pessoasComProblema > 0 ? "aviso" : undefined} nota="no período" />
      </div>

      <Secao titulo="Crescimento">
        <div className="bko-duas">
          <div className="bko-cartao">
            <span className="ds-rotulo">Cadastros por dia</span>
            <Barras valores={c.cadastrosPorDia} dias={p.dias} rotulo="Cadastros" />
          </div>
          <div className="bko-cartao">
            <span className="ds-rotulo">Ativas por dia</span>
            <Barras valores={c.ativosPorDia} dias={p.dias} rotulo="Ativas" />
          </div>
        </div>
      </Secao>

      <Secao titulo="Ativação" nota="Só quem se cadastrou no período">
        <div className="bko-duas">
          <div className="bko-cartao">
            <span className="ds-rotulo">Funil</span>
            {topo === 0 ? (
              <p className="ds-corpo-2 bko-nota">Ninguém se cadastrou no período.</p>
            ) : (
              <ol className="bko-funil">
                {a.funil.map((f, i) => {
                  const antes = i === 0 ? f.pessoas : (a.funil[i - 1]?.pessoas ?? 0);
                  const perdeu = Math.max(0, antes - f.pessoas);
                  return (
                    <li key={f.passo}>
                      <div className="bko-funil-linha">
                        <span>{f.rotulo}</span>
                        <span className="bko-num">
                          {f.pessoas} · {pct(f.pessoas, topo)}
                        </span>
                      </div>
                      <span className="bko-funil-barra" style={{ inlineSize: `${topo ? (f.pessoas / topo) * 100 : 0}%` }} />
                      {i > 0 && perdeu > 0 ? <span className="ds-legenda bko-perda">−{perdeu} desistiram aqui</span> : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
          <div className="bko-cartao">
            <span className="ds-rotulo">Tempo desde o cadastro</span>
            <div className="bko-rolagem-interna">
              <table className="bko-tabela">
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
                      <td className="bko-num">{fmtHoras(t.medianaHoras)}</td>
                      <td className="bko-num">{fmtHoras(t.p90Horas)}</td>
                      <td className="bko-num">{t.pessoas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Secao>

      <Secao titulo="Engajamento" nota="Médias entre as pessoas ativas no período">
        <div className="bko-grade">
          <Kpi rotulo="Mensagens / pessoa" valor={fmtN(e.mensagensPorPessoa)} />
          <Kpi rotulo="Respostas / pessoa" valor={fmtN(e.turnosPorPessoa)} />
          <Kpi rotulo="Tarefas / pessoa" valor={fmtN(e.tarefasPorPessoa)} />
          <Kpi rotulo="Rotinas ativas / pessoa" valor={fmtN(e.rotinasAtivasPorPessoa)} />
          <Kpi rotulo="Voltaram na 2ª semana" valor={pct(e.retencao.voltaram, e.retencao.coorte)} nota={`${e.retencao.voltaram} de ${e.retencao.coorte}`} />
        </div>
        <div className="bko-duas">
          <div className="bko-cartao">
            <span className="ds-rotulo">Tipos de bot</span>
            <ListaContagem itens={e.tiposDeBot} vazio="Nenhum bot ainda." />
          </div>
          <div className="bko-cartao">
            <span className="ds-rotulo">Apps conectados</span>
            <ListaContagem itens={e.conectores} vazio="Nenhum app conectado." />
          </div>
        </div>
      </Secao>

      <Secao titulo="Saúde" nota="Agora">
        <div className="bko-grade">
          <Kpi rotulo="Tarefas travadas" valor={fmtN(s.travadas)} tom={s.travadas > 0 ? "perigo" : undefined} />
          <Kpi rotulo="Macs sem contato" valor={fmtN(s.macsSemContato)} tom={s.macsSemContato > 0 ? "aviso" : undefined} />
        </div>
      </Secao>
    </div>
  );
}
