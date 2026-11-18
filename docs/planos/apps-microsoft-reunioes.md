# Microsoft e reuniões — plano e decisões

Data: 2026-11-18. Base: origin/main. Um PR; sem merge/deploy nesta entrega.

1. `feat(integracoes): mapear toolkits Microsoft e reuniões`: tradução geral `_` ↔ `-` na borda Composio (revisto: começou com seis aliases fixos) para preservar slugs de conectores, banco, rotas, concessões e nomes MCP. Curadoria em português, orientação de consentimento Microsoft e disponibilidade condicionada ao provedor.
2. `test(integracoes): provar descoberta, conexão e isolamento`: contratos HTTP/MCP falsos, conta de outra pessoa/toolkit recusada, ferramentas concretas sem concessão automática, leitura versus escrita e chamadas representativas sem efeito externo.
3. `docs(integracoes): registrar suporte e lacunas`: fontes oficiais, autenticação, ações e limites; testes afetados, typecheck, check completo uma vez e varredura OSS.

Arquitetura: reutilizar sessões por pessoa, credenciais cifradas, sonda tools/list, gateway e concessões existentes (ADR-013, 026, 041, 057). Nenhuma migração, novo executor ou infraestrutura de provisionamento. O adaptador traduz SOMENTE aliases enumerados, sem substituir `_` genericamente nem alterar nomes de ferramentas. Risco: slug/conta errados conectarem outro toolkit; provar tradução em todos os métodos e correspondência exata no retorno da conta. Novos apps ficam fora do piso offline: a curadoria não comprova disponibilidade. Ferramenta sem anotação de leitura continua escrita.

Ações: nenhuma ação nova do Nod. Reutiliza apps.conectar/apps.verificar e pedir_acesso; capacidades dos provedores são descobertas pela sonda e passam pelas concessões por nome. Nenhuma chamada real de gravação, convite ou email.

A frente de provisionamento/gateway continua dona da autenticação base. Esta expansão usa os contratos atuais e depende dela para conectar sem configuração de infraestrutura pela pessoa. Granola e Fireflies só aparecem quando o provedor realmente disponibiliza autenticação. O índice completo confirmou também read_ai_mcp e otter_ai_mcp com DCR_OAUTH não gerenciado: entram como aliases condicionais à configuração no provedor, sem implementar OAuth paralelo.
