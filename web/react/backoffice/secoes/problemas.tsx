import type { ProblemaRankDto } from "../../../../src/contracts/backoffice.ts";
import { caminhoDaPessoa } from "../rotas.ts";
import { Estado, Faisca, fmtData, fmtDia, Ids, Link, Secao, useCarga, type ContextoSecao } from "../comum.tsx";

/** Seção Problemas: o ranking do mais frequente ao menos, com tendência, pessoas afetadas e os casos mais recentes. */
export function SecaoProblemas({ api, dias }: ContextoSecao) {
  const carga = useCarga(() => api.problemas(dias), [api, dias]);
  return (
    <Estado carga={carga}>
      {(p) => (
        <div className="bko-corpo">
          <Secao titulo="Problemas durante o uso" nota="Do mais frequente ao menos">
            {p.problemas.length === 0 ? <p className="ds-corpo-2 bko-nota">Nenhum problema no período.</p> : <Ranking problemas={p.problemas} dias={p.dias} />}
          </Secao>
        </div>
      )}
    </Estado>
  );
}

export function Ranking({ problemas, dias }: { problemas: ProblemaRankDto[]; dias: string[] }) {
  return (
    <ol className="bko-ranking">
      {problemas.map((pr) => (
        <li key={pr.chave} className="bko-cartao bko-problema">
          <details>
            <summary>
              <span className="bko-problema-nome">{pr.rotulo}</span>
              <Faisca valores={pr.tendencia} />
              <span className="bko-num" title="ocorrências">
                {pr.ocorrencias}×
              </span>
              <span className="ds-legenda bko-nota bko-afetadas">
                {pr.pessoasAfetadas} {pr.pessoasAfetadas === 1 ? "pessoa" : "pessoas"}
              </span>
            </summary>
            <span className="ds-legenda bko-nota">
              {dias[0] ? fmtDia(dias[0]) : ""} a {dias.at(-1) ? fmtDia(dias.at(-1)!) : ""} · casos mais recentes
            </span>
            <ul className="bko-casos">
              {pr.casos.map((c, i) => (
                <li key={`${c.em}-${i}`}>
                  <span className="bko-num">{fmtData(c.em)}</span>
                  <Link para={caminhoDaPessoa(c.pessoa)}>{c.pessoa.nome}</Link>
                  {c.alvo ? <span className="bko-alvo">{c.alvo}</span> : null}
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
