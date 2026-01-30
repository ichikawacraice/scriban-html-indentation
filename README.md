# scriban-html-indentation

Formatador para arquivos HTML com tags Scriban (`{{ ... }}`, `{{~ ... ~}}`).

## O que o formatador faz

- **Indentação**: 1 ou 2 tabs por nível (configurável).
- **Tags Scriban**: garante 1 espaço após `{{` e antes de `}}`.
  - Correto: `{{ side_cart }}`
  - Corrigido de: `{{side_cart}}`
- **HTML completo**: usa o `vscode-html-languageservice` (mesma base do formatter do VS Code) e aplica as regras Scriban por cima.

## Como usar

1. Abra um arquivo HTML com Scriban.
2. Use **Format Document** (`Shift+Option+F` no macOS, `Shift+Alt+F` no Windows/Linux).
3. Para ser o formatador padrão em HTML, em `settings.json`:

```json
{
  "[html]": {
    "editor.defaultFormatter": "ichikawa.scriban-html-indentation"
  }
}
```

Use o ID exato da extensão mostrado na aba Extensions (ex.: `ichikawa.scriban-html-indentation`).

Se você usa Prettier, defina este formatador como padrão para `[html]` se quiser que HTML+Scriban seja formatado por esta extensão.

### Configuração de tabs

```json
{
  "scribanIndent.tabsPerIndent": 2
}
```

## Possíveis extensões futuras

- **Espaço em torno de operadores** no Scriban (ex.: `x+y` → `x + y`).
- **Espaço após vírgulas** em argumentos de funções Scriban.
- **Opção de indentação** (2 tabs ou espaços) por configuração.
- **Quebra de linha** em tags Scriban muito longas (ex.: `paths: [...]`).
- **Normalização de HTML** (tags em minúsculo, ordem de atributos).

## Limitações

- O formatador não é um parser completo de HTML/Scriban.
