// jsdom does not implement Range.getClientRects()/getBoundingClientRect(), which
// ProseMirror's view layer calls when computing cursor coordinates (e.g. on focus/
// scrollIntoView). Node-environment tests never load this file's jsdom globals, so
// guard on `document` being defined.
if (typeof document !== "undefined") {
  const rect = (): DOMRect => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON() {
      return this;
    },
  });

  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = rect;
  }
}
