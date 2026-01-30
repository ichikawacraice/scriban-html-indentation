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

function analyzeScribanSegments(segments: string[]) {
	let openCount = 0;
	let middleCount = 0;
	let closeCount = 0;

	// Só conta keywords quando são o comando principal no início do segmento
	// (evita contar "end" dentro de expressões como ;end) em lambdas)
	const closeStart = /^\s*end\b/;
	const middleStart = /^\s*(else|elsif|when)\b/;
	const openStart = /^\s*(if|for|case|while|capture|wrap)\b/;

	for (const segment of segments) {
		const trimmed = segment
			.replace(/^[\s~-]+/, '')
			.replace(/[\s~-]+$/, '')
			.toLowerCase();
		if (closeStart.test(trimmed)) {
			closeCount += 1;
		} else if (middleStart.test(trimmed)) {
			middleCount += 1;
		} else if (openStart.test(trimmed)) {
			openCount += 1;
		}
	}

	return { openCount, middleCount, closeCount };
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
		const { openCount, middleCount, closeCount } = analyzeScribanSegments(scribanSegments);
		const { openingTags, closingTags, leadingClosings } = analyzeHtmlLine(original);

		const preDecrease = closeCount + middleCount + leadingClosings;
		indentLevel = Math.max(indentLevel - preDecrease, 0);

		const isScribanClosingOnly = /^\s*[-~]?\s*}}$/.test(original);
		const tagIndentOffset = wasInScribanTag && !isScribanClosingOnly ? 1 : 0;
		const indentCount = indentLevel + tagIndentOffset;

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

		const remainingClosings = Math.max(0, closingTags - leadingClosings);
		indentLevel = Math.max(
			indentLevel + openCount + middleCount + openingTags - remainingClosings,
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
	return applyScribanIndentation(restored, indentUnit);
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

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "scriban-indent" is now active!');

	const formatter = vscode.languages.registerDocumentFormattingEditProvider(
		{ language: 'html' },
		new ScribanHtmlFormatter(),
	);

	context.subscriptions.push(formatter);
}

export function deactivate() {}
