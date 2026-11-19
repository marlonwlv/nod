import type { EventoStream } from "../contracts/turno.ts";

/**
 * Mensagem da pessoa no meio de um turno (definido em 2026-10-07, ADR-083 §6, emenda da ADR-067). Comum a todos os
 * drivers: o laço põe a moldura antes de entregar ao adapter, e cada driver usa o rastreador para achar a resposta.
 *
 * Medido no diário (7 dias até 07/10): 38 mensagens absorvidas no meio de um turno; a resposta curta que o modelo
 * escrevia antes da ferramenta seguinte era descartada como narração (NARRACAO_MAX_CHARS) e a pessoa não via nada.
 */
export function molduraMensagemNoMeio(texto: string): string {
  return `A pessoa escreveu enquanto você trabalhava: «${texto}». Responda a ela primeiro, em poucas frases, e depois continue o trabalho.`;
}

/**
 * NOD-376: a fala que a pessoa escreve na tela de uma frente (ou task). Antes ela ia crua, como o recado do bot
 * (`mensagensSemMoldura`), e o bot a tratava como ruído: respondia só no fim, colado ao resumo. A moldura vai na própria
 * entrada do turno do recado, então vale nos dois caminhos — absorvida no meio do turno vivo (o laço não embrulha de
 * novo, o id segue em `mensagensSemMoldura`) e na frente parada ou terminada, que a fala reabre como turno próprio.
 * O recado que o bot repassa (`mandar_para_frente`) não passa por aqui.
 */
export const INICIO_FALA_NA_FRENTE = "[nod] A pessoa escreveu nesta frente: «";
const FRENTE_JA_ACABOU = "O trabalho desta frente já tinha acabado e o resumo dela já está guardado: não o refaça, não o retome nem devolva outro resumo.";
export function molduraFalaNaFrente(texto: string, o: { frenteAcabou?: boolean } = {}): string {
  // As aspas de fora («») no texto dela viram as de dentro (‹›): a fala não fecha a citação nem imita a moldura.
  const fala = texto.replaceAll("«", "‹").replaceAll("»", "›");
  // Revisão do PR #539 (A1): a frente que já tinha acabado só responde — não refaz nem retoma o trabalho sem ela pedir.
  const depois = o.frenteAcabou ? FRENTE_JA_ACABOU : "Depois continue o trabalho de onde parou.";
  return `${INICIO_FALA_NA_FRENTE}${fala}». Responda a ela primeiro, aqui na frente, em poucas frases. ${depois} A resposta fica nesta frente: não mude o pedido original, a não ser que ela peça.`;
}

/**
 * Os eventos em que o modelo passa a ler o que foi escrito na sessão (revisto em 2026-10-08, revisão do épico #188). O
 * padrão é o do CLI em stream-json: a mensagem entra na conversa no limite da ferramenta (depois do `tool_result`) ou no
 * fim da volta (`result`). Um driver cujo motor lê a mensagem em outro ponto passa as suas fronteiras.
 */
export const FRONTEIRAS_PADRAO: readonly EventoStream["tipo"][] = ["tool_result", "result"];

/**
 * O primeiro bloco de texto que o modelo escreve DEPOIS DE LER uma mensagem absorvida é a resposta a ela: sempre fala
 * gravada, de qualquer tamanho. `falados` = os blocos que o driver já mandou como fala intermediária (saem da fala final,
 * senão a pessoa leria duas vezes); `obrigatorios` = os que não puderam sair na hora (sem sink de fala) e entram na fala
 * final mesmo curtos. Os dois conjuntos guardam o próprio objeto do evento, que é o mesmo nas fatias de cada rodada.
 *
 * revisto em 2026-10-08 (revisão do épico #188, X1): escrever na sessão não é o modelo ler. O CLI só lê a mensagem na
 * fronteira seguinte; a narração que já estava saindo ("Vou revisar as três tasks.") é de antes dela. Por isso
 * `absorveu()` deixa a marca PENDENTE e quem a arma é a próxima fronteira; `armar()` é para quando o driver sabe que o
 * modelo já está com o texto (abriu uma volta com ele, ou a sessão estava parada esperando).
 */
export type FalaDoMeio = {
  /** O texto entrou na sessão, mas o modelo pode estar no meio de uma fala de antes: arma na próxima fronteira. */
  absorveu(): void;
  /** O modelo já está com o texto (uma volta nova começou com ele): a próxima fala é a resposta. */
  armar(): void;
  /**
   * Chamado com cada evento, na ordem. Devolve o texto quando este é a resposta à mensagem do meio (uma vez por
   * absorção; duas mensagens antes de qualquer texto têm uma resposta só). `falouNaHora` diz se o driver vai mandá-la
   * como fala intermediária agora.
   */
  avaliar(ev: EventoStream, falouNaHora: boolean): string | null;
  readonly falados: ReadonlySet<EventoStream>;
  /** Fala por bloco (2026-11-12): o bloco que o driver já gravou como fala própria sai da fala final, como os daqui. */
  marcarFalado(ev: EventoStream): void;
  readonly obrigatorios: ReadonlySet<EventoStream>;
};

export function criarFalaDoMeio(fronteiras: readonly EventoStream["tipo"][] = FRONTEIRAS_PADRAO): FalaDoMeio {
  let estado: "nada" | "pendente" | "armado" = "nada";
  const falados = new Set<EventoStream>();
  const obrigatorios = new Set<EventoStream>();
  return {
    absorveu() {
      if (estado === "nada") estado = "pendente";
    },
    armar() {
      estado = "armado";
    },
    avaliar(ev, falouNaHora) {
      if (estado === "armado" && ev.tipo === "texto_bloco" && ev.texto.trim() !== "") {
        estado = "nada";
        (falouNaHora ? falados : obrigatorios).add(ev);
        return ev.texto;
      }
      // A fronteira arma DEPOIS de avaliar: o bloco que a fecha (o texto do item, no Codex) ainda é de antes.
      if (estado === "pendente" && fronteiras.includes(ev.tipo)) estado = "armado";
      return null;
    },
    marcarFalado(ev) {
      falados.add(ev);
    },
    falados,
    obrigatorios,
  };
}

/**
 * ADR-186 (definido em 2026-11-16): o que fazer com a mensagem da pessoa que chega no meio de um turno — UMA regra do nod,
 * igual para todo harness. O harness só diz o que sabe fazer (`CapacidadesHarness`, medido pela sonda
 * scripts/sonda-mensagem-no-meio.ts); o estado do bot sai dos eventos normalizados que todo driver já emite.
 *
 * - `escrevendo` (texto ou pensamento, sem ferramenta aberta nem trabalho em segundo plano): nada fica pela metade se a
 *   volta parar. Com `interrompeVolta`, a volta é interrompida e a mensagem abre a seguinte, na mesma sessão — o bot não
 *   termina um texto que a pessoa já mudou. Sem a capacidade, ela espera a fronteira (ADR-185).
 * - `acao_aberta` / `segundo_plano`: espera a fronteira — interromper deixaria um arquivo meio gravado ou um comando sem
 *   resultado.
 * - `entre_voltas`: a mensagem já abre a próxima volta; nada a interromper.
 * Uma interrupção por volta: a segunda mensagem da mesma rajada só entra na volta já interrompida.
 */
export type EstadoDaVolta = "entre_voltas" | "escrevendo" | "acao_aberta" | "segundo_plano";

export type RastreadorDaVolta = {
  evento(ev: EventoStream): void;
  estado(): EstadoDaVolta;
  /** O texto que o modelo já escreveu nesta volta (os `delta`), para o trecho da parcial. */
  textoDaVolta(): string;
};

export function criarRastreadorDaVolta(): RastreadorDaVolta {
  const abertas = new Set<string>();
  const emFundo = new Set<string>();
  let entre = true;
  let texto = "";
  return {
    evento(ev) {
      switch (ev.tipo) {
        case "init":
        case "fase":
          entre = false;
          break;
        case "delta":
          entre = false;
          texto += ev.texto;
          break;
        case "texto_bloco":
          entre = false;
          break;
        case "tool_use":
          entre = false;
          abertas.add(ev.id);
          break;
        case "tool_result":
          abertas.delete(ev.toolUseId);
          break;
        case "tarefa_fundo":
          if (ev.estado === "terminada") emFundo.delete(ev.id);
          else if (ev.emFundo !== false) emFundo.add(ev.id);
          break;
        case "result":
          entre = true;
          texto = "";
          abertas.clear();
          break;
        default:
          break;
      }
    },
    estado() {
      if (emFundo.size > 0) return "segundo_plano";
      if (abertas.size > 0) return "acao_aberta";
      return entre ? "entre_voltas" : "escrevendo";
    },
    textoDaVolta: () => texto,
  };
}

/** O que a regra precisa saber do harness (o pedaço de `CapacidadesHarness` que ela lê). */
export type CapacidadesNoMeio = { interrompeVolta: boolean; parcialNoHistorico: boolean };

export type DecisaoNoMeio = { tipo: "entregar" } | { tipo: "interromper_e_entregar"; trechoDaParcial: string | null };

/**
 * Quanto da parcial vai na moldura quando o harness não a guarda no histórico: o começo (o assunto) e o FIM (onde parou —
 * para continuar dali, revisão de 2026-11-16, pergunta à parte).
 */
export const TRECHO_DA_PARCIAL_MAX = 600;
const COMECO_DO_TRECHO = 220;

export function decidirMensagemNoMeio(o: { estado: EstadoDaVolta; textoDaVolta: string; jaInterrompeu: boolean; daConversa: boolean; capacidades: CapacidadesNoMeio }): DecisaoNoMeio {
  if (!o.daConversa || !o.capacidades.interrompeVolta || o.jaInterrompeu || o.estado !== "escrevendo") return { tipo: "entregar" };
  const parcial = o.textoDaVolta.trim();
  const trecho = o.capacidades.parcialNoHistorico || parcial === "" ? null : parcial.length > TRECHO_DA_PARCIAL_MAX ? `${parcial.slice(0, COMECO_DO_TRECHO)} […] ${parcial.slice(-(TRECHO_DA_PARCIAL_MAX - COMECO_DO_TRECHO))}` : parcial;
  return { tipo: "interromper_e_entregar", trechoDaParcial: trecho };
}

/**
 * A marca que o modelo põe no começo da resposta quando RETOMA o que estava fazendo (pergunta à parte, acréscimo). O
 * servidor a tira do texto e marca a fala pausada como retomada: ela não é recolhida e diz "Pausado para te responder".
 */
export const MARCA_DE_RETOMADA = "[[continua]]";

/** Tira a marca de retomada do texto (onde ela estiver — o modelo às vezes a põe depois de uma linha) e diz se havia. */
export function extrairMarcaDeRetomada(texto: string): { texto: string; retomou: boolean } {
  const re = /\[\[continua\]\][ \t]*\n?/gi;
  if (!re.test(texto)) return { texto, retomou: false };
  return { texto: texto.replace(re, "").replace(/^\s+/, ""), retomou: true };
}

/**
 * A moldura da mensagem que pausou a volta (revista em 2026-11-16 depois da validação: a pergunta à parte "quanto é 2+2?"
 * fazia o bot largar a pesquisa). Quem sabe se a mensagem corrige o pedido, acrescenta a ele ou é um assunto à parte é o
 * modelo, que entende a frase — o nod não adivinha. Com o trecho (o harness não guarda a parcial no histórico — o Codex,
 * medido em 2026-11-16), o modelo sabe o que já tinha escrito e onde parou.
 */
export function molduraDaInterrupcao(texto: string, trechoDaParcial: string | null): string {
  const antes = trechoDaParcial
    ? `Sua resposta foi pausada porque a pessoa mandou uma mensagem nova; ela viu o que você escreveu até aqui: «${trechoDaParcial.replaceAll("«", "‹").replaceAll("»", "›")}». `
    : "Sua resposta foi pausada porque a pessoa mandou uma mensagem nova; ela viu o que você escreveu até aqui. ";
  return `${antes}A mensagem dela: «${texto}». Decida pelo que ela quis: se ela mudou ou corrigiu o pedido, siga o pedido novo e não continue o anterior. Se é uma pergunta ou um assunto à parte, responda curto e depois continue a resposta anterior exatamente de onde parou, sem repetir o que já escreveu. Se ela acrescentou algo ao pedido, continue de onde parou e inclua o acréscimo. Sempre que for continuar a resposta anterior, comece a sua resposta com ${MARCA_DE_RETOMADA} (o nod tira essa marca; a pessoa não a vê).`;
}
