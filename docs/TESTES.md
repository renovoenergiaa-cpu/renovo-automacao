# Evidências de teste

Rodado em 2026-10-04: `npm test` → **88 testes, 88 aprovados, 0 falhas**, em cerca de 1 segundo.

Os testes de lógica usam uma tabela fixa só deles (`test/parametros-teste.json`), então mudar preço, tarifa ou cidades em `config/` não os afeta. A configuração real é conferida em `test/config-real.test.js`, que inclui a reprodução do exemplo de proposta do sistema anterior (conta de R$ 850).

## O que é simulado e o que é real

| Camada | Nos testes automáticos | Teste real feito |
|---|---|---|
| Regras de cálculo e funil | Reais | — |
| Banco SQLite | Real (em memória) | Arquivo em disco criado e lido pelo servidor |
| Geração do PDF | Real | 3 páginas renderizadas e inspecionadas visualmente |
| Servidor HTTP e assinatura | Real (porta local) | `curl` com assinatura correta → 200; falsa → 401 |
| API da YCloud | **Simulada** | Chamada real com chave inválida → 401 `INVALID_API_KEY` (confirma endereço e autenticação) |
| Envio e recebimento de mensagens no WhatsApp | **Simulado** | **Não testado**: depende da conta YCloud |
| Coexistência e eco do app | **Simulado** | **Não testado** |
| Origem do anúncio | **Simulada** com o formato da documentação | **Não testado** |
| Imagem Docker | — | **Não testado**: o Docker estava desligado nesta máquina |

Os formatos de mensagem dos testes seguem os exemplos da documentação oficial da YCloud consultada em 2026-10-04. Até o primeiro teste com a conta real, a integração é considerada correta só no papel.

## Primeiro teste real (2026-10-04)

Número de teste conectado à YCloud por coexistência, túnel da Cloudflare, bot nesta máquina.

| O que | Resultado |
|---|---|
| Coexistência no plano gratuito da YCloud | Disponível; número conectado |
| Criação do webhook pela API | Funcionou |
| Recebimento de mensagens reais | Funcionou: 3 mensagens recebidas, assinatura válida, conversa registrada |
| Envio aceito pela API | Funcionou (HTTP 200, status "accepted") |
| Entrega ao celular | **Falhou**: a Meta recusou com erro 131031, "Business account has been locked" |

A conta do WhatsApp criada na conexão estava com revisão pendente e empresa não verificada. Botões, listas, PDF, eco do vendedor e origem do anúncio continuam sem teste real.

O teste revelou uma falha do bot, já corrigida: ele não percebia que a Meta tinha recusado as mensagens. Agora toda mensagem leva uma marca da conversa, e uma recusa gera registro, erro no log e aviso à equipe.

## Cenários pedidos

| Cenário | Teste | Arquivo |
|---|---|---|
| Jornada completa até o PDF | "jornada completa até o PDF" | `test/app.test.js` |
| Lead fora da área | "lead fora da área atendida…" | `test/app.test.js`, `test/funil.test.js` |
| Respostas desconhecidas e mensagens inesperadas | "respostas inesperadas e áudio…", "resposta desconhecida…" | `test/app.test.js`, `test/funil.test.js` |
| Abandono | "abandono: dois lembretes…", "lembrete não sai para quem pediu para parar…" | `test/app.test.js` |
| Retomada | "retomada: quem volta horas depois…" | `test/app.test.js` |
| Eventos duplicados | "eventos duplicados não geram respostas duplicadas" | `test/app.test.js`, `test/servidor.test.js` |
| Cliques atrasados | "clique repetido ou atrasado…", "clique atrasado em botão…" | `test/app.test.js`, `test/funil.test.js` |
| Falha de geração ou envio do PDF | "falha no envio do PDF…", "falha na geração do PDF…" | `test/app.test.js` |
| Encaminhamento humano | "encaminhamento humano pausa o bot…", "atendimento humano expira…" | `test/app.test.js` |
| Cálculos com resultados esperados | 14 testes na tabela fixa e 3 na tabela real, incluindo o exemplo de R$ 850 | `test/orcamento.test.js`, `test/config-real.test.js` |
| Bloqueio sem parâmetros aprovados | "BLOQUEIO: com tabela fictícia…", "bloqueio: tabela fictícia ou empresa provisória…" | `test/app.test.js`, `test/orcamento.test.js` |

Também cobertos: concorrência de mensagens do mesmo cliente, recuperação depois de queda do servidor, recibos de entrega fora de ordem, regra de custo zero, pausa geral, retenção de dados, relatório do funil, limites de caracteres do WhatsApp em todas as perguntas, assinatura do webhook e retentativas de envio.

## Subida do servidor

| Situação | Resultado |
|---|---|
| Sem variáveis de ambiente | Encerra com a lista do que falta |
| Tabela fictícia e sem números de teste | Encerra com "BLOQUEADO" |
| Tabela fictícia e com número de teste | Sobe em modo de teste e avisa no log |

## Inspeção do PDF

Dois exemplos, ambos com o logo e as cores da Renovo: [estimativa-exemplo.pdf](../exemplos/estimativa-exemplo.pdf) (conta por faixa, 3 páginas A5) e [estimativa-conta-850.pdf](../exemplos/estimativa-conta-850.pdf) (valor digitado, 2 páginas). Conferido: logo e número, data e validade, aviso de estimativa, dados informados, sistema, investimento, próximo passo, economia mensal, anual, retorno e 25 anos com as premissas, kits, equipamentos, rodapé em uma linha, marca d'água de rascunho em todas as páginas, texto extraível, acentos corretos. Corrigidos nas inspeções: seção partida entre páginas, item órfão de lista, rodapé e marca d'água em duas linhas, última página quase vazia.

Não conferido: aparência com textos longos de garantia e dentro do visualizador do WhatsApp no celular. No exemplo por faixa, a lista de equipamentos fica sozinha na terceira página.

## Limitações

- Um processo só. A fila por cliente fica em memória; rodar duas instâncias exigiria trava no banco.
- Uma retentativa depois de tempo esgotado pode duplicar uma mensagem que já tinha saído.
- A janela gratuita de 72h é contada a partir da mensagem do cliente, e não da primeira resposta do bot como define a Meta; a diferença é de segundos e a favor da cautela.
- Não há lembrete depois de 24h nem reengajamento por modelo aprovado.
- A venda é registrada à mão, por comando.
- O Node desta máquina não valida certificados HTTPS sem `SSL_CERT_FILE` (instalação do Homebrew incompleta). Não afeta o servidor de produção; ver [OPERACAO.md](OPERACAO.md).
