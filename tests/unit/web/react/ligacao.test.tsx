import { act, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Ligacao } from "../../../../src/contracts/ligacao.ts";
import type { InstantaneoDaLigacao } from "../../../../web/telas/ligacao-controle.ts";
import type { EstadoSemIa } from "../../../../web/telas/ligacao-sem-ia.ts";
import { partesDaLigacao, renderAvaliacao, renderRecusa, type CardJanela, type EstadoTelaLigacao } from "../../../../web/telas/ligacao.ts";
import { montarLigacaoNoReact, type AcoesDaLigacao } from "../../../../web/react/ligacao/ligacao.tsx";

/** ADR-179 (item 4): a região `#ligacao` em React — o DOM do desenho por string em cada estado, e as ações por prop. */
const ligacao = (extra: Partial<Ligacao> = {}): Ligacao => ({
  id: "l1", agenteId: "a", conversaId: "c1", estado: "em_curso", iniciadaPor: "pessoa", harness: "claude-cli", modelo: null, provedorStt: "falso", provedorTts: "falso", voz: "bento",
  mensagemId: null, iniciadaEm: 1_000, atendidaEm: 2_000, encerradaEm: null, motivoFim: null, duracaoMs: null, religacoes: 0, trocas: 0, interrupcoes: 0, sttSegundos: 0, ttsCaracteres: 0,
  custoEstimadoUsd: null, latenciaP50Ms: null, latenciaP95Ms: null, avaliacao: null, transcricaoApagadaEm: null, resumida: false, ...extra,
});
const tela = (extra: Partial<EstadoTelaLigacao> = {}): EstadoTelaLigacao => ({
  ligacao: ligacao(), agente: { id: "a", nome: "Nina <q>", cor: "c-blue", forma: "shape-square" }, modo: "cheia", fase: "ouvindo", rotulo: null, desde: 0, agora: 192_000,
  legendas: [], janela: null, mudo: false, teclado: false, voz: "bento", velocidade: 1, aviso: null, quemFala: null, audioSuspenso: false, sugestoes: [], ...extra,
});
const semIa = (extra: Partial<EstadoSemIa> = {}): EstadoSemIa => ({
  causa: "conta_sem_acesso", ia: "claude-cli", ias: [{ id: "claude-cli", estado: "pronto" }, { id: "codex-cli", estado: "pronto" }], ate: 0,
  entrando: null, nota: null, ocupado: false, ponte: { entrar: true, instalar: true }, onboarding: true, ...extra,
});
const decisao = (tipo: string) => ({ id: "d1", tipo, frase: "Mandar o e-mail <já>?" }) as unknown as NonNullable<CardJanela["decisao"]>;

function fonte(inicial: InstantaneoDaLigacao) {
  let atual = inicial;
  const ouvintes = new Set<() => void>();
  return {
    instantaneo: () => atual,
    assinar: (f: () => void) => { ouvintes.add(f); return () => ouvintes.delete(f); },
    trocar(n: Partial<InstantaneoDaLigacao>) { atual = { ...atual, ...n }; for (const f of ouvintes) f(); },
  };
}
const acoes = (): AcoesDaLigacao => ({
  encolher: vi.fn(), expandir: vi.fn(), alternarMudo: vi.fn(), alternarTeclado: vi.fn(), abrirAjustes: vi.fn(), desligar: vi.fn(), decidir: vi.fn(), retomarAudio: vi.fn(),
  enviarTexto: vi.fn(() => true), continuarCom: vi.fn(), iaNoMac: vi.fn(), semVoz: vi.fn(), avaliar: vi.fn(), motivo: vi.fn(), fecharAvaliacao: vi.fn(), fecharRecusa: vi.fn(), ajustesDoMicrofone: vi.fn(),
});
const vazio: InstantaneoDaLigacao = { t: null, card: null, avaliacao: null, recusa: null };

/** O DOM como o da string: sem `data-act`/`data-form` (a string) nem `data-lig` (o React); classes sem espaço sobrando. */
function normalizar(el: Element): string {
  const c = el.cloneNode(true) as Element;
  for (const e of [c, ...c.querySelectorAll("*")]) {
    for (const n of ["data-act", "data-form", "data-lig", "data-rx-regiao"]) e.removeAttribute(n);
    if (e.hasAttribute("class")) e.setAttribute("class", e.getAttribute("class")!.trim().replace(/\s+/g, " "));
    const attrs = [...e.attributes].map((x) => [x.name, x.value] as const).sort(([x], [y]) => x.localeCompare(y));
    for (const [n] of attrs) e.removeAttribute(n);
    for (const [n, v] of attrs) e.setAttribute(n, v);
  }
  return c.innerHTML.replace(/>\s+</g, "><");
}
/** O desenho por string montado como o controlador o monta: o esqueleto e cada sub-região. */
function nativo(i: InstantaneoDaLigacao): string {
  const d = document.createElement("div");
  if (!i.t) { d.innerHTML = i.avaliacao ? renderAvaliacao(i.avaliacao) : i.recusa ? renderRecusa(i.recusa.texto) : ""; return normalizar(d); }
  const p = partesDaLigacao(i.t, i.card);
  d.innerHTML = p.esqueleto;
  for (const [id, h] of [["ligacao-mascote", p.mascote], ["ligacao-info", p.info], ["ligacao-aviso", p.aviso], ["ligacao-legenda", p.legenda], ["ligacao-card", p.card], ["ligacao-teclado", p.teclado], ["ligacao-controles", p.controles]] as const) {
    const alvo = d.querySelector(`#${id}`);
    if (alvo) alvo.innerHTML = h;
  }
  return normalizar(d);
}
let raiz: HTMLElement;
function montar(i: InstantaneoDaLigacao, a = acoes()) {
  document.body.innerHTML = '<div id="ligacao"></div>';
  raiz = document.getElementById("ligacao")!;
  const f = fonte(i);
  act(() => { montarLigacaoNoReact(raiz, f, a); });
  return { f, a };
}
afterEach(() => { document.body.innerHTML = ""; });

const ESTADOS: [string, InstantaneoDaLigacao][] = [
  ["tela cheia ouvindo", { ...vazio, t: tela() }],
  ["tela cheia muda, com teclado e legendas", { ...vazio, t: tela({ mudo: true, teclado: true, legendas: [{ chave: "1", autor: "pessoa", texto: "oi <b>", final: true, espera: false }, { chave: "2", autor: "bot", texto: "olá", final: true, espera: false }, { chave: "3", autor: "bot", texto: "pensando", final: false, espera: true }] }) }],
  ["tela cheia com sugestões, aviso de erro com ajustes e áudio segurado", { ...vazio, t: tela({ sugestoes: ["Me lembra amanhã", "Resume"], aviso: { tom: "erro", texto: "Microfone negado", ajustes: true }, audioSuspenso: true }) }],
  ["janela de aprovação", { ...vazio, t: tela({ janela: { decisaoId: "d1", ate: 999_999 } }), card: { decisao: decisao("aprovacao"), restanteS: 12 } }],
  ["janela de pergunta", { ...vazio, t: tela({ janela: { decisaoId: "d1", ate: 999_999 } }), card: { decisao: decisao("pergunta"), restanteS: 5 } }],
  ["janela sem a decisão", { ...vazio, t: tela({ janela: { decisaoId: "d1", ate: 999_999 } }), card: { decisao: null, restanteS: 5 } }],
  ["sem IA, outra pronta", { ...vazio, t: tela({ semIa: semIa(), audioSuspenso: true, teclado: true }) }],
  ["sem IA, nenhuma pronta (cards)", { ...vazio, t: tela({ semIa: semIa({ ias: [{ id: "codex-cli", estado: "nao_autenticado" }], onboarding: false, nota: "O login abriu." }) }) }],
  ["a IA voltou (trocou)", { ...vazio, t: tela({ iaVoltou: { ia: "codex-cli", trocou: true }, aviso: { tom: "info", texto: "Conectando…" } }) }],
  ["pílula, o bot falando", { ...vazio, t: tela({ modo: "pilula", quemFala: "bot", sugestoes: ["Oi"] }) }],
  ["pílula muda, com a janela", { ...vazio, t: tela({ modo: "pilula", mudo: true, janela: { decisaoId: "d1", ate: 1 } }), card: { decisao: decisao("aprovacao"), restanteS: 3 } }],
  ["avaliação: a nota", { ...vazio, avaliacao: { ligacaoId: "l1", agenteNome: "Nina", duracaoMs: 65_000, motivoFim: "A ligação caiu.", passo: "nota" } }],
  ["avaliação: o motivo", { ...vazio, avaliacao: { ligacaoId: "l1", agenteNome: "Nina", duracaoMs: 65_000, motivoFim: null, passo: "motivo" } }],
  ["avaliação: obrigado", { ...vazio, avaliacao: { ligacaoId: "l1", agenteNome: "Nina", duracaoMs: 65_000, motivoFim: null, passo: "obrigado" } }],
  ["recusa", { ...vazio, recusa: { texto: "Não dá para ligar agora." } }],
];

describe("a ligação em React", () => {
  it.each(ESTADOS)("%s: o DOM do desenho por string", (_, i) => {
    montar(i);
    expect(normalizar(raiz)).toBe(nativo(i));
  });

  it("nada a mostrar: a região vazia", () => {
    montar(vazio);
    expect(raiz.innerHTML).toBe("");
  });

  it("os botões chamam as ações; o cronômetro anda com o instantâneo; o teclado abre com o foco no campo e envia", () => {
    const { f, a } = montar({ ...vazio, t: tela() });
    act(() => { fireEvent.click(raiz.querySelector('[data-lig="mudo"]')!); });
    act(() => { fireEvent.click(raiz.querySelector('[data-lig="encolher"]')!); });
    act(() => { fireEvent.click(raiz.querySelector('[data-lig="ajustes"]')!); });
    act(() => { fireEvent.click(raiz.querySelector('[data-lig="desligar"]')!); });
    expect(a.alternarMudo).toHaveBeenCalledOnce();
    expect(a.encolher).toHaveBeenCalledOnce();
    expect(a.abrirAjustes).toHaveBeenCalledWith(raiz.querySelector('[data-lig="ajustes"]'));
    expect(a.desligar).toHaveBeenCalledOnce();
    // A mudança chega síncrona (o foco que o controlador põe logo depois acha o nó).
    f.trocar({ t: tela({ agora: 193_000 }) });
    expect(raiz.querySelector(".lc-relogio")?.textContent).toBe("03:13");
    const mascote = raiz.querySelector("nod-mascote");
    f.trocar({ t: tela({ agora: 194_000, teclado: true }) });
    expect(raiz.querySelector("nod-mascote")).toBe(mascote);
    const campo = raiz.querySelector<HTMLInputElement>("#ligacao-texto")!;
    expect(document.activeElement).toBe(campo);
    campo.value = "Tudo certo";
    act(() => { fireEvent.submit(campo.form!); });
    expect(a.enviarTexto).toHaveBeenCalledWith("Tudo certo");
    expect(campo.value).toBe("");
    f.trocar({ t: tela({ modo: "pilula" }) });
    expect(raiz.querySelector('[data-lig="expandir"]')).toBeTruthy();
  });

  it("janela, sugestões, sem IA e avaliação: cada botão leva a sua ação", () => {
    const { f, a } = montar({ ...vazio, t: tela({ sugestoes: ["Resume"], janela: { decisaoId: "d1", ate: 1 } }), card: { decisao: decisao("aprovacao"), restanteS: 3 } });
    act(() => { fireEvent.click([...raiz.querySelectorAll(".lj-acoes button")][1]!); });
    expect(a.decidir).toHaveBeenCalledWith("d1", true);
    act(() => { fireEvent.click(raiz.querySelector(".chip-sugestao")!); });
    expect(a.enviarTexto).toHaveBeenCalledWith("Resume");
    f.trocar({ t: tela({ semIa: semIa({ causa: "outra" as EstadoSemIa["causa"] }) }), card: null });
    act(() => { fireEvent.click(raiz.querySelector(".lsi-continuar")!); });
    expect(a.continuarCom).toHaveBeenCalledWith("codex-cli");
    act(() => { fireEvent.click(raiz.querySelector(".lsi-saida")!); });
    expect(a.semVoz).toHaveBeenCalledOnce();
    f.trocar({ t: null, avaliacao: { ligacaoId: "l1", agenteNome: "Nina", duracaoMs: 1, motivoFim: null, passo: "nota" } });
    act(() => { fireEvent.click(raiz.querySelector('[data-nota="ruim"]')!); });
    expect(a.avaliar).toHaveBeenCalledWith("ruim");
    f.trocar({ avaliacao: { ligacaoId: "l1", agenteNome: "Nina", duracaoMs: 1, motivoFim: null, passo: "motivo" } });
    act(() => { fireEvent.click(raiz.querySelector('[data-motivo="voz"]')!); });
    expect(a.motivo).toHaveBeenCalledWith("voz");
    act(() => { fireEvent.click(raiz.querySelector(".la-fechar")!); });
    expect(a.fecharAvaliacao).toHaveBeenCalledOnce();
  });
});
