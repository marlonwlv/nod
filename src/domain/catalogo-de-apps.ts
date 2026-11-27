import { ESSENCIAIS_POR_APP, GENERICAS_SEM_MAPA, MINIMO_SOB_DEMANDA, ORCAMENTO_CHARS_POR_APP, RESULTADOS_DA_BUSCA, TETO_DIRETAS_POR_APP, type ConfigAppsSobDemanda } from "../contracts/catalogo-de-apps.ts";
import type { Conector } from "../contracts/conector.ts";
import type { JsonSchema } from "../contracts/json-schema.ts";
import type { FerramentaPlano, PlanoTurno } from "../contracts/plano-turno.ts";
import { COMANDO_GITHUB_NATIVO, SLUG_GITHUB } from "../contracts/github.ts";
import { SLUG_MAC } from "../contracts/mac.ts";
import { separarChave } from "./contas-do-app.ts";
import { errosDoSchema } from "./schema-args.ts";

/**
 * XUM-11 (catálogo de apps sob demanda): o domínio puro de quais capacidades de app vão DIRETAS ao modelo e de como
 * `apps_buscar` acha as outras. Quem decide se uma chamada roda continua sendo o portão de chamar-ferramenta.ts: aqui só
 * muda o que o modelo vê em cada turno, nunca o que a pessoa concedeu.
 */

/** A capacidade sem o prefixo `${slug}__`. */
export const capacidadeDe = (f: Pick<FerramentaPlano, "nome">): string => f.nome.slice(f.nome.indexOf("__") + 2);

/** O app de um conector, para o mapa de essenciais (a conta "gmail--pessoal" é o app gmail). */
export const appDoConector = (slug: string): string => separarChave(slug)?.app ?? slug;

/**
 * O GitHub nativo (gh da máquina, ADR-048) e o Mac (ADR-173) ficam sempre diretos: as ferramentas deles podem rodar NA
 * máquina (`execucao: "maquina"`, marcada depois de montarPlano) e o proxy só executa a local pelo nome da própria
 * ferramenta, não por apps_usar.
 */
export function sempreDireto(c: Pick<Conector, "slug" | "comando">): boolean {
  return (c.slug === SLUG_GITHUB && c.comando === COMANDO_GITHUB_NATIVO) || appDoConector(c.slug) === SLUG_MAC;
}

const LEITURA_GENERICA = /(^|_)(LIST|GET|SEARCH|FETCH|FIND|QUERY|READ)(_|$)/;

/** O tamanho da definição que o proxy lista (name, description, inputSchema), o mesmo que o Raio-X mede. */
export const charsDaDefinicao = (f: Pick<FerramentaPlano, "nome" | "schema">): number => JSON.stringify({ name: f.nome, description: f.schema.description ?? "", inputSchema: f.schema }).length;

/**
 * As diretas de um app, em ordem de prioridade: as da rotina do turno (todas, mesmo acima do teto e do orçamento: a
 * execução depende delas), as usadas nos últimos 30 dias (das mais usadas), as essenciais do mapa e, sem mapa, as de
 * leitura mais genéricas pelo nome. Cada uma entra se cabe no teto de quantidade E no orçamento de caracteres do app
 * (a que não cabe é pulada e a seguinte, menor, ainda pode entrar). Só existe o que está em `caps` (concedido e montado).
 */
export function escolherDiretas(entrada: { app: string; caps: readonly FerramentaPlano[]; rotina: readonly string[]; usadas: readonly string[]; teto: number; orcamentoChars?: number }): Set<string> {
  const porCap = new Map(entrada.caps.map((f) => [capacidadeDe(f), f] as const));
  const orcamento = entrada.orcamentoChars ?? ORCAMENTO_CHARS_POR_APP;
  const escolhidas = new Set<string>();
  let chars = 0;
  const pegar = (c: string) => { const f = porCap.get(c); if (f && !escolhidas.has(c)) { escolhidas.add(c); chars += charsDaDefinicao(f); } };
  for (const c of entrada.rotina) pegar(c);
  const encher = (lista: Iterable<string>, limite: number) => {
    for (const c of lista) {
      if (escolhidas.size >= limite) return;
      const f = porCap.get(c);
      if (f && !escolhidas.has(c) && chars + charsDaDefinicao(f) <= orcamento) pegar(c);
    }
  };
  encher(entrada.usadas, entrada.teto);
  const essenciais = ESSENCIAIS_POR_APP[entrada.app];
  if (essenciais) encher(essenciais, entrada.teto);
  else {
    const genericas = entrada.caps.filter((f) => f.readOnlyHint && LEITURA_GENERICA.test(capacidadeDe(f))).map(capacidadeDe).sort((a, b) => a.length - b.length || a.localeCompare(b));
    encher(genericas, Math.max(escolhidas.size, Math.min(entrada.teto, escolhidas.size + GENERICAS_SEM_MAPA)));
  }
  return escolhidas;
}

/**
 * Separa as ferramentas de conector JÁ montadas (concedidas, depois dos filtros de profundidade e do Mac) em diretas e
 * sob demanda. App com poucas sobrando (menos de MINIMO_SOB_DEMANDA) vai inteiro: a busca custaria mais que economiza.
 */
export function separarDiretas(ferramentas: readonly FerramentaPlano[], conectores: readonly Pick<Conector, "id" | "slug" | "comando">[], config: ConfigAppsSobDemanda): { diretas: FerramentaPlano[]; sobDemanda: FerramentaPlano[] } {
  const porConector = new Map<string, FerramentaPlano[]>();
  for (const f of ferramentas) if (f.origem === "conector" && f.conectorId) porConector.set(f.conectorId, [...(porConector.get(f.conectorId) ?? []), f]);
  const fora = new Set<FerramentaPlano>();
  for (const [conectorId, caps] of porConector) {
    const c = conectores.find((k) => k.id === conectorId);
    if (!c || sempreDireto(c) || caps.length - config.teto < MINIMO_SOB_DEMANDA) continue;
    const rotina = config.rotina.filter((r) => r.conector === c.slug).flatMap((r) => r.capacidades);
    const diretas = escolherDiretas({ app: appDoConector(c.slug), caps, rotina, usadas: config.usadas[conectorId] ?? [], teto: config.teto, ...(config.orcamentoChars ? { orcamentoChars: config.orcamentoChars } : {}) });
    for (const f of caps) if (!diretas.has(capacidadeDe(f))) fora.add(f);
  }
  if (fora.size < MINIMO_SOB_DEMANDA) return { diretas: [...ferramentas], sobDemanda: [] };
  return { diretas: ferramentas.filter((f) => !fora.has(f)), sobDemanda: ferramentas.filter((f) => fora.has(f)) };
}

/** As ferramentas de app que o plano conhece: as diretas e as sob demanda (o portão confere contra as duas). */
export function ferramentasDeAppDoPlano(plano: Pick<PlanoTurno, "catalogo">): readonly FerramentaPlano[] {
  return plano.catalogo.sobDemanda?.length ? [...plano.catalogo.ferramentas, ...plano.catalogo.sobDemanda] : plano.catalogo.ferramentas;
}

// --- busca ----------------------------------------------------------------------------------------------------------

/**
 * Palavras de pedido em português → as do catálogo (o Composio e os MCPs descrevem em inglês). O modelo também escreve
 * em inglês, e a busca casa as duas. Lista curta e de propósito: o que não estiver aqui ainda casa pela própria palavra.
 */
const SINONIMOS: Readonly<Record<string, readonly string[]>> = {
  email: ["mail", "message", "email"], mail: ["mail", "message", "email"], mensagem: ["message", "chat", "post"], mensagens: ["message", "chat", "post"], correio: ["mail"],
  pasta: ["folder", "directory"], pastas: ["folder", "directory"], caixa: ["inbox", "folder", "mailbox"], entrada: ["inbox"],
  mover: ["move"], move: ["move"], copiar: ["copy"], enviar: ["send", "post"], mandar: ["send", "post"], responder: ["reply"], resposta: ["reply", "response"], encaminhar: ["forward"],
  rascunho: ["draft"], apagar: ["delete", "remove", "trash"], excluir: ["delete", "remove", "trash"], deletar: ["delete", "remove"], remover: ["remove", "delete"], lixeira: ["trash"],
  arquivar: ["archive", "move"], buscar: ["search", "find", "query"], procurar: ["search", "find", "query"], pesquisar: ["search", "query"], achar: ["find", "search"], encontrar: ["find", "search"],
  listar: ["list"], lista: ["list"], ler: ["get", "read", "fetch"], abrir: ["get", "open"], ver: ["get", "list", "view"], baixar: ["download"], subir: ["upload"], anexar: ["attachment", "attach", "upload"],
  criar: ["create", "add", "new", "insert"], novo: ["create", "new"], nova: ["create", "new"], adicionar: ["add", "insert", "create", "append"], incluir: ["add", "insert"],
  atualizar: ["update", "patch", "edit"], editar: ["update", "edit", "patch"], mudar: ["update", "change", "move"], alterar: ["update", "patch"], renomear: ["rename", "update"],
  marcar: ["mark", "flag", "update", "label"], lido: ["read"], lida: ["read"], lidos: ["read"], lidas: ["read"], naolido: ["unread"], importante: ["important", "flag", "importance"],
  anexo: ["attachment"], anexos: ["attachment"], evento: ["event", "meeting"], eventos: ["event"], reuniao: ["meeting", "event"], compromisso: ["event", "meeting"], convite: ["invite", "event", "invitation"],
  agenda: ["calendar", "event", "schedule"], calendario: ["calendar"], horario: ["time", "slot", "free", "busy"], livre: ["free", "available", "slot"], disponivel: ["free", "available"],
  aceitar: ["accept"], recusar: ["decline", "reject"], cancelar: ["cancel", "delete"], contato: ["contact", "people"], contatos: ["contact", "people"], pessoa: ["people", "user", "person"], pessoas: ["people", "user"],
  regra: ["rule", "filter"], regras: ["rule", "filter"], filtro: ["filter", "rule"], automatica: ["automatic", "auto"], automatico: ["automatic", "auto"], ferias: ["vacation", "automatic", "reply", "auto"],
  assinatura: ["signature"], categoria: ["category", "label"], categorias: ["category", "label"], etiqueta: ["label", "tag"], rotulo: ["label"], marcador: ["label", "tag"],
  tarefa: ["task", "todo", "issue"], tarefas: ["task", "todo", "issue"], lembrete: ["reminder"], agendar: ["schedule"], agendada: ["scheduled", "schedule"], fixar: ["pin"], reacao: ["reaction", "emoji"],
  canal: ["channel", "conversation"], canais: ["channel"], usuario: ["user", "member"], usuarios: ["user", "member"], membro: ["member", "user"], grupo: ["group"], equipe: ["team"], time: ["team"],
  arquivo: ["file"], arquivos: ["file"], planilha: ["spreadsheet", "sheet"], aba: ["sheet", "tab"], linha: ["row"], linhas: ["row"], coluna: ["column"], celula: ["cell", "value", "range"], valores: ["value"],
  pagina: ["page"], paginas: ["page"], documento: ["doc", "document", "page"], comentario: ["comment"], comentarios: ["comment"], bloco: ["block"], banco: ["database"], tabela: ["table", "database"],
  consulta: ["query"], projeto: ["project"], repositorio: ["repository", "repo"], ramo: ["branch"], historico: ["history"], conversa: ["thread", "conversation", "history"], thread: ["thread"],
  lote: ["batch", "bulk"], varios: ["batch", "multiple"], todos: ["all"], perfil: ["profile", "me"], eu: ["me", "profile"], configuracao: ["settings", "config"], configuracoes: ["settings"],
  permissao: ["permission", "share", "access"], compartilhar: ["share", "permission"], link: ["link", "permalink"], status: ["status", "state"], estado: ["state", "status"], prioridade: ["priority"],
  ciclo: ["cycle"], sprint: ["cycle", "sprint"], rotular: ["label"], fechar: ["close"], reabrir: ["reopen"], mesclar: ["merge"], revisar: ["review"], revisao: ["review"], pr: ["pull", "request"],
};

const STOP = new Set(["de", "da", "do", "das", "dos", "um", "uma", "o", "a", "os", "as", "e", "ou", "para", "pra", "com", "no", "na", "nos", "nas", "em", "meu", "minha", "meus", "minhas", "que", "por", "se", "the", "an", "to", "of", "for", "in", "on", "my", "and", "or", "by", "from", "with", "all"]);

/** minúsculas, sem acento, sem plural simples do inglês ("messages" → "message"). */
function normalizar(t: string): string {
  const s = t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (s.length > 4 && s.endsWith("ies")) return `${s.slice(0, -3)}y`;
  if (s.length > 4 && /(ss|us)$/.test(s)) return s;
  if (s.length > 3 && s.endsWith("s")) return s.slice(0, -1);
  return s;
}

const palavras = (t: string): string[] => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/e-mail/g, "email").split(/[^a-z0-9]+/).filter((p) => p.length > 1 && !STOP.has(p));

/** Os termos da busca, cada um com as variantes que casam (a palavra, o singular e os sinônimos). */
export function termosDaBusca(busca: string): string[][] {
  const nao = /\bnao\s+lid/.test(busca.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
  const lista = palavras(busca).map((p) => [...new Set([p, normalizar(p), ...(SINONIMOS[p] ?? SINONIMOS[normalizar(p)] ?? []).map(normalizar)])]);
  return nao ? [...lista.filter((v) => !v.includes("nao")), ["unread"]] : lista;
}

export type ItemDaBusca = { ferramenta: string; descricao: string; schema: JsonSchema | null; concedida: boolean; direta: boolean };

/** Pontua um item: nome vale mais que descrição; cada termo conta uma vez (a melhor variante). */
function pontuar(termos: readonly string[][], nome: string, descricao: string): number {
  const doNome = capacidadeDe({ nome }).split(/[^A-Za-z0-9]+/).map(normalizar);
  const daDescricao = new Set(palavras(descricao).map(normalizar));
  let total = 0;
  let casados = 0;
  for (const variantes of termos) {
    let melhor = 0;
    for (const v of variantes) {
      if (doNome.includes(v)) melhor = Math.max(melhor, 3);
      else if (v.length >= 4 && doNome.some((n) => n.startsWith(v) || (n.length >= 4 && v.startsWith(n)))) melhor = Math.max(melhor, 2);
      else if (daDescricao.has(v)) melhor = Math.max(melhor, 1);
    }
    total += melhor;
    if (melhor > 0) casados++;
  }
  // Todos os termos casados valem mais que um termo repetido; nome curto desempata (a genérica antes da específica).
  return casados === 0 ? 0 : total + (casados === termos.length ? 2 : 0);
}

/**
 * apps_buscar: procura nas capacidades dos apps (as concedidas, diretas ou sob demanda, e as que ainda pedem acesso). As
 * concedidas fora da lista vêm com esquema (para apps_usar); as diretas só pelo nome (já estão na lista); as não
 * concedidas sem esquema, com `concedida: false` (o caminho é pedir_acesso).
 */
export function buscarCapacidades(entrada: { busca: string; app?: string | null; itens: readonly ItemDaBusca[]; limite?: number }): { resultados: ItemDaBusca[]; total: number } {
  const termos = termosDaBusca(entrada.busca);
  const app = entrada.app ? normalizar(entrada.app.trim()) : null;
  const doApp = app ? entrada.itens.filter((i) => { const slug = i.ferramenta.slice(0, i.ferramenta.indexOf("__")).toLowerCase(); return slug === app || appDoConector(slug) === app || slug.startsWith(app); }) : entrada.itens;
  if (termos.length === 0) return { resultados: [], total: doApp.length };
  const pontuados = doApp.map((i) => ({ i, p: pontuar(termos, i.ferramenta, i.descricao) })).filter((x) => x.p > 0);
  // Concedida antes de não concedida no empate: é o que o bot pode chamar agora.
  pontuados.sort((a, b) => b.p - a.p || Number(b.i.concedida) - Number(a.i.concedida) || a.i.ferramenta.length - b.i.ferramenta.length || a.i.ferramenta.localeCompare(b.i.ferramenta));
  return { resultados: pontuados.slice(0, entrada.limite ?? RESULTADOS_DA_BUSCA).map((x) => x.i), total: doApp.length };
}

/** A descrição curta do resultado (a do app pode ter milhares de caracteres). */
export const descricaoCurta = (d: string, max = 400): string => (d.length > max ? `${d.slice(0, max - 1)}…` : d);

/** O esquema dos argumentos sem a descrição da ferramenta (ela já vai em `descricao`). */
export function esquemaDosArgumentos(schema: JsonSchema): JsonSchema {
  const { description: _d, ...resto } = schema as JsonSchema & { description?: string };
  return resto as JsonSchema;
}

/**
 * apps_usar: a ferramenta pedida, no plano. Aceita o nome inteiro (`outlook__OUTLOOK_X`) ou só a capacidade, quando um
 * único app a tem. Só devolve ferramenta de conector: apps_usar nunca chama ferramenta do nod, do computador ou outra.
 *
 * Revisão do PR #413: o prefixo pedido vale. Com `slug__`, a busca pela capacidade fica no MESMO app; e se `slug` é um
 * conector que existe (`slugsExistentes`), nem a outra conta do app entra: a capacidade que a conta nomeada não tem é
 * sem acesso nela, não a mesma ação em outra conta (a resposta sairia de outra caixa) ou em outro app com o mesmo nome
 * genérico (`send_message`, `search`).
 */
export function resolverAlvo(plano: Pick<PlanoTurno, "catalogo">, pedido: string, slugsExistentes: ReadonlySet<string> = new Set()): { alvo: FerramentaPlano } | { ambigua: string[] } | null {
  const conector = ferramentasDeAppDoPlano(plano).filter((f) => f.origem === "conector");
  const exata = conector.find((f) => f.nome === pedido);
  if (exata) return { alvo: exata };
  const i = pedido.indexOf("__");
  const slug = i >= 0 ? pedido.slice(0, i) : null;
  if (slug !== null && (slugsExistentes.has(slug) || conector.some((f) => f.nome.startsWith(`${slug}__`)))) return null;
  const semPrefixo = i >= 0 ? pedido.slice(i + 2) : pedido;
  const doApp = (f: FerramentaPlano) => slug === null || appDoConector(f.nome.slice(0, f.nome.indexOf("__"))) === appDoConector(slug);
  const pelaCapacidade = conector.filter((f) => capacidadeDe(f) === semPrefixo && doApp(f));
  if (pelaCapacidade.length === 1) return { alvo: pelaCapacidade[0]! };
  if (pelaCapacidade.length > 1) return { ambigua: pelaCapacidade.map((f) => f.nome) };
  return null;
}

// --- prompt ---------------------------------------------------------------------------------------------------------

/** A linha do prompt quando há apps_buscar no plano (conversa, rotina, delegação: onde ela estiver). */
export function linhaDoCatalogoDeApps(p: { comUsar: boolean; comPedirAcesso: boolean }): string {
  const usar = p.comUsar ? " e chame com apps_usar {ferramenta, argumentos}, com as mesmas regras de acesso e aprovação da ferramenta direta" : "";
  const pedir = p.comPedirAcesso ? " O que ainda não é seu volta com concedida: false: peça com pedir_acesso (os nomes exatos, ou [] e o nivel que a tarefa exige), para e nao_pedido; a pessoa aprova num card e a tarefa retoma sozinha." : "";
  return `Apps conectados: cada app traz na sua lista de ferramentas as capacidades mais usadas (mcp__nod__<slug>__<capacidade>): quando uma delas serve, chame direto. As outras que são suas ficam no catálogo do app: ache com apps_buscar {busca, app}, em português ou inglês,${usar}. Antes de dizer que um app não faz algo ou de pedir acesso, procure com apps_buscar.${pedir} Conector habilitado não é acesso seu, e histórico ou memória não provam concessão: vale o que a ferramenta devolve agora.`;
}

/** Ligado e sem apps_buscar no plano (todo app inteiro na lista, nada a achar): o pedido por nível, como no NOD-480. */
export const LINHA_APPS_SEM_BUSCA = "Conector habilitado não é acesso seu: você só chama as ferramentas de conector da sua lista. Para outra capacidade de um app, chame pedir_acesso com capacidades: [] e o nivel que a tarefa exige (leitura ou escrita), para e nao_pedido; a pessoa libera num card e a tarefa retoma sozinha. Isso não é falha da plataforma. Histórico e memória não provam concessão.";

/** Uma linha por app no bloco "Conexões cadastradas": quantas na lista, no catálogo (apps_buscar) e sem acesso. */
export function contagemDoApp(c: Pick<Conector, "id" | "slug" | "habilitado" | "catalogo">, ferramentas: readonly FerramentaPlano[], sobDemanda: number): { slug: string; habilitado: boolean; na_lista: number; no_catalogo: number; sem_acesso: number } {
  const naLista = ferramentas.filter((f) => f.origem === "conector" && f.conectorId === c.id).length;
  return { slug: c.slug, habilitado: c.habilitado, na_lista: naLista, no_catalogo: sobDemanda, sem_acesso: Math.max(0, c.catalogo.length - naLista - sobDemanda) };
}

/**
 * O interruptor (lido pelo compositor): ligado por padrão; NOD_APPS_SOB_DEMANDA=0 desliga (o catálogo inteiro, como
 * antes). NOD_APPS_DIRETAS_TETO: inteiro de 1 a 100; fora disso, o padrão.
 */
export function lerAppsSobDemanda(env: Readonly<Record<string, string | undefined>>): { teto: number } | null {
  if (env.NOD_APPS_SOB_DEMANDA?.trim() === "0") return null;
  const t = Number(env.NOD_APPS_DIRETAS_TETO?.trim());
  return { teto: Number.isInteger(t) && t >= 1 && t <= 100 ? t : TETO_DIRETAS_POR_APP };
}

// --- as respostas de apps_buscar e apps_usar (o servidor e o eval usam as mesmas) -------------------------------------

/**
 * Os itens que apps_buscar procura: as capacidades de app do plano (diretas só pelo nome; sob demanda com esquema) e,
 * dos apps habilitados, as que ainda não são do bot (nome e descrição, sem esquema).
 */
export function itensDaBusca(plano: Pick<PlanoTurno, "catalogo">, conectores: readonly Pick<Conector, "slug" | "habilitado" | "catalogo">[]): ItemDaBusca[] {
  const doPlano = ferramentasDeAppDoPlano(plano).filter((f) => f.origem === "conector");
  const diretas = new Set(plano.catalogo.ferramentas.map((f) => f.nome));
  const noPlano = new Set(doPlano.map((f) => f.nome));
  const itens: ItemDaBusca[] = doPlano.map((f) => ({ ferramenta: f.nome, descricao: f.schema.description ?? "", schema: diretas.has(f.nome) ? null : f.schema, concedida: true, direta: diretas.has(f.nome) }));
  for (const c of conectores) if (c.habilitado) for (const cap of c.catalogo) if (!noPlano.has(`${c.slug}__${cap.nome}`)) itens.push({ ferramenta: `${c.slug}__${cap.nome}`, descricao: cap.descricao, schema: null, concedida: false, direta: false });
  return itens;
}

/** O conteúdo que apps_buscar devolve ao modelo. */
export function respostaDaBusca(p: { busca: string; app: string | null; itens: readonly ItemDaBusca[] }): { resultados: Record<string, unknown>[]; instrucao: string } {
  const { resultados, total } = buscarCapacidades({ busca: p.busca, app: p.app, itens: p.itens });
  const r = resultados.map((i) => ({
    ferramenta: i.ferramenta,
    descricao: descricaoCurta(i.descricao),
    ...(i.direta ? { na_lista: true } : {}),
    ...(i.concedida ? {} : { concedida: false }),
    ...(i.schema ? { argumentos: esquemaDosArgumentos(i.schema) } : {}),
  }));
  const instrucao = r.length === 0
    ? `Nada casou com "${p.busca}"${p.app ? ` no app ${p.app}` : ""} (${total} capacidades procuradas). Tente outras palavras, em inglês (como no nome: list, send, move, folder, rule), ou sem o app.`
    : "Chame a escolhida com apps_usar {ferramenta, argumentos}. na_lista: true já está na sua lista (chame direto). concedida: false ainda não é sua: peça com pedir_acesso.";
  return { resultados: r, instrucao };
}

/**
 * O que apps_usar faz com o pedido: chamar a capacidade do plano (pelo portão inteiro, quem chama decide) ou responder
 * sem rodar nada — ambígua, sem acesso (com a instrução de pedir_acesso), inexistente ou com argumentos inválidos
 * (com os erros e o esquema). `recusa` diz o que a trilha guarda.
 */
export type DecisaoAppsUsar =
  | { chamar: FerramentaPlano; argumentos: unknown }
  | { resposta: Record<string, unknown>; recusa: { conectorId: string | null; ferramenta: string; motivo: "capacidade_desligada" | "fora_do_catalogo" | "args_invalidos" } | null };

export function decidirAppsUsar(p: { plano: Pick<PlanoTurno, "catalogo">; conectores: readonly Pick<Conector, "id" | "slug" | "habilitado" | "catalogo">[]; pedida: string; argumentos: unknown }): DecisaoAppsUsar {
  const r = resolverAlvo(p.plano, p.pedida, new Set(p.conectores.map((c) => c.slug)));
  if (r && "ambigua" in r) return { resposta: { erro: "ambigua", instrucao: `Mais de uma conta tem ${p.pedida}: chame de novo com o nome inteiro, um destes.`, opcoes: r.ambigua }, recusa: null };
  if (!r) {
    const cap = p.pedida.includes("__") ? p.pedida.slice(p.pedida.indexOf("__") + 2) : p.pedida;
    const slug = p.pedida.includes("__") ? p.pedida.slice(0, p.pedida.indexOf("__")) : null;
    const c = p.conectores.find((k) => k.habilitado && (slug === null || k.slug === slug) && k.catalogo.some((x) => x.nome === cap));
    return c
      ? { resposta: { erro: "sem_acesso", ferramenta: `${c.slug}__${cap}`, instrucao: `${cap} não está concedida a você. Para usá-la, chame pedir_acesso com conector=${c.slug}, capacidades=["${cap}"], o nivel que a tarefa exige, para e nao_pedido.` }, recusa: { conectorId: c.id, ferramenta: `${c.slug}__${cap}`, motivo: "capacidade_desligada" } }
      : { resposta: { erro: "nao_encontrada", instrucao: `${p.pedida} não está no catálogo dos seus apps. Ache o nome exato com apps_buscar.` }, recusa: { conectorId: null, ferramenta: p.pedida, motivo: "fora_do_catalogo" } };
  }
  // Revisão do PR #413: a direta que roda NA MÁQUINA (gh do Mac, Mac) só executa pelo nome dela: o proxy confere a
  // ferramenta chamada contra `execucao: "maquina"` e negaria apps_usar (terminal) depois de o servidor já ter gravado a
  // chamada. Nada roda: o modelo chama a direta, que já está na lista dele.
  if (r.alvo.execucao === "maquina") return { resposta: { erro: "na_lista", ferramenta: r.alvo.nome, instrucao: `${r.alvo.nome} já está na sua lista de ferramentas: chame ${r.alvo.nomeMcp} direto, com os mesmos argumentos.` }, recusa: null };
  const argumentos = p.argumentos ?? {};
  const erros = errosDoSchema(r.alvo.schema, argumentos);
  if (erros.length > 0) return { resposta: { erro: "argumentos_invalidos", ferramenta: r.alvo.nome, erros: erros.slice(0, 10), argumentos: esquemaDosArgumentos(r.alvo.schema) }, recusa: { conectorId: r.alvo.conectorId, ferramenta: r.alvo.nome, motivo: "args_invalidos" } };
  return { chamar: r.alvo, argumentos };
}
