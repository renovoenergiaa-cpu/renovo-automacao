// Configuração FIXA dos testes: números inventados e conferidos à mão, independentes da tabela real em config/.
// Assim, mudar preço, tarifa ou cidades em config/ não quebra os testes de lógica.
// A configuração real é verificada em test/config-real.test.js.
import { readFileSync } from 'node:fs'
import { validarParametros } from '../src/orcamento.js'

const ler = (caminho) => JSON.parse(readFileSync(new URL(caminho, import.meta.url), 'utf8'))

export function cfgTeste() {
  return {
    textos: ler('../config/textos.json'),
    parametros: validarParametros(ler('./parametros-teste.json')),
    empresa: {
      provisorio: true,
      nome: 'Renovo Energia Solar',
      nome_curto: 'Renovo',
      logo: null,
      cidades_atendidas: ['Cidade Exemplo A', 'Cidade Exemplo B', 'Cidade Exemplo C'],
      cidade_fora: 'recusar',
      horario_atendimento: 'de segunda a sexta, das 8h às 18h',
      validade_dias: 7,
    },
  }
}
