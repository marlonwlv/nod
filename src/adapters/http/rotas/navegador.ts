import type { Navegadores } from "../../fundo/navegadores.ts";
import type { Rota } from "../roteador.ts";
import { FONTES_COFRE, OPERACOES_ENSINAR, OPERACOES_NAVEGADOR, type EscolhaLoginNavegador, type FonteCofre, type LoginDoCofreNaTela, type MudancaLugarNavegador, type OperacaoEnsinar, type OperacaoNavegador, type RespostaEnsinar, type RespostaLoginNavegador, type RespostaLugarNavegador, type RespostaMacDesligado, type RespostaNavegador, type RespostaTrazerDoChrome, type TarefaEnsinada } from "../../../contracts/navegador-do-bot.ts";
import { codigoValido, hostDoSite, mascararUsuario } from "../../../domain/navegador-cofre.ts";
import type { LoginDoCofre } from "../../../repositories/cofre-logins.repo.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import type { Escopo } from "../../../shared/types.ts";
import { painelDoLugar, type MaquinaLigada } from "../../../use-cases/navegador-lugar.ts";
import { lugarDoNavegador, macDesligadoDoNavegador } from "../../../use-cases/acoes/navegador.ts";
import { executar } from "./dentro-de-tx.ts";
import type { Deps } from "../../../use-cases/tipos.ts";

/** O que as rotas do lugar precisam além do portão: a transação da pessoa e quem está com o navegador ligado agora. */
export type DepsLugarNavegador = { dentro<T>(escopo: Escopo, fn: (d: Deps) => Promise<T>): Promise<T>; ligadas(escopo: Escopo): readonly MaquinaLigada[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ehFonte = (v: unknown): v is FonteCofre => typeof v === "string" && (FONTES_COFRE as readonly string[]).includes(v);
/** A referência de cada cofre: o id do login do nod, `op://…` do 1Password (ou vazio = o item do site), o id do Bitwarden. */
const REF_DA_FONTE: Readonly<Record<FonteCofre, RegExp>> = {
  nod: UUID,
  "1password": /^(?:op:\/\/[^\\"'$`\p{Cc}]{1,300})?$/u,
  bitwarden: /^[A-Za-z0-9-]{0,64}$/,
};

/** O corpo do POST /navegador/login (L1), conferido: a decisão e a escolha, nunca um segredo. */
export function lerEscolhaLogin(c: Record<string, unknown>): { decisaoId: string; escolha: EscolhaLoginNavegador } {
  if (typeof c.decisaoId !== "string" || !UUID.test(c.decisaoId)) throw new ErroDeDominio("entrada_invalida");
  const e = c.escolha;
  if (e === "eu_mesmo" || e === "chrome") return { decisaoId: c.decisaoId, escolha: e };
  const o = corpoObj(e);
  if (Object.keys(o).some((k) => k !== "fonte" && k !== "ref") || !ehFonte(o.fonte) || typeof o.ref !== "string" || !REF_DA_FONTE[o.fonte].test(o.ref)) throw new ErroDeDominio("entrada_invalida");
  return { decisaoId: c.decisaoId, escolha: { fonte: o.fonte, ref: o.ref } };
}

/** O cofre do nod na tela (GET/POST /cofre/logins): nunca a senha, e o usuário mascarado. */
export const loginNaTela = (l: LoginDoCofre): LoginDoCofreNaTela => ({ id: l.id, site: l.site, usuario: mascararUsuario(l.usuario), criadoEm: l.criadoEm });

/** O corpo do POST /cofre/logins, conferido: o site vira host; usuário até 320; senha de 1 a 4096. */
export function lerNovoLogin(c: Record<string, unknown>): { site: string; usuario: string; senha: string } {
  const site = typeof c.site === "string" && c.site.length <= 2000 ? hostDoSite(c.site).replace(/^www\./, "") : "";
  if (!site || typeof c.usuario !== "string" || c.usuario.length > 320 || typeof c.senha !== "string" || c.senha.length < 1 || c.senha.length > 4096) throw new ErroDeDominio("entrada_invalida");
  return { site, usuario: c.usuario.trim(), senha: c.senha };
}

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
  sem_pedido: "Este pedido já foi respondido.",
  login_em_curso: "O login ainda está sendo preenchido. Confirme no seu Mac.",
  site_mudou: "A página mudou de site. Peça o login de novo.",
  login_saiu: "Esse login saiu do cofre. Escolha outro ou entre você mesmo.",
  precisa_do_mac: "Isto precisa do seu Mac ligado, com o app do nod aberto.",
  nao_preencheu: "Não achei o campo na página. Entre você mesmo pelo navegador.",
  sem_oferta: "Não há login para guardar agora.",
  nao_guardou: "O cofre do seu Mac não guardou o login. Tente de novo.",
  sem_site: "Abra o site no navegador primeiro.",
};

function responderCausa(ctx: { json(status: number, corpo: unknown): void }, e: unknown): boolean {
  if (!(e instanceof ErroDeDominio) || e.codigo !== "estado_invalido") return false;
  const bruta = typeof e.cause === "string" ? e.cause : "indisponivel";
  const motivo = Object.hasOwn(MOTIVOS_DO_NAVEGADOR, bruta) ? bruta : "indisponivel";
  ctx.json(409, { codigo: "estado_invalido", mensagem: MOTIVOS_DO_NAVEGADOR[motivo], motivo });
  return true;
}

const corpoObj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * O cofre do nod na tela (ADR-190, decisão 6): listar (sem a senha), guardar (a senha entra cifrada pelo servidor e nunca
 * volta) e apagar. Só a dona vê os dela (owner_id no filtro, além do RLS).
 */
export function rotasCofreLogins(d: { dentro<T>(escopo: Escopo, fn: (d: Deps) => Promise<T>): Promise<T>; cifrar(s: string): string }): Rota[] {
  return [
    { metodo: "GET", padrao: /^\/cofre\/logins$/, async handler(ctx) {
      const logins = await d.dentro(ctx.escopo, (deps) => deps.repos.cofreLogins.listar());
      ctx.json(200, { logins: logins.map(loginNaTela) });
    } },
    { metodo: "POST", acao: "cofre.criar_login", padrao: /^\/cofre\/logins$/, async handler(ctx) {
      const novo = lerNovoLogin(corpoObj(await ctx.corpo()));
      const l = await d.dentro(ctx.escopo, (deps) => deps.repos.cofreLogins.criar({ site: novo.site, usuario: novo.usuario, senhaCifrada: d.cifrar(novo.senha) }));
      ctx.json(200, { ok: true, login: loginNaTela(l) });
    } },
    { metodo: "DELETE", acao: "cofre.apagar_login", padrao: /^\/cofre\/logins\/(?<id>[^/]+)$/, async handler(ctx) {
      if (!UUID.test(ctx.params.id ?? "")) throw new ErroDeDominio("nao_encontrado");
      const apagou = await d.dentro(ctx.escopo, (deps) => deps.repos.cofreLogins.apagar(ctx.params.id!));
      if (!apagou) throw new ErroDeDominio("nao_encontrado");
      ctx.json(200, { ok: true });
    } },
  ];
}

/**
 * As habilidades do bot (ADR-190, T3; Ajustes do bot › Habilidades): as tarefas que a pessoa ensinou no navegador. Listar
 * (o nome, os passos em frases e a data) e apagar. Só a dona: o filtro por owner_id no repositório, além do RLS. A lista
 * do bot é a mesma que `navegador_tarefa_ensinada` devolve a ele (mais novas primeiro, até TAREFAS_POR_BOT).
 */
export function rotasTarefasEnsinadas(d: { dentro<T>(escopo: Escopo, fn: (d: Deps) => Promise<T>): Promise<T>; espaco?: (escopo: Escopo, agenteId: string) => Promise<number | null> }): Rota[] {
  return [
    { metodo: "GET", padrao: /^\/agentes\/(?<id>[^/]+)\/navegador\/habilidades$/, async handler(ctx) {
      const tarefas: TarefaEnsinada[] = await d.dentro(ctx.escopo, (deps) => deps.repos.navegadorTarefas.doAgente(ctx.params.id!));
      // Ponto 09 dos cenários (2026-11-22): o espaço que o navegador do bot ocupa no disco (só a dona; null = sem perfil).
      const espacoBytes = d.espaco ? await d.espaco(ctx.escopo, ctx.params.id!).catch(() => null) : null;
      ctx.json(200, { tarefas, espacoBytes });
    } },
    { metodo: "DELETE", acao: "navegador.apagar_tarefa", padrao: /^\/agentes\/(?<id>[^/]+)\/navegador\/habilidades\/(?<tarefa>[^/]+)$/, async handler(ctx) {
      if (!UUID.test(ctx.params.tarefa ?? "")) throw new ErroDeDominio("nao_encontrado");
      const apagou = await d.dentro(ctx.escopo, (deps) => deps.repos.navegadorTarefas.apagar(ctx.params.id!, ctx.params.tarefa!));
      if (!apagou) throw new ErroDeDominio("nao_encontrado");
      ctx.json(200, { ok: true });
    } },
  ];
}

/** As rotas da dona do bot (ADR-190). O canal ao vivo é um WebSocket à parte (src/adapters/voz/ws.ts). */
export function rotasNavegador(navegadores: Navegadores, lugar?: DepsLugarNavegador): Rota[] {
  const comDisponivel = (r: RespostaLugarNavegador): RespostaLugarNavegador => ({ ...r, disponivel: navegadores.disponivel() });
  const comCausa = async (ctx: { json(status: number, corpo: unknown): void }, fn: () => Promise<unknown>) => {
    try { ctx.json(200, await fn()); } catch (e) { if (!responderCausa(ctx, e)) throw e; }
  };
  const rotasDoLugar: Rota[] = lugar ? [
    /** ADR-190 (M, N): onde o navegador do bot mora — a pergunta, as máquinas sempre ligadas e os textos prontos. */
    { metodo: "GET", padrao: /^\/agentes\/(?<id>[^/]+)\/navegador\/lugar$/, async handler(ctx) {
      const r: RespostaLugarNavegador = await lugar.dentro(ctx.escopo, (d) => painelDoLugar(d, ctx.params.id!, lugar.ligadas(ctx.escopo)));
      ctx.json(200, comDisponivel(r));
    } },
    { metodo: "POST", acao: "navegador.lugar", padrao: /^\/agentes\/(?<id>[^/]+)\/navegador\/lugar$/, async handler(ctx) {
      const m = lerMudancaLugar(corpoObj(await ctx.corpo()));
      const r: RespostaLugarNavegador = await lugar.dentro(ctx.escopo, async (d) => {
        await executar(d, lugarDoNavegador, { agenteId: ctx.params.id!, mudanca: m });
        return painelDoLugar(d, ctx.params.id!, lugar.ligadas(ctx.escopo));
      });
      ctx.json(200, { ok: true, ...comDisponivel(r) });
    } },
    /** ADR-190 (K1): o cartão "Seu Mac está desligado" — "Fazer agora" ou "Quando o Mac ligar". */
    { metodo: "POST", acao: "navegador.mac_desligado", padrao: /^\/agentes\/(?<id>[^/]+)\/navegador\/mac-desligado$/, async handler(ctx) {
      const c = corpoObj(await ctx.corpo());
      if (Object.keys(c).some((k) => k !== "turnoId" && k !== "resposta") || typeof c.turnoId !== "string" || !UUID.test(c.turnoId) || (c.resposta !== "agora" && c.resposta !== "ao_ligar")) throw new ErroDeDominio("entrada_invalida");
      const entrada = { agenteId: ctx.params.id!, turnoId: c.turnoId, resposta: c.resposta as RespostaMacDesligado };
      const r = await lugar.dentro(ctx.escopo, async (d) => {
        const feito = await executar(d, macDesligadoDoNavegador, entrada);
        return { ...feito, ...(await painelDoLugar(d, ctx.params.id!, lugar.ligadas(ctx.escopo))) };
      });
      ctx.json(200, { ok: true, ...r, disponivel: navegadores.disponivel() });
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
    /** L1/L2: a escolha do cartão de login (cofre do nod, 1Password, Bitwarden, "Entrar eu mesmo" ou o Chrome do Mac). */
    { metodo: "POST", acao: "navegador.login", padrao: /^\/agentes\/(?<id>[^/]+)\/navegador\/login$/, async handler(ctx) {
      const { decisaoId, escolha } = lerEscolhaLogin(corpoObj(await ctx.corpo()));
      await comCausa(ctx, async (): Promise<RespostaLoginNavegador> => {
        const r = await navegadores.escolherLogin(ctx.escopo, ctx.params.id!, decisaoId, escolha);
        return { ok: true, vista: r.vista, aviso: r.aviso };
      });
    } },
    /** 2026-11-23: "Trazer do meu Chrome" solto (o ⋯ e a recusa do Google): a sessão de um site, sem pedido de login. */
    { metodo: "POST", acao: "navegador.trazer_do_chrome", padrao: /^\/agentes\/(?<id>[^/]+)\/navegador\/trazer-do-chrome$/, async handler(ctx) {
      const c = corpoObj(await ctx.corpo());
      if (c.site !== undefined && (typeof c.site !== "string" || c.site.length > 300 || !hostDoSite(c.site))) throw new ErroDeDominio("entrada_invalida");
      const site = c.site as string | undefined;
      await comCausa(ctx, async (): Promise<RespostaTrazerDoChrome> => {
        const r = await navegadores.trazerDoChrome(ctx.escopo, ctx.params.id!, site);
        return { ok: true, ...r };
      });
    } },
    /** L4: o código de uso único, do campo privado do cartão direto para a página. */
    { metodo: "POST", acao: "navegador.codigo", padrao: /^\/agentes\/(?<id>[^/]+)\/navegador\/codigo$/, async handler(ctx) {
      const c = corpoObj(await ctx.corpo());
      if (typeof c.decisaoId !== "string" || !UUID.test(c.decisaoId) || !codigoValido(c.codigo)) throw new ErroDeDominio("entrada_invalida");
      const decisaoId = c.decisaoId;
      const codigo = c.codigo;
      await comCausa(ctx, async () => ({ ok: true, vista: await navegadores.enviarCodigo(ctx.escopo, ctx.params.id!, decisaoId, codigo) }));
    } },
    /** L5: "Guardar no cofre?" depois que a pessoa entrou digitando. */
    { metodo: "POST", acao: "navegador.guardar_login", padrao: /^\/agentes\/(?<id>[^/]+)\/navegador\/guardar-login$/, async handler(ctx) {
      const c = corpoObj(await ctx.corpo());
      if (typeof c.guardar !== "boolean" || (c.destino !== undefined && !ehFonte(c.destino)) || (c.guardar && c.destino === undefined)) throw new ErroDeDominio("entrada_invalida");
      const guardar = c.guardar;
      const destino: FonteCofre = ehFonte(c.destino) ? c.destino : "nod";
      await comCausa(ctx, async () => ({ ok: true, vista: await navegadores.guardarLogin(ctx.escopo, ctx.params.id!, guardar, destino) }));
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
