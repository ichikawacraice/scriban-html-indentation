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

### Configurações visuais do Scriban (Cores)

Você pode customizar como as chaves do Scriban (`{{` e `}}`) são decoradas visualmente no editor. Se nada for configurado, ele usará um estilo padrão (roxa neon `bold` com fundo translúcido).

| Configuração | Descrição | Padrão |
|--------------|-----------|--------|
| `scribanIndent.decoration.color` | Cor das tags do Scriban (`{{` e `}}`). | `#FE0877` |
| `scribanIndent.decoration.fontWeight` | Estilo da fonte. | `bold` |
| `scribanIndent.decoration.backgroundColor` | Cor de fundo das tags. | `rgba(150, 150, 150, 0.2)` |
| `scribanIndent.decoration.borderRadius` | Arredondamento da borda do fundo. | `4px` |

Para customizar, adicione ao seu `settings.json`:

```json
{
  "scribanIndent.decoration.color": "purple",
  "scribanIndent.decoration.fontWeight": "normal",
  "scribanIndent.decoration.backgroundColor": "transparent"
}
```
