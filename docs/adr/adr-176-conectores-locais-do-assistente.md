# ADR-176: Conectores locais do assistente pessoal (vida real e canais)

Status: proposta (2026-11-12, frente "Assistente pessoal"; decisões "assistente pessoal completo" e "e-mail próprio do bot e
iMessage").

## Contexto

Um assistente completo tem ~190 ferramentas num enum só, rodando no backend: viagens, lugares/restaurantes, clima, compras,
reuniões, a caixa de e-mail do bot e iMessage/SMS. No nod, ferramenta de fora é conector MCP: a sonda lê o catálogo, a
concessão diz o que o bot pode, a aprovação decide cada escrita e o proxy marca o resultado como não confiável.

## Decisão

1. **Dois conectores locais stdio, sem SDK**, como o `github` (ADR-048): `assistente`
   (src/adapters/conectores-locais/assistente/) e `canais` (…/canais/), sobre `criarServidorMcpSimples` (mcp-simples.ts).
   Entram pelo caminho de sempre: nada muda no proxy, na aprovação nem no catálogo do nod.
2. **Leitura com `readOnlyHint`; escrita sem.** Buscar voo, hotel, carro, lugar, previsão, produto, reunião e e-mail lê;
   reservar mesa, carrinho, entrar e falar na reunião, enviar e-mail/iMessage/SMS passam pela aprovação. Os envios têm nome
   e corpo que viram rascunho (ADR-175). Comprar e cartão virtual são `destructiveHint` e têm a passkey (ADR-177).
3. **Validação no domínio** (src/domain/assistente.ts, canais.ts): argumento fora do schema, data inválida, e-mail com
   nome de exibição, telefone sem DDI voltam ao modelo como frase que diz o que corrigir; o erro do provedor nunca vaza.
4. **Driver pelo ambiente, nunca pelo modelo.** Sem variável, o de teste (fixtures marcadas "(teste)", estado no
   processo). `NOD_ASSISTENTE_REAL=1` / `NOD_CANAIS_REAL=1` pedem o real, que ainda não tem provedor: o catálogo volta vazio
   e a sonda registra o conector indisponível, como o `github` sem jeito de conectar.

## Gatilho de reversão

Se cada área ganhar provedor próprio com credencial própria (Amadeus, Google Places, Twilio…), separar em um conector por
área, para a pessoa conceder um sem o outro.

## Porte (NOD-485)

Domínio, contratos, servidores e drivers de teste vão para o público. Os drivers reais (contratos com provedores pagos) e
o domínio de e-mail do nod ficam no `gamefik/nod-fechado`.
