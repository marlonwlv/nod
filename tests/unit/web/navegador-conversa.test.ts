import { describe, expect, it } from "vitest";
import { htmlLinhaDoLugarDoNavegador } from "../../../web/lib/navegador-conversa.ts";
import type { PayloadNavegadorLugar } from "../../../src/contracts/navegador-do-bot.ts";

/** ADR-190 (N): a linha da conversa quando o navegador do bot muda de lugar sozinho. */
const p = (o: Partial<PayloadNavegadorLugar> = {}): PayloadNavegadorLugar => ({ kind: "navegador_lugar", agenteId: "00000000-0000-4000-8000-0000000000d1", aviso: "passou_para_maquina", maquinaId: "m1", nome: "vm-sp", em: 1, acao: { rotulo: "Desfazer", mudar: { maquinaId: "nod" } }, ...o });

describe("a linha do lugar do navegador", () => {
  it("a dona vê o texto e o botão com o que mudar; quem não é dona só o texto; sem ação, sem botão", () => {
    const html = htmlLinhaDoLugarDoNavegador(p(), "Com o Mac desligado, agora continuo na vm-sp.", true);
    expect(html).toContain('class="cc-sistema"');
    expect(html).toContain("Com o Mac desligado, agora continuo na vm-sp.");
    expect(html).toContain('data-act="navegador-lugar" data-id="00000000-0000-4000-8000-0000000000d1" data-mudar="{&quot;maquinaId&quot;:&quot;nod&quot;}">Desfazer</button>');
    expect(htmlLinhaDoLugarDoNavegador(p(), "x", false)).not.toContain("<button");
    expect(htmlLinhaDoLugarDoNavegador(p({ aviso: "maquina_saiu", acao: null }), "A vm-sp saiu da sua conta. Continuo no nod.", true)).not.toContain("<button");
  });

  it("o texto que veio do servidor é escapado", () => {
    expect(htmlLinhaDoLugarDoNavegador(p({ acao: null }), "<img src=x>", true)).toContain("&lt;img src=x&gt;");
  });
});
