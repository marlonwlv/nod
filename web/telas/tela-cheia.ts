import type { Agente } from "../../src/contracts/agente.ts";
import type { AcaoComputador, ComputadorDto, TelaComputador } from "../../src/contracts/computador.ts";
import type { Api } from "../lib/api.ts";
import { AVISO_ASSUMA, estadoDaBarra, esperaParaReconectar, htmlBarraDeControle, htmlTelaCheia, MS_ASSUMINDO_VISIVEL, MS_CAPTURA_PLANO_B, MS_PLANO_B, type EstadoBarra } from "../lib/computador-pessoa.ts";
import { foraDoAr } from "../lib/computador.ts";
import { htmlMascote } from "../lib/mascote.ts";
import { abrirVivoNoVnc, type AbrirVivo, type ClienteVivo } from "../lib/tela-vivo.ts";

/**
 * O visualizador em tela cheia do computador do bot (card D, itens 3 e 4; definido em 2026-11-12). É o único jeito de
 * ver a tela: abre pelo cartão do painel, pelo chip "Computador" da conversa, pelo pedido de ajuda e por "Abrir" nas
 * Configurações (todos com `data-act="abrir-computador"`, que chama `abrirTelaCheia`).
 *
 * - Ocupa a janela inteira, abre e fecha seco. Só o botão "Sair da tela cheia" fecha: o Esc não fecha (no controle ele
 *   vai para o site) e não há "fora" para clicar.
 * - Sempre ao vivo pelo VNC (web/lib/tela-vivo.ts), também assistindo (`viewOnly`; o servidor filtra teclado e mouse).
 *   Assumir e Parar só trocam o `viewOnly` na mesma conexão: a barra muda num quadro e a tela continua igual.
 * - "Assumindo…" só aparece se o assumir passar de MS_ASSUMINDO_VISIVEL. Fechar no controle devolve ao bot.
 * - Clicar na tela assistindo não chega ao site: o halo do "Assumir o controle" pulsa (sem pulso com
 *   prefers-reduced-motion) e o leitor de tela ouve AVISO_ASSUMA.
 * - O VNC caiu: "Reconectando" sobre o último quadro escurecido, tentando de novo em 1, 2, 4 e 8 s. Sem voltar em
 *   MS_PLANO_B, as capturas de 2 s entram por baixo (plano B), sem mudar a interface; no controle, as ações vão por elas.
 */
export type OpcoesTelaCheia = {
  /** Abre já no controle (o pedido de ajuda). */
  assumir?: boolean;
  /** O pedido de ajuda: vira a descrição da região para o leitor de tela. */
  pedido?: string | null;
  /** Avisado quando o controle muda: o painel e o cartão releem o computador. */
  aoMudar?: () => void;
  /** Avisado ao fechar (quem abriu volta à conversa com o painel de detalhes aberto). */
  aoFechar?: () => void;
  /** Só no Modo dev: o diálogo antigo, com terminal e arquivos. */
  antigo?: (() => void) | null;
  /** Como abrir a tela ao vivo (padrão: o noVNC); os testes passam um falso. */
  vivo?: AbrirVivo;
  /** Os testes dizem se o sistema pede menos movimento (padrão: a media query). */
  menosMovimento?: () => boolean;
};

type AgenteDaTela = Pick<Agente, "id" | "nome"> & Partial<Pick<Agente, "cor" | "forma">>;
type Fase = "iniciando" | "conectando" | "vendo" | "reconectando";

const TEXTO_DA_ESPERA: Record<Exclude<Fase, "vendo">, string> = { iniciando: "Iniciando desktop", conectando: "Conectando", reconectando: "Reconectando" };
const MS_LER = 2_000;

/** O alvo do pulso: o botão "Assumir o controle" (a classe reinicia a animação) e o aviso ao leitor de tela. */
export type AlvoDoPulso = { classList: { add(c: string): void; remove(c: string): void }; offsetWidth: number };

/**
 * Pulsa o halo uma vez (um clique novo no meio reinicia: tira a classe, força o layout e põe de novo) e avisa o leitor
 * de tela. Com menos movimento, só o aviso. Devolve se pulsou.
 */
export function pulsarHalo(botao: AlvoDoPulso | null, aviso: { textContent: string | null } | null, menosMovimento: boolean): boolean {
  // O mesmo texto duas vezes não é relido: alterna um espaço fino no fim.
  if (aviso) aviso.textContent = aviso.textContent === AVISO_ASSUMA ? `${AVISO_ASSUMA}\u2009` : AVISO_ASSUMA;
  if (menosMovimento || !botao) return false;
  botao.classList.remove("pulsando");
  void botao.offsetWidth;
  botao.classList.add("pulsando");
  return true;
}

let fecharAberta: (() => void) | null = null;
let agenteAberto: string | null = null;

/** O bot cuja tela está aberta em tela cheia, ou null. */
export function telaCheiaAberta(): string | null {
  return agenteAberto;
}

/** Fecha a tela cheia aberta (devolve o controle se a pessoa estava nele). */
export function fecharTelaCheia(): void {
  fecharAberta?.();
}

export function abrirTelaCheia(api: Api, agente: AgenteDaTela, opcoes: OpcoesTelaCheia = {}): void {
  fecharAberta?.();
  const dialog = document.createElement("dialog");
  dialog.className = "ctc";
  // Card D, item 3: a região "Tela de {Bot}" sobre tudo; o <dialog> modal deixa o resto inerte e as camadas da página
  // (atalhos, Esc das outras telas) o reconhecem como modal.
  dialog.setAttribute("role", "region");
  dialog.setAttribute("aria-label", `Tela de ${agente.nome}`);
  if (opcoes.pedido) dialog.setAttribute("aria-description", opcoes.pedido);
  if (typeof window !== "undefined" && (window as { nodDesktop?: unknown }).nodDesktop !== undefined) dialog.classList.add("no-mac");
  const personagem = htmlMascote({ nome: agente.nome, cor: agente.cor ?? "c-gray", forma: agente.forma ?? "shape-circle" }, "", "trabalhando");
  dialog.innerHTML = htmlTelaCheia(agente.nome, personagem);
  if (opcoes.antigo) {
    const dev = document.createElement("button");
    dev.type = "button";
    dev.className = "ctc-dev";
    dev.dataset.c = "antigo";
    dev.textContent = "Ferramentas";
    dialog.querySelector(".ctc-sair")?.before(dev);
  }
  document.body.append(dialog);
  dialog.showModal();
  const q = <T extends Element = HTMLElement>(s: string) => dialog.querySelector<T>(s)!;
  const quadro = q(".ctc-quadro");
  const captura = q<HTMLImageElement>(".ctc-captura");
  const ultimo = q(".ctc-ultimo");
  const vivoEl = q(".ctc-vivo");
  const barraLugar = q(".ctc-barra-lugar");
  const espera = q(".ctc-espera");
  const esperaTxt = q(".ctc-espera-txt");
  const aviso = q(".ctc-aviso");
  const fora = q(".ctc-fora");
  const menosMovimento = opcoes.menosMovimento ?? (() => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  let dto: ComputadorDto | undefined;
  let fase: Fase = "iniciando";
  let terminou = false;
  /** Quando a pessoa clicou em "Assumir o controle"; null sem pedido em curso. */
  let assumindoDesde: number | null = null;
  let timerAssumindo = 0;
  let estadoPintado: EstadoBarra | null = null;
  let lendo = false;
  /** A abertura terminou (a primeira observação já abriu a tela): daqui em diante a leitura religa o VNC se faltar. */
  let preparado = false;
  // O VNC: `geracao` invalida os avisos de um cliente que já foi trocado ou fechado.
  let vivo: ClienteVivo | null = null;
  let geracao = 0;
  let ligando = false;
  let aoVivo = false;
  let tentativas = 0;
  let timerReconectar = 0;
  let timerPlanoB = 0;
  let timerCaptura = 0;
  let planoB = false;
  /** A última captura (plano B): o quadro que as ações da pessoa citam. */
  let tela: TelaComputador | undefined;
  let teclas = "";
  let timerTeclas = 0;

  const controla = () => dto?.computador.controle === "pessoa";
  const botOcupado = () => (dto?.computador.ocupadoAte ?? 0) > Date.now();
  const estadoAgora = (): EstadoBarra => estadoDaBarra(dto?.computador.controle, assumindoDesde, Date.now());

  function pintar(): void {
    if (terminou) return;
    dialog.dataset.fase = fase;
    fora.hidden = !dto || !foraDoAr(dto);
    quadro.hidden = fase === "iniciando";
    const estado = estadoAgora();
    if (fase === "iniciando") { if (estadoPintado !== null) { barraLugar.innerHTML = ""; estadoPintado = null; } }
    else if (estado !== estadoPintado) { barraLugar.innerHTML = htmlBarraDeControle(agente.nome, estado); estadoPintado = estado; }
    quadro.dataset.estado = estado;
    espera.hidden = fase === "vendo";
    if (fase !== "vendo") esperaTxt.textContent = TEXTO_DA_ESPERA[fase];
    captura.hidden = aoVivo || !captura.getAttribute("src");
    vivoEl.hidden = !aoVivo;
    ultimo.hidden = fase !== "reconectando";
  }

  function mostrarCaptura(t: TelaComputador): void {
    if (terminou || aoVivo) return;
    tela = t;
    captura.src = `data:image/png;base64,${t.imagem}`;
    // A imagem chega de uma vez, sem fade; no "Reconectando" fica embaixo do aviso até o plano B.
    if (fase !== "reconectando" || planoB) fase = "vendo";
    pintar();
  }

  async function observar(): Promise<void> {
    try {
      const r = await api.acaoComputador(agente.id, { tipo: "observar" });
      if (r.tela) mostrarCaptura(r.tela);
    } catch { /* a tela ainda não abriu ou o computador acorda: o VNC tenta de novo */ }
  }

  async function ler(): Promise<void> {
    if (lendo || terminou) return;
    lendo = true;
    try {
      const antes = controla();
      dto = await api.computador(agente.id);
      if (terminou) return;
      // O controle saiu da pessoa por fora (Parar noutra aba, mensagem nova ao bot, o bot retomou): volta a assistir.
      if (antes && !controla() && assumindoDesde === null) vivo?.soVer(true);
      if (!antes && controla()) vivo?.soVer(false);
      if (dto.ativo && fase === "iniciando") fase = "conectando";
      pintar();
      if (preparado && !vivo && !ligando && !timerReconectar) void ligarVivo();
    } catch { /* a próxima leitura mostra o estado real */ } finally { lendo = false; }
  }

  function pararPlanoB(): void {
    planoB = false;
    if (timerPlanoB) { window.clearTimeout(timerPlanoB); timerPlanoB = 0; }
    if (timerCaptura) { window.clearInterval(timerCaptura); timerCaptura = 0; }
  }
  function armarPlanoB(): void {
    if (timerPlanoB || planoB || terminou) return;
    timerPlanoB = window.setTimeout(() => {
      timerPlanoB = 0;
      if (terminou || aoVivo) return;
      planoB = true;
      const capturar = () => { if (!terminou && planoB && !aoVivo && !document.hidden && !botOcupado()) void observar(); };
      capturar();
      timerCaptura = window.setInterval(capturar, MS_CAPTURA_PLANO_B);
    }, MS_PLANO_B);
  }

  function agendarReconexao(): void {
    if (terminou || timerReconectar) return;
    armarPlanoB();
    timerReconectar = window.setTimeout(() => { timerReconectar = 0; void ligarVivo(); }, esperaParaReconectar(tentativas++));
  }

  async function ligarVivo(): Promise<void> {
    if (vivo || ligando || terminou) return;
    ligando = true;
    const minha = ++geracao;
    const url = `${api.urlVivo(agente.id)}?modo=assistir`;
    let c: ClienteVivo | null = null;
    try {
      c = await (opcoes.vivo ?? abrirVivoNoVnc)({
        alvo: vivoEl,
        url,
        soVer: !controla(),
        aoLigar: () => {
          if (minha !== geracao || terminou) return;
          aoVivo = true;
          fase = "vendo";
          tentativas = 0;
          pararPlanoB();
          ultimo.replaceChildren();
          vivo?.soVer(!controla());
          if (controla()) vivo?.focar();
          pintar();
        },
        aoCair: (canvas) => {
          if (minha !== geracao || terminou) return;
          const estava = aoVivo;
          vivo = null;
          aoVivo = false;
          if (estava) {
            if (canvas) ultimo.replaceChildren(canvas);
            fase = "reconectando";
          }
          pintar();
          agendarReconexao();
        },
      });
    } finally {
      ligando = false;
    }
    if (!c) { agendarReconexao(); return; }
    if (terminou || minha !== geracao) { c.fechar(); return; }
    vivo = c;
  }

  function desligarVivo(): void {
    geracao++;
    const c = vivo;
    vivo = null;
    aoVivo = false;
    c?.fechar();
  }

  function devolverAoFechar(): void {
    void api.configurarComputador(agente.id, "devolver").catch(() => undefined).finally(() => opcoes.aoMudar?.());
  }

  async function assumir(): Promise<void> {
    if (terminou || assumindoDesde !== null || controla()) return;
    assumindoDesde = Date.now();
    // Até 300 ms nada muda; depois, "Assumindo…" e o botão desabilitado.
    timerAssumindo = window.setTimeout(() => { timerAssumindo = 0; pintar(); }, MS_ASSUMINDO_VISIVEL);
    let ok = false;
    try {
      await api.configurarComputador(agente.id, "assumir");
      ok = true;
    } catch { /* fica assistindo; a leitura mostra o estado real */ } finally {
      assumindoDesde = null;
      if (timerAssumindo) { window.clearTimeout(timerAssumindo); timerAssumindo = 0; }
      opcoes.aoMudar?.();
    }
    // Fechou durante o assumir: o controle chegou com a tela fechada e volta ao bot agora.
    if (terminou) { if (ok) devolverAoFechar(); return; }
    if (ok && dto) dto = { ...dto, computador: { ...dto.computador, controle: "pessoa" } };
    // O servidor já liberou o teclado da sessão antes de responder: o primeiro clique chega ao site.
    vivo?.soVer(!controla());
    pintar();
    if (controla()) { if (aoVivo) vivo?.focar(); else captura.focus(); }
    void ler();
  }

  async function devolver(): Promise<void> {
    if (terminou || !controla()) return;
    vivo?.soVer(true);
    if (dto) dto = { ...dto, computador: { ...dto.computador, controle: "bot" } };
    pintar();
    try { await api.configurarComputador(agente.id, "devolver"); } catch { /* a leitura mostra o estado real */ } finally { opcoes.aoMudar?.(); }
    void ler();
  }

  // ---- plano B no controle: sem o VNC, as ações vão pelas capturas (como antes do ao vivo) ----
  let fila: Promise<void> = Promise.resolve();
  function interagir(a: AcaoComputador): void {
    if (!controla() || aoVivo) return;
    fila = fila.then(async () => {
      if (!controla() || terminou) return;
      try {
        const r = await api.acaoComputador(agente.id, a);
        if (r.tela) mostrarCaptura(r.tela);
      } catch { /* a próxima captura mostra o estado real */ }
    });
  }
  function enviarTeclas(): void {
    if (timerTeclas) { window.clearTimeout(timerTeclas); timerTeclas = 0; }
    const texto = teclas;
    teclas = "";
    if (texto && tela) interagir({ tipo: "digitar", texto, quadro: tela.quadro });
  }
  // A captura tem a resolução do computador (1280×800): o clique é convertido para ela.
  const ponto = (e: MouseEvent) => {
    const b = captura.getBoundingClientRect();
    const escala = Math.min(b.width / 1280, b.height / 800) || 1;
    const dx = (b.width - 1280 * escala) / 2;
    const dy = (b.height - 800 * escala) / 2;
    return { x: Math.min(1279, Math.max(0, Math.floor((e.clientX - b.left - dx) / escala))), y: Math.min(799, Math.max(0, Math.floor((e.clientY - b.top - dy) / escala))) };
  };
  let inicio: { x: number; y: number } | undefined;
  captura.addEventListener("mousedown", (e) => { if (!controla()) return; e.preventDefault(); captura.focus(); inicio = ponto(e); });
  captura.addEventListener("mouseup", (e) => {
    if (!tela || !inicio || !controla()) return;
    const fim = ponto(e);
    const ini = inicio;
    inicio = undefined;
    if (Math.abs(fim.x - ini.x) + Math.abs(fim.y - ini.y) > 8) interagir({ tipo: "arrastar", ...ini, destinoX: fim.x, destinoY: fim.y, quadro: tela.quadro });
    else interagir({ tipo: "clicar", ...fim, quadro: tela.quadro, botao: e.button === 2 ? 3 : 1, vezes: e.detail >= 2 ? 2 : 1 });
  });
  captura.addEventListener("contextmenu", (e) => e.preventDefault());
  captura.addEventListener("wheel", (e) => { if (!controla() || !tela) return; e.preventDefault(); interagir({ tipo: "rolar", delta: Math.max(-2000, Math.min(2000, e.deltaY)), quadro: tela.quadro }); }, { passive: false });
  captura.addEventListener("keydown", (e) => {
    if (!tela || !controla() || ["Control", "Meta", "Alt", "Shift"].includes(e.key)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      teclas += e.key;
      if (timerTeclas) window.clearTimeout(timerTeclas);
      timerTeclas = window.setTimeout(enviarTeclas, 150);
    } else {
      enviarTeclas();
      const tecla = `${e.ctrlKey || e.metaKey ? "Control+" : ""}${e.altKey ? "Alt+" : ""}${e.shiftKey ? "Shift+" : ""}${e.key === " " ? "Space" : e.key}`;
      interagir({ tipo: "tecla", tecla, quadro: tela.quadro });
    }
  });
  captura.addEventListener("paste", (e) => { e.preventDefault(); enviarTeclas(); const texto = e.clipboardData?.getData("text/plain"); if (texto && tela) interagir({ tipo: "digitar", texto, quadro: tela.quadro }); });

  // ---- assistindo: o clique e o teclado não passam; o halo pulsa ----
  quadro.addEventListener("pointerdown", (e) => {
    if (estadoAgora() === "controle") return;
    e.preventDefault();
    pulsarHalo(dialog.querySelector<HTMLElement>(".ctc-assumir"), aviso, menosMovimento());
  });
  // Esc não fecha (o Chrome fecharia o modal num segundo Esc sem gesto, mesmo com o `cancel` impedido). No controle,
  // o noVNC recebe o Esc do mesmo jeito: o preventDefault não para a propagação.
  dialog.addEventListener("keydown", (e) => { if (e.key === "Escape") e.preventDefault(); }, true);
  dialog.addEventListener("cancel", (e) => e.preventDefault());
  dialog.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-c]");
    const cmd = el?.dataset.c;
    if (cmd === "fechar") fechar();
    else if (cmd === "antigo") { fechar(); opcoes.antigo?.(); }
    else if (cmd === "assumir") void assumir();
    else if (cmd === "devolver") void devolver();
  });

  const timerLer = window.setInterval(() => { if (!document.hidden && !terminou) void ler(); }, MS_LER);

  function fechar(): void {
    if (terminou) return;
    // Fechar no controle devolve ao bot. Durante o assumir, quem devolve é o fim dele (devolver antes chegaria antes).
    if (controla() && assumindoDesde === null) devolverAoFechar();
    terminou = true;
    desligarVivo();
    pararPlanoB();
    window.clearInterval(timerLer);
    for (const t of [timerAssumindo, timerReconectar, timerTeclas]) if (t) window.clearTimeout(t);
    if (fecharAberta === fechar) { fecharAberta = null; agenteAberto = null; }
    dialog.close();
    dialog.remove();
    opcoes.aoFechar?.();
  }
  // Se algo de fora fechar o <dialog>, fecha direito (devolve, solta o VNC).
  dialog.addEventListener("close", () => fechar());
  fecharAberta = fechar;
  agenteAberto = agente.id;

  pintar();
  q<HTMLElement>(".ctc-sair").focus();
  void (async () => {
    await ler();
    if (terminou) return;
    if (opcoes.assumir && !controla()) void assumir();
    // A tela do bot abre (e o computador acorda) pela primeira observação; com o bot no meio de uma ação ela já está
    // aberta. O VNC liga logo depois; a captura serve de primeiro quadro até ele chegar.
    if (!botOcupado()) await observar();
    preparado = true;
    if (!terminou && !vivo && !ligando) void ligarVivo();
    // Sem o VNC desde a abertura também conta para o plano B.
    armarPlanoB();
  })();
}
