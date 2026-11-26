import type { ChavesDoTenant } from "../../cofre/chaves-do-tenant.ts";
import type { TestarChave } from "../../cofre/testar-chave.ts";
import { appDoCofre } from "../../../domain/apps-do-cofre.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { listarCofre } from "../../../use-cases/cofre.ts";
import { appDaEntrada, criarChave, detalheDaChave, mudarAcessoDaChave, removerChave, trocarChave } from "../../../use-cases/cofre-chaves.ts";
import { valorDeCredencial } from "../../../use-cases/guardar-credencial.ts";
import type { Rota } from "../roteador.ts";
import { corpoObjeto, criarExecutor, type DepsRotas } from "./executar-caso.ts";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export type OpcoesRotasCofre = { chaves: ChavesDoTenant; testar: TestarChave };

/**
 * O teste no app conhecido, antes da transação que guarda (Paper C3 e O2/O3). Recusada = integracao_autenticacao
 * ("A Orgo recusou essa chave"); sem resposta = conector_indisponivel ("Tentar de novo"). Nada é gravado em nenhum.
 */
export async function testarNoApp(o: OpcoesRotasCofre, appId: string | null, valor: string, agora: () => number): Promise<number | null> {
  const app = appDoCofre(appId);
  if (!app) return null;
  const veredito = await o.testar(app.id, valor);
  if (veredito === "recusada") throw new ErroDeDominio("integracao_autenticacao", { cause: `${app.nome} recusou a chave` });
  if (veredito === "indisponivel") throw new ErroDeDominio("conector_indisponivel", { cause: `${app.nome} não respondeu` });
  return agora();
}

/**
 * Configurações › Cofre (Paper 07; ADR-195, Entrega 3, Paper C1–C3):
 *   - GET /cofre: as chaves do cofre (com quem usa e o último uso) e as credenciais antigas dos cartões;
 *   - GET /cofre/itens/:id: a chave aberta, quem pode usar e o uso recente;
 *   - POST /cofre/chaves: Nova chave (testada antes quando o app é conhecido);
 *   - POST /cofre/itens/:id/trocar: o valor novo da mesma chave;
 *   - PATCH e DELETE /cofre/itens/:id/acessos/:agenteId: Sempre, Perguntar antes ou tirar o acesso de um bot;
 *   - DELETE /cofre/itens/:id: Remover chave.
 * O item já guardado mora em `itens` (o segmento `chaves` das rotas é o das chaves de máquina).
 * O valor entra pelo corpo e vai direto ao cofre: não volta em resposta nenhuma, e o roteador não loga corpo.
 */
export function criarRotasCofre(d: DepsRotas, o: OpcoesRotasCofre): Rota[] {
  const executar = criarExecutor(d);
  const agora = d.agora ?? (() => Date.now());
  return [
    { metodo: "GET", padrao: /^\/cofre$/, async handler(ctx) { ctx.json(200, await executar(ctx.escopo, listarCofre, {})); } },
    { metodo: "GET", padrao: new RegExp(`^\\/cofre\\/itens\\/(?<id>${UUID})$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, detalheDaChave, { itemId: ctx.params.id ?? "" }));
    } },
    { metodo: "POST", acao: "cofre.criar_chave", padrao: /^\/cofre\/chaves$/, async handler(ctx) {
      const corpo = corpoObjeto(await ctx.corpo());
      // Valida o que dá antes de mandar o valor ao app: nome, app e o próprio valor.
      const app = appDaEntrada(corpo.appId);
      const valor = valorDeCredencial(corpo.valor);
      const testadaEm = await testarNoApp(o, app?.id ?? null, valor, agora);
      const chave = await executar(ctx.escopo, criarChave, { appId: app?.id ?? null, app: corpo.app, nome: corpo.nome, valor, quem: corpo.quem, dicas: corpo.dicas, testadaEm, chaves: o.chaves });
      ctx.json(201, { chave });
    } },
    { metodo: "POST", acao: "cofre.trocar_chave", padrao: new RegExp(`^\\/cofre\\/itens\\/(?<id>${UUID})\\/trocar$`), async handler(ctx) {
      const itemId = ctx.params.id ?? "";
      const valor = valorDeCredencial(corpoObjeto(await ctx.corpo()).valor);
      // Qual app testar sai da chave guardada (a pessoa não escolhe na troca).
      const { chave: atual } = await executar(ctx.escopo, detalheDaChave, { itemId });
      // A chave do time de outra pessoa nem vai ao app: só quem guardou troca.
      if (!atual.sua) throw new ErroDeDominio("nao_permitido");
      const testadaEm = await testarNoApp(o, atual.appId, valor, agora);
      const chave = await executar(ctx.escopo, trocarChave, { itemId, valor, testadaEm, chaves: o.chaves });
      ctx.json(200, { chave });
    } },
    { metodo: "PATCH", acao: "cofre.mudar_acesso", padrao: new RegExp(`^\\/cofre\\/itens\\/(?<id>${UUID})\\/acessos\\/(?<agente>${UUID})$`), async handler(ctx) {
      const corpo = corpoObjeto(await ctx.corpo());
      const chave = await executar(ctx.escopo, mudarAcessoDaChave, { itemId: ctx.params.id ?? "", agenteId: ctx.params.agente ?? "", modo: corpo.modo ?? "" });
      ctx.json(200, { chave });
    } },
    { metodo: "DELETE", acao: "cofre.mudar_acesso", padrao: new RegExp(`^\\/cofre\\/itens\\/(?<id>${UUID})\\/acessos\\/(?<agente>${UUID})$`), async handler(ctx) {
      const chave = await executar(ctx.escopo, mudarAcessoDaChave, { itemId: ctx.params.id ?? "", agenteId: ctx.params.agente ?? "", modo: null });
      ctx.json(200, { chave });
    } },
    { metodo: "DELETE", acao: "cofre.remover_chave", padrao: new RegExp(`^\\/cofre\\/itens\\/(?<id>${UUID})$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, removerChave, { itemId: ctx.params.id ?? "" }));
    } },
  ];
}
