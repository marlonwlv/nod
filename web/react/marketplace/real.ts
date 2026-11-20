import type { Conector } from "../../../src/contracts/conector.ts";
import type { Estado } from "../../estado/reducer.ts";
import type { Api } from "../../lib/api.ts";
import { ErroApi } from "../../lib/erro-api.ts";
import type { NivelPedido } from "../../lib/acessos-otimistas.ts";
import type { AcessosDoApp } from "../../telas/acessos-do-app.ts";
import { conectorDoApp, meusBots, nivelDoBot, situacaoDoApp, type SituacaoApp } from "../../telas/app-acesso.ts";
import { fonteDoLogo } from "../../telas/marketplace.ts";
import { notasGenericas, resultadoDoErro } from "./modelo.ts";
import { ErroDoFormulario, type AcessosDoConector, type ApiDoMarketplace, type AppDaVitrine, type BotDaVitrine, type FotoDoMarketplace, type ReciboDoLote } from "./tipos.ts";

/**
 * O adaptador real do Marketplace em modal: lê o estado do reducer com os MESMOS helpers da tela antiga
 * (web/telas/app-acesso.ts: `situacaoDoApp`, `conectorDoApp`, `nivelDoBot`, `meusBots`) e age pelos fluxos de sempre do
 * main.ts (o login de web/lib/conexao.ts, o nível otimista, o lote e o padrão do ADA-241). A única coisa nova é a
 * conexão com a chave (api.ts: `camposDoApp`, `conectarComChave`).
 *
 * A foto só muda de objeto quando algo que o modal mostra mudou: o main.ts chama `avisar()` a cada render, e um frame
 * do SSE que não mexe em app, bot ou acesso devolve a mesma foto (os apps iguais são os mesmos objetos, para as linhas
 * em memo não redesenharem).
 */

export type DepsDoMarketplaceReal = {
  estado: () => Estado;
  api: () => Api | null;
  /** O "Conectar" de sempre (main.ts `iniciarConexao`): chamado dentro do clique. */
  iniciarConexao: (slug: string) => void;
  cancelarConexao: (slug: string) => void;
  /** Carrega o padrão e o "segue o padrão" do conector (GET conectores/:id/acessos), como a gaveta fazia ao abrir. */
  garantirAcessos: (conectorId: string) => void;
  acessos: (conectorId: string) => AcessosDoApp | null;
  definirNivel: (agenteId: string, conectorId: string, nivel: NivelPedido) => void;
  aplicarLote: (conectorId: string, nivel: NivelPedido, bots: "todos" | string[], confirmado: boolean) => Promise<ReciboDoLote | null>;
  desfazerLote: (conectorId: string, recibo: ReciboDoLote) => Promise<string | null>;
  desconectar: (conectorId: string) => Promise<void>;
  definirPadrao: (conectorId: string, nivel: NivelPedido, confirmado: boolean) => Promise<void>;
  /** A chave conectou (ou entrou sem resposta): o main relê conectores, frota e concessões. */
  conectou: (conectorId: string) => void;
  abrirAvancado: () => void;
};

const SEM_NIVEIS: Readonly<Record<string, never>> = Object.freeze({});

/** O que parou, na linha de "Precisa de atenção" (Paper D1). */
export function motivoDaAtencao(nome: string, chave: boolean, c: Pick<Conector, "ultimaFalha"> | undefined): string {
  const f = c?.ultimaFalha;
  if (f?.causa === "acesso_recusado") return chave ? `A chave parou de funcionar · foi apagada ou trocada no ${nome}` : `O ${nome} recusou o acesso · entre de novo para liberar`;
  if (f?.motivo === "timeout_transporte") return `O ${nome} parou de responder · demorou demais para atender`;
  if (f) return `O ${nome} não está respondendo`;
  return chave ? "A conexão caiu · cole a chave de novo" : "A conexão caiu · entre de novo";
}

const mesmoLogin = (a: AppDaVitrine["login"], b: AppDaVitrine["login"]): boolean => a === b || (!!a && !!b && a.url === b.url && a.falhou === b.falhou && a.semJanela === b.semJanela);
const mesmosNiveis = (a: AppDaVitrine["niveis"], b: AppDaVitrine["niveis"]): boolean => {
  if (a === b) return true;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};
export function mesmoApp(a: AppDaVitrine, b: AppDaVitrine): boolean {
  return a.slug === b.slug && a.nome === b.nome && a.descricao === b.descricao && a.categoria === b.categoria && a.chave === b.chave && a.logo === b.logo
    && a.situacao === b.situacao && a.conectorId === b.conectorId && a.desligado === b.desligado && a.falha === b.falha && a.recomendado === b.recomendado
    && mesmoLogin(a.login, b.login) && mesmosNiveis(a.niveis, b.niveis);
}
const mesmoBot = (a: BotDaVitrine, b: BotDaVitrine): boolean => a.id === b.id && a.nome === b.nome && a.titulo === b.titulo && a.forma === b.forma && a.cor === b.cor;
const mesmosAcessos = (a: AcessosDoConector | undefined, b: AcessosDoConector | undefined): boolean =>
  a === b || (!!a && !!b && a.padrao === b.padrao && a.seguePadrao.size === b.seguePadrao.size && [...a.seguePadrao].every((id) => b.seguePadrao.has(id)));

/** Junta a foto nova à velha: o que não mudou continua o mesmo objeto; nada mudou → a foto velha. */
export function reaproveitar(velha: FotoDoMarketplace | null, nova: FotoDoMarketplace): FotoDoMarketplace {
  if (!velha) return nova;
  const antes = new Map(velha.apps.map((a) => [a.slug, a]));
  let mudou = velha.apps.length !== nova.apps.length || velha.total !== nova.total || velha.composioConfigurado !== nova.composioConfigurado;
  const apps = nova.apps.map((a, i) => {
    const v = antes.get(a.slug);
    if (v && mesmoApp(v, a)) { if (velha.apps[i] !== v) mudou = true; return v; }
    mudou = true;
    return a;
  });
  const bots = velha.bots.length === nova.bots.length && nova.bots.every((b, i) => mesmoBot(b, velha.bots[i] as BotDaVitrine)) ? velha.bots : nova.bots;
  if (bots !== velha.bots) mudou = true;
  const chaves = new Set([...Object.keys(velha.acessos), ...Object.keys(nova.acessos)]);
  const acessosIguais = [...chaves].every((k) => mesmosAcessos(velha.acessos[k], nova.acessos[k]));
  if (!acessosIguais) mudou = true;
  return mudou ? { ...nova, apps, bots, acessos: acessosIguais ? velha.acessos : nova.acessos } : velha;
}

export function montarFoto(e: Estado, acessos: (conectorId: string) => AcessosDoApp | null): FotoDoMarketplace {
  const bots: BotDaVitrine[] = meusBots(e).map((a) => ({ id: a.id, nome: a.nome, titulo: a.titulo, forma: a.forma, cor: a.cor }));
  const porConector: Record<string, AcessosDoConector | undefined> = {};
  const apps = e.marketplace.map((app): AppDaVitrine => {
    const c = conectorDoApp(e, app.slug);
    const situacao: SituacaoApp = situacaoDoApp(e, app.slug);
    const chave = app.conexao === "chave";
    const desligado = !!c && !c.habilitado && situacao === "nao_conectado";
    const login = e.conectando[app.slug];
    if (c) {
      const a = acessos(c.id);
      if (a) porConector[c.id] = { padrao: a.padrao, seguePadrao: a.seguePadrao };
    }
    return {
      slug: app.slug,
      nome: app.nome,
      descricao: app.descricao,
      categoria: app.categoria,
      chave,
      logo: fonteDoLogo(e, app.slug),
      situacao,
      conectorId: c?.id ?? null,
      desligado,
      falha: situacao === "atencao" ? motivoDaAtencao(app.nome, chave, c) : null,
      login: login ? { url: login.url, falhou: login.falhou, semJanela: login.semJanela === true } : null,
      niveis: c && (situacao !== "nao_conectado" || desligado) ? Object.fromEntries(bots.map((b) => [b.id, nivelDoBot(e, b.id, c)])) : SEM_NIVEIS,
      // A curadoria (APPS_MARKETPLACE) é o que o nod recomenda; o catálogo público do Composio fica para a busca.
      recomendado: app.doCatalogo !== true,
    };
  });
  return { apps, total: e.marketplace.length, bots, acessos: porConector, composioConfigurado: e.composioConfigurado };
}

export function criarApiReal(deps: DepsDoMarketplaceReal): ApiDoMarketplace & { avisar: () => void } {
  const ouvintes = new Set<() => void>();
  let foto: FotoDoMarketplace | null = null;
  const montar = (): FotoDoMarketplace => reaproveitar(foto, montarFoto(deps.estado(), deps.acessos));
  return {
    ler() {
      foto ??= montar();
      return foto;
    },
    assinar(ouvinte) {
      ouvintes.add(ouvinte);
      return () => { ouvintes.delete(ouvinte); };
    },
    avisar() {
      if (ouvintes.size === 0) { foto = null; return; }
      const nova = montar();
      if (nova === foto) return;
      foto = nova;
      for (const o of [...ouvintes]) o();
    },
    async campos(slug) {
      const api = deps.api();
      if (!api) throw new ErroDoFormulario("indisponivel");
      try {
        const r = await api.camposDoApp(slug);
        return { campos: r.campos.map((c) => ({ nome: c.nome, rotulo: c.rotulo, descricao: c.descricao, segredo: c.segredo, obrigatorio: c.obrigatorio })) };
      } catch (e) {
        throw new ErroDoFormulario(e instanceof ErroApi && e.codigo === "integracao_nao_configurada" ? "nao_configurado" : "indisponivel");
      }
    },
    async conectarComChave(slug, valores) {
      const api = deps.api();
      if (!api) return { tipo: "rede" };
      try {
        const r = await api.conectarComChave(slug, valores);
        deps.conectou(r.conectorId);
        return r.conectado ? { tipo: "conectado", conectorId: r.conectorId } : { tipo: "sem_resposta", conectorId: r.conectorId };
      } catch (e) {
        return resultadoDoErro(e);
      }
    },
    conectarLogin: (slug) => deps.iniciarConexao(slug),
    cancelarLogin: (slug) => deps.cancelarConexao(slug),
    abrirAcessos: (conectorId) => deps.garantirAcessos(conectorId),
    definirNivel: (agenteId, conectorId, nivel) => deps.definirNivel(agenteId, conectorId, nivel),
    aplicarLote: (conectorId, nivel, bots, confirmado) => deps.aplicarLote(conectorId, nivel, bots === "todos" ? "todos" : [...bots], confirmado),
    desfazerLote: (conectorId, recibo) => deps.desfazerLote(conectorId, recibo),
    desconectar: (conectorId) => deps.desconectar(conectorId),
    definirPadrao: (conectorId, nivel, confirmado) => deps.definirPadrao(conectorId, nivel, confirmado),
    notas: (app) => notasGenericas(app.nome),
    abrirAvancado: () => deps.abrirAvancado(),
  };
}
