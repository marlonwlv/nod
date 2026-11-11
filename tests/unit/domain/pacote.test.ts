import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { InstalacaoPacote, PacoteNod } from "../../../src/contracts/pacote.ts";
import { TETO_TELA_BYTES } from "../../../src/contracts/pacote.ts";
import { bytesUtf8, canonico, compararVersoes, decidirAtualizacao, hashPacote, lerPacote, permissoesEfetivas } from "../../../src/domain/pacote.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const appTerceiro = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  formato: 1, tipo: "app", slug: "maria/vagas", nome: "Vagas", descricao: "Lista de vagas.", autor: { nome: "Maria" },
  versao: "1.0.0", nodMinimo: "1.0.0", preco: { modelo: "gratis" },
  permissoes: [{ id: "quadro.ler", motivo: "Ler as tarefas." }], apps_conectados: [], ferramentas: [],
  telas: [{ id: "inicio", titulo: "Início", html: "<p>oi</p>" }], ...extra,
});

const ok = (b: unknown): PacoteNod => {
  const r = lerPacote(b);
  if (!r.ok) throw new Error(JSON.stringify(r.problemas));
  return r.pacote;
};
const problemas = (b: unknown): string[] => {
  const r = lerPacote(b);
  return r.ok ? [] : r.problemas.map((p) => `${p.caminho}: ${p.motivo}`);
};
const tem = (b: unknown, caminho: string, trecho: string) =>
  expect(problemas(b).some((p) => p.startsWith(`${caminho}:`) && p.includes(trecho)), problemas(b).join("\n")).toBe(true);

describe("lerPacote", () => {
  it("aceita um app de terceiro mínimo", () => {
    const p = ok(appTerceiro());
    expect(p.slug).toBe("maria/vagas");
    expect(p.telas).toHaveLength(1);
  });

  it("rejeita o que não é objeto e formato desconhecido", () => {
    expect(problemas("x")).toEqual([": o pacote é um objeto JSON"]);
    tem(appTerceiro({ formato: 2 }), "formato", "formato desconhecido");
  });

  it("rejeita campo desconhecido em qualquer nível", () => {
    tem(appTerceiro({ extra: 1 }), "extra", "campo desconhecido");
    tem(appTerceiro({ autor: { nome: "M", site: "x" } }), "autor.site", "campo desconhecido");
  });

  it("rejeita credencial embutida, até num app conectado", () => {
    tem(appTerceiro({ api_key: "sk-1" }), "api_key", "credencial");
    tem(appTerceiro({ apps_conectados: [{ slug: "slack", nivel: "ler", motivo: "x", token: "xoxb" }] }), "apps_conectados[0].token", "credencial");
  });

  it("memória, conversas e máquina nunca viajam", () => {
    const bot = { nome: "Ana", titulo: "", descricao: "Ajuda.", instrucoes: "", rotinas: [], memoria: ["x"] };
    tem({ ...appTerceiro(), tipo: "bot", telas: undefined, bot }, "bot.memoria", "nunca viajam");
  });

  it("slug precisa de autor/nome e o autor nod é reservado", () => {
    tem(appTerceiro({ slug: "vagas" }), "slug", "autor/nome");
    tem(appTerceiro({ slug: "Maria/Vagas" }), "slug", "autor/nome");
    tem(appTerceiro({ slug: "nod/vagas" }), "slug", "reservado");
  });

  it("só o nod faz pacote nativo, e nativo não traz telas", () => {
    tem(appTerceiro({ nativo: true }), "nativo", "só os pacotes do próprio nod");
    tem(appTerceiro({ slug: "nod/x", nativo: true, telas: [{ id: "a", titulo: "A", html: "<p/>" }] }), "telas", "só no app de terceiro");
  });

  it("terceiro não traz ferramenta do chat", () => {
    tem(appTerceiro({ ferramentas: ["gerir_vagas"] }), "ferramentas", "código do servidor");
  });

  it("semver na versão e no nodMinimo", () => {
    tem(appTerceiro({ versao: "1.0" }), "versao", "semver");
    tem(appTerceiro({ nodMinimo: "v1.0.0" }), "nodMinimo", "semver");
  });

  it("permissão fora do vocabulário é rejeitada; a do próprio app vale", () => {
    tem(appTerceiro({ permissoes: [{ id: "conta.apagar", motivo: "x" }] }), "permissoes[0].id", "desconhecida");
    tem(appTerceiro({ permissoes: [{ id: "canvas.ver_comentar", motivo: "x" }] }), "permissoes[0].id", "desconhecida");
    expect(ok(appTerceiro({ permissoes: [{ id: "vagas.editar", motivo: "x" }] })).permissoes[0]?.id).toBe("vagas.editar");
    tem(appTerceiro({ permissoes: [{ id: "quadro.ler", motivo: "a" }, { id: "quadro.ler", motivo: "b" }] }), "permissoes[1].id", "repetida");
  });

  it("implica só aponta para outra permissão do próprio app já pedida", () => {
    tem(appTerceiro({ permissoes: [{ id: "vagas.editar", motivo: "x", implica: ["quadro.escrever"] }] }), "permissoes[0].implica", "do próprio app");
  });

  it("preço: centavos positivos, moeda e período", () => {
    tem(appTerceiro({ preco: { modelo: "unico", centavos: -1, moeda: "BRL" } }), "preco.centavos", "positivo");
    tem(appTerceiro({ preco: { modelo: "unico", centavos: 990, moeda: "XYZ" } }), "preco.moeda", "uma de");
    tem(appTerceiro({ preco: { modelo: "assinatura", centavos: 990, moeda: "BRL" } }), "preco.periodo", "um de");
    expect(ok(appTerceiro({ preco: { modelo: "assinatura", centavos: 990, moeda: "BRL", periodo: "mes" } })).preco).toEqual({ modelo: "assinatura", centavos: 990, moeda: "BRL", periodo: "mes" });
  });

  it("tela acima de 2 MB e app de terceiro sem tela", () => {
    tem(appTerceiro({ telas: [{ id: "a", titulo: "A", html: "x".repeat(TETO_TELA_BYTES + 1) }] }), "telas[0].html", "MB");
    tem(appTerceiro({ telas: [] }), "telas", "pelo menos uma tela");
  });

  it("time: bots com nome único e seções só com bots do time", () => {
    const bot = (nome: string) => ({ nome, titulo: "", descricao: "Faz.", instrucoes: "", rotinas: [] });
    const base = { ...appTerceiro(), tipo: "time", telas: undefined };
    expect(ok({ ...base, time: { bots: [bot("Ana"), bot("Bia")], secoes: [{ nome: "Produto", bots: ["Ana"] }] } }).time?.bots).toHaveLength(2);
    tem({ ...base, time: { bots: [bot("Ana"), bot("ana")], secoes: [] } }, "time.bots[1].nome", "repetido");
    tem({ ...base, time: { bots: [bot("Ana")], secoes: [{ nome: "X", bots: ["Zé"] }] } }, "time.secoes[0].bots", "não é um bot do time");
  });

  it("devolve todos os problemas de uma vez", () => {
    expect(problemas(appTerceiro({ slug: "x", versao: "1", extra: 1 })).length).toBeGreaterThanOrEqual(3);
  });
});

describe("canonico, hash e bytes", () => {
  it("a ordem das chaves não muda o hash", () => {
    const a = ok(appTerceiro());
    const b = ok(Object.fromEntries(Object.entries(appTerceiro()).reverse()));
    expect(canonico(a)).toBe(canonico(b));
    expect(hashPacote(a, sha)).toBe(hashPacote(b, sha));
  });
  it("conta bytes UTF-8", () => {
    expect(bytesUtf8("aé€😀")).toBe(1 + 2 + 3 + 4);
  });
});

describe("compararVersoes", () => {
  it("segue o semver, com pré-lançamento antes", () => {
    expect(compararVersoes("1.0.0", "1.0.1")).toBeLessThan(0);
    expect(compararVersoes("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compararVersoes("1.0.0-rc.7", "1.0.0")).toBeLessThan(0);
    expect(compararVersoes("1.0.0-rc.10", "1.0.0-rc.7")).toBeGreaterThan(0);
    expect(compararVersoes("1.0.0-rc", "1.0.0-rc.1")).toBeLessThan(0);
    expect(compararVersoes("2.0.0", "2.0.0")).toBe(0);
    expect(() => compararVersoes("x", "1.0.0")).toThrow();
  });
});

describe("decidirAtualizacao", () => {
  const v1 = ok(appTerceiro());
  const inst = (p: PacoteNod = v1): InstalacaoPacote => ({ slug: p.slug, versao: p.versao, hash: hashPacote(p, sha), permissoes: permissoesEfetivas(p), preco: p.preco });
  const decidir = (novo: PacoteNod, nod = "1.0.0") => decidirAtualizacao(inst(), novo, hashPacote(novo, sha), nod);

  it("mesmas permissões e minor: entra sozinha", () => {
    expect(decidir(ok(appTerceiro({ versao: "1.1.0" })))).toEqual({ decisao: "automatica", de: "1.0.0", para: "1.1.0" });
  });
  it("menos permissões também entra sozinha", () => {
    expect(decidir(ok(appTerceiro({ versao: "1.1.0", permissoes: [] }))).decisao).toBe("automatica");
  });
  it("permissão nova pede consentimento e diz qual", () => {
    const r = decidir(ok(appTerceiro({ versao: "1.1.0", permissoes: [{ id: "quadro.escrever", motivo: "x" }] })));
    expect(r).toMatchObject({ decisao: "pede_consentimento", novas: ["quadro.escrever"] });
  });
  it("app conectado novo é permissão nova; escrever cobre ler", () => {
    const r = decidir(ok(appTerceiro({ versao: "1.1.0", apps_conectados: [{ slug: "slack", nivel: "escrever", motivo: "x" }] })));
    expect(r).toMatchObject({ decisao: "pede_consentimento", novas: ["conector:slack:escrever", "conector:slack:ler"] });
  });
  it("trocar quadro.ler por quadro.escrever amplia (não é só renomear)", () => {
    const r = decidir(ok(appTerceiro({ versao: "1.1.0", permissoes: [{ id: "quadro.escrever", motivo: "x" }] })));
    expect(r.decisao).toBe("pede_consentimento");
  });
  it("major pede consentimento mesmo sem permissão nova", () => {
    expect(decidir(ok(appTerceiro({ versao: "2.0.0" })))).toMatchObject({ decisao: "pede_consentimento", motivos: ["é uma versão major"] });
  });
  it("passar a ser pago ou subir o preço pede consentimento; baixar não", () => {
    expect(decidir(ok(appTerceiro({ versao: "1.1.0", preco: { modelo: "unico", centavos: 100, moeda: "BRL" } })))).toMatchObject({ motivos: ["passou a ser pago"] });
    const pago = ok(appTerceiro({ preco: { modelo: "unico", centavos: 500, moeda: "BRL" } }));
    const base = inst(pago);
    const mais = ok(appTerceiro({ versao: "1.1.0", preco: { modelo: "unico", centavos: 900, moeda: "BRL" } }));
    const menos = ok(appTerceiro({ versao: "1.1.0", preco: { modelo: "unico", centavos: 100, moeda: "BRL" } }));
    expect(decidirAtualizacao(base, mais, hashPacote(mais, sha), "1.0.0")).toMatchObject({ motivos: ["o preço subiu"] });
    expect(decidirAtualizacao(base, menos, hashPacote(menos, sha), "1.0.0").decisao).toBe("automatica");
  });
  it("downgrade, outro slug, nod velho e mesma versão alterada ficam bloqueados", () => {
    const v2 = ok(appTerceiro({ versao: "2.0.0" }));
    expect(decidirAtualizacao(inst(v2), v1, hashPacote(v1, sha), "1.0.0")).toMatchObject({ decisao: "bloqueada", motivo: expect.stringContaining("mais velha") });
    expect(decidir(ok(appTerceiro({ slug: "joao/vagas", versao: "1.1.0" })))).toMatchObject({ decisao: "bloqueada", motivo: expect.stringContaining("slug") });
    expect(decidir(ok(appTerceiro({ versao: "1.1.0", nodMinimo: "1.2.0" })))).toMatchObject({ decisao: "bloqueada", motivo: expect.stringContaining("1.2.0") });
    expect(decidir(ok(appTerceiro({ descricao: "outra" })))).toMatchObject({ decisao: "bloqueada", motivo: expect.stringContaining("mesma versão") });
  });
  it("mesma versão e mesmo conteúdo: nada a fazer", () => {
    expect(decidir(v1)).toEqual({ decisao: "igual" });
  });
});

describe("revisão ADA-283: escalada e DoS", () => {
  it("nativo só para os pacotes que o nod conhece, e só com as ferramentas deles", () => {
    tem(appTerceiro({ slug: "nod/qualquer", nativo: true, telas: undefined, ferramentas: ["gerir_canvas"] }), "nativo", "não é um app nativo deste nod");
    tem(appTerceiro({ slug: "nod/canvas", nativo: true, telas: undefined, permissoes: [], ferramentas: ["gerir_canvas", "executar_comando"] }), "ferramentas[1]", "não é ferramenta do nativo");
  });

  it("app de terceiro não usa o namespace da plataforma nem o nome de um app nativo", () => {
    tem(appTerceiro({ slug: "maria/quadro", permissoes: [{ id: "quadro.apagar", motivo: "x" }] }), "slug", "reservado");
    tem(appTerceiro({ slug: "maria/arquivos", permissoes: [{ id: "arquivos.escrever", motivo: "x" }] }), "slug", "reservado");
    tem(appTerceiro({ slug: "maria/canvas", permissoes: [{ id: "canvas.criar_publicar", motivo: "x" }] }), "slug", "reservado");
  });

  it("autor terceiro não se apresenta como o nod", () => {
    tem(appTerceiro({ autor: { nome: " NOD " } }), "autor.nome", "reservado");
  });

  it("aninhamento fundo vira problema, não estouro de pilha", () => {
    let fundo: unknown = 1;
    for (let i = 0; i < 200_000; i++) fundo = [fundo];
    expect(() => lerPacote(appTerceiro({ extra: fundo }))).not.toThrow();
    tem(appTerceiro({ extra: fundo }), "", "fundo demais");
  });

  it("pacote grande para de medir no teto (sem montar o texto inteiro)", () => {
    const telas = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, titulo: "T", html: "x".repeat(TETO_TELA_BYTES - 10) }));
    tem(appTerceiro({ telas }), "", "MB");
  });
});
