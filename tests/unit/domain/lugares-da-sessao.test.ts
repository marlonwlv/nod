import { describe, expect, it } from "vitest";
import { avisoDosLugares, lerMarcaDosLugares, lugaresQueMelhoraram, lugaresRecusadosSemTentar, marcaDosLugares, type EstadoDoLugar, type LugaresDoTurno } from "../../../src/domain/lugares-da-sessao.ts";

const l = (computador: EstadoDoLugar, navegador: "ausente" | "no_plano" = "ausente", seuComputador: "ausente" | "no_plano" = "ausente"): LugaresDoTurno => ({ computador, navegador, seuComputador });

describe("ADR-198: os lugares da sessão", () => {
  it("a marca vai e volta, e texto que não se entende é 'não se sabe'", () => {
    const x = l("fora_do_ar", "no_plano", "no_plano");
    expect(marcaDosLugares(x)).toBe("computador=fora_do_ar;navegador=no_plano;seuComputador=no_plano");
    expect(lerMarcaDosLugares(marcaDosLugares(x))).toEqual(x);
    for (const ruim of [null, undefined, "", "computador=quebrado;navegador=no_plano;seuComputador=ausente", "navegador=no_plano", "computador=no_plano;navegador=fora_do_ar;seuComputador=ausente"]) expect(lerMarcaDosLugares(ruim)).toBeNull();
  });

  it("sem marca anterior, nada melhorou", () => {
    expect(lugaresQueMelhoraram(null, l("no_plano", "no_plano"))).toEqual([]);
  });

  it("lugar que entra larga a sessão, de qualquer estado anterior", () => {
    for (const antes of ["ausente", "desligado", "fora_do_ar"] as const) expect(lugaresQueMelhoraram(l(antes), l("no_plano"))).toEqual([{ lugar: "computador", mudanca: "entrou" }]);
    expect(lugaresQueMelhoraram(l("ausente"), l("ausente", "no_plano"))).toEqual([{ lugar: "navegador", mudanca: "entrou" }]);
    expect(lugaresQueMelhoraram(l("fora_do_ar"), l("no_plano", "no_plano"))).toEqual([{ lugar: "computador", mudanca: "entrou" }, { lugar: "navegador", mudanca: "entrou" }]);
  });

  it("aviso que some sem o lugar entrar também larga", () => {
    expect(lugaresQueMelhoraram(l("fora_do_ar", "no_plano"), l("ausente", "no_plano"))).toEqual([{ lugar: "computador", mudanca: "aviso_saiu" }]);
    expect(lugaresQueMelhoraram(l("desligado"), l("ausente"))).toEqual([{ lugar: "computador", mudanca: "aviso_saiu" }]);
  });

  it("lugar que sai, aviso que entra ou troca de aviso não largam nada", () => {
    expect(lugaresQueMelhoraram(l("no_plano", "no_plano"), l("fora_do_ar", "ausente"))).toEqual([]);
    expect(lugaresQueMelhoraram(l("no_plano"), l("desligado"))).toEqual([]);
    expect(lugaresQueMelhoraram(l("ausente"), l("fora_do_ar"))).toEqual([]);
    expect(lugaresQueMelhoraram(l("fora_do_ar"), l("desligado"))).toEqual([]);
    expect(lugaresQueMelhoraram(l("no_plano", "no_plano"), l("no_plano", "no_plano"))).toEqual([]);
  });

  it("o computador da pessoa fica na marca e não dispara a regra", () => {
    expect(lugaresQueMelhoraram(l("ausente", "no_plano", "ausente"), l("ausente", "no_plano", "no_plano"))).toEqual([]);
  });

  it("o aviso fala só do que está no turno e manda conferir pela ferramenta", () => {
    expect(avisoDosLugares([], l("no_plano"))).toBeNull();
    const entrou = avisoDosLugares([{ lugar: "computador", mudanca: "entrou" }, { lugar: "navegador", mudanca: "entrou" }], l("no_plano", "no_plano"))!;
    expect(entrou).toContain("Agora você tem o seu computador (computador_*) e o seu navegador (navegador_*) neste turno.");
    expect(entrou).toContain("quem diz se um lugar funciona é a ferramenta deste turno");
    expect(avisoDosLugares([{ lugar: "computador", mudanca: "aviso_saiu" }], l("ausente", "no_plano"))).toContain("neste turno você tem o seu navegador (navegador_*).");
    expect(avisoDosLugares([{ lugar: "computador", mudanca: "aviso_saiu" }], l("ausente"))).toContain("O aviso de indisponibilidade de antes saiu. O que o histórico");
  });
});

describe("ADR-198: o alarme da recusa sem tentativa", () => {
  const comNavegador = l("ausente", "no_plano");

  it("conta a fala que diz 'indisponível' com o lugar no plano e nenhuma chamada a ele", () => {
    expect(lugaresRecusadosSemTentar({ texto: "Recebi o link, mas o navegador/web continua indisponível nesta sessão. Por isso, não consegui abrir a página.", chamadas: [], lugares: comNavegador })).toEqual(["navegador"]);
    expect(lugaresRecusadosSemTentar({ texto: "O computador está fora do ar agora.", chamadas: ["mcp__nod__lembrar"], lugares: l("no_plano") })).toEqual(["computador"]);
    expect(lugaresRecusadosSemTentar({ texto: "Não consigo abrir o site por aqui.", chamadas: [], lugares: comNavegador })).toEqual(["navegador"]);
  });

  it("conta a recusa que culpa o computador ou a máquina com o navegador no plano (as falas da sonda de 2026-11-27)", () => {
    // O Codex, na sessão retomada, não disse "navegador indisponível": disse que a máquina estava desligada.
    const foraDoAr: LugaresDoTurno = { computador: "fora_do_ar", navegador: "no_plano", seuComputador: "ausente" };
    expect(lugaresRecusadosSemTentar({ texto: "Vou tentar abrir example.com em uma aba real agora. Ainda não consigo: a máquina está desligada, então uma aba real não pode ser aberta.", chamadas: ["mcp__nod__gerir_maquinas"], lugares: foraDoAr })).toEqual(["navegador"]);
    expect(lugaresRecusadosSemTentar({ texto: "Bom dia! Ainda não: não há nenhuma máquina conectada ao Computador, então não consigo abrir uma aba real nem verificar o título.", chamadas: ["mcp__nod__gerir_maquinas"], lugares: comNavegador })).toEqual(["navegador"]);
    expect(lugaresRecusadosSemTentar({ texto: "Ainda não consigo: a máquina está desligada, então uma aba real não pode ser aberta.", chamadas: ["mcp__nod__navegador_abrir"], lugares: foraDoAr })).toEqual([]);
    expect(lugaresRecusadosSemTentar({ texto: "Não consigo confirmar o valor sem a planilha.", chamadas: [], lugares: comNavegador })).toEqual([]);
  });

  it("não conta quando o bot chamou o lugar, quando o lugar não está no plano ou quando a fala é sobre outra coisa", () => {
    expect(lugaresRecusadosSemTentar({ texto: "O site está fora do ar: a página devolveu erro 503.", chamadas: ["mcp__nod__navegador_abrir"], lugares: comNavegador })).toEqual([]);
    expect(lugaresRecusadosSemTentar({ texto: "O navegador está indisponível.", chamadas: [], lugares: l("ausente", "ausente") })).toEqual([]);
    expect(lugaresRecusadosSemTentar({ texto: "A planilha está indisponível. Abri o site e o título é Exemplo.", chamadas: [], lugares: comNavegador })).toEqual([]);
    expect(lugaresRecusadosSemTentar({ texto: "A palavra-código é abacaxi-42.", chamadas: [], lugares: comNavegador })).toEqual([]);
    expect(lugaresRecusadosSemTentar({ texto: "O navegador está indisponível.", chamadas: [], lugares: null })).toEqual([]);
  });
});
