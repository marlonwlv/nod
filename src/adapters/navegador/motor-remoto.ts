import type { LugarNavegador } from "../../contracts/navegador-do-bot.ts";
import type { OperacaoMotorNavegador } from "../../contracts/navegador-maquina.ts";
import type { Escopo } from "../../shared/types.ts";
import type { CanalNavegador } from "./canal-maquina.ts";
import { FalhaNavegador, type AbaMotor, type CamposDeLogin, type LeituraNavegador, type MotorNavegador, type RefLida, type SessaoNavegador } from "./motor-agent-browser.ts";
import type { ElementoNaPagina } from "../../domain/navegador-ensinar.ts";
import { lerValor } from "./operacoes-remotas.ts";

/**
 * O `MotorNavegador` de um lugar fora do servidor (ADR-190, decisão 5): o Mac da pessoa pelo app, ou uma máquina sempre
 * ligada dela pelo motor. Cada chamada vira um comando na fila da máquina (`canal-maquina.ts`); lá, o mesmo
 * `criarMotorAgentBrowser` executa (`src/adapters/executor/navegador.ts`) e a resposta volta pela ponte. O portão não vê a
 * diferença: a falha da máquina chega como a `FalhaNavegador` do motor local.
 *
 * `portaDoStream` é null: a vista ao vivo de um lugar remoto vem do WebSocket que a máquina abre (`vivo-maquina.ts`).
 */

/** definido em 2026-11-20: os mesmos prazos do motor local (30 s comum, 60 s ao abrir e baixar, 12 s no esperar). */
const PRAZO_COMUM_MS = 30_000;
const PRAZO_LONGO_MS = 60_000;
const PRAZO_ESPERAR_MS = 12_000;
const LONGOS: ReadonlySet<OperacaoMotorNavegador> = new Set(["abrir", "historico", "abaNova", "baixar", "pdf"]);

export function prazoDaOperacao(op: OperacaoMotorNavegador): number {
  if (op === "esperar") return PRAZO_ESPERAR_MS;
  return LONGOS.has(op) ? PRAZO_LONGO_MS : PRAZO_COMUM_MS;
}

export function criarMotorRemoto(o: { canal: CanalNavegador; escopo: Escopo; maquinaId: string; lugar: LugarNavegador }): MotorNavegador {
  async function chamar(op: OperacaoMotorNavegador, s: SessaoNavegador, args: readonly unknown[]): Promise<unknown> {
    const r = await o.canal.enviar(o.escopo, o.maquinaId, { tipo: "motor", agenteId: s.agenteId, operacao: op, args }, prazoDaOperacao(op));
    if (!r.ok) throw new FalhaNavegador(r.motivo, r.detalhe);
    return lerValor(op, r.valor);
  }
  const vazio = async (op: OperacaoMotorNavegador, s: SessaoNavegador, args: readonly unknown[]) => { await chamar(op, s, args); };

  return {
    lugar: o.lugar,
    abrir: async (s, url, novaAba) => (await chamar("abrir", s, [url, novaAba === true])) as { url: string; titulo: string },
    ler: async (s, l) => (await chamar("ler", s, [l ?? {}])) as LeituraNavegador,
    clicar: (s, alvo, duplo) => vazio("clicar", s, [alvo, duplo === true]),
    preencher: (s, alvo, t) => vazio("preencher", s, [alvo, t]),
    digitar: (s, alvo, t) => vazio("digitar", s, [alvo, t]),
    tecla: (s, t) => vazio("tecla", s, [t]),
    rolar: (s, r) => vazio("rolar", s, [r]),
    esperar: (s, e) => vazio("esperar", s, [e]),
    print: async (s, p) => (await chamar("print", s, [p ?? {}])) as { jpeg: string },
    texto: async (s, alvo) => (await chamar("texto", s, [alvo ?? null])) as string,
    obter: (s, oQue, alvo, nome) => chamar("obter", s, [oQue, alvo ?? null, nome ?? null]),
    estilos: async (s, alvo) => (await chamar("estilos", s, [alvo])) as Record<string, string>,
    selecionar: (s, alvo, opcoes) => vazio("selecionar", s, [alvo, [...opcoes]]),
    marcar: (s, alvo, marcado) => vazio("marcar", s, [alvo, marcado]),
    passarMouse: (s, alvo) => vazio("passarMouse", s, [alvo]),
    arrastar: (s, de, para) => vazio("arrastar", s, [de, para]),
    mouse: (s, m) => vazio("mouse", s, [m]),
    historico: (s, acao) => vazio("historico", s, [acao]),
    abas: async (s) => (await chamar("abas", s, [])) as AbaMotor[],
    abaNova: (s, url) => vazio("abaNova", s, [url ?? null]),
    abaTrocar: (s, id) => vazio("abaTrocar", s, [id]),
    abaFechar: (s, id) => vazio("abaFechar", s, [id ?? null]),
    quadro: (s, alvo) => vazio("quadro", s, [alvo]),
    dialogo: (s, aceitar, t) => vazio("dialogo", s, [aceitar, t ?? null]),
    baixar: async (s, alvo, nome) => (await chamar("baixar", s, [alvo, nome])) as { nome: string; bytes: number },
    enviarArquivo: (s, alvo, nomes) => vazio("enviarArquivo", s, [alvo, [...nomes]]),
    pdf: async (s, nome) => (await chamar("pdf", s, [nome])) as { nome: string; bytes: number },
    procurar: (s, p) => vazio("procurar", s, [p]),
    avaliar: (s, expressao) => chamar("avaliar", s, [expressao]),
    focado: async (s) => (await chamar("focado", s, [])) as RefLida | null,
    descreverElemento: async (s, ponto) => (await chamar("descreverElemento", s, [ponto])) as ElementoNaPagina | null,
    url: async (s) => (await chamar("url", s, [])) as string,
    camposDeLogin: async (s) => (await chamar("camposDeLogin", s, [])) as CamposDeLogin,
    // O texto (segredo do cofre do nod, código do SMS) vai à máquina no corpo do comando, pela ponte (HTTPS + chave da
    // máquina); lá entra pelo relay local, como aqui.
    inserirTexto: (s, alvo, t) => vazio("inserirTexto", s, [alvo, t]),
    definirCookies: (s, cookies) => vazio("definirCookies", s, [cookies.map((c) => ({ ...c }))]),
    portaDoStream: async () => null,
    tamanho: (s, w, h) => vazio("tamanho", s, [w, h]),
    fechar: (s) => vazio("fechar", s, []),
  };
}
