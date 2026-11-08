import hljs from 'highlight.js/lib/common';

export interface HighlightedToken {
	className: string | null;
	text: string;
}

export interface QuestionTextSegment {
	type: 'text' | 'code';
	content: string;
	language?: string;
	highlightedHtml?: string;
	tokens?: HighlightedToken[];
}

const LANGUAGE_ALIASES: Record<string, string> = {
	js: 'javascript',
	ts: 'typescript',
	py: 'python',
	sh: 'bash',
	shell: 'bash',
	zsh: 'bash',
	c: 'c',
	cpp: 'cpp',
	'c++': 'cpp',
	cs: 'csharp',
	'c#': 'csharp',
	html: 'xml',
	htm: 'xml'
};

const AUTO_DETECT_LANGUAGES = [
	'python',
	'javascript',
	'typescript',
	'c',
	'cpp',
	'java',
	'csharp',
	'sql',
	'xml',
	'css',
	'go',
	'rust',
	'php',
	'ruby',
	'bash',
	'json'
];

function decodeHtmlEntities(input: string): string {
	return input
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#x27;|&#39;/g, "'")
		.replace(/&amp;/g, '&');
}

export function htmlToHighlightTokens(hljsHtml: string): HighlightedToken[] {
	const tokens: HighlightedToken[] = [];
	const classStack: string[] = [];
	const tagRegex = /<\/?span(?:\s+class="([^"]*)")?\s*>/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = tagRegex.exec(hljsHtml)) !== null) {
		if (match.index > lastIndex) {
			const rawChunk = hljsHtml.slice(lastIndex, match.index);
			const text = decodeHtmlEntities(rawChunk);
			if (text) {
				const activeClass = classStack.length > 0 ? classStack.join(' ') : null;
				tokens.push({ className: activeClass, text });
			}
		}

		const fullTag = match[0];
		if (fullTag.startsWith('</span')) {
			classStack.pop();
		} else {
			classStack.push(match[1] ?? '');
		}

		lastIndex = match.index + fullTag.length;
	}

	if (lastIndex < hljsHtml.length) {
		const text = decodeHtmlEntities(hljsHtml.slice(lastIndex));
		if (text) {
			const activeClass = classStack.length > 0 ? classStack.join(' ') : null;
			tokens.push({ className: activeClass, text });
		}
	}

	return tokens;
}

function normalizeLanguage(lang?: string): string | undefined {
	if (!lang) return undefined;
	const cleaned = lang.trim().toLowerCase();
	if (!cleaned || cleaned === 'code' || cleaned === 'auto') return undefined;
	const mapped = LANGUAGE_ALIASES[cleaned] ?? cleaned;
	return hljs.getLanguage(mapped) ? mapped : undefined;
}

export function inferLanguageFromQuestionText(questionHeader: string): string | undefined {
	const lower = questionHeader.toLowerCase();
	if (/\bpython\b/.test(lower)) return 'python';
	if (/\btypescript\b/.test(lower)) return 'typescript';
	if (/\b(javascript|js|node\.?js)\b/.test(lower)) return 'javascript';
	if (/(?:^|\s)(c\+\+|cpp)(?:\s|$|[?,.:!])/i.test(questionHeader)) return 'cpp';
	if (/(?:^|\s)(c#|csharp|\.net)(?:\s|$|[?,.:!])/i.test(questionHeader)) return 'csharp';
	if (/\bjava\b/.test(lower)) return 'java';
	if (/\b(c\s+code|c\s+program|c\s+snippet|in\s+c|following\s+c)\b/.test(lower)) return 'c';
	if (/\bsql\b/.test(lower)) return 'sql';
	if (/\bhtml\b/.test(lower)) return 'xml';
	if (/\bcss\b/.test(lower)) return 'css';
	if (/\b(bash|shell)\b/.test(lower)) return 'bash';
	if (/\brust\b/.test(lower)) return 'rust';
	if (/\b(golang|go\s+code|go\s+program|in\s+go)\b/.test(lower)) return 'go';
	if (/\bphp\b/.test(lower)) return 'php';
	if (/\bruby\b/.test(lower)) return 'ruby';
	return undefined;
}

export function inferLanguageFromCode(code: string): string | undefined {
	const trimmed = code.trim();
	if (!trimmed) return undefined;

	// C++ signatures
	if (
		/\b(std::|cout\s*<<|cin\s*>>|endl\b|vector\s*<|string\s+\w+\s*=|#include\s*<(iostream|vector|string|algorithm)>)/.test(
			trimmed
		)
	) {
		return 'cpp';
	}

	// C signatures
	if (
		/(#include\s*<(stdio|stdlib|string|math)\.h>|\bprintf\s*\(|\bscanf\s*\(|\bmalloc\s*\(|\bsizeof\s*\(|%[0-9.]*[dfscxup]\b)/.test(
			trimmed
		)
	) {
		return 'c';
	}

	// Java signatures
	if (
		/\b(System\.out\.print(ln|f)?|public\s+static\s+void\s+main|public\s+class\s+\w+|String\[\]\s+\w+|ArrayList\s*<|Integer\.parseInt)/.test(
			trimmed
		)
	) {
		return 'java';
	}

	// C# signatures
	if (
		/\b(Console\.Write(Line)?|using\s+System|namespace\s+[A-Z]\w*|List<\w+>\s+\w+\s*=)/.test(
			trimmed
		)
	) {
		return 'csharp';
	}

	// Rust signatures
	if (/\b(println!\s*\(|fn\s+\w+\s*\(|let\s+mut\s+\w+|vec!\[|impl\s+\w+)/.test(trimmed)) {
		return 'rust';
	}

	// Go signatures
	if (/\b(fmt\.Print(ln|f)?|package\s+main|func\s+\w+\s*\()|\b[a-zA-Z_]\w*\s*:=\s*/.test(trimmed)) {
		return 'go';
	}

	// PHP signatures
	if (/(<\?php|\$[a-zA-Z_]\w*\s*=|\becho\s+\$[a-zA-Z_])/.test(trimmed)) {
		return 'php';
	}

	// SQL signatures
	if (
		/\b(SELECT\s+[\s\S]+?\s+FROM\s+\w+|INSERT\s+INTO\s+\w+|UPDATE\s+\w+\s+SET\s+|DELETE\s+FROM\s+\w+|CREATE\s+TABLE\s+\w+)/i.test(
			trimmed
		)
	) {
		return 'sql';
	}

	// HTML signatures
	if (
		/^\s*<(!DOCTYPE|html|head|body|div|span|p|a|ul|ol|li|table|form|input|button|h[1-6])\b/i.test(
			trimmed
		)
	) {
		return 'xml';
	}

	// TypeScript signatures
	if (
		/\b(interface\s+[A-Z]\w*|type\s+[A-Z]\w*\s*=)|:\s*(string|number|boolean|any|unknown|never)(\[\])?\s*[=;,)]/.test(
			trimmed
		)
	) {
		return 'typescript';
	}

	// JavaScript signatures
	if (
		/\b(console\.(log|warn|error|info)|const\s+[a-zA-Z_$]|let\s+[a-zA-Z_$]|var\s+[a-zA-Z_$]|function\s+\w+\s*\(|document\.(getElementById|querySelector)|===|!==|=>)/.test(
			trimmed
		)
	) {
		return 'javascript';
	}

	// Python signatures
	const hasBracesOrSemicolons = /[;{}]/.test(trimmed);
	if (
		/\b(def\s+\w+\s*\(|elif\s+|range\s*\(|len\s*\(|input\s*\(|isinstance\s*\(|lambda\s+\w*:)/.test(
			trimmed
		) ||
		(!hasBracesOrSemicolons &&
			(/\b(print\s*\(|for\s+\w+\s+in\s+|if\s+[^()\n]+:|while\s+[^()\n]+:|True\b|False\b|None\b)/.test(
				trimmed
			) ||
				/\w+\.(append|extend|pop|split|strip|items|keys|values)\s*\(/.test(trimmed)))
	) {
		return 'python';
	}

	// C-family typed declarations fallback (e.g. int a = 2; int b = 3;)
	if (/\b(int|float|double|char|long|short|void|bool)\s+[a-zA-Z_]\w*\s*(=|;|\[|\()/.test(trimmed)) {
		return 'c';
	}

	return undefined;
}

function looksLikeCodeSnippet(block: string, questionHeader: string): boolean {
	const trimmed = block.trim();
	if (!trimmed) return false;

	if (inferLanguageFromCode(trimmed)) return true;

	const codeQuestionHint =
		/\b(code|snippet|program|output|print|prints|printed|console|function|method|loop|variable|compile|statement|expression|evaluates?|returns?)\b/i.test(
			questionHeader
		);

	const hasCodeSyntax =
		/[{};()]/.test(trimmed) ||
		/\b(def|for|while|if|elif|else|return|class|import|from|print|printf|cout|cin|int|float|double|char|bool|void|const|let|var|function|public|private|static|SELECT|FROM|WHERE)\b/.test(
			trimmed
		) ||
		/[a-zA-Z_]\w*\s*(\+|-|\*|\/)?=\s*[^=]/.test(trimmed) ||
		/^ {2,}\S/m.test(trimmed);

	if (codeQuestionHint && hasCodeSyntax) return true;
	if (trimmed.includes('\n') && hasCodeSyntax && /[=();{}]/.test(trimmed)) return true;
	return false;
}

export function highlightCodeSnippet(
	code: string,
	languageHint?: string
): { html: string; language: string; tokens: HighlightedToken[] } {
	const detectedLang = normalizeLanguage(languageHint) ?? inferLanguageFromCode(code);

	if (detectedLang) {
		try {
			const res = hljs.highlight(code, { language: detectedLang, ignoreIllegals: true });
			return {
				html: res.value,
				language: detectedLang,
				tokens: htmlToHighlightTokens(res.value)
			};
		} catch {
			// Fall back to auto detection
		}
	}

	const auto = hljs.highlightAuto(code, AUTO_DETECT_LANGUAGES);
	return {
		html: auto.value,
		language: auto.language ?? 'code',
		tokens: htmlToHighlightTokens(auto.value)
	};
}

export function parseQuestionSegments(rawText: string): QuestionTextSegment[] {
	const text = rawText.trim();
	if (!text) return [];

	const fenceRegex = /```([a-zA-Z0-9_+#.-]*)[ \t]*\n?([\s\S]*?)```/g;
	if (fenceRegex.test(text)) {
		fenceRegex.lastIndex = 0;
		const segments: QuestionTextSegment[] = [];
		let lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = fenceRegex.exec(text)) !== null) {
			const before = text.slice(lastIndex, match.index).trim();
			if (before) {
				segments.push({ type: 'text', content: before });
			}
			const rawLang = match[1]?.trim() || undefined;
			const codeContent = (match[2] ?? '').replace(/^\n+|\n+$/g, '');
			if (codeContent) {
				const prevText = segments.findLast((s) => s.type === 'text')?.content ?? '';
				const langHint =
					inferLanguageFromCode(codeContent) ?? inferLanguageFromQuestionText(prevText) ?? rawLang;
				const highlighted = highlightCodeSnippet(codeContent, langHint);
				segments.push({
					type: 'code',
					content: codeContent,
					language: highlighted.language,
					highlightedHtml: highlighted.html,
					tokens: highlighted.tokens
				});
			}
			lastIndex = match.index + match[0].length;
		}

		const after = text.slice(lastIndex).trim();
		if (after) {
			segments.push({ type: 'text', content: after });
		}
		return segments;
	}

	// Fallback 1: check if the prompt is split by a blank line (\n\n) into a question + code block
	const doubleNewlineIndex = text.indexOf('\n\n');
	if (doubleNewlineIndex !== -1) {
		const header = text.slice(0, doubleNewlineIndex).trim();
		const rest = text.slice(doubleNewlineIndex + 2).trim();
		if (header && rest && looksLikeCodeSnippet(rest, header)) {
			const langHint = inferLanguageFromCode(rest) ?? inferLanguageFromQuestionText(header);
			const highlighted = highlightCodeSnippet(rest, langHint);
			return [
				{ type: 'text', content: header },
				{
					type: 'code',
					content: rest,
					language: highlighted.language,
					highlightedHtml: highlighted.html,
					tokens: highlighted.tokens
				}
			];
		}
	}

	// Fallback 2: check if the first line is a question/prompt (or ends with ? or :) followed by code lines
	const firstNewlineIndex = text.indexOf('\n');
	if (firstNewlineIndex !== -1) {
		const firstLine = text.slice(0, firstNewlineIndex).trim();
		const remainingLines = text.slice(firstNewlineIndex + 1).trim();
		if (firstLine && remainingLines && looksLikeCodeSnippet(remainingLines, firstLine)) {
			const langHint =
				inferLanguageFromCode(remainingLines) ?? inferLanguageFromQuestionText(firstLine);
			const highlighted = highlightCodeSnippet(remainingLines, langHint);
			return [
				{ type: 'text', content: firstLine },
				{
					type: 'code',
					content: remainingLines,
					language: highlighted.language,
					highlightedHtml: highlighted.html,
					tokens: highlighted.tokens
				}
			];
		}
	}

	// Fallback 3: single-line question + inline code after '?' or ':'
	const inlineSplitMatch = text.match(/^([^?\n:]{10,}[?:])\s+([\s\S]+)$/);
	if (inlineSplitMatch) {
		const header = inlineSplitMatch[1]!.trim();
		const rawInlineCode = inlineSplitMatch[2]!.trim().replace(/^`+|`+$/g, '');
		if (header && rawInlineCode && looksLikeCodeSnippet(rawInlineCode, header)) {
			const formattedCode =
				!rawInlineCode.includes('\n') && rawInlineCode.includes(';')
					? rawInlineCode
							.split(/;\s*/)
							.map((s) => s.trim())
							.filter(Boolean)
							.map((s) => (s.endsWith(';') || s.endsWith('}') ? s : `${s};`))
							.join('\n')
					: rawInlineCode;
			const langHint =
				inferLanguageFromCode(formattedCode) ?? inferLanguageFromQuestionText(header);
			const highlighted = highlightCodeSnippet(formattedCode, langHint);
			return [
				{ type: 'text', content: header },
				{
					type: 'code',
					content: formattedCode,
					language: highlighted.language,
					highlightedHtml: highlighted.html,
					tokens: highlighted.tokens
				}
			];
		}
	}

	return [{ type: 'text', content: text }];
}

export function hasCodeSegment(rawText: string): boolean {
	return parseQuestionSegments(rawText).some((segment) => segment.type === 'code');
}

export function splitQuestionPromptAndCode(rawText: string): {
	promptText: string;
	code: string;
	language: string;
} {
	const segments = parseQuestionSegments(rawText);
	const textParts = segments.filter((s) => s.type === 'text').map((s) => s.content.trim());
	const codeSegments = segments.filter((s) => s.type === 'code');

	if (codeSegments.length === 0) {
		return {
			promptText: rawText,
			code: '',
			language: ''
		};
	}

	const combinedCode = codeSegments.map((s) => s.content).join('\n\n');
	const promptText = textParts.join('\n\n') || 'What is the output of the following code?';
	const detectedLanguage =
		inferLanguageFromCode(combinedCode) ??
		inferLanguageFromQuestionText(promptText) ??
		codeSegments[0]?.language ??
		'';

	return {
		promptText,
		code: combinedCode,
		language: detectedLanguage
	};
}

export function combineQuestionPromptAndCode(
	promptText: string,
	code: string,
	language?: string
): string {
	const cleanPrompt = promptText.trim();
	const cleanCode = code.replace(/^\n+|\n+$/g, '');
	if (!cleanCode.trim()) {
		return cleanPrompt;
	}
	const autoLang =
		inferLanguageFromCode(cleanCode) ??
		inferLanguageFromQuestionText(cleanPrompt) ??
		(language && language !== 'code' ? language.trim() : '');
	return `${cleanPrompt}\n\n\`\`\`${autoLang}\n${cleanCode}\n\`\`\``;
}
