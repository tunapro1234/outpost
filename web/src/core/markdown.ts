import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ breaks: true });

const ALLOWED_TAGS = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
];

// Allow ordinary relative links plus explicitly safe schemes. In particular,
// javascript: and data: never match this expression (for href or image src).
const SAFE_URI = /^(?:(?:https?|mailto|tel):|(?:[/?#.]|[^:/?#]+(?:[/?#]|$)))/i;

DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName !== "href" && data.attrName !== "src") return;
  const compact = data.attrValue.replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
  if (/^(?:javascript|data):/i.test(compact)) data.keepAttr = false;
});

export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["alt", "class", "href", "src", "title"],
    ALLOWED_URI_REGEXP: SAFE_URI,
    FORBID_TAGS: ["form", "math", "style", "svg"],
    FORBID_ATTR: ["style", "srcset", "xlink:href"],
  });
}
