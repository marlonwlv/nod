# Apps sem chave de infraestrutura na instalação oficial

## Causa e plano

O desktop oficial abre o backend em `https://app.nodbot.ai` (inclusive o motor Windows).
O backend, porém, só lê `composio_configuracoes` por tenant (ADR-041). Um tenant novo não tem
essa linha. A tela e o chat então solicitam a chave de infraestrutura ao usuário.
O repo privado `gamefik/nod-fechado` contém apenas seu README: não há gateway alternativo implementado.

Commits planejados:
1. Backend: modo hospedado explícito, chave só do ambiente do servidor, reutilizando HTTP autenticado,
   RLS e execução central dos conectores. Impedir troca da infraestrutura pelo usuário e limitar criação/verificação.
2. Experiência: distinguir infraestrutura indisponível de app desconectado; esconder formulário em modo hospedado.
3. Provas: instalação sem chave local, OAuth, reconexão, isolamento, ausência de segredo nas respostas,
   limite e falha de provedor. Testes afetados, tipos e check uma vez.

Sem migração. Risco principal: segredo compartilhado não pode chegar ao desktop ou ser usado contra
endpoint arbitrário. Mantém-se a cifra dos conectores no servidor e a URL validada do provedor.
A autorização de chamadas continua no gateway existente, sem novo proxy genérico.

## Ações

Nenhuma ação nova. Reutiliza `apps.conectar`, `apps.verificar` e o fluxo de acesso pelo chat.
OAuth/consentimento do app continua obrigatório. O modo self-hosted mantém configuração própria.

## Ativação e limites

A implementação não provisiona nem reutiliza silenciosamente a chave de um tenant existente.
É necessário o operador fornecer a credencial de serviço no backend e habilitar o modo hospedado.
Sem isso não se pode afirmar que um usuário real já conectou em produção. Não há merge/deploy nesta frente.

## Evidências e limites da implementação

- `tests/concurrency/apps-hospedados.test.ts`: composição real (`comporApp`), servidor HTTP real,
  Postgres 16 como `nod_app` com RLS, cliente MCP real e fornecedor simulado. Sem configuração por tenant,
  duas pessoas do mesmo tenant e uma de outro conectam e reconectam mantendo seus próprios IDs.
  Verifica ausência de concessões implícitas, de chave nas respostas e de leitura dos conectores alheios.
- `tests/integration/apps-hospedados.test.ts`: autenticação HTTP, conta remota de outra pessoa recusada,
  indisponibilidade/401 do fornecedor, chave ausente, configuração pelo usuário bloqueada, teto HTTP.
- `tests/integration/credencial.test.ts`: o chat não cria cartão de infraestrutura com serviço configurado
  nem indisponível; executado com Postgres real.
- `tests/integration/deploy-azul-verde.test.ts`: segredo só no env da nova cor; saída do deploy sem valor;
  ausência do segredo não devolve o usuário ao formulário de chave.
- `tests/unit/services/apps-hospedados.test.ts`: teto por pessoa e global, recuperação da janela e
  exclusão da chave dos ambientes de executores/conectores arbitrários.
- `tests/unit/web/marketplace.test.ts`: formulário de chave ausente em modo hospedado e aviso de serviço
  indisponível. Nenhum botão/rota de ação nova.

O fornecedor foi simulado: não prova consentimento OAuth real nem disponibilidade/cota do projeto de produção.
A infraestrutura real não foi alterada, e a existência/permissão do segredo de serviço não foi confirmada.
Antes de ativar para usuários novos, o operador precisa confirmar qual projeto Composio atende o Nod oficial,
provisionar seu segredo e validar OAuth/reconexão com duas contas reais. Não enviar a chave pelo chat.

A chave não vai para desktop/web/logs; continua cifrada no banco do backend em cada conector, conforme ADR-041.
Não há migração de projetos antigos, rotação automática ou quota distribuída. O catálogo mantém o fallback
pré-existente; `composioConfigurado` indica configuração, não um health-check do fornecedor.
