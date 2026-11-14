import type { IaDesktop } from "../../src/contracts/desktop.ts";
import type { Ligacao } from "../../src/contracts/ligacao.ts";
import type { CamposEntrevista, EstadoOnboarding, EtapaOnboarding } from "../../src/contracts/onboarding.ts";
import type { Api } from "../lib/api.ts";
import { esc } from "../lib/render.ts";
import type { DadosDaAcao } from "../react/onboarding/tipos.ts";
import { TEXTO_CONSENTIMENTO, VERSAO_CONSENTIMENTO } from "./ligacao.ts";
import { criarTesteDeIas } from "./onboarding-teste.ts";
import type { UiIas } from "./cartao-ia.ts";
import { criarEsteComputador } from "./este-computador.ts";
import { htmlConversaTexto, LINHA_PULOU, SO_OLHAR, type PassoTexto } from "./conversa-texto.ts";
import { destinoAoFimDoOla, htmlGuia, notaForaDoApp, ORDEM_IAS, textoComoLiberar, type AvisoOnboarding, type EstadoTelaOnboarding, type FaseTela, type VistaOnboarding } from "./onboarding.ts";
import { nesteMac } from "../lib/plataforma-da-tela.ts";
import { APPS, andar, apresentacaoInicial, emailDoGoogle, nomeDoBot, passoAtual, PASSOS, type EstadoApresentacao } from "./apresentacao.ts";
import { COMEMORA_MS, etapasDoBot, type DepsCriarBot } from "./criar-bot.ts";
import { ErroDoPreparo, novoPreparo, rodarPreparo, tique } from "../lib/preparo.ts";

/**
 * O controlador do onboarding por ligação (definido em 2026-10-04, ADR-077): a abertura, a sondagem da IA do Mac, o
 * Atender (consentimento + mídia), o "Configurar sem voz", a passagem da entrevista para a pílula e os cliques dos cards
 * guiados. O estado que vem do servidor mora no reducer (`estado.onboarding`); aqui fica só o que é da tela (timers,
 * o card de IA clicado, o botão ocupado). O desenho é de web/telas/onboarding.ts.
 *
 * definido em 2026-10-05 (o teste de verdade das IAs): dentro do app do Mac com `nodDesktop.iaTestar`, o teste começa
 * junto com o "olá" e a ligação só toca com uma IA que respondeu. O que a tela guarda desse teste mora em
 * onboarding-teste.ts; aqui ele é ligado ao "olá", à sonda de 3 s e aos cliques. Sem a ponte, nada disso liga e o
 * caminho é o de 2026-10-04.
 */

/** definido em 2026-10-04 (protótipo HiFiMac): o "olá" dura 3,3 s; a busca da IA gira 2 s; a sonda do Mac é a cada 3 s. */
export const OLA_MS = 3_300;
export const PROCURANDO_MS = 2_000;
export const SONDA_MS = 3_000;
const PRONTO_ATE_TOCAR_MS = 1_600;

export type DepsOnboarding = {
  api: () => Api | null;
  dados: () => EstadoOnboarding | null | undefined;
  aberto: () => boolean;
  hidratar: (o: EstadoOnboarding) => void;
  abrir: (aberto: boolean) => void;
  ligacao: {
    ativa: () => { ligacaoId: string; modo: "cheia" | "pilula" } | null;
    cheia: () => boolean;
    atenderOnboarding: (l: Ligacao) => boolean;
  };
  /** Relê a frota até o bot aparecer (a Nina nasce no servidor quando a etapa vira 'chamando'). */
  garantirAgente: (agenteId: string) => Promise<boolean>;
  irParaConversa: (conversaId: string, agenteId: string) => void;
  /** O login do app pelo fluxo do marketplace (chamado DENTRO do clique). */
  iniciarConexao: (slug: string, depois: () => Promise<void>) => void;
  conectando: (slug: string) => boolean;
  /** O conector já habilitado do app (o login já aconteceu antes): null = ainda não. */
  conectorHabilitado: (slug: string) => Promise<string | null>;
  /** O que mudou além da região (frota, rotinas, conversa): o main invalida. */
  invalidar: () => void;
  erro: (e: unknown) => void;
  aoMudar: () => void;
  /**
   * ADR-179 (fase 5): redesenha só a camada (o tique de 120 ms da barra do preparo), sem o render do app inteiro. Sem
   * isto, `aoMudar`.
   */
  redesenhar?: () => void;
  /** As IAs do app do Mac (web/telas/cartao-ia.ts): com a ponte `ias`, a etapa da IA usa o cartão de Provedores de IA. */
  iasMac?: () => UiIas;
  /**
   * ADA-242 (NOD_ONBOARDING_TEXTO, jornada A): sem ligação. Depois do "olá", a tela "Este computador" (só no app, uma vez
   * por máquina) e a conversa por texto com duas perguntas. Desligada, tudo segue como antes.
   */
  texto?: () => boolean;
  /** O nome sugerido na primeira pergunta (tirado do e-mail da conta). */
  nomeSugerido?: () => string | null;
  /**
   * ADR-174: com isto, o "olá" vira o onboarding em 10 passos (web/telas/apresentacao.ts), que cria o bot
   * com cor e forma e o prepara com %. Sem isto (os testes antigos), o "olá" de 3,3 s de sempre.
   */
  criarBot?: () => DepsCriarBot;
  /** O e-mail da sessão: o passo dos apps sugere Gmail e Agenda quando é do Google. */
  email?: () => string | null;
};

export type TelaOnboarding = ReturnType<typeof criarTelaOnboarding>;

export function criarTelaOnboarding(deps: DepsOnboarding) {
  let olaPassou = false;
  let timerOla: number | null = null;
  let procurandoAte = 0;
  let timerProcura: number | null = null;
  let sonda: number | null = null;
  let iaEntrando: IaDesktop | null = null;
  let notaIa: string | null = null;
  let atendendo = false;
  let ocupado = false;
  let concluindo = false;
  /** Concluiu nesta página: "Tudo montado" continua na conversa até a pessoa sair dela. */
  let acabouDeConcluir = false;
  let releitura: number | null = null;
  let avancando = false;
  // ADA-242: a jornada A (texto).
  const jornadaA = (): boolean => deps.texto?.() === true;
  let naTelaComputador = false;
  /** Aceite 6: a pessoa já passou pelo onboarding, mas esta máquina não viu "Este computador" (só essa tela, sem conversa). */
  let soComputador = false;
  let maquinaVerificada = false;
  let passoTexto: PassoTexto = { passo: "apelido" };
  let textoOcupado = false;
  let textoErro: string | null = null;
  /** O aviso de leitura aberto por cima da camada ("Sua voz na ligação", "Como liberar o …"). */
  let aviso: AvisoOnboarding | null = null;
  /** A pessoa pulou as perguntas (ou só quer olhar): a linha fica na conversa do Nod. */
  let pulouEm: string | null = null;
  // ADR-174: o onboarding em 10 passos. `pelaLigacao`: a pessoa escolheu "Prefiro conversar por voz" (o caminho antigo).
  let apres: EstadoApresentacao = apresentacaoInicial();
  let pelaLigacao = false;
  let relogioPreparo = 0;
  const ctxBot = { nome: "", forma: apres.forma, cor: apres.cor, criado: null as { agenteId: string; conversaId: string } | null };
  const comApresentacao = (): boolean => !!deps.criarBot && !pelaLigacao;

  const api = (): Api => {
    const a = deps.api();
    if (!a) throw new Error("sem_sessao");
    return a;
  };

  /** O teste de verdade das IAs deste Mac (definido em 2026-10-05): começa com o "olá" e decide se a ligação toca. */
  const teste = criarTesteDeIas({
    ponte: () => window.nodDesktop,
    dados: deps.dados,
    agendar: (fn, ms) => { const t = window.setTimeout(fn, ms); return () => window.clearTimeout(t); },
    aoMudar: () => deps.aoMudar(),
    reler: () => reler(),
    aoFimDoTeste: () => {
      deps.aoMudar();
      const d = deps.dados();
      // Antes do fim do "olá" nada muda na tela: `passarOla` decide quando ele acabar.
      if (!olaPassou || !d) return;
      // O Mac não testou (recusou o pedido): vale o que o servidor diz do login, como em 2026-10-04.
      if (!teste.ativo()) void seguirPeloLogin(d, false);
      else void reler();
    },
    ligar: () => chamar(),
    ligando: () => avancando,
    ficarNaEtapaDaIa: async () => { if (deps.dados()?.etapa !== "executor") await mudarEtapa("executor").catch(() => undefined); },
  });

  const computador = criarEsteComputador({
    ponte: () => window.nodDesktop,
    estadosMac: () => deps.iasMac?.().estados ?? {},
    inventario: () => deps.dados()?.executor.ias ?? [],
    reler: () => reler(),
    agora: () => Date.now(),
    aoMudar: () => deps.aoMudar(),
  });

  function hidratar(o: EstadoOnboarding): void {
    deps.hidratar(o);
    deps.aoMudar();
  }

  /** A fase que a tela mostra, das etapas do servidor e do que é local (o "olá", a ligação aberta aqui). */
  function fase(d: EstadoOnboarding): FaseTela | null {
    if (!deps.aberto()) return null;
    if (soComputador) return "computador";
    if (d.etapa === "concluido") return acabouDeConcluir ? "fim" : null;
    // O servidor tirou o onboarding da frente (a guia foi excluída no meio): a camada fecha na próxima leitura.
    if (!d.mostrar) return null;
    if (jornadaA() && (d.etapa === null || d.etapa === "ola" || d.etapa === "executor" || d.etapa === "chamando")) return naTelaComputador ? "computador" : "ola";
    if (!olaPassou && (d.etapa === null || d.etapa === "ola" || d.etapa === "executor")) return "ola";
    // Com teste, o "pronto" do servidor é só o login: a ligação espera uma IA que respondeu e a pessoa ter seguido.
    if (d.etapa === null || d.etapa === "ola" || d.etapa === "executor") return (teste.ativo() ? teste.podeLigar(d) : d.executor.pronto) ? "chamando" : "executor";
    if (d.etapa === "chamando") return "chamando";
    if (d.etapa === "entrevista" && deps.ligacao.ativa()) return "entrevista";
    return d.passo === "fim" ? "fim" : "configurando";
  }

  function estadoTela(): EstadoTelaOnboarding | null {
    const d = deps.dados();
    if (!d) return null;
    const f = fase(d);
    if (!f) return null;
    return {
      dados: d,
      fase: f,
      procurando: Date.now() < procurandoAte,
      iaEntrando,
      notaIa,
      teste: teste.naTela(),
      atendendo,
      emLigacao: deps.ligacao.ativa() !== null,
      appConectando: deps.conectando(d.modelo.app.slug),
      ocupado,
      iasMac: deps.iasMac?.() ?? null,
    };
  }

  /** O que a região `#onboarding` mostra (null fora das fases de tela cheia e da entrevista); o desenho é React. */
  function vista(): VistaOnboarding | null {
    const e = estadoTela();
    if (!e) return null;
    agendarPelaFase(e);
    const com = (camada: VistaOnboarding["camada"]): VistaOnboarding => ({ camada, aviso });
    if (e.fase === "computador") return com({ tipo: "computador", computador: computador.vista() });
    if (e.fase === "ola" && comApresentacao()) {
      const conectando = APPS.find((a) => deps.conectando(a.slug))?.slug ?? null;
      return com({ tipo: "apresentacao", apres: { ...apres, conectando }, emailGoogle: emailDoGoogle(deps.email?.()), ligacao: !jornadaA() });
    }
    // Sem guia, a configuração é uma camada por cima do app: precisa de uma saída ("Fazer depois").
    if (e.fase === "configurando" && !e.dados.guia) return com({ tipo: "guia-solta", tela: e });
    switch (e.fase) {
      case "ola": return com({ tipo: "ola" });
      case "executor": return com({ tipo: "executor", tela: e });
      case "chamando": return com({ tipo: "chamando", tela: e });
      case "entrevista": return deps.ligacao.cheia() ? com({ tipo: "entrevista", dados: e.dados }) : null;
      default: return null;
    }
  }

  /** Os efeitos de cada fase (timer do olá, sonda do Mac, conclusão) — idempotentes, chamados a cada desenho. */
  function agendarPelaFase(e: EstadoTelaOnboarding): void {
    if (e.fase === "ola" && !jornadaA()) teste.iniciar(e.dados);
    if (e.fase === "ola" && timerOla === null && !comApresentacao()) timerOla = window.setTimeout(() => { timerOla = null; void passarOla(); }, OLA_MS);
    if ((e.fase === "executor" || e.fase === "computador") && sonda === null) sonda = window.setInterval(() => void (e.fase === "computador" ? sondarComputador() : sondar()), SONDA_MS);
    if (e.fase !== "executor" && e.fase !== "computador" && sonda !== null) { window.clearInterval(sonda); sonda = null; }
    if (e.fase === "fim" && e.dados.etapa !== "concluido" && !e.emLigacao) void concluir();
  }

  async function passarOla(): Promise<void> {
    if (olaPassou) return;
    olaPassou = true;
    if (timerOla !== null) { window.clearTimeout(timerOla); timerOla = null; }
    const d = deps.dados();
    if (!d) return;
    if (jornadaA()) {
      if (await computador.decidir()) { naTelaComputador = true; deps.aoMudar(); }
      else await irParaTexto();
      return;
    }
    teste.iniciar(d);
    const destino = destinoAoFimDoOla(teste.naTela());
    if (destino === "como_antes") { await seguirPeloLogin(d, true); return; }
    // Tela 5 do plano das IAs (2026-10-10): no app com a ponte `ias`, uma IA pronta e a outra não, a tela para nos cartões
    // com "Continuar com o …" e a dica de conectar a segunda (se uma chegar ao limite, a outra assume).
    if (destino === "ligar" && !sugerirSegunda()) { await teste.seguir(); return; }
    // O teste ainda roda, ou nenhuma IA respondeu: a etapa "A IA dos seus bots" (a tela sai de `telaDaIa`).
    deps.aoMudar();
    if (d.etapa !== "executor") await mudarEtapa("executor").catch(() => undefined);
  }

  /** Com a ponte `ias` e uma IA que ainda não respondeu: a etapa da IA mostra os cartões antes de ligar. */
  function sugerirSegunda(): boolean {
    const t = teste.naTela();
    return Boolean(deps.iasMac?.().noApp && t && ORDEM_IAS.some((ia) => t.vereditos[ia]?.estado !== "pronto"));
  }

  /** O caminho de 2026-10-04, sem teste: o que o servidor diz do login decide entre a ligação e os cards de IA. */
  async function seguirPeloLogin(d: EstadoOnboarding, comBusca: boolean): Promise<void> {
    if (d.executor.pronto) { await chamar(); return; }
    if (comBusca) {
      procurandoAte = Date.now() + PROCURANDO_MS;
      if (timerProcura !== null) window.clearTimeout(timerProcura);
      timerProcura = window.setTimeout(() => { timerProcura = null; deps.aoMudar(); }, PROCURANDO_MS + 20);
    }
    deps.aoMudar();
    if (d.etapa !== "executor") await mudarEtapa("executor").catch(() => undefined);
  }

  async function mudarEtapa(etapa: Exclude<EtapaOnboarding, "concluido">, semVoz = false): Promise<EstadoOnboarding> {
    const o = await api().etapaOnboarding(semVoz ? { etapa, semVoz } : { etapa });
    hidratar(o);
    return o;
  }

  /** Etapa 'chamando': o servidor garante a Nina e cria a ligação; com recusa (sem voz aqui), segue para os cards. */
  async function chamar(): Promise<void> {
    if (avancando) return;
    avancando = true;
    try {
      const o = await mudarEtapa("chamando");
      if (o.guia) await deps.garantirAgente(o.guia.id);
      if (!o.ligacao || o.recusa) await semVoz();
      deps.aoMudar();
    } catch (e) {
      deps.erro(e);
    } finally {
      avancando = false;
    }
  }

  async function sondar(): Promise<void> {
    const a = deps.api();
    if (!a) return;
    const o = await a.onboarding().catch(() => null);
    if (!o) return;
    hidratar(o);
    // Com teste, o "pronto" do servidor é só o login: quem decide o próximo passo é o teste (onboarding-teste.ts).
    if (teste.ativo()) { teste.aoEstadoDoServidor(o); return; }
    if (o.executor.pronto && !avancando) {
      const nome = iaEntrando === "codex-cli" ? "ChatGPT" : "Claude";
      notaIa = `${nome} conectado.`;
      iaEntrando = null;
      deps.aoMudar();
      window.setTimeout(() => void chamar(), PRONTO_ATE_TOCAR_MS);
      if (sonda !== null) { window.clearInterval(sonda); sonda = null; }
    }
  }

  async function iaNoMac(ia: IaDesktop, acao: "entrar" | "instalar"): Promise<void> {
    const ponte = window.nodDesktop;
    const fn = acao === "entrar" ? ponte?.iaEntrar : ponte?.iaInstalar;
    if (!ponte || !fn) { notaIa = notaForaDoApp(ia, acao); deps.aoMudar(); return; }
    // Com teste, o clique abre a conexão em três passos; sem ele, o card espera o login como em 2026-10-04.
    if (teste.ativo()) { notaIa = null; await teste.conectar(ia, acao); return; }
    const nome = ia === "codex-cli" ? "ChatGPT" : "Claude";
    try {
      const r = await fn.call(ponte, ia);
      if (r.ok) { iaEntrando = ia; notaIa = `Abrimos o navegador. Entre no ${nome} e volte; o nod percebe sozinho.`; }
      else notaIa = r.motivo === "nao_instalado" ? notaForaDoApp(ia, "instalar") : `Não deu para abrir o login do ${nome}. ${notaForaDoApp(ia, "entrar")}`;
    } catch {
      notaIa = notaForaDoApp(ia, acao);
    }
    deps.aoMudar();
  }

  /** "Testar de novo" fora do app do Mac (a causa veio do servidor, de outro computador da pessoa): diz onde testar. */
  async function testarIa(ia: IaDesktop): Promise<void> {
    if (!window.nodDesktop?.iaTestar) { notaIa = `O teste roda no app do nod, ${nesteMac()}. Abra o app para testar de novo.`; deps.aoMudar(); return; }
    await teste.testar(ia);
  }

  function mostrarAviso(a: AvisoOnboarding | null): void {
    aviso = a;
    deps.aoMudar();
  }

  function comoLiberar(ia: IaDesktop): void {
    mostrarAviso(textoComoLiberar(ia));
  }

  /** O Atender: o clique é o consentimento de voz e o gesto que libera áudio e microfone. */
  async function atender(): Promise<void> {
    const d = deps.dados();
    if (atendendo || !d) return;
    atendendo = true;
    deps.aoMudar();
    try {
      await api().consentirVoz(VERSAO_CONSENTIMENTO);
      const o = await mudarEtapa("entrevista");
      const lig = o.ligacao ?? d.ligacao;
      if (!lig || (lig.estado !== "chamando" && lig.estado !== "em_curso")) { await semVoz(); return; }
      if (o.guia) deps.irParaConversa(o.guia.conversaId, o.guia.id);
      if (!(await deps.garantirAgente(lig.agenteId)) || !deps.ligacao.atenderOnboarding(lig)) await semVoz();
    } catch (e) {
      deps.erro(e);
    } finally {
      atendendo = false;
      deps.aoMudar();
    }
  }

  /** "Configurar sem voz" (ou a voz não deu): encerra a ligação e abre os cards com o objetivo padrão. */
  async function semVoz(): Promise<void> {
    const o = await mudarEtapa("configurando", true);
    if (o.guia) {
      await deps.garantirAgente(o.guia.id);
      deps.irParaConversa(o.guia.conversaId, o.guia.id);
    }
  }

  /** ADA-242: a sonda da tela "Este computador" (o 2f por prazo; no Windows, relê o inventário enquanto espera o login). */
  async function sondarComputador(): Promise<void> {
    await computador.sondar();
    deps.aoMudar();
  }

  /** ADA-242: sai do "olá" (ou de "Este computador") para a conversa por texto com o Nod, sem ligação. */
  async function irParaTexto(): Promise<void> {
    const deComputador = naTelaComputador;
    naTelaComputador = false;
    passoTexto = { passo: "apelido" };
    try {
      await semVoz();
    } catch (e) {
      // A etapa não mudou: volta para a tela de onde saiu, com o botão valendo de novo (senão o "olá" fica preso).
      if (deComputador) naTelaComputador = true;
      else olaPassou = false;
      deps.erro(e);
    }
    deps.aoMudar();
  }

  /** Continuar/Pular em "Este computador": grava o "já vi"; na máquina nova de quem já concluiu, só fecha a camada. */
  async function sairDoComputador(): Promise<void> {
    await computador.passar();
    if (!soComputador) { await irParaTexto(); return; }
    soComputador = false;
    deps.abrir(false);
    deps.aoMudar();
  }

  /**
   * Aceite 6 (reinstalação limpa, mesmo e-mail): a etapa é da pessoa e já acabou, mas o "já vi" é desta máquina. Uma vez
   * por sessão, com a leitura do onboarding feita e a camada fechada, abre só "Este computador".
   */
  async function verificarMaquina(): Promise<void> {
    if (maquinaVerificada || !jornadaA() || deps.aberto()) return;
    const d = deps.dados();
    if (!d || d.mostrar) return;
    maquinaVerificada = true;
    if (!(await computador.decidir()) || deps.aberto()) return;
    soComputador = true;
    deps.abrir(true);
    deps.aoMudar();
  }

  /** ADA-242: as duas respostas vão com a etapa 'configurando' (a mesma ação `onboarding.etapa`). */
  async function enviarRespostas(apelido: string | null, objetivo: string | null): Promise<void> {
    if (textoOcupado) return;
    textoOcupado = true;
    textoErro = null;
    deps.aoMudar();
    try {
      const respostas = { ...(apelido ? { apelido } : {}), ...(objetivo && objetivo !== SO_OLHAR ? { objetivo } : {}) };
      hidratar(await api().etapaOnboarding({ etapa: "configurando", semVoz: true, respostas }));
      passoTexto = { passo: "enviando", apelido, objetivo };
      if (objetivo === SO_OLHAR) await pularPerguntas();
      else deps.invalidar();
    } catch (e) {
      textoErro = "Não consegui guardar agora. Tente de novo.";
      deps.erro(e);
    } finally {
      textoOcupado = false;
      deps.aoMudar();
    }
  }

  /** "Pular as perguntas" (ou "Só quero olhar"): conclui sem bot e deixa uma linha na conversa do Nod. */
  async function pularPerguntas(): Promise<void> {
    pulouEm = deps.dados()?.guia?.conversaId ?? null;
    await fazerDepois();
  }

  async function concluir(): Promise<void> {
    if (concluindo) return;
    concluindo = true;
    try {
      acabouDeConcluir = true;
      hidratar(await api().concluirOnboarding());
    } catch (e) {
      acabouDeConcluir = false;
      deps.erro(e);
    } finally {
      concluindo = false;
    }
  }

  async function reler(): Promise<void> {
    const a = deps.api();
    if (!a) return;
    const o = await a.onboarding().catch(() => null);
    if (o) hidratar(o);
  }

  /** Um clique de card: botão ocupado, a ação, a releitura do estado e do que mais mudou. */
  async function agir(fn: (a: Api) => Promise<EstadoOnboarding | unknown>): Promise<void> {
    if (ocupado) return;
    ocupado = true;
    deps.aoMudar();
    try {
      const r = await fn(api());
      if (r && typeof r === "object" && "etapa" in r && "campos" in r) hidratar(r as EstadoOnboarding);
      else await reler();
      deps.invalidar();
    } catch (e) {
      deps.erro(e);
    } finally {
      ocupado = false;
      deps.aoMudar();
    }
  }

  function saberMais(): void {
    mostrarAviso({ titulo: "Sua voz na ligação", paragrafos: [TEXTO_CONSENTIMENTO] });
  }

  async function conectarApp(slug: string): Promise<void> {
    const d = deps.dados();
    const bot = d?.bot;
    if (!d || !bot) return;
    const conceder = async (): Promise<void> => {
      const id = await deps.conectorHabilitado(slug);
      if (id) await api().definirNivel(bot.id, id, "leitura");
      await reler();
      deps.invalidar();
    };
    // O app já conectado antes: só o acesso de leitura para o bot novo.
    const ja = await deps.conectorHabilitado(slug);
    if (ja) { await agir(async () => { await api().definirNivel(bot.id, ja, "leitura"); return null; }); return; }
    deps.iniciarConexao(slug, conceder);
    deps.aoMudar();
  }

  const iaDoClique = (d: DadosDaAcao): IaDesktop => (d.ia === "codex-cli" ? "codex-cli" : "claude-cli");

  // ---- ADR-174: os 10 passos -------------------------------------------------------------------------------------------
  /** Um passo novo: o título dele recebe o foco no componente (web/react/onboarding/apresentacao.tsx). */
  function mudarApres(novo: EstadoApresentacao): void {
    apres = novo;
    deps.aoMudar();
  }

  function guardarRespostas(): void {
    try { localStorage.setItem("nod.onboarding.respostas", JSON.stringify({ funcao: apres.funcao, origem: apres.origem })); } catch { /* sem armazenamento: só não guarda */ }
  }

  /** O computador e a IA do bot respondem? Espera um pouco (o teste das IAs pode estar rodando) antes de dar erro. */
  async function iaPronta(): Promise<boolean> {
    for (let i = 0; i < 6; i++) {
      const d = deps.dados();
      if (d && (teste.ativo() ? teste.podeLigar(d) : d.executor.pronto)) return true;
      await new Promise((r) => window.setTimeout(r, 1_500));
      await reler();
    }
    return false;
  }

  async function prepararBot(): Promise<void> {
    const criar = deps.criarBot?.();
    if (!criar || !apres.preparo) return;
    ctxBot.nome = apres.preparo.nome;
    ctxBot.forma = apres.forma;
    ctxBot.cor = apres.cor;
    const primeira = apres.primeira.trim();
    const apps = [...apres.apps];
    const etapas = etapasDoBot(ctxBot, {
      ...criar,
      computadorPronto: async (agenteId) => {
        if (!(await criar.computadorPronto(agenteId))) return false;
        if (!(await iaPronta())) throw new ErroDoPreparo(`${ctxBot.nome} não terminou de se preparar: falta uma IA conectada para ele pensar.`);
        return true;
      },
    }, {
      apps: async (agenteId) => {
        for (const slug of apps) {
          const id = await deps.conectorHabilitado(slug);
          if (id) await api().definirNivel(agenteId, id, "leitura");
        }
      },
      instrucoes: async (conversaId) => {
        if (primeira) await api().enviar(conversaId, primeira);
        else await new Promise((r) => window.setTimeout(r, 700));
      },
    });
    if (relogioPreparo) window.clearInterval(relogioPreparo);
    relogioPreparo = window.setInterval(() => {
      if (!apres.preparo) return;
      const p = tique(apres.preparo);
      apres = { ...apres, preparo: p };
      // Só a camada redesenha a cada tique; o React mexe na barra e no número, sem recriar o personagem.
      (deps.redesenhar ?? deps.aoMudar)();
    }, 120);
    const fim = await rodarPreparo(apres.preparo, etapas, (p) => { apres = { ...apres, preparo: p }; deps.aoMudar(); });
    window.clearInterval(relogioPreparo);
    relogioPreparo = 0;
    deps.invalidar();
    if (!fim.pronto || !ctxBot.criado) return;
    const { agenteId, conversaId } = ctxBot.criado;
    await new Promise((r) => window.setTimeout(r, COMEMORA_MS));
    await fazerDepois();
    deps.irParaConversa(conversaId, agenteId);
  }

  const acoesApres: Record<string, (d: DadosDaAcao) => Promise<void> | void> = {
    "apres-seguir": () => mudarApres(andar(apres, 1)),
    "apres-voltar": () => mudarApres(andar(apres, -1)),
    "apres-pular": () => {
      const p = passoAtual(apres);
      mudarApres(andar({ ...apres, ...(p === "funcao" ? { funcao: null } : p === "origem" ? { origem: null } : {}) }, 1));
      guardarRespostas();
    },
    // O botão clicado continua no DOM (o React não o recria): o foco fica nele sem ajuda.
    "apres-escolher": (d) => {
      const valor = d.valor ?? null;
      if (d.campo === "funcao") apres = { ...apres, funcao: valor };
      else if (d.campo === "origem") apres = { ...apres, origem: valor };
      guardarRespostas();
      deps.aoMudar();
    },
    "apres-forma": (d) => {
      if (d.forma) { apres = { ...apres, forma: d.forma as EstadoApresentacao["forma"] }; deps.aoMudar(); }
    },
    "apres-cor": (d) => {
      if (d.cor) { apres = { ...apres, cor: d.cor as EstadoApresentacao["cor"] }; deps.aoMudar(); }
    },
    // O nome e a primeira mensagem do passo 9 ficam no campo (estado do componente): aqui só se guardam, sem redesenhar.
    "apres-digitar": (d) => {
      if (d.campo === "nome") apres = { ...apres, nome: d.valor ?? "" };
      else if (d.campo === "primeira") apres = { ...apres, primeira: d.valor ?? "" };
    },
    // O login do app abre DENTRO do clique (o navegador bloqueia a janela fora dele); o acesso do bot sai no preparo.
    "apres-conectar": (d) => {
      const slug = d.slug;
      if (!slug) return;
      deps.iniciarConexao(slug, async () => {
        if (!apres.apps.includes(slug)) apres = { ...apres, apps: [...apres.apps, slug] };
        deps.aoMudar();
      });
      deps.aoMudar();
    },
    "apres-ligacao": () => { pelaLigacao = true; deps.aoMudar(); void passarOla(); },
    "apres-criar": () => {
      if (!nomeDoBot(apres)) return;
      const nomesApps = APPS.filter((a) => apres.apps.includes(a.slug)).map((a) => a.nome);
      mudarApres({ ...apres, passo: PASSOS.indexOf("preparando"), preparo: novoPreparo(nomeDoBot(apres), nomesApps) });
      void prepararBot();
    },
    "apres-tentar": () => void prepararBot(),
    // "Ver o que houve": o caminho de antes, que mostra a IA dos bots (o que mais falta num bot que não acorda).
    "apres-ver": () => { pelaLigacao = true; deps.aoMudar(); void passarOla(); },
  };

  /** O "Criar bot" do card guiado (a camada solta, em React, e o bloco na conversa da guia, por string). */
  function criarBotGuiado(nome: string, descricao: string, decisao: string | undefined): Promise<void> | void {
    if (!nome) return;
    return agir((a) => (decisao ? a.decidirBot(decisao, { nome, descricao }) : a.botDoOnboarding(nome, descricao)));
  }

  /**
   * As ações pelo nome, com os dados do clique (`d`: o `dataset` do botão na delegação do main.ts, ou o objeto que o
   * componente React passa). As da camada só vêm do React; as do bloco na conversa da guia, da delegação.
   */
  const acoes: Record<string, (d: DadosDaAcao) => Promise<void> | void> = {
    ...acoesApres,
    "onboarding-pular-ola": () => passarOla(),
    "onboarding-depois": () => fazerDepois(),
    "onboarding-ia-entrar": (d) => iaNoMac(iaDoClique(d), "entrar"),
    "onboarding-ia-instalar": (d) => iaNoMac(iaDoClique(d), "instalar"),
    "onboarding-ia-testar": (d) => testarIa(iaDoClique(d)),
    "onboarding-ia-como-liberar": (d) => comoLiberar(iaDoClique(d)),
    "onboarding-fechar-aviso": () => mostrarAviso(null),
    "onboarding-ia-pagina": (d) => teste.abrirInstalacao(iaDoClique(d)),
    "onboarding-ia-login": (d) => teste.abrirLogin(iaDoClique(d)),
    "onboarding-ia-cancelar": () => teste.cancelar(),
    "onboarding-ia-continuar": () => teste.seguir(),
    "onboarding-atender": () => atender(),
    "onboarding-sem-voz": async () => {
      if (atendendo) return;
      atendendo = true;
      deps.aoMudar();
      try { await semVoz(); } catch (e) { deps.erro(e); } finally { atendendo = false; deps.aoMudar(); }
    },
    "onboarding-saber-mais": () => saberMais(),
    "onboarding-recusar-bot": (d) => agir((a) => a.decidirBot(d.id ?? "", { recusar: true })),
    "onboarding-bot-enviar": (d) => criarBotGuiado((d.nome ?? "").trim(), (d.descricao ?? "").trim(), d.decisao),
    "onboarding-conectar-app": (d) => conectarApp(d.slug ?? ""),
    "onboarding-permitir-app": (d) => agir((a) => a.decidir(d.id ?? "", {})),
    "onboarding-escolher-rotina": (d) => agir((a) => a.rotinaDoOnboarding(Number(d.indice ?? "0"))),
    "onboarding-criar-rotina-proposta": (d) => agir((a) => a.decidir(d.id ?? "", {})),
    "onboarding-de-novo": () => deNovo(),
    // ADA-242: a tela "Este computador" e a conversa por texto (só com NOD_ONBOARDING_TEXTO).
    "computador-instalar": (d) => computador.acoes["computador-instalar"](iaDoClique(d)),
    "computador-entrar": (d) => computador.acoes["computador-entrar"](iaDoClique(d)),
    "computador-abrir": (d) => computador.acoes["computador-abrir"](iaDoClique(d)),
    "computador-conferir": (d) => computador.acoes["computador-conferir"](iaDoClique(d)),
    "computador-cancelar": (d) => computador.acoes["computador-cancelar"](iaDoClique(d)),
    "computador-codigo": (d) => computador.colarCodigo(iaDoClique(d), d.codigo ?? ""),
    "computador-continuar": () => sairDoComputador(),
    "computador-pular": () => sairDoComputador(),
    "texto-apelido-sim": () => { passoTexto = { passo: "objetivo", apelido: deps.nomeSugerido?.() ?? null }; deps.aoMudar(); },
    "texto-objetivo": (d) => enviarRespostas(passoTexto.passo === "apelido" ? null : passoTexto.apelido, d.valor ?? null),
    "texto-pular": () => pularPerguntas(),
  };

  const forms: Record<string, (form: HTMLFormElement) => Promise<void> | void> = {
    "onboarding-bot": (form) => {
      const dados = new FormData(form);
      return criarBotGuiado(String(dados.get("nome") ?? "").trim(), String(dados.get("descricao") ?? "").trim(), form.dataset.decisaoBot);
    },
    "texto-apelido": (form) => {
      const apelido = String(new FormData(form).get("apelido") ?? "").trim();
      if (!apelido) return;
      passoTexto = { passo: "objetivo", apelido };
      deps.aoMudar();
    },
    "texto-objetivo": (form) => {
      const objetivo = String(new FormData(form).get("objetivo") ?? "").trim();
      if (!objetivo) return;
      return enviarRespostas(passoTexto.passo === "apelido" ? null : passoTexto.apelido, objetivo);
    },
  };

  /** "Fazer depois" na configuração sem guia: conclui sem o "Tudo montado" e devolve o app (o menu da conta reabre). */
  async function fazerDepois(): Promise<void> {
    if (concluindo) return;
    concluindo = true;
    try {
      acabouDeConcluir = false;
      hidratar(await api().concluirOnboarding());
      deps.aoMudar();
    } catch (e) {
      deps.erro(e);
    } finally {
      concluindo = false;
    }
  }

  /** "Ver o onboarding de novo" (menu da conta e o fim da configuração): volta ao "olá". */
  async function deNovo(): Promise<void> {
    try {
      olaPassou = false;
      acabouDeConcluir = false;
      notaIa = null;
      iaEntrando = null;
      naTelaComputador = false;
      soComputador = false;
      passoTexto = { passo: "apelido" };
      pulouEm = null;
      apres = apresentacaoInicial();
      pelaLigacao = false;
      ctxBot.criado = null;
      aviso = null;
      teste.recomecar();
      hidratar(await api().etapaOnboarding({ etapa: "ola" }));
      deps.abrir(true);
      deps.aoMudar();
    } catch (e) {
      deps.erro(e);
    }
  }

  return {
    vista,
    /** A camada cobre o app (olá, IA, "está te ligando"): o main deixa a `.app` inerte. */
    cobre: (): boolean => {
      const e = estadoTela();
      return !!e && (e.fase === "ola" || e.fase === "computador" || e.fase === "executor" || e.fase === "chamando");
    },
    /** O bloco dos cards guiados na conversa da guia (vazio fora da configuração ou em outra conversa). */
    blocoNaConversa(conversaId: string): string {
      if (pulouEm !== null && pulouEm === conversaId) return `<div class="ct-conversa ct-resolvida"><div class="ct-fala"><b>Nod</b><p>${esc(LINHA_PULOU)}</p></div></div>`;
      const e = estadoTela();
      // ADA-242: antes dos cards, as duas perguntas (só até o objetivo chegar ao servidor; numa releitura, os cards).
      if (jornadaA() && e?.fase === "configurando" && e.dados.guia?.conversaId === conversaId && passoTexto.passo !== "enviando" && !e.dados.campos.objetivo && !e.dados.bot) {
        return htmlConversaTexto(passoTexto, { sugestao: deps.nomeSugerido?.() ?? null, ocupado: textoOcupado, erro: textoErro });
      }
      if (!e || (e.fase !== "configurando" && e.fase !== "fim") || e.dados.guia?.conversaId !== conversaId) return "";
      return htmlGuia(e);
    },
    acoes,
    forms,
    deNovo,
    verificarMaquina,
    /** NOD-209: "Trocar conta" num cartão do onboarding (web/lib/ias-do-mac.ts avisa o começo e o fim). */
    comecarTroca: (ia: IaDesktop): void => teste.comecarTroca(ia),
    fimDaTroca: (ia: IaDesktop, trocou: boolean): void => teste.fimDaTroca(ia, trocou),
    /** A mídia da ligação: um campo anotado (o painel ao lado) ou o fim da entrevista (a pílula e os cards). */
    aoOnboarding(etapa: EtapaOnboarding, campos: CamposEntrevista): void {
      const d = deps.dados();
      if (!d) return;
      hidratar({ ...d, etapa, campos });
      if (etapa === "configurando") {
        if (d.guia) deps.irParaConversa(d.guia.conversaId, d.guia.id);
        void reler();
      }
    },
    /** Um frame qualquer durante a configuração: relê o estado (cards, app, rotina) sem martelar o servidor. */
    aoFrame(): void {
      const d = deps.dados();
      if (!deps.aberto() || !d || (d.etapa !== "configurando" && d.etapa !== "entrevista")) return;
      if (releitura !== null) window.clearTimeout(releitura);
      releitura = window.setTimeout(() => { releitura = null; void reler(); }, 400);
    },
    /** A ligação acabou: na entrevista, segue sem voz; com tudo montado, conclui. */
    async aoLigacaoEncerrada(): Promise<void> {
      const d = deps.dados();
      if (!d || !deps.aberto()) return;
      await reler();
      const atual = deps.dados();
      if (!atual) return;
      if (atual.etapa === "chamando" || atual.etapa === "entrevista") await mudarEtapa("configurando").catch(() => undefined);
      else if (atual.passo === "fim" && atual.etapa !== "concluido") await concluir();
    },
    /** Outra sessão: zera o que é da tela. */
    descartar(): void {
      for (const t of [timerOla, timerProcura, releitura]) if (t !== null) window.clearTimeout(t);
      if (sonda !== null) window.clearInterval(sonda);
      timerOla = timerProcura = releitura = sonda = null;
      olaPassou = false;
      acabouDeConcluir = false;
      iaEntrando = null;
      notaIa = null;
      naTelaComputador = false;
      soComputador = false;
      maquinaVerificada = false;
      passoTexto = { passo: "apelido" };
      textoErro = null;
      pulouEm = null;
      aviso = null;
      apres = apresentacaoInicial();
      pelaLigacao = false;
      ctxBot.criado = null;
      if (relogioPreparo) window.clearInterval(relogioPreparo);
      relogioPreparo = 0;
      computador.descartar();
      teste.descartar();
    },
  };
}
