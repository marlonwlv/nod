# ADR-177: Dinheiro e segredos sem o bot ver (passkey no gasto, cartão virtual, 1Password)

Status: proposta (2026-11-12, frente "Assistente pessoal"; decisões "1Password e passkeys" e "pagamentos" em
`grokbot-rea/DECISOES.md` §3).

## Contexto

No Grok Bot, gastar exige a passkey da pessoa (`BeginGrokBotSpendApproval` → asserção WebAuthn), o cartão virtual é aprovado
com atestação, senhas vêm do 1Password por um launcher que confere a assinatura do `op`, e passkeys são assinadas no Mac.
No nod, o modo "Ignorar todas as aprovações" deixa uma escrita de conector rodar sem cartão; isso não pode valer para
dinheiro.

## Decisão

1. **Duas travas independentes no gasto.** A aprovação de sempre (`finalizar_compra` e `pedir_cartao_virtual` são
   `destructiveHint`) e a passkey para (compra, total), conferida pelo conector em QUALQUER modo: a primeira chamada devolve
   `aguardando_passkey` com o total; só a confirmação do MESMO total cobra (`decidirCompra`, src/domain/pagamento.ts).
   Carrinho que muda depois do pedido é recusado (`valor_mudou`); acima do teto (`NOD_ASSISTENTE_TETO_CENTAVOS`, padrão
   R$ 500) também. Sem verificador, nenhuma compra sai (`sem_verificador`).
2. **A asserção é do servidor, não do Mac do bot.** O bot tem terminal no Mac e grava qualquer arquivo; uma confirmação
   por arquivo seria forjável. O desafio carrega compra, valor, moeda e nonce (`textoDoDesafio`); `verificarAssercao`
   (src/adapters/passkey/) confere ES256 sobre `authenticatorData || sha256(clientDataJSON)` com a chave pública guardada,
   tipo `webauthn.get`, desafio exato, origem https permitida, rpIdHash, UP e UV, contador.
3. **Cartão virtual devolve só o final.** Número, validade e código ficam com quem preenche no Mac.
4. **1Password por referência.** O bot pede `op://Cofre/Item/campo`; o app do Mac (desktop/cofre-1password.ts, atrás de
   `NOD_1PASSWORD=1`) confere que o `op` é da AgileBits (`codesign --verify --strict` e TeamIdentifier 2BUA8C4S2C), lê com
   `execFile` (sem shell) e entrega o valor a quem preenche; a função nunca o devolve.
5. **Dinheiro em centavos inteiros com moeda**; soma de moedas diferentes é recusada.

## O que falta para valer de verdade

O registro da passkey e a rota que recebe a asserção (com a tabela da chave pública e do contador, migração nova), o
verificador do conector que consulta o servidor, a ponte de preenchimento do Mac até o navegador do computador do bot e o
provedor do cartão virtual. Nada disso existe ainda: o verificador real é nulo, então a compra real nunca sai.

## Gatilho de reversão

Se a passkey em cada compra pesar demais, um limite diário aprovado por passkey uma vez (como o Grok faz com o cartão), nunca
tirar a passkey.

## Porte (NOD-485)

A regra (domínio) e a verificação WebAuthn vão para o público. Pagamentos, cartão virtual e o provedor ficam no
`gamefik/nod-fechado` (ADR-160: pagamentos fora da licença aberta). O 1Password mínimo do desktop vai para o público.
