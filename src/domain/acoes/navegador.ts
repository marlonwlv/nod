import type { DefinicaoAcao } from "../../contracts/acoes.ts";
import { FERRAMENTAS_NAVEGADOR_DIRETAS } from "../../contracts/ferramentas-navegador.ts";
import { FERRAMENTAS_NAVEGADOR_LUGAR } from "../../contracts/ferramentas-navegador-lugar.ts";

/**
 * O navegador do bot (ADR-190; NOD-391, ADR-135). As rotas são da dona do bot (src/adapters/http/rotas/navegador.ts).
 *
 * definido em 2026-11-20: ligar, pausar e passar o controle ainda não têm caminho no chat (Onda 4, a dos computadores).
 * A barra de endereço e as abas têm o caminho parcial pelas ferramentas do próprio bot (navegador_abrir, navegador_abas):
 * a pessoa pede na conversa e o bot faz, mas pelo controle dele, não pelas mãos dela. Ensinar é sempre a pessoa fazendo
 * com as próprias mãos: nunca pelo chat. O login, o código e o cofre do nod nunca vão pelo chat: são senha e código. Apagar
 * um login do cofre não tem ferramenta no chat ainda (Onda 3, conta e segurança). O lugar (onde o navegador roda com o Mac desligado, quadro N) tem o caminho vivo
 * pela `ajustar_navegador` do próprio bot, com o mesmo executor da tela (`mudarLugarDoNavegador`).
 */
const falta = { estado: "falta", onda: "NOD-396" } as const;

export const ACOES_NAVEGADOR = [
  { id: "navegador.operar", titulo: "Ligar, pausar, retomar, recarregar, voltar ou passar o controle do navegador de um bot", risco: "muda", cartaoNoChat: false, chat: falta },
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
  {
    id: "navegador.lugar",
    titulo: "Escolher onde o navegador do bot roda com o Mac desligado (continuar, numa máquina, no nod, só na máquina)",
    schema: { type: "object", properties: FERRAMENTAS_NAVEGADOR_LUGAR.ajustar_navegador.properties, required: [], additionalProperties: false },
    risco: "muda",
    cartaoNoChat: false,
    casoDeUso: "navegador.lugar",
    chat: { estado: "vivo", via: { ferramenta: "ajustar_navegador" }, contrato: "tests/integration/navegador-lugar.test.ts" },
  },
  {
    id: "navegador.mac_desligado",
    titulo: "Responder ao cartão \"Seu Mac está desligado\": fazer agora (continuar sem o Mac) ou quando o Mac ligar",
    schema: { type: "object", properties: { turnoId: { type: "string", description: "O turno do pedido que espera o Mac (o turnoId do cartão).", maxLength: 36 }, resposta: { type: "string", enum: ["agora", "ao_ligar"] } }, required: ["turnoId", "resposta"], additionalProperties: false },
    risco: "muda",
    cartaoNoChat: true,
    // definido em 2026-11-20: "Fazer agora" tem o caminho pela ajustar_navegador (continuar_sem_mac) e a pessoa pede de novo;
    // "Quando o Mac ligar" é o que o bot já faz sozinho sem resposta (espera o Mac), mas sem a retomada automática.
    chat: { estado: "parcial", via: { ferramenta: "ajustar_navegador" }, falta: "pelo chat a pessoa liga o continuar sem o Mac e repete o pedido; a retomada sozinha quando o Mac liga só existe pelo cartão" },
  },
  {
    id: "navegador.login",
    titulo: "Escolher como o bot entra num site: um login do cofre (nod, 1Password, Bitwarden), entrar eu mesmo ou trazer do meu Chrome",
    risco: "muda",
    cartaoNoChat: true,
    chat: { estado: "nunca", motivo: "o login vai do cofre direto ao campo da página; a escolha é um clique no cartão e a senha nunca passa pelo chat nem pelo bot (ADR-177, ADR-190 decisão 6)" },
  },
  {
    id: "navegador.codigo",
    titulo: "Mandar o código de uso único (SMS, e-mail, app) direto para a página do navegador do bot",
    risco: "muda",
    cartaoNoChat: true,
    chat: { estado: "nunca", motivo: "o código vai do campo privado do cartão para a página; digitado no chat, passaria pela conversa e pelo bot" },
  },
  {
    id: "navegador.trazer_do_chrome",
    titulo: "Trazer do Chrome da pessoa a sessão de um site para o navegador do bot (o menu ⋯ e a recusa do login pelo Google)",
    risco: "muda",
    cartaoNoChat: false,
    chat: { estado: "nunca", motivo: "a sessão sai do Chrome da pessoa só com o toque dela (o macOS pede o Keychain; no PC, a extensão do nod); pelo chat, o bot pede o login (navegador_entrar) e o cartão já oferece \"Trazer do meu Chrome\"" },
  },
  {
    id: "navegador.guardar_login",
    titulo: "Guardar no cofre (nod, 1Password, Bitwarden) o login que a pessoa digitou no navegador do bot, ou descartar",
    risco: "muda",
    cartaoNoChat: false,
    chat: { estado: "nunca", motivo: "guardar grava a senha que a pessoa digitou na página; ela fica só na memória do servidor e nunca passa pelo chat" },
  },
  {
    id: "cofre.criar_login",
    titulo: "Guardar um login (site, usuário e senha) no cofre do nod",
    risco: "muda",
    cartaoNoChat: false,
    chat: { estado: "nunca", motivo: "a senha não passa pelo chat (ADR-177, ADR-190 decisão 6): ela entra pela tela e vai cifrada ao cofre" },
  },
  { id: "cofre.apagar_login", titulo: "Apagar um login do cofre do nod", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-395" } },
  {
    id: "navegador.apagar_tarefa",
    titulo: "Apagar uma tarefa ensinada (habilidade) do bot",
    risco: "muda",
    cartaoNoChat: false,
    // definido em 2026-11-20: listar tem caminho pela navegador_tarefa_ensinada (o bot lê as suas); apagar ainda não tem
    // ferramenta. Fica com a onda dos computadores, a mesma das outras ações do navegador sem caminho.
    chat: falta,
  },
  { id: "navegador.ensinar", titulo: "Ensinar uma tarefa ao bot no navegador (começar, descartar, salvar)", risco: "muda", cartaoNoChat: false, chat: { estado: "nunca", motivo: "ensinar é a pessoa fazendo com as próprias mãos no navegador do bot; o que vai ao chat é a mensagem dela com os passos" } },
] as const satisfies readonly DefinicaoAcao[];
