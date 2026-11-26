import { describe, expect, it } from "vitest";
import { HTML_BORDA, htmlDaIlha } from "../../../desktop/ilha-html.ts";

/** ADR-197 (item 6): a ilha e a borda do computador da pessoa são páginas fechadas (sem script, sem nada de fora). */
describe("a ilha do computador da pessoa", () => {
  it("diz quem, onde e o passo, com Parar; escapa o que veio do sistema", () => {
    const h = htmlDaIlha({ bot: "Ada<script>", app: "Numbers & Co", acao: "digitar", aparelho: "Mac" });
    expect(h).toContain("Ada&lt;script&gt;");
    expect(h).toContain("Numbers &amp; Co · digitando");
    expect(h).toContain('href="nod-ilha://parar"');
    expect(h).toContain("default-src 'none'");
    expect(h).not.toMatch(/<script/i);
    expect(htmlDaIlha({ bot: "Ada", app: "Excel", acao: "x", aparelho: "PC" })).toContain("seu PC");
  });

  it("a borda só desenha o contorno", () => {
    expect(HTML_BORDA).toContain("border:3px solid #E8892B");
    expect(HTML_BORDA).not.toMatch(/<script|href=/i);
  });
});
