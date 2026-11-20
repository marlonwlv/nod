/**
 * ADR-179 (item 4): os diálogos criados por código já em componentes (Dialog do Base UI), baixados pelo main depois do
 * boot (`?dialogos-react=0` os deixa de fora): o de handoff do Quadro e o de confirmação (`bot-dialogo`).
 */
export { abrirHandoffNoReact } from "./handoff.tsx";
export { confirmarNoReact, type Confirmacao } from "./confirmar.tsx";
export { avisarTermosNoReact } from "./aviso-termos.tsx";
export { abrirPareamentoNoReact } from "./parear-mac.tsx";
export { criarPaletaNoReact } from "./paleta.tsx";
export { abrirPreviaNoReact } from "./previa-arquivo.tsx";
export { abrirLuzNoReact } from "./luz.tsx";
export { abrirArtefatoNoReact } from "./artefato.tsx";
export { abrirMenuDoBotNoReact } from "./menu-do-bot.tsx";
export { abrirMenuDeHtmlNoReact } from "./menu-de-html.tsx";
export { abrirMenuModoNoReact } from "./menu-modo.tsx";
export { abrirMenuIaNoReact } from "./menu-ia.tsx";
