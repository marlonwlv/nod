# Navegação por elementos

## Plano e decisões

1. `feat(computador): contrato de navegação por elementos`: contrato independente do motor, ferramenta do bot e validação fechada. Ações: nenhuma ação nova de pessoa; reusa o gateway de computador existente, inclusive reserva, aprovação e controle humano.
2. `feat(computador): adaptador Playwright nos dois runtimes`: observar/localizar por papel e nome acessível, referências opacas, clicar/preencher, esperar/verificar. Docker e supervisor recebem a mesma ação pelo executor atual. Sem seletores arbitrários ou JavaScript fornecido pelo modelo.
3. `test(computador): provar navegação e recuperação`: navegador real sobre fixture controlada, alvos substituídos, ambiguidade, concorrência, perda de resposta e retomada. Testes do gateway e regressões dos dois transportes, tipos e check.

O PR #153 já está integrado: corrigiu retomada/IPC, não implementou este contrato. A base examinada tem Docker e motor/supervisor, sem adaptador Orgo. Não será anunciado suporte Orgo sem implementação e teste.

Reuso deliberado: perfil persistente, isolamento, transporte, reservas e controle humano (ADRs 037, 122 e 138). Reconstrução: observação e interação de navegador, num adaptador comum independente de pixels. O visual fica explícito em `computador_observar`/`computador_interagir`, para canvas, desktop e controles sem semântica. Não há migração de dados, cópia de perfil ou nova coleta de senha.

Referências pertencem à observação, página e revisão da sessão. Antes de agir, o adaptador confere unicidade, identidade DOM e semântica do alvo; papel e nome enviados no pedido devem coincidir com a observação e tornam a aprovação legível; substituição exige observar novamente. Uma referência é consumida antes do efeito. Não há retry automático de clique/preenchimento após falha; queda exige observar e verificar o resultado externo. A reserva do gateway e a exclusão/fila dos runtimes abrangem caminhos visual e semântico.

Riscos: sites sem acessibilidade exigem alternativa visual; DOM pode mudar entre validação e evento (não há transação num site externo). Nenhum texto de página autoriza ações. Campos de senha não são expostos/preenchidos; login manual usa o handoff existente. Esperar condição não prova resultado de negócio: o bot deve verificar o estado esperado explicitamente.

## Evidências

Validação em 18/11/2026, com Node 24 e Chromium real:

- QA final: 15 testes de navegador (14 do adaptador e 1 ponta a ponta), 108 unitários relacionados e typecheck aprovados. Fixture de mensageria local confirma preenchimento, envio e resultado de negócio; nenhum envio a terceiros.
- Ponta a ponta: ferramenta/gateway → IPC real → supervisor/tela → Chromium/Xvfb, com perfil descartável. Duas ações concorrentes com a mesma referência produzem um único efeito. Controle humano bloqueia execução e retomada explícita permite nova observação.
- Obsolescência: substituição DOM, mudança de destinatário, revisão visual, expiração e reinício recusam referências antigas. Envio seguido de falha na observação não pode ser repetido com a referência consumida. Cookies sintéticos preservados.
- Três mutantes independentes de QA foram detectados: remover comparação de destinatário/árvore, vínculo papel/nome da aprovação e identidade DOM.
- Integração: 367 aprovados e 2.407 pulados; conformidade: 27 aprovados e 86 pulados; concorrência: 262 aprovados e 492 pulados. Sem banco configurado, estes resultados não provam os casos pulados nem reservas distribuídas com banco real.
- `npm run check` foi executado uma vez: lint, tipos, fronteiras e migrações passaram; a etapa unitária teve 13.656 aprovados, 37 pulados e cinco falhas. Fingerprints do prompt e orçamento da nova ferramenta foram ajustados deliberadamente, com testes focados verdes; timeout do teste de deploy passou isolado. Duas falhas de cookies (`computador-sair-storage`, `cookies_sem_resposta`) também ocorreram na base intacta `120d9ca0`. Portanto, o check completo não está verde neste ambiente. As etapas posteriores foram executadas separadamente, com os totais acima.

Revisão independente, uma rodada (04:04:07–04:09:58 UTC): um alto corrigido (texto editável exposto na observação) e um médio corrigido (aprovação sem nome/papel legível). Ambos tiveram regressões que falharam antes e passaram depois. A segunda opinião `/codex` não foi executada: a skill instalada impede esse provedor no host Codex; não representa uma segunda revisão independente.

QA independente, uma rodada (04:10:56–04:14:06 UTC): um médio corrigido (texto cortado sem `truncada=true`), com regressão vermelha antes e verde depois. Nenhum bloqueante identificado nas duas rodadas. Início da frente: 03:42:30 UTC; PR draft criado às 03:48:01 UTC. Horário de disponibilização e tamanho final constam no PR; merge e deploy não realizados nesta frente.

Limites da prova: Docker não está instalado neste ambiente; o transporte Docker tem regressões unitárias, mas não houve execução de contêiner real. Não há adaptador Orgo na base examinada. A fixture IPC não usa bwrap e não prova isolamento do sistema operacional. Não havia sessão autorizada de WhatsApp conectada ao ensaio; não houve prova de login privado ou de persistência entre reinícios em produção. O fluxo completo do app com banco não foi iniciado. Perfis existentes não foram copiados nem modificados.

Antes de cada push, scanner OSS externo comparado com a base: os mesmos sete achados de imagens já existentes, sem achados novos; gitleaks sem vazamentos. O scanner não consta nesta base pública, e seu resultado global não é anunciado como limpo.

## Entrega e operação

O bot recebe `computador_elementos` como caminho padrão para páginas acessíveis; os dois runtimes existentes encaminham a ação ao mesmo adaptador. A mudança não exige flag, migração de perfil ou novo login. Em referências recusadas ou resultado incerto, observar e verificar antes de decidir outra ação; nunca repetir automaticamente um efeito.

CI externa, merge e deploy precisam ser acompanhados pelo dono após a entrega da frente. Os testes locais não substituem esses gates nem autorizam anunciar produção validada.

## Próxima etapa: autenticação

Requisito registrado, sem implementar nesta entrega: login uma vez reutilizável entre bots autorizados; formulário protegido no chat, com opção de cofre, mantendo senha fora do modelo, histórico, logs e observações. O adaptador recebe uma página da sessão existente, não gerencia credenciais; uma futura política de sessão/autenticação pode fornecer a página sem mudar o contrato de navegação.
