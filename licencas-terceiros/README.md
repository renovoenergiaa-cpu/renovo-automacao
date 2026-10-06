# Conteúdo de terceiros

A pasta `.claude/skills/` contém skills de outros autores, usadas pelo Claude Code durante o desenvolvimento deste projeto. Elas não fazem parte do bot e não rodam em produção.

| Skills | Origem | Licença | Versão instalada |
|---|---|---|---|
| ab-testing, ad-creative, ads, analytics, attribution, copywriting, cro, marketing-psychology, product-marketing, revops, sales-enablement, sms | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | MIT — [texto](marketingskills-LICENSE.txt) | Registrada em `skills-lock.json` (instaladas em 2026-10-04) |
| graphify | [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) | Apache-2.0 — [texto](graphify-LICENSE.txt) | 0.9.66 |

Os arquivos foram copiados sem alteração pelos instaladores oficiais (`npx skills add` e `graphify install --project`). Os direitos autorais pertencem aos respectivos autores.

## Plugins usados, que não ficam nesta pasta

São instalados pelo próprio Claude Code, a partir dos repositórios dos autores:

- [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) (MIT): habilitado para este projeto em `.claude/settings.json`.
- [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) (MIT): instalado na conta do usuário; para usar em outra máquina, `/plugin marketplace add DietrichGebert/ponytail` e `/plugin install ponytail@ponytail`.

## Para atualizar as skills

```bash
npx skills update
graphify install --project
```
