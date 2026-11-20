import { describe, expect, it } from "vitest";
import type { LeituraDeMaquinaDto } from "../../../src/contracts/maquina.ts";
import type { TrabalhoDto, TrabalhosDto } from "../../../src/contracts/trabalho.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { leituraDoMac, pilulaDasMaquinas, situacaoDe, textoDaEspera } from "../../../web/lib/trabalhos.ts";
import { renderEsteMac, statusDoDisco, tempoAteAcabar } from "../../../web/telas/este-mac.ts";
import { leituraNoCartao } from "../../../web/telas/maquinas.ts";
import { renderTelaTarefas } from "../../../web/telas/tela-tarefas.ts";

// ADR-187 §8 (2026-11-18): "Todas as tarefas" virou a vista Por estado da tela Tarefas, com o chip Todas.
const renderTodosOsTrabalhos = (e: Estado, filtro: "todos" | "voce" | "rotinas" | "bots" = "todos"): string => renderTelaTarefas(e, { tipo: "trabalhos", filtro, mostrar: "todas" });

/**
 * A tela fala por máquina (definido em 2026-10-09): no diário de 09/10 os bots estavam presos à VM `nod-motor-teste`, a
 * VM estava cheia e o Mac folgado, e a tela dizia "Seu Mac está ocupado · 4 trabalhos esperam o Mac aliviar".
 */
const AGORA = new Date(2026, 9, 9, 10, 37).getTime();
const VM = { id: "vm-1", nome: "nod-motor-teste", ehMac: false };
const MAC = { id: "mac-1", nome: "Este Mac", ehMac: true };

const trabalho = (id: string, extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id, agenteId: "cla", conversaId: "c-cla", titulo: id, origem: "rotina", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "na_fila",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 600_000, iniciadoEm: null, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: null, esperandoComputadorDe: null, seguravel: true, ...extra,
});

const leitura = (m: typeof VM, extra: Partial<LeituraDeMaquinaDto> = {}): LeituraDeMaquinaDto => ({
  ...m, pressao: "verde", memoriaBotsMb: 0, processador: "verde", usoProcessador: 0.3, cargaProcessador: 0.4, fila: "verde", disco: null, discoSuportado: true, motivoEspera: null, seguraTudoNovo: false, ...extra,
});

function estadoCom(trabalhos: TrabalhoDto[], maquinas: LeituraDeMaquinaDto[], extra: Partial<TrabalhosDto> = {}): Estado {
  return {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    frota: { agentes: [{ id: "cla", nome: "Clarice", conversaId: "c-cla", cor: "c-red", forma: "shape-capsule", ownerId: "p", titulo: "", descricao: "", confirmado: true }] } as never,
    // Os campos de topo pelo pior, como o servidor manda: a VM cheia faz `segurando` verdadeiro.
    trabalhos: { trabalhos, pressao: "verde", memoriaTotalMb: 1100, processador: "vermelha", cargaProcessador: 2.8, segurando: true, motivoEspera: "processador", maquinas, ...extra },
  };
}

// Do servidor: as quatro rotinas da VM esperam por ela; a do Mac, não.
const daVm = (id: string) => trabalho(id, { esperaDoMac: "processador", maquina: VM });
const doMac = trabalho("Consultar o ClickUp", { esperaDoMac: null, maquina: MAC });
const vmCheia = leitura(VM, { processador: "vermelha", usoProcessador: 1, cargaProcessador: 2.8, fila: "vermelha", motivoEspera: "processador", memoriaBotsMb: 700, disco: { livreMb: 14_642, totalMb: 30_000, nivel: "verde", alertaMb: 10_240, criticoMb: 3_072 } });
const macFolgado = leitura(MAC, { memoriaBotsMb: 400 });

describe("a linha diz de qual máquina o trabalho espera", () => {
  it("a VM pelo nome; o Mac como antes", () => {
    expect(textoDaEspera("processador", VM)).toBe("esperando nod-motor-teste aliviar");
    expect(textoDaEspera("memoria", VM)).toBe("esperando nod-motor-teste liberar memória");
    expect(textoDaEspera("disco", VM)).toBe("esperando espaço no disco em nod-motor-teste");
    expect(textoDaEspera("processador", MAC)).toBe("esperando o Mac aliviar");
    expect(textoDaEspera("disco", null)).toBe("esperando espaço no disco");
  });

  it("o trabalho do Mac folgado fica 'na fila', mesmo com a VM segurando (o `segurando` do topo é o pior)", () => {
    expect(situacaoDe(daVm("Verificar o Slack"), [], true, AGORA)).toBe("esperando nod-motor-teste aliviar");
    expect(situacaoDe(doMac, [], true, AGORA)).toBe("na fila");
  });
});

describe("a pílula nomeia quem segura", () => {
  const fila = [daVm("Slack"), daVm("NOD-202"), daVm("ClickUp"), daVm("Varredura"), doMac];

  it("só a VM: 'nod-motor-teste está ocupada · 4 trabalhos esperam ela aliviar', com o Ver para Máquinas", () => {
    const p = pilulaDasMaquinas([vmCheia, macFolgado], fila);
    expect(p).toContain("<b>nod-motor-teste está ocupada</b>");
    expect(p).toContain("· 4 trabalhos esperam ela aliviar");
    expect(p).toContain('data-secao="maquinas"');
    expect(p).not.toContain("Seu Mac");
  });

  it("só o Mac: 'Seu Mac está ocupado', com o Ver para Este Mac, como antes", () => {
    const macCheio = leitura(MAC, { processador: "vermelha", motivoEspera: "processador" });
    const p = pilulaDasMaquinas([leitura(VM), macCheio], [trabalho("x", { esperaDoMac: "processador", maquina: MAC })]);
    expect(p).toContain("<b>Seu Mac está ocupado</b>");
    expect(p).toContain("1 trabalho espera o Mac aliviar");
    expect(p).toContain('data-secao="este-mac"');
  });

  it("as duas: '2 máquinas ocupadas'; o disco da VM e a memória dela pelo nome", () => {
    const macCheio = leitura(MAC, { motivoEspera: "processador" });
    expect(pilulaDasMaquinas([vmCheia, macCheio], fila)).toContain("<b>2 máquinas ocupadas</b>");
    expect(pilulaDasMaquinas([leitura(VM, { motivoEspera: "disco" })], [])).toContain("<b>Pouco espaço no disco em nod-motor-teste</b>");
    expect(pilulaDasMaquinas([leitura(VM, { motivoEspera: "memoria" })], [])).toContain("trabalho novo espera ela liberar memória");
    expect(pilulaDasMaquinas([leitura(VM), macFolgado], fila)).toBe("");
  });

  // ADR-187 §8 (2026-11-18): a tela Tarefas não repete o aviso da máquina (mora no selo da aba das tarefas) nem a memória
  // dos bots no topo; a linha de quem espera fala da máquina pelo nome.
  it("Tarefas (Por estado): a linha fala da VM; sem pílula nem memória no topo", () => {
    const html = renderTodosOsTrabalhos(estadoCom(fila, [vmCheia, macFolgado]));
    expect(html).not.toContain("nod-motor-teste está ocupada");
    expect(html).not.toContain("os bots usam");
    expect(html).toContain("esperando nod-motor-teste aliviar");
  });
});

describe("Este Mac é só do Mac", () => {
  it("a leitura do Mac, não a pior; os trabalhos da VM ficam de fora", () => {
    const dto = estadoCom([daVm("Slack"), doMac], [vmCheia, macFolgado]).trabalhos;
    expect(leituraDoMac(dto)).toMatchObject({ processador: "verde", motivoEspera: null, memoriaBotsMb: 400 });
    const html = renderEsteMac(estadoCom([daVm("Slack"), doMac], [vmCheia, macFolgado]));
    expect(html).not.toContain("Seu Mac está ocupado");
    expect(html).not.toContain("Slack");
    expect(html).toContain("Nada esperando");
    expect(html).toContain("vale também para nod-motor-teste");
  });

  it("sem outra máquina, sem a linha do 'vale também'", () => {
    expect(renderEsteMac(estadoCom([doMac], [macFolgado]))).not.toContain("vale também");
  });
});

describe("Máquinas: a leitura de cada uma no cartão", () => {
  it("o status curto à vista e os números atrás do clique", () => {
    const estado = estadoCom([daVm("Slack"), daVm("NOD-202"), doMac], [vmCheia, macFolgado]);
    const html = leituraNoCartao(estado, VM.id);
    expect(html).toContain('class="cfg-leitura"');
    expect(html).toContain("Ocupada · 2 trabalhos esperam ela aliviar");
    expect(html).toContain("processador cheio (100% do tempo ocupado)");
    expect(html).toContain("disco com 14 GB livres de 29 GB");
    expect(html).toContain("os bots usam 700 MB");
    expect(html).toContain("nivel-amarela");
  });

  it("folgada: 'Trabalho novo começa na hora'; sem leitura, nada", () => {
    const estado = estadoCom([], [leitura(VM)]);
    expect(leituraNoCartao(estado, VM.id)).toContain("Trabalho novo começa na hora");
    expect(leituraNoCartao(estado, "outra")).toBe("");
  });
});

/** ADR-096 §6: o disco que acaba em menos de 24 h aparece antes de os bots pararem. */
describe("a tendência do disco na tela", () => {
  const disco = { livreMb: 14_642, totalMb: 30_000, nivel: "verde" as const, alertaMb: 10_240, criticoMb: 3_072 };

  it("o tempo legível", () => {
    expect(tempoAteAcabar(5 * 60_000)).toBe("menos de 10 min");
    expect(tempoAteAcabar(42 * 60_000)).toBe("cerca de 40 min");
    expect(tempoAteAcabar(6.2 * 3_600_000)).toBe("cerca de 6 h");
    expect(statusDoDisco({ ...disco, acabaEmMs: 6 * 3_600_000 })).toBe("14 GB livres · acaba em cerca de 6 h");
    expect(statusDoDisco({ ...disco, acabaEmMs: null })).toBe("14 GB livres");
  });

  it("no cartão da máquina folgada: o status curto avisa e fica amarelo; sem estimativa, como antes", () => {
    const acabando = leitura(VM, { disco: { ...disco, acabaEmMs: 6 * 3_600_000 } });
    const html = leituraNoCartao(estadoCom([], [acabando]), VM.id);
    expect(html).toContain("Disco acaba em cerca de 6 h no ritmo atual");
    expect(html).toContain("nivel-amarela");
    expect(html).toContain("no ritmo atual, acaba em cerca de 6 h; o Nod limpa o que dá");
    expect(leituraNoCartao(estadoCom([], [leitura(VM, { disco })]), VM.id)).toContain("Trabalho novo começa na hora");
  });

  it("em Este Mac: o status do disco com a estimativa e o detalhe com o que o Nod faz", () => {
    const html = renderEsteMac(estadoCom([doMac], [leitura(MAC, { memoriaBotsMb: 400, disco: { ...disco, acabaEmMs: 3 * 3_600_000 } })]));
    expect(html).toContain("acaba em cerca de 3 h");
    expect(html).toContain("O Nod apaga sozinho o que dá");
  });
});
