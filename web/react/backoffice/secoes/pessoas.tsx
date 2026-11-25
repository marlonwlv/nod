import type { EventoLinhaDto, PainelPessoaDto, ResumoPessoaDto } from "../../../../src/contracts/backoffice.ts";
import { caminhoDaPessoa, caminhoDaSecao } from "../rotas.ts";
import { Estado, fmtData, fmtN, Ids, Kpi, Link, ListaContagem, Secao, useCarga, type ContextoSecao } from "../comum.tsx";

/** Seção Pessoas: a lista (com o resumo de uso de cada uma) e, por caminho, a tela de uma pessoa. */
export function SecaoPessoas({ api, dias }: ContextoSecao) {
  const carga = useCarga(() => api.pessoas(dias), [api, dias]);
  return (
    <Estado carga={carga}>
      {(p) => (
        <div className="bko-corpo">
          <Secao titulo="Pessoas" nota={`${p.pessoas.length} no total`}>
            <TabelaPessoas pessoas={p.pessoas} />
          </Secao>
        </div>
      )}
    </Estado>
  );
}

const COLUNAS: { rotulo: string; valor: (x: ResumoPessoaDto) => string | number; tom?: (x: ResumoPessoaDto) => "aviso" | undefined }[] = [
  { rotulo: "Cadastro", valor: (x) => fmtData(x.cadastroEm) },
  { rotulo: "Último uso", valor: (x) => fmtData(x.ultimoUsoEm) },
  { rotulo: "Mensagens", valor: (x) => x.mensagens },
  { rotulo: "Tarefas", valor: (x) => x.tarefas },
  { rotulo: "Bots", valor: (x) => x.bots },
  { rotulo: "Apps", valor: (x) => x.apps },
  { rotulo: "Rotinas", valor: (x) => x.rotinasAtivas },
  { rotulo: "Problemas", valor: (x) => x.problemas, tom: (x) => (x.problemas > 0 ? "aviso" : undefined) },
];

export function TabelaPessoas({ pessoas }: { pessoas: ResumoPessoaDto[] }) {
  if (pessoas.length === 0) return <p className="ds-corpo-2 bko-nota">Nenhuma pessoa cadastrada.</p>;
  return (
    <div className="bko-rolagem">
      <table className="bko-tabela bko-tabela-pessoas">
        <thead>
          <tr>
            <th scope="col">Pessoa</th>
            {COLUNAS.map((c) => (
              <th key={c.rotulo} scope="col">
                {c.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pessoas.map((x) => (
            <tr key={`${x.tenantId}:${x.pessoaId}`}>
              <th scope="row">
                <Link para={caminhoDaPessoa(x)} className="bko-pessoa">
                  <span className="bko-avatar" aria-hidden="true">
                    {x.iniciais}
                  </span>
                  {x.nome}
                </Link>
              </th>
              {COLUNAS.map((c) => (
                <td key={c.rotulo} className="bko-num" data-rotulo={c.rotulo} data-tom={c.tom?.(x)}>
                  {c.valor(x)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TelaPessoa({ api, dias, tenantId, pessoaId }: ContextoSecao & { tenantId: string; pessoaId: string }) {
  const carga = useCarga(() => api.pessoa(tenantId, pessoaId, dias), [api, dias, tenantId, pessoaId]);
  return (
    <>
      <Link className="bko-voltar" para={caminhoDaSecao("pessoas")}>
        ← Pessoas
      </Link>
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
    <div className="bko-corpo">
      <div className="bko-pessoa-topo">
        <span className="bko-avatar bko-avatar-g" aria-hidden="true">
          {x.iniciais}
        </span>
        <div>
          <h2 className="ds-titulo-2">{x.nome}</h2>
          <p className="ds-corpo-2 bko-nota">
            Cadastro {fmtData(x.cadastroEm)} · último uso {fmtData(x.ultimoUsoEm)} · onboarding {p.onboarding.concluidoEm ? "concluído" : (p.onboarding.etapa ?? "não começou")}
          </p>
        </div>
      </div>
      <div className="bko-grade">
        <Kpi rotulo="Dias ativos" valor={fmtN(p.diasAtivos.length)} nota="no período" />
        <Kpi rotulo="Mensagens" valor={fmtN(x.mensagens)} />
        <Kpi rotulo="Tarefas" valor={fmtN(x.tarefas)} />
        <Kpi rotulo="Bots · apps" valor={`${x.bots} · ${x.apps}`} />
        <Kpi rotulo="Problemas" valor={fmtN(x.problemas)} tom={x.problemas > 0 ? "aviso" : undefined} />
        <Kpi rotulo="Travadas · Macs calados" valor={`${x.travadas} · ${x.macsSemContato}`} tom={x.travadas + x.macsSemContato > 0 ? "perigo" : undefined} />
      </div>
      {p.problemas.length > 0 ? (
        <Secao titulo="Problemas no período">
          <div className="bko-cartao">
            <ListaContagem itens={p.problemas.map((q) => ({ nome: q.rotulo, total: q.ocorrencias }))} vazio="" />
          </div>
        </Secao>
      ) : null}
      <Secao titulo="Linha do tempo" nota="Do mais novo ao mais antigo">
        {p.linhaDoTempo.length === 0 ? (
          <p className="ds-corpo-2 bko-nota">Nada no período.</p>
        ) : (
          <ol className="bko-linha">
            {p.linhaDoTempo.map((ev, i) => (
              <li key={`${ev.em}-${i}`} data-tipo={ev.tipo}>
                <span className="bko-marca" aria-hidden="true" />
                <span className="bko-num bko-quando">{fmtData(ev.em)}</span>
                <span className="bko-tipo ds-legenda">{ROTULO_TIPO[ev.tipo]}</span>
                <span className="bko-ev">{ev.rotulo}</span>
                <Ids c={ev} />
              </li>
            ))}
          </ol>
        )}
      </Secao>
    </div>
  );
}
