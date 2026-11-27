import { randomUUID, timingSafeEqual } from "node:crypto";
import type { ChaveMestra } from "../adapters/cofre/chave-mestra.ts";
import type { ChavesDoTenant } from "../adapters/cofre/chaves-do-tenant.ts";
import {
  aadDaChaveDoTenant,
  cifrarValor,
  decifrarValor,
  desembrulharChaveDoItem,
  embrulharChaveDoItem,
  FalhaDoCofre,
  gerarChave,
  zerar,
} from "../db/cifra-envelope.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import type { CifraDoItem, DonoItemCofre, ItemDoCofre, TipoItemCofre } from "../repositories/cofre.repo.ts";
import type { Escopo } from "../shared/types.ts";
import type { Deps } from "./tipos.ts";

/**
 * O cofre em envelope (definido em 2026-11-24, ADR-195, Entrega 1): guardar, trocar, revogar, listar, ler para entregar e
 * reembrulhar a mestra. A cripto mora em src/db/cifra-envelope.ts; a chave do tenant aberta vem de `ChavesDoTenant`
 * (cache de 10 min sobre a mestra, src/adapters/cofre/chaves-do-tenant.ts), que a composição injeta.
 *
 * Ainda sem rota, sem ferramenta e sem a entrega selada ao motor (Entrega 2): nada do fluxo de hoje (conectores,
 * Composio, cofre_logins, pedir_credencial) passa por aqui.
 *
 * A mestra é chamada dentro da transação do caso de uso no primeiro uso do tenant (e a cada 10 min): no máximo
 * PRAZO_KMS_MS por chamada. Se o p95 pesar no turno, o gatilho da ADR-195 é aumentar o cache.
 */
export type DepsDoCofre = Pick<Deps, "repos" | "escopo" | "agora">;

const TIPOS: readonly TipoItemCofre[] = ["chave", "login", "contato", "cartao"];
const DONOS: readonly DonoItemCofre[] = ["pessoa", "time"];
/** definido em 2026-11-24: 32 KiB de valor cabem nos 64 KiB do CHECK da 0185 depois do base64 e do cabeçalho. */
export const MAX_BYTES_VALOR = 32 * 1024;
/** O mesmo teto do CHECK cofre_itens_publico. */
export const MAX_BYTES_PUBLICO = 4096;

export type EntradaGuardar = {
  tipo: TipoItemCofre;
  nome: string;
  app?: string | null;
  publico?: Record<string, unknown>;
  /** O segredo. Proibido no cartão (o número fica no aparelho da pessoa, ADR-195 §1). */
  valor?: string | null;
  dono: DonoItemCofre;
  /** O que mais o evento 'guardado' ou 'trocado' leva (o bot do cartão que pediu). Nunca o valor. */
  detalheDoEvento?: Record<string, unknown>;
};

/** A chave viva do tenant, aberta (cópia do chamador, que zera). Cria a versão 1 no primeiro uso. */
async function chaveAtivaDoTenant(deps: DepsDoCofre, chaves: ChavesDoTenant): Promise<{ versao: number; chave: Buffer }> {
  const tenantId = deps.escopo.tenantId;
  const viva = await deps.repos.cofre.chaveAtivaDoTenant();
  if (viva) return { versao: viva.versao, chave: await chaves.abrir({ tenantId, versao: viva.versao, chaveEmbrulhada: viva.chaveEmbrulhada }) };
  const versao = (await deps.repos.cofre.maiorVersaoDaChave()) + 1;
  const nova = await chaves.criar(tenantId, versao);
  const gravada = await deps.repos.cofre.criarChaveDoTenant({ versao, chaveEmbrulhada: nova.chaveEmbrulhada, mestraRef: nova.mestraRef });
  if (gravada) {
    chaves.lembrar({ tenantId, versao, chaveEmbrulhada: nova.chaveEmbrulhada }, nova.chave);
    return { versao, chave: nova.chave };
  }
  // Corrida: outra transação gravou primeiro (o ON CONFLICT esperou o commit dela). A nossa nunca foi usada.
  zerar(nova.chave);
  const vencedora = await deps.repos.cofre.chaveAtivaDoTenant();
  if (!vencedora) throw new FalhaDoCofre("chave_do_tenant_ausente");
  return { versao: vencedora.versao, chave: await chaves.abrir({ tenantId, versao: vencedora.versao, chaveEmbrulhada: vencedora.chaveEmbrulhada }) };
}

function validarEntrada(e: EntradaGuardar): { tipo: TipoItemCofre; nome: string; app: string | null; publico: Record<string, unknown>; dono: DonoItemCofre; valor: string | null } {
  if (!TIPOS.includes(e.tipo) || !DONOS.includes(e.dono)) throw new ErroDeDominio("entrada_invalida");
  const nome = typeof e.nome === "string" ? e.nome.trim() : "";
  if (nome.length < 1 || nome.length > 200) throw new ErroDeDominio("entrada_invalida");
  const app = e.app == null ? null : e.app.trim();
  if (app !== null && (app.length < 1 || app.length > 120)) throw new ErroDeDominio("entrada_invalida");
  const publico = e.publico ?? {};
  if (typeof publico !== "object" || publico === null || Array.isArray(publico) || Buffer.byteLength(JSON.stringify(publico)) > MAX_BYTES_PUBLICO) {
    throw new ErroDeDominio("entrada_invalida");
  }
  if (e.tipo === "cartao") {
    if (e.valor != null) throw new ErroDeDominio("entrada_invalida", { cause: "cartão não guarda valor no servidor" });
    return { tipo: e.tipo, nome, app, publico, dono: e.dono, valor: null };
  }
  if (typeof e.valor !== "string" || e.valor.length === 0 || Buffer.byteLength(e.valor) > MAX_BYTES_VALOR) throw new ErroDeDominio("entrada_invalida");
  return { tipo: e.tipo, nome, app, publico, dono: e.dono, valor: e.valor };
}

/**
 * Guarda um item. Já existe um vivo com o mesmo (dono, tipo, nome): a versão anterior é revogada e a nova (versão + 1)
 * grava na MESMA transação, com o evento 'trocado'; senão 'guardado'. O item do time só é trocado por quem o guardou
 * (a RLS dá UPDATE só à dona): para os outros, `nao_permitido`.
 */
export async function guardarItem(deps: DepsDoCofre, chaves: ChavesDoTenant, entrada: EntradaGuardar): Promise<{ item: ItemDoCofre; anterior: ItemDoCofre | null }> {
  const e = validarEntrada(entrada);
  const agora = deps.agora();
  const anterior = await deps.repos.cofre.itemVivo({ tipo: e.tipo, nome: e.nome, dono: e.dono });
  if (anterior && anterior.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
  // O UPDATE trava a linha; zero linhas = outra troca revogou entre a leitura e aqui.
  if (anterior && !(await deps.repos.cofre.revogarItem(anterior.id, agora))) throw new ErroDeDominio("mudou_depois");
  const id = randomUUID();
  const versao = (anterior?.versao ?? 0) + 1;
  let cifra: CifraDoItem | null = null;
  if (e.valor !== null) {
    const tenant = await chaveAtivaDoTenant(deps, chaves);
    const chaveItem = gerarChave();
    try {
      const lugar = { tenantId: deps.escopo.tenantId, itemId: id, versao };
      cifra = {
        valorCifrado: cifrarValor(e.valor, chaveItem, lugar, tenant.versao),
        chaveItemEmbrulhada: embrulharChaveDoItem(chaveItem, tenant.chave, lugar, tenant.versao),
        chaveTenantVersao: tenant.versao,
      };
    } finally {
      zerar(chaveItem, tenant.chave);
    }
  }
  const item = await deps.repos.cofre.inserirItem({ id, tipo: e.tipo, nome: e.nome, app: e.app, publico: e.publico, dono: e.dono, versao, cifra, agora });
  // Entrega 3: quem podia usar a versão anterior continua podendo, no mesmo modo (a versão nova tem outro id).
  if (anterior) await deps.repos.cofre.copiarConcessoes(anterior.id, item.id);
  await deps.repos.cofre.gravarEvento({
    itemId: id,
    tipo: anterior ? "trocado" : "guardado",
    detalhe: { ...entrada.detalheDoEvento, ...(anterior ? { versao, anterior: anterior.id } : { versao }) },
    doTime: e.dono === "time",
    agora,
  });
  return { item, anterior };
}

/**
 * SÓ PARA USO INTERNO DO SERVIDOR: decifra o valor de um item vivo para entregá-lo (a Entrega 2 sela para o motor; a
 * concessão ao bot também é conferida lá, não aqui). Marca o uso e grava 'entregue' (sem o valor). Cartão não tem
 * valor no servidor: `estado_invalido`.
 *
 * Entrega 3: quem lê a cada chamada de um app (o provedor da Orgo lê a chave em toda requisição) passa `onde` e registra o
 * uso no máximo a cada INTERVALO_DO_USO_MS por item — o "usada há 3 min" do C1 não precisa de uma escrita por requisição.
 */
export const INTERVALO_DO_USO_MS = 5 * 60_000;

export async function lerValorParaEntrega(deps: DepsDoCofre, chaves: ChavesDoTenant, p: { itemId: string; agenteId?: string | null; turnoId?: string | null; onde?: string; espacarUso?: boolean }): Promise<{ item: ItemDoCofre; valor: string }> {
  const achado = await deps.repos.cofre.itemParaEntrega(p.itemId);
  if (!achado) throw new ErroDeDominio("nao_encontrado");
  if (!achado.cifra) throw new ErroDeDominio("estado_invalido");
  const tenantId = deps.escopo.tenantId;
  const linha = await deps.repos.cofre.chaveDoTenant(achado.cifra.chaveTenantVersao);
  if (!linha) throw new FalhaDoCofre("chave_do_tenant_ausente");
  const chaveTenant = await chaves.abrir({ tenantId, versao: linha.versao, chaveEmbrulhada: linha.chaveEmbrulhada });
  let chaveItem: Buffer | null = null;
  let valor: string;
  try {
    const lugar = { tenantId, itemId: achado.item.id, versao: achado.item.versao };
    chaveItem = desembrulharChaveDoItem(achado.cifra.chaveItemEmbrulhada, chaveTenant, lugar, linha.versao);
    valor = decifrarValor(achado.cifra.valorCifrado, chaveItem, lugar);
  } finally {
    zerar(chaveItem, chaveTenant);
  }
  const agora = deps.agora();
  const recente = p.espacarUso === true && achado.item.ultimoUsoEm !== null && agora - achado.item.ultimoUsoEm < INTERVALO_DO_USO_MS;
  if (recente) return { item: achado.item, valor };
  await deps.repos.cofre.marcarUso(achado.item.id, agora);
  await deps.repos.cofre.gravarEvento({
    itemId: achado.item.id,
    agenteId: p.agenteId ?? null,
    tipo: "entregue",
    detalhe: { versao: achado.item.versao, ...(p.turnoId ? { turnoId: p.turnoId } : {}), ...(p.onde ? { onde: p.onde } : {}) },
    doTime: achado.item.dono === "time",
    agora,
  });
  return { item: achado.item, valor };
}

/** Revoga o item (só quem o guardou). Não existe, já revogado ou de outra pessoa: `nao_encontrado`. */
export async function revogarItem(deps: DepsDoCofre, p: { itemId: string }): Promise<ItemDoCofre> {
  const agora = deps.agora();
  if (!(await deps.repos.cofre.revogarItem(p.itemId, agora))) throw new ErroDeDominio("nao_encontrado");
  const item = await deps.repos.cofre.buscarItem(p.itemId);
  if (!item) throw new ErroDeDominio("nao_encontrado");
  await deps.repos.cofre.gravarEvento({ itemId: item.id, tipo: "revogado", detalhe: { versao: item.versao }, doTime: item.dono === "time", agora });
  return item;
}

/** Os itens vivos que a pessoa vê (os dela e os do time). Nunca valor nem cifra. */
export async function listarItens(deps: DepsDoCofre): Promise<ItemDoCofre[]> {
  return deps.repos.cofre.listarItens();
}

/**
 * Reembrulha as chaves do tenant do escopo pela mestra `nova` (ADR-195 §2, "trocar a chave mestra"). Os itens não são
 * tocados. Cada chave é aberta pela `atual`, embrulhada pela `nova` e CONFERIDA (aberta de novo pela `nova` e comparada)
 * antes de gravar; uma que não confere falha sem gravar. Devolve quantas versões foram reembrulhadas.
 */
export async function reembrulharChavesDoTenant(deps: DepsDoCofre, p: { atual: ChaveMestra; nova: ChaveMestra }): Promise<number> {
  const tenantId = deps.escopo.tenantId;
  let n = 0;
  for (const linha of await deps.repos.cofre.chavesDoTenant()) {
    const aad = aadDaChaveDoTenant(tenantId, linha.versao);
    const chave = await p.atual.desembrulhar(linha.chaveEmbrulhada, aad);
    let conferida: Buffer | null = null;
    try {
      const novo = await p.nova.embrulhar(chave, aad);
      conferida = await p.nova.desembrulhar(novo.embrulhada, aad);
      if (conferida.length !== chave.length || !timingSafeEqual(conferida, chave)) throw new FalhaDoCofre("cifra_invalida");
      const agora = deps.agora();
      if (!(await deps.repos.cofre.reembrulharChaveDoTenant(linha.versao, { chaveEmbrulhada: novo.embrulhada, mestraRef: novo.mestraRef }, agora))) {
        throw new FalhaDoCofre("chave_do_tenant_ausente");
      }
      await deps.repos.cofre.gravarEvento({ itemId: null, tipo: "reembrulhado", detalhe: { versao: linha.versao }, doTime: true, agora });
      n++;
    } finally {
      zerar(chave, conferida);
    }
  }
  return n;
}

export type ResultadoReembrulho = { tenantId: string; versoes: number } | { tenantId: string; falha: string };

/**
 * `reembrulharTenants`: um tenant por vez, cada um na própria transação aberta por `dentro` no escopo de uma pessoa do
 * tenant (a policy nod_equipe_update deixa qualquer pessoa do tenant reembrulhar). Um tenant que falha não para os
 * outros; a falha volta como código, nunca como mensagem. Quem chama (o roteiro da rotação, a escrever com a Entrega 2)
 * só desliga a versão antiga da mestra quando nenhum resultado tem `falha`.
 */
export async function reembrulharTenants(p: {
  escopos: readonly Escopo[];
  dentro: <T>(escopo: Escopo, fn: (deps: DepsDoCofre) => Promise<T>) => Promise<T>;
  atual: ChaveMestra;
  nova: ChaveMestra;
}): Promise<ResultadoReembrulho[]> {
  const vistos = new Set<string>();
  const resultados: ResultadoReembrulho[] = [];
  for (const escopo of p.escopos) {
    if (vistos.has(escopo.tenantId)) continue;
    vistos.add(escopo.tenantId);
    try {
      const versoes = await p.dentro(escopo, (deps) => reembrulharChavesDoTenant(deps, { atual: p.atual, nova: p.nova }));
      resultados.push({ tenantId: escopo.tenantId, versoes });
    } catch (e) {
      resultados.push({ tenantId: escopo.tenantId, falha: e instanceof FalhaDoCofre ? e.motivo : e instanceof ErroDeDominio ? e.codigo : "desconhecido" });
    }
  }
  return resultados;
}
