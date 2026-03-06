import * as vscode from 'vscode';
import { getLanguageService, Range } from 'vscode-html-languageservice';
import { TextDocument } from 'vscode-languageserver-textdocument';

const htmlLanguageService = getLanguageService();

const VOID_HTML_ELEMENTS = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'keygen',
	'link',
	'meta',
	'param',
	'source',
	'track',
	'wbr',
]);

/**
 * Adiciona espaços em tags Scriban apenas quando há conteúdo na mesma linha.
 * - {{data}} -> {{ data }}
 * - {{~  }} ou {{~ ... ~}} isoladas permanecem sem espaços extras
 * - Aberturas/fechamentos isolados ficam sem espaços
 */
function normalizeScribanTagSpaces(line: string): string {
	const trimmed = line.trim();

	// Abertura isolada ({{, {{~, {{-})
	if (/^\{\{[~-]?$/.test(trimmed)) {
		return trimmed;
	}

	// Fechamento isolado (}}, ~}}, -}})
	if (/^[~-]?\}\}$/.test(trimmed)) {
		return trimmed;
	}

	return line.replace(/\{\{([~-])?([\s\S]*?)([~-])?\}\}/g, (_full, openMod, content, closeMod) => {
		const inner = String(content ?? '').trim();
		const o = openMod || '';
		const c = closeMod || '';
		if (!inner) {
			return `{{${o}${c}}}`;
		}
		return `{{${o} ${inner} ${c}}}`;
	});
}

function stripScribanSegments(line: string): string {
	return line.replace(/{{[\s\S]*?}}/g, '');
}

function extractScribanSegments(
	line: string,
	state: { inScribanTag: boolean },
): string[] {
	const segments: string[] = [];
	let index = 0;
	let inTag = state.inScribanTag;

	while (index < line.length) {
		if (!inTag) {
			const start = line.indexOf('{{', index);
			if (start === -1) {
				break;
			}
			index = start + 2;
			inTag = true;
			continue;
		}

		const end = line.indexOf('}}', index);
		if (end === -1) {
			segments.push(line.slice(index));
			index = line.length;
			break;
		}
		segments.push(line.slice(index, end));
		index = end + 2;
		inTag = false;
	}

	state.inScribanTag = inTag;
	return segments.map((segment) =>
		segment.replace(/^[\s~-]+/, '').replace(/[\s~-]+$/, ''),
	);
}

function analyzeScribanSegments(line: string, segments: string[]) {
	const closeStart = /^\s*end\b/i;
	const middleStart = /^\s*(else|elsif|when)\b/i;
	const openStart = /^\s*(if|for|case|while|capture|wrap)\b/i;

	let scribanNetChange = 0;

	for (const segment of segments) {
		const trimmed = segment
			.replace(/^[\s~-]+/, '')
			.replace(/[\s~-]+$/, '')
			.toLowerCase();
		if (closeStart.test(trimmed)) {
			scribanNetChange -= 1;
		} else if (openStart.test(trimmed)) {
			scribanNetChange += 1;
		}
	}

	let isLeadingClose = false;
	let isLeadingMiddle = false;

	if (line.trim().startsWith('{{')) {
		const firstMatch = segments[0];
		if (firstMatch) {
			const trimmed = firstMatch
				.replace(/^[\s~-]+/, '')
				.replace(/[\s~-]+$/, '')
				.toLowerCase();
			if (closeStart.test(trimmed)) {
				isLeadingClose = true;
			} else if (middleStart.test(trimmed)) {
				isLeadingMiddle = true;
			}
		}
	}

	return { scribanNetChange, isLeadingClose, isLeadingMiddle };
}

function analyzeHtmlLine(line: string) {
	const withoutScriban = stripScribanSegments(line);
	const trimmed = withoutScriban.trimStart();
	let leadingClosings = 0;
	let scanIndex = 0;

	while (scanIndex < trimmed.length) {
		const closingMatch = trimmed.slice(scanIndex).match(/^<\/[a-zA-Z][^>]*>/);
		if (!closingMatch) {
			break;
		}
		leadingClosings += 1;
		scanIndex += closingMatch[0].length;
	}

	const tagPattern = /<\/?[a-zA-Z][^>]*>/g;
	let openingTags = 0;
	let closingTags = 0;

	for (const match of withoutScriban.matchAll(tagPattern)) {
		const tag = match[0];
		if (tag.startsWith('</')) {
			closingTags += 1;
			continue;
		}
		if (tag.startsWith('<!') || tag.startsWith('<?')) {
			continue;
		}
		if (tag.endsWith('/>')) {
			continue;
		}
		const nameMatch = tag.match(/^<\s*([a-zA-Z0-9:-]+)/);
		const tagName = nameMatch ? nameMatch[1].toLowerCase() : '';
		if (VOID_HTML_ELEMENTS.has(tagName)) {
			continue;
		}
		openingTags += 1;
	}

	return { openingTags, closingTags, leadingClosings };
}

function normalizeScribanBlockContent(inner: string): string {
	const lines = inner.split(/\r?\n/);
	const cleaned = lines
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => normalizeScribanTagSpaces(line));
	return cleaned.join('\n');
}

function protectScribanTags(text: string): { text: string; tags: string[] } {
	const tags: string[] = [];
	const protectedText = text.replace(/{{[\s\S]*?}}/g, (match) => {
		const token = `__SCRIBAN_TAG_${tags.length}__`;
		tags.push(match);
		return token;
	});
	return { text: protectedText, tags };
}

function restoreScribanTags(text: string, tags: string[]): string {
	let output = text;
	tags.forEach((tag, index) => {
		const token = `__SCRIBAN_TAG_${index}__`;
		output = output.replace(token, tag);
	});
	return output;
}

function protectStyleScribanBlocks(text: string): { text: string; blocks: string[] } {
	const blocks: string[] = [];
	const protectedText = text.replace(
		/<style\b([^>]*)>([\s\S]*?)<\/style>/gi,
		(full, attrs, inner) => {
			if (!inner.includes('{{') || !inner.includes('}}')) {
				return full;
			}
			const normalizedInner = normalizeScribanBlockContent(inner);
			const token = `__SCRIBAN_STYLE_BLOCK_${blocks.length}__`;
			blocks.push(normalizedInner);
			return `<style${attrs}>\n${token}\n</style>`;
		},
	);
	return { text: protectedText, blocks };
}

function restoreStyleScribanBlocks(text: string, blocks: string[]): string {
	let output = text;
	blocks.forEach((content, index) => {
		const token = `__SCRIBAN_STYLE_BLOCK_${index}__`;
		output = output.replace(token, content);
	});
	return output;
}

function formatWithHtmlLanguageService(text: string): string {
	const document = TextDocument.create('inmemory://model.html', 'html', 1, text);
	const fullRange = Range.create(document.positionAt(0), document.positionAt(text.length));
	const edits = htmlLanguageService.format(document, fullRange, {
		tabSize: 1,
		insertSpaces: false,
	});
	return TextDocument.applyEdits(document, edits);
}

function collapseMultilineHtmlTags(text: string): string {
	const lines = text.split(/\r?\n/);
	const output: string[] = [];
	let buffer: string | null = null;
	let quote: '"' | "'" | null = null;

	const flush = () => {
		if (buffer !== null) {
			output.push(buffer);
			buffer = null;
		}
	};

	const findTagEnd = (
		value: string,
		startIndex: number,
		currentQuote: '"' | "'" | null,
	): { endIndex: number; quote: '"' | "'" | null } => {
		let q = currentQuote;
		for (let i = startIndex; i < value.length; i += 1) {
			const char = value[i];
			if (q) {
				if (char === q) {
					q = null;
				}
				continue;
			}
			if (char === '"' || char === "'") {
				q = char;
				continue;
			}
			if (char === '>') {
				return { endIndex: i, quote: null };
			}
		}
		return { endIndex: -1, quote: q };
	};

	const shouldStartCollapsing = (line: string, index: number): boolean => {
		if (line.startsWith('<!--', index)) {
			return false;
		}
		if (line.startsWith('<!', index) || line.startsWith('<?', index)) {
			return false;
		}
		if (line.startsWith('</', index)) {
			return false;
		}
		const after = line.slice(index + 1);
		return /^\s*[A-Za-z]/.test(after);
	};

	for (const line of lines) {
		if (buffer === null) {
			let searchIndex = 0;
			let startIndex = -1;
			let scan = { endIndex: -1, quote: null as '"' | "'" | null };

			while (searchIndex < line.length) {
				const idx = line.indexOf('<', searchIndex);
				if (idx === -1) {
					break;
				}
				if (!shouldStartCollapsing(line, idx)) {
					searchIndex = idx + 1;
					continue;
				}
				scan = findTagEnd(line, idx, null);
				if (scan.endIndex === -1) {
					startIndex = idx;
					break;
				}
				searchIndex = idx + 1;
			}

			if (startIndex === -1) {
				output.push(line);
				continue;
			}

			quote = scan.quote;
			buffer = line.slice(0, startIndex) + line.slice(startIndex).trimEnd();
			continue;
		}

		const trimmed = line.trim();
		if (trimmed.length > 0) {
			buffer += ` ${trimmed}`;
			const scan = findTagEnd(trimmed, 0, quote);
			quote = scan.quote;
			if (scan.endIndex !== -1) {
				flush();
			}
		}
	}

	flush();
	return output.join('\n');
}

function getIndentUnit(document: vscode.TextDocument): string {
	const config = vscode.workspace.getConfiguration('scribanIndent', document.uri);
	const tabsPerIndent = config.get<number>('tabsPerIndent', 2);
	return '\t'.repeat(Math.max(1, tabsPerIndent));
}

function applyScribanIndentation(text: string, indentUnit: string): string {
	const lines = text.split(/\r?\n/);
	const state = { inScribanTag: false };

	let indentLevel = 0;
	const output: string[] = [];
	/** Recuo da linha que abriu cada bloco Scriban multi-linha, para fechar no mesmo nível. */
	const scribanBlockOpenIndent: number[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) {
			output.push('');
			continue;
		}

		// Normaliza espaços nas tags ({{ x }})
		const original = normalizeScribanTagSpaces(trimmed);

		const wasInScribanTag = state.inScribanTag;
		const scribanSegments = extractScribanSegments(original, state);
		const { scribanNetChange, isLeadingClose, isLeadingMiddle } = analyzeScribanSegments(original, scribanSegments);
		const { openingTags, closingTags, leadingClosings } = analyzeHtmlLine(original);

		const preDecrease = (isLeadingClose ? 1 : 0) + (isLeadingMiddle ? 1 : 0) + leadingClosings;
		const printedIndentLevel = Math.max(indentLevel - preDecrease, 0);

		const isScribanClosingOnly = /^\s*[-~]?\s*}}$/.test(original);
		const tagIndentOffset = wasInScribanTag && !isScribanClosingOnly ? 1 : 0;
		const indentCount = printedIndentLevel + tagIndentOffset;

		// Fechamento de bloco multi-linha: usa o mesmo recuo da abertura
		const closingIndentCount =
			isScribanClosingOnly && scribanBlockOpenIndent.length > 0
				? scribanBlockOpenIndent.pop()!
				: indentCount;
		const indent = indentUnit.repeat(closingIndentCount);
		output.push(indent + original);

		// Ao entrar em bloco Scriban multi-linha (linha com {{ mas sem }}), guardar recuo para o fechamento
		if (!wasInScribanTag && state.inScribanTag) {
			scribanBlockOpenIndent.push(closingIndentCount);
		}

		const htmlNetChange = openingTags - closingTags;
		indentLevel = Math.max(
			indentLevel + scribanNetChange + htmlNetChange,
			0,
		);
	}

	return output.join('\n');
}

function formatScribanHtmlDocument(
	document: vscode.TextDocument,
	_options: vscode.FormattingOptions,
): string {
	const rawText = document.getText();
	let htmlFormatted = rawText;
	const protectedStyles = protectStyleScribanBlocks(rawText);
	const protectedScriban = protectScribanTags(protectedStyles.text);

	try {
		htmlFormatted = formatWithHtmlLanguageService(protectedScriban.text);
	} catch (error) {
		console.error('HTML formatter failed, falling back to raw text.', error);
	}

	const restoredScriban = restoreScribanTags(htmlFormatted, protectedScriban.tags);
	const restored = restoreStyleScribanBlocks(restoredScriban, protectedStyles.blocks);
	const indentUnit = getIndentUnit(document);
	const collapsed = collapseMultilineHtmlTags(restored);
	return applyScribanIndentation(collapsed, indentUnit);
}

class ScribanHtmlFormatter implements vscode.DocumentFormattingEditProvider {
	provideDocumentFormattingEdits(
		document: vscode.TextDocument,
		options: vscode.FormattingOptions,
	): vscode.TextEdit[] {
		const formatted = formatScribanHtmlDocument(document, options);
		const original = document.getText();

		if (formatted === original) {
			return [];
		}

		const lastLine = Math.max(0, document.lineCount - 1);
		const range = new vscode.Range(
			0,
			0,
			lastLine,
			document.lineAt(lastLine).text.length,
		);
		return [vscode.TextEdit.replace(range, formatted)];
	}
}

const SCRIBAN_KEYWORDS = new Set([
	'if', 'else', 'elsif', 'end', 'for', 'in', 'while', 'capture',
	'wrap', 'case', 'when', 'ret', 'break', 'continue', 'with', 'readonly', 'import', 'include', 'render'
]);

class ScribanComponentDefinitionProvider implements vscode.DefinitionProvider {
	async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken
	): Promise<vscode.Definition | vscode.LocationLink[] | undefined> {
		// Pega a string no formato 'components/header.html' (com aspas) ou 'wake_modal' (sem aspas)
		// Isso captura identificadores como `wake_modal` e caminhos como `"components/header.html"`
		const wordRange = document.getWordRangeAtPosition(position, /['"][a-zA-Z0-9_.\-\/]+['"]|[a-zA-Z0-9_-]+/);
		if (!wordRange) {
			return undefined;
		}

		let componentName = document.getText(wordRange);
		
		// Remover aspas caso existam
		componentName = componentName.replace(/['"]/g, '');

		// Se a palavra for uma keyword do Scriban, não buscar como arquivo
		if (SCRIBAN_KEYWORDS.has(componentName)) {
			return undefined;
		}

		// Garante que só funcione dentro de tags Scriban {{ ... }}
		const lineText = document.lineAt(position.line).text;
		if (!lineText.includes('{{') && !lineText.includes('}}')) {
			return undefined;
		}

		// Extrai apenas o nome do arquivo se vier com caminho "pasta/pasta/arquivo" -> "arquivo"
		const fileName = componentName.substring(componentName.lastIndexOf('/') + 1);
		
		// Se o componente não tiver extensão na string, procura por qualquer extensão
		// Na Wake geralmente são .html 
		const searchName = fileName.includes('.') ? fileName : `${fileName}.*`;
		
		// Procura na workspace por arquivos com esse nome (em qualquer pasta, ex: "Components" ou "home")
		const files = await vscode.workspace.findFiles(`**/${searchName}`, '**/node_modules/**');

		if (files.length > 0) {
			// Retorna todas as ocorrências encontradas.
			return files.map(uri => new vscode.Location(uri, new vscode.Position(0, 0)));
		}

		return undefined;
	}
}

let scribanDecorationType: vscode.TextEditorDecorationType;

function updateDecorationSettings() {
	const config = vscode.workspace.getConfiguration('scribanIndent.decoration');
	const color = config.get<string>('color') || '#FE0877';
	const fontWeight = config.get<string>('fontWeight') || 'bold';
	const backgroundColor = config.get<string>('backgroundColor') || 'rgba(150, 150, 150, 0.2)';
	const borderRadius = config.get<string>('borderRadius') || '4px';

	if (scribanDecorationType) {
		scribanDecorationType.dispose();
	}

	scribanDecorationType = vscode.window.createTextEditorDecorationType({
		color,
		fontWeight,
		backgroundColor,
		borderRadius,
	});

	for (const editor of vscode.window.visibleTextEditors) {
		updateDecorations(editor);
	}
}

function updateDecorations(activeEditor: vscode.TextEditor | undefined) {
	if (!activeEditor || activeEditor.document.languageId !== 'html' || !scribanDecorationType) {
		return;
	}

	const text = activeEditor.document.getText();
	const scribanTags: vscode.DecorationOptions[] = [];
	
	// Regex para encontrar os blocos Scriban
	const regex = /\{\{[~-]?[\s\S]*?[~-]?\}\}/g;

	let match;
	while ((match = regex.exec(text))) {
		const fullMatch = match[0];
		
		// Tamanho da abertura ({{, {{~, {{-)
		let openLen = 2;
		if (fullMatch.startsWith('{{~') || fullMatch.startsWith('{{-')) {
			openLen = 3;
		}

		// Tamanho do fechamento (}}, ~}}, -}})
		let closeLen = 2;
		if (fullMatch.endsWith('~}}') || fullMatch.endsWith('-}}')) {
			closeLen = 3;
		}

		// Destaca a abertura "{{", "{{~"
		const startPosOpen = activeEditor.document.positionAt(match.index);
		const endPosOpen = activeEditor.document.positionAt(match.index + openLen);
		scribanTags.push({ range: new vscode.Range(startPosOpen, endPosOpen) });

		// Destaca o fechamento "}}", "~}}"
		const startPosClose = activeEditor.document.positionAt(match.index + fullMatch.length - closeLen);
		const endPosClose = activeEditor.document.positionAt(match.index + fullMatch.length);
		scribanTags.push({ range: new vscode.Range(startPosClose, endPosClose) });
	}

	// Aplica a decoração visual
	activeEditor.setDecorations(scribanDecorationType, scribanTags);
}

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "scriban-html-indentation" is now active!');

	const formatter = vscode.languages.registerDocumentFormattingEditProvider(
		{ language: 'html' },
		new ScribanHtmlFormatter(),
	);

	const definitionProvider = vscode.languages.registerDefinitionProvider(
		{ language: 'html' },
		new ScribanComponentDefinitionProvider(),
	);

	context.subscriptions.push(formatter, definitionProvider);

	updateDecorationSettings();

	vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('scribanIndent.decoration')) {
			updateDecorationSettings();
		}
	}, null, context.subscriptions);

	// Evento disparado quando o texto muda (digitação)
	vscode.workspace.onDidChangeTextDocument(event => {
		if (vscode.window.activeTextEditor && event.document === vscode.window.activeTextEditor.document) {
			updateDecorations(vscode.window.activeTextEditor);
		}
	}, null, context.subscriptions);

	// Evento disparado ao trocar de aba/documento ativo
	vscode.window.onDidChangeActiveTextEditor(editor => {
		if (editor) {
			updateDecorations(editor);
		}
	}, null, context.subscriptions);

	// Executa a primeira vez ao iniciar a extensão, caso a aba ativa já seja um HTML
	if (vscode.window.activeTextEditor) {
		updateDecorations(vscode.window.activeTextEditor);
	}
}

export function deactivate() {}
