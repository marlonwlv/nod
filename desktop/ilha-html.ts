/** O HTML da ilha e da borda do computador da pessoa (ADR-197), puro: sem Electron, para o teste e a vitrine. */
export const LARGURA_ILHA = 460;
export const ALTURA_ILHA = 44;
/** definido em 2026-11-26: 12 s sem ação e a ilha sai (o bot pensando entre ações não a pisca). */
export const SOME_MS = 12_000;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]!);

const ROTULO_ACAO: Record<string, string> = {
  ver: "lendo a janela", abrir_app: "abrindo o app", clicar: "clicando", digitar: "digitando", tecla: "apertando uma tecla",
  rolar: "rolando", arrastar: "arrastando", menu: "usando o menu", apps: "olhando os apps", pausado: "em pausa enquanto você usa o app",
};

/** A página da ilha (pura, testável): o ponto âmbar, "<bot> está usando seu <aparelho> · <app> · <passo>" e Parar. */
export function htmlDaIlha(p: { bot: string; app: string; acao: string; aparelho: "Mac" | "PC" }): string {
  const passo = ROTULO_ACAO[p.acao] ?? "trabalhando";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;font:500 13px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-user-select:none;user-select:none}
.ilha{box-sizing:border-box;height:${ALTURA_ILHA}px;margin:0 auto;display:flex;align-items:center;gap:10px;padding:0 6px 0 16px;border-radius:22px;background:rgba(18,18,18,.94);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.28);width:max-content;max-width:${LARGURA_ILHA}px}
.ponto{flex:none;width:8px;height:8px;border-radius:50%;background:#F5A623;box-shadow:0 0 0 4px rgba(245,166,35,.22);animation:p 1.6s ease-in-out infinite}
@keyframes p{50%{box-shadow:0 0 0 7px rgba(245,166,35,.06)}}
@media (prefers-reduced-motion:reduce){.ponto{animation:none}}
.texto{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.texto b{font-weight:600}.mudo{color:rgba(255,255,255,.62)}
a{flex:none;display:inline-flex;align-items:center;height:30px;padding:0 14px;border-radius:15px;background:#fff;color:#111;text-decoration:none;font-weight:600}
a:hover{background:#f1f1f1}
</style></head><body><div class="ilha" role="status" aria-live="polite"><span class="ponto"></span><span class="texto"><b>${esc(p.bot)}</b> está usando seu ${p.aparelho} <span class="mudo">· ${esc(p.app)} · ${esc(passo)}</span></span><a href="nod-ilha://parar" aria-label="Parar ${esc(p.bot)}">Parar</a></div></body></html>`;
}

/** A borda âmbar (S2): só o contorno, 3 px, cantos de janela do macOS; a página não tem nada clicável. */
export const HTML_BORDA = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}div{box-sizing:border-box;position:fixed;inset:0;border:3px solid #E8892B;border-radius:12px;box-shadow:0 0 0 1px rgba(232,137,43,.25),0 0 18px rgba(232,137,43,.35)}</style></head><body><div></div></body></html>`;

