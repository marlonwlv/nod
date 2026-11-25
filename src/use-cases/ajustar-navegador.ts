import type { ErroAjustarNavegador, ResultadoAjustarNavegador } from "../contracts/ferramentas-navegador-lugar.ts";
import type { MudancaLugarNavegador } from "../contracts/navegador-do-bot.ts";
import type { CasoNod, SaidaCasoDeUso } from "../contracts/servicos.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { subtituloDoInterruptor, sujeitoDoBot } from "../domain/navegador-lugar.ts";
import { entradaDoLugar } from "./navegador-lugar.ts";
import { lugarDoNavegador } from "./acoes/navegador.ts";
import type { Deps } from "./tipos.ts";

/**
 * ajustar_navegador (ADR-190, N; o caminho no chat de `navegador.lugar`): o mesmo executor da tela
 * (`lugarDoNavegador`, o executor de `navegador.lugar`), só para o bot do turno. Cercas, como as do ajustar_barra_lateral: o turno é do próprio bot,
 * numa conversa (ou criação) com a pessoa, e a pedido dela — não a pedido de colega nem de outra pessoa, nem com conteúdo
 * de fora no turno (ADR-026): mudar onde o navegador roda não nasce de uma página que o bot leu.
 */

const MODOS = new Set(["conversa", "criacao"]);
const RECUSA: Record<ErroAjustarNavegador, string> = {
  fora_do_turno: "ajustar_navegador só vale numa conversa com a pessoa, a pedido dela. Nada mudou.",
  entrada_invalida: "Mande ao menos um de continuar_sem_mac, maquina ou so_na_maquina. Nada mudou.",
  maquina_inexistente: "Essa máquina não está na conta da pessoa (ou não fica sempre ligada). Nada mudou: pergunte qual destas ela quer.",
};
const recusa = (erro: ErroAjustarNavegador, opcoes?: string[], instrucao?: string): SaidaCasoDeUso<ResultadoAjustarNavegador> => ({ data: { ok: false, erro, ...(opcoes ? { opcoes } : {}), instrucao: instrucao ?? RECUSA[erro] } });

export const ajustarNavegador: CasoNod<Deps, "ajustar_navegador"> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  const modo = input.plano?.modoTurno ?? turno?.origem ?? null;
  if (!turno || turno.agenteId !== input.agenteId || turno.conversaId !== input.conversaId || !modo || !MODOS.has(modo)) return recusa("fora_do_turno");
  if (turno.sobProcuracaoDe || turno.entradaConfianca !== "confiavel" || input.plano?.confiancaEntrada === "nao_confiavel" || (await deps.repos.turnos.contaminado(turno.id))) return recusa("fora_do_turno");
  const m: MudancaLugarNavegador = {};
  if (typeof input.continuar_sem_mac === "boolean") m.continuaSemMac = input.continuar_sem_mac;
  if (typeof input.so_na_maquina === "boolean") m.soNaMaquina = input.so_na_maquina;
  if (typeof input.maquina === "string") {
    const pedida = input.maquina.trim().toLowerCase();
    if (pedida === "nod") m.maquinaId = "nod";
    else if (pedida === "automatica" || pedida === "automática") m.maquinaId = null;
    else {
      const linux = (await deps.repos.maquinaTokens.vivasComPlataforma()).filter((v) => v.plataforma === "linux");
      const achadas = linux.filter((v) => v.id === input.maquina!.trim() || v.nome.trim().toLowerCase() === pedida);
      // QA-235: o nome da máquina não é único. Com duas do mesmo nome, a recusa não diz que ela não está na conta: dá o id
      // de cada uma (o bot pode mandar o id em `maquina`) e o que a pessoa vê para escolher.
      if (achadas.length > 1) {
        return recusa("maquina_inexistente", [...achadas.map((v) => `${v.nome} (${v.id})`), "nod"], `Há ${achadas.length} máquinas com o nome "${input.maquina.trim()}". Nada mudou: pergunte à pessoa qual delas e mande o id dela em maquina (o id está entre parênteses em opcoes).`);
      }
      if (achadas.length !== 1) return recusa("maquina_inexistente", [...linux.map((v) => v.nome), "nod"]);
      m.maquinaId = achadas[0]!.id;
    }
  }
  if (!Object.keys(m).length) return recusa("entrada_invalida");
  try {
    await lugarDoNavegador(deps, { agenteId: input.agenteId, mudanca: m });
  } catch (e) {
    if (e instanceof ErroDeDominio && e.codigo === "entrada_invalida") return recusa("maquina_inexistente");
    throw e;
  }
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  const { entrada } = await entradaDoLugar(deps, input.agenteId, []);
  const onde = subtituloDoInterruptor(entrada, agente ? sujeitoDoBot(agente.nome) : "Eu");
  return { data: { ok: true, onde, instrucao: "Feito. Diga à pessoa numa frase onde você continua (a frase `onde`, na primeira pessoa)." } };
};
