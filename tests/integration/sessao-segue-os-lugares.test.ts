import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { CAPACIDADES_HARNESS, type IdHarness } from "../../src/contracts/harness.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { LIMITE_FALHAS_SEGUIDAS } from "../../src/domain/computador.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import type { Services } from "../../src/use-cases/tipos.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-199: a sessão do CLI só é retomada enquanto os lugares do bot (computador, navegador) não melhoraram. Um lugar que
 * entra, ou um aviso de "fora do ar"/"desligado" que some, larga a sessão: o turno recomeça com o histórico, o resumo e a
 * frase dos lugares. Um lugar que sai não larga nada. Vale igual para o Claude e para o Codex.
 */
const ESCOPO = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.now();
const pronto: Inventario = { estado: "pronto", versao: "teste", em: AGORA };
const MODELO: Record<"claude-cli" | "codex-cli", string> = { "claude-cli": "sonnet", "codex-cli": "gpt-6-astra" };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const TOKENS = { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 };
const sucesso = (sessaoCli: string): ResultadoTurno => ({ desfecho: "sucesso", texto: "feito", sessaoCli, sinais: SINAIS, custoUsd: 0.1, tokens: TOKENS, ferramentasChamadas: [], negacoesPermissao: [] });
const capacidades = { "codex-cli": { ...CAPACIDADES_HARNESS["codex-cli"], retomaSessao: true }, "claude-cli": CAPACIDADES_HARNESS["claude-cli"] };

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
type Harness = "claude-cli" | "codex-cli";

async function montar(trx: Trx) {
  const base = await agenteComConversa(trx, ESCOPO, { nome: "Gil" });
  await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
  const agora = () => Date.now();
  /** O que o servidor tem ligado agora; cada teste vira as chaves entre um turno e outro. */
  const ligado = { navegador: false, computador: false };
  const servicos = servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) });
  const services = new Proxy(servicos, {
    get(alvo, chave) {
      if (chave === "navegadores") return ligado.navegador ? ({ disponivel: () => true } as unknown as Services["navegadores"]) : undefined;
      if (chave === "computadores") return ligado.computador ? ({ porPessoa: false, executarAprovado: async () => {} } as unknown as Services["computadores"]) : undefined;
      return Reflect.get(alvo, chave);
    },
  });
  const deps = depsSobre(base.repos, ESCOPO, { services, agora, trx });
  const maquina = randomUUID();
  const rodar = async (harness: Harness, sessao: string) => {
    const t = (await base.repos.turnos.enfileirar({ executor: "local", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "abre o site", entradaConfianca: "confiavel", modelo: MODELO[harness], harness }))!;
    expect((await base.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() }))?.id).toBe(t.id);
    const ias: readonly IdHarness[] = [harness];
    const r = await emitirPlanoTurno(deps, { turnoId: t.id, machineId: maquina, executor: "local", harnesses: Object.fromEntries(ias.map((ia) => [ia, pronto])), capacidadesDaMaquina: capacidades, sessaoPorMaquina: true });
    await assentarTurno(deps, { turnoId: t.id, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: sucesso(sessao), executor: "local", harness });
    const [linha] = await trx<{ motivo_recomeco: string | null; lugares: string | null }[]>`select motivo_recomeco, lugares from turnos where id = ${t.id}`;
    return { id: t.id, plano: r.data, motivo: linha!.motivo_recomeco, lugares: linha!.lugares, nomes: r.data.catalogo.ferramentas.map((f) => f.nome) };
  };
  /** O computador do bot (modelo docker por bot), criado como na primeira ação dele. */
  const computador = async () => (await base.repos.computadores.obter(base.agenteId, true))!;
  const derrubar = async (id: string) => { for (let i = 0; i < LIMITE_FALHAS_SEGUIDAS; i++) await base.repos.computadores.registrarFalha(id, { motivo: "sem_resposta", em: Date.now(), limite: LIMITE_FALHAS_SEGUIDAS }); };
  return { ...base, ligado, rodar, computador, derrubar, trx };
}

describeIntegracao("ADR-199: a sessão segue os lugares do bot", () => {
  for (const harness of ["claude-cli", "codex-cli"] as const) {
    it(`${harness}: o navegador entra no plano → a sessão é largada, o turno leva o aviso e o seguinte retoma a sessão nova`, async () => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx);
        const t1 = await m.rodar(harness, "sessao-velha");
        expect(t1.lugares).toBe("computador=ausente;navegador=ausente;seuComputador=ausente");
        const t2 = await m.rodar(harness, "sessao-velha");
        expect(t2.plano.entrada.sessaoCli).toBe("sessao-velha");

        m.ligado.navegador = true;
        const t3 = await m.rodar(harness, "sessao-nova");
        expect(t3.nomes).toContain("navegador_abrir");
        expect(t3.plano.entrada.sessaoCli).toBeNull();
        expect(t3.motivo).toBe("lugares_mudaram");
        expect(t3.plano.entrada.texto.startsWith("abre o site")).toBe(true);
        expect(t3.plano.entrada.texto).toContain("[nod] Você recomeçou sem a memória da sessão anterior (os lugares onde você trabalha mudaram");
        expect(t3.plano.entrada.texto).toContain("Agora você tem o seu navegador (navegador_*) neste turno.");
        expect(t3.plano.entrada.texto).toContain('não responda "indisponível" sem ter chamado');
        expect((await m.repos.raioX.doTurno(t3.id))?.composicao?.recomeco).toMatchObject({ motivo: "lugares_mudaram" });

        // Uma vez por mudança: com os mesmos lugares, o turno seguinte retoma a sessão nova e não leva aviso.
        const t4 = await m.rodar(harness, "sessao-nova");
        expect(t4.plano.entrada.sessaoCli).toBe("sessao-nova");
        expect(t4.plano.entrada.texto).toBe("abre o site");
        expect(t4.motivo).toBeNull();
      });
    });
  }

  it("um lugar que SAI não larga a sessão; quando ele volta, larga", async () => {
    await withRollback(ESCOPO, async (trx) => {
      const m = await montar(trx);
      m.ligado.navegador = true;
      await m.rodar("claude-cli", "s1");
      m.ligado.navegador = false;
      const semNavegador = await m.rodar("claude-cli", "s1");
      expect(semNavegador.plano.entrada.sessaoCli).toBe("s1");
      expect(semNavegador.nomes).not.toContain("navegador_abrir");
      expect(semNavegador.motivo).toBeNull();
      m.ligado.navegador = true;
      const voltou = await m.rodar("claude-cli", "s2");
      expect(voltou.plano.entrada.sessaoCli).toBeNull();
      expect(voltou.motivo).toBe("lugares_mudaram");
    });
  });

  it("o computador cai (a sessão segue, com o aviso do turno) e volta (a sessão é largada)", async () => {
    await withRollback(ESCOPO, async (trx) => {
      const m = await montar(trx);
      m.ligado.computador = true;
      const pc = await m.computador();
      const t1 = await m.rodar("claude-cli", "s1");
      expect(t1.lugares).toBe("computador=no_plano;navegador=ausente;seuComputador=ausente");
      expect(t1.nomes).toContain("computador_navegar");

      await m.derrubar(pc.id);
      const fora = await m.rodar("claude-cli", "s1");
      expect(fora.lugares).toBe("computador=fora_do_ar;navegador=ausente;seuComputador=ausente");
      expect(fora.plano.entrada.sessaoCli).toBe("s1");
      expect(fora.nomes).not.toContain("computador_navegar");
      expect(fora.plano.promptSistema).toContain("Seu computador está fora do ar neste turno");
      expect(fora.plano.promptSistema).toContain("Isso vale só para o computador e só para este turno");
      expect(fora.plano.promptSistema).not.toContain("tente contornar");

      await m.repos.computadores.registrarSucesso(pc.id);
      const voltou = await m.rodar("claude-cli", "s2");
      expect(voltou.plano.entrada.sessaoCli).toBeNull();
      expect(voltou.motivo).toBe("lugares_mudaram");
      expect(voltou.plano.entrada.texto).toContain("Agora você tem o seu computador (computador_*) neste turno.");
    });
  });

  it("o caso de origem: computador fora do ar, o navegador entra com o aviso ainda no prompt, depois o aviso some — cada mudança larga a sessão", async () => {
    await withRollback(ESCOPO, async (trx) => {
      const m = await montar(trx);
      m.ligado.computador = true;
      const pc = await m.computador();
      await m.rodar("codex-cli", "s1");
      await m.derrubar(pc.id);
      expect((await m.rodar("codex-cli", "s1")).plano.entrada.sessaoCli).toBe("s1");
      expect((await m.rodar("codex-cli", "s1")).plano.entrada.sessaoCli).toBe("s1");

      // O navegador entra; o computador segue fora do ar. O aviso do computador já aponta o navegador.
      m.ligado.navegador = true;
      const comNavegador = await m.rodar("codex-cli", "s2");
      expect(comNavegador.plano.entrada.sessaoCli).toBeNull();
      expect(comNavegador.motivo).toBe("lugares_mudaram");
      expect(comNavegador.plano.promptSistema).toContain("sites seguem pelo seu navegador (navegador_*)");
      expect((await m.rodar("codex-cli", "s2")).plano.entrada.sessaoCli).toBe("s2");

      // O computador deixa de ter lugar (o servidor desligou o serviço): o aviso some sem nenhum lugar entrar.
      m.ligado.computador = false;
      const semAviso = await m.rodar("codex-cli", "s3");
      expect(semAviso.lugares).toBe("computador=ausente;navegador=no_plano;seuComputador=ausente");
      expect(semAviso.plano.entrada.sessaoCli).toBeNull();
      expect(semAviso.motivo).toBe("lugares_mudaram");
      expect(semAviso.plano.entrada.texto).toContain("O aviso de indisponibilidade de antes saiu; neste turno você tem o seu navegador (navegador_*).");
      expect(semAviso.plano.promptSistema).not.toContain("fora do ar");
    });
  });

  it("o computador desligado pela pessoa e religado larga a sessão", async () => {
    await withRollback(ESCOPO, async (trx) => {
      const m = await montar(trx);
      m.ligado.computador = true;
      const pc = await m.computador();
      await m.repos.computadores.configurar(pc.id, { habilitado: false });
      const desligado = await m.rodar("claude-cli", "s1");
      expect(desligado.lugares).toBe("computador=desligado;navegador=ausente;seuComputador=ausente");
      expect((await m.rodar("claude-cli", "s1")).plano.entrada.sessaoCli).toBe("s1");
      await m.repos.computadores.configurar(pc.id, { habilitado: true });
      const religado = await m.rodar("claude-cli", "s2");
      expect(religado.plano.entrada.sessaoCli).toBeNull();
      expect(religado.motivo).toBe("lugares_mudaram");
    });
  });

  it("compara com o turno que RODOU por último na sessão, não com o criado por último (o turno adiado que roda depois)", async () => {
    await withRollback(ESCOPO, async (trx) => {
      const m = await montar(trx);
      m.ligado.navegador = true;
      const adiado = await m.rodar("claude-cli", "s1");
      await m.rodar("claude-cli", "s1");
      // O primeiro (criado antes, como a volta adiada ou a fala adiada) só rodou depois do segundo, quando o navegador
      // tinha saído: o último estado que a sessão viu é o dele.
      await trx`update turnos set lugares = 'computador=ausente;navegador=ausente;seuComputador=ausente', despachado_em = ${new Date(Date.now() + 60_000)} where id = ${adiado.id}`;
      const agora = await m.rodar("claude-cli", "s2");
      expect(agora.plano.entrada.sessaoCli).toBeNull();
      expect(agora.motivo).toBe("lugares_mudaram");
    });
  });

  it("a sessão de antes da coluna (sem marca) é retomada como antes, mesmo com um lugar novo", async () => {
    await withRollback(ESCOPO, async (trx) => {
      const m = await montar(trx);
      const t1 = await m.rodar("claude-cli", "s1");
      await trx`update turnos set lugares = null where id = ${t1.id}`;
      m.ligado.navegador = true;
      const t2 = await m.rodar("claude-cli", "s1");
      expect(t2.plano.entrada.sessaoCli).toBe("s1");
      expect(t2.motivo).toBeNull();
      expect(t2.lugares).toBe("computador=ausente;navegador=no_plano;seuComputador=ausente");
    });
  });
});
