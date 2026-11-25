import type { LugarNavegador, MudancaLugarNavegador, PayloadNavegadorLugar, RespostaLugarNavegador } from "../contracts/navegador-do-bot.ts";
import type { PlataformaMaquina } from "../contracts/ponte.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { avisoForaDoAr, avisoMaquinaSaiu, avisoPrimeiraMaquina, esperaDoNavegador, fraseDaPergunta, fraseDoLugar, horaNoFuso, maquinaPreferida, resolverLugar, subtituloDoInterruptor, sujeitoDoBot, type AvisoDeLugar, type EntradaLugar, type EsperaDoNavegador, type ResolucaoLugar } from "../domain/navegador-lugar.ts";
import type { PreferenciasNavegador } from "../repositories/navegador.repo.ts";
import { autoriaAgente, evento } from "./apoio-l7.ts";
import type { Deps } from "./tipos.ts";

/**
 * Onde mora o navegador do bot (ADR-190, decisão 5; quadros M e N): o que só o banco sabe (as preferências do bot, as
 * máquinas da pessoa, onde o computador do bot mora) junto com o que só o processo sabe (quem está com o navegador ligado
 * agora, `ligadas`), entregue às regras puras de `src/domain/navegador-lugar.ts`. As linhas que avisam na conversa do bot
 * quando o lugar muda sozinho também moram aqui.
 */

type D = Pick<Deps, "repos" | "escopo" | "agora">;

/** Uma máquina da pessoa com o navegador ligado agora (o long-poll `navegador/puxar`, `canal-maquina.ts`). */
export type MaquinaLigada = { maquinaId: string; plataforma: PlataformaMaquina };

export type EntradaDoLugar = {
  entrada: EntradaLugar;
  preferencias: PreferenciasNavegador | null;
  /** O app (Mac ou PC) ligado agora com o navegador, o de contato mais recente: onde o lugar "mac" roda. */
  aparelhoId: string | null;
};

const ehAparelho = (p: PlataformaMaquina | null) => p !== "linux";

/** Monta a entrada das regras puras para um bot. */
export async function entradaDoLugar(d: D, agenteId: string, ligadas: readonly MaquinaLigada[]): Promise<EntradaDoLugar> {
  const [preferencias, vivas, computador] = await Promise.all([
    d.repos.navegadorPreferencias.buscar(agenteId),
    d.repos.maquinaTokens.vivasComPlataforma(),
    d.repos.computadores.daPessoa().catch(() => null),
  ]);
  // vivasComPlataforma vem da mais nova para a mais velha; "a primeira que a pessoa conectou" é a mais velha.
  const emOrdem = [...vivas].reverse();
  const ids = new Set(ligadas.map((m) => m.maquinaId));
  const aparelhos = emOrdem.filter((m) => ehAparelho(m.plataforma));
  const aparelho = ligadas.find((m) => ehAparelho(m.plataforma) && aparelhos.some((a) => a.id === m.maquinaId)) ?? null;
  const maquinas = emOrdem.filter((m) => m.plataforma === "linux").map((m) => ({ id: m.id, nome: m.nome, ligada: ids.has(m.id) }));
  const doComputador = computador?.hospedeiraId ?? computador?.maquinaId ?? null;
  const pc = (aparelho ? aparelho.plataforma : aparelhos[0]?.plataforma) === "win32";
  return {
    preferencias,
    aparelhoId: aparelho?.maquinaId ?? null,
    entrada: {
      temApp: aparelhos.length > 0,
      nomeDoAparelho: pc ? "seu PC" : "seu Mac",
      aparelhoLigado: aparelho !== null,
      continuaSemMac: preferencias?.continuaSemMac ?? false,
      maquinas,
      maquinaDoComputador: doComputador && maquinas.some((m) => m.id === doComputador) ? doComputador : null,
      escolha: preferencias?.noNod ? "nod" : preferencias?.maquinaId ?? null,
      soNaMaquina: preferencias?.soNaMaquina ?? false,
    },
  };
}

/**
 * O lugar decidido para um bot. `roda` com `desvio`: a máquina escolhida estava fora do ar e roda no nod desta vez (a
 * conversa ganha a linha uma vez por queda). `espera`: o Mac desligado (com o interruptor desligado), o app dele sem o
 * navegador, ou a máquina travada fora do ar — nada roda; `causa` vai à vista e `instrucao` ao bot.
 */
export type LugarDecidido =
  | { tipo: "roda"; lugar: LugarNavegador; desvio: { maquinaId: string; nome: string } | null }
  | ({ tipo: "espera" } & EsperaDoNavegador);

/**
 * O `lugarDe` do portão (src/adapters/fundo/navegadores.ts). `ligadas`: quem puxa o navegador agora; `conectadas`: as
 * máquinas da pessoa conectadas pela ponte (um app conectado que não puxa o navegador é de uma versão sem ele).
 */
export async function decidirLugarDoNavegador(d: D, agenteId: string, p: { ligadas: readonly MaquinaLigada[]; conectadas: readonly MaquinaLigada[] }): Promise<LugarDecidido> {
  const e = await entradaDoLugar(d, agenteId, p.ligadas);
  const r = resolverLugar(e.entrada);
  if (r.tipo === "espera") {
    const semNavegador = r.motivo === "aparelho_desligado" && p.conectadas.some((m) => ehAparelho(m.plataforma) && !p.ligadas.some((l) => l.maquinaId === m.maquinaId));
    return { tipo: "espera", ...esperaDoNavegador(r, semNavegador) };
  }
  const desviada = r.desvio ? maquinaPreferida(e.entrada) : null;
  return { tipo: "roda", lugar: r.lugar, desvio: desviada ? { maquinaId: desviada.id, nome: desviada.nome } : null };
}

/** GET /agentes/:id/navegador/lugar: a pergunta, a lista e os textos prontos com o nome do bot. */
export async function painelDoLugar(d: D, agenteId: string, ligadas: readonly MaquinaLigada[]): Promise<RespostaLugarNavegador> {
  const agente = await d.repos.agentes.buscar(agenteId);
  if (!agente || agente.ownerId !== d.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado");
  const { entrada: e, preferencias } = await entradaDoLugar(d, agenteId, ligadas);
  const r: ResolucaoLugar = resolverLugar(e);
  return {
    continuaSemMac: e.continuaSemMac,
    maquinaId: e.escolha,
    soNaMaquina: e.soNaMaquina,
    maquinas: e.maquinas,
    maquinaDoComputador: e.maquinaDoComputador,
    temApp: e.temApp,
    nomeDoAparelho: e.nomeDoAparelho,
    agora: r.tipo === "roda" ? fraseDoLugar(r.lugar) : null,
    subtitulo: subtituloDoInterruptor(e, sujeitoDoBot(agente.nome)),
    frasePergunta: fraseDaPergunta(e, sujeitoDoBot(agente.nome)),
    respondeu: preferencias?.respondidoEm != null,
    retomarTurnoId: preferencias?.retomarTurnoId ?? null,
  };
}

/**
 * A mudança da pessoa (a tela, o Desfazer de uma linha, a ferramenta ajustar_navegador). `maquinaId`: uma máquina sempre
 * ligada dela (Linux, viva), "nod" (volta para o nod) ou null (a automática). Escolher uma máquina ou o nod liga o
 * "continuar com o Mac desligado" (a escolha só vale fora do Mac).
 */
export async function mudarLugarDoNavegador(d: D, agenteId: string, m: MudancaLugarNavegador): Promise<PreferenciasNavegador> {
  const agente = await d.repos.agentes.buscar(agenteId);
  if (!agente || agente.ownerId !== d.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado");
  const p: Parameters<D["repos"]["navegadorPreferencias"]["gravar"]>[1] = {};
  if (m.maquinaId !== undefined) {
    if (m.maquinaId === "nod") Object.assign(p, { noNod: true, maquinaId: null });
    else if (m.maquinaId === null) Object.assign(p, { noNod: false, maquinaId: null });
    else {
      const vivas = await d.repos.maquinaTokens.vivasComPlataforma();
      if (!vivas.some((v) => v.id === m.maquinaId && v.plataforma === "linux")) throw new ErroDeDominio("entrada_invalida", { cause: "maquina" });
      Object.assign(p, { noNod: false, maquinaId: m.maquinaId });
    }
    if (m.maquinaId !== null && m.continuaSemMac === undefined) p.continuaSemMac = true;
  }
  // A resposta ao cartão M2/J1 (ou ao interruptor do painel, ou à ajustar_navegador): a pergunta não volta.
  if (m.continuaSemMac !== undefined) Object.assign(p, { continuaSemMac: m.continuaSemMac, respondidoEm: d.agora() });
  else if (p.continuaSemMac !== undefined) p.respondidoEm = d.agora();
  if (m.soNaMaquina !== undefined) p.soNaMaquina = m.soNaMaquina;
  const r = await d.repos.navegadorPreferencias.gravar(agenteId, p, d.agora());
  if (!r) throw new ErroDeDominio("nao_encontrado");
  return r;
}

/** Grava a linha `navegador_lugar` na conversa própria do bot. Sem conversa (bot sem ela ainda): nada. */
export async function avisarNaConversa(d: D, agenteId: string, a: AvisoDeLugar, extra: { maquinaId: string | null; nome: string; acao: PayloadNavegadorLugar["acao"] }): Promise<void> {
  const conversa = await d.repos.conversas.buscarPropriaDoAgente(agenteId);
  if (!conversa) return;
  const agora = d.agora();
  const autoria = autoriaAgente(agenteId, d.escopo.pessoaId);
  const payload: PayloadNavegadorLugar = { kind: "navegador_lugar", agenteId, aviso: a.tipo, maquinaId: extra.maquinaId, nome: extra.nome, em: agora, acao: extra.acao };
  const m = await d.repos.mensagens.criar({ conversaId: conversa.id, turnoId: null, autoria, kind: "sistema", texto: a.texto, payload, confianca: "confiavel" });
  if (m) await d.repos.events.gravarComOutbox([evento(d, "mensagem_criada", autoria, { mensagem_id: m.id, kind: "sistema" }, { conversaId: conversa.id, turnoId: null })]);
}

/** O navegador que devia rodar na máquina rodou no nod porque ela estava fora do ar (N, "Fiz no nod"). */
export async function avisarForaDoAr(d: D, agenteId: string, maquina: { id: string; nome: string }): Promise<void> {
  // "às 3h", "às 22h30" (Paper N, "Quando algo muda"), no fuso das frases.
  const t = horaNoFuso(d.agora());
  const a = avisoForaDoAr(maquina.nome, t.m ? `${t.h}h${String(t.m).padStart(2, "0")}` : `${t.h}h`);
  if (a.tipo !== "fez_no_nod") return;
  await avisarNaConversa(d, agenteId, a, { maquinaId: maquina.id, nome: maquina.nome, acao: { rotulo: a.travar, mudar: { soNaMaquina: true } } });
}

/**
 * A pessoa conectou a PRIMEIRA máquina sempre ligada (N): cada bot que continua com o Mac desligado e não escolheu o nod
 * passa a continuar nela, e a conversa dele diz, com Desfazer (= volta para o nod). Outra máquina já na conta: nada.
 */
export async function aoConectarMaquina(d: D, maquinaId: string): Promise<number> {
  const vivas = await d.repos.maquinaTokens.vivasComPlataforma();
  const linux = vivas.filter((v) => v.plataforma === "linux");
  const nova = linux.find((v) => v.id === maquinaId);
  if (!nova || linux.length !== 1) return 0;
  const bots = (await d.repos.navegadorPreferencias.daPessoa()).filter((p) => p.continuaSemMac && !p.noNod && p.maquinaId === null);
  for (const p of bots) {
    const a = avisoPrimeiraMaquina(nova.nome);
    await avisarNaConversa(d, p.agenteId, a, { maquinaId: nova.id, nome: nova.nome, acao: { rotulo: "Desfazer", mudar: { maquinaId: "nod" } } });
  }
  return bots.length;
}

/**
 * Uma máquina saiu da conta (N): cada bot que a tinha escolhido volta para o nod (a escolha fica explícita, para a frase
 * "Continuo no nod" seguir verdadeira com outra máquina na conta) e a conversa dele diz.
 */
export async function aoSairMaquina(d: D, maquinaId: string): Promise<number> {
  const bots = (await d.repos.navegadorPreferencias.daPessoa()).filter((p) => p.maquinaId === maquinaId);
  if (!bots.length) return 0;
  const nome = (await d.repos.maquinaTokens.identificar(maquinaId))?.nome ?? "máquina";
  for (const p of bots) {
    await d.repos.navegadorPreferencias.gravar(p.agenteId, { maquinaId: null, noNod: true }, d.agora());
    await avisarNaConversa(d, p.agenteId, avisoMaquinaSaiu(nome), { maquinaId, nome, acao: null });
  }
  return bots.length;
}
