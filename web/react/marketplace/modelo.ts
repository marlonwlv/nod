import { ErroApi } from "../../lib/erro-api.ts";
import { erroDaResposta } from "../../telas/card-credencial.ts";
import { loteDeEscritaPedeConfirmacao } from "../../telas/acessos-do-app.ts";
import type { NivelPedido } from "../../lib/acessos-otimistas.ts";
import type { AppDaVitrine, CampoNaTela, NotasDosNiveis, PassoDaChave, ResultadoDaChave } from "./tipos.ts";

/**
 * As regras do Marketplace em modal, sem React (testadas em tests/unit/web/react/marketplace/modelo.test.tsx): o que a
 * linha diz, as categorias dos chips, a busca, as seções do início, o formulário da chave e o lote do "Quem pode usar".
 */

/** O `CATEGORIA_PADRAO` de src/contracts/marketplace.ts (a web não importa valor de src, ADR-018): app sem curadoria. */
export const CATEGORIA_SEM_CURADORIA = "Integrações";
/** definido em 2026-11-18 (Paper D1): Todos + quatro chips; as outras categorias ficam no "Mais". */
export const CHIPS_VISIVEIS = 4;
/** definido em 2026-11-18 (Paper D1): seis apps em "Recomendados" (três linhas) e quatro por categoria (duas linhas). */
export const NO_RECOMENDADOS = 6;
export const POR_CATEGORIA = 4;
/** definido em 2026-11-18: uma lista (busca ou categoria) desenha 60 linhas por vez; "Mostrar mais" traz as próximas. */
export const POR_PAGINA = 60;

export const normalizar = (t: string): string => t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/** A segunda linha do app: "Chave de API · Vendas" no app de chave; a frase curta ou a descrição no de login. */
export function detalheDaLinha(app: Pick<AppDaVitrine, "chave" | "resumo" | "descricao">): string {
  return `${app.chave ? "Chave de API · " : ""}${app.resumo ?? app.descricao}`;
}

/** Conectado para a contagem do topo e a lista "Conectados": funcionando, em atenção ou desligado (o conector existe). */
export function estaConectado(app: Pick<AppDaVitrine, "situacao" | "desligado">): boolean {
  return app.situacao === "conectado" || app.situacao === "atencao" || app.desligado === true;
}

/** Ainda para conectar (o que as seções do início oferecem): nem conectado nem em atenção. */
const paraConectar = (app: AppDaVitrine): boolean => !estaConectado(app);

const ordemPt = (a: string, b: string): number => a.localeCompare(b, "pt-BR");

/**
 * Os chips: "Todos" e as categorias mais frequentes do catálogo (empate: ordem alfabética); o resto vai para "Mais".
 * A categoria de quem não tem curadoria nunca vira chip: no catálogo do Composio ela é a maior e não diz nada.
 */
export function categoriasDosChips(apps: readonly Pick<AppDaVitrine, "categoria">[], visiveis = CHIPS_VISIVEIS): { chips: string[]; mais: string[] } {
  const contagem = new Map<string, number>();
  for (const a of apps) contagem.set(a.categoria, (contagem.get(a.categoria) ?? 0) + 1);
  const ordenadas = [...contagem.entries()].sort((a, b) => b[1] - a[1] || ordemPt(a[0], b[0])).map(([c]) => c);
  const candidatas = ordenadas.filter((c) => c !== CATEGORIA_SEM_CURADORIA);
  const chips = candidatas.slice(0, visiveis);
  const mais = ordenadas.filter((c) => !chips.includes(c)).sort(ordemPt);
  return { chips, mais };
}

/**
 * A busca: pelo nome, pela frase curta e pela descrição, sem acento e sem caixa (a categoria é o chip, não a busca).
 * Ordem: o nome que começa com o termo, depois o nome que o contém, depois o resto; dentro de cada grupo, a do catálogo.
 */
export function buscar<T extends Pick<AppDaVitrine, "nome" | "resumo" | "descricao" | "categoria">>(apps: readonly T[], termo: string, categoria: string | null = null): T[] {
  const t = normalizar(termo);
  const naCategoria = categoria ? apps.filter((a) => a.categoria === categoria) : [...apps];
  if (!t) return naCategoria;
  const pontos = (a: T): number => {
    const nome = normalizar(a.nome);
    if (nome.startsWith(t)) return 0;
    if (nome.includes(t)) return 1;
    return normalizar(`${a.resumo ?? ""} ${a.descricao}`).includes(t) ? 2 : -1;
  };
  return naCategoria.map((a, i) => ({ a, i, p: pontos(a) })).filter((x) => x.p >= 0).sort((x, y) => x.p - y.p || x.i - y.i).map((x) => x.a);
}

export type SecaoDoInicio = { titulo: string; categoria: string | null; apps: AppDaVitrine[] };

/**
 * O início (Paper D1): "Precisa de atenção", "Recomendados para você" e uma seção por categoria dos chips, com o que
 * ainda falta conectar. A seção da categoria que tem mais para oferecer vem primeiro (empate: ordem alfabética).
 */
export function secoesDoInicio(apps: readonly AppDaVitrine[], chips: readonly string[]): { atencao: AppDaVitrine[]; secoes: SecaoDoInicio[] } {
  const atencao = apps.filter((a) => a.situacao === "atencao");
  const livres = apps.filter(paraConectar);
  const recomendados = livres.filter((a) => a.recomendado).slice(0, NO_RECOMENDADOS);
  const usados = new Set(recomendados.map((a) => a.slug));
  const porCategoria = chips
    .map((categoria) => ({ categoria, todos: livres.filter((a) => a.categoria === categoria && !usados.has(a.slug)) }))
    .filter((c) => c.todos.length > 0)
    .sort((a, b) => b.todos.length - a.todos.length || ordemPt(a.categoria, b.categoria))
    .map((c) => ({ titulo: c.categoria, categoria: c.categoria, apps: c.todos.slice(0, POR_CATEGORIA) }));
  const secoes = [...(recomendados.length ? [{ titulo: "Recomendados para você", categoria: null, apps: recomendados }] : []), ...porCategoria];
  return { atencao, secoes };
}

/** "1.445" (o separador de milhar do português). */
export const milhar = (n: number): string => n.toLocaleString("pt-BR");

export function tituloDaLista(n: number, termo: string, categoria: string | null): string {
  const t = termo.trim();
  if (!t) return categoria ?? "Todos os apps";
  const apps = n === 0 ? "Nenhum app" : n === 1 ? "1 app" : `${milhar(n)} apps`;
  return `${apps} para “${t}”${categoria ? ` em ${categoria}` : ""}`;
}

// ---------------------------------------------------------------------------------------------- o formulário da chave

export type Trecho = string | { destaque: string };

/** O rótulo do campo: o segredo único é a "Chave de API" (o Composio chama de "API Key"); os outros, o do provedor. */
export function rotuloDoCampo(campo: CampoNaTela, campos: readonly CampoNaTela[]): string {
  return campo.segredo && campos.filter((c) => c.segredo).length === 1 ? "Chave de API" : campo.rotulo;
}

const emLista = (itens: readonly string[]): string => (itens.length <= 1 ? (itens[0] ?? "") : `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)}`);

/** A frase de cima do formulário (Paper T2 e T3), com o que o app pede em destaque. */
export function fraseDoFormulario(nome: string, campos: readonly CampoNaTela[]): Trecho[] {
  const abertos = campos.filter((c) => !c.segredo).map((c) => c.naFrase ?? c.rotulo.toLowerCase());
  if (abertos.length === 0) return [`O ${nome} conecta com uma `, { destaque: "chave de API" }, `: um código que vale como senha, para o nod usar o ${nome} em seu nome.`];
  const destaques: Trecho[] = abertos.flatMap((r, i) => [...(i === 0 ? [] : [i === abertos.length - 1 ? " e o " : ", o "]), { destaque: r }]);
  return [`O ${nome} conecta com o `, ...destaques, " e uma ", { destaque: "chave de API" }, `, o código que vale como senha para o nod usar o ${nome} em seu nome.`];
}

/** Os passos de "Onde achar a chave" quando o app não traz os dele (o provedor só dá uma frase em inglês). */
export function passosPadrao(nome: string): PassoDaChave[] {
  return [[`Entre no ${nome} e abra as `, { destaque: "configurações da conta" }], ["Procure a ", { destaque: "chave de API" }, " (API key) e copie"], ["Volte aqui e cole no campo abaixo"]];
}

/** Os campos obrigatórios ainda vazios. `preenchidos` vem do formulário (só o nome do campo, nunca o valor). */
export function camposFaltando(campos: readonly CampoNaTela[], preenchidos: ReadonlySet<string>): string[] {
  return campos.filter((c) => c.obrigatorio && !preenchidos.has(c.nome)).map((c) => c.nome);
}

/** O Conectar acende quando todo obrigatório tem valor (e há pelo menos um campo com valor). */
export function podeConectar(campos: readonly CampoNaTela[], preenchidos: ReadonlySet<string>): boolean {
  return campos.length > 0 && preenchidos.size > 0 && camposFaltando(campos, preenchidos).length === 0;
}

/** Os valores que vão ao servidor, lidos dos campos na hora do envio (aparados; o vazio não vai). */
export function valoresDoFormulario(campos: readonly CampoNaTela[], ler: (nome: string) => string): Record<string, string> {
  const valores: Record<string, string> = {};
  for (const c of campos) {
    const v = ler(c.nome).trim();
    if (v) valores[c.nome] = v;
  }
  return valores;
}

/** O erro da rota vira um resultado fechado (o código, nunca a mensagem crua; a mesma tabela do cartão de credencial). */
export function resultadoDoErro(e: unknown): ResultadoDaChave {
  if (!(e instanceof ErroApi)) return { tipo: "indisponivel" };
  if (e.codigo === "integracao_nao_configurada") return { tipo: "nao_configurado" };
  switch (erroDaResposta(e.status === 0 ? null : e.status, e.codigo)) {
    case "rede": return { tipo: "rede" };
    case "recusada": return { tipo: "recusada" };
    case "formato": return { tipo: "invalida" };
    default: return { tipo: "indisponivel" };
  }
}

/** O aviso do formulário (NOD-399: círculo vermelho e a frase neutra). null = nada a avisar. */
export function avisoDoResultado(nome: string, r: ResultadoDaChave | null): { frase: string; mais: string } | null {
  if (!r) return null;
  switch (r.tipo) {
    case "conectado": return null;
    case "recusada": return { frase: `O ${nome} recusou essa chave.`, mais: `Confira se copiou a chave inteira, sem espaço no fim. Se ela foi apagada no ${nome}, gere outra e cole aqui.` };
    case "invalida": return { frase: `Isso não parece o que o ${nome} pede.`, mais: "Confira se não colou espaço, aspas ou quebra de linha junto." };
    case "sem_resposta": return { frase: `A chave entrou, mas o ${nome} não respondeu ao teste.`, mais: "Tente de novo em instantes. Se repetir, confira se a chave tem permissão de leitura." };
    case "nao_configurado": return { frase: "O serviço de conexão do time ainda não está configurado.", mais: "Quem cuida do nod configura em Avançado, uma vez para todo mundo." };
    case "indisponivel": return { frase: `O ${nome} não respondeu agora.`, mais: "Tente de novo em instantes." };
    case "rede": return { frase: "Não deu para confirmar se a chave foi guardada.", mais: "Confira a internet e tente de novo." };
  }
}

/** Só a chave recusada pinta o campo de vermelho; o resto é aviso sem culpar o que foi colado. */
export const campoRecusado = (r: ResultadoDaChave | null): boolean => r?.tipo === "recusada" || r?.tipo === "invalida";

// ---------------------------------------------------------------------------------------------- o lote do "Quem pode usar"

export type Caixa = "nenhum" | "misto" | "todos";

export function caixaDoLote(marcados: number, total: number): Caixa {
  return marcados === 0 ? "nenhum" : marcados >= total ? "todos" : "misto";
}

/** "2 de 5 selecionados"; sem nada marcado, a caixa convida a marcar todos. */
export function textoDaSelecao(marcados: number, total: number): string {
  return marcados === 0 ? "Selecionar todos" : `${marcados} de ${total} ${marcados === 1 ? "selecionado" : "selecionados"}`;
}

/** "Aplicar aos 2:" (Paper T6); sem seleção, o lote vale para todos, como a barra de antes (acessos-do-app.ts). */
export function rotuloDoAplicar(marcados: number): string {
  return marcados === 0 ? "Aplicar a todos:" : marcados === 1 ? "Aplicar ao 1:" : `Aplicar aos ${marcados}:`;
}

export function alternar(sel: ReadonlySet<string>, id: string): Set<string> {
  const s = new Set(sel);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  return s;
}

/** A caixa do cabeçalho: com todos marcados, limpa; senão, marca todos (a regra do "Selecionar todos" de antes). */
export function alternarTodos(sel: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  return ids.length > 0 && ids.every((id) => sel.has(id)) ? new Set() : new Set(ids);
}

/** Quem o lote alcança: os marcados (só os que ainda são bots da pessoa) ou todos. */
export function alvoDoLote(sel: ReadonlySet<string>, ids: readonly string[]): "todos" | string[] {
  const marcados = ids.filter((id) => sel.has(id));
  return marcados.length ? marcados : "todos";
}

/** Ler e alterar para mais de um bot pede confirmação ali mesmo (a mesma regra da barra de antes). */
export function lotePedeConfirmacao(nivel: NivelPedido, alvo: "todos" | readonly string[], totalDeBots: number): boolean {
  return loteDeEscritaPedeConfirmacao(nivel, alvo, totalDeBots);
}

/** "Clarice e Ada"; com mais de três, "Os 5 bots". */
export function nomesDoLote(nomes: readonly string[]): string {
  return nomes.length > 3 ? `Os ${nomes.length} bots` : emLista(nomes);
}

/** A confirmação do lote (Paper T6b) ou do padrão: o título e a frase de baixo. */
export function fraseDaConfirmacao(app: string, alvo: "lote" | "padrao", nomes: readonly string[], verbos: string): { titulo: string; detalhe: string } {
  if (alvo === "padrao") return { titulo: `Liberar Ler e alterar no ${app} para os bots novos e quem segue o padrão?`, detalhe: `Eles poderão ${verbos} sem perguntar. Apagar fica de fora.` };
  const n = nomes.length;
  return { titulo: `Liberar Ler e alterar no ${app} para ${n === 1 ? "1 bot" : `${n} bots`}?`, detalhe: `${nomesDoLote(nomes)} ${n === 1 ? "poderá" : "poderão"} ${verbos} sem perguntar. Apagar fica de fora.` };
}

/** O que cada nível libera, sem curadoria por app: a regra de `podeENao` (web/telas/app-acesso.ts) em frase curta. */
export function notasGenericas(nome: string): NotasDosNiveis {
  return { ler: `vê e lê o que está no ${nome}, sem criar, alterar nem apagar nada.`, escrita: `também cria, edita e comenta no ${nome}. Apagar fica de fora.`, verbosDaEscrita: `criar, editar e comentar no ${nome}` };
}
