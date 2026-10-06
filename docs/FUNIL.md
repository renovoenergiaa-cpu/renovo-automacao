# Fluxo conversacional

Os textos ficam em [config/textos.json](../config/textos.json) e as opções de imóvel, conta e telhado em [config/parametros.json](../config/parametros.json). Mudar um texto não exige mexer em código: edite e reinicie.

## Sequência

| # | Etapa | Mensagem | Componente | Opções (id) |
|---|---|---|---|---|
| 0 | Abertura | Identifica a empresa e o assistente virtual, diz o que será entregue, para que os dados são usados e como falar com uma pessoa ou parar | Texto | |
| 1 | `cidade` | "Em qual cidade fica o imóvel?" | Lista com as 9 primeiras cidades e "Outra cidade"; as demais são aceitas digitando | `cidade:<nome>`, `cidade:outra` |
| 2 | `imovel` | "Que tipo de imóvel é?" | 3 botões | `imovel:casa`, `imovel:comercio`, `imovel:apto` |
| 3 | `conta` | "Qual é o valor médio da sua conta de luz por mês?" | Lista de 8 | `conta:ate200` … `conta:acima1250`, `conta:naosei` |
| 4 | `telhado` | "Como é o telhado onde os painéis ficariam?" | Lista de 6 | `telhado:ceramica` … `telhado:naosei` |
| 5 | `nome` | Só se o nome do perfil do WhatsApp não servir | Texto | |
| 6 | `confirmar` | Resumo das respostas | 2 botões | `confirmar:gerar`, `confirmar:corrigir` |
| 7 | PDF | "Estou preparando…", documento, próximo passo | Texto, documento, 3 botões | `acao:consultor`, `acao:visita`, `pos:depois` |

Quatro perguntas mais uma confirmação. O nome vem do perfil do WhatsApp e é confirmado no resumo, em vez de perguntado. Apartamento e condomínio pulam a pergunta do telhado.

A conta de luz não precisa ser enviada. Quem preferir pode digitar o valor ("450") ou o consumo ("380 kWh"); os dois são tratados como grandezas diferentes.

## Desvios

| Situação | O que o bot faz |
|---|---|
| Cidade fora da lista (além de cerca de 45 km de Sorocaba) | Passa para um consultor confirmar se atende. Sem PDF. Com `cidade_fora: "recusar"` o bot passa a informar que não atende e registra o interesse. |
| Conta baixa, conta acima do limite, "não sei", telhado atípico | Completa as perguntas, explica o motivo e passa para um consultor com tudo anotado. Sem PDF automático. |
| Foto ou arquivo na etapa da conta | Trata como conta enviada e passa para um consultor. |
| Áudio, figurinha, outro arquivo | Explica que não consegue abrir e repete a pergunta. |
| Resposta digitada que equivale a uma opção ("moro numa casa", "eternit") | Aceita. |
| Resposta não entendida | Na primeira, orienta e repete a pergunta. Na segunda seguida, chama um consultor. |
| "atendente", "consultor", "falar com alguém" | Passa para um consultor em qualquer etapa. |
| "voltar", "corrigir" | Abre a lista do que pode ser corrigido e volta direto à confirmação. Funciona também depois do PDF. |
| "recomeçar" | Zera as respostas. |
| "parar", "sair", "cancelar" | Encerra e nunca mais envia lembrete. |
| Clique em botão de pergunta antiga | Avisa e repete a pergunta atual, sem mudar nada. |
| Segundo clique em "Gerar estimativa" | Não gera outra proposta. |
| Volta depois de 6h | Retoma de onde parou, sem recomeçar. |
| Qualquer mensagem depois do PDF | Considerada dúvida comercial: vai para um consultor. |
| Falha ao gerar ou enviar o PDF | Avisa o cliente, alerta a equipe e passa para um consultor. |

## Atendimento humano

O bot sai da conversa quando o cliente pede, quando uma regra manda, ou quando o vendedor escreve pelo app WhatsApp Business (a YCloud avisa o bot). A mensagem de transição começa com 🔔 para o vendedor localizar a conversa na lista do app. Se `NTFY_TOPICO` estiver configurado, a equipe recebe um aviso no celular sem nome nem telefone completo.

Depois de 7 dias sem atividade, um novo contato do mesmo cliente volta para o bot.

## Lembretes

Todos dentro das 24h seguintes à última mensagem do cliente e só entre 8h e 20h de Brasília. Passado esse prazo o WhatsApp só aceita modelos pré-aprovados, que não foram implementados.

| Quando | Mensagem |
|---|---|
| 30 min parado no meio das perguntas | "Ainda está por aí?" e a pergunta pendente |
| 20h parado no meio das perguntas | "Sua estimativa ainda está esperando por você" e a pergunta pendente |
| 20h depois do PDF, sem escolher o próximo passo | "Ficou alguma dúvida?" com botões "Falar com consultor" e "Parar mensagens" |

Cada lembrete traz no rodapé "Para não receber mais, digite PARAR". Quem respondeu "Agora não" não recebe lembrete.

## Coerência com o anúncio

O bot promete uma estimativa em PDF em poucas perguntas, sujeita a vistoria. O anúncio deve prometer o mesmo. Um anúncio que promete "orçamento fechado" ou "conta zerada" gera frustração na abertura e contraria os limites do projeto. A mensagem pré-preenchida do anúncio pode ser qualquer uma; o bot responde à primeira mensagem com a abertura.

## Métricas

`npm run cli -- relatorio 30` mostra, por conversa:

- Funil: conversas iniciadas, informou cidade, imóvel e conta, qualificadas, proposta enviada, proposta entregue, pediu contato, venda. Cada linha traz a conversão desde o início e desde a etapa anterior, o que mostra onde está o abandono.
- Encaminhamentos por motivo, respostas não entendidas por etapa, fora de área, pedidos de parada, lembretes e falhas.
- Por anúncio: conversas, propostas, pedidos de contato, vendas e valor vendido.

Cuidados na leitura:

- "Proposta enviada" significa que a API aceitou. "Entregue" vem do recibo do WhatsApp. "Mensagem lida" é o recibo de leitura do chat e não prova que o PDF foi aberto.
- A origem só é preenchida quando a Meta informa o anúncio na mensagem. Sem esse dado a conversa aparece como `sem_dado` e não é atribuída a nada.
- A venda entra pelo comando `venda` (ver [OPERACAO.md](OPERACAO.md)). Sem esse registro o funil para em "pediu contato".

## Hipóteses de teste A/B

Formato: porque (observação), acreditamos que (mudança) causará (resultado) para (público). Nenhuma está implementada; cada uma exige volume suficiente para comparar. Métrica principal em todas: pedidos de contato por conversa iniciada. Métrica de proteção: vendas por pedido de contato, para não trocar qualidade por quantidade.

| # | Hipótese | O que muda |
|---|---|---|
| 1 | Porque a abertura é longa, acreditamos que encurtá-la para duas linhas aumentará a resposta à primeira pergunta para quem vem do anúncio. | `abertura` |
| 2 | Porque valor de conta é a pergunta mais sensível, acreditamos que perguntá-la por último reduzirá o abandono nas primeiras etapas. | Ordem em `ETAPAS` |
| 3 | Porque "Agendar visita" pede mais compromisso, acreditamos que oferecer só "Falar com consultor" e "Agora não" aumentará os pedidos de contato. | Botões do pós-PDF |
| 4 | Porque o primeiro lembrete sai aos 30 minutos, acreditamos que enviá-lo aos 10 recuperará mais conversas abandonadas. | `lembretesMin` |
| 5 | Porque a faixa de investimento pode assustar, acreditamos que mostrar a economia mensal antes do investimento no PDF aumentará os pedidos de contato. | Ordem das seções em `src/pdf.js` |
| 6 | Porque o resumo de confirmação é um toque a mais, acreditamos que gerar o PDF direto, com correção oferecida depois, aumentará as propostas enviadas. | Etapa `confirmar` |

Testar uma por vez. Com menos de algumas centenas de conversas por variante, a diferença observada não é confiável.
