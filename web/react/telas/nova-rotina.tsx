import type { Estado } from "../../estado/reducer.ts";
import type { Loja } from "../loja.ts";
import { igualRaso, useLoja } from "../use-loja.ts";

/**
 * ADR-179 (as telas no lugar da conversa): Nova rotina em React. O mesmo DOM da tela por string
 * (web/telas/nova-rotina.ts, `renderNovaRotina`, o caminho de volta com `?telas-react=0`). O formulário não leva
 * `data-form`: o envio é prop (`criar`, com o próprio formulário, que o main lê como sempre), e o envio delegado do
 * main não o pega uma segunda vez. Os campos ficam sem controle do React (o que a pessoa escreveu fica entre desenhos).
 */
export interface AcoesDaNovaRotina {
  criar: (form: HTMLFormElement) => void;
  cancelar: () => void;
  criarBot: () => void;
}

const FREQUENCIAS: readonly [string, string][] = [["intervalo:5", "A cada 5 minutos"], ["intervalo:15", "A cada 15 minutos"], ["intervalo:30", "A cada 30 minutos"], ["hora", "A cada hora"], ["1-5", "Dias úteis"], ["*", "Todos os dias"], ["1", "Toda segunda-feira"], ["5", "Toda sexta-feira"]];
const FUSOS = ["America/Sao_Paulo", "America/Manaus", "Europe/Lisbon", "UTC"];

type Pedaco = Pick<Estado, "frota" | "sessao"> & { agenteId: string | undefined };

export function TelaNovaRotina({ loja, acoes }: { loja: Loja<Estado>; acoes: AcoesDaNovaRotina }) {
  const e = useLoja(loja, (x): Pedaco => ({ frota: x.frota, sessao: x.sessao, agenteId: x.tela.tipo === "nova-rotina" ? x.tela.agenteId : undefined }), igualRaso);
  const agenteId = e.agenteId;
  const bots = (e.frota?.agentes ?? []).filter((a) => a.ownerId === e.sessao?.pessoaId && a.confirmado);
  return (
    <section className="tela tela-formulario">
      <div className="eyebrow">DEIXE O RECORRENTE COM SEUS BOTS</div>
      <header className="tela-cab"><h1>Nova rotina</h1></header>
      <p className="intro">Escolha o bot e quando ele deve trabalhar. O resultado chega na conversa dele.</p>
      {bots.length ? (
        <form className="form" onSubmit={(ev) => { ev.preventDefault(); acoes.criar(ev.currentTarget); }}>
          <label>Bot responsável<select name="agenteId" defaultValue={bots.some((a) => a.id === agenteId) ? agenteId : bots[0]?.id}>{bots.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}</select></label>
          <label>O que ele deve fazer?<textarea name="instrucao" rows={3} placeholder="Prepare um resumo das prioridades da semana" required /></label>
          <div className="form-dupla">
            <label>Frequência<select name="frequencia" defaultValue="1-5">{FREQUENCIAS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select></label>
            <label>Horário<input type="time" name="horario" defaultValue="09:00" required /></label>
          </div>
          <label>Fuso horário<input name="fusoIana" defaultValue="America/Sao_Paulo" required list="fusos" /><datalist id="fusos">{FUSOS.map((f) => <option key={f} value={f} />)}</datalist></label>
          <label>Fonte de informação<input name="fonte" defaultValue="Contexto da conversa e memória do bot" required /></label>
          <label>Resultado esperado<input name="entregavel" defaultValue="Resumo nesta conversa" required /></label>
          <details><summary>Limites e falta de dados</summary>
            <label>Antes de agir fora do nod<input name="limitesAprovacao" defaultValue="Pedir aprovação antes de qualquer ação externa" required /></label>
            <label>Se faltar informação<input name="politicaSemDado" defaultValue="Avisar que faltam dados, sem inventar resultados" required /></label>
          </details>
          <p className="mudo">As rotinas rodam enquanto o nod e esta máquina estiverem ligados. Você pode pausar ou testar a qualquer momento.</p>
          <div className="acoes"><button className="bt pri" type="submit">Criar rotina</button><button type="button" className="bt" onClick={acoes.cancelar}>Cancelar</button></div>
        </form>
      ) : (
        <><p>Crie um bot com perfil completo para programar uma rotina.</p><button type="button" className="bt pri" onClick={acoes.criarBot}>Criar bot</button></>
      )}
    </section>
  );
}
