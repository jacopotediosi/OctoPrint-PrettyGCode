/**
 * Turns an HTML string into an element
 * @param markup - HTML with a single root element
 * @returns The element the markup describes
 */
export function htmlStringToElement (markup: string): HTMLElement {
  const template = document.createElement('template')
  template.innerHTML = markup.trim()
  return template.content.firstElementChild as HTMLElement
}
