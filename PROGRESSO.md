# Progresso e retomada

Atualizado em: 2026-10-04

## Ponto de retomada
**Pausado em 2026-10-04 a pedido do cliente. Bot e túnel desligados. Decisão de caminho em aberto.**

Primeiro teste real (número de teste final 8963, conta YCloud do cliente, coexistência no plano gratuito):
- Funcionou: conexão do número, webhook criado pela API, recebimento de mensagens reais, envio aceito pela API.
- Não funcionou: a Meta recusa a entrega com erro 131031 "Business account has been locked". A conta foi criada só pelo app WhatsApp Business (sem Facebook), virou uma "empresa" chamada Pato, sem site, com revisão PENDING e não verificada. Causa provável: dados da empresa incompletos. Esperar não deve resolver.

Caminhos apresentados ao cliente:
1. Refazer a conexão com os dados reais da Renovo: entrar com o Facebook que administra os anúncios, razão social e site. É o que o número oficial exigirá. (Minha recomendação.)
2. WAHA: o cliente só aceita se houver botões. Verificado no texto original da documentação do WAHA em 2026-10-04: "DEPRECATED - Buttons do not work at the moment"; listas "may stop working at any time"; a alternativa por toque são enquetes (polls) ou menus numerados. Portanto WAHA não atende à condição.
3. Pedir desbloqueio ao suporte da YCloud por e-mail.

Para retomar o teste: abrir o túnel (`cloudflared tunnel --url http://localhost:3000 --no-autoupdate`), rodar `scripts/registrar-webhook.js` com o endereço novo, `npm start` (roteiro em `docs/OPERACAO.md`). Conferir antes `accountReviewStatus` em GET /v2/whatsapp/businessAccounts.
A chave da API foi colada no chat: o cliente deve excluí-la no painel e gerar outra ao retomar. Não ler nem exibir o conteúdo do `.env`.

## Feito
- [x] Ambiente e ferramentas (tabela abaixo).
- [x] Briefing e segunda rodada com dados reais.
- [x] Arquitetura: API oficial via YCloud + backend Node enxuto (`docs/ESPEC.md`).
- [x] Funil e textos (`src/funil.js`, `config/textos.json`, `docs/FUNIL.md`).
- [x] Motor de orçamento com as regras do cliente, reproduzindo o exemplo de R$ 850 do sistema anterior (`docs/REGRAS-CALCULO.md`).
- [x] PDF com logo e cores da Renovo, inspecionado visualmente (`exemplos/`).
- [x] Persistência, deduplicação, lembretes, pausa por atendimento humano, retenção.
- [x] Servidor com assinatura de webhook e operação por terminal.
- [x] 88 testes automáticos passando; teste real local do servidor e da autenticação da YCloud (`docs/TESTES.md`).
- [x] Grafo do código gerado (`graphify-out/`).

## Não feito / não verificado
- [ ] Envio e recebimento reais pelo WhatsApp (depende da conta YCloud).
- [ ] Coexistência no plano gratuito da YCloud: confirmar no cadastro. Plano B: WAHA, trocando só `src/ycloud.js`.
- [ ] Custo do teste sem anúncio: a YCloud pode exigir saldo pré-pago.
- [ ] Imagem Docker não foi construída (Docker desligado nesta máquina).
- [ ] Hospedagem: recomendada (Oracle Always Free), não criada.
- [ ] Aprovação final da tabela (`meta.aprovado` continua `false`; PDF sai como rascunho).
- [ ] CNPJ, contatos, garantias e condições para o PDF.
- [ ] Validação de privacidade (LGPD) e do prazo de retenção.
- [x] Código no GitHub desde 2026-10-06: https://github.com/renovoenergiaa-cpu/renovo-automacao (público, por decisão do cliente). Ficam fora do repositório: `.env`, `data/`, `insumos/` e `graphify-out/`. As skills de `.claude/skills/` foram incluídas a pedido do cliente, com as licenças em `licencas-terceiros/`.

## Dados do cliente (2026-10-04)
- Renovo Energia Solar (antes Solturi Energia Solar Sorocaba). Azul-marinho #042C74 e laranja #EC6C1C. Logo em `config/logo.png`; originais em `insumos/`.
- Sorocaba e cerca de 45 km em volta (ampliado de 35 km a pedido do cliente): 21 cidades em `config/empresa.json`; fora da lista, consultor confirma.
- Kits de 6 a 20 painéis (pares): R$ 10.990 + R$ 1.000 por painel. Acima de 20, atendente.
- Cálculo pela conta: tarifa R$ 0,95/kWh, economia de 90% da conta, módulo de 550 W, retorno simples, projeção de 25 anos (6% a.a. de reajuste, 0,5% a.a. de degradação). Deduzido do exemplo e conferido.
- Conta mínima R$ 200. PDF mostra economia e prazo de retorno.
- Público residencial + pequeno comércio. Vendedor responde no mesmo número. Requisito: custo zero.
- Tem um número de WhatsApp para teste; o oficial não estava à mão.

## Ambiente (verificado em 2026-10-04)
- macOS 14.4.1 (Intel), Node 22.23 (Homebrew), npm 10.9, Python 3.14, Docker instalado mas desligado, gh.
- Ausentes: `uv`, `jq`, `claude` no PATH (CLI embutido no app desktop).
- GitHub por SSH falha; usar HTTPS por comando com `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf GIT_CONFIG_VALUE_0=git@github.com:`.
- Node sem autoridades certificadoras: usar `SSL_CERT_FILE=/usr/local/etc/ca-certificates/cert.pem`.

## Ferramentas
| Item | Estado |
|---|---|
| Addy Agent Skills | plugin 0.6.12, escopo projeto |
| Ponytail | 4.10.0, escopo usuário (já existia) |
| Graphify | CLI 0.9.66 + skill e hooks no projeto; grafo gerado |
| Marketing skills | 12 no projeto; contexto em `.agents/product-marketing.md` |
| PDF Anthropic | `anthropic-skills:pdf`, usada na inspeção do PDF |
| n8n skills/MCP | não instalado (n8n não foi a arquitetura escolhida) |

## Hipóteses reversíveis
Listadas em `docs/ESPEC.md`, seção "Hipóteses reversíveis".
