import { randomUUID } from "node:crypto";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import { DESTA_VEZ_MS, FERRAMENTAS_SEU_COMPUTADOR, SEU_COMPUTADOR_SO_LEITURA, TIPOS_RESPOSTA_SEU_COMPUTADOR, type AcaoSeuComputador, type AppDoComputador, type NomeFerramentaSeuComputador, type RespostaSeuComputador } from "../../contracts/seu-computador.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { errosDoSchema } from "../../domain/schema-args.ts";
import { idDeAppValido, liberadosAgora, motivoDoBloqueio, nomeDoAparelho, textoDoPedido, type PlataformaPessoa } from "../../domain/seu-computador.ts";
import { log } from "../../obs/log.ts";
import type { Escopo } from "../../shared/types.ts";
import type { ResultadoChamada } from "../../use-cases/chamar-ferramenta.ts";
import { pedirAprovacaoComputador } from "../../use-cases/pedir-aprovacao.ts";
import { registrarNegacao } from "../../use-cases/registrar-negacao.ts";
import type { Deps } from "../../use-cases/tipos.ts";
import type { CanalNavegador } from "../navegador/canal-maquina.ts";
import { turnoPermitido } from "./computadores.ts";

/**
 * O portão do computador da pessoa (ADR-197). O servidor decide tudo — plano, parada, esquema, só leitura, a liberação
 * do app para AQUELE bot — e a ação vai pela fila da máquina (a mesma do navegador do bot, ADR-190) ao Mac ou ao PC da
 * pessoa que está com o nod aberto e anuncia `seu_computador`. Lá, o cua-driver roda em `bounded` só com os apps que
 * este bot pode usar; o app que falta volta `precisa_liberar` e vira o cartão "A {bot} quer usar seu Mac" (uma
 * aprovação com o item `seu_computador`, três saídas: desta vez, Sempre no {app}, Agora não).
 *
 * A vista (o último quadro da janela e os passos) fica em memória por bot, para a aba "Seu Mac" do painel.
 */

/** definido em 2026-11-26: uma ação no computador da pessoa tem até 90 s (abrir um app pesado leva ~10 s). */
export const PRAZO_ACAO_MS = 90_000;
const PASSOS_MAX = 30;
const RESULTADOS_MAX = 500;

export type PassoSeuComputador = { acao: AcaoSeuComputador; app: string | null; efeito: string | null; ok: boolean; em: number };
export type VistaSeuComputador = {
  agenteId: string;
  aparelho: "Mac" | "PC";
  app: string | null;
  /** O último quadro da janela (data URL JPEG/PNG); some quando a pessoa para ou depois de 30 min. */
  quadro: string | null;
  passos: PassoSeuComputador[];
  ativoEm: number;
};

/** A ação liberada no cartão, cifrada no item da decisão (só este portão a lê). */
type AcaoPendente = { agenteId: string; turnoId: string; plataforma: PlataformaPessoa; app: AppDoComputador };

export type OpcoesSeuComputador = {
  dentro: <T>(escopo: Escopo, fn: (d: Deps) => Promise<T>) => Promise<T>;
  canal: CanalNavegador;
  cifrar(s: string): string;
  decifrar(s: string): string;
  agora?: () => number;
  pedirAprovacao?: typeof pedirAprovacaoComputador;
  aoMudar?(escopo: Escopo, vista: VistaSeuComputador): void;
  prazoMs?: number;
};

export type SeuComputadorGateway = ReturnType<typeof criarSeuComputador>;

const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ehNome = (n: string): n is NomeFerramentaSeuComputador => Object.hasOwn(FERRAMENTAS_SEU_COMPUTADOR, n);

/** A resposta da máquina, conferida (forma estranha = falhou). */
export function lerResposta(v: unknown): RespostaSeuComputador {
  const r = obj(v);
  if (typeof r.tipo !== "string" || !(TIPOS_RESPOSTA_SEU_COMPUTADOR as readonly string[]).includes(r.tipo)) return { tipo: "falhou", texto: "resposta estranha do computador" };
  return r as RespostaSeuComputador;
}

export function criarSeuComputador(o: OpcoesSeuComputador) {
  const agora = o.agora ?? (() => Date.now());
  const aprovar = o.pedirAprovacao ?? pedirAprovacaoComputador;
  const vistas = new Map<string, VistaSeuComputador & { escopo: Escopo }>();
  const resultados = new Map<string, { pessoaId: string; cifrado: string }>();

  /** O Mac ou PC da pessoa que atende agora (o de contato mais recente). */
  function aparelho(escopo: Escopo): { maquinaId: string; plataforma: PlataformaPessoa; nome: string } | null {
    const m = o.canal.ligadas(escopo).find((x) => (x.plataforma === "darwin" || x.plataforma === "win32") && x.recursos.includes("seu_computador"));
    return m ? { maquinaId: m.maquinaId, plataforma: m.plataforma as PlataformaPessoa, nome: m.nome } : null;
  }

  function vistaDe(escopo: Escopo, agenteId: string, plataforma: PlataformaPessoa): VistaSeuComputador & { escopo: Escopo } {
    const k = `${escopo.tenantId}:${agenteId}`;
    let v = vistas.get(k);
    if (!v || v.escopo.pessoaId !== escopo.pessoaId) {
      v = { escopo, agenteId, aparelho: nomeDoAparelho(plataforma), app: null, quadro: null, passos: [], ativoEm: agora() };
      vistas.set(k, v);
    }
    return v;
  }

  function registrarPasso(escopo: Escopo, agenteId: string, plataforma: PlataformaPessoa, acao: AcaoSeuComputador, r: RespostaSeuComputador): void {
    if (acao === "apps") return;
    const v = vistaDe(escopo, agenteId, plataforma);
    const app = r.tipo === "feito" ? r.app?.nome ?? v.app : r.tipo === "precisa_liberar" || r.tipo === "bloqueado" ? r.app.nome : v.app;
    v.app = app ?? null;
    v.ativoEm = agora();
    if (r.tipo === "feito" && r.imagem) v.quadro = `data:${r.imagem.mimeType};base64,${r.imagem.data}`;
    if (r.tipo === "parado") v.quadro = null;
    v.passos.push({ acao, app: app ?? null, efeito: r.tipo === "feito" ? r.efeito ?? null : null, ok: r.tipo === "feito", em: agora() });
    if (v.passos.length > PASSOS_MAX) v.passos.splice(0, v.passos.length - PASSOS_MAX);
    const { escopo: _e, ...publica } = v;
    try { o.aoMudar?.(escopo, publica); } catch (e) { log("aviso", "seu_computador_aviso_falhou", { erro: e instanceof Error ? e.name : "desconhecido" }); }
  }

  const resposta = (conteudo: unknown, isError = false, confianca: "confiavel" | "nao_confiavel" = "confiavel"): ResultadoChamada =>
    ({ ok: true, conteudo: typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo), confianca, ...(isError ? { isError: true } : {}) });

  async function pedirLiberacao(d: Deps, plano: PlanoTurno, plataforma: PlataformaPessoa, app: AppDoComputador, motivo: string | null, bot: string): Promise<ResultadoChamada> {
    const t = textoDoPedido({ bot, app: app.nome, motivo, plataforma });
    const acao: AcaoPendente = { agenteId: plano.agenteId, turnoId: plano.turnoId, plataforma, app };
    const pedido = await aprovar(d, { turnoId: plano.turnoId, agenteId: plano.agenteId, conversaId: plano.conversaId, resumo: t.texto, itens: [{ texto: t.titulo, destino: { conector: "seu_computador", ferramenta: "executar", argumentos: { acaoId: randomUUID(), acao: o.cifrar(JSON.stringify(acao)), app: app.nome, aparelho: nomeDoAparelho(plataforma) } } }] });
    if (pedido.events?.length) await d.repos.events.gravarComOutbox(pedido.events);
    if (pedido.data.estado === "recusada") return resposta({ erro: "recusada", erros: pedido.data.erros, instrucao: pedido.data.instrucao }, true);
    if (pedido.data.estado !== "pendente") throw new ErroDeDominio("estado_invalido");
    return { aguardar: pedido.data.decisao_id };
  }

  return {
    /** O aparelho da pessoa que atende agora (o plano oferece as ferramentas só com ele). */
    disponivel(escopo: Escopo): { plataforma: PlataformaPessoa; nome: string } | null {
      const a = aparelho(escopo);
      return a ? { plataforma: a.plataforma, nome: a.nome } : null;
    },

    vista(escopo: Escopo, agenteId: string): VistaSeuComputador | null {
      const v = vistas.get(`${escopo.tenantId}:${agenteId}`);
      if (!v || v.escopo.pessoaId !== escopo.pessoaId) return null;
      const { escopo: _e, ...publica } = v;
      return publica;
    },

    async chamar(escopo: Escopo, plano: PlanoTurno, nome: string, argumentos: unknown): Promise<ResultadoChamada> {
      const args = obj(argumentos);
      type Enviar = { enviar: { maquinaId: string; plataforma: PlataformaPessoa; acao: AcaoSeuComputador; apps: AppDoComputador[]; bot: string } };
      const passo1 = await o.dentro(escopo, async (d): Promise<ResultadoChamada | Enviar> => {
        const negar = async (motivo: "parada_ativa" | "fora_do_catalogo" | "args_invalidos" | "capacidade_desligada" | "plano_expirado") => {
          const n = await registrarNegacao(d, { turnoId: plano.turnoId, agenteId: plano.agenteId, conversaId: plano.conversaId, nome, motivo, classe: "ferramenta_negada", autoria: plano.autoria });
          if (n.events?.length) await d.repos.events.gravarComOutbox(n.events);
          return { ok: false as const, negacao: n.data };
        };
        if (plano.tenantId !== escopo.tenantId || plano.autoria.conta_de_execucao !== escopo.pessoaId || !ehNome(nome) || !plano.catalogo.ferramentas.some((f) => f.nome === nome && f.origem === "seu_computador")) return negar("fora_do_catalogo");
        if (plano.expiraEm <= d.agora()) return negar("plano_expirado");
        if (!await turnoPermitido(d, plano.turnoId, plano.agenteId)) return negar("parada_ativa");
        if (errosDoSchema(FERRAMENTAS_SEU_COMPUTADOR[nome], argumentos).length) return negar("args_invalidos");
        const agente = await d.repos.agentes.buscar(plano.agenteId);
        if (agente?.soLeitura === true && !SEU_COMPUTADOR_SO_LEITURA.includes(nome)) return negar("capacidade_desligada");
        const a = aparelho(escopo);
        if (!a) {
          return resposta({ erro: "indisponivel", instrucao: "O Mac ou PC da pessoa não está com o app do nod aberto agora (ou o app está desatualizado). Nada foi feito. Diga em uma frase que precisa do nod aberto no computador dela para mexer no app e siga com o que dá sem isso." }, true);
        }
        const apps = liberadosAgora(await d.repos.seuComputadorApps.doBot(plano.agenteId, a.plataforma), d.agora());
        const acao = nome.slice("seu_computador_".length) as AcaoSeuComputador;
        return { enviar: { maquinaId: a.maquinaId, plataforma: a.plataforma, acao, apps, bot: agente?.nome ?? "O bot" } };
      });
      if (!("enviar" in passo1)) return passo1;
      const e = passo1.enviar;
      const r = await o.canal.enviar(escopo, e.maquinaId, { tipo: "seu_computador", agenteId: plano.agenteId, pedido: { acao: e.acao, args, apps: e.apps, bot: e.bot } }, o.prazoMs ?? PRAZO_ACAO_MS);
      if (!r.ok) {
        log("aviso", "seu_computador_comando_falhou", { motivo: r.motivo });
        return resposta({ erro: r.motivo, instrucao: r.motivo === "tempo_esgotado" ? "O computador da pessoa não respondeu a tempo. Leia a janela de novo (seu_computador_ver) antes de repetir: a ação pode ter acontecido." : "O computador da pessoa não atendeu agora. Nada foi feito; diga em uma frase e siga sem ele." }, true);
      }
      const v = lerResposta(r.valor);
      registrarPasso(escopo, plano.agenteId, e.plataforma, e.acao, v);
      const aparelhoNome = nomeDoAparelho(e.plataforma);
      switch (v.tipo) {
        case "feito": {
          const texto = `${v.texto}${v.efeito === "sem_efeito" ? "\n(O computador diz que nada parece ter mudado: leia de novo antes de repetir.)" : ""}`;
          // Só a leitura leva a imagem ao bot; a das ações vai ao painel (a pessoa vê, o bot lê de novo quando precisar).
          const imagem = e.acao === "ver" && v.imagem ? { imagem: v.imagem } : {};
          return { ok: true, conteudo: texto || "Feito.", confianca: "nao_confiavel", ...imagem };
        }
        case "apps": {
          const liberados = new Set(e.apps.map((x) => x.id));
          return resposta({ apps: v.apps.map((x) => ({ nome: x.nome, aberto: x.aberto, liberado: liberados.has(x.id) })), instrucao: "Use o nome do app nas outras ferramentas. O app ainda não liberado pede a autorização da pessoa na primeira vez." }, false, "nao_confiavel");
        }
        case "precisa_liberar": {
          if (!idDeAppValido(v.app.id, e.plataforma) || motivoDoBloqueio(v.app, e.plataforma)) return resposta({ erro: "bloqueado", instrucao: "Este app fica de fora do nod. Peça para a pessoa fazer esta parte." }, true);
          const motivo = typeof args.motivo === "string" ? args.motivo : null;
          return o.dentro(escopo, (d) => pedirLiberacao(d, plano, e.plataforma, { id: v.app.id, nome: v.app.nome.slice(0, 120) }, motivo, e.bot));
        }
        case "nao_achei":
          return resposta({ erro: "app_nao_encontrado", parecidos: v.parecidos, instrucao: v.parecidos.length ? "Nenhum app com esse nome. Tente um dos parecidos ou chame seu_computador_apps." : `Nenhum app com esse nome no ${aparelhoNome} da pessoa. Chame seu_computador_apps para ver os nomes.` }, true);
        case "bloqueado":
          return resposta({ erro: "bloqueado", app: v.app.nome, instrucao: v.motivo }, true);
        case "sem_permissao": {
          const faltam = v.falta.map((f) => (f === "acessibilidade" ? "Acessibilidade" : "Gravação de Tela")).join(" e ");
          return resposta({ erro: "sem_permissao", falta: v.falta, instrucao: `O macOS ainda não deixou o nod usar os apps: falta ligar ${faltam} para o nod em Ajustes do Sistema › Privacidade e Segurança. Diga isso à pessoa em uma frase (o nod mostra o atalho em Ajustes › Seu Mac) e espere ela ligar; nada foi feito.` }, true);
        }
        case "parado":
          return resposta({ erro: "parado_pela_pessoa", instrucao: `A pessoa apertou Parar no ${aparelhoNome} dela. Não mexa mais no computador dela neste pedido; diga em uma frase onde parou.` }, true);
        case "pessoa_usando":
          return resposta({ erro: "pessoa_usando", app: v.app.nome, instrucao: `A pessoa está usando o ${v.app.nome} agora; nada foi feito. Não dispute com ela: diga em uma frase que continua quando ela soltar o app e tente de novo daqui a pouco.` }, true);
        case "tela_bloqueada":
          return resposta({ erro: "tela_bloqueada", instrucao: `A tela do ${aparelhoNome} da pessoa está bloqueada (ou no descanso de tela). Nada foi feito. Peça em uma frase para ela desbloquear o ${aparelhoNome} e encerre o turno; quando ela responder, continue.` }, true);
        case "falhou":
          return resposta({ erro: "acao_falhou", detalhe: v.texto.slice(0, 2000), instrucao: "A ação não aconteceu. Leia a janela de novo (seu_computador_ver) e tente outro caminho; não repita igual." }, true, "nao_confiavel");
        case "indisponivel":
          return resposta({ erro: "indisponivel", instrucao: `${v.texto} Nada foi feito; diga em uma frase e siga sem o computador dela.` }, true);
      }
    },

    /** O cartão foi respondido: grava a liberação (Sempre ou desta vez) e deixa o recado para o turno que pediu. */
    async executarAprovado(p: Escopo & { agenteId: string; turnoId: string; acaoId: string; acao: string; lembrar?: boolean }): Promise<void> {
      const acao = JSON.parse(o.decifrar(p.acao)) as AcaoPendente;
      if (acao.agenteId !== p.agenteId || acao.turnoId !== p.turnoId || !idDeAppValido(acao.app.id, acao.plataforma) || motivoDoBloqueio(acao.app, acao.plataforma)) throw new ErroDeDominio("nao_permitido");
      const escopo = { tenantId: p.tenantId, pessoaId: p.pessoaId };
      const ate = p.lembrar ? null : agora() + DESTA_VEZ_MS;
      const ok = await o.dentro(escopo, (d) => d.repos.seuComputadorApps.liberar({ agenteId: p.agenteId, plataforma: acao.plataforma, appId: acao.app.id, appNome: acao.app.nome, ate }, d.agora()));
      if (!ok) throw new ErroDeDominio("nao_permitido");
      if (resultados.size >= RESULTADOS_MAX) resultados.delete(resultados.keys().next().value!);
      const texto = `A pessoa liberou o ${acao.app.nome}${p.lembrar ? " de vez (Sempre)" : " para esta tarefa"}. Chame de novo a ferramenta que pediu e siga.`;
      resultados.set(p.acaoId, { pessoaId: p.pessoaId, cifrado: o.cifrar(texto) });
    },

    /** O recado da liberação, entregue uma vez ao turno que esperava. */
    resultadoDaAcao(escopo: Escopo, acaoId: string): string | null {
      const r = resultados.get(acaoId);
      if (!r || r.pessoaId !== escopo.pessoaId) return null;
      resultados.delete(acaoId);
      return o.decifrar(r.cifrado);
    },

    /** "Parar" pelo nod (a pílula, o chat): esquece o quadro; o aparelho para pela ilha ou pelo próximo comando. */
    esquecerVista(escopo: Escopo, agenteId: string): void {
      const k = `${escopo.tenantId}:${agenteId}`;
      const v = vistas.get(k);
      if (v && v.escopo.pessoaId === escopo.pessoaId) vistas.delete(k);
    },
  };
}
