import { describe, expect, it } from "vitest";
import { atualizadoDe, decidirReinicio, estadoNaTela, lerPedidoReinicio, lerPrefsAtualizacao, livreParaReiniciar, type SinaisReinicio } from "../../../desktop/atualizacao-na-tela.ts";
import { criarUpdaterSimulado, lerSimuladoPara, versaoSimulada, ESPERA_SIMULADA_ACHAR_MS, ESPERA_SIMULADA_BAIXAR_MS } from "../../../desktop/atualizacao-simulada.ts";

const livre: SinaisReinicio = { pronta: true, emLigacao: false, turnos: 0, telas: 0 };
const extras = { versaoAtual: "1.0.3", esperandoLivre: false, reiniciando: false, sozinho: true, atualizadoDe: null };

describe("ADR-188: a atualização do app na janela web (lado do Mac)", () => {
  it("o estado da tela sai do estado do coordenador", () => {
    expect(estadoNaTela({ fase: "pronta", versao: "1.0.4" }, extras)).toMatchObject({ fase: "pronta", versaoNova: "1.0.4", versaoAtual: "1.0.3", motivo: null });
    expect(estadoNaTela({ fase: "desligada", motivo: "Mova o nod para Aplicativos para receber atualizações." }, extras)).toMatchObject({ fase: "desligada", versaoNova: null, motivo: "Mova o nod para Aplicativos para receber atualizações." });
    expect(estadoNaTela({ fase: "ociosa", procuradaEm: 42 }, extras).procuradaEm).toBe(42);
    expect(estadoNaTela({ fase: "erro", mensagem: "x" }, extras).motivo).toBe("x");
    // Esperar só vale com a versão pronta.
    expect(estadoNaTela({ fase: "ociosa", procuradaEm: null }, { ...extras, esperandoLivre: true }).esperandoLivre).toBe(false);
    expect(estadoNaTela({ fase: "pronta", versao: "1.0.4" }, { ...extras, esperandoLivre: true }).esperandoLivre).toBe(true);
  });

  it("segurar com nada rodando reinicia; com bot trabalhando, a tela pergunta", () => {
    expect(decidirReinicio({ quando: "agora" }, livre)).toEqual({ fazer: "reiniciar", resposta: { ok: true, esperando: false } });
    expect(decidirReinicio({ quando: "agora" }, { ...livre, turnos: 2 })).toEqual({ fazer: "nada", resposta: { ok: false, motivo: "ocupado", turnos: 2, telas: 0 } });
    expect(decidirReinicio({ quando: "agora" }, { ...livre, telas: 1 }).resposta).toEqual({ ok: false, motivo: "ocupado", turnos: 0, telas: 1 });
  });

  it("\"Reiniciar agora\" da pergunta reinicia com bot trabalhando; a ligação recusa sempre", () => {
    expect(decidirReinicio({ quando: "forcar" }, { ...livre, turnos: 1 }).fazer).toBe("reiniciar");
    for (const quando of ["agora", "forcar", "quandoLivre"] as const) {
      expect(decidirReinicio({ quando }, { ...livre, emLigacao: true })).toEqual({ fazer: "nada", resposta: { ok: false, motivo: "emLigacao" } });
    }
  });

  it("\"quando terminar\" espera se há trabalho e reinicia já se não há; cancelar desarma", () => {
    expect(decidirReinicio({ quando: "quandoLivre" }, { ...livre, turnos: 1 })).toEqual({ fazer: "esperar", resposta: { ok: true, esperando: true } });
    expect(decidirReinicio({ quando: "quandoLivre" }, livre).fazer).toBe("reiniciar");
    expect(decidirReinicio({ quando: "cancelarEspera" }, { ...livre, pronta: false }).fazer).toBe("cancelar");
  });

  it("sem versão pronta não reinicia", () => {
    expect(decidirReinicio({ quando: "forcar" }, { ...livre, pronta: false })).toEqual({ fazer: "nada", resposta: { ok: false, motivo: "naoPronta" } });
  });

  it("o vigia do \"quando terminar\" só solta com tudo parado", () => {
    expect(livreParaReiniciar(livre)).toBe(true);
    expect(livreParaReiniciar({ ...livre, turnos: 1 })).toBe(false);
    expect(livreParaReiniciar({ ...livre, telas: 1 })).toBe(false);
    expect(livreParaReiniciar({ ...livre, emLigacao: true })).toBe(false);
    expect(livreParaReiniciar({ ...livre, pronta: false })).toBe(false);
  });

  it("o pedido da página é validado", () => {
    expect(lerPedidoReinicio({ quando: "agora" })).toEqual({ quando: "agora" });
    expect(lerPedidoReinicio({ quando: "rm -rf" })).toBeNull();
    expect(lerPedidoReinicio(null)).toBeNull();
    expect(lerPedidoReinicio("agora")).toBeNull();
  });

  it("preferências: reiniciar sozinho nasce ligado; a última versão é guardada", () => {
    expect(lerPrefsAtualizacao(null)).toEqual({ reiniciarSozinho: true, ultimaVersao: null });
    expect(lerPrefsAtualizacao("{corrompido")).toEqual({ reiniciarSozinho: true, ultimaVersao: null });
    expect(lerPrefsAtualizacao(JSON.stringify({ reiniciarSozinho: false, ultimaVersao: "1.0.3" }))).toEqual({ reiniciarSozinho: false, ultimaVersao: "1.0.3" });
    expect(lerPrefsAtualizacao(JSON.stringify({ reiniciarSozinho: "não", ultimaVersao: 7 }))).toEqual({ reiniciarSozinho: true, ultimaVersao: null });
  });

  it("o aviso \"atualizado\" só quando o app voltou maior", () => {
    expect(atualizadoDe("1.0.3", "1.0.4")).toBe("1.0.3");
    expect(atualizadoDe("1.0.0-rc.6", "1.0.0-rc.7")).toBe("1.0.0-rc.6");
    expect(atualizadoDe(null, "1.0.4")).toBeNull();
    expect(atualizadoDe("1.0.4", "1.0.4")).toBeNull();
    expect(atualizadoDe("1.0.5", "1.0.4")).toBeNull();
    expect(atualizadoDe("lixo", "1.0.4")).toBeNull();
  });
});

describe("ADR-188: a atualização simulada (só no app do código)", () => {
  it("nunca liga no app empacotado; versão inválida desliga", () => {
    expect(versaoSimulada("1.0.4", true)).toBeNull();
    expect(versaoSimulada("1.0.4", false)).toBe("1.0.4");
    expect(versaoSimulada("sim", false)).toBeNull();
    expect(versaoSimulada(undefined, false)).toBeNull();
  });

  it("acha, baixa e, no reinício, promete a versão", () => {
    const timers: { ms: number; f: () => void }[] = [];
    const eventos: unknown[][] = [];
    let instalada: string | null = null;
    const u = criarUpdaterSimulado({ versao: "1.0.4", emUso: () => "1.0.3", agendar: (f, ms) => timers.push({ f, ms }), aoInstalar: (v) => { instalada = v; } });
    for (const ev of ["update-available", "update-downloaded", "update-not-available"] as const) u.on(ev as "update-available", (...a: unknown[]) => eventos.push([ev, ...a]));
    u.checkForUpdates();
    expect(timers.map((t) => t.ms)).toEqual([ESPERA_SIMULADA_ACHAR_MS, ESPERA_SIMULADA_ACHAR_MS + ESPERA_SIMULADA_BAIXAR_MS]);
    for (const t of timers) t.f();
    expect(eventos).toEqual([["update-available"], ["update-downloaded", {}, "", "1.0.4"]]);
    u.quitAndInstall();
    expect(instalada).toBe("1.0.4");
  });

  it("depois do reinício simulado, a procura diz que está em dia", () => {
    const eventos: string[] = [];
    const u = criarUpdaterSimulado({ versao: "1.0.4", emUso: () => "1.0.4", agendar: (f) => f(), aoInstalar: () => undefined });
    u.on("update-not-available", () => eventos.push("em-dia"));
    u.on("update-available", () => eventos.push("achou"));
    u.checkForUpdates();
    expect(eventos).toEqual(["em-dia"]);
  });

  it("a promessa gravada é lida uma vez, só se for versão", () => {
    expect(lerSimuladoPara(JSON.stringify({ simuladoPara: "1.0.4" }))).toBe("1.0.4");
    expect(lerSimuladoPara(JSON.stringify({ simuladoPara: null }))).toBeNull();
    expect(lerSimuladoPara(null)).toBeNull();
  });
});
