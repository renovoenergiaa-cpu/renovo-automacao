# Especificação e arquitetura

Atualizado em 2026-10-04.

## Objetivo

Quem clica no anúncio do Meta Ads cai no WhatsApp da empresa, responde quatro perguntas por botões e listas e recebe um PDF com a estimativa do sistema solar. Depois escolhe entre falar com um consultor ou agendar a visita, e o vendedor continua a conversa no mesmo número.

Sucesso é medido por pedidos de contato e vendas por anúncio, não por PDFs enviados.

## Decisões

| Tema | Decisão | Motivo |
|---|---|---|
| WhatsApp | API oficial via YCloud, com coexistência | Botões e listas nativos, origem do anúncio informada pela Meta, vendedor no app WhatsApp Business no mesmo número, sem mensalidade. Escolha do cliente em 2026-10-04, depois de avaliar WAHA (não oficial). |
| WAHA como alternativa | Descartado enquanto botões forem requisito | A documentação do WAHA (texto original, 2026-10-04) diz que os botões estão descontinuados e não funcionam, e que as listas podem parar a qualquer momento. Restariam enquetes ou menus numerados. |
| Orquestração | Backend próprio enxuto (Node 22) | Ver comparação abaixo. |
| Banco | SQLite (nativo do Node) | Um arquivo, sem servidor de banco; o volume é de centenas de conversas por mês. |
| PDF | pdfkit, template em código (`src/pdf.js`) | Sem navegador, roda em servidor pequeno; única dependência do projeto. |
| IA em produção | Nenhuma | Perguntas, estados e cálculo são determinísticos. O que o bot não entende vai para uma pessoa. |
| Custo de mensagens | Bot só fala dentro da janela gratuita do anúncio | Ver "Custos". Chave `BOT_SEM_ANUNCIO` muda isso. |

### n8n com serviço de cálculo/PDF × backend próprio

| Critério | n8n + serviço | Backend próprio |
|---|---|---|
| Peças para hospedar | 2 (n8n e serviço de PDF) | 1 processo |
| Estado, duplicidade, concorrência | Montados à mão com nós e tabela | Em código, cobertos por teste |
| Testes automáticos | Difíceis; exigem n8n no ar | 74 testes em menos de 1 s |
| Editar textos | Na tela do n8n | Em `config/textos.json` |
| Familiaridade do cliente | Já usou | Nova |

Escolhido o backend próprio: os requisitos de confiabilidade (eventos repetidos, cliques atrasados, retomada, pausa) pedem teste automático, e uma peça só é mais fácil de hospedar em camada gratuita. Por isso as skills e o MCP de n8n não foram instalados.

## Componentes

```
Anúncio Meta ─▶ WhatsApp do cliente ─▶ Meta ─▶ YCloud ─▶ POST /webhook/ycloud
                                                              │
                         src/server.js  confere assinatura, grava o evento, responde 200
                                                              │
                         src/app.js     deduplica, aplica regras de custo/pausa, persiste
                              ├─ src/funil.js      máquina de estados (pura)
                              ├─ src/orcamento.js  regras de cálculo (puras)
                              ├─ src/pdf.js        template da estimativa
                              ├─ src/db.js         SQLite
                              └─ src/ycloud.js     envio, upload de mídia, formato do provedor
```

`src/ycloud.js` é o único arquivo que conhece o provedor. Trocar de provedor é reescrever esse arquivo.

O que é ferramenta de desenvolvimento e o que roda em produção:

- Desenvolvimento: Claude Code e as skills (Agent Skills, Ponytail, Graphify, marketing, PDF). Nada disso é necessário para o bot funcionar.
- Produção: o processo Node, a pasta `config/` e a pasta `data/`. Funciona sem esta sessão.

## Custos

Valores conferidos em 2026-10-04 nas páginas oficiais; a Meta, a YCloud e os provedores de nuvem mudam condições com frequência.

| Item | Custo | Observação |
|---|---|---|
| Software do bot | R$ 0 | Código próprio, dependência MIT. |
| YCloud, plano gratuito | US$ 0 | Permanente, sem cartão, 1 usuário, sem acréscimo sobre a Meta. **A confirmar no cadastro:** coexistência liberada nesse plano. |
| Mensagens do bot para lead de anúncio | R$ 0 | Janela de ponto de entrada gratuito: 72h por cliente, renovada a cada novo lead. |
| Mensagens do vendedor pelo app | R$ 0 | Sempre gratuitas na coexistência. |
| Mensagens do bot fora da janela | US$ 0,0068 por mensagem | Tarifa da Meta para o Brasil desde 2026-10-01. Uma conversa completa usa cerca de 10 mensagens. Ocorre com `BOT_SEM_ANUNCIO=1` e **nos testes feitos sem clicar em anúncio**; a YCloud pode exigir saldo pré-pago para isso. |
| Lembretes depois de 24h | Não implementado | Exigiria modelo aprovado pela Meta. |
| Servidor | R$ 0 com ressalvas | Ver "Hospedagem" em [OPERACAO.md](OPERACAO.md). |
| Mídia paga | Fora deste projeto | |

Não há garantia de custo zero: as camadas gratuitas de nuvem têm condições que podem mudar, e a tarifa da Meta também.

## Limites

- Sempre: preço e dimensionamento vêm de `config/parametros.json`; todo PDF diz que é estimativa sujeita a vistoria; segredos só no `.env`.
- Perguntar antes: enviar mensagem a cliente real, alterar campanha, contratar serviço, ativar produção, mudar retenção de dados.
- Nunca: inventar preço, garantia, cobertura, taxa de financiamento ou depoimento; prometer conta zerada ou retorno garantido; responder a cliente real com tabela não aprovada.

## Confirmado pelo cliente (2026-10-04)

Marca Renovo Energia Solar, logo e cores; Sorocaba e cerca de 45 km em volta; kits de 6 a 20 painéis com a regra de preço; geração por kit; cálculo pelo valor da conta; conta mínima de R$ 200; economia e prazo de retorno no PDF; regras de economia e projeção iguais às do sistema anterior. Detalhes e origem de cada número em [REGRAS-CALCULO.md](REGRAS-CALCULO.md).

## Hipóteses reversíveis

| Hipótese | Onde mudar |
|---|---|
| "45 km" medido em linha reta entre as sedes dos municípios: 21 cidades | `config/empresa.json` (`cidades_atendidas`) |
| Cidade fora da lista vai para um consultor confirmar, em vez de ser recusada | `config/empresa.json` (`cidade_fora`) |
| Horário comercial entendido como segunda a sexta, das 8h às 18h | `config/empresa.json` |
| Validade da estimativa: 7 dias | `config/empresa.json` |
| Só kits de número par de painéis, como na tabela enviada | `config/parametros.json` (`kits`) |
| Apartamento e condomínio recebem a estimativa, com ressalva | `config/parametros.json` (`imoveis`) |
| Fibrocimento, laje e solo vão para análise humana | `config/parametros.json` (`telhados`) |
| Retenção de dados: 180 dias | `src/app.js` (`retencaoDias`) |

## Pendências de validação

- Aprovação final da tabela pelo responsável, depois de revisar os PDFs e os pontos de atenção em [REGRAS-CALCULO.md](REGRAS-CALCULO.md).
- CNPJ, endereço e contatos para o PDF; garantias e condições comerciais, se quiserem que apareçam.
- Privacidade (LGPD): base legal do tratamento, prazo de retenção, contato do encarregado, política de privacidade publicada, e o fato de a YCloud guardar o histórico das conversas (6 meses no plano gratuito) fora do país.
- Texto do anúncio: precisa prometer o mesmo que o bot entrega (estimativa em PDF, não proposta fechada).
