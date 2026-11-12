# ADR-171 — Confiabilidade trazida do Grok Bot: falhas tipadas, prazos do modelo, traceparent, rede, CPU por turno e fila offline

Status: proposta · Data: 2026-11-12 (lista "Pode trazer já" do comparativo do back) · Emenda a
[ADR-067](adr-067-sessao-viva-o-turno-segue-ate-o-bot-terminar.md) (sem watchdog de turno: continua), a NOD-174
(classes de erro do fornecedor) e a [ADR-085](adr-085-uso-do-mac-segura-trabalho-novo.md) (amostrador de memória).

## Decisão

1. **Falhas de turno tipadas** (`src/domain/erro-fornecedor.ts`). O Grok Bot distingue usageLimit, unpaidInvoice,
   rateLimit, regionUnsupported e contentBlocked. Entram quatro classes: `fatura_em_aberto` ("Credit balance is too
   low", `insufficient_quota`, 402), `limite_por_minuto` (o 429 da API, que NÃO é o plano: não troca de conta e não
   repete sozinho), `regiao_sem_suporte` e `conteudo_bloqueado`, cada uma com a frase em pt-BR e a ação. A classe muda a
   frase; o estado e o motivo gravados seguem vindo do protocolo (ADR-009) — nenhuma migração.
2. **Prazo de primeiro token (150 s) e de ociosidade (90 s) do MODELO** (`src/domain/vigia-do-modelo.ts`, ligado no driver
   do Claude Code). O relógio só anda enquanto o nod espera o modelo falar: ferramenta rodando, comando em segundo plano e
   o intervalo entre voltas (sessão viva) não contam — a ADR-067 continua. Por padrão só mede e loga `turno_modelo_mudo`
   (`NOD_PRAZOS_DO_MODELO=observar`); `encerrar` interrompe o CLI; `desligado` tira. Ligar `encerrar` por padrão só com
   número: o gatilho é ver no log quantos turnos mudos de verdade aparecem em 14 dias.
3. **`traceparent` motor → servidor** (`src/domain/traceparent.ts`). O trace de um turno é o id do turno sem hífens (os 32
   hex de um trace-id W3C): os dois lados chegam ao mesmo trace sem campo novo. Cada chamada da ponte com `turnoId` leva o
   header com um span novo; o roteador põe `trace_id` e `span_pai` em todo log daquele pedido (`src/obs/rastro.ts`).
4. **Renovação da espera pela troca de rede** (`vigia-de-rede.ts` + `ponteHttp.renovarEsperas`). O daemon do Grok Bot
   renova o stream depois de 15 s de silêncio ou de uma troca de rede. No nod o silêncio já tem prazo (o `puxar` espera 35 s
   = os 20 s do long-poll + 15 s); faltava a rede: o motor lê as interfaces a cada 5 s e, se mudaram, aborta o `puxar`
   preso no socket velho, que volta vazio (código `renovar`, sem aviso de "servidor fora") e sai de novo na rede nova. O
   long-poll continua sendo o poll de reserva: não há stream novo.
5. **CPU por bot/turno**. O amostrador já somava a memória por grupo de processo do turno; agora lê o `%cpu` na mesma
   passada do `ps` (vírgula ou ponto) e manda `cpuPct` junto do `mb` (opcional: app antigo não manda e o servidor ignora
   valor fora de 0–10000). O servidor loga `turno_recursos` (turno, bot, memória, CPU) no máximo uma vez por minuto por
   turno. Nada entra nas métricas do ADR-017, que são de promessa de produto.
6. **Fila de envio offline na web** (`web/lib/fila-offline.ts`). A fala que falha sem internet vai para o
   `localStorage` da pessoa (texto, citação, ids dos anexos já subidos; 50 itens, 7 dias) e é reenviada sozinha, pela
   mesma chave de idempotência, quando a conexão volta; recarregar a página sem internet não perde a fala. Recusa do
   servidor (409, 4xx) não entra na fila: repetir não resolve.

## Limites conhecidos

- A vigia do modelo está só no driver do Claude Code; o do Codex (app-server) fica para depois.
- Depois de recarregar a página, a fala da fila volta sem os chips dos anexos (os ids vão no reenvio, a prévia não).
- O app desktop não foi tocado (outra frente): o motor dentro dele ganha a renovação por rede no próximo porte do
  `desktop/main.ts`, que monta a sua própria ponte.

## Gatilho de reversão

Se em 14 dias o `turno_modelo_mudo` aparecer em mais de 2% dos turnos com o modelo de fato respondendo depois (falso
positivo), subir os prazos por flag remota (ADR-170) antes de qualquer `encerrar`.
