import type { JsonSchema } from "../contracts/ferramentas-nod.ts";

// Validação de argumentos pelo subconjunto JSON Schema de src/contracts/ferramentas-nod.ts.

function tipoDe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Pontos de código, sem alocar: um par substituto (emoji, CJK estendido) conta 1, como no JSON Schema. */
function pontosDeCodigo(s: string): number {
  let n = s.length;
  for (let i = 0; i < s.length - 1; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { n--; i++; }
    }
  }
  return n;
}

export function errosDoSchema(schema: JsonSchema, valor: unknown, caminho = "$"): string[] {
  const erros: string[] = [];
  if (schema.not && errosDoSchema(schema.not, valor, caminho).length === 0) return [`${caminho}: valor não permitido`];
  if (schema.anyOf && !schema.anyOf.some((s) => errosDoSchema(s, valor, caminho).length === 0)) return [`${caminho}: nenhuma alternativa válida`];
  if (schema.oneOf && schema.oneOf.filter((s) => errosDoSchema(s, valor, caminho).length === 0).length !== 1) return [`${caminho}: esperado uma alternativa válida`];
  const t = tipoDe(valor);
  const esperado = schema.type === "integer" ? "number" : schema.type;
  if (schema.type && t !== esperado) return [`${caminho}: esperado ${schema.type}, veio ${t}`];
  if (schema.type === "integer" && !Number.isInteger(valor)) erros.push(`${caminho}: esperado inteiro`);
  if (schema.type === "string") {
    const s = valor as string;
    // 2026-11-19 (QA-71): o JSON Schema conta caracteres (pontos de código), como o modelo que monta a chamada e o
    // domínio (caracteres() do artefato). Com s.length (UTF-16) um título de 120 caracteres com emoji no fim passava no
    // modelo e no domínio, mas voltava negado aqui como "argumentos inválidos", sem campo para corrigir.
    const n = schema.minLength !== undefined || schema.maxLength !== undefined ? pontosDeCodigo(s) : 0;
    if (schema.minLength !== undefined && n < schema.minLength) erros.push(`${caminho}: mínimo ${schema.minLength} caracteres`);
    if (schema.maxLength !== undefined && n > schema.maxLength) erros.push(`${caminho}: máximo ${schema.maxLength} caracteres`);
    if (schema.enum && !schema.enum.includes(s)) erros.push(`${caminho}: valor fora de [${schema.enum.join(", ")}]`);
  }
  if (schema.type === "array") {
    const a = valor as unknown[];
    if (schema.minItems !== undefined && a.length < schema.minItems) erros.push(`${caminho}: mínimo ${schema.minItems} itens`);
    if (schema.maxItems !== undefined && a.length > schema.maxItems) erros.push(`${caminho}: máximo ${schema.maxItems} itens`);
    if (schema.items) a.forEach((item, i) => erros.push(...errosDoSchema(schema.items as JsonSchema, item, `${caminho}[${i}]`)));
  }
  if (schema.type === "object") {
    const o = valor as Record<string, unknown>;
    for (const r of schema.required ?? []) if (!(r in o)) erros.push(`${caminho}.${r}: obrigatório`);
    for (const [k, v] of Object.entries(o)) {
      const sub = schema.properties?.[k];
      if (sub) erros.push(...errosDoSchema(sub, v, `${caminho}.${k}`));
      else if (schema.additionalProperties === false) erros.push(`${caminho}.${k}: propriedade não prevista`);
    }
  }
  return erros;
}
