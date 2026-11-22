import type { BotaoDoDesvio, PayloadDesvio } from "../../src/contracts/desvio.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import { avisoDeEstado } from "../lib/aviso-estado.ts";
import { botao, esc } from "../lib/render.ts";

/**
 * Lote B das Jornadas da IA ("Mandar uma mensagem", 2026-11-22; Paper, momento B): o que a conversa mostra num desvio da
 * mensagem. O servidor já escreve a frase pela tabela única (src/domain/desvios-da-conversa.ts); a tela só desenha:
 * - a LINHA discreta (o nod resolveu sozinho, B3): no centro, como as outras linhas de sistema, com no máximo um link;
 * - o CARTÃO (o nod parou): o aviso do design system (`avisoDeEstado`), em "alerta" quando a mensagem espera e sai sozinha,
 *   em "erro" quando precisa da pessoa; os botões ligam às ações que a tela já tem (o mesmo `data-act` do resto do app).
 */
export function desvioNaConversa(m: Pick<Mensagem, "id" | "conversaId">, p: PayloadDesvio, o: { canceladas?: ReadonlySet<string> } = {}): string {
  if (p.forma === "linha") {
    const link = p.botoes[0] ? ` ${linkDaLinha(m, p.botoes[0])}` : "";
    return `<div class="linha-centro-wrap"><span class="linha-centro estatica linha-desvio" data-desvio="${esc(p.desvio)}"><span>${esc(p.texto)}${link}</span></span></div>`;
  }
  // Depois do Cancelar, o botão sai do cartão (a fala fica "Cancelada" embaixo do balão da pessoa).
  const botoes = p.botoes.filter((b) => b.acao !== "ver_erro" && !(b.acao === "cancelar" && o.canceladas?.has(b.dados?.turnoId ?? "")));
  // Paper (momento B, coluna "Depois"): "Ver o erro" é texto na linha dos botões; aberto, o erro vem embaixo.
  const verErro = p.erro && p.botoes.some((b) => b.acao === "ver_erro")
    ? `<details class="aviso-estado-detalhes desvio-erro" data-disclosure="desvio-erro-${esc(m.id)}"><summary>Ver o erro</summary><p>${esc(p.erro)}</p></details>`
    : "";
  const linha = `${botoes.map((b, i) => botaoDoDesvio(m, b, i === 0 ? "pri" : "sec")).join("")}${verErro}`;
  const acao = linha ? `<div class="aviso-estado-acoes desvio-acoes">${linha}</div>` : undefined;
  // O cartão do aviso de estado (ds.css): o ponto âmbar quando a mensagem espera sozinha; sem ponto quando o nod parou
  // e a pessoa escolhe.
  return avisoDeEstado({ tom: p.tom === "espera" ? "alerta" : "info", titulo: p.titulo, texto: p.texto, ...(acao ? { acao } : {}), classe: `aviso-desvio desvio-${p.desvio}` });
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
function linkDaLinha(m: Pick<Mensagem, "conversaId">, b: BotaoDoDesvio): string {
  const html = botaoDoDesvio(m, b, "linha");
  return html.replace(/class="bt link"/, 'class="linha-link"');
}

/** Cada botão do cartão vira a ação que a tela já conhece. */
function botaoDoDesvio(m: Pick<Mensagem, "conversaId">, b: BotaoDoDesvio, estilo: "pri" | "sec" | "linha"): string {
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
