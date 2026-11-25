import type {
  CasoProblemaDto,
  ContagemDto,
  EventoLinhaDto,
  FonteProblema,
  PainelPessoaDto,
  PainelUsoDto,
  PassoFunilDto,
  PessoaRefDto,
  ProblemaRankDto,
  ResumoPessoaDto,
  TempoAteDto,
} from "../contracts/backoffice.ts";

/**
 * Agregações do painel de uso do backoffice (definido em 2026-11-23, ADR-193; backoffice desde o ADR-194). Puro: recebe os fatos de cada pessoa (lidos um
 * por um, cada um na transação escopada da própria pessoa) e o relógio por parâmetro. Nada aqui lê texto de mensagem.
 */

const DIA_MS = 86_400_000;
const HORA_MS = 3_600_000;
export const JANELA_PADRAO_DIAS = 30;
export const JANELA_MAX_DIAS = 90;
/** Onboarding começado e não concluído depois de um dia conta como abandono. */
export const ABANDONO_ONBOARDING_MS = DIA_MS;
/** Três falhas da mesma rotina na janela viram o problema "falha repetida". */
export const FALHAS_REPETIDAS = 3;
const CASOS_POR_PROBLEMA = 20;
const EVENTOS_NA_LINHA = 300;

/** Um caso como o repositório lê: `em` em ms e um `grupo` interno (a rotina, para achar a falha repetida). */
export type CasoFato = Omit<CasoProblemaDto, "em"> & { em: number; grupo?: string };

export type FatosPessoa = {
  ref: PessoaRefDto;
  cadastroEm: number | null;
  ultimoUsoEm: number | null;
  onboardingEtapa: string | null;
  onboardingConcluidoEm: number | null;
  /** Dias (UTC, AAAA-MM-DD) em que a pessoa escreveu ao menos uma mensagem. */
  diasAtivos: string[];
  mensagens: number;
  turnos: number;
  rotinasAtivas: number;
  bots: { tipo: string; criadoEm: number }[];
  apps: { slug: string; criadoEm: number }[];
  primeiraTarefaEm: number | null;
  tarefas: { id: string; criadoEm: number; entregueEm: number | null }[];
  rotinas: { id: string; criadoEm: number }[];
  problemas: CasoFato[];
  travadas: number;
  macsSemContato: number;
};

/** A janela pedida, limitada a [1, 90]; valor inválido cai no padrão. */
export function janelaDias(bruto: string | null): number {
  const n = bruto === null ? NaN : Number(bruto);
  if (!Number.isInteger(n) || n < 1) return JANELA_PADRAO_DIAS;
  return Math.min(n, JANELA_MAX_DIAS);
}

const diaUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/** Os `n` dias que terminam hoje (UTC), do mais antigo ao mais novo. */
export function diasDaJanela(agora: number, n: number): string[] {
  const hoje = Date.parse(`${diaUtc(agora)}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => diaUtc(hoje - (n - 1 - i) * DIA_MS));
}

const ROTULO_FONTE: Record<FonteProblema, string> = {
  turno_falhou: "Pedido falhou",
  turno_interrompido: "Pedido interrompido",
  tarefa_cancelada: "Cancelado pela pessoa",
  ferramenta_negada: "Ferramenta negada",
  decisao_expirou: "Pedido de aprovação expirou",
  aprovacao_recusada: "Aprovação recusada",
  item_falhou: "Ação aprovada falhou",
  pedido_recusado: "Pedido recusado",
  conector_auth: "App sem autorização",
  conector_falha: "App com falha",
  rotina_falhou: "Rotina falhou",
  mac_sem_contato: "Mac sem contato",
  sem_resposta: "Sem resposta",
  resposta_lenta: "Resposta lenta",
  onboarding_abandonado: "Abandonou o onboarding",
  relato: "Problema relatado",
};

const ROTULO_MOTIVO: Record<string, string> = {
  erro_max_turns: "limite de passos",
  erro_execucao: "erro de execução",
  motor_ausente: "IA ausente",
  nao_autenticado: "IA sem login",
  limite_do_plano: "limite do plano",
  maquina_sem_contato: "Mac sem contato",
  reinicio_servidor: "servidor reiniciou",
  sem_progresso: "sem progresso",
  lancamento_falhou: "executor não abriu",
  sessao_rejeitada: "sessão rejeitada",
  executor_indisponivel: "servidor fora de alcance",
  turno_travado: "travou",
  trabalho_incompleto: "trabalho incompleto",
  capacidade_desligada: "capacidade desligada",
  teto_canal: "teto do canal",
  alcance_insuficiente: "alcance insuficiente",
  fora_do_catalogo: "fora do catálogo",
  plano_ausente: "sem plano",
  plano_expirado: "plano expirado",
  catalogo_vazio: "catálogo vazio",
  conector_indisponivel: "app indisponível",
  parada_ativa: "parada ativa",
  args_invalidos: "argumentos inválidos",
  falha_tecnica: "falha técnica",
  timeout_transporte: "tempo esgotado",
  acesso_recusado: "acesso recusado",
  falha_repetida: "falha repetida",
  retirado_pela_pessoa: "retirado pela pessoa",
  sensivel_nao_aprovado: "sensível não aprovado",
  resposta_errada: "resposta errada",
  nao_fez_o_pedido: "não fez o pedido",
  travou_ou_parou: "travou ou parou",
  lento: "lento",
  interface: "interface",
  outro: "outro",
};

export function rotuloProblema(fonte: FonteProblema, motivo: string): string {
  const base = ROTULO_FONTE[fonte];
  if (!motivo || motivo === "geral") return base;
  return `${base}: ${ROTULO_MOTIVO[motivo] ?? motivo.replaceAll("_", " ")}`;
}

/**
 * Os casos de uma pessoa na janela, com os sintéticos: o onboarding abandonado (começou, não concluiu e já passou um
 * dia do cadastro) e a falha repetida (≥3 falhas da mesma rotina, um caso na mais recente).
 */
export function casosDaPessoa(f: FatosPessoa, ini: number, agora: number): CasoFato[] {
  const casos = f.problemas.filter((c) => c.em >= ini && c.em <= agora);
  const porRotina = new Map<string, CasoFato[]>();
  for (const c of casos) {
    if (c.fonte !== "rotina_falhou" || !c.grupo) continue;
    porRotina.set(c.grupo, [...(porRotina.get(c.grupo) ?? []), c]);
  }
  for (const lista of porRotina.values()) {
    if (lista.length < FALHAS_REPETIDAS) continue;
    const ultima = lista.reduce((a, b) => (b.em > a.em ? b : a));
    casos.push({ ...ultima, motivo: "falha_repetida", grupo: undefined });
  }
  const desde = f.cadastroEm;
  if (f.onboardingEtapa !== null && f.onboardingConcluidoEm === null && desde !== null && agora - desde >= ABANDONO_ONBOARDING_MS && desde >= ini) {
    casos.push({ fonte: "onboarding_abandonado", motivo: f.onboardingEtapa, em: desde, conversaId: null, turnoId: null, tarefaId: null, alvo: null });
  }
  return casos;
}

const chaveDe = (c: { fonte: FonteProblema; motivo: string }): string => `${c.fonte}:${c.motivo}`;
const paraDto = (c: CasoFato): CasoProblemaDto => ({ fonte: c.fonte, motivo: c.motivo, em: new Date(c.em).toISOString(), conversaId: c.conversaId, turnoId: c.turnoId, tarefaId: c.tarefaId, alvo: c.alvo });

const primeiro = (xs: number[]): number | null => (xs.length === 0 ? null : Math.min(...xs));

function marcos(f: FatosPessoa): { bot: number | null; app: number | null; tarefa: number | null } {
  return { bot: primeiro(f.bots.map((b) => b.criadoEm)), app: primeiro(f.apps.map((a) => a.criadoEm)), tarefa: f.primeiraTarefaEm };
}

function quantil(ordenados: number[], q: number): number | null {
  if (ordenados.length === 0) return null;
  const i = Math.min(ordenados.length - 1, Math.max(0, Math.ceil(q * ordenados.length) - 1));
  return Math.round((ordenados[i] ?? 0) * 10) / 10;
}

function contar(nomes: string[]): ContagemDto[] {
  const m = new Map<string, number>();
  for (const n of nomes) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m.entries()].map(([nome, total]) => ({ nome, total })).sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
}

const media = (xs: number[]): number => (xs.length === 0 ? 0 : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10);

export function resumoDaPessoa(f: FatosPessoa, casos: number): ResumoPessoaDto {
  return {
    ...f.ref,
    cadastroEm: iso(f.cadastroEm),
    ultimoUsoEm: iso(f.ultimoUsoEm),
    mensagens: f.mensagens,
    turnos: f.turnos,
    tarefas: f.tarefas.length,
    rotinasAtivas: f.rotinasAtivas,
    bots: f.bots.length,
    apps: f.apps.length,
    problemas: casos,
    travadas: f.travadas,
    macsSemContato: f.macsSemContato,
  };
}

export function montarPainel(fatos: FatosPessoa[], agora: number, nDias: number): PainelUsoDto {
  const dias = diasDaJanela(agora, nDias);
  const ini = Date.parse(`${dias[0] ?? diaUtc(agora)}T00:00:00Z`);
  const idx = new Map(dias.map((d, i) => [d, i]));
  const cadastrosPorDia = dias.map(() => 0);
  const ativosPorDia = dias.map(() => 0);
  const semana = new Set(dias.slice(-7));
  const mes = new Set(dias.slice(-30));
  let ativosSemana = 0;
  let ativosMes = 0;
  const coorte: FatosPessoa[] = [];
  const tempos = { bot: [] as number[], app: [] as number[], tarefa: [] as number[] };
  const funil = { onboarding: 0, bot: 0, app: 0, tarefa: 0 };
  let retCoorte = 0;
  let retVoltaram = 0;
  const casosPorChave = new Map<string, { casos: (CasoFato & { pessoa: PessoaRefDto })[]; pessoas: Set<string> }>();
  const resumos: ResumoPessoaDto[] = [];
  const ativos: FatosPessoa[] = [];

  for (const f of fatos) {
    const ativosDaPessoa = new Set(f.diasAtivos);
    for (const d of ativosDaPessoa) {
      const i = idx.get(d);
      if (i !== undefined) ativosPorDia[i] = (ativosPorDia[i] ?? 0) + 1;
    }
    if ([...ativosDaPessoa].some((d) => semana.has(d))) ativosSemana++;
    if ([...ativosDaPessoa].some((d) => mes.has(d))) ativosMes++;
    if (f.diasAtivos.some((d) => idx.has(d))) ativos.push(f);

    const m = marcos(f);
    if (f.cadastroEm !== null && f.cadastroEm >= ini) {
      const i = idx.get(diaUtc(f.cadastroEm));
      if (i !== undefined) cadastrosPorDia[i] = (cadastrosPorDia[i] ?? 0) + 1;
      coorte.push(f);
      if (f.onboardingConcluidoEm !== null) funil.onboarding++;
      if (m.bot !== null) funil.bot++;
      if (m.app !== null) funil.app++;
      if (m.tarefa !== null) funil.tarefa++;
      const c = f.cadastroEm;
      if (m.bot !== null) tempos.bot.push(Math.max(0, m.bot - c) / HORA_MS);
      if (m.app !== null) tempos.app.push(Math.max(0, m.app - c) / HORA_MS);
      if (m.tarefa !== null) tempos.tarefa.push(Math.max(0, m.tarefa - c) / HORA_MS);
      // Retenção: só quem já teve a semana seguinte inteira dentro do relógio.
      if (c + 2 * 7 * DIA_MS <= agora + DIA_MS) {
        retCoorte++;
        const de = diaUtc(c + 7 * DIA_MS);
        const ate = diaUtc(c + 14 * DIA_MS);
        if (f.diasAtivos.some((d) => d >= de && d < ate)) retVoltaram++;
      }
    }

    const casos = casosDaPessoa(f, ini, agora);
    for (const c of casos) {
      const k = chaveDe(c);
      const g = casosPorChave.get(k) ?? { casos: [], pessoas: new Set<string>() };
      g.casos.push({ ...c, pessoa: f.ref });
      g.pessoas.add(`${f.ref.tenantId}/${f.ref.pessoaId}`);
      casosPorChave.set(k, g);
    }
    resumos.push(resumoDaPessoa(f, casos.length));
  }

  const ordenar = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
  const tempo = (passo: TempoAteDto["passo"], rotulo: string, xs: number[]): TempoAteDto => {
    const o = ordenar(xs);
    return { passo, rotulo, pessoas: o.length, medianaHoras: quantil(o, 0.5), p90Horas: quantil(o, 0.9) };
  };
  const passosFunil: PassoFunilDto[] = [
    { passo: "cadastro", rotulo: "Cadastro", pessoas: coorte.length },
    { passo: "onboarding", rotulo: "Concluiu o onboarding", pessoas: funil.onboarding },
    { passo: "primeiro_bot", rotulo: "Criou um bot", pessoas: funil.bot },
    { passo: "primeiro_app", rotulo: "Conectou um app", pessoas: funil.app },
    { passo: "primeira_tarefa", rotulo: "Concluiu uma tarefa", pessoas: funil.tarefa },
  ];

  const problemas: ProblemaRankDto[] = [...casosPorChave.entries()]
    .map(([chave, g]) => {
      const primeiroCaso = g.casos[0];
      const fonte = primeiroCaso?.fonte ?? "relato";
      const motivo = primeiroCaso?.motivo ?? "";
      const tendencia = dias.map(() => 0);
      for (const c of g.casos) {
        const i = idx.get(diaUtc(c.em));
        if (i !== undefined) tendencia[i] = (tendencia[i] ?? 0) + 1;
      }
      const casos = [...g.casos].sort((a, b) => b.em - a.em).slice(0, CASOS_POR_PROBLEMA).map((c) => ({ ...paraDto(c), pessoa: c.pessoa }));
      return { chave, fonte, motivo, rotulo: rotuloProblema(fonte, motivo), ocorrencias: g.casos.length, pessoasAfetadas: g.pessoas.size, tendencia, casos };
    })
    .sort((a, b) => b.ocorrencias - a.ocorrencias || b.pessoasAfetadas - a.pessoasAfetadas || a.chave.localeCompare(b.chave));

  return {
    geradoEm: new Date(agora).toISOString(),
    dias,
    crescimento: { totalPessoas: fatos.length, cadastrosPorDia, ativosPorDia, ativosSemana, ativosMes },
    ativacao: {
      funil: passosFunil,
      tempos: [tempo("primeiro_bot", "Até criar o primeiro bot", tempos.bot), tempo("primeiro_app", "Até conectar o primeiro app", tempos.app), tempo("primeira_tarefa", "Até concluir a primeira tarefa", tempos.tarefa)],
    },
    engajamento: {
      mensagensPorPessoa: media(ativos.map((f) => f.mensagens)),
      turnosPorPessoa: media(ativos.map((f) => f.turnos)),
      tarefasPorPessoa: media(ativos.map((f) => f.tarefas.filter((t) => t.criadoEm >= ini).length)),
      rotinasAtivasPorPessoa: media(ativos.map((f) => f.rotinasAtivas)),
      tiposDeBot: contar(fatos.flatMap((f) => f.bots.map((b) => b.tipo))),
      conectores: contar(fatos.flatMap((f) => f.apps.map((a) => a.slug))),
      retencao: { coorte: retCoorte, voltaram: retVoltaram },
    },
    saude: {
      travadas: fatos.reduce((s, f) => s + f.travadas, 0),
      macsSemContato: fatos.reduce((s, f) => s + f.macsSemContato, 0),
      pessoasComProblema: resumos.filter((r) => r.problemas > 0).length,
    },
    problemas,
    pessoas: resumos.sort((a, b) => b.problemas - a.problemas || (b.ultimoUsoEm ?? "").localeCompare(a.ultimoUsoEm ?? "")),
  };
}

const evento = (tipo: EventoLinhaDto["tipo"], em: number, rotulo: string, ids: Partial<Pick<EventoLinhaDto, "conversaId" | "turnoId" | "tarefaId">> = {}): EventoLinhaDto => ({
  tipo,
  em: new Date(em).toISOString(),
  rotulo,
  conversaId: ids.conversaId ?? null,
  turnoId: ids.turnoId ?? null,
  tarefaId: ids.tarefaId ?? null,
  problema: null,
});

/** A tela de uma pessoa: o resumo, os problemas dela e a linha do tempo (do mais novo ao mais antigo). */
export function montarPainelPessoa(f: FatosPessoa, agora: number, nDias: number): PainelPessoaDto {
  const dias = diasDaJanela(agora, nDias);
  const ini = Date.parse(`${dias[0] ?? diaUtc(agora)}T00:00:00Z`);
  const casos = casosDaPessoa(f, ini, agora);
  const linha: EventoLinhaDto[] = [];
  if (f.cadastroEm !== null) linha.push(evento("cadastro", f.cadastroEm, "Cadastro"));
  if (f.onboardingConcluidoEm !== null) linha.push(evento("onboarding_concluido", f.onboardingConcluidoEm, "Concluiu o onboarding"));
  for (const b of f.bots) linha.push(evento("bot_criado", b.criadoEm, `Criou um bot (${b.tipo})`));
  for (const a of f.apps) linha.push(evento("app_conectado", a.criadoEm, `Conectou ${a.slug}`));
  for (const t of f.tarefas) {
    linha.push(evento("tarefa_criada", t.criadoEm, "Criou uma tarefa", { tarefaId: t.id }));
    if (t.entregueEm !== null) linha.push(evento("tarefa_entregue", t.entregueEm, "Tarefa entregue", { tarefaId: t.id }));
  }
  for (const r of f.rotinas) linha.push(evento("rotina_criada", r.criadoEm, "Criou uma rotina"));
  for (const c of casos) {
    const rotulo = rotuloProblema(c.fonte, c.motivo) + (c.alvo ? ` (${c.alvo})` : "");
    linha.push({ ...evento("problema", c.em, rotulo, c), problema: { chave: chaveDe(c), fonte: c.fonte, motivo: c.motivo } });
  }
  linha.sort((a, b) => b.em.localeCompare(a.em));

  const porChave = new Map<string, { rotulo: string; ocorrencias: number }>();
  for (const c of casos) {
    const k = chaveDe(c);
    const atual = porChave.get(k);
    porChave.set(k, { rotulo: rotuloProblema(c.fonte, c.motivo), ocorrencias: (atual?.ocorrencias ?? 0) + 1 });
  }
  return {
    pessoa: resumoDaPessoa(f, casos.length),
    onboarding: { etapa: f.onboardingEtapa, concluidoEm: iso(f.onboardingConcluidoEm) },
    diasAtivos: [...new Set(f.diasAtivos)].sort(),
    problemas: [...porChave.entries()].map(([chave, v]) => ({ chave, ...v })).sort((a, b) => b.ocorrencias - a.ocorrencias),
    linhaDoTempo: linha.slice(0, EVENTOS_NA_LINHA),
  };
}
