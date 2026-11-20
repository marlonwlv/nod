import type { LeituraDeMaquinaDto, MaquinaDoTrabalho } from "../../src/contracts/maquina.ts";
import type { NivelPressao } from "../../src/contracts/trabalho.ts";

/**
 * ADR-187 §5 (protótipo 4t, opção A, escolhida em 2026-11-18): o aviso ao lado da aba das tarefas quando a máquina onde
 * as tarefas DESTE bot rodam está apertada — memória, processador ou disco. Substitui o ponto âmbar sem texto (o aviso de
 * memória do PR 8 do chat limpo), que só olhava o Mac e, no disco, qualquer máquina. Regras:
 *
 * - só contam as máquinas das tarefas abertas do bot (`maquina` de cada tarefa); a apertada sem tarefa dele não avisa;
 * - a máquina vai pelo nome dela (Mac, Windows, servidor, VM), nunca "seu Mac";
 * - o pior ganha: vermelho antes de amarelo; no empate, disco (nada novo começa), depois memória, depois processador.
 *
 * Puro: quem chama passa as leituras (`GET trabalhos`, `maquinas`) e as máquinas das tarefas.
 */

export type RecursoDaMaquina = "memoria" | "processador" | "disco";

export type AvisoDaMaquina = {
  maquinaId: string;
  nome: string;
  recurso: RecursoDaMaquina;
  nivel: Exclude<NivelPressao, "verde">;
  /** O texto do selo ("Pouca memória em nod-vm"). */
  curto: string;
  /** A frase inteira (title, nome acessível e a linha dentro da aba aberta). */
  frase: string;
};

const PESO_DO_RECURSO: Record<RecursoDaMaquina, number> = { disco: 3, memoria: 2, processador: 1 };

function textos(recurso: RecursoDaMaquina, nivel: "amarela" | "vermelha", nome: string): { curto: string; detalhe: string } {
  if (recurso === "disco") {
    return nivel === "vermelha"
      ? { curto: `Sem espaço em ${nome}`, detalhe: "o disco está cheio e nenhuma tarefa nova começa" }
      : { curto: `Pouco espaço em ${nome}`, detalhe: "o disco está quase cheio" };
  }
  if (recurso === "memoria") {
    return nivel === "vermelha"
      ? { curto: `${nome} quase sem memória`, detalhe: "a memória está quase no fim e a máquina pode travar" }
      : { curto: `Pouca memória em ${nome}`, detalhe: "a memória está apertada e elas podem ficar lentas" };
  }
  return nivel === "vermelha"
    ? { curto: `Processador no limite em ${nome}`, detalhe: "o processador está no limite e elas podem ficar lentas" }
    : { curto: `Processador ocupado em ${nome}`, detalhe: "o processador está ocupado e elas podem ficar lentas" };
}

/** Os problemas de uma máquina: cada recurso fora do verde. O disco que segura tudo novo conta como vermelho. */
function problemas(m: LeituraDeMaquinaDto): { recurso: RecursoDaMaquina; nivel: "amarela" | "vermelha" }[] {
  const lista: { recurso: RecursoDaMaquina; nivel: "amarela" | "vermelha" }[] = [];
  const disco = m.seguraTudoNovo && m.motivoEspera === "disco" ? "vermelha" : m.disco?.nivel;
  if (disco === "amarela" || disco === "vermelha") lista.push({ recurso: "disco", nivel: disco });
  if (m.pressao === "amarela" || m.pressao === "vermelha") lista.push({ recurso: "memoria", nivel: m.pressao });
  if (m.processador === "amarela" || m.processador === "vermelha") lista.push({ recurso: "processador", nivel: m.processador });
  return lista;
}

export function avisoDaMaquina(maquinas: readonly LeituraDeMaquinaDto[] | undefined, dasTarefas: readonly (Pick<MaquinaDoTrabalho, "id"> | null | undefined)[]): AvisoDaMaquina | null {
  if (!maquinas?.length) return null;
  const ids = new Set(dasTarefas.flatMap((m) => (m ? [m.id] : [])));
  let melhor: AvisoDaMaquina | null = null;
  let pesoMelhor = -1;
  for (const m of maquinas) {
    if (!ids.has(m.id)) continue;
    for (const p of problemas(m)) {
      const peso = (p.nivel === "vermelha" ? 10 : 0) + PESO_DO_RECURSO[p.recurso];
      if (peso <= pesoMelhor) continue;
      const t = textos(p.recurso, p.nivel, m.nome);
      melhor = { maquinaId: m.id, nome: m.nome, recurso: p.recurso, nivel: p.nivel, curto: t.curto, frase: `As tarefas rodam em ${m.nome}: ${t.detalhe}. Ver a máquina.` };
      pesoMelhor = peso;
    }
  }
  return melhor;
}
