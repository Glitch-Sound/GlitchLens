import mermaid from 'mermaid';

const FALLBACK_COLORS = {
	background: '#1e1e1e',
	primaryColor: '#252526',
	primaryTextColor: '#cccccc',
	primaryBorderColor: '#858585',
	lineColor: '#858585',
	textColor: '#cccccc',
	actorBorder: '#858585',
	actorBkg: '#252526',
	actorTextColor: '#cccccc',
	signalColor: '#cccccc',
	signalTextColor: '#cccccc',
	labelBoxBkgColor: '#252526',
	labelTextColor: '#cccccc',
	loopTextColor: '#cccccc',
	noteBkgColor: '#2d2d30',
	noteTextColor: '#cccccc',
	noteBorderColor: '#858585',
};

const THEME_COLOR_SOURCES = {
	background: '--vscode-editor-background',
	primaryColor: '--vscode-sideBar-background',
	primaryTextColor: '--vscode-editor-foreground',
	primaryBorderColor: '--vscode-panel-border',
	lineColor: '--vscode-panel-border',
	textColor: '--vscode-editor-foreground',
	actorBorder: '--vscode-panel-border',
	actorBkg: '--vscode-sideBar-background',
	actorTextColor: '--vscode-editor-foreground',
	signalColor: '--vscode-editor-foreground',
	signalTextColor: '--vscode-editor-foreground',
	labelBoxBkgColor: '--vscode-sideBar-background',
	labelTextColor: '--vscode-editor-foreground',
	loopTextColor: '--vscode-editor-foreground',
	noteBkgColor: '--vscode-textBlockQuote-background',
	noteTextColor: '--vscode-editor-foreground',
	noteBorderColor: '--vscode-textBlockQuote-border',
};

let mermaidInitialized = false;
try {
	mermaid.initialize({
		startOnLoad: false,
		securityLevel: 'strict',
		theme: 'base',
		themeVariables: resolveThemeVariables(),
	});
	mermaidInitialized = true;
} catch {
	// Rendering will show the original Mermaid text if initialization fails.
}

void renderMermaidDiagram();

function resolveThemeVariables() {
	const computed = getComputedStyle(document.documentElement);
	const variables = {};
	for (const [name, fallback] of Object.entries(FALLBACK_COLORS)) {
		const themeValue = computed.getPropertyValue(THEME_COLOR_SOURCES[name]).trim();
		variables[name] = isConcreteColor(themeValue) ? themeValue : fallback;
	}
	return variables;
}

function isConcreteColor(value) {
	if (!value || value.includes('var(') || value === 'currentColor') {
		return false;
	}
	return /^(#[0-9a-f]{3,8}|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\))$/i.test(value);
}

async function renderMermaidDiagram() {
	const diagram = document.getElementById('diagram');
	if (!diagram || GLITCHLENS_VIEW_MODEL.renderMode !== 'mermaid') {
		return;
	}
	const mermaidText = GLITCHLENS_VIEW_MODEL.mermaidText;
	if (!mermaidText) {
		showFallback(diagram, GLITCHLENS_VIEW_MODEL.fallbackText);
		return;
	}
	if (!mermaidInitialized) {
		showFallback(diagram, mermaidText);
		return;
	}
	try {
		const result = await mermaid.render('glitchlens-mermaid-diagram', mermaidText);
		diagram.innerHTML = addNonceToSvgStyles(result.svg, GLITCHLENS_VIEW_MODEL.cspNonce);
		decorateSequenceControls(diagram);
		document.body.dataset.render = 'mermaid';
	} catch {
		showFallback(diagram, mermaidText);
	}
}

const CONTROL_CLASS_BY_KEYWORD = {
	loop: 'glitchlens-control-loop',
	alt: 'glitchlens-control-alt',
	opt: 'glitchlens-control-opt',
	critical: 'glitchlens-control-critical',
	option: 'glitchlens-control-option',
};

function decorateSequenceControls(diagram) {
	for (const text of diagram.querySelectorAll('svg text')) {
		const keyword = readControlKeyword(text.textContent);
		if (!keyword) {
			continue;
		}
		const group = findControlGroup(text);
		group?.classList.add(CONTROL_CLASS_BY_KEYWORD[keyword]);
	}
}

function readControlKeyword(value) {
	const keyword = value?.trim().split(/\s+/, 1)[0]?.toLowerCase();
	return Object.hasOwn(CONTROL_CLASS_BY_KEYWORD, keyword) ? keyword : undefined;
}

function findControlGroup(text) {
	let current = text.closest('g');
	for (let depth = 0; current && depth < 4; depth += 1) {
		if (current.querySelector('rect,path,line,polygon')) {
			return current;
		}
		current = current.parentElement?.closest('g');
	}
	return text.closest('svg');
}

function addNonceToSvgStyles(svg, nonce) {
	if (!nonce) {
		return svg;
	}
	const template = document.createElement('template');
	template.innerHTML = svg;
	for (const style of template.content.querySelectorAll('style')) {
		style.setAttribute('nonce', nonce);
	}
	return template.innerHTML;
}

function showFallback(diagram, text) {
	document.body.dataset.render = 'fallback';
	diagram.textContent = '';
	const fallback = document.createElement('pre');
	fallback.textContent = text;
	diagram.append(fallback);
}
