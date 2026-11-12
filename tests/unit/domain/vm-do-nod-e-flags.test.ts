import { describe, expect, it, vi } from "vitest";
import type { ProvedorNuvem } from "../../../src/contracts/provedor-nuvem.ts";
import { criarProvisionadorVmDoNod, tamanhoDoPlano, uuidDoPedido } from "../../../src/adapters/nuvem/vm-do-nod.ts";
import { criarFonteDeFlags } from "../../../src/adapters/flags/fonte-flags.ts";
import { configDoCanal, decidirAtualizacaoDoApp, lerConfigTesteDoApp } from "../../../src/domain/atualizacao-app.ts";
import { avaliarFlags, baldeDe, canalDasFlags, lerRegras } from "../../../src/domain/flags-remotas.ts";
import { nomeDaVmDoNod, opcoesOndeRoda, PLANOS_VM_DO_NOD_PADRAO, pedidoVmDoNod, planosDoEnv } from "../../../src/domain/vm-do-nod.ts";
import { secaoOndeRoda } from "../../../web/telas/onde-roda.ts";

const PESSOA = "99999999-8888-4777-8666-555555555555";
const TENANT = "11111111-0000-4000-8000-000000000001";
const CONFIG = { projeto: "nod-boxes-prod", zona: "us-central1-a", rede: "nod-rede" };

describe("onde o agente roda (ADR-169)", () => {
  it("três opções; a máquina da pessoa é o padrão; a VM do Nod desligada fica em teste fechado", () => {
    const o = opcoesOndeRoda([{ nome: "MacBook", plataforma: "darwin" }], { vmDoNodLigada: false, planos: PLANOS_VM_DO_NOD_PADRAO });
    expect(o.map((x) => x.id)).toEqual(["maquina_da_pessoa", "vm_da_pessoa", "vm_do_nod"]);
    expect(o[0]).toMatchObject({ padrao: true, emUso: true, disponivel: true });
    expect(o[1]).toMatchObject({ emUso: false });
    expect(o[2]).toMatchObject({ disponivel: false, motivo: "Em teste fechado." });
  });

  it("uma VM Linux pareada é 'Minha VM'; a nod-box- é a VM do Nod", () => {
    const o = opcoesOndeRoda([{ nome: "minha-vm", plataforma: "linux" }, { nome: `nod-box-${"a".repeat(20)}`, plataforma: "linux" }], { vmDoNodLigada: true, planos: PLANOS_VM_DO_NOD_PADRAO });
    expect(o.find((x) => x.id === "vm_da_pessoa")!.emUso).toBe(true);
    expect(o.find((x) => x.id === "vm_do_nod")!.emUso).toBe(true);
    expect(o.find((x) => x.id === "maquina_da_pessoa")!.emUso).toBe(false);
  });

  it("o pedido exige o aceite da cobrança, um plano conhecido e o projeto configurado", () => {
    const base = { tenantId: TENANT, pessoaId: PESSOA, planoId: "essencial", planos: PLANOS_VM_DO_NOD_PADRAO, config: CONFIG, aceitouCobranca: true };
    expect(() => pedidoVmDoNod({ ...base, aceitouCobranca: false })).toThrow(/nao_permitido/);
    expect(() => pedidoVmDoNod({ ...base, planoId: "ouro" })).toThrow(/entrada_invalida/);
    expect(() => pedidoVmDoNod({ ...base, config: { ...CONFIG, projeto: "X" } })).toThrow(/integracao_nao_configurada/);
    const p = pedidoVmDoNod(base);
    expect(p.ref).toEqual({ projeto: "nod-boxes-prod", zona: "us-central1-a", nome: nomeDaVmDoNod(PESSOA) });
    expect(p.subrede).toBe("projects/nod-boxes-prod/regions/us-central1/subnetworks/nod-rede");
    expect(p.ref.nome).toMatch(/^nod-box-[a-f0-9]{20}$/);
    expect(JSON.stringify(p)).not.toMatch(/@/);
  });

  it("planos do env: JSON torto ou plano inválido volta ao padrão", () => {
    expect(planosDoEnv("{x")).toEqual(PLANOS_VM_DO_NOD_PADRAO);
    expect(planosDoEnv(JSON.stringify([{ id: "pro", nome: "Pro", vcpu: 8, memoriaGb: 32, discoGb: 50, tipo: "e2-standard-8", precoMensalCentavos: 1, horasIncluidas: 1 }]))).toHaveLength(1);
    expect(planosDoEnv(JSON.stringify([{ id: "pro", tipo: "rm -rf" }]))).toEqual(PLANOS_VM_DO_NOD_PADRAO);
  });

  it("o driver seco nunca chama a nuvem; o gcp usa o ProvedorNuvem com requestId UUID estável", async () => {
    const pedido = pedidoVmDoNod({ tenantId: TENANT, pessoaId: PESSOA, planoId: "pro", planos: PLANOS_VM_DO_NOD_PADRAO, config: CONFIG, aceitouCobranca: true });
    const seco = await criarProvisionadorVmDoNod({ driver: "seco" }).provisionar(pedido);
    expect(seco.custoMensalCentavos).toBe(39_900);
    expect(seco.chamadas[0]).toContain("compute.instances.insert nod-boxes-prod/us-central1-a/");
    const provedor = { criar: vi.fn(async () => undefined), ligar: vi.fn(), desligar: vi.fn(), reiniciar: vi.fn(), excluir: vi.fn(), estado: vi.fn(async () => "rodando" as const), definirScript: vi.fn() } satisfies ProvedorNuvem;
    const gcp = criarProvisionadorVmDoNod({ driver: "gcp", provedor, startupScript: () => "#!/bin/sh" });
    await gcp.provisionar(pedido);
    await gcp.provisionar(pedido);
    const [a, b] = provedor.criar.mock.calls.map((c) => (c as unknown as [unknown, string])[1]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect((provedor.criar.mock.calls[0] as unknown as [{ tamanho: string }])[0].tamanho).toBe("padrao");
    expect(uuidDoPedido("x")).not.toBe(uuidDoPedido("y"));
    expect(() => tamanhoDoPlano("n2-highmem-96")).toThrow();
  });

  it("a seção da tela lista as três opções e os planos com preço", () => {
    const html = secaoOndeRoda({ opcoes: opcoesOndeRoda([], { vmDoNodLigada: true, planos: PLANOS_VM_DO_NOD_PADRAO }), vmDoNod: { ligada: true, driver: "seco" } });
    expect(html).toContain("Onde o agente roda");
    expect(html).toContain("Este computador");
    expect(html).toContain("Minha VM");
    expect(html).toContain("VM do Nod");
    expect(html).toContain("R$ 199,00/mês");
    expect(html).toContain("nada é criado nem cobrado");
    expect(secaoOndeRoda(null)).toBe("");
  });
});

describe("flags remotas (ADR-170)", () => {
  const ctx = { pessoaId: PESSOA, tenantId: TENANT, agora: Date.parse("2026-11-12T12:00:00Z") };

  it("sem regras, os padrões do catálogo; a primeira regra que casa ganha", () => {
    expect(avaliarFlags([], ctx)).toMatchObject({ "app.canal": "estavel", "web.telas_novas": false });
    const regras = lerRegras(JSON.stringify([
      { flag: "app.canal", valor: "teste", pessoas: [PESSOA.toUpperCase()] },
      { flag: "app.canal", valor: "estavel" },
      { flag: "web.telas_novas", valor: true, tenants: ["outro"] },
      { flag: "exp.algo", valor: 3 },
    ]));
    const f = avaliarFlags(regras, ctx);
    expect(f["app.canal"]).toBe("teste");
    expect(f["web.telas_novas"]).toBe(false);
    expect(f["exp.algo"]).toBe(3);
    expect(canalDasFlags(f)).toBe("teste");
  });

  it("tipo errado numa flag do catálogo e canal desconhecido não valem", () => {
    const f = avaliarFlags(lerRegras(JSON.stringify([{ flag: "web.telas_novas", valor: "true" }, { flag: "app.canal", valor: "nightly" }])), ctx);
    expect(f).toMatchObject({ "app.canal": "estavel", "web.telas_novas": false });
  });

  it("prazo vencido não vale; porcentagem é estável por pessoa", () => {
    expect(avaliarFlags(lerRegras(JSON.stringify([{ flag: "app.canal", valor: "teste", ate: "2026-11-01T00:00:00Z" }])), ctx)["app.canal"]).toBe("estavel");
    const b = baldeDe(PESSOA, "app.canal");
    expect(baldeDe(PESSOA, "app.canal")).toBe(b);
    expect(avaliarFlags([{ flag: "app.canal", valor: "teste", porcentagem: b + 1 }], ctx)["app.canal"]).toBe("teste");
    expect(avaliarFlags([{ flag: "app.canal", valor: "teste", porcentagem: b }], ctx)["app.canal"]).toBe("estavel");
  });

  it("regra inválida derruba o arquivo inteiro", () => {
    expect(() => lerRegras(JSON.stringify([{ flag: "Maiuscula", valor: 1 }]))).toThrow();
    expect(() => lerRegras("{")).toThrow();
  });

  it("a fonte relê o arquivo quando muda, sem reiniciar; arquivo inválido mantém a última válida", () => {
    let agora = 0;
    let conteudo = JSON.stringify([{ flag: "app.canal", valor: "teste" }]);
    let mtime = 1;
    const fonte = criarFonteDeFlags({ env: { NOD_FLAGS_ARQUIVO: "/etc/nod/flags.json" }, agora: () => agora, ler: () => conteudo, mtime: () => mtime });
    const escopo = { tenantId: TENANT, pessoaId: PESSOA };
    expect(fonte.avaliar(escopo)["app.canal"]).toBe("teste");
    conteudo = JSON.stringify([]); mtime = 2;
    expect(fonte.avaliar(escopo)["app.canal"]).toBe("teste"); // antes dos 5 s não confere
    agora += 5000;
    expect(fonte.avaliar(escopo)["app.canal"]).toBe("estavel");
    conteudo = "{torto"; mtime = 3; agora += 5000;
    expect(fonte.avaliar(escopo)["app.canal"]).toBe("estavel");
  });
});

describe("canal de teste do app (ADR-170)", () => {
  const SHA = `arm64=${"a".repeat(64)},x64=${"b".repeat(64)}`;
  const estavel = { versao: "1.0.0", bucket: "nod-app", sha256: { arm64: "a".repeat(64), x64: "b".repeat(64) } };

  it("quem está no teste recebe a de teste só se ela for mais nova; nunca volta de versão", () => {
    const teste = lerConfigTesteDoApp({ NOD_APP_VERSAO_TESTE: "1.1.0-rc.1", NOD_APP_ATUALIZACAO_BUCKET: "nod-app", NOD_APP_ATUALIZACAO_TESTE_SHA256: SHA });
    expect(configDoCanal(estavel, teste)!.versao).toBe("1.1.0-rc.1");
    expect(decidirAtualizacaoDoApp({ atual: "1.0.0", config: configDoCanal(estavel, teste), arch: "arm64" })).toMatchObject({ anunciar: true, versao: "1.1.0-rc.1" });
    const velha = lerConfigTesteDoApp({ NOD_APP_VERSAO_TESTE: "0.9.0", NOD_APP_ATUALIZACAO_BUCKET: "nod-app", NOD_APP_ATUALIZACAO_TESTE_SHA256: SHA });
    expect(configDoCanal(estavel, velha)!.versao).toBe("1.0.0");
    expect(lerConfigTesteDoApp({})).toBeNull();
  });
});
