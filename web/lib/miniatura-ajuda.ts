import type { AcaoComputador, ComputadorDto, ResultadoComputador } from "../../src/contracts/computador.ts";
import { foraDoAr } from "./computador.ts";

type ApiMiniatura = {
  computador(agenteId: string): Promise<ComputadorDto>;
  acaoComputador(agenteId: string, acao: AcaoComputador): Promise<ResultadoComputador>;
};
type Imagem = { src: string; hidden: boolean };
type Cartao = { dataset: { ajuda?: string } };
type Elemento = {
  dataset: { telaBot?: string };
  classList: { remove(classe: string): void };
  closest(seletor: string): Cartao | null;
  querySelector(seletor: string): Imagem | null;
};
type Raiz = { querySelectorAll(seletor: string): Iterable<unknown> };

const miniaturas = new Map<string, string>();
const carregando = new Set<string>();
const falhouEm = new Map<string, number>();
const MS_NOVA_TENTATIVA = 2_000;

function elementos(raiz: Raiz): Elemento[] {
  return [...raiz.querySelectorAll(".cc-ajuda[data-ajuda] .cc-mini[data-tela-bot]")] as Elemento[];
}

function aplicar(el: Elemento, src: string): void {
  const img = el.querySelector("img");
  if (!img) return;
  img.src = src;
  img.hidden = false;
  el.classList.remove("sem-imagem");
}

/** Preenche em memória a miniatura 96 × 60 do pedido de ajuda, sem persistir a tela da pessoa. */
export function preencherMiniaturasAjuda(api: ApiMiniatura, raiz: Raiz): void {
  const atuais = elementos(raiz);
  const abertas = new Set(atuais.map((el) => el.closest(".cc-ajuda[data-ajuda]")?.dataset.ajuda).filter((id): id is string => !!id));
  for (const id of miniaturas.keys()) if (!abertas.has(id)) miniaturas.delete(id);
  for (const id of falhouEm.keys()) if (!abertas.has(id)) falhouEm.delete(id);
  for (const el of atuais) {
    const card = el.closest(".cc-ajuda[data-ajuda]");
    const decisaoId = card?.dataset.ajuda;
    const agenteId = el.dataset.telaBot;
    if (!decisaoId || !agenteId) continue;
    const pronta = miniaturas.get(decisaoId);
    if (pronta) { aplicar(el, pronta); continue; }
    const falha = falhouEm.get(decisaoId);
    if (falha !== undefined && Date.now() - falha < MS_NOVA_TENTATIVA) continue;
    if (carregando.has(decisaoId)) continue;
    carregando.add(decisaoId);
    void api.computador(agenteId).then((dto) => dto.ativo && !foraDoAr(dto) ? api.acaoComputador(agenteId, { tipo: "observar", forcar: true }) : null).then((r) => {
      if (!r?.tela?.imagem) { falhouEm.set(decisaoId, Date.now()); return; }
      const src = `data:image/png;base64,${r.tela.imagem}`;
      miniaturas.set(decisaoId, src);
      falhouEm.delete(decisaoId);
      for (const atual of elementos(raiz)) {
        const id = atual.closest(".cc-ajuda[data-ajuda]")?.dataset.ajuda;
        if (id === decisaoId) aplicar(atual, src);
      }
    }).catch(() => falhouEm.set(decisaoId, Date.now())).finally(() => carregando.delete(decisaoId));
  }
}
