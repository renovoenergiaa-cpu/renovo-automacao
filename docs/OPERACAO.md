# Operação

## Rodar

```bash
cp .env.example .env    # preencher
npm ci
npm start
```

Com Docker: `docker compose up -d --build`. O bot escuta na porta 3000 e precisa de um endereço HTTPS público apontando para ela (proxy reverso ou túnel).

| Endereço | Uso |
|---|---|
| `POST /webhook/ycloud` | Cadastrar na YCloud como endpoint de webhook |
| `GET /saude` | `pendentes` deve ser 0; `uso_real` diz se a tabela está aprovada |

Eventos a assinar na YCloud: `whatsapp.inbound_message.received`, `whatsapp.message.updated`, `whatsapp.smb.message.echoes`.

## Comandos

`npm run cli -- <comando>`

| Comando | O que faz |
|---|---|
| `relatorio 30` | Funil, motivos e resultado por anúncio dos últimos 30 dias |
| `leads` | Lista em CSV para abrir em planilha |
| `venda +5511999999999 18500` | Registra a venda e o valor |
| `perdido +5511999999999 motivo` | Registra a perda |
| `pausar` / `retomar` | Pausa geral do bot |
| `devolver +5511999999999` | Devolve ao bot uma conversa que estava com o vendedor |
| `apagar +5511999999999` | Apaga os dados da pessoa (pedido de exclusão) |

## Pausar

- **Uma conversa:** o vendedor responde pelo app WhatsApp Business. O bot sai sozinho.
- **Tudo:** `npm run cli -- pausar`. As mensagens que chegarem ficam para a equipe, sem resposta automática. `retomar` religa; conversas que chegaram durante a pausa continuam com a equipe até um novo clique no anúncio.
- **Emergência:** parar o processo (`docker compose stop`). A YCloud reenvia os eventos por algumas horas; ao religar, mensagens com mais de 23h não são respondidas.

## Recuperar

| Sintoma | O que fazer |
|---|---|
| `pendentes` maior que 0 por mais de alguns minutos | Ver o log. Cada evento é tentado 3 vezes; depois disso fica parado para análise. |
| "falha ao enviar" no log | Chave da YCloud inválida, número desconectado ou saldo. O cliente recebe a pergunta de novo no lembrete de 30 minutos. |
| "FALHA ao gerar/enviar a estimativa" | O PDF fica em `data/propostas/`. A conversa já está com o vendedor, que envia à mão. |
| Bot não responde a ninguém | Conferir `pausar`, `NUMEROS_TESTE`, e se a tabela está aprovada (`uso_real`). |
| Bot para logo na primeira mensagem | Mensagem de saudação ou de ausência ligada no app WhatsApp Business: o bot entende como vendedor assumindo. Desligar as duas. |
| Servidor trocado ou perdido | Restaurar a pasta `data/` (banco e PDFs) e o `.env`. Sem `data/`, as conversas em andamento recomeçam. |

Cópia de segurança: copiar a pasta `data/` com o processo parado, ou usar `sqlite3 data/bot.sqlite ".backup copia.sqlite"`.

## Dados e privacidade

- `data/` guarda telefone, nome, respostas e PDFs. Permissão só para o usuário do serviço. Fora do git e do grafo.
- Os eventos do funil não têm telefone nem nome.
- O PDF é enviado como mídia do WhatsApp. Não existe link público.
- O corpo de cada webhook é apagado depois de processado.
- Depois de 180 dias sem atividade, conversa, proposta e PDF são apagados. Prazo pendente de validação.
- O log mostra só os 4 últimos dígitos do telefone e nunca a chave da API.
- O aviso opcional pelo ntfy passa por um serviço público: não leva nome nem telefone completo, e o tópico precisa ser difícil de adivinhar.

## Hospedagem

O bot precisa de uma máquina sempre ligada, com disco que não se apaga e um endereço HTTPS público. Ele é leve: 512 MB de memória bastam. Condições conferidas nas páginas oficiais em 2026-10-04.

| Opção | Custo | Para quê | Ressalvas |
|---|---|---|---|
| Este computador + Tailscale Funnel | Zero, sem cartão | **Testar agora** com o número de teste | Só funciona com o computador ligado e sem dormir. Não serve para produção. |
| Oracle Cloud Always Free | Zero, sem prazo | **Produção (recomendada)**. Duas máquinas de 1 GB, 200 GB de disco, região em São Paulo | Pede cartão só para verificar a identidade. A Oracle pode recuperar máquinas gratuitas ociosas (uso de CPU abaixo de 20% por 7 dias), e o bot é leve o bastante para cair nessa regra. O cadastro às vezes é recusado. |
| Google Cloud e2-micro | Zero ou poucos dólares por mês | Alternativa de produção. Sem prazo, 30 GB de disco | Só em regiões dos EUA, o que não atrapalha. Exige conta de faturamento com cartão. A página do nível gratuito não diz que o endereço IP externo é gratuito; pode ser cobrado. |
| Servidor pago pequeno | Algumas dezenas de reais por mês | Se as gratuitas falharem | Mais previsível. Preço a cotar. |

O endereço HTTPS, em qualquer das opções, sai de graça pelo Tailscale Funnel: disponível em todos os planos, não exige domínio próprio e dá um endereço fixo no formato `https://maquina.nome.ts.net`. O webhook cadastrado na YCloud fica `https://maquina.nome.ts.net/webhook/ycloud`.

Não serve: hospedagem gratuita que "dorme" ou apaga o disco a cada reinício (o bot perderia as conversas em andamento e o webhook demoraria a responder).

Nenhuma dessas contas foi criada. A escolha e o cadastro dependem de você.

## Teste com o número de teste

Caminho escolhido em 2026-10-04: número de teste no app WhatsApp Business (coexistência), túnel temporário da Cloudflare e webhook criado pela API. O túnel e o bot já foram ensaiados nesta máquina com chaves falsas.

Parte de quem tem a conta:

1. Criar a conta na YCloud e conectar o número de teste por "Connect WhatsApp Business App" (QR code no app).
2. No app WhatsApp Business do número de teste, desligar as mensagens automáticas de saudação e de ausência.
3. Preencher no `.env`: `YCLOUD_API_KEY`, `WHATSAPP_NUMERO` (o número de teste) e `NUMEROS_TESTE` (o celular pessoal que vai conversar com o bot). Deixar `YCLOUD_WEBHOOK_SECRET` em branco.

Depois, nesta ordem (o `SSL_CERT_FILE` só é necessário nesta máquina):

```bash
cloudflared tunnel --url http://localhost:3000 --no-autoupdate
```

```bash
SSL_CERT_FILE=/usr/local/etc/ca-certificates/cert.pem node --env-file=.env scripts/registrar-webhook.js https://ENDERECO-MOSTRADO-PELO-TUNEL
```

```bash
SSL_CERT_FILE=/usr/local/etc/ca-certificates/cert.pem npm start
```

O segundo comando cria o webhook na conta (ou atualiza o que já existe) e grava o segredo no `.env`. O endereço do túnel muda a cada vez que ele é reiniciado; basta repetir o segundo comando com o endereço novo.

Roteiro do teste, a partir do celular pessoal:

1. Mandar "oi" para o número de teste e fazer a jornada completa até o PDF.
2. Tocar em "Falar com consultor" e conferir que o bot para.
3. Em outra conversa, responder pelo app no número de teste no meio das perguntas e conferir que o bot para.
4. Mandar um áudio, digitar algo sem sentido, tocar em um botão antigo.
5. Informar uma cidade fora da lista.

Atenção ao custo: mensagens do bot para quem não veio de anúncio são cobradas pela Meta (US$ 0,0068 cada, cerca de 10 por conversa). A YCloud pode pedir saldo pré-pago para enviá-las. Testar clicando em um anúncio real evita a cobrança.

Em produção o túnel temporário não serve, porque o endereço muda: usar o Tailscale Funnel ou um domínio.

## Ativação

Já recebido: logo e cores, kits e preços, geração por kit, regras de cálculo, raio de atendimento, conta mínima.

O que ainda depende de você, em ordem:

1. **Revisar** os dois PDFs em `exemplos/` e os pontos de atenção em [REGRAS-CALCULO.md](REGRAS-CALCULO.md).
2. **Confirmar** a lista de 21 cidades (em `config/empresa.json`), o horário (segunda a sexta, 8h às 18h) e a validade (7 dias).
3. **Informar**, se quiser que apareçam no PDF: CNPJ, endereço, telefone, garantias e condições de pagamento.
4. **Criar a conta na YCloud** e conectar primeiro o número de teste; depois o número oficial, que exige acesso de administrador ao portfólio empresarial da Meta.
5. **Desligar** no app WhatsApp Business as mensagens automáticas de saudação e de ausência.
6. **Escolher a hospedagem** de produção e criar a conta.
7. **Preencher o `.env`** no servidor com a chave e o segredo. Não envie esses valores pelo chat.
8. **Testar** a jornada completa, a resposta pelo app e o clique em um anúncio.
9. **Autorizar a ativação**, dizendo quem aprova a tabela. Só então ela é marcada como aprovada e o bot passa a responder clientes.

## Esta máquina

O Node instalado pelo Homebrew não encontra as autoridades certificadoras (falta `/usr/local/etc/openssl@3/cert.pem`), então `npm install` e chamadas HTTPS falham. Para rodar aqui, prefixe os comandos com `SSL_CERT_FILE=/usr/local/etc/ca-certificates/cert.pem`. O conserto definitivo é `brew postinstall openssl@3`, que não executei por alterar a instalação do sistema.
