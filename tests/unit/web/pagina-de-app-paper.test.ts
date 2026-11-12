import { describe, expect, it } from "vitest";
import { paginasDoDto } from "../../../web/lib/paginas.ts";
import { paginaDoApp } from "../../../web/telas/paginas.ts";
import { appDe, paginasDe } from "../../helpers/paginas-do-bot.ts";

const AGORA = 1_000_000_000;

describe("a página de um app como o Paper 17b (rodada 2)", () => {
  it("o subtítulo, 'N pedem você', a tabela com coluna e desde, e o pé com a regra", () => {
    const app = appDe("Vagas", { forma: "lista", fonte: "conector", fonteRef: "gmail", regraPede: "coluna Sem resposta e há mais de 2 dias", atualizadoEm: AGORA - 12 * 60_000,
      dados: { itens: [{ titulo: "Bruna Lopes", detalhe: "Dev Sr · nod", coluna: "Sem resposta", desde: "há 3 dias", pede: true }, { titulo: "Júlia Sato", detalhe: "Designer", coluna: "Entrevista", desde: "amanhã 14h" }] } });
    const p = paginasDoDto(paginasDe([app])).find((x) => x.app)!;
    const h = String(paginaDoApp(p, "Ada", { agora: AGORA }));
    expect(h).toContain('<span class="pg-app-sub">Lista · a Ada atualiza pelo Gmail · há 12 min</span>');
    expect(h).toContain("1 pede você");
    expect(h).toContain('role="table"');
    expect(h).toContain('<span class="pg-tab-ini" aria-hidden="true">BL</span>');
    expect(h).toContain('<span class="pg-tab-chip">Sem resposta</span>');
    expect(h).toContain("Pede você: coluna Sem resposta e há mais de 2 dias");
    expect(h).toContain("As ações saem pela conversa");
  });
});
