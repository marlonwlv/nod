# ADR-194 — Backoffice interno, separado do admin de workspace

Status: aceita (2026-11-24, pedido do dono) · Emenda o [ADR-193](adr-193-painel-admin-de-uso.md) · Relacionadas:
[ADR-005](adr-005-uma-tabela-events-para-fluxo-tabelas-de-dominio-para-est.md) (escopo por pessoa; fora dele, 404), [ADR-124](adr-124-identidade-progressiva-uso-sem-conta-e-conversao.md) (identidade global acima dos tenants),
[ADR-179](adr-179-front-em-react-por-regioes.md) (React e Base UI).

## Contexto

O painel de uso do ADR-193 nasceu em `/admin.html`, com rotas `/api/t/:tenantId/admin/*` e acesso por `NOD_ADMINS`. Os
usuários vão ganhar um **admin de workspace**: gerir o próprio espaço (pessoas, bots, apps), dentro do tenant, com
permissão pelo papel da pessoa no workspace. O painel é outra coisa: ferramenta do **time interno do nod**, que olha
**todos** os espaços. Misturar os dois sob "admin" e sob o prefixo do tenant convidava a reaproveitar a checagem de papel
do workspace para dar acesso cross-tenant — o erro que esta decisão fecha.

## Decisão

1. **Nome e prefixos próprios.** O painel passa a se chamar **backoffice**. A tela mora em `/backoffice` (padrão
   `/backoffice/uso`; seções em `/backoffice/<secao>`, a pessoa em `/backoffice/pessoas/:tenantId/:pessoaId`). A API
   mora em `/api/backoffice/*`, **fora** de `/api/t/:tenantId` — família própria no roteador. `/admin.html` redireciona
   para `/backoffice`. O nome "admin" e o prefixo `/api/t/:tenantId/admin/*` ficam reservados ao admin de workspace.
2. **Guarda própria, no servidor, a cada pedido.** O roteador resolve a sessão (sem sessão: 401) e pergunta
   `papelBackoffice(escopo)` antes de casar qualquer rota `backoffice: true`; sem papel, 404 como rota que não existe. A
   guarda nunca lê papel de workspace. As rotas do backoffice não casam sob `/api/t/:tenantId` nem pelo MCP dos bots.
3. **A tela também é decidida no servidor.** `/backoffice/*` sem sessão → 302 para `/?volta=<caminho>`; o app guarda a
   volta na aba (sobrevive à ida e volta do Google), não abre espaço provisório e, com a sessão aberta, devolve a pessoa
   ao mesmo caminho. A volta só aceita caminhos do backoffice (`caminhoDeVolta`, sem redirecionamento aberto). Logado e
   fora da equipe → 404. Da equipe → o app do backoffice (`backoffice.html`, entrada própria do Vite).
4. **Papéis no banco: `equipe_backoffice`** (`tenant_id`, `pessoa_id`, `papel` `'dono' | 'leitura'`, `criado_em`;
   migração 0184, aditiva). É global (exceção em `gate-rls.ts`, como `contas`); `nod_app` só lê, quem escreve é o
   `nod_dono`. Hoje `dono` e `leitura` veem o mesmo; `dono` é quem poderá gerir a equipe e fazer ações quando existirem.
   **Bootstrap:** enquanto a tabela estiver vazia, quem está em `NOD_ADMINS` (id ou e-mail) é dono — o primeiro deploy
   não tranca ninguém fora. Com a primeira linha, só a tabela vale.
5. **Auditoria: `acessos_backoffice`** — cada pedido à API grava quem (tenant e pessoa da sessão), seção, rota (sem query
   string), alvo consultado (tenant e pessoa, quando houver) e quando, **antes** de responder (sem o registro, o pedido
   falha). Só metadados. Escopada pela pessoa que acessou; `nod_app` só insere e lê a própria linha.
6. **App em seções.** Shell React com menu lateral (no celular, abas no topo), cabeçalho com a janela 7/30/90 dias
   (Base UI `ToggleGroup`) e menu da conta (Base UI `Menu`). Cada seção é um módulo em `web/react/backoffice/secoes/`,
   registrado em `secoes/index.tsx`; seção nova (uso de IA, auditoria) = módulo + rota GET auditada + uma linha no
   registro.

## Como dar ou tirar acesso

Como `nod_dono`, no banco de produção:
`INSERT INTO equipe_backoffice (tenant_id, pessoa_id, papel) VALUES ('<tenant>', '<pessoa>', 'dono');` — a partir da
primeira linha, `NOD_ADMINS` deixa de valer para o backoffice (continua valendo para o que já usava, como o ditado).
Tirar: `DELETE FROM equipe_backoffice WHERE …`. Os acessos ficam em `acessos_backoffice`.

## Gatilho de reversão

Se o backoffice ganhar ações que mudam dados (pausar rotina, desativar pessoa), elas entram com `Rota.acao`, papel
`dono` conferido na rota e auditoria do que mudou — não pelo admin de workspace. Se a varredura por pessoa passar de
alguns segundos, troca-se por um papel de leitura dedicado com views agregadas (o gatilho do ADR-193).
