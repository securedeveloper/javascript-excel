/**
 * Structural types for the DOM APIs `javascript-excel/dom` uses.
 *
 * The package compiles against lib ES2022 without DOM types. These interfaces
 * describe only the members the code touches, so the same code runs on a real
 * DOM, on happy-dom or jsdom, and on a table from another window or iframe.
 */

export interface NodeLike {
  readonly nodeType: number; // 1 element, 3 text
  readonly nodeName: string;
  readonly childNodes: ArrayLike<NodeLike>;
  readonly textContent: string | null;
}

export interface CSSStyleLike {
  getPropertyValue(name: string): string;
}

export interface WindowLike {
  getComputedStyle(el: ElementLike): CSSStyleLike;
}

export interface ElementLike extends NodeLike {
  readonly tagName: string;
  readonly children: ArrayLike<ElementLike>;
  readonly parentElement: ElementLike | null;
  readonly ownerDocument: { readonly defaultView: WindowLike | null } | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  matches(selector: string): boolean;
  closest(selector: string): ElementLike | null;
}

/** An `<a>` element: `href` is the resolved absolute URL. */
export interface AnchorLike extends ElementLike {
  readonly href: string;
}

export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;

export function isElement(n: NodeLike): n is ElementLike {
  return n.nodeType === ELEMENT_NODE;
}
