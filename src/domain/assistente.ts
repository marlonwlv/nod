import type { CapacidadeAssistente, Lugar } from "../contracts/assistente.ts";
import type { JsonSchema } from "../contracts/json-schema.ts";
import { semInvisiveis } from "./acoes-do-modo.ts";

/**
 * O catálogo e a validação do conector local `assistente` (ADR-174). Puro: o servidor MCP
 * (src/adapters/conectores-locais/assistente/servidor.ts) valida aqui antes de chamar o driver, e a falha volta ao modelo
 * como texto que diz o que corrigir — nunca como exceção com a mensagem do provedor.
 */

const texto = (description: string): JsonSchema => ({ type: "string", description, minLength: 1 });
const inteiro = (description: string): JsonSchema => ({ type: "integer", description });
const DATA = "Data no formato AAAA-MM-DD.";
const obj = (properties: Record<string, JsonSchema>, required: readonly string[]): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });

export const CAPACIDADES_ASSISTENTE: readonly CapacidadeAssistente[] = [
  { nome: "buscar_voos", readOnlyHint: true, descricao: "Busca voos entre duas cidades ou aeroportos numa data. Só lê; não reserva.", schema: obj({ origem: texto("Cidade ou código IATA de saída."), destino: texto("Cidade ou código IATA de chegada."), ida: texto(DATA), volta: texto(DATA), adultos: inteiro("Quantos adultos (padrão 1).") }, ["origem", "destino", "ida"]) },
  { nome: "buscar_hoteis", readOnlyHint: true, descricao: "Busca hotéis numa cidade para as datas. Só lê; não reserva.", schema: obj({ cidade: texto("Cidade."), entrada: texto(DATA), saida: texto(DATA), hospedes: inteiro("Quantos hóspedes (padrão 1).") }, ["cidade", "entrada", "saida"]) },
  { nome: "buscar_carros", readOnlyHint: true, descricao: "Busca carros para alugar num local entre duas datas. Só lê; não reserva.", schema: obj({ local: texto("Cidade ou aeroporto de retirada."), retirada: texto(DATA), devolucao: texto(DATA) }, ["local", "retirada", "devolucao"]) },
  { nome: "buscar_lugares", readOnlyHint: true, descricao: "Busca lugares e restaurantes por texto, perto de um endereço. Só lê.", schema: obj({ busca: texto("O que procurar (\"japonês\", \"farmácia 24h\")."), perto_de: texto("Endereço ou bairro de referência."), tipo: { type: "string", enum: ["restaurante", "lugar"] } }, ["busca"]) },
  { nome: "reservar_mesa", readOnlyHint: false, descricao: "Reserva mesa num restaurante achado por buscar_lugares. Muda algo fora: passa pela aprovação.", schema: obj({ lugar_id: texto("O id que buscar_lugares devolveu."), data_hora: texto("Data e hora locais, AAAA-MM-DDTHH:MM."), pessoas: inteiro("Quantas pessoas.") }, ["lugar_id", "data_hora", "pessoas"]) },
  { nome: "previsao_do_tempo", readOnlyHint: true, descricao: "Previsão do tempo de um lugar para os próximos dias. Só lê.", schema: obj({ local: texto("Cidade ou endereço."), dias: inteiro("De 1 a 10 (padrão 3).") }, ["local"]) },
  { nome: "buscar_produtos", readOnlyHint: true, descricao: "Busca produtos para comprar. Só lê.", schema: obj({ busca: texto("O produto."), preco_max_centavos: inteiro("Preço máximo em centavos.") }, ["busca"]) },
  { nome: "ver_carrinho", readOnlyHint: true, descricao: "Mostra o carrinho atual com o total. Só lê.", schema: obj({}, []) },
  { nome: "adicionar_ao_carrinho", readOnlyHint: false, descricao: "Põe um produto de buscar_produtos no carrinho. Não cobra nada.", schema: obj({ produto_id: texto("O id que buscar_produtos devolveu."), quantidade: inteiro("Quantas unidades (padrão 1).") }, ["produto_id"]) },
  { nome: "finalizar_compra", readOnlyHint: false, destructiveHint: true, descricao: "Cobra o carrinho. Gasta dinheiro: passa pela aprovação e só sai depois de a pessoa confirmar com a passkey no Mac. Se voltar aguardando_passkey, diga o total e encerre; a confirmação retoma.", schema: obj({ carrinho_id: texto("O id do carrinho (ver_carrinho)."), compra_id: texto("O id da compra que voltou aguardando_passkey, ao chamar de novo.") }, ["carrinho_id"]) },
  { nome: "pedir_cartao_virtual", readOnlyHint: false, destructiveHint: true, descricao: "Pede um cartão virtual de uso único com limite, para pagar num site. Gasta dinheiro: passa pela aprovação e pela passkey no Mac. O número do cartão nunca volta para você: o preenchimento é seguro, feito pelo Mac.", schema: obj({ limite_centavos: inteiro("O limite em centavos."), comerciante: texto("Onde vai ser usado (domínio ou nome da loja)."), cartao_id: texto("O id que voltou aguardando_passkey, ao chamar de novo.") }, ["limite_centavos", "comerciante"]) },
  { nome: "listar_reunioes", readOnlyHint: true, descricao: "Lista as reuniões da pessoa num intervalo. Só lê.", schema: obj({ de: texto(DATA), ate: texto(DATA) }, []) },
  { nome: "resumo_da_reuniao", readOnlyHint: true, descricao: "O resumo e os combinados de uma reunião que já aconteceu. Só lê.", schema: obj({ reuniao_id: texto("O id de listar_reunioes.") }, ["reuniao_id"]) },
  { nome: "entrar_na_reuniao", readOnlyHint: false, descricao: "Entra numa reunião como ouvinte, para anotar. Os participantes veem o bot: passa pela aprovação.", schema: obj({ reuniao_id: texto("O id de listar_reunioes.") }, ["reuniao_id"]) },
  { nome: "enviar_mensagem_na_reuniao", readOnlyHint: false, descricao: "Manda uma mensagem no chat da reunião. A pessoa vê como rascunho e edita antes de sair.", schema: obj({ reuniao_id: texto("O id de listar_reunioes."), texto: texto("O texto exato da mensagem.") }, ["reuniao_id", "texto"]) },
];


/** Argumento que não serve: a frase volta ao modelo, que corrige e chama de novo. */
export type Validacao<T> = { ok: true; valor: T } | { ok: false; motivo: string };

/** definido em 2026-11-12: um campo de texto do conector cabe numa linha de busca; o resto é ruído ou injeção. */
const TEXTO_MAX = 200;
/** A mensagem na reunião é fala: cabe num parágrafo de chat. */
const MENSAGEM_MAX = 2000;

const ehData = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
const ehDataHora = (v: string): boolean => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) && ehData(v.slice(0, 10)) && Number(v.slice(11, 13)) < 24 && Number(v.slice(14, 16)) < 60;

/** Leitor de argumentos: cada campo lido uma vez, o primeiro erro vence. */
function leitor(args: Readonly<Record<string, unknown>>) {
  const erros: string[] = [];
  const txt = (k: string, obrigatorio: boolean, max = TEXTO_MAX): string | undefined => {
    const v = args[k];
    if (v === undefined || v === null || v === "") { if (obrigatorio) erros.push(`falta ${k}`); return undefined; }
    if (typeof v !== "string") { erros.push(`${k} tem de ser texto`); return undefined; }
    const limpo = max === MENSAGEM_MAX ? v.trim() : semInvisiveis(v);
    if (!limpo) { if (obrigatorio) erros.push(`falta ${k}`); return undefined; }
    if (limpo.length > max) { erros.push(`${k} passa de ${max} caracteres`); return undefined; }
    return limpo;
  };
  const data = (k: string, obrigatorio: boolean): string | undefined => {
    const v = txt(k, obrigatorio);
    if (v !== undefined && !ehData(v)) { erros.push(`${k} tem de ser uma data AAAA-MM-DD`); return undefined; }
    return v;
  };
  const int = (k: string, padrao: number | undefined, min: number, max: number): number | undefined => {
    const v = args[k];
    if (v === undefined || v === null) return padrao;
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) { erros.push(`${k} tem de ser inteiro de ${min} a ${max}`); return undefined; }
    return v;
  };
  return { txt, data, int, erros, args };
}

/** Os argumentos de cada ferramenta, conferidos e normalizados (snake_case do schema → camelCase do driver). */
export type ArgsAssistente =
  | { nome: "buscar_voos"; origem: string; destino: string; ida: string; volta?: string; adultos: number }
  | { nome: "buscar_hoteis"; cidade: string; entrada: string; saida: string; hospedes: number }
  | { nome: "buscar_carros"; local: string; retirada: string; devolucao: string }
  | { nome: "buscar_lugares"; busca: string; pertoDe?: string; tipo?: Lugar["tipo"] }
  | { nome: "reservar_mesa"; lugarId: string; dataHora: string; pessoas: number }
  | { nome: "previsao_do_tempo"; local: string; dias: number }
  | { nome: "buscar_produtos"; busca: string; precoMaxCentavos?: number }
  | { nome: "ver_carrinho" }
  | { nome: "adicionar_ao_carrinho"; produtoId: string; quantidade: number }
  | { nome: "finalizar_compra"; carrinhoId: string; compraId?: string }
  | { nome: "pedir_cartao_virtual"; limiteCentavos: number; comerciante: string; cartaoId?: string }
  | { nome: "listar_reunioes"; de?: string; ate?: string }
  | { nome: "resumo_da_reuniao"; reuniaoId: string }
  | { nome: "entrar_na_reuniao"; reuniaoId: string }
  | { nome: "enviar_mensagem_na_reuniao"; reuniaoId: string; texto: string };

/** definido em 2026-11-12: o teto de uma busca de preço e de um cartão virtual (R$ 1 milhão), só para barrar absurdo. */
const CENTAVOS_MAX = 100_000_000;

export function validarArgsAssistente(nome: string, args: Readonly<Record<string, unknown>>): Validacao<ArgsAssistente> {
  const l = leitor(args);
  const conhecidos = new Set(Object.keys((CAPACIDADES_ASSISTENTE.find((c) => c.nome === nome)?.schema.properties) ?? {}));
  if (!CAPACIDADES_ASSISTENTE.some((c) => c.nome === nome)) return { ok: false, motivo: `ferramenta desconhecida: ${nome}` };
  const sobra = Object.keys(args).filter((k) => !conhecidos.has(k));
  if (sobra.length) return { ok: false, motivo: `argumento fora do schema: ${sobra.join(", ")}` };
  let v: ArgsAssistente | null = null;
  switch (nome) {
    case "buscar_voos": {
      const origem = l.txt("origem", true), destino = l.txt("destino", true), ida = l.data("ida", true), volta = l.data("volta", false), adultos = l.int("adultos", 1, 1, 9);
      if (ida && volta && volta < ida) l.erros.push("volta antes da ida");
      if (origem && destino && adultos !== undefined && ida) v = { nome, origem, destino, ida, ...(volta ? { volta } : {}), adultos };
      break;
    }
    case "buscar_hoteis": {
      const cidade = l.txt("cidade", true), entrada = l.data("entrada", true), saida = l.data("saida", true), hospedes = l.int("hospedes", 1, 1, 20);
      if (entrada && saida && saida <= entrada) l.erros.push("saida tem de ser depois da entrada");
      if (cidade && entrada && saida && hospedes !== undefined) v = { nome, cidade, entrada, saida, hospedes };
      break;
    }
    case "buscar_carros": {
      const local = l.txt("local", true), retirada = l.data("retirada", true), devolucao = l.data("devolucao", true);
      if (retirada && devolucao && devolucao < retirada) l.erros.push("devolucao antes da retirada");
      if (local && retirada && devolucao) v = { nome, local, retirada, devolucao };
      break;
    }
    case "buscar_lugares": {
      const busca = l.txt("busca", true), pertoDe = l.txt("perto_de", false), tipo = l.txt("tipo", false);
      if (tipo !== undefined && tipo !== "restaurante" && tipo !== "lugar") l.erros.push("tipo é restaurante ou lugar");
      if (busca) v = { nome, busca, ...(pertoDe ? { pertoDe } : {}), ...(tipo === "restaurante" || tipo === "lugar" ? { tipo } : {}) };
      break;
    }
    case "reservar_mesa": {
      const lugarId = l.txt("lugar_id", true), dataHora = l.txt("data_hora", true), pessoas = l.int("pessoas", undefined, 1, 30);
      if (dataHora && !ehDataHora(dataHora)) l.erros.push("data_hora tem de ser AAAA-MM-DDTHH:MM");
      if (pessoas === undefined && l.args.pessoas === undefined) l.erros.push("falta pessoas");
      if (lugarId && dataHora && pessoas !== undefined) v = { nome, lugarId, dataHora, pessoas };
      break;
    }
    case "previsao_do_tempo": {
      const local = l.txt("local", true), dias = l.int("dias", 3, 1, 10);
      if (local && dias !== undefined) v = { nome, local, dias };
      break;
    }
    case "buscar_produtos": {
      const busca = l.txt("busca", true), precoMaxCentavos = l.int("preco_max_centavos", undefined, 1, CENTAVOS_MAX);
      if (busca) v = { nome, busca, ...(precoMaxCentavos !== undefined ? { precoMaxCentavos } : {}) };
      break;
    }
    case "ver_carrinho":
      v = { nome };
      break;
    case "adicionar_ao_carrinho": {
      const produtoId = l.txt("produto_id", true), quantidade = l.int("quantidade", 1, 1, 99);
      if (produtoId && quantidade !== undefined) v = { nome, produtoId, quantidade };
      break;
    }
    case "finalizar_compra": {
      const carrinhoId = l.txt("carrinho_id", true), compraId = l.txt("compra_id", false);
      if (carrinhoId) v = { nome, carrinhoId, ...(compraId ? { compraId } : {}) };
      break;
    }
    case "pedir_cartao_virtual": {
      const limiteCentavos = l.int("limite_centavos", undefined, 1, CENTAVOS_MAX), comerciante = l.txt("comerciante", true), cartaoId = l.txt("cartao_id", false);
      if (limiteCentavos === undefined && l.args.limite_centavos === undefined) l.erros.push("falta limite_centavos");
      if (limiteCentavos !== undefined && comerciante) v = { nome, limiteCentavos, comerciante, ...(cartaoId ? { cartaoId } : {}) };
      break;
    }
    case "listar_reunioes": {
      const de = l.data("de", false), ate = l.data("ate", false);
      if (de && ate && ate < de) l.erros.push("ate antes de de");
      v = { nome, ...(de ? { de } : {}), ...(ate ? { ate } : {}) };
      break;
    }
    case "resumo_da_reuniao":
    case "entrar_na_reuniao": {
      const reuniaoId = l.txt("reuniao_id", true);
      if (reuniaoId) v = { nome, reuniaoId };
      break;
    }
    case "enviar_mensagem_na_reuniao": {
      const reuniaoId = l.txt("reuniao_id", true), t = l.txt("texto", true, MENSAGEM_MAX);
      if (reuniaoId && t) v = { nome, reuniaoId, texto: t };
      break;
    }
  }
  if (l.erros.length || !v) return { ok: false, motivo: `${l.erros[0] ?? "argumentos inválidos"}. Corrija e chame ${nome} de novo.` };
  return { ok: true, valor: v };
}
