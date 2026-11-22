import type { BotaoDoDesvio, PayloadDesvio } from "../../src/contracts/desvio.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import { avisoDeEstado } from "../lib/aviso-estado.ts";
import { botao, esc, hora } from "../lib/render.ts";

/**
 * Lote B das Jornadas da IA ("Mandar uma mensagem", 2026-11-22; Paper, momento B): o que a conversa mostra num desvio da
 * mensagem. O servidor já escreve a frase pela tabela única (src/domain/desvios-da-conversa.ts); a tela só desenha:
 * - a LINHA discreta (o nod resolveu sozinho, B3): no centro, como as outras linhas de sistema, com no máximo um link;
 * - o CARTÃO (o nod parou): o aviso do design system (`avisoDeEstado`), em "alerta" quando a mensagem espera e sai sozinha,
 *   em "erro" quando precisa da pessoa; os botões ligam às ações que a tela já tem (o mesmo `data-act` do resto do app).
 */
export function desvioNaConversa(m: Pick<Mensagem, "id" | "conversaId" | "criadoEm">, p: PayloadDesvio): string {
  if (p.forma === "linha") {
    const link = p.botoes[0] ? ` ${botaoDoDesvio(m, p.botoes[0], "linha")}` : "";
    return `<div class="linha-centro-wrap"><span class="linha-centro estatica linha-desvio" data-desvio="${esc(p.desvio)}">${esc(p.texto)}${link}<span class="linha-hora">· ${esc(hora(m.criadoEm))}</span></span></div>`;
  }
  const botoes = p.botoes.filter((b) => b.acao !== "ver_erro");
  const verErro = p.erro && p.botoes.some((b) => b.acao === "ver_erro")
    ? `<details class="aviso-estado-detalhes desvio-erro" data-disclosure="desvio-erro-${esc(m.id)}"><summary>Ver o erro</summary><p>${esc(p.erro)}</p></details>`
    : "";
  const acao = botoes.length > 0 ? `<div class="aviso-estado-acoes desvio-acoes">${botoes.map((b, i) => botaoDoDesvio(m, b, i === 0 ? "pri" : "sec")).join("")}</div>` : "";
  // Paper (momento B, coluna "Depois"): cartão branco de borda fina, como o aviso de troca de IA; o âmbar só no ícone de
  // quem espera sozinho ("tela limpa", T7: nada de cartão colorido).
  return avisoDeEstado({ tom: p.tom === "espera" ? "alerta" : "info", titulo: p.titulo, texto: p.texto, extra: `${acao}${verErro}`, classe: `aviso-desvio desvio-${p.desvio}` });
}

/** Cada botão do cartão vira a ação que a tela já conhece. */
function botaoDoDesvio(m: Pick<Mensagem, "conversaId">, b: BotaoDoDesvio, estilo: "pri" | "sec" | "linha"): string {
  const classe = estilo === "pri" ? "pri sm" : estilo === "sec" ? "sm" : "link";
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
      return botao("responder-com-outra-ia", esc(b.rotulo), { classe, dados: { conversa: m.conversaId, turno: d.turnoId ?? "" } });
    case "cancelar":
      return botao("cancelar-turno", esc(b.rotulo), { classe, id: d.turnoId ?? "" });
    case "ver_erro":
      return "";
  }
}
