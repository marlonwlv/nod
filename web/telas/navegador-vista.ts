import type { EntradaNavegador, OperacaoNavegador, QuadroAoVivoNavegador, RespostaNavegador, VistaNavegador } from "../../src/contracts/navegador-do-bot.ts";
import type { Api } from "../lib/api.ts";
import { movimentoReduzido } from "../lib/movimento.ts";
import {
  aoNome, avisoDoPedido, botaoDoMouse, caixaNaVista, chaveDaBarra, comArtigo, deNome, fraseMaiuscula, duracaoDoCursor, estadoDaPilula, estadoDaTela, htmlAvisoDoSite, htmlBarraDoNavegador, htmlEstadoDaTela,
  htmlPilula, legendaDoPasso, MS_ASSUMINDO_VISIVEL, MS_DICA_ASSUMIR, modificadoresDe, pontoNoViewport, type EstadoDaTela, type EstadoPilula,
} from "../lib/navegador-vista.ts";
import { pulsarHalo } from "./tela-cheia.ts";
import { fonteDoLogin, htmlSeloDoLogin } from "../lib/navegador-cartoes.ts";

/**
 * A vista do navegador do bot (ADR-190; Paper D1–D4, D1d, D8): UM elemento por bot, que viaja entre os hospedeiros (o
 * painel ao lado, a aba, a tela cheia e a folha do celular) sem reconectar — "a vista viaja, mesmo elemento" (D8). Liga o
 * canal ao vivo (`urlVivoNavegador`), desenha os JPEG num `<img>` com letterbox claro, desenha por cima só o cursor do bot,
 * o anel, a ondinha e o realce da aprovação, e repassa o mouse e o teclado da pessoa só com ela no controle.
 *
 * As regras puras (pílula, barra, estados, coordenadas) estão em web/lib/navegador-vista.ts; aqui só o DOM e o canal.
 */

export type Hospedeiro = "painel" | "aba" | "tela-cheia" | "folha";

/** O WebSocket que a vista usa (os testes passam um falso). */
export type SocketDaVista = {
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code: number }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  send(dados: string): void;
  close(codigo?: number): void;
  readyState: number;
};

export type OpcoesDaVista = {
  api: Pick<Api, "operarNavegador" | "irParaNoNavegador" | "trocarAbaDoNavegador" | "urlVivoNavegador" | "navegador">;
  agenteId: string;
  nome: () => string;
  /** A vista mudou por fora do REST (o canal trouxe uma nova, ou uma operação respondeu): quem hospeda redesenha. */
  aoMudar?: (r: RespostaNavegador) => void;
  /** Erro de uma ação da pessoa (a tela mostra a faixa de erro de sempre). */
  aoErro?: (e: unknown) => void;
  /** A aprovação no ponto sem volta (A1): a mesma decisão da conversa. */
  decidir?: (decisaoId: string, aprovar: boolean, sempre: boolean) => Promise<void>;
  /** O "Entrar eu mesmo" do cartão de login (L1): a mesma escolha, feita tocando a tela. Devolve a vista nova. */
  entrarEuMesmo?: (agenteId: string, decisaoId: string) => Promise<VistaNavegador | null>;
  /** Os testes passam um socket falso e o relógio; o padrão é o WebSocket do navegador. */
  abrirSocket?: (url: string) => SocketDaVista;
  agora?: () => number;
  menosMovimento?: () => boolean;
};

/** O canal caiu: tenta de novo em 1, 2, 4 e 8 s (o último se repete), como a tela do computador. */
export const ESPERAS_DO_CANAL_MS = [1_000, 2_000, 4_000, 8_000] as const;
/** D3, 4: sem o canal, a imagem a cada 2 s (a vista relê o REST e o canal tenta de novo). */
export const MS_IMAGEM_REDE_FRACA = 2_000;
/** D8: a ondinha do clique e o anel (entrada). */
export const MS_ONDINHA = 300;
/** D2, B: a linha de carregamento completa e some em 200 ms. */
export const MS_CARREGOU = 200;
/** D8: o texto da pílula ao assumir/devolver troca em fade cruzado de 180 ms (reduzir movimento: troca seca). */
export const MS_CRUZAR_PILULA = 180;
/** Os estados da pílula entre os quais a troca é cruzada (assumir e devolver, D4). */
const ESTADOS_CRUZADOS: ReadonlySet<string> = new Set(["assistindo", "assumindo", "controle", "precisa"]);
/**
 * Emenda de 2026-11-20 da ADR-190 (item 4): o tamanho da área da vista vai ao servidor 600 ms depois do fim de um
 * redimensionamento (arrastar a alça manda um só, no fim), e ele ajusta o Chrome do bot.
 */
export const MS_TAMANHO_PARADO = 600;

export type VistaMontada = {
  el: HTMLElement;
  /** Chegou uma vista nova pelo REST (o reducer): redesenha o que mudou. */
  atualizar(r: RespostaNavegador | null): void;
  /** Muda o hospedeiro (painel, aba, tela cheia, folha): a legenda e o celular mudam de lugar. */
  hospedar(h: Hospedeiro): void;
  /** A vista ficou visível/invisível (fechar o painel desliga o canal; o bot continua). */
  ligar(visivel: boolean): void;
  assumir(): Promise<void>;
  devolver(): Promise<void>;
  operar(op: OperacaoNavegador): Promise<void>;
  resposta(): RespostaNavegador | null;
  controleComPessoa(): boolean;
  focar(): void;
  destruir(): void;
};

const MAX_ENTRADA_FILA = 1_000;

export function montarVistaNavegador(o: OpcoesDaVista): VistaMontada {
  const agora = o.agora ?? (() => Date.now());
  const menosMovimento = o.menosMovimento ?? (() => movimentoReduzido());
  const el = document.createElement("section");
  el.className = "nv-vista";
  el.dataset.agente = o.agenteId;
  el.innerHTML = `<p class="nv-legenda" aria-live="off"></p>`
    + `<div class="nv-aviso-lugar"></div>`
    + `<div class="nv-moldura">`
    + `<div class="nv-barra"></div>`
    + `<div class="nv-carregando" aria-hidden="true"><i></i></div>`
    + `<div class="nv-palco" tabindex="-1" role="application" aria-roledescription="tela do navegador">`
    + `<img class="nv-quadro" alt="" draggable="false" hidden>`
    + `<div class="nv-camada" aria-hidden="true"><span class="nv-realce" hidden></span><span class="nv-anel" hidden></span><span class="nv-ondinha" hidden></span><span class="nv-rolar" hidden></span>`
    + `<span class="nv-cursor" hidden><span class="nv-cursor-y"><svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true"><path d="M2 2l13 7-6 1.6L6 17 2 2z" fill="currentColor"/></svg><b class="nv-cursor-nome"></b></span></span></div>`
    + `<div class="nv-estado-lugar"></div>`
    + `<span class="nv-dica-assumir" role="status" hidden>Assumir para mexer</span>`
    + `<input class="nv-teclado" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Digitar no site" tabindex="-1">`
    + `</div></div>`
    + `<div class="nv-faixa"><div class="nv-pilula-lugar"></div><div class="nv-selo-lugar"></div><button type="button" class="nv-teclado-bt" data-nv="teclado" hidden aria-label="Abrir o teclado">Teclado</button></div>`
    + `<p class="nv-anuncio sr-only" aria-live="polite"></p>`;
  const q = <T extends HTMLElement = HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const legenda = q(".nv-legenda");
  const avisoLugar = q(".nv-aviso-lugar");
  const moldura = q(".nv-moldura");
  const barra = q(".nv-barra");
  const carregando = q(".nv-carregando");
  const palco = q(".nv-palco");
  const img = q<HTMLImageElement>(".nv-quadro");
  const cursor = q(".nv-cursor");
  const cursorY = q(".nv-cursor-y");
  const cursorNome = q(".nv-cursor-nome");
  const anel = q(".nv-anel");
  const ondinha = q(".nv-ondinha");
  const realce = q(".nv-realce");
  const rolar = q(".nv-rolar");
  const estadoEl = q(".nv-estado-lugar");
  const dica = q(".nv-dica-assumir");
  const pilulaLugar = q(".nv-pilula-lugar");
  const seloLugar = q(".nv-selo-lugar");
  const teclado = q<HTMLInputElement>(".nv-teclado");
  const tecladoBt = q<HTMLButtonElement>(".nv-teclado-bt");
  const anuncio = q(".nv-anuncio");

  let r: RespostaNavegador | null = null;
  let host: Hospedeiro = "painel";
  let visivel = false;
  let destruida = false;
  let sock: SocketDaVista | null = null;
  let tentativas = 0;
  let timerCanal = 0;
  let timerImagem = 0;
  let canalCaiu = false;
  let temQuadro = false;
  let tamQuadro = { w: 0, h: 0 };
  let assumindoDesde: number | null = null;
  let timerAssumindo = 0;
  let timerDica = 0;
  let editando: string | null = null;
  let pintadoBarra = "";
  let pintadoPilula = "";
  let pintadoSelo = "";
  let pintadoEstado = "";
  let pintadoAviso = "";
  let ultimoPasso = 0;
  let cursorEm: { x: number; y: number } | null = null;
  let carregandoAntes = false;
  let timerCarregou = 0;
  let geracao = 0;
  let timerTamanho = 0;
  let tamanhoMandado = "";

  const vista = (): VistaNavegador | null => r?.vista ?? null;
  const controla = (): boolean => vista()?.controle === "pessoa";
  // O quadro manda: o clique e o realce seguem a imagem que a pessoa vê. medido em 2026-11-20: a vista dizia 1280×720 (o
  // padrão) e o Chrome do bot mandava quadros de 1280×633; com a imagem limitada pela altura, a conta pela vista errava o y.
  const viewport = (): { w: number; h: number } => {
    if (tamQuadro.w > 0 && tamQuadro.h > 0) return tamQuadro;
    const v = vista()?.viewport;
    return v && v.w > 0 && v.h > 0 ? v : { w: 1280, h: 800 };
  };
  const tamanhoDoPalco = (): { w: number; h: number } => {
    const b = palco.getBoundingClientRect();
    return { w: b.width, h: b.height };
  };

  // ---- o desenho -----------------------------------------------------------------------------------------------------------

  function estadoAgora(): EstadoDaTela {
    return estadoDaTela(r, { temQuadro, redeFraca: canalCaiu && temQuadro });
  }

  function pintar(): void {
    if (destruida) return;
    const v = vista();
    const nome = o.nome();
    const e = estadoAgora();
    el.dataset.host = host;
    el.dataset.estado = e;
    const pilula: EstadoPilula | null = v ? estadoDaPilula(v, assumindoDesde, agora()) : null;
    // D3, 8 e 9: a moldura preta de 2 px no controle, azul em "precisa de você" (login e aprovação contam).
    moldura.dataset.controle = !v ? "" : v.controle === "pessoa" && !v.pedido ? "pessoa" : (v.controle === "precisa_de_voce" || v.pedido) ? "precisa" : "bot";
    // A legenda do passo sai da vista (D1d): só na aba, na linha acima da vista.
    legenda.textContent = host === "aba" ? legendaDoPasso(nome, v, "aba") : "";
    legenda.hidden = host !== "aba";
    // Os avisos do site (D2, D): a faixa fina entre o cabeçalho e a vista. Rede fraca também mora aqui (sem selo na imagem).
    const avisoHtml = e === "rede_fraca" ? '<div class="nv-aviso-site" data-tipo="rede" role="status"><b>Imagem a cada 2 s</b><span class="nv-aviso-txt">A conexão está fraca; volta ao vivo sozinha.</span></div>' : htmlAvisoDoSite(v?.aviso ?? (v ? avisoDoPedido(v) : null));
    if (avisoHtml !== pintadoAviso) { avisoLugar.innerHTML = avisoHtml; pintadoAviso = avisoHtml; }
    // A barra: só com o navegador ligado (no desligado, na pausa e no erro, a vista é o estado).
    const comBarra = !!v && (v.abas.length > 0 || v.estado === "ao_vivo" || v.estado === "terminou" || v.estado === "rede_fraca");
    barra.hidden = !comBarra;
    if (v && comBarra) {
      const chave = `${chaveDaBarra(v)}|${nome}|${editando === null ? "" : "e"}`;
      if (chave !== pintadoBarra) {
        const foco = document.activeElement?.classList.contains("nv-endereco-input") && barra.contains(document.activeElement);
        barra.innerHTML = htmlBarraDoNavegador(v, { nome, editando });
        pintadoBarra = chave;
        if (foco) barra.querySelector<HTMLInputElement>(".nv-endereco-input")?.focus();
      }
    }
    // A linha de carregamento (D2, B): avança enquanto a aba ativa carrega; completa e some em 200 ms.
    const carregandoAgora = !!v?.abas.find((a) => a.ativa)?.carregando;
    if (carregandoAgora !== carregandoAntes) {
      if (timerCarregou) { window.clearTimeout(timerCarregou); timerCarregou = 0; }
      if (carregandoAgora) carregando.dataset.fase = "andando";
      else {
        carregando.dataset.fase = "completo";
        timerCarregou = window.setTimeout(() => { timerCarregou = 0; carregando.dataset.fase = ""; }, MS_CARREGOU);
      }
      carregandoAntes = carregandoAgora;
    }
    // O estado (D3): esqueleto, ligando, parados, erro, segredo.
    const htmlEstado = htmlEstadoDaTela(e, v, nome);
    if (htmlEstado !== pintadoEstado) { estadoEl.innerHTML = htmlEstado; pintadoEstado = htmlEstado; }
    img.hidden = !temQuadro || e === "segredo" || e === "desligado" || e === "pausa" || e === "erro" || e === "indisponivel" || e === "ligando";
    // A pílula (D1b, A) na faixa de 52 px. Sem vista ou parada, sem pílula (o estado tem o botão).
    const comPilula = !!v && pilula !== null && (e === "ao_vivo" || e === "rede_fraca" || e === "terminou" || e === "segredo" || e === "conectando" || v.pedido !== null || v.controle !== "bot");
    const htmlP = comPilula ? htmlPilula(nome, pilula!, v!.pedido, e === "terminou" && pilula === "assistindo" ? v!.atividadeEm : null, v!.devolveEm ?? null, v!.aparelho) : "";
    if (htmlP !== pintadoPilula) {
      const tinhaFoco = pilulaLugar.contains(document.activeElement);
      const antiga = pilulaLugar.querySelector<HTMLElement>(".nv-pilula:not(.nv-pilula-sai)");
      pilulaLugar.innerHTML = htmlP;
      pintadoPilula = htmlP;
      cruzarPilula(antiga, pilulaLugar.querySelector<HTMLElement>(".nv-pilula:not(.nv-pilula-sai)"));
      if (tinhaFoco) pilulaLugar.querySelector<HTMLElement>(".nv-pilula:not(.nv-pilula-sai) button:not([disabled])")?.focus();
    }
    // L3: "Entrando com o 1Password…" embaixo da vista, enquanto o Mac confirma ou o segredo está na página.
    // Enquanto o Mac confirma, o selo toma o lugar da pílula (Paper L3: não há o que assumir nem devolver). Com o segredo
    // já na página, os dois ficam (a pessoa pode assumir); a faixa quebra a linha se faltar largura.
    const htmlS = htmlSeloDoLogin(v, fonteDoLogin(o.agenteId));
    if (htmlS !== pintadoSelo) { seloLugar.innerHTML = htmlS; pintadoSelo = htmlS; }
    pilulaLugar.hidden = v?.pedido?.tipo === "login" && v.pedido.etapa === "confirme_no_mac";
    // Celular: no controle, o botão do teclado abre a digitação simples.
    tecladoBt.hidden = !(host === "folha" && controla());
    palco.dataset.controle = controla() ? "pessoa" : "bot";
    palco.tabIndex = controla() ? 0 : -1;
    palco.setAttribute("aria-label", controla() ? `Tela do navegador ${deNome(nome)}, você está no controle` : `Tela do navegador ${deNome(nome)}`);
    cursorNome.textContent = nome;
    pintarCamada();
  }

  /**
   * D8 (assumir e devolver): o texto da pílula troca em fade cruzado de 180 ms. A pílula velha fica por cima, sem clique nem
   * leitor de tela, e some enquanto a nova aparece; com movimento reduzido a troca é seca. Outras trocas (login, aprovação)
   * não cruzam: são outra pergunta, não o mesmo controle mudando de mão.
   */
  let timerCruzar = 0;
  function cruzarPilula(antiga: HTMLElement | null, nova: HTMLElement | null): void {
    pilulaLugar.querySelector(".nv-pilula-sai")?.remove();
    if (timerCruzar) { window.clearTimeout(timerCruzar); timerCruzar = 0; }
    if (!antiga || !nova || menosMovimento()) return;
    const de = antiga.dataset.estado ?? "";
    const para = nova.dataset.estado ?? "";
    if (de === para || !ESTADOS_CRUZADOS.has(de) || !ESTADOS_CRUZADOS.has(para)) return;
    antiga.classList.add("nv-pilula-sai");
    antiga.setAttribute("aria-hidden", "true");
    antiga.inert = true;
    antiga.removeAttribute("role");
    pilulaLugar.append(antiga);
    nova.classList.add("nv-pilula-entra");
    timerCruzar = window.setTimeout(() => { timerCruzar = 0; antiga.remove(); nova.classList.remove("nv-pilula-entra"); }, MS_CRUZAR_PILULA);
  }

  /** O que o bot faz, por cima da imagem (D2, C): o cursor com o nome, o anel no alvo, a ondinha e a barra de rolagem. */
  function pintarCamada(): void {
    const v = vista();
    const caixa = tamanhoDoPalco();
    const vp = viewport();
    // A1: o botão do site da aprovação, marcado em azul.
    const pedidoCaixa = v?.pedido?.tipo === "aprovacao" ? v.pedido.caixa : null;
    if (pedidoCaixa && temQuadro) {
      const c = caixaNaVista(pedidoCaixa, caixa, vp);
      Object.assign(realce.style, { left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` });
      realce.hidden = false;
    } else realce.hidden = true;
    const passo = v?.passo ?? null;
    const comCursor = !!v && !!passo?.caixa && v.controle !== "pessoa" && temQuadro && passo.tipo !== "esperar" && estadoAgora() !== "segredo";
    if (!comCursor || !passo?.caixa) {
      cursor.hidden = true;
      anel.hidden = true;
      rolar.hidden = !(passo?.tipo === "rolar" && temQuadro && v?.controle !== "pessoa");
      if (!comCursor) cursorEm = null;
      return;
    }
    const c = caixaNaVista(passo.caixa, caixa, vp);
    const alvo = { x: c.x + c.w / 2, y: c.y + c.h / 2 };
    const reduzido = menosMovimento();
    const ms = reduzido ? 0 : duracaoDoCursor(cursorEm, alvo);
    // A curva (D8): o X anda em ease-in-out e o Y em ease-out, em camadas separadas — o caminho sai curvo.
    cursor.style.transition = ms ? `transform ${ms}ms cubic-bezier(.45,0,.55,1)` : "none";
    cursorY.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2,.7,.3,1)` : "none";
    cursor.style.transform = `translateX(${alvo.x}px)`;
    cursorY.style.transform = `translateY(${alvo.y}px)`;
    cursor.hidden = false;
    cursor.classList.toggle("esmaecido", v.controle === "soltando");
    cursorEm = alvo;
    // O anel verde no alvo (mirar, e no clique) — aparece 300 ms antes do clique (o servidor manda o "mirar" antes).
    Object.assign(anel.style, { left: `${c.x - 3}px`, top: `${c.y - 3}px`, width: `${c.w + 6}px`, height: `${c.h + 6}px` });
    anel.hidden = !(passo.tipo === "mirar" || passo.tipo === "clicar");
    rolar.hidden = passo.tipo !== "rolar";
    // A ondinha roxa no clique (300 ms), uma vez por passo.
    if (passo.tipo === "clicar" && passo.em !== ultimoPasso && !reduzido) {
      Object.assign(ondinha.style, { left: `${alvo.x}px`, top: `${alvo.y}px` });
      ondinha.hidden = false;
      ondinha.classList.remove("tocando");
      void ondinha.offsetWidth;
      ondinha.classList.add("tocando");
      window.setTimeout(() => { ondinha.hidden = true; ondinha.classList.remove("tocando"); }, MS_ONDINHA + 20);
    }
    ultimoPasso = passo.em;
  }

  // ---- o canal ao vivo -----------------------------------------------------------------------------------------------------

  function mudouVista(nova: VistaNavegador): void {
    const antes = r;
    r = { vista: nova, disponivel: antes?.disponivel ?? true };
    if (nova.controle !== "pessoa") editando = null;
    pintar();
    o.aoMudar?.(r);
  }

  function ligarCanal(): void {
    if (sock || destruida || !visivel) return;
    if (timerCanal) { window.clearTimeout(timerCanal); timerCanal = 0; }
    const minha = ++geracao;
    let s: SocketDaVista;
    try {
      s = (o.abrirSocket ?? ((url: string) => new WebSocket(url) as unknown as SocketDaVista))(o.api.urlVivoNavegador(o.agenteId));
    } catch { agendarCanal(); return; }
    sock = s;
    s.onopen = () => { if (minha !== geracao) return; tentativas = 0; tamanhoMandado = ""; mandarTamanho(); };
    s.onmessage = (ev) => {
      if (minha !== geracao || typeof ev.data !== "string") return;
      let m: QuadroAoVivoNavegador;
      try { m = JSON.parse(ev.data) as QuadroAoVivoNavegador; } catch { return; }
      if (m.t === "quadro") {
        if (typeof m.jpeg !== "string") return;
        img.src = `data:image/jpeg;base64,${m.jpeg}`;
        tamQuadro = { w: m.w, h: m.h };
        const primeiro = !temQuadro;
        temQuadro = true;
        if (canalCaiu || primeiro) { canalCaiu = false; pararImagem(); pintar(); }
      } else if (m.t === "vista") mudouVista(m.vista);
      else if (m.t === "fim") {
        // Outra janela pegou a vista (ou o servidor vai desligar): a próxima tentativa religa quando esta voltar à frente.
        canalCaiu = m.motivo !== "outra_janela";
      }
    };
    s.onclose = (ev) => {
      if (minha !== geracao) return;
      sock = null;
      if (destruida || !visivel) return;
      // 4403: não é a dona (não tenta de novo). 4409: outra janela abriu; tenta de novo devagar.
      if (ev.code === 4403) return;
      canalCaiu = true;
      pintar();
      armarImagem();
      agendarCanal();
    };
    s.onerror = () => undefined;
  }

  function agendarCanal(): void {
    if (timerCanal || destruida || !visivel) return;
    const ms = ESPERAS_DO_CANAL_MS[Math.min(tentativas++, ESPERAS_DO_CANAL_MS.length - 1)]!;
    timerCanal = window.setTimeout(() => { timerCanal = 0; ligarCanal(); }, ms);
  }

  function desligarCanal(): void {
    geracao++;
    const s = sock;
    sock = null;
    if (timerCanal) { window.clearTimeout(timerCanal); timerCanal = 0; }
    pararImagem();
    try { s?.close(1000); } catch { /* já fechado */ }
  }

  /** D3, 4: sem o canal, a vista relê o REST a cada 2 s (a pílula e os estados seguem certos) até ele voltar. */
  function armarImagem(): void {
    if (timerImagem) return;
    timerImagem = window.setInterval(() => {
      if (!canalCaiu || destruida || !visivel) { pararImagem(); return; }
      void o.api.navegador(o.agenteId).then((nova) => { if (!destruida) { r = nova; pintar(); o.aoMudar?.(nova); } }).catch(() => undefined);
    }, MS_IMAGEM_REDE_FRACA);
  }
  function pararImagem(): void {
    if (timerImagem) { window.clearInterval(timerImagem); timerImagem = 0; }
  }

  /** A área da vista em CSS px, se mudou desde a última vez (o servidor decide se o Chrome muda). */
  function mandarTamanho(): void {
    if (!sock || sock.readyState !== 1) return;
    const t = tamanhoDoPalco();
    // definido em 2026-11-20 (D1d + emenda do item 4): a faixa do aviso do site encolhe a vista só enquanto está lá; o Chrome
    // do bot fica do tamanho sem ela (senão cada aviso mudava o viewport e derrubava a leitura do bot, e o que sobrava
    // abaixo do limiar de 8 % virava faixa cinza embaixo da imagem depois que o aviso saía).
    const aviso = el.querySelector<HTMLElement>(".nv-aviso-site");
    if (aviso) t.h += aviso.getBoundingClientRect().height + (parseFloat(getComputedStyle(aviso).marginBottom) || 0);
    if (t.w < 120 || t.h < 120) return;
    const chave = `${Math.round(t.w)}x${Math.round(t.h)}`;
    if (chave === tamanhoMandado) return;
    tamanhoMandado = chave;
    try { sock.send(JSON.stringify({ t: "tamanho", w: Math.round(t.w), h: Math.round(t.h) } satisfies EntradaNavegador)); } catch { /* o canal caiu; a reconexão manda de novo */ }
  }
  function agendarTamanho(): void {
    if (timerTamanho) window.clearTimeout(timerTamanho);
    timerTamanho = window.setTimeout(() => { timerTamanho = 0; mandarTamanho(); }, MS_TAMANHO_PARADO);
  }

  function enviar(e: EntradaNavegador): void {
    if (!sock || sock.readyState !== 1 || !controla()) return;
    try { sock.send(JSON.stringify(e)); } catch { /* o canal caiu; a reconexão cuida */ }
  }

  // ---- as operações da pessoa ----------------------------------------------------------------------------------------------

  async function operar(op: OperacaoNavegador): Promise<void> {
    try {
      const resp = await o.api.operarNavegador(o.agenteId, op);
      if (!destruida) mudouVista(resp.vista);
    } catch (e) { o.aoErro?.(e); }
  }

  async function assumir(): Promise<void> {
    if (assumindoDesde !== null || controla()) return;
    assumindoDesde = agora();
    timerAssumindo = window.setTimeout(() => { timerAssumindo = 0; pintar(); }, MS_ASSUMINDO_VISIVEL);
    try {
      await operar("assumir");
    } finally {
      assumindoDesde = null;
      if (timerAssumindo) { window.clearTimeout(timerAssumindo); timerAssumindo = 0; }
      pintar();
    }
    if (controla()) { palco.focus({ preventScroll: true }); anuncio.textContent = `Você está no controle. ${fraseMaiuscula(comArtigo(o.nome()))} espera.`; }
  }

  /** O bot parou e espera a pessoa: o login (antes do Touch ID) ou o "precisa de você" (captcha, código). */
  function esperaAPessoa(): boolean {
    const v = vista();
    if (!v || v.controle === "pessoa") return false;
    if (v.pedido?.tipo === "login") return v.pedido.etapa !== "confirme_no_mac" && !!o.entrarEuMesmo;
    return v.controle === "precisa_de_voce" && !v.pedido;
  }

  let assumindoPeloToque = false;
  async function assumirPeloToque(e: PointerEvent): Promise<void> {
    if (assumindoPeloToque) return;
    const p = pontoDoEvento(e);
    const botao = botaoDoMouse(e.button);
    const modificadores = modificadoresDe(e);
    assumindoPeloToque = true;
    try {
      const v = vista();
      if (v?.pedido?.tipo === "login") {
        const nova = await o.entrarEuMesmo!(o.agenteId, v.pedido.decisaoId).catch((err: unknown) => { o.aoErro?.(err); return null; });
        if (nova && !destruida) mudouVista(nova);
      } else await assumir();
    } finally { assumindoPeloToque = false; }
    if (destruida || !controla()) return;
    palco.focus({ preventScroll: true });
    anuncio.textContent = `Você está no controle. ${fraseMaiuscula(comArtigo(o.nome()))} espera.`;
    if (!p) return;
    enviar({ t: "mouse", evento: "mousePressed", x: p.x, y: p.y, botao, cliques: 1, modificadores });
    enviar({ t: "mouse", evento: "mouseReleased", x: p.x, y: p.y, botao, cliques: 1, modificadores });
  }

  async function devolver(): Promise<void> {
    const v = vista();
    if (!v || !(v.controle === "pessoa" || v.controle === "precisa_de_voce")) return;
    // Otimista: a borda some e a pílula volta a "Assistindo" num quadro (D8: o fade cruzado de 180 ms do cruzarPilula).
    r = { ...r!, vista: { ...v, controle: "bot" } };
    pintar();
    await operar(v.controle === "precisa_de_voce" ? "resolver" : "devolver");
    anuncio.textContent = `Devolvido ${aoNome(o.nome())}.`;
  }

  async function responderPedido(aprovar: boolean): Promise<void> {
    const p = vista()?.pedido;
    if (!p || p.tipo !== "aprovacao" || !o.decidir) return;
    try { await o.decidir(p.decisaoId, aprovar, false); } catch (e) { o.aoErro?.(e); }
  }

  function mostrarDicaAssumir(e: { clientX: number; clientY: number }): void {
    const b = palco.getBoundingClientRect();
    dica.style.left = `${Math.max(8, Math.min(b.width - 140, e.clientX - b.left + 12))}px`;
    dica.style.top = `${Math.max(8, Math.min(b.height - 32, e.clientY - b.top + 14))}px`;
    dica.hidden = false;
    if (timerDica) window.clearTimeout(timerDica);
    timerDica = window.setTimeout(() => { dica.hidden = true; timerDica = 0; }, MS_DICA_ASSUMIR);
    pulsarHalo(el.querySelector<HTMLElement>(".nv-assumir"), anuncio, menosMovimento());
  }

  function irPara(texto: string): void {
    const t = texto.trim();
    if (!t) return;
    const url = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : /\s/.test(t) || !/\./.test(t) ? `https://www.google.com/search?q=${encodeURIComponent(t)}` : `https://${t}`;
    editando = null;
    void o.api.irParaNoNavegador(o.agenteId, url).then((resp) => mudouVista(resp.vista)).catch((e: unknown) => o.aoErro?.(e));
  }

  // ---- os eventos ----------------------------------------------------------------------------------------------------------

  el.addEventListener("click", (ev) => {
    const alvo = (ev.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-nv]");
    if (!alvo || !el.contains(alvo) || (alvo as HTMLButtonElement).disabled) return;
    const c = alvo.dataset.nv;
    if (c === "assumir") void assumir();
    else if (c === "devolver" || c === "resolver") void devolver();
    else if (c === "aprovar") void responderPedido(true);
    else if (c === "recusar") void responderPedido(false);
    else if (c === "voltar") void operar("voltar");
    else if (c === "recarregar") void operar("recarregar");
    else if (c === "ligar") void operar("ligar");
    else if (c === "retomar") void operar("retomar");
    else if (c === "reler") void o.api.navegador(o.agenteId).then((nova) => { r = nova; pintar(); o.aoMudar?.(nova); }).catch((e: unknown) => o.aoErro?.(e));
    else if (c === "teclado") { teclado.focus(); }
    else if (c === "aba" && controla()) {
      const aba = alvo.dataset.aba;
      if (aba) void o.api.trocarAbaDoNavegador(o.agenteId, aba).then((resp) => mudouVista(resp.vista)).catch((e: unknown) => o.aoErro?.(e));
    }
  });
  el.addEventListener("submit", (ev) => {
    const f = (ev.target as HTMLElement | null)?.closest?.<HTMLFormElement>("[data-nv-form=endereco]");
    if (!f) return;
    ev.preventDefault();
    irPara(f.querySelector<HTMLInputElement>("input")?.value ?? "");
    palco.focus({ preventScroll: true });
  });
  el.addEventListener("input", (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.classList?.contains("nv-endereco-input")) editando = t.value;
  });
  el.addEventListener("focusin", (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.classList?.contains("nv-endereco-input")) { editando = t.value; t.select(); }
  });
  el.addEventListener("focusout", (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.classList?.contains("nv-endereco-input")) { editando = null; window.setTimeout(() => { if (!barra.contains(document.activeElement)) { pintadoBarra = ""; pintar(); } }, 0); }
  });

  // O mouse: no controle vai ao site em coordenadas do viewport; assistindo, pulsa o "Assumir" e mostra a dica (D4, A).
  const pontoDoEvento = (e: { clientX: number; clientY: number }) => {
    const b = palco.getBoundingClientRect();
    return pontoNoViewport({ x: e.clientX - b.left, y: e.clientY - b.top }, { w: b.width, h: b.height }, viewport());
  };
  let movePendente: PointerEvent | null = null;
  palco.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest?.(".nv-estado-lugar button, .nv-teclado")) return;
    if (!controla()) {
      if (!temQuadro || estadoAgora() === "segredo") return;
      e.preventDefault();
      // definido em 2026-11-20 (teste do dono): com o bot esperando a pessoa (o login ou o "precisa de você"), a tela
      // azul já é dela; tocar nela assume e o mesmo toque chega ao site. A dica "Assumir para mexer" fica para quando o
      // bot está trabalhando (D4, A).
      if (esperaAPessoa()) { void assumirPeloToque(e); return; }
      mostrarDicaAssumir(e);
      return;
    }
    const p = pontoDoEvento(e);
    if (!p) return;
    e.preventDefault();
    palco.focus({ preventScroll: true });
    try { palco.setPointerCapture?.(e.pointerId); } catch { /* sem captura */ }
    enviar({ t: "mouse", evento: "mousePressed", x: p.x, y: p.y, botao: botaoDoMouse(e.button), cliques: Math.max(1, e.detail || 1), modificadores: modificadoresDe(e) });
  });
  palco.addEventListener("pointerup", (e) => {
    if (!controla()) return;
    const p = pontoDoEvento(e);
    if (!p) return;
    enviar({ t: "mouse", evento: "mouseReleased", x: p.x, y: p.y, botao: botaoDoMouse(e.button), cliques: Math.max(1, e.detail || 1), modificadores: modificadoresDe(e) });
  });
  palco.addEventListener("pointermove", (e) => {
    if (!controla()) return;
    if (movePendente) { movePendente = e; return; }
    movePendente = e;
    window.requestAnimationFrame(() => {
      const m = movePendente;
      movePendente = null;
      if (!m) return;
      const p = pontoDoEvento(m);
      if (p) enviar({ t: "mouse", evento: "mouseMoved", x: p.x, y: p.y, modificadores: modificadoresDe(m) });
    });
  });
  palco.addEventListener("wheel", (e) => {
    if (!controla()) return;
    const p = pontoDoEvento(e);
    if (!p) return;
    e.preventDefault();
    enviar({ t: "mouse", evento: "mouseWheel", x: p.x, y: p.y, dx: Math.round(e.deltaX), dy: Math.round(e.deltaY), modificadores: modificadoresDe(e) });
  }, { passive: false });
  palco.addEventListener("contextmenu", (e) => { if (controla()) e.preventDefault(); });

  // O teclado: com o foco na vista e a pessoa no controle. ⌘⇧A devolve (D4, C).
  palco.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement) === teclado) return;
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "a") { e.preventDefault(); e.stopPropagation(); void devolver(); return; }
    if (!controla()) return;
    // ⌘\ e ⌘⇧F são da tela do nod (painel e tela cheia); ⌘V passa para o paste.
    if ((e.metaKey || e.ctrlKey) && (e.key === "\\" || (e.shiftKey && e.key.toLowerCase() === "f"))) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") return;
    e.preventDefault();
    e.stopPropagation();
    const imprime = e.key.length === 1 && !e.ctrlKey && !e.metaKey;
    enviar({ t: "tecla", evento: "keyDown", tecla: e.key, codigo: e.code, ...(imprime ? { texto: e.key } : {}), modificadores: modificadoresDe(e) });
  });
  palco.addEventListener("keyup", (e) => {
    if (!controla() || (e.target as HTMLElement) === teclado) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") return;
    e.preventDefault();
    enviar({ t: "tecla", evento: "keyUp", tecla: e.key, codigo: e.code, modificadores: modificadoresDe(e) });
  });
  palco.addEventListener("paste", (e) => {
    if (!controla()) return;
    const texto = e.clipboardData?.getData("text/plain");
    if (!texto) return;
    e.preventDefault();
    enviar({ t: "tecla", evento: "char", texto: texto.slice(0, MAX_ENTRADA_FILA) });
  });
  // Celular (D6, C): a digitação simples pelo campo escondido; Enter e apagar viram teclas.
  teclado.addEventListener("input", () => {
    const t = teclado.value;
    teclado.value = "";
    if (t) enviar({ t: "tecla", evento: "char", texto: t.slice(0, MAX_ENTRADA_FILA) });
  });
  teclado.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Backspace" || e.key === "Tab") {
      e.preventDefault();
      enviar({ t: "tecla", evento: "keyDown", tecla: e.key, codigo: e.code || e.key, modificadores: 0 });
      enviar({ t: "tecla", evento: "keyUp", tecla: e.key, codigo: e.code || e.key, modificadores: 0 });
    }
  });

  // O palco muda de tamanho (alça, janela, hospedeiro): o cursor e o realce acompanham.
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (!destruida) { cursorEm = null; pintarCamada(); agendarTamanho(); } }) : null;
  ro?.observe(palco);

  pintar();

  return {
    el,
    atualizar(nova) {
      if (destruida || nova === r) return;
      if (nova && r && assumindoDesde !== null && nova.vista.controle !== "pessoa") { r = { ...nova, vista: { ...nova.vista, controle: r.vista.controle } }; }
      else r = nova;
      if (r?.vista.controle !== "pessoa") editando = null;
      pintar();
    },
    hospedar(h) { host = h; pintar(); agendarTamanho(); },
    ligar(v) {
      if (visivel === v) return;
      visivel = v;
      if (v) { tentativas = 0; ligarCanal(); } else desligarCanal();
    },
    assumir,
    devolver,
    operar,
    resposta: () => r,
    controleComPessoa: controla,
    focar() { (controla() ? palco : el.querySelector<HTMLElement>(".nv-pilula button:not([disabled])") ?? palco).focus({ preventScroll: true }); },
    destruir() {
      if (destruida) return;
      destruida = true;
      visivel = false;
      desligarCanal();
      ro?.disconnect();
      for (const t of [timerAssumindo, timerDica, timerCarregou, timerTamanho, timerCruzar]) if (t) window.clearTimeout(t);
      el.remove();
    },
  };
}
