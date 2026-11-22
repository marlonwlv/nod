import { esc } from "./escape.ts";

/**
 * O aviso de estado do design system (componente Notice, definido em 2026-10-04): diz o que aconteceu, o motivo e,
 * quando há, o botão que resolve. Quatro tons:
 * - erro: o trabalho não começa ou parou;
 * - alerta: algo espera (a mensagem sai sozinha) ou impede um agente, e a pessoa resolve quando quiser;
 * - ok: confirmação curta;
 * - info: contexto neutro, ou o nod parou e a pessoa escolhe (sem azul: o azul é só do que é novo).
 *
 * Revisto em 2026-11-22 (lote B das Jornadas da IA, auditoria: "o cartão não segue o DS novo"): o cartão do
 * Paper (momento B e página Design system). Caixa branca com a borda padrão (12 %), raio 14, coluna com respiro de 10;
 * na cabeça um ponto de 6 px na cor do estado (o tom `info` não tem ponto) e o título 14/500; o texto 13/18 a 68 %; os
 * botões em pílula de 28 px (`.bt` dentro de `.aviso-estado-acoes`, ds.css). A palavra do estado vai para o leitor de
 * tela no ponto: a cor nunca é o único sinal. `.aviso-compacto` (barra, campo, ligação) fica em uma linha.
 */
export type TomDoAviso = "erro" | "alerta" | "ok" | "info";

const PALAVRA: Record<TomDoAviso, string | null> = { erro: "Erro", alerta: "Atenção", ok: "Feito", info: null };

/** O ponto da cabeça do aviso (6 px, na cor do tom); `info` não tem. */
export function pontoDoAviso(tom: TomDoAviso): string {
  const palavra = PALAVRA[tom];
  return palavra ? `<span class="aviso-estado-ponto"><span class="sr-only">${palavra}: </span></span>` : "";
}

/**
 * `titulo` e `texto` chegam como texto puro e são escapados aqui; `acao` e `extra` já são HTML pronto (um botao()
 * de render.ts e, por exemplo, um <details> com o texto técnico). `acao` vai na linha de botões (`.aviso-estado-acoes`);
 * quem já manda a linha montada não ganha outra. `papel` só vai quando o aviso nasce agora: um aviso antigo da conversa
 * não deve ser anunciado de novo a cada render.
 */
export function avisoDeEstado(a: { tom: TomDoAviso; titulo?: string; texto: string; acao?: string; extra?: string; papel?: "alert" | "status"; classe?: string }): string {
  const papel = a.papel ? ` role="${a.papel}"` : "";
  const cabeca = a.titulo
    ? `<div class="aviso-estado-cab">${pontoDoAviso(a.tom)}<b class="aviso-estado-tit">${esc(a.titulo)}</b></div><p class="aviso-estado-txt">${esc(a.texto)}</p>`
    : `<div class="aviso-estado-cab">${pontoDoAviso(a.tom)}<p class="aviso-estado-txt">${esc(a.texto)}</p></div>`;
  const acoes = a.acao ? (a.acao.includes('class="aviso-estado-acoes') ? a.acao : `<div class="aviso-estado-acoes">${a.acao}</div>`) : "";
  return `<div class="aviso-estado tom-${a.tom}${a.classe ? ` ${esc(a.classe)}` : ""}"${papel}>${cabeca}${a.extra ?? ""}${acoes}</div>`;
}
