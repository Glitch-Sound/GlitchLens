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
			noteMargin: 20,
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
		const result = await mermaid.render('glitchlens-mermaid-diagram', buildMermaidRenderText(mermaidText));
		diagram.innerHTML = addNonceToSvgStyles(result.svg, GLITCHLENS_VIEW_MODEL.cspNonce);
		centerParticipantLabels(diagram);
		decorateSequenceParticipants(diagram);
		decorateSequenceMessages(diagram);
		decorateSequenceControls(diagram);
		document.body.dataset.render = 'mermaid';
	} catch {
		showFallback(diagram, mermaidText);
	}
}

function buildMermaidRenderText(mermaidText) {
	const activeParticipants = [];
	const output = [];
	const lines = mermaidText.split(/\r?\n/);
	const rootParticipantId = readRootParticipantId(lines);
	let rootActivated = false;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const message = parseSequenceMessage(line);
		if (!rootActivated && shouldActivateRootBefore(lines, index)) {
			output.push(`activate ${rootParticipantId}`);
			rootActivated = true;
		}
		output.push(line);
		if (!message) {
			continue;
		}
		if (message.kind === 'return') {
			if (activeParticipants.at(-1) === message.from) {
				activeParticipants.pop();
				output.push(`${message.indent}deactivate ${message.from}`);
			}
			continue;
		}
		if (message.to === rootParticipantId) {
			continue;
		}
		output.push(`${message.indent}activate ${message.to}`);
		const nextMessage = parseSequenceMessage(lines[index + 1] ?? '');
		if (nextMessage?.kind === 'return' && nextMessage.from === message.to) {
			activeParticipants.push(message.to);
			continue;
		}
		output.push(`${message.indent}deactivate ${message.to}`);
	}
	for (let index = activeParticipants.length - 1; index >= 0; index -= 1) {
		output.push(`deactivate ${activeParticipants[index]}`);
	}
	if (!rootActivated && lines.some(line => line.trim() === 'sequenceDiagram')) {
		output.push(`activate ${rootParticipantId}`);
		rootActivated = true;
	}
	if (rootActivated) {
		output.push(`deactivate ${rootParticipantId}`);
	}
	return output.join('\n');
}

function shouldActivateRootBefore(lines, index) {
	const current = lines[index]?.trim() ?? '';
	if (!lines.some(line => line.trim() === 'sequenceDiagram')) {
		return false;
	}
	if (!current) {
		return false;
	}
	if (current === 'sequenceDiagram' || current.startsWith('participant ') || current.startsWith('autonumber')) {
		return false;
	}
	return lines.slice(0, index).some(line => line.trim() === 'sequenceDiagram');
}

function readRootParticipantId(lines) {
	const rootName = GLITCHLENS_VIEW_MODEL.rootFunctionName;
	for (const line of lines) {
		const participant = line.match(/^\s*participant\s+([^\s]+)(?:\s+as\s+(.+))?\s*$/);
		const id = participant?.[1];
		const label = participant?.[2]?.trim();
		if (id === 'root' || label === rootName) {
			return id;
		}
	}
	return 'root';
}

function parseSequenceMessage(line) {
	const match = line.match(/^(\s*)([^\s:]+)\s*(-{1,2}>>?)\s*([^\s:]+)\s*:\s*(.*)$/);
	if (!match) {
		return undefined;
	}
	const label = match[5]?.trim() ?? '';
	return {
		indent: match[1] ?? '',
		from: match[2] ?? '',
		to: match[4] ?? '',
		label,
		kind: (match[3]?.startsWith('--') || label.toLowerCase().startsWith('return')) ? 'return' : 'call',
	};
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
