export function css(style: Partial<CSSStyleDeclaration>) {
	return Object.entries(style)
		.map(([key, val]) => `${kebabify(key)}:${val}`)
		.join(';');
}

function kebabify(str: string) {
	return str.replace(/[A-Z]+(?![a-z])|[A-Z]/g, ($, ofs) => (ofs ? '-' : '') + $.toLowerCase());
}
