import type { Navegadores } from "../../fundo/navegadores.ts";
import type { Rota } from "../roteador.ts";
import { OPERACOES_ENSINAR, OPERACOES_NAVEGADOR, type MudancaLugarNavegador, type OperacaoEnsinar, type OperacaoNavegador, type RespostaEnsinar, type RespostaLugarNavegador, type RespostaNavegador } from "../../../contracts/navegador-do-bot.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import type { Escopo } from "../../../shared/types.ts";
import { painelDoLugar, type MaquinaLigada } from "../../../use-cases/navegador-lugar.ts";
import { lugarDoNavegador } from "../../../use-cases/acoes/navegador.ts";
import { executar } from "./dentro-de-tx.ts";
import type { Deps } from "../../../use-cases/tipos.ts";

/** O que as rotas do lugar precisam além do portão: a transação da pessoa e quem está com o navegador ligado agora. */
export type DepsLugarNavegador = { dentro<T>(escopo: Escopo, fn: (d: Deps) => Promise<T>): Promise<T>; ligadas(escopo: Escopo): readonly MaquinaLigada[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O corpo do POST /navegador/lugar, conferido: só as três chaves, cada uma do seu tipo. */
export function lerMudancaLugar(c: Record<string, unknown>): MudancaLugarNavegador {
  const m: MudancaLugarNavegador = {};
  for (const k of Object.keys(c)) if (k !== "continuaSemMac" && k !== "maquinaId" && k !== "soNaMaquina") throw new ErroDeDominio("entrada_invalida");
  if (c.continuaSemMac !== undefined) { if (typeof c.continuaSemMac !== "boolean") throw new ErroDeDominio("entrada_invalida"); m.continuaSemMac = c.continuaSemMac; }
  if (c.soNaMaquina !== undefined) { if (typeof c.soNaMaquina !== "boolean") throw new ErroDeDominio("entrada_invalida"); m.soNaMaquina = c.soNaMaquina; }
  if (c.maquinaId !== undefined) {
    if (c.maquinaId !== null && c.maquinaId !== "nod" && (typeof c.maquinaId !== "string" || !UUID.test(c.maquinaId))) throw new ErroDeDominio("entrada_invalida");
    m.maquinaId = c.maquinaId as string | null;
  }
  if (!Object.keys(m).length) throw new ErroDeDominio("entrada_invalida");
  return m;
}

/**
 * O 409 do navegador diz a causa (molde de MOTIVOS_DO_COMPUTADOR, NOD-407): só estas causas saem no corpo, como `motivo`;
 * qualquer outra vira `indisponivel`. Frases fixas, sem dado da pessoa.
 */
export const MOTIVOS_DO_NAVEGADOR: Readonly<Record<string, string>> = {
  assuma_primeiro: "Assuma o navegador para mexer nele.",
  ja_com_voce: "O navegador já está com você.",
  sem_controle: "O navegador não está com você agora.",
  desligado: "O navegador está desligado. Ligue-o primeiro.",
  na_fila: "Os navegadores do nod estão todos em uso agora. Tente de novo em instantes.",
  nao_ligou: "O navegador não conseguiu ligar. Tente de novo.",
  acao_falhou: "O navegador não respondeu a tempo. Tente de novo.",
  sem_gravacao: "Não há gravação em curso.",
  sem_descarte: "Já não dá para desfazer.",
  sem_passos: "A gravação ainda não tem nenhum passo.",
  indisponivel: "O navegador do bot não pode fazer isso agora.",
  aparelho_desligado: "O seu computador está desligado (ou com o app do nod fechado): o navegador do bot volta quando ele ligar.",
  maquina_fora_do_ar: "A máquina escolhida está fora do ar e o bot só trabalha nela. O navegador volta quando ela voltar.",
  app_sem_navegador: "O app do nod no seu computador precisa ser atualizado para rodar o navegador do bot.",
};

function responderCausa(ctx: { json(status: number, corpo: unknown): void }, e: unknown): boolean {
  if (!(e instanceof ErroDeDominio) || e.codigo !== "estado_invalido") return false;
  const bruta = typeof e.cause === "string" ? e.cause : "indisponivel";
  const motivo = Object.hasOwn(MOTIVOS_DO_NAVEGADOR, bruta) ? bruta : "indisponivel";
  ctx.json(409, { codigo: "estado_invalido", mensagem: MOTIVOS_DO_NAVEGADOR[motivo], motivo });
  return true;
}

const corpoObj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** As rotas da dona do bot (ADR-190). O canal ao vivo é um WebSocket à parte (src/adapters/voz/ws.ts). */
export function rotasNavegador(navegadores: Navegadores, lugar?: DepsLugarNavegador): Rota[] {
  const comCausa = async (ctx: { json(status: number, corpo: unknown): void }, fn: () => Promise<unknown>) => {
    try { ctx.json(200, await fn()); } catch (e) { if (!responderCausa(ctx, e)) throw e; }
  };
  const rotasDoLugar: Rota[] = lugar ? [
    /** ADR-190 (M, N): onde o navegador do bot mora — a pergunta, as máquinas sempre ligadas e os textos prontos. */
    { metodo: "GET", padrao: /^\/agentes\/(?<id>[^/]+)\/navegador\/lugar$/, async handler(ctx) {
      const r: RespostaLugarNavegador = await lugar.dentro(ctx.escopo, (d) => painelDoLugar(d, ctx.params.id!, lugar.ligadas(ctx.escopo)));
      ctx.json(200, r);
    } },
    { metodo: "POST", acao: "navegador.lugar", padrao: /^\/agentes\/(?<id>[^/]+)\/navegador\/lugar$/, async handler(ctx) {
      const m = lerMudancaLugar(corpoObj(await ctx.corpo()));
      const r: RespostaLugarNavegador = await lugar.dentro(ctx.escopo, async (d) => {
        await executar(d, lugarDoNavegador, { agenteId: ctx.params.id!, mudanca: m });
        return painelDoLugar(d, ctx.params.id!, lugar.ligadas(ctx.escopo));
      });
      ctx.json(200, { ok: true, ...r });
    } },
  ] : [];
  return [
    ...rotasDoLugar,
    { metodo: "GET", padrao: /^\/agentes\/(?<id>[^/]+)\/navegador$/, async handler(ctx) {
      await navegadores.conferirDona(ctx.escopo, ctx.params.id!);
      const vista = navegadores.vistaDe(ctx.escopo, ctx.params.id!);
      const r: RespostaNavegador = { vista, disponivel: navegadores.disponivel(vista.lugar, ctx.escopo) };
      ctx.json(200, r);
    } },
    { metodo: "POST", acao: "navegador.operar", padrao: /^\/agentes\/(?<id>[^/]+)\/navegador$/, async handler(ctx) {
      const corpo = corpoObj(await ctx.corpo());
      if (typeof corpo.operacao !== "string" || !(OPERACOES_NAVEGADOR as readonly string[]).includes(corpo.operacao)) throw new ErroDeDominio("entrada_invalida");
      await comCausa(ctx, async () => ({ ok: true, vista: await navegadores.operar(ctx.escopo, ctx.params.id!, corpo.operacao as OperacaoNavegador) }));
    } },
    { metodo: "POST", acao: "navegador.ir_para", padrao: /^\/agentes\/(?<id>[^/]+)\/navegador\/endereco$/, async handler(ctx) {
      const corpo = corpoObj(await ctx.corpo());
      if (typeof corpo.url !== "string" || corpo.url.length === 0 || corpo.url.length > 4000) throw new ErroDeDominio("entrada_invalida");
      await comCausa(ctx, async () => ({ ok: true, vista: await navegadores.irPara(ctx.escopo, ctx.params.id!, corpo.url as string) }));
    } },
    { metodo: "POST", acao: "navegador.trocar_aba", padrao: /^\/agentes\/(?<id>[^/]+)\/navegador\/aba$/, async handler(ctx) {
      const corpo = corpoObj(await ctx.corpo());
      if (typeof corpo.aba !== "string") throw new ErroDeDominio("entrada_invalida");
      await comCausa(ctx, async () => ({ ok: true, vista: await navegadores.trocarAba(ctx.escopo, ctx.params.id!, corpo.aba as string) }));
    } },
    { metodo: "POST", acao: "navegador.ensinar", padrao: /^\/agentes\/(?<id>[^/]+)\/navegador\/ensinar$/, async handler(ctx) {
      const corpo = corpoObj(await ctx.corpo());
      if (typeof corpo.operacao !== "string" || !(OPERACOES_ENSINAR as readonly string[]).includes(corpo.operacao)) throw new ErroDeDominio("entrada_invalida");
      if (corpo.nome !== undefined && (typeof corpo.nome !== "string" || corpo.nome.length > 120)) throw new ErroDeDominio("entrada_invalida");
      await comCausa(ctx, async (): Promise<RespostaEnsinar> => {
        const r = await navegadores.ensinar(ctx.escopo, ctx.params.id!, corpo.operacao as OperacaoEnsinar, corpo.nome as string | undefined);
        return { ok: true, vista: r.vista, ...(r.tarefa ? { tarefa: r.tarefa } : {}) };
      });
    } },
  ];
}
