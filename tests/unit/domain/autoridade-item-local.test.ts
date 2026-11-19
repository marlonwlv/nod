import { describe, expect, it } from "vitest";
import type { Decisao, DesfechoDecisao } from "../../../src/contracts/decisao.ts";
import type { ItemAprovacao } from "../../../src/contracts/item-aprovacao.ts";
import { REGRA_APROVACAO_PERMANENTE, REGRA_CONSULTA_SEM_DECISAO } from "../../../src/domain/aprovacao-permanente.ts";
import { desfechoAutorizaItemLocal, REGRAS_QUE_AUTORIZAM_ITEM_LOCAL } from "../../../src/domain/autoridade-item-local.ts";
import { REGRA_MODO_AUTOMATICO, REGRA_MODO_TOTAL, REGRA_REVISOR } from "../../../src/domain/modo-aprovacao.ts";
import { REGRA_TRABALHO_PARADO } from "../../../src/use-cases/trabalhos.ts";
import { REGRAS_GRAVADAS_NA_AUTORIZACAO } from "../../../src/use-cases/trilha-decisoes.ts";
import { criarBancoMemoria } from "../../helpers/repos-memoria.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";

const EM = "2026-11-14T00:00:00.000Z";
const porRegra = (regra: `regra:${string}`): DesfechoDecisao => ({ tipo: "decidida_por_regra", regra, regraVersao: 1, em: EM });

// NOD-423: a matriz da autoridade do item local. Sim: a pessoa e as cinco regras de lote. Não: o resto, inclusive regra nova.
const MATRIZ: [string, DesfechoDecisao | null, boolean][] = [
  ["pessoa aprovou", { tipo: "decidida", por: PESSOA_MARLON, em: EM }, true],
  ...[REGRA_CONSULTA_SEM_DECISAO, REGRA_APROVACAO_PERMANENTE, REGRA_MODO_AUTOMATICO, REGRA_MODO_TOTAL, REGRA_REVISOR].map((r) => [r, porRegra(r), true] as [string, DesfechoDecisao, boolean]),
  ["Parar do trabalho", porRegra(REGRA_TRABALHO_PARADO), false],
  ["regra desconhecida", porRegra("regra:inventada_amanha"), false],
  ["dispensada (×)", { tipo: "dispensada", por: PESSOA_MARLON, em: EM, antes: "vencida" }, false],
  ["expirou sem ninguém ver", { tipo: "expirou_sem_ninguem_ver", em: EM }, false],
  ["expirou com alguém ciente", { tipo: "expirou_com_alguem_ciente", em: EM }, false],
  ["sem desfecho", null, false],
];

describe("autoridade do item local (NOD-423)", () => {
  for (const [nome, desfecho, sai] of MATRIZ) {
    it(`${nome}: ${sai ? "libera" : "não libera"} o item do Mac`, () => {
      expect(desfechoAutorizaItemLocal(desfecho)).toBe(sai);
    });
  }

  it("as regras que gravam na autorização são exatamente as que autorizam o item (uma fonte só)", () => {
    expect([...REGRAS_GRAVADAS_NA_AUTORIZACAO].sort()).toEqual([...REGRAS_QUE_AUTORIZAM_ITEM_LOCAL].sort());
    expect(REGRAS_QUE_AUTORIZAM_ITEM_LOCAL).toHaveLength(5);
  });

  // O fake (repos-memoria) segue a mesma matriz que o SQL de itens-aprovacao.repo (provado no Postgres em github-conector).
  it("o repositório em memória entrega só os itens com autoridade, na mesma matriz", async () => {
    const { banco, repos } = criarBancoMemoria();
    const esperados: string[] = [];
    MATRIZ.forEach(([, desfecho, sai], n) => {
      const decisaoId = `d${n}`;
      banco.decisoes.push({ tenantId: TENANT_PADRAO, id: decisaoId, ownerId: PESSOA_MARLON, decisorId: PESSOA_MARLON, estado: "decidida", desfecho, decididaEm: 0 } as unknown as Decisao & { decididaEm: number | null });
      banco.itens.push({ tenantId: TENANT_PADRAO, id: `i${n}`, decisaoId, idx: 0, selecionado: true, desfecho: null, destino: { conector: "github", ferramenta: "pr_comentar", argumentos: {}, execucao: "maquina" } } as unknown as ItemAprovacao);
      if (sai) esperados.push(`i${n}`);
    });
    expect((await repos().itensAprovacao.pendentesNaMaquina()).map((p) => p.item.id).sort()).toEqual(esperados.sort());
  });
});
