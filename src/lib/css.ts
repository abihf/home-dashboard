type CssProps = {
  [K in keyof CSSStyleDeclaration]?: CSSStyleDeclaration[K] extends string | number
    ? CSSStyleDeclaration[K]
    : never;
};

export function css(style: CssProps) {
  return Object.entries(style)
    .map(([key, val]) => val ?? `${kebabify(key)}:${val}`)
    .filter(Boolean)
    .join(";");
}

function kebabify(str: string) {
  return str.replace(/[A-Z]+(?![a-z])|[A-Z]/g, ($, ofs) => (ofs ? "-" : "") + $.toLowerCase());
}
