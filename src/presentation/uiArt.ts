const UI_ART: Record<string, string> = {
  '--ui-blue': 'Buttons/BigBlueButton_Regular.png',
  '--ui-blue-down': 'Buttons/BigBlueButton_Pressed.png',
  '--ui-red': 'Buttons/BigRedButton_Regular.png',
  '--ui-ribbon': 'Ribbons/BigRibbons.png',
};

/** Aplica a arte de interface respeitando o subcaminho da publicação (ex.: `/RTS/`). */
export function applyUiArtVariables(style: Pick<CSSStyleDeclaration, 'setProperty'>, base: string): void {
  for (const [name, file] of Object.entries(UI_ART)) {
    style.setProperty(name, `url("${encodeURI(`${base}assets/tiny-swords/UI Elements/UI Elements/${file}`)}")`);
  }
}
