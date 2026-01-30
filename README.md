# scriban-indent

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
    "editor.defaultFormatter": "<publisher>.scriban-indent"
  }
}
```

Use o ID exato da extensão mostrado na aba Extensions (ex.: `publisher.scriban-indent`).

Se você usa Prettier, defina este formatador como padrão para `[html]` se quiser que HTML+Scriban seja formatado por esta extensão.

### Configuração de tabs

```json
{
  "scribanIndent.tabsPerIndent": 2
}
```

### Testar a extensão (Run and Debug)

1. Compile antes: no terminal, `yarn compile`.
2. Abra **Run and Debug** (ícone ou `Ctrl+Shift+D` / `Cmd+Shift+D`).
3. No dropdown, escolha **"Run Extension (no build)"** e clique em ▶️ (ou F5).
4. Deve abrir uma nova janela "[Extension Development Host]". Nela, abra a pasta do projeto e um `.html` com Scriban e use Format Document.

Se **"Run Extension"** (com build) não iniciar, use **"Run Extension (no build)"** depois de rodar `yarn compile` no terminal.

No **Cursor**, o launch está configurado com `"runtimeExecutable": "${execPath}"` para usar o executável do Cursor (e não o do VS Code), evitando conflito quando os dois estão instalados.

## Possíveis extensões futuras

- **Espaço em torno de operadores** no Scriban (ex.: `x+y` → `x + y`).
- **Espaço após vírgulas** em argumentos de funções Scriban.
- **Opção de indentação** (2 tabs ou espaços) por configuração.
- **Quebra de linha** em tags Scriban muito longas (ex.: `paths: [...]`).
- **Normalização de HTML** (tags em minúsculo, ordem de atributos).

## Limitações

- O formatador não é um parser completo de HTML/Scriban.
