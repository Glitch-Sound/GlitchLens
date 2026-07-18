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
		sequence: {
			actorMargin: 40,
			messageMargin: 70,
			diagramMarginX: 8,
			diagramMarginY: 10,
			boxMargin: 22,
			boxTextMargin: 12,
			noteMargin: 12,
			useMaxWidth: false,
		},
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
		centerParticipantLabels(diagram);
		decorateSequenceParticipants(diagram);
		decorateSequenceMessages(diagram);
		decorateSequenceControls(diagram);
		decorateProcessNotes(diagram);
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

const CONTROL_COLOR_BY_KEYWORD = {
	loop: '#9fd0ff',
	alt: '#8ff2ff',
	opt: '#fde68a',
	critical: '#ddd6fe',
	option: '#fbcfe8',
};

const GLITCHLENS_MESSAGE_LABEL_OFFSET_Y = 20;

function decorateSequenceControls(diagram) {
	for (const text of diagram.querySelectorAll('svg text.labelText')) {
		const keyword = readControlKeyword(text.textContent);
		if (!keyword) {
			continue;
		}
		const group = findControlGroup(text);
		const className = CONTROL_CLASS_BY_KEYWORD[keyword];
		const color = CONTROL_COLOR_BY_KEYWORD[keyword];
		group?.classList.add(className);
		styleControlFragmentTypeLabel(text, className, color);
		for (const shape of findOwnControlShapes(group)) {
			shape.classList.add(className);
			shape.setAttribute('stroke', color);
			shape.setAttribute('fill', '#202732');
			shape.setAttribute('stroke-width', '1.8');
			shape.setAttribute('stroke-dasharray', 'none');
		}
	}
	for (const conditionLabel of diagram.querySelectorAll('svg text.loopText, svg text.sectionTitle')) {
		const group = findControlGroup(conditionLabel);
		const fragmentTypeLabel = findFragmentTypeLabel(group);
		const keyword = readControlKeyword(fragmentTypeLabel?.textContent);
		if (!keyword) {
			continue;
		}
		styleControlConditionLabel(conditionLabel, CONTROL_CLASS_BY_KEYWORD[keyword], CONTROL_COLOR_BY_KEYWORD[keyword]);
	}
}

function decorateProcessNotes(diagram) {
	const decorations = Array.isArray(GLITCHLENS_VIEW_MODEL.processNoteDecorations)
		? GLITCHLENS_VIEW_MODEL.processNoteDecorations
		: [];
	if (decorations.length === 0) {
		return;
	}
	const lines = (GLITCHLENS_VIEW_MODEL.mermaidText ?? '').split(/\r?\n/);
	const noteIndexesByLine = new Map();
	let noteIndex = 0;
	for (let index = 0; index < lines.length; index += 1) {
		if (lines[index]?.trim().startsWith('Note ')) {
			noteIndexesByLine.set(index + 1, noteIndex);
			noteIndex += 1;
		}
	}
	const noteGroups = [...diagram.querySelectorAll('svg g[data-et="note"]')];
	for (const decoration of decorations) {
		const noteIndexForLine = noteIndexesByLine.get(decoration.mermaidLine);
		if (noteIndexForLine === undefined || noteIndexForLine >= noteGroups.length) {
			continue;
		}
		const group = noteGroups[noteIndexForLine];
		group.classList.add('glitchlens-process-note');
		group.dataset.processNoteKind = decoration.nodeKind;
	}
}

function findOwnControlShapes(group) {
	if (!group) {
		return [];
	}
	return [...group.querySelectorAll('rect,path,line,polygon')].filter((shape) => findControlGroup(shape) === group);
}

function findFragmentTypeLabel(group) {
	if (!group) {
		return undefined;
	}
	return [...group.querySelectorAll('text.labelText')].find((label) => findControlGroup(label) === group);
}

function styleControlFragmentTypeLabel(text, className, color) {
	text.classList.add(className);
	text.setAttribute('fill', color);
}

function styleControlConditionLabel(text, className, color) {
	text.classList.add(className);
	text.setAttribute('fill', color);
}

function decorateSequenceParticipants(diagram) {
	for (const group of diagram.querySelectorAll('svg g[id^="root-"]')) {
		group.classList.add('glitchlens-root-participant');
	}
	const rootName = GLITCHLENS_VIEW_MODEL.rootFunctionName;
	for (const text of diagram.querySelectorAll('svg text')) {
		const label = text.textContent?.trim();
		if (label === 'root' || (rootName && label === rootName)) {
			findSvgGroup(text)?.classList.add('glitchlens-root-participant');
		}
	}
}

function centerParticipantLabels(diagram) {
	for (const text of diagram.querySelectorAll('svg text.actor.actor-box, svg g.actor text, svg g.actor-top text, svg g.actor-bottom text')) {
		text.setAttribute('text-anchor', 'middle');
		text.setAttribute('dominant-baseline', 'middle');
		text.setAttribute('alignment-baseline', 'middle');
		text.style.setProperty('text-anchor', 'middle');
		text.style.setProperty('dominant-baseline', 'middle');
		text.style.setProperty('alignment-baseline', 'middle');
	}
}

function decorateSequenceMessages(diagram) {
	for (const text of diagram.querySelectorAll('svg text.messageText')) {
		text.style.setProperty('transform', `translateY(${GLITCHLENS_MESSAGE_LABEL_OFFSET_Y}px)`, 'important');
		text.classList.add('glitchlens-message-label');
	}
	for (const text of diagram.querySelectorAll('svg text')) {
		const label = text.textContent?.trim().toLowerCase() ?? '';
		if (!label) {
			continue;
		}
		const group = findSvgGroup(text);
		if (label.startsWith('return')) {
			group?.classList.add('glitchlens-return-message');
		} else if (label.startsWith('await ') || label.includes(': await ') || label.includes(' await ')) {
			group?.classList.add('glitchlens-await-message');
		}
	}
}

function readControlKeyword(value) {
	const keyword = value?.trim().split(/\s+/, 1)[0]?.toLowerCase();
	return Object.hasOwn(CONTROL_CLASS_BY_KEYWORD, keyword) ? keyword : undefined;
}

function findControlGroup(text) {
	return text.closest('g[data-et="control-structure"]');
}

function findSvgGroup(text) {
	return text.closest('g') ?? text.closest('svg');
}

function addNonceToSvgStyles(svg, nonce) {
	const template = document.createElement('template');
	template.innerHTML = svg;
	for (const style of template.content.querySelectorAll('style')) {
		if (nonce) {
			style.setAttribute('nonce', nonce);
		}
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
