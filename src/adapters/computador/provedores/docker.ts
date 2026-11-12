import type { DriverComputador } from "../../../contracts/computador.ts";
import type { CapacidadesProvedor, ProvedorDeComputador, RefComputador, SaudeComputador } from "../../../contracts/provedor-computador.ts";
import { FalhaComputador } from "../../../domain/computador.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { log } from "../../../obs/log.ts";
import { criarDriverDocker, docker as dockerPadrao } from "../docker.ts";

/**
 * ADR-168 (definido em 2026-11-12): o Docker próprio do nod (ADR-037) como `ProvedorDeComputador`. O ciclo e o plano de
 * dados continuam no driver de sempre (adapters/computador/docker.ts, com o runtime do nod dentro do container); este
 * arquivo só o veste na interface e acrescenta o que faltava: saúde explícita e snapshot dos volumes.
 *
 * - criar: o container nasce no `iniciar` (subir cria rede, proxy e máquina numa passada só); criar é só validar o id.
 * - retomar: o Docker não guarda memória (`docker pause` não sobrevive ao reinício do host); retomar = iniciar.
 * - snapshot: com o computador DESLIGADO, copia os volumes -home e -workspace para volumes `…-foto-<rótulo>-*`, usando a
 *   própria imagem do computador (sem baixar nada), sem rede. Restaurar copia de volta, também desligado.
 * - excluir: não existe aqui. Volumes guardam logins de alguém; a ADR-037 manda apagar à mão depois da retenção.
 */
export const CAPACIDADES_DOCKER: CapacidadesProvedor = {
  retomarComMemoria: false,
  snapshot: "completo",
  telaAoVivo: "capturas",
  terminal: "comando",
  navegador: "playwright",
  audio: true,
  onde: "host_do_servidor",
};

type Docker = typeof dockerPadrao;

const ROTULO = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function criarProvedorDocker(env: Readonly<Record<string, string | undefined>>, extra: { driver?: DriverComputador; docker?: Docker } = {}): ProvedorDeComputador {
  const driver = extra.driver ?? criarDriverDocker(env);
  const docker = extra.docker ?? dockerPadrao;
  const imagem = env.NOD_COMPUTADOR_IMAGEM || "nod-computador:1";
  const nome = (id: string) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new ErroDeDominio("entrada_invalida");
    return `nod-computador-${id}`;
  };

  async function copiarVolumes(id: string, de: (v: "home" | "workspace") => string, para: (v: "home" | "workspace") => string) {
    if ((await driver.ligados()).has(id)) throw new FalhaComputador("ocupado", { detalhe: "desligue o computador antes da foto ou da restauração" });
    for (const v of ["home", "workspace"] as const) {
      await docker(["volume", "create", "--label", "nod.computador=true", para(v)], undefined, 30_000, "nao_iniciou");
      // A própria imagem do computador (já no host), sem rede e sem privilégio: nada baixa, nada sai.
      await docker(["run", "--rm", "--network", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "0:0", "--cap-add", "CHOWN", "--cap-add", "FOWNER", "--cap-add", "DAC_OVERRIDE",
        "--mount", `type=volume,source=${de(v)},target=/de,readonly`, "--mount", `type=volume,source=${para(v)},target=/para`,
        "--entrypoint", "sh", imagem, "-c", "find /para -mindepth 1 -delete && cp -a /de/. /para/"], undefined, 300_000, "acao_falhou");
    }
  }

  async function saude(ref: RefComputador): Promise<SaudeComputador> {
    const e = await driver.estado(ref.id, ref.escopo);
    if (!e.disponivel) return { estado: "erro", pronto: false, motivo: "docker_indisponivel", detalhe: e.motivo, reinicios: null };
    return { estado: e.ativo ? "ligado" : "parado", pronto: e.ativo, motivo: null, detalhe: null, reinicios: e.reinicios ?? null };
  }

  return {
    id: "docker",
    capacidades: CAPACIDADES_DOCKER,
    ambiente: () => driver.ambiente(),
    async criar(ref) { nome(ref.id); },
    iniciar: (ref) => driver.iniciar(ref.id, ref.escopo),
    parar: (ref) => driver.parar(ref.id, ref.escopo),
    retomar: (ref) => driver.iniciar(ref.id, ref.escopo),
    async snapshot(ref, rotulo) {
      if (!ROTULO.test(rotulo)) throw new ErroDeDominio("entrada_invalida");
      const base = nome(ref.id);
      await copiarVolumes(ref.id, (v) => `${base}-${v}`, (v) => `${base}-foto-${rotulo}-${v}`);
      log("info", "computador_snapshot", { computador_id: ref.id, provedor: "docker", rotulo });
      return { snapshotId: rotulo };
    },
    async restaurar(ref, snapshotId) {
      if (!ROTULO.test(snapshotId)) throw new ErroDeDominio("entrada_invalida");
      const base = nome(ref.id);
      await copiarVolumes(ref.id, (v) => `${base}-foto-${snapshotId}-${v}`, (v) => `${base}-${v}`);
      log("info", "computador_restaurado", { computador_id: ref.id, provedor: "docker", rotulo: snapshotId });
    },
    saude,
    ligados: () => driver.ligados(),
    executar: (ref, acao, autor) => driver.executar(ref.id, acao, ref.escopo, autor),
  };
}
