# ADR-193 — Painel admin de uso, só leitura

Status: aceita (2026-11-23, pedido do dono); **emendada pelo [ADR-194](adr-194-backoffice-interno.md)** em 2026-11-24 — o painel
virou o backoffice interno em `/backoffice`, com API em `/api/backoffice/*`, papéis em `equipe_backoffice` e auditoria;
os itens 1–3 abaixo valem como histórico · Relacionadas:
[ADR-048](adr-048-github-um-conector-varios-jeitos-de-conectar.md) (admin = `NOD_ADMINS`),
[ADR-166](adr-166-regras-do-revisor-niveis-e-teto.md) (mesma lista de admins).

## Contexto

O dono não tinha como ver como as pessoas usam o nod nem onde elas se enroscam: cadastros, quem volta, onde o
onboarding para, que erros aparecem durante o uso. Os dados já existem espalhados (mensagens, turnos, trilha de
ferramentas, decisões, itens de aprovação, propostas, conectores, execuções de rotina, incidentes, relatos), mas cada
tabela é lida sob RLS por pessoa e não havia visão agregada. O repositório é público: a regra de acesso não pode
depender de nada escrito no código.

## Decisão

1. **Página à parte, `/admin.html`** (entrada própria do Vite, React), com o painel em `#/` e a tela de uma pessoa em
   `#/pessoa/<tenant>/<pessoa>`. Seções: crescimento, ativação (funil e tempo até o primeiro bot, app e tarefa),
   engajamento, saúde, ranking de problemas com tendência, pessoas afetadas e casos, e tabela de pessoas.
2. **Admin = `NOD_ADMINS`** (id ou e-mail, já usado pela ligação e pelo cadastro do App do GitHub), conferido no
   servidor a cada GET (`src/adapters/http/rotas/admin-uso.ts`). Quem não é admin, ou com a lista vazia, recebe 404
   como rota que não existe. A página estática não tem dado nenhum.
3. **Sem papel novo no banco.** A leitura entre pessoas abre uma transação escopada por pessoa, uma por vez, e soma no
   domínio puro (`src/domain/admin-uso.ts`). A RLS segue valendo; o resultado fica em cache por 60 s.
4. **Só metadados e contagens.** Nenhum texto de mensagem, erro cru, argumento de ferramenta ou segredo sai das rotas;
   os casos levam fonte, motivo (enum do banco), instante, ids e um alvo curto (nome da ferramenta, slug do app).
5. **Instrumentação mínima e aditiva:** só `pessoas.criada_em` (migração 0183, default `clock_timestamp()`). Pessoas
   antigas caem em `conta_pessoas.criada_em` ou no primeiro sinal de uso.

Definições: ativo = escreveu ao menos uma mensagem no dia (UTC); resposta lenta = mais de 120 s até a primeira fala do
bot; sem resposta = turno de conversa concluído sem saída; travada = lease vencido ou mais de 30 min viva; Mac sem
contato = calado há mais de 10 min; falha repetida = 3 ou mais falhas da mesma rotina na janela; onboarding abandonado
= começou, não concluiu e passou 1 dia.

## Gatilho de reversão

Se a varredura por pessoa passar de alguns segundos (muitas pessoas) ou o painel precisar de ações (fase 2: pausar
rotina, desativar pessoa, reprocessar), troca-se por um papel de leitura dedicado com views agregadas e um papel admin
formal no banco, no lugar da lista em variável de ambiente.
