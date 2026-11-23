import type { BotaoDoDesvio, PayloadDesvio } from "../../src/contracts/desvio.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { Estado } from "../estado/reducer.ts";
import { avisoDeEstado } from "../lib/aviso-estado.ts";
import { botao, esc } from "../lib/render.ts";
import type { DadosDoEncolhido } from "./cartao-encolhido.ts";

/**
 * Lote B das Jornadas da IA ("Mandar uma mensagem", 2026-11-22; Paper, momento B): o que a conversa mostra num desvio da
 * mensagem. O servidor já escreve a frase pela tabela única (src/domain/desvios-da-conversa.ts); a tela só desenha:
 * - a LINHA discreta (o nod resolveu sozinho, B3): no centro, como as outras linhas de sistema, com no máximo um link;
 * - o CARTÃO (o nod parou): o aviso do design system (`avisoDeEstado`), em "alerta" quando a mensagem espera e sai sozinha,
 *   em "erro" quando precisa da pessoa; os botões ligam às ações que a tela já tem (o mesmo `data-act` do resto do app).
 */
/**
 * O ciclo do cartão (auditoria de 2026-11-22: "o card precisa fechar quando a conversa segue ou quando alguma ação nele
 * acontece"), no padrão do chat limpo e da ADR-191:
 * - `aberto`: o cartão, esperando a pessoa (ou a mensagem que sai sozinha);
 * - `agindo`: a pessoa clicou e o pedido está no ar (ou a IA está sendo reinstalada): o botão gira, os outros param;
 * - `fechado`: o cartão encolhe no lugar numa linha (`renderCartaoEncolhido`, tela 06 do Paper) — "✓ Respondido pelo
 *   ChatGPT", "✓ A mensagem saiu" quando o bot respondeu; "↓ Você seguiu a conversa" quando a pessoa mandou outra mensagem
 *   (como o pedido dispensado da ADR-191); "× Cancelada" no Cancelar.
 * A fase sai da conversa (o que veio depois do cartão) e do clique desta aba; recarregar a tela não volta a abrir o cartão.
 */
export type FaseDoCartao =
  | { fase: "aberto" }
  | { fase: "agindo"; acao: string; agora: string }
  | { fase: "fechado"; marca: "ok" | "sem-resposta" | null; resultado: string };

const ABERTO: FaseDoCartao = { fase: "aberto" };

export function faseDoCartao(m: Pick<Mensagem, "id" | "conversaId" | "criadoEm">, botoes: readonly BotaoDoDesvio[], estado: Pick<Estado, "conversas" | "cancelando" | "desviosAgindo">): FaseDoCartao {
  const c = estado.conversas[m.conversaId];
  const mensagens = c?.mensagens ?? [];
  const i = mensagens.findIndex((x) => x.id === m.id);
  const depois = i >= 0 ? mensagens.slice(i + 1) : [];
  const local = estado.desviosAgindo[m.id];
  const espera = botoes.find((b) => b.acao === "cancelar")?.dados?.turnoId;
  const fase = espera ? estado.cancelando[espera]?.fase : undefined;
  if (espera && (c?.turnosCancelados.some((t) => t.id === espera) || fase === "cancelando" || fase === "cancelada" || fase === "voltou")) return { fase: "fechado", marca: null, resultado: "Cancelada" };
  // A fala do bot depois do cartão: a mensagem saiu (pelo botão, pela espera ou pela outra conta).
  if (depois.some((x) => x.autoria.autor_tipo === "agente" && x.kind === "texto" && !x.parcial)) return { fase: "fechado", marca: "ok", resultado: local?.feito ?? "A mensagem saiu" };
  // A mensagem nova da pessoa: ela seguiu sem o cartão (a espera, se havia, foi junto com a nova).
  if (depois.some((x) => x.autoria.autor_tipo === "pessoa" && x.kind === "texto")) return { fase: "fechado", marca: "sem-resposta", resultado: "Você seguiu a conversa" };
  // O turno refeito já roda (o clique deu certo, ou a espera saiu): o cartão fecha e o bot mostra que está trabalhando.
  if ((c?.turnosEmCurso ?? []).some((t) => t.desde > m.criadoEm)) return { fase: "fechado", marca: "ok", resultado: local?.agora ?? "A mensagem saiu de novo" };
  // Desvio 9: a IA está sendo reinstalada (a linha "Reinstalando…" veio depois): o botão gira até ela abrir.
  if (depois.some((x) => x.payload?.kind === "desvio" && x.payload.desvio === "ia_nao_abriu" && x.payload.forma === "linha")) return { fase: "agindo", acao: "reinstalar_e_tentar", agora: "Reinstalando" };
  if (local?.agindo) return { fase: "agindo", acao: local.acao, agora: local.agora };
  // O clique deu certo e a resposta ainda não veio (o "Rodar no <máquina>" só muda a máquina do turno que espera): o
  // cartão fecha com o que está acontecendo.
  if (local) return { fase: "fechado", marca: "ok", resultado: local.agora };
  return ABERTO;
}

/** O cartão fechado como o encolhido do chat limpo: o título do cartão e o resultado. */
export function encolhidoDoDesvio(m: Pick<Mensagem, "id">, titulo: string, fase: FaseDoCartao): DadosDoEncolhido | null {
  if (fase.fase !== "fechado") return null;
  return { decisaoId: m.id, titulo, resultado: fase.resultado, marca: fase.marca, anuncio: `${fase.resultado}: ${titulo}` };
}

export function desvioNaConversa(m: Pick<Mensagem, "id" | "conversaId">, p: PayloadDesvio, o: { fase?: FaseDoCartao } = {}): string {
  const fase = o.fase ?? ABERTO;
  if (p.forma === "linha") {
    // O link da linha (desvio 12, "Rodar em outra máquina") também diz o que está acontecendo depois do clique.
    // Só o link que muda a conversa tem ciclo; o de navegação ("Entrar de novo") fica, porque a conta continua precisando.
    const b = p.botoes[0];
    const comCiclo = !!b && resultadoDoBotao(b) !== null;
    const escolhido = fase.fase === "fechado" && fase.marca === "ok" && !fase.resultado.startsWith("A mensagem saiu");
    const link = !b ? ""
      : !comCiclo ? ` ${linkDaLinha(m, b)}`
      : fase.fase === "agindo" ? ` <span class="linha-agindo" role="status"><span class="bt-girando" aria-hidden="true"></span>${esc(fase.agora)}…</span>`
      : fase.fase === "fechado" ? (escolhido ? ` <span class="linha-feito">${esc(fase.resultado)}.</span>` : "")
      : ` ${linkDaLinha(m, b)}`;
    return `<div class="linha-centro-wrap"><span class="linha-centro estatica linha-desvio" data-desvio="${esc(p.desvio)}"><span>${esc(p.texto)}${link}</span></span></div>`;
  }
  const botoes = p.botoes.filter((b) => b.acao !== "ver_erro");
  // Paper (momento B, coluna "Depois"): "Ver o erro" é texto na linha dos botões; aberto, o erro vem embaixo.
  const verErro = p.erro && p.botoes.some((b) => b.acao === "ver_erro")
    ? `<details class="aviso-estado-detalhes desvio-erro" data-disclosure="desvio-erro-${esc(m.id)}"><summary>Ver o erro</summary><p>${esc(p.erro)}</p></details>`
    : "";
  const agindo = fase.fase === "agindo" ? fase : null;
  const linha = `${botoes.map((b, i) => botaoDoDesvio(m, b, i === 0 ? "pri" : "sec", agindo)).join("")}${verErro}`;
  const acao = linha ? `<div class="aviso-estado-acoes desvio-acoes">${linha}</div>` : undefined;
  // O cartão do aviso de estado (ds.css): o ponto âmbar quando a mensagem espera sozinha; sem ponto quando o nod parou
  // e a pessoa escolhe.
  return avisoDeEstado({ tom: p.tom === "espera" ? "alerta" : "info", titulo: p.titulo, texto: p.texto, ...(acao ? { acao } : {}), classe: `aviso-desvio desvio-${p.desvio}` });
}

/** O que a linha encolhida diz enquanto o botão roda e depois que a resposta chega. */
function resultadoDoBotao(b: BotaoDoDesvio): { agora: string; feito: string } | null {
  const d = b.dados ?? {};
  switch (b.acao) {
    case "responder_com_outra_ia": {
      const ia = /com (?:o |a )?(.+?)(?: desta vez)?$/.exec(b.rotulo)?.[1] ?? "outra IA";
      return { agora: `Respondendo pelo ${ia}`, feito: `Respondido pelo ${ia}` };
    }
    case "rodar_em_outra_maquina": {
      const maquina = d.maquinaNome ?? b.rotulo.replace(/^Rodar (?:no|na) /, "").replace(/ desta vez$/, "");
      return { agora: `Rodando ${noNa(maquina)}`, feito: `Respondido ${noNa(maquina)}` };
    }
    case "reinstalar_e_tentar":
      return { agora: "Reinstalando", feito: "Reinstalado · a mensagem saiu" };
    default:
      return null;
  }
}

/** O nome da máquina com o artigo dela (VM e máquina são femininas), o mesmo critério de src/domain/desvios-da-conversa.ts. */
const ehFeminina = (nome: string): boolean => /^(vm\b|máquina|maquina)/i.test(nome.trim());
/** "no MacBook do escritório" / "na VM sp-01". */
export const noNa = (nome: string): string => `${ehFeminina(nome) ? "na" : "no"} ${nome}`;
/** "O MacBook do escritório" / "A VM sp-01". */
export const oA = (nome: string): string => `${ehFeminina(nome) ? "A" : "O"} ${nome}`;

/**
 * Os dois cartões que a tela decide sozinha (a web não importa o domínio, ADR-018): o desvio 6 sai do estado das máquinas
 * e o 8, da negação antiga. O texto é o da tabela única (`cartaoDoDesvio`); tests/unit/web/desvio-cartoes.test.ts compara
 * os dois, frase por frase, para nunca divergirem.
 */
export function cartaoSemIaPronta(n: { bot: string; maquina: string }): PayloadDesvio {
  return { kind: "desvio", desvio: "sem_ia_pronta", forma: "cartao", titulo: `Nenhuma IA conectada ${noNa(n.maquina)}`, texto: "A mensagem fica guardada e sai assim que uma conta entrar.", botoes: [{ acao: "conectar_ia", rotulo: "Conectar uma IA" }], espera: { ate: null }, tom: "parada" };
}
export function cartaoSemAcesso(n: { bot: string; ia: string; organizacao?: string | null }): PayloadDesvio {
  return { kind: "desvio", desvio: "sem_acesso", forma: "cartao", titulo: n.organizacao ? `A ${n.organizacao} desligou o ${n.ia} por assinatura` : `A conta do ${n.ia} está sem acesso`, texto: `Era a única conta de ${n.bot}. Conecte outra e a mensagem sai em seguida.`, botoes: [{ acao: "conectar_ia", rotulo: "Conectar outra conta" }], espera: { ate: null }, tom: "parada" };
}

/** O link da linha discreta: o mesmo `linha-link` das outras linhas do chat ("Rodar em <outra> desta vez"). */
function linkDaLinha(m: Pick<Mensagem, "id" | "conversaId">, b: BotaoDoDesvio): string {
  const html = botaoDoDesvio(m, b, "linha");
  return html.replace(/class="bt link"/, 'class="linha-link"');
}

/**
 * Cada botão do cartão vira a ação que a tela já conhece. Os que mudam a conversa levam `data-cartao` (a mensagem do
 * cartão) e o que a linha encolhida vai dizer; com um clique no ar, o botão escolhido gira e os outros param.
 */
function botaoDoDesvio(m: Pick<Mensagem, "id" | "conversaId">, b: BotaoDoDesvio, estilo: "pri" | "sec" | "linha", agindo: { acao: string; agora: string } | null = null): string {
  const html = htmlDoBotao(m, b, estilo);
  const r = resultadoDoBotao(b);
  const marcado = r ? html.replace("<button ", `<button data-cartao="${esc(m.id)}" data-acao="${esc(b.acao)}" data-agora="${esc(r.agora)}" data-feito="${esc(r.feito)}" `) : html;
  if (!agindo || !marcado) return marcado;
  if (b.acao === agindo.acao) return marcado.replace("<button ", '<button aria-busy="true" disabled ').replace(/>([^<]*)<\/button>$/, `><span class="bt-girando" aria-hidden="true"></span>${esc(agindo.agora)}…</button>`);
  return marcado.replace("<button ", "<button disabled ");
}

function htmlDoBotao(m: Pick<Mensagem, "conversaId">, b: BotaoDoDesvio, estilo: "pri" | "sec" | "linha"): string {
  const classe = estilo === "pri" ? "pri" : estilo === "sec" ? "" : "link";
  const d = b.dados ?? {};
  switch (b.acao) {
    case "entrar_de_novo":
      // A conta da lista: o login dela na máquina (abre Provedores de IA com os passos); sem conta, a seção.
      return d.contaId
        ? botao("cl-entrar-chat", esc(b.rotulo), { classe, dados: { id: d.contaId, maquina: d.maquinaId ?? "", ia: d.ia ?? "", apelido: d.apelido ?? "" } })
        : botao("secao-espaco", esc(b.rotulo), { classe, dados: { secao: "conexao" } });
    case "conectar_ia":
      return botao("secao-espaco", esc(b.rotulo), { classe, dados: { secao: "conexao" } });
    case "rodar_em_outra_maquina":
      return botao("rodar-desta-vez", esc(b.rotulo), { classe, dados: { conversa: m.conversaId, maquina: d.maquinaId ?? "", turno: d.turnoId ?? "" } });
    case "responder_com_outra_ia":
      return botao("responder-com-outra-ia", esc(b.rotulo), { classe, dados: { conversa: m.conversaId, turno: d.turnoId ?? "", ia: d.ia ?? "" } });
    case "reinstalar_e_tentar":
      return botao("reinstalar-e-tentar", esc(b.rotulo), { classe, dados: { conversa: m.conversaId, turno: d.turnoId ?? "", maquina: d.maquinaId ?? "", ia: d.ia ?? "" } });
    case "cancelar":
      return botao("cancelar-turno", esc(b.rotulo), { classe, id: d.turnoId ?? "", dados: { conversa: m.conversaId, mensagem: d.mensagemId ?? "" } });
    case "ver_erro":
      return "";
  }
}
