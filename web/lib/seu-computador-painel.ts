import type { VistaSeuComputador } from "../../src/contracts/seu-computador.ts";
import { esc } from "./escape.ts";

/**
 * A aba "Seu Mac" do painel (ADR-197, item 6; Paper "Seu computador", S4): o último quadro da janela que o bot usou, com
 * a borda âmbar, e "O que <bot> fez" — os passos com a hora, o mais novo em âmbar enquanto ela trabalha. Não é transmissão
 * contínua: um quadro a cada ação (o servidor guarda o último; o SSE `seu_computador.mudou` relê).
 */
const FRASE: Readonly<Record<string, string>> = {
  ver: "Leu a janela", abrir_app: "Abriu o app", clicar: "Clicou", digitar: "Digitou", tecla: "Usou o teclado",
  rolar: "Rolou", arrastar: "Arrastou", menu: "Usou o menu", apps: "Olhou os apps",
};
/** definido em 2026-11-26: até 20 s depois da última ação, "ao vivo"; depois, a hora. */
export const AO_VIVO_MS = 20_000;

const hora = (ms: number) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function htmlPainelSeuComputador(p: { vista: VistaSeuComputador | null; nomeBot: string; aparelho: "Mac" | "PC"; agora: number }): string {
  const v = p.vista;
  if (!v || !v.passos.length) {
    return `<div class="sc-painel sc-vazio"><b>Seu ${p.aparelho}</b><span>Quando ${esc(p.nomeBot)} usar um app do seu ${p.aparelho}, você vê aqui a janela e cada passo. Na primeira vez com cada app, ela pede na conversa.</span></div>`;
  }
  const vivo = p.agora - v.ativoEm < AO_VIVO_MS;
  const estado = vivo ? `<span class="sc-vivo">Ao vivo no seu ${p.aparelho}</span>` : `<span class="sc-quando">${esc(hora(v.ativoEm))}</span>`;
  const quadro = v.quadro && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(v.quadro)
    ? `<img class="sc-quadro${vivo ? " sc-quadro-vivo" : ""}" src="${v.quadro}" alt="${esc(`A janela do ${v.app ?? "app"} no seu ${p.aparelho}`)}">`
    : `<div class="sc-quadro sc-sem-quadro">Sem imagem da janela nesta ação.</div>`;
  const passos = [...v.passos].slice(-12).map((s, i, todos) => {
    const ultimo = i === todos.length - 1 && vivo;
    const frase = `${s.acao === "abrir_app" && s.app ? `Abriu o ${s.app}` : s.acao === "ver" && s.app ? `Leu a janela do ${s.app}` : `${FRASE[s.acao] ?? "Agiu"}${s.app ? ` no ${s.app}` : ""}`}${s.ok ? "" : " (não deu)"}`;
    return `<li class="${ultimo ? "sc-agora" : ""}"><span class="sc-hora">${ultimo ? "agora" : esc(hora(s.em))}</span><span>${esc(frase)}</span></li>`;
  }).join("");
  return `<div class="sc-painel"><div class="sc-cab"><span class="sc-app">${esc(v.app ?? `Seu ${p.aparelho}`)}</span>${estado}</div>${quadro}<p class="sc-rotulo">O que ${esc(p.nomeBot)} fez</p><ol class="sc-passos">${passos}</ol></div>`;
}
