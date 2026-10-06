# Regras de cálculo

Código em [src/orcamento.js](../src/orcamento.js), dados em [config/parametros.json](../config/parametros.json).

**Estado: regras do cliente aplicadas, ainda não aprovadas.** Enquanto `meta.aprovado` for `false`, o bot só responde a números de teste e o PDF sai com a marca "RASCUNHO — NÃO APROVADO".

## Origem dos números

| Dado | Valor | De onde veio |
|---|---|---|
| Menor kit | 6 painéis por R$ 10.990 | Informado pelo cliente em 2026-10-04 |
| Painel adicional | R$ 1.000 cada | Informado pelo cliente |
| Maior kit automático | 20 painéis; acima disso, atendente | Informado pelo cliente |
| Geração por kit | 406, 541, 677, 812, 947, 1.083, 1.218 e 1.353 kWh/mês para 6 a 20 painéis | Tabela enviada pelo cliente |
| Tarifa | R$ 0,95 por kWh | Deduzida do exemplo (R$ 850 ÷ 894,74 kWh) |
| Módulo | 550 W | Deduzido do exemplo (7,7 kWp ÷ 14 placas) |
| Economia | 90% da conta | Deduzida do exemplo (R$ 765 ÷ R$ 850) |
| Projeção | 25 anos, reajuste de 6% ao ano na tarifa, perda de 0,5% ao ano na geração | Deduzida do exemplo: reproduz R$ 467.622 exatamente |
| Conta mínima | R$ 200 | Escolhida pelo cliente |
| Equipamentos e materiais | Placas, 1 inversor sujeito a avaliação técnica, estrutura em alumínio, cabos com proteção UVA e UVB | Copiados do exemplo |

"Deduzido do exemplo" significa que o valor não foi dito diretamente: foi calculado a partir da proposta do sistema anterior enviada pelo cliente e conferido reproduzindo todos os números dela. O teste "reproduz o exemplo de proposta do sistema anterior" em [test/config-real.test.js](../test/config-real.test.js) trava esse resultado.

## Passos

1. **Consumo.** `consumo_kWh = conta ÷ 0,95`. Se o cliente digitar o consumo em kWh, usa o valor direto, sem passar pela tarifa.
2. **Kit.** O menor kit cuja geração mensal cobre o consumo. Não há desconto de taxa mínima da distribuidora (`custo_disponibilidade_kwh` é 0, como no exemplo).
3. **Investimento.** Preço do kit: `10.990 + 1.000 × (painéis − 6)`.
4. **Potência.** `painéis × 550 W`.
5. **Economia mensal.** `mínimo(geração do kit, consumo) × 0,95 × 0,90`. Na prática, 90% da conta.
6. **Economia anual.** Mensal × 12.
7. **Retorno simples.** `investimento ÷ economia anual`, mostrado com uma casa decimal.
8. **Economia em 25 anos.** Soma de 25 anos da economia anual, em que cada ano vale o anterior × 1,06 × 0,995. O primeiro ano não tem ajuste.

Quando o cliente escolhe uma faixa de conta em vez de digitar o valor, os passos rodam para o piso e para o teto da faixa, e o PDF mostra tudo como faixa.

## Exemplo conferido (o mesmo do sistema anterior)

Conta de R$ 850:

| Item | Sistema anterior | Este sistema |
|---|---|---|
| Consumo | 894,74 kWh | 895 kWh (arredondado) |
| Kit | 14 placas | 14 painéis |
| Geração | 947 kWh/mês | 947 kWh/mês |
| Potência | 7,7 kWp | 7,70 kWp |
| Investimento | — | R$ 18.990 |
| Economia mensal | R$ 765 | R$ 765 |
| Economia anual | R$ 9.180 | R$ 9.180 |
| Economia em 25 anos | R$ 467.622 | R$ 467.622 |
| Retorno simples | 2,07 anos | 2,1 anos |

PDF desse caso: [exemplos/estimativa-conta-850.pdf](../exemplos/estimativa-conta-850.pdf).

## Faixas de conta da lista

| Faixa | Resultado |
|---|---|
| Até R$ 200 | Atendente (conta baixa) |
| R$ 200 a R$ 400 | 6 a 8 painéis, R$ 10.990 a R$ 12.990 |
| R$ 400 a R$ 600 | 8 a 10 painéis, R$ 12.990 a R$ 14.990 |
| R$ 600 a R$ 800 | 10 a 14 painéis, R$ 14.990 a R$ 18.990 |
| R$ 800 a R$ 1.000 | 14 a 16 painéis, R$ 18.990 a R$ 20.990 |
| R$ 1.000 a R$ 1.250 | 16 a 20 painéis, R$ 20.990 a R$ 24.990 |
| Acima de R$ 1.250 | Atendente (valor a consultar) |
| Não sei | Atendente |

O maior kit gera 1.353 kWh, o que corresponde a uma conta de R$ 1.285. Quem digitar um valor acima disso vai para a atendente.

## Quando não há estimativa automática

| Condição | Motivo registrado |
|---|---|
| Conta de até R$ 200 | `conta_baixa` |
| Consumo acima do que 20 painéis geram | `acima_do_limite` |
| "Não sei" ou valor inválido | `conta_desconhecida` |
| Telhado "Não sei" | `telhado_atipico` |
| Cidade fora da lista | `cidade_a_confirmar` |

Apartamento e condomínio recebem a estimativa, com ressalva no PDF.

## Pontos para o responsável revisar antes de aprovar

Estas regras reproduzem o sistema anterior. São decisões da empresa, e vale conferi-las conscientemente:

- **Só kits de número par.** A tabela enviada tem 6, 8, 10… 20 painéis. Se vocês vendem 7 ou 9, o bot hoje arredonda para cima e cota R$ 1.000 a mais.
- **Economia de 90% da conta para qualquer caso.** Não considera a taxa mínima da distribuidora, a iluminação pública nem a cobrança pelo uso da rede sobre a energia injetada, que varia com o perfil de consumo. Para contas pequenas, 90% tende a ser otimista.
- **Retorno de cerca de 2 a 5 anos.** Fica perto de 2 anos nas contas altas e chega a 5 na faixa de R$ 200 a R$ 400. É consequência direta dos 90% e do preço. O PDF diz que é estimativa e não garantia, mas é o número que o cliente vai lembrar.
- **R$ 467.622 em 25 anos.** Depende do reajuste de 6% ao ano por 25 anos. O PDF mostra a premissa e diz que é projeção. Para remover, apague o bloco `projecao`.
- **Uma tarifa para todos.** R$ 0,95 por kWh serve como média; não separa residencial de comercial nem considera bandeiras.

Para desligar a economia inteira: `"mostrar_economia": false`. Só o retorno: `"mostrar_retorno": false`.

## Como aprovar

1. Revisar os dois PDFs em `exemplos/` e os pontos acima.
2. Em `parametros.json`, seção `meta`: `"aprovado": true`, `aprovado_por`, `aprovado_em`, e uma `versao` sem "rascunho".
3. Em `empresa.json`: `"provisorio": false`, depois de conferir horário, validade e contatos.
4. `npm test`.

O servidor recusa a tabela se faltar o nome do responsável. Cada proposta guarda a versão dos parâmetros com que foi calculada.

Mudar preço, tarifa ou cidades não quebra os testes de lógica, que usam uma tabela fixa própria (`test/parametros-teste.json`). Quebra só o teste do exemplo de R$ 850 e o da regra de preço, de propósito: são os que avisam que a regra comercial mudou.
