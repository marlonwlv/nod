import type { DefinicaoAcao } from "../../contracts/acoes.ts";
import { FERRAMENTAS_NAVEGADOR_DIRETAS } from "../../contracts/ferramentas-navegador.ts";

/**
 * O navegador do bot (ADR-190; NOD-391, ADR-135). As rotas são da dona do bot (src/adapters/http/rotas/navegador.ts).
 *
 * definido em 2026-11-20: ligar, pausar e passar o controle ainda não têm caminho no chat (Onda 4, a dos computadores).
 * A barra de endereço e as abas têm o caminho parcial pelas ferramentas do próprio bot (navegador_abrir, navegador_abas):
 * a pessoa pede na conversa e o bot faz, mas pelo controle dele, não pelas mãos dela. Ensinar é sempre a pessoa fazendo
 * com as próprias mãos: nunca pelo chat.
 */
const falta = { estado: "falta", onda: "NOD-396" } as const;

export const ACOES_NAVEGADOR = [
  { id: "navegador.operar", titulo: "Ligar, pausar, retomar, recarregar ou passar o controle do navegador de um bot", risco: "muda", cartaoNoChat: false, chat: falta },
  {
    id: "navegador.ir_para",
    titulo: "Abrir um endereço no navegador do bot com as próprias mãos",
    schema: { type: "object", properties: { url: FERRAMENTAS_NAVEGADOR_DIRETAS.navegador_abrir.properties.url }, required: ["url"], additionalProperties: false },
    risco: "muda",
    cartaoNoChat: false,
    chat: { estado: "parcial", via: { ferramenta: "navegador_abrir" }, falta: "o bot abre pela navegador_abrir com o controle dele; a barra da tela exige a pessoa no controle" },
  },
  {
    id: "navegador.trocar_aba",
    titulo: "Trocar de aba no navegador do bot com as próprias mãos",
    schema: { type: "object", properties: { aba: { type: "string", description: "O id da aba na vista (t1, t2…).", maxLength: 10 } }, required: ["aba"], additionalProperties: false },
    risco: "muda",
    cartaoNoChat: false,
    chat: { estado: "parcial", via: { ferramenta: "navegador_abas" }, falta: "o bot troca pela navegador_abas (número da aba) com o controle dele; a tela troca pelo id da aba com a pessoa no controle" },
  },
  { id: "navegador.ensinar", titulo: "Ensinar uma tarefa ao bot no navegador (começar, descartar, salvar)", risco: "muda", cartaoNoChat: false, chat: { estado: "nunca", motivo: "ensinar é a pessoa fazendo com as próprias mãos no navegador do bot; o que vai ao chat é a mensagem dela com os passos" } },
] as const satisfies readonly DefinicaoAcao[];
