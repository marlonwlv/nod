import { ErroDeDominio } from "../../domain/erro.ts";
import type { Deps } from "../../use-cases/tipos.ts";
import type { Escopo } from "../../shared/types.ts";

/** Só o backend recebe a credencial. Não grava configuração de infraestrutura no tenant. */
export function comAppsHospedados(deps: Deps, chaveCifrada: string | null): Deps {
  const original = deps.repos.composio;
  return { ...deps, appsHospedados: true, repos: { ...deps.repos, composio: {
    ...original,
    // Preserva projetos antigos: sessões já existentes pertencem à chave daquele tenant.
    chave: async () => (await original.chave()) ?? chaveCifrada,
    salvarChave: async () => { throw new ErroDeDominio("nao_permitido"); },
    salvarChaveSeAusente: async () => { throw new ErroDeDominio("nao_permitido"); },
  } } };
}

/** Por processo: teto global limita também memória/Sybil; reinicia a cada minuto. */
export function limitadorAppsHospedados(agora: () => number = Date.now) {
  let inicio = agora();
  let total = 0;
  const pessoas = new Map<string, number>();
  return (escopo: Escopo) => {
    const em = agora();
    if (em - inicio >= 60_000) { inicio = em; total = 0; pessoas.clear(); }
    const id = `${escopo.tenantId}:${escopo.pessoaId}`;
    const usados = pessoas.get(id) ?? 0;
    if (usados >= 30 || total >= 300) throw new ErroDeDominio("limite_atingido");
    pessoas.set(id, usados + 1);
    total += 1;
  };
}
