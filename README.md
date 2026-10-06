# Automação de WhatsApp — estimativa de energia solar

Lead do anúncio Meta chega ao WhatsApp, responde quatro perguntas por botões e listas, recebe um PDF com a estimativa e escolhe falar com um consultor. API oficial do WhatsApp via YCloud; o vendedor continua no app, no mesmo número.

**Estado:** construído e testado com a marca, os kits e as regras de cálculo da Renovo. Bloqueado para clientes reais até a aprovação final e o primeiro teste com a conta YCloud.

| Documento | Conteúdo |
|---|---|
| [docs/ESPEC.md](docs/ESPEC.md) | Especificação, arquitetura, custos, hipóteses |
| [docs/FUNIL.md](docs/FUNIL.md) | Conversa, textos, desvios, métricas, testes A/B |
| [docs/REGRAS-CALCULO.md](docs/REGRAS-CALCULO.md) | Dimensionamento, preço e como aprovar a tabela |
| [docs/TESTES.md](docs/TESTES.md) | Evidências, o que é simulado, limitações |
| [docs/OPERACAO.md](docs/OPERACAO.md) | Rodar, pausar, recuperar, lista de ativação |
| [exemplos/](exemplos/) | PDFs de exemplo: conta por faixa e conta de R$ 850 |
| [PROGRESSO.md](PROGRESSO.md) | Ponto de retomada |

```bash
npm ci
npm test          # 88 testes
npm run exemplo   # gera os PDFs de exemplo
npm start         # exige .env (ver .env.example)
```

Configuração sem código: `config/empresa.json`, `config/parametros.json`, `config/textos.json`.
