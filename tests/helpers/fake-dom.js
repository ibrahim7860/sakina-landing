'use strict';
// A minimal DOM for node:test (the repo has no dependencies, so no jsdom).
// Enough for the feedback desk: elements, text nodes, attributes, events.
// Assigning innerHTML / outerHTML, or calling insertAdjacentHTML, THROWS —
// the desk must never parse markup, so a test that reaches one fails loudly.

class FakeNode {
  constructor(doc) {
    this.ownerDocument = doc;
    this.parentNode = null;
    this.childNodes = [];
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this.childNodes.slice().forEach((c) => this.removeChild(c));
    if (v !== '' && v != null) this.appendChild(this.ownerDocument.createTextNode(String(v)));
  }
}

class FakeText extends FakeNode {
  constructor(doc, text) {
    super(doc);
    this.nodeType = 3;
    this.data = text;
  }
  get textContent() {
    return this.data;
  }
  set textContent(v) {
    this.data = String(v);
  }
}

class FakeElement extends FakeNode {
  constructor(doc, tag) {
    super(doc);
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.attributes = {};
    this.listeners = {};
    this.className = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }
  getAttribute(k) {
    return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  dispatch(type) {
    const ev = { type, target: this, preventDefault() { this.defaultPrevented = true; } };
    (this.listeners[type] || []).forEach((fn) => fn(ev));
    return ev;
  }
  set innerHTML(_) {
    throw new Error('innerHTML assigned');
  }
  set outerHTML(_) {
    throw new Error('outerHTML assigned');
  }
  insertAdjacentHTML() {
    throw new Error('insertAdjacentHTML called');
  }
}

function createDocument() {
  const created = [];
  const doc = {
    created,
    createElement(tag) {
      const el = new FakeElement(doc, tag);
      created.push(el);
      return el;
    },
    createTextNode(text) {
      return new FakeText(doc, text);
    },
    write() {
      throw new Error('document.write called');
    }
  };
  return doc;
}

/** Every element under `root` (depth first) matching `pred`. */
function findAll(root, pred) {
  const out = [];
  (function walk(n) {
    n.childNodes.forEach((c) => {
      if (c.nodeType === 1) {
        if (pred(c)) out.push(c);
        walk(c);
      }
    });
  })(root);
  return out;
}

function byClass(root, cls) {
  return findAll(root, (e) => (' ' + e.className + ' ').includes(' ' + cls + ' '));
}

function byText(root, tag, text) {
  return findAll(root, (e) => e.tagName === tag.toUpperCase() && e.textContent === text);
}

module.exports = { createDocument, findAll, byClass, byText };
