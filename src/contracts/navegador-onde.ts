/**
 * 2026-11-27: onde o navegador do bot roda agora, para o prompt (o bot sabe onde trabalha e diz à pessoa numa frase).
 * Antes o prompt dizia sempre "um Chrome do nod, separado do laptop da pessoa", e no PC de uma usuária ele rodava no
 * PC dela: o bot misturava o navegador com o computador e respondia "indisponível" sem tentar.
 */
export type OndeDoNavegador =
  | { tipo: "nod" }
  | { tipo: "aparelho"; aparelho: "Mac" | "PC" }
  | { tipo: "maquina"; nome: string }
  /** O lugar dele não atende agora (o aparelho desligado, a máquina fora do ar): `instrucao` é a da ferramenta. */
  | { tipo: "espera"; instrucao: string };
