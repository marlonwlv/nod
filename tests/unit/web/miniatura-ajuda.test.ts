import { describe, expect, it, vi } from "vitest";
import { preencherMiniaturasAjuda } from "../../../web/lib/miniatura-ajuda.ts";

function dom(decisaoId: string, agenteId = "a") {
  const img = { src: "", hidden: true };
  const classes = { remove: vi.fn() };
  const card = { dataset: { ajuda: decisaoId } };
  const mini = {
    dataset: { telaBot: agenteId },
    classList: classes,
    closest: () => card,
    querySelector: () => img,
  };
  const raiz = { querySelectorAll: () => [mini] };
  return { raiz, mini, img, classes };
}

const dto = (ativo: boolean) => ({ ativo, disponivel: true, motivo: null, atividade: [], computador: { indisponivelDesde: null } });
async function esvaziar(): Promise<void> { for (let i = 0; i < 10; i++) await Promise.resolve(); }

describe("miniatura do pedido de ajuda", () => {
  it("observa uma vez e preenche a captura do cartão", async () => {
    const d = dom("d-mini-ok");
    const api = { computador: vi.fn(async () => dto(true)), acaoComputador: vi.fn(async () => ({ tela: { imagem: "AA", quadro: "q" } })) };
    preencherMiniaturasAjuda(api as never, d.raiz as never);
    await esvaziar();
    expect(api.acaoComputador).toHaveBeenCalledOnce();
    expect(api.acaoComputador).toHaveBeenCalledWith("a", { tipo: "observar", forcar: true });
    expect(d.img).toEqual({ src: "data:image/png;base64,AA", hidden: false });
    expect(d.classes.remove).toHaveBeenCalledWith("sem-imagem");
  });

  it("não acorda computador parado nem repete a tentativa no mesmo pedido", async () => {
    const d = dom("d-mini-parada");
    const api = { computador: vi.fn(async () => dto(false)), acaoComputador: vi.fn() };
    preencherMiniaturasAjuda(api as never, d.raiz as never);
    await esvaziar();
    preencherMiniaturasAjuda(api as never, d.raiz as never);
    expect(api.computador).toHaveBeenCalledOnce();
    expect(api.acaoComputador).not.toHaveBeenCalled();
    expect(d.img.hidden).toBe(true);
  });
});
