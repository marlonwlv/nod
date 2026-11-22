import type { BotaoDoDesvio, IdDesvio, PayloadDesvio } from "../contracts/desvio.ts";
import type { CausaSemIa } from "../contracts/inventario.ts";
import type { MotivoFalha, MotivoInterrupcao } from "../contracts/motivos.ts";
import { classificarErroFornecedor, horaMinuto, quandoDaFrase } from "./erro-fornecedor.ts";

/**
 * Lote B das Jornadas da IA ("Mandar uma mensagem", definido em 2026-11-22; Paper "Jornadas da IA · conectar e
 * conversar", momento B). A tabela ÚNICA dos desvios de uma mensagem a um bot: como cada um se reconhece, em que ordem o
 * nod tenta resolver sozinho, até quantas vezes, e o que a conversa mostra quando resolve (uma linha) ou quando para (um
 * cartão com o motivo e um botão que o nod executa). As regras do lote:
 *
 * 1. A mensagem nunca se perde: sem IA pronta, ela fica guardada e sai sozinha.
 * 2. Recuperar antes de parar, sempre na mesma ordem: mesma conta (só causa conhecida) → próxima conta do bot → outra IA
 *    ou outra máquina → cartão. No máximo TETO_TENTATIVAS_DA_MENSAGEM tentativas automáticas por mensagem, somadas.
 * 3. Conta com login vencido, sem acesso ou no limite sai da vez; a conversa segue na próxima, com uma linha.
 * 4. O limite usa a hora real; sem hora, "volta sem hora" — nunca a hora inventada.
 * 5. "Desta vez" não muda o bot: a troca automática é só entre as contas da lista do bot; fora dela, um botão.
 * 6. O envio olha as máquinas conectadas agora.
 * 7. Todo cartão: o motivo e um botão executável, sem termos internos, com a conta e a máquina certas.
 * 8. O erro desconhecido que se repete vai sozinho para o time, e o cartão avisa.
 *
 * Pura (sem banco, `agora` por parâmetro). Quem assenta o turno (assentar-turno.ts) reconhece o desvio aqui, pergunta a
 * decisão e executa; o envio (enviar-mensagem.ts) usa os desvios 6 e 7. Os testes (desvios-da-conversa.test.ts) travam a
 * tabela caminho por caminho.
 */

/** definido em 2026-11-22 (regra 2, decisão do dono): tentativas automáticas por mensagem, somadas entre os desvios. */
export const TETO_TENTATIVAS_DA_MENSAGEM = 3;

/** Onde a próxima tentativa roda. `mesma_conta` = de novo, igual (só para causa conhecida que passa sozinha). */
export type Passo = "mesma_conta" | "proxima_conta" | "outra_ia" | "outra_maquina";

export type Desvio = {
  numero: number;
  /** O nome do desvio no Paper (auditoria e testes; a pessoa lê a frase do cartão). */
  titulo: string;
  /** A ordem do que o nod tenta sozinho, antes do cartão. `outra_maquina` só com botão (regra 5): nunca automático. */
  recuperacao: readonly Passo[];
  /** Quantas vezes o MESMO desvio repete na mesma conta (além da ordem acima). */
  repeticoes: number;
  /** A espera entre as tentativas na mesma conta (ms), em ordem; a última se repete. */
  esperas?: readonly number[];
  /** Depois de tudo: a mensagem espera e sai sozinha (limite, máquina, login) ou para no cartão. */
  semSaida: "espera" | "cartao";
};

/** definido em 2026-11-22 (Paper, desvio 5): o instável tenta de novo em 30 s, 2 min e 10 min — a mesma escada do fundo. */
const ESCADA_DO_INSTAVEL = [30_000, 120_000, 600_000] as const;

export const DESVIOS: Readonly<Record<IdDesvio, Desvio>> = {
  sessao_sumiu: { numero: 1, titulo: "A sessão do bot sumiu", recuperacao: ["mesma_conta"], repeticoes: 1, semSaida: "cartao" },
  login_vencido: { numero: 2, titulo: "O login da conta venceu", recuperacao: ["proxima_conta", "outra_ia"], repeticoes: 0, semSaida: "espera" },
  limite_bot_fixo: { numero: 3, titulo: "Limite com o bot preso a uma IA", recuperacao: ["proxima_conta"], repeticoes: 0, semSaida: "espera" },
  limite: { numero: 4, titulo: "O limite volta na hora certa", recuperacao: ["proxima_conta", "outra_ia"], repeticoes: 0, semSaida: "espera" },
  instavel: { numero: 5, titulo: "O serviço da IA está instável", recuperacao: ["mesma_conta", "outra_ia"], repeticoes: 2, esperas: ESCADA_DO_INSTAVEL, semSaida: "cartao" },
  sem_ia_pronta: { numero: 6, titulo: "Nenhuma IA pronta", recuperacao: [], repeticoes: 0, semSaida: "espera" },
  computador_fora: { numero: 7, titulo: "O computador saiu do ar", recuperacao: [], repeticoes: 0, semSaida: "espera" },
  sem_acesso: { numero: 8, titulo: "Sem acesso e nenhuma outra IA", recuperacao: ["proxima_conta", "outra_ia"], repeticoes: 0, semSaida: "espera" },
  ia_nao_abriu: { numero: 9, titulo: "A IA não abriu no computador", recuperacao: [], repeticoes: 0, semSaida: "cartao" },
  erro_desconhecido: { numero: 10, titulo: "Um erro que o nod não conhece", recuperacao: ["mesma_conta"], repeticoes: 1, semSaida: "cartao" },
  nod_atualizou: { numero: 11, titulo: "O nod atualizou no meio", recuperacao: ["mesma_conta"], repeticoes: 1, semSaida: "cartao" },
  computador_dormiu: { numero: 12, titulo: "O computador dormiu no meio", recuperacao: [], repeticoes: 0, semSaida: "espera" },
};

/** O que se sabe do fim do turno (o desfecho do assentamento, o texto do fornecedor e a queda, se houve). */
export type FatosDoFim = {
  estado: "concluido" | "interrompido";
  motivoInterrupcao: MotivoInterrupcao | null;
  motivoFalha: MotivoFalha | null;
  erroCru: string | null | undefined;
  causaSemIa?: CausaSemIa | null;
  /** O turno caiu com a máquina ou com o servidor (o motivo da queda); null = não caiu. */
  queda?: MotivoInterrupcao | null;
  /** O bot roda numa IA só ("Uma IA só"). */
  botFixo?: boolean;
};

/** "No conversation found": o `--resume` de uma sessão que não está mais na máquina (o CLI fecha com `result` de erro). */
const SESSAO_SUMIU = /no conversation found/i;

/**
 * O desvio do turno, ou null quando não é um desvio do momento B (concluiu, a pessoa parou, foi absorvido, ou é uma falha
 * com frase própria que não se resolve trocando nada: contexto cheio, teto de gasto, fatura, região, conteúdo).
 */
export function reconhecerDesvio(f: FatosDoFim): IdDesvio | null {
  if (f.estado !== "interrompido") return null;
  const queda = f.queda ?? null;
  if (queda === "reinicio_servidor" || queda === "reinicio_do_motor") return "nod_atualizou";
  if (queda === "maquina_sem_contato") return "computador_dormiu";
  if (f.motivoInterrupcao === "parado_pela_pessoa" || f.motivoInterrupcao === "absorvido" || f.motivoInterrupcao === "vencido") return null;
  if (f.causaSemIa) return "sem_acesso";
  if (f.motivoInterrupcao === "sessao_rejeitada" || (f.erroCru && SESSAO_SUMIU.test(f.erroCru))) return "sessao_sumiu";
  if (f.motivoInterrupcao === "lancamento_falhou") return "ia_nao_abriu";
  if (f.motivoFalha === "limite_do_plano") return f.botFixo ? "limite_bot_fixo" : "limite";
  if (f.motivoInterrupcao === "executor_indisponivel") return "sem_ia_pronta";
  const classe = classificarErroFornecedor(f.erroCru);
  if (classe === "limite_de_uso") return f.botFixo ? "limite_bot_fixo" : "limite";
  if (classe === "login_expirado") return "login_vencido";
  if (classe === "transitorio") return "instavel";
  if (classe !== "desconhecido") return null;
  // Sem classe: o erro que o nod não conhece (inclusive o que chegou sem texto nenhum).
  return f.motivoFalha === "erro_execucao" || f.motivoInterrupcao === "sem_progresso" || f.motivoInterrupcao === "trabalho_incompleto" ? "erro_desconhecido" : null;
}

/** O que existe para tentar agora (quem chama sabe: a lista do bot, as IAs prontas, as máquinas vivas). */
export type ContextoDaTentativa = {
  /** Tentativas automáticas que esta mensagem já teve (`turnos.reenvios`). */
  tentativas: number;
  /** Quantas dessas foram por ESTE desvio na mesma conta. */
  repetidasPorEste: number;
  pararSolicitado: boolean;
  /** Há outra conta da lista do bot, da mesma IA, livre e pronta. */
  proximaConta: boolean;
  /** Há outra IA pronta (o bot no Automático); nunca com o bot preso a uma IA. */
  outraIa: boolean;
};

export type Decisao =
  | { tipo: "repetir"; onde: Passo; esperaMs: number }
  /** Sem saída automática: a mensagem espera (sai sozinha) ou o nod para no cartão. */
  | { tipo: "parar"; forma: "espera" | "cartao" };

/**
 * A próxima tentativa do desvio, pela ordem da tabela e pelos tetos (o da mensagem e o do desvio). `outra_maquina` nunca
 * sai daqui: é sempre o botão do cartão (regra 5).
 */
export function decidirRecuperacao(desvio: IdDesvio, c: ContextoDaTentativa): Decisao {
  const d = DESVIOS[desvio];
  const parar: Decisao = { tipo: "parar", forma: d.semSaida };
  if (c.pararSolicitado || c.tentativas >= TETO_TENTATIVAS_DA_MENSAGEM) return parar;
  for (const passo of d.recuperacao) {
    if (passo === "mesma_conta" && c.repetidasPorEste < d.repeticoes) {
      const esperas = d.esperas ?? [0];
      return { tipo: "repetir", onde: "mesma_conta", esperaMs: esperas[Math.min(c.repetidasPorEste, esperas.length - 1)] ?? 0 };
    }
    if (passo === "proxima_conta" && c.proximaConta) return { tipo: "repetir", onde: "proxima_conta", esperaMs: 0 };
    if (passo === "outra_ia" && c.outraIa && desvio !== "limite_bot_fixo") return { tipo: "repetir", onde: "outra_ia", esperaMs: 0 };
  }
  return parar;
}

/** Os nomes que a frase usa, já como a pessoa os lê ("Claude · Pessoal", "MacBook do escritório", "o Claude"). */
export type NomesDoDesvio = {
  bot: string;
  /** A conta do turno ("Claude · Pessoal"); null = a pessoa não tem lista de contas. */
  conta?: string | null;
  /** A conta que assumiu ("Claude · Trabalho"). */
  contaQueSeguiu?: string | null;
  /** A IA do turno ("Claude", "ChatGPT"). */
  ia: string;
  /** A outra IA pronta ("ChatGPT"). */
  outraIa?: string | null;
  /** A máquina do turno, pelo nome que a pessoa deu ("MacBook do escritório", "VM sp-01"). */
  maquina?: string | null;
  /** A máquina com IA pronta para o "desta vez" ({ id, nome }). */
  outraMaquina?: { id: string; nome: string } | null;
  /** A organização que tirou o acesso. */
  organizacao?: string | null;
};

const ponto = (s: string): string => (s.endsWith(".") ? s : `${s}.`);

/**
 * A linha discreta de quando o nod resolveu sozinho (B3 do Paper): o que aconteceu e com quem a conversa seguiu.
 * Sem termos internos; a máquina e a conta pelos nomes.
 */
export function linhaDaRecuperacao(desvio: IdDesvio, onde: Passo, n: NomesDoDesvio, o: { tentativa?: number; esperaMs?: number; agora: number; desde?: number | null }): PayloadDesvio {
  const seguiu = onde === "proxima_conta" && n.contaQueSeguiu ? ` Respondendo com a ${n.contaQueSeguiu}.` : onde === "outra_ia" && n.outraIa ? ` Respondendo pelo ${n.outraIa}.` : "";
  const textos: Record<IdDesvio, string> = {
    sessao_sumiu: `A sessão anterior não estava mais ${n.maquina ? noNa(n.maquina) : "na máquina"}. ${n.bot} recomeçou pelo histórico.`,
    login_vencido: `O login da ${n.conta ?? `conta ${doIa(n.ia)}`} venceu${n.maquina ? ` ${noNa(n.maquina)}` : ""}.${seguiu}`,
    limite_bot_fixo: `A ${n.conta ?? `conta ${doIa(n.ia)}`} chegou ao limite.${seguiu}`,
    limite: `A ${n.conta ?? `conta ${doIa(n.ia)}`} chegou ao limite.${seguiu}`,
    instavel: onde === "mesma_conta"
      ? `${oIa(n.ia, true)} está instável. Tentando de novo ${o.esperaMs ? `em ${duracao(o.esperaMs)}` : "agora"} (${(o.tentativa ?? 1)} de ${DESVIOS.instavel.repeticoes + 1}).`
      : `${oIa(n.ia, true)} continuou instável.${seguiu}`,
    sem_ia_pronta: "",
    computador_fora: "",
    sem_acesso: `A ${n.conta ?? `conta ${doIa(n.ia)}`} está sem acesso${n.organizacao ? ` (a ${n.organizacao} desligou o uso por assinatura)` : ""}.${seguiu}`,
    ia_nao_abriu: "",
    erro_desconhecido: `A ${n.conta ?? `conta ${doIa(n.ia)}`} parou com um erro. Tentando de novo uma vez.`,
    nod_atualizou: `O nod atualizou no meio da resposta. ${n.bot} retoma de onde parou.`,
    computador_dormiu: `${n.maquina ? oA(n.maquina) : "O computador do bot"} parou de responder${o.desde ? ` às ${horaMinuto(o.desde)}` : ""}. A resposta continua quando ${ehFeminina(n.maquina ?? "") ? "ela" : "ele"} voltar.`,
  };
  return { kind: "desvio", desvio, forma: "linha", titulo: "", texto: textos[desvio].trim(), botoes: [] };
}

function duracao(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

/**
 * O cartão de quando o nod parou: o motivo, o que acontece com a mensagem e os botões (Paper, coluna "Depois"). `ate` é a
 * hora em que a espera acaba sozinha (o limite volta), quando se sabe.
 */
export function cartaoDoDesvio(desvio: IdDesvio, n: NomesDoDesvio, o: { agora: number; ate?: number | null; turnoId?: string; turnoEsperandoId?: string | null; mensagemId?: string | null; contaId?: string | null; maquinaId?: string | null; ia?: string | null; outraIaId?: string | null; relatado?: boolean; erro?: string | null }): PayloadDesvio {
  const conta = n.conta ?? `conta ${doIa(n.ia)}`;
  const onde = n.maquina ? ` ${noNa(n.maquina)}` : "";
  const aMaquina = n.maquina ? oA(n.maquina) : "O computador do bot";
  // O Cancelar tira da fila a cópia que espera (não o turno que parou).
  // A mensagem da pessoa vai junto: a cópia que espera (acordar_em adiante) não está na fila da tela (ADR-086), e o Cancelar
  // precisa saber de qual fala ela é para mostrar "Cancelada" embaixo do balão.
  const cancelar: BotaoDoDesvio[] = o.turnoEsperandoId ? [{ acao: "cancelar", rotulo: "Cancelar", dados: { turnoId: o.turnoEsperandoId, ...(o.mensagemId ? { mensagemId: o.mensagemId } : {}) } }] : [];
  const verErro: BotaoDoDesvio[] = [{ acao: "ver_erro", rotulo: "Ver o erro" }];
  const erro = o.erro ? { erro: o.erro.slice(0, ERRO_NO_CARTAO_MAX) } : {};
  const outraMaquina: BotaoDoDesvio[] = n.outraMaquina && o.turnoId ? [{ acao: "rodar_em_outra_maquina", rotulo: `Rodar ${noNa(n.outraMaquina.nome)} desta vez`, dados: { turnoId: o.turnoId, maquinaId: n.outraMaquina.id, maquinaNome: n.outraMaquina.nome } }] : [];
  const outraIa: BotaoDoDesvio[] = n.outraIa && o.turnoId ? [{ acao: "responder_com_outra_ia", rotulo: `Responder com o ${n.outraIa} desta vez`, dados: { turnoId: o.turnoId, ...(o.outraIaId ? { ia: o.outraIaId } : {}) } }] : [];
  const quando = o.ate && o.ate > o.agora ? quandoDaFrase(o.ate, o.agora) : null;
  const c = (titulo: string, texto: string, botoes: BotaoDoDesvio[], extra: Partial<PayloadDesvio> = {}): PayloadDesvio => {
    // "Ver o erro" só com o texto do erro em mãos.
    const comErro = o.erro ? botoes : botoes.filter((b) => b.acao !== "ver_erro");
    return { kind: "desvio", desvio, forma: "cartao", titulo, texto: ponto(texto), botoes: comErro, tom: "parada", ...(comErro.some((b) => b.acao === "ver_erro") ? erro : {}), ...extra };
  };
  switch (desvio) {
    case "sessao_sumiu":
      return c(`${n.bot} não conseguiu recomeçar`, `A sessão anterior não estava mais${onde} e a nova tentativa também parou`, [...outraIa, ...outraMaquina, ...verErro]);
    case "login_vencido":
      return c(`O login da ${conta} venceu${onde}`, `Entre de novo e a mensagem sai em seguida`, [{ acao: "entrar_de_novo", rotulo: "Entrar de novo", dados: { ...(o.contaId ? { contaId: o.contaId } : {}), ...(o.maquinaId ? { maquinaId: o.maquinaId } : {}), ...(o.ia ? { ia: o.ia } : {}), ...(n.conta ? { apelido: n.conta.replace(/^.* · /, "") } : {}) } }, ...outraMaquina, ...cancelar], { espera: { ate: null } });
    case "limite_bot_fixo":
      return c(quando ? `Esperando ${oIa(n.ia)} voltar, ${quando.replace(/^às /, "")}` : `Esperando ${oIa(n.ia)} voltar · volta sem hora`, `${n.bot} só usa ${oIa(n.ia)}. A mensagem sai sozinha quando o limite passar`, [...outraIa, ...cancelar], { espera: { ate: o.ate ?? null }, tom: "espera" });
    case "limite":
      return c(quando ? `A ${conta} volta ${quando}` : `A ${conta} chegou ao limite · volta sem hora`, quando ? `A mensagem espera e sai sozinha ${quando}` : `${oIa(n.ia, true)} não disse quando o limite passa. O nod confere a cada hora e a mensagem sai sozinha quando ele voltar`, [...outraMaquina, ...cancelar], { espera: { ate: o.ate ?? null } });
    case "instavel":
      return c(`${oIa(n.ia, true)} continua instável`, n.outraIa ? `O nod tentou ${DESVIOS.instavel.repeticoes + 1} vezes. ${n.bot} só usa ${oIa(n.ia)}, mas o ${n.outraIa} está pronto para responder desta vez` : `O nod tentou ${DESVIOS.instavel.repeticoes + 1} vezes e não há outra IA pronta agora`, [...outraIa, ...outraMaquina, ...verErro]);
    case "sem_ia_pronta":
      return c(`Nenhuma IA conectada${onde}`, "A mensagem fica guardada e sai assim que uma conta entrar", [{ acao: "conectar_ia", rotulo: "Conectar uma IA" }, ...outraMaquina], { espera: { ate: null } });
    case "computador_fora":
      return c(`${aMaquina} está fora do ar`, `A mensagem sai quando ${ehFeminina(n.maquina ?? "") ? "ela" : "ele"} voltar${n.outraMaquina ? `. ${oA(n.outraMaquina.nome)} tem IA pronta agora` : ""}`, outraMaquina, { espera: { ate: null }, tom: "espera" });
    case "sem_acesso":
      return c(n.organizacao ? `A ${n.organizacao} desligou ${oIa(n.ia)} por assinatura` : `A ${conta} está sem acesso`, `Era a única conta de ${n.bot}. Conecte outra e a mensagem sai em seguida`, [{ acao: "conectar_ia", rotulo: "Conectar outra conta" }, ...outraIa], { espera: { ate: null } });
    case "ia_nao_abriu": {
      // Paper B-9 (auditoria de 2026-11-22: "faltou um botão"): o nod reinstala a cópia da IA naquela máquina e a mensagem
      // sai quando ela abrir; a outra máquina, quando houver, é a segunda saída.
      const reinstalar: BotaoDoDesvio[] = o.turnoId && o.maquinaId && (o.ia === "claude-cli" || o.ia === "codex-cli")
        ? [{ acao: "reinstalar_e_tentar", rotulo: "Reinstalar e tentar", dados: { turnoId: o.turnoId, maquinaId: o.maquinaId, ia: o.ia } }]
        : [];
      const texto = reinstalar.length
        ? (n.outraMaquina ? "O nod reinstala a cópia dele e tenta de novo. Se preferir, roda em outra máquina agora" : "O nod reinstala a cópia dele e tenta de novo")
        : (n.outraMaquina ? "Rode em outra máquina agora, ou reinicie o nod deste computador e mande de novo" : "Reinicie o nod deste computador e mande de novo");
      return c(`${oIa(n.ia, true)} não abriu${onde}`, texto, [...reinstalar, ...outraMaquina.map((b) => ({ ...b, rotulo: `Rodar ${noNa(n.outraMaquina!.nome)}` }))]);
    }
    case "erro_desconhecido":
      return c(`A ${conta} parou duas vezes com o mesmo erro`, `Já tentei de novo uma vez.${o.relatado ? " O relato foi para o time do nod com o erro anexado" : ""}`, [...outraIa, ...outraMaquina, ...verErro]);
    case "nod_atualizou":
      return c("O nod atualizou e não conseguiu retomar", "A resposta parou no meio. Peça de novo para continuar de onde parou", outraMaquina);
    case "computador_dormiu":
      return c(`${aMaquina} parou de responder`, `A resposta continua quando ${ehFeminina(n.maquina ?? "") ? "ela" : "ele"} voltar`, outraMaquina, { espera: { ate: null } });
  }
}

/** definido em 2026-11-22: o texto do erro que o cartão mostra em "Ver o erro" (o cru já vem redigido do driver). */
export const ERRO_NO_CARTAO_MAX = 400;

/** VM e máquina são femininas; o resto (MacBook, Mac, PC, computador, o nome que a pessoa deu) fica no masculino. */
const ehFeminina = (nome: string): boolean => /^(vm\b|máquina|maquina)/i.test(nome.trim());
/** "no MacBook do escritório" / "na VM sp-01". */
export const noNa = (nome: string): string => `${ehFeminina(nome) ? "na" : "no"} ${nome}`;
/** "O MacBook do escritório" / "A VM sp-01". */
export const oA = (nome: string): string => `${ehFeminina(nome) ? "A" : "O"} ${nome}`;
/** O nome quando o turno não diz qual IA respondeu (o Automático antes do plano): "sua IA", feminino. */
export const IA_SEM_NOME = "sua IA";
/** "o Claude" / "a sua IA" (com `maiuscula`, no começo da frase). */
export const oIa = (ia: string, maiuscula = false): string => {
  const artigo = ia === IA_SEM_NOME ? "a" : "o";
  return `${maiuscula ? artigo.toUpperCase() : artigo} ${ia}`;
};
/** "do Claude" / "da sua IA". */
export const doIa = (ia: string): string => `${ia === IA_SEM_NOME ? "da" : "do"} ${ia}`;
