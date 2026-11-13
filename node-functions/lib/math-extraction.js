/*
 * Mathematics helpers for the Gifted Brainz document extractor.
 *
 * The extractor deliberately keeps LaTeX as text between standard math
 * delimiters. That avoids lossy conversions and lets the browser render the
 * broad TeX syntax via MathJax after import. Office Math (OMML) and MathML are
 * translated to LaTeX here because they otherwise disappear when XML/HTML tags
 * are stripped from imported documents.
 */
function decodeXmlEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'")
    .replace(/&#(\d+);/g, (all, n) => { try { return String.fromCodePoint(Number(n)); } catch { return all; } })
    .replace(/&#x([0-9a-f]+);/gi, (all, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return all; } });
}

function localName(name) { return String(name || "").split(":").pop().toLowerCase(); }
function parseXmlTree(xml) {
  const root = { name: "__root__", attrs: {}, children: [] };
  const stack = [root];
  const tokens = String(xml || "").match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<[^>]+>|[^<]+/g) || [];
  for (const token of tokens) {
    if (token.startsWith("<!--") || token.startsWith("<?") || token.startsWith("<!")) continue;
    if (token.startsWith("</")) {
      const name = localName(/^<\/([^\s>]+)/.exec(token)?.[1]);
      for (let i = stack.length - 1; i > 0; i--) {
        if (localName(stack[i].name) === name) { stack.length = i; break; }
      }
      continue;
    }
    if (token.startsWith("<")) {
      const match = /^<([^\s/>]+)([\s\S]*?)\/?\s*>$/.exec(token);
      if (!match) continue;
      const name = match[1];
      const attrs = {};
      for (const a of match[2].matchAll(/([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) attrs[localName(a[1])] = decodeXmlEntities(a[3]);
      const node = { name, attrs, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!/\/\s*>$/.test(token)) stack.push(node);
      continue;
    }
    stack[stack.length - 1].children.push({ text: decodeXmlEntities(token) });
  }
  return root;
}
function nodeName(node) { return localName(node?.name); }
function childNodes(node, name) { return (node?.children || []).filter(c => !c.text && (!name || nodeName(c) === localName(name))); }
function firstChild(node, name) { return childNodes(node, name)[0] || null; }
function treeText(node) { return (node?.children || []).map(c => c.text !== undefined ? c.text : treeText(c)).join(""); }
function attrOnChild(node, childName, attr = "val") { return firstChild(node, childName)?.attrs?.[attr] || ""; }
function propertyValue(node, propertiesName, propertyName, attr = "val") {
  const props = firstChild(node, propertiesName);
  return firstChild(props, propertyName)?.attrs?.[attr] || "";
}
function texLiteral(value) {
  // In math mode these characters need escaping when they occur as literal text.
  return String(value || "").replace(/([%&#])/g, "\\$1");
}
function texDelimiter(value) {
  const s = String(value || "");
  if (!s) return ".";
  return ({ "{": "\\{", "}": "\\}", "|": "|", "‖": "\\|", "⌊": "\\lfloor", "⌋": "\\rfloor", "⌈": "\\lceil", "⌉": "\\rceil", "⟨": "\\langle", "⟩": "\\rangle" })[s] || s;
}

const NARY_TEX = { "∑":"\\sum", "∏":"\\prod", "∫":"\\int", "∬":"\\iint", "∭":"\\iiint", "∮":"\\oint", "∯":"\\oiint", "∰":"\\oiiint", "⋃":"\\bigcup", "⋂":"\\bigcap", "⋁":"\\bigvee", "⋀":"\\bigwedge", "⨁":"\\bigoplus", "⨂":"\\bigotimes", "⨄":"\\biguplus", "∐":"\\coprod" };
const ACCENT_TEX = { "̂":"\\hat", "̃":"\\tilde", "̇":"\\dot", "̈":"\\ddot", "⃛":"\\dddot", "⃗":"\\vec", "¯":"\\bar", "˙":"\\dot", "¨":"\\ddot", "´":"\\acute", "`":"\\grave", "˘":"\\breve", "ˇ":"\\check", "˚":"\\ring", "⃑":"\\vec" };

function convertOmmlNode(node) {
  if (!node) return "";
  if (node.text !== undefined) return texLiteral(node.text);
  const name = nodeName(node);
  const children = childNodes(node);
  const all = () => children.map(convertOmmlNode).join("");
  const part = (key) => convertOmmlNode(firstChild(node, key));
  const group = (value) => `{${value || ""}}`;
  switch (name) {
    case "omathpara": case "omath": case "e": case "r": case "num": case "den": case "sub": case "sup": case "deg": case "fName": case "fname": case "mr": case "box": case "phant": case "lim": case "funcpr": case "narypr": case "dpr": case "accpr": case "barpr": case "groupchrpr": case "mpr": case "mrow":
      return all();
    case "t":
      return texLiteral(treeText(node));
    case "f": {
      const num = part("num"), den = part("den"), type = attrOnChild(node, "fPr", "type");
      return type === "noBar" ? `${num}\\!/${den}` : type === "skw" ? `\\frac{${num}}{${den}}` : `\\frac{${num}}{${den}}`;
    }
    case "ssup": return `${part("e")}^{${part("sup")}}`;
    case "ssub": return `${part("e")}_{${part("sub")}}`;
    case "ssubsup": return `${part("e")}_{${part("sub")}}^{${part("sup")}}`;
    case "spre": return `{}_{${part("sub")}}^{${part("sup")}}${part("e")}`;
    case "rad": {
      const radicand = part("e"), degree = part("deg");
      return degree.trim() ? `\\sqrt[${degree}]{${radicand}}` : `\\sqrt{${radicand}}`;
    }
    case "d": {
      const begin = texDelimiter(propertyValue(node, "dPr", "begchr") || "(");
      const end = texDelimiter(propertyValue(node, "dPr", "endchr") || ")");
      const inner = part("e");
      return `\\left${begin}${inner}\\right${end}`;
    }
    case "nary": {
      const chr = propertyValue(node, "naryPr", "chr") || "∑";
      const op = NARY_TEX[chr] || texLiteral(chr);
      const sub = part("sub"), sup = part("sup"), e = part("e");
      return `${op}${sub ? `_{${sub}}` : ""}${sup ? `^{${sup}}` : ""} ${e}`;
    }
    case "func": {
      const fname = convertOmmlNode(firstChild(firstChild(node, "funcPr"), "fName")).trim(), e = part("e");
      const macro = ({ sin:"\\sin", cos:"\\cos", tan:"\\tan", cot:"\\cot", sec:"\\sec", csc:"\\csc", sinh:"\\sinh", cosh:"\\cosh", tanh:"\\tanh", log:"\\log", ln:"\\ln", lim:"\\lim", exp:"\\exp", max:"\\max", min:"\\min" })[fname.toLowerCase()] || `\\operatorname{${fname || "f"}}`;
      return `${macro}\\left(${e}\\right)`;
    }
    case "acc": {
      const chr = propertyValue(node, "accPr", "chr") || "̂", macro = ACCENT_TEX[chr] || "\\hat";
      return `${macro}{${part("e")}}`;
    }
    case "bar": {
      const pos = propertyValue(node, "barPr", "pos");
      return pos === "bot" ? `\\underline{${part("e")}}` : `\\overline{${part("e")}}`;
    }
    case "groupchr": {
      const chr = propertyValue(node, "groupChrPr", "chr"), pos = propertyValue(node, "groupChrPr", "pos");
      const macro = /⏟|︸/.test(chr) || pos === "bot" ? "\\underbrace" : "\\overbrace";
      return `${macro}{${part("e")}}`;
    }
    case "m": {
      const rows = childNodes(node, "mr").map(row => childNodes(row, "e").map(convertOmmlNode).join(" & "));
      return `\\begin{matrix}${rows.join(" \\\\ ")}\\end{matrix}`;
    }
    case "eqarr": {
      const rows = childNodes(node, "e").map(convertOmmlNode);
      return `\\begin{aligned}${rows.join(" \\\\ ")}\\end{aligned}`;
    }
    case "limlow": return `\\underset{${part("lim")}}{${part("e")}}`;
    case "limupp": return `\\overset{${part("lim")}}{${part("e")}}`;
    case "borderbox": return `\\boxed{${part("e")}}`;
    default:
      // Ignore formatting/property nodes but preserve any mathematical children.
      if (/^(?:rpr|fpr|sSupPr|sSubPr|sSubSupPr|radPr|ctrlPr|argPr|funcPr|naryPr|dPr|accPr|barPr|groupChrPr|mPr|eqArrPr|limLowPr|limUppPr|boxPr|phantPr)$/i.test(name)) return "";
      return all();
  }
}

export function ommlToLatex(xml) {
  const tree = parseXmlTree(xml);
  const findMath = (node) => {
    if (["omath", "omathpara"].includes(nodeName(node))) return node;
    for (const c of childNodes(node)) { const found = findMath(c); if (found) return found; }
    return null;
  };
  const math = findMath(tree) || tree;
  return convertOmmlNode(math).replace(/[\t ]+/g, " ").trim();
}

function convertMathmlNode(node) {
  if (!node) return "";
  if (node.text !== undefined) return texLiteral(node.text);
  const name = nodeName(node), kids = childNodes(node);
  const all = () => kids.map(convertMathmlNode).join("");
  const val = i => convertMathmlNode(kids[i]);
  switch (name) {
    case "math": case "mrow": case "mstyle": case "mphantom": case "mpadded": case "mtd": case "mtr": case "merror": case "semantics": case "mrow":
      return all();
    case "annotation": case "annotation-xml": return "";
    case "mi": case "mn": case "mo": case "mtext": case "ms":
      return texLiteral(treeText(node)).replace(/−/g, "-")
        .replace(/×|·|⋅/g, "\\times ").replace(/÷/g, "\\div ")
        .replace(/≤/g, "\\leq ").replace(/≥/g, "\\geq ").replace(/≠/g, "\\neq ")
        .replace(/≈/g, "\\approx ").replace(/≡/g, "\\equiv ").replace(/∝/g, "\\propto ")
        .replace(/∈/g, "\\in ").replace(/∉/g, "\\notin ").replace(/∪/g, "\\cup ").replace(/∩/g, "\\cap ")
        .replace(/∞/g, "\\infty ").replace(/∑/g, "\\sum ").replace(/∏/g, "\\prod ").replace(/∫/g, "\\int ")
        .replace(/π/g, "\\pi ").replace(/θ/g, "\\theta ").replace(/α/g, "\\alpha ").replace(/β/g, "\\beta ")
        .replace(/γ/g, "\\gamma ").replace(/δ/g, "\\delta ").replace(/ε/g, "\\epsilon ").replace(/λ/g, "\\lambda ")
        .replace(/μ/g, "\\mu ").replace(/ρ/g, "\\rho ").replace(/σ/g, "\\sigma ").replace(/τ/g, "\\tau ")
        .replace(/φ/g, "\\phi ").replace(/ω/g, "\\omega ").replace(/±/g, "\\pm ").replace(/∓/g, "\\mp ");
    case "mfrac": return `\\frac{${val(0)}}{${val(1)}}`;
    case "msqrt": return `\\sqrt{${all()}}`;
    case "mroot": return `\\sqrt[${val(1)}]{${val(0)}}`;
    case "msup": return `${val(0)}^{${val(1)}}`;
    case "msub": return `${val(0)}_{${val(1)}}`;
    case "msubsup": return `${val(0)}_{${val(1)}}^{${val(2)}}`;
    case "mover": {
      const accent = kids[1]?.attrs?.accent === "true", over = val(1);
      const macro = accent ? ({ "^":"\\hat", "~":"\\tilde", "˙":"\\dot", "¨":"\\ddot", "¯":"\\bar", "→":"\\vec" })[treeText(kids[1])] || "\\overline" : "\\overset";
      return accent ? `${macro}{${val(0)}}` : `\\overset{${over}}{${val(0)}}`;
    }
    case "munder": return kids[1]?.attrs?.accentunder === "true" ? `\\underline{${val(0)}}` : `\\underset{${val(1)}}{${val(0)}}`;
    case "munderover": return `\\underset{${val(1)}}{\\overset{${val(2)}}{${val(0)}}}`;
    case "mfenced": {
      const open = texDelimiter(node.attrs?.open ?? "("), close = texDelimiter(node.attrs?.close ?? ")");
      const seps = String(node.attrs?.separators ?? ",").split("");
      const body = kids.map(convertMathmlNode).reduce((out, item, i) => out + (i ? ` ${seps[Math.min(i - 1, seps.length - 1)] || ","} ` : "") + item, "");
      return `\\left${open}${body}\\right${close}`;
    }
    case "mtable": {
      const rows = childNodes(node, "mtr").map(row => childNodes(row, "mtd").map(convertMathmlNode).join(" & "));
      return `\\begin{matrix}${rows.join(" \\\\ ")}\\end{matrix}`;
    }
    case "mspace": return "\\,";
    default: return all();
  }
}
export function mathmlToLatex(xml) {
  const tree = parseXmlTree(xml);
  return convertMathmlNode(tree).replace(/[\t ]+/g, " ").trim();
}

const MATH_DELIMITERS = /(\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\n])+\$)/g;
const TEX_COMMAND = /\\(?:frac|dfrac|tfrac|binom|dbinom|tbinom|genfrac|stackrel|sqrt|sum|prod|int|iint|iiint|iiiint|oint|oiint|oiiint|lim|limsup|liminf|inf|sup|min|max|argmax|argmin|det|gcd|sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|arcsin|arccos|arctan|log|ln|lg|exp|Pr|Re|Im|ker|rank|dim|deg|mod|pmod|bmod|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|leq|le|geq|ge|neq|ne|approx|sim|simeq|cong|equiv|propto|parallel|perp|mid|nmid|ll|gg|infty|partial|nabla|forall|exists|nexists|in|notin|ni|subset|subseteq|subsetneq|supset|supseteq|supsetneq|cup|cap|setminus|emptyset|varnothing|therefore|because|land|lor|lnot|neg|implies|iff|to|mapsto|rightarrow|leftarrow|leftrightarrow|Rightarrow|Leftarrow|Leftrightarrow|Longrightarrow|Longleftarrow|longrightarrow|longleftarrow|longleftrightarrow|uparrow|downarrow|updownarrow|Uparrow|Downarrow|Updownarrow|hookrightarrow|hookleftarrow|twoheadrightarrow|twoheadleftarrow|rightharpoonup|rightharpoondown|leftharpoonup|leftharpoondown|xrightarrow|xleftarrow|xleftrightarrow|overline|underline|widehat|widetilde|overrightarrow|overleftarrow|overleftrightarrow|underleftarrow|underrightarrow|underleftrightarrow|overbrace|underbrace|hat|tilde|bar|vec|dot|ddot|dddot|acute|grave|breve|check|ring|text|textrm|textit|textbf|texttt|mathrm|mathbf|mathit|mathbb|mathcal|mathfrak|mathsf|mathscr|boldsymbol|pmb|operatorname\*|operatorname|boxed|cancel|bcancel|xcancel|color|textcolor|ce|pu|ang|degree|overset|underset|begin|end|left|right|displaystyle|textstyle|scriptstyle|scriptscriptstyle|limits|nolimits|ldots|cdots|vdots|ddots|dots|dotso|dotsc|dotsi|dotsm|dotsb|quad|qquad|enspace|thinspace|hspace|vspace|phantom|hphantom|vphantom|smash|mathstrut|strut|big|Big|bigg|Bigg|bigl|bigr|Bigl|Bigr|biggl|biggr|Biggl|Biggr|langle|rangle|lvert|rvert|lVert|rVert|lfloor|rfloor|lceil|rceil|vert|Vert|mid|sum|prod|coprod|bigcup|bigcap|bigsqcup|bigvee|bigwedge|bigoplus|bigotimes|oint|iint|iiint|iiiint|idotsint|angle|triangle|square|diamond|star|ast|oplus|ominus|otimes|oslash|odot|circ|bullet|cdot|times|div|pm|mp|le|ge|ne|gets|impliedby|iff|colon|coloncolon|over|choose|atop|substack|tag|notag|nonumber|href|url|htmlClass|htmlId|htmlStyle|htmlData|unicode|[A-Za-z]+\*?)(?![A-Za-z])/g;
const TWO_ARG = new Set(["frac","dfrac","tfrac","binom","dbinom","tbinom","overset","underset","stackrel","color","textcolor","href"]);
const OPTIONAL_ONE_ARG = new Set(["xrightarrow","xleftarrow","xleftrightarrow"]);
const SIX_ARG = new Set(["genfrac"]);
const BINARY_RELATION_COMMANDS = new Set(["leq","le","geq","ge","neq","ne","approx","sim","simeq","cong","equiv","propto","parallel","perp","mid","in","notin","ni","subset","subseteq","subsetneq","supset","supseteq","supsetneq","cup","cap","setminus","land","lor","implies","iff","to","mapsto","rightarrow","leftarrow","leftrightarrow","Rightarrow","Leftarrow","Leftrightarrow","Longrightarrow","longrightarrow"]);
const ONE_ARG = new Set(["sqrt","overline","underline","widehat","widetilde","overrightarrow","overleftarrow","overleftrightarrow","underleftarrow","underrightarrow","underleftrightarrow","overbrace","underbrace","vec","hat","tilde","bar","dot","ddot","dddot","acute","grave","breve","check","ring","text","textrm","textit","textbf","texttt","mathrm","mathbf","mathit","mathbb","mathcal","mathfrak","mathsf","mathscr","mathbbm","boldsymbol","pmb","operatorname","operatorname*","boxed","cancel","bcancel","xcancel","ce","pu","substack","pmod","phantom","hphantom","vphantom","smash","hspace","vspace","tag","href","url","unicode"]);
function readBalanced(source, start, open = "{", close = "}") {
  if (source[start] !== open) return start;
  let depth = 0, escaped = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (escaped) { escaped = false; continue; }
    if (c === "\\") { escaped = true; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return i + 1;
  }
  return start;
}
function findBareTexSpan(source, start, command, depth = 0) {
  let i = start + command.length;
  const name = command.slice(1);
  const functionCommands = new Set(["sin","cos","tan","cot","sec","csc","sinh","cosh","tanh","arcsin","arccos","arctan","log","ln","exp","max","min","det","gcd","operatorname","operatorname*"]);
  const largeOperators = new Set(["sum","prod","coprod","bigcup","bigcap","bigsqcup","bigvee","bigwedge","bigoplus","bigotimes","int","iint","iiint","iiiint","oint","oiint","oiiint","lim","limsup","liminf"]);
  const prefixCommands = new Set(["displaystyle","textstyle","scriptstyle","scriptscriptstyle","limits","nolimits","not","big","Big","bigg","Bigg"]);
  const skipSpace = () => { while (/\s/.test(source[i] || "") && i < source.length) i++; };
  const takeGroup = () => {
    skipSpace();
    if (source[i] === "{") { const end = readBalanced(source, i); if (end > i) i = end; }
  };
  if (name === "begin") {
    skipSpace();
    if (source[i] !== "{") return i;
    const envEnd = readBalanced(source, i); if (envEnd === i) return i;
    const env = source.slice(i + 1, envEnd - 1); i = envEnd;
    const close = `\\end{${env}}`, at = source.indexOf(close, i);
    return at >= 0 ? at + close.length : i;
  }
  if (name === "left") {
    let search = i, nesting = 1, right = -1;
    while (search < source.length) {
      const nextLeft = source.indexOf("\\left", search);
      const nextRight = source.indexOf("\\right", search);
      if (nextRight < 0) break;
      if (nextLeft >= 0 && nextLeft < nextRight) { nesting++; search = nextLeft + "\\left".length; continue; }
      nesting--; if (nesting === 0) { right = nextRight; break; }
      search = nextRight + "\\right".length;
    }
    if (right >= 0) {
      let end = right + "\\right".length;
      if (source[end] === "\\") { const delimiter = /^\\(?:[A-Za-z]+|.)/.exec(source.slice(end)); if (delimiter) end += delimiter[0].length; }
      else if (end < source.length) end++;
      for (let count = 0; count < 2 && (source[end] === "_" || source[end] === "^"); count++) {
        end++; while (/\s/.test(source[end] || "") && end < source.length) end++;
        if (source[end] === "{") { const subEnd = readBalanced(source, end); if (subEnd > end) end = subEnd; }
        else if (source[end]) end++;
      }
      return end;
    }
  }
  if (SIX_ARG.has(name)) { for (let arg = 0; arg < 6; arg++) takeGroup(); }
  else if (OPTIONAL_ONE_ARG.has(name)) { skipSpace(); if (source[i] === "[") { const optEnd = readBalanced(source, i, "[", "]"); if (optEnd > i) i = optEnd; } takeGroup(); }
  else if (TWO_ARG.has(name)) { takeGroup(); takeGroup(); }
  else if (ONE_ARG.has(name) || name === "sqrt" || name === "operatorname*") {
    skipSpace();
    if (name === "sqrt" && source[i] === "[") { const degreeEnd = readBalanced(source, i, "[", "]"); if (degreeEnd > i) i = degreeEnd; }
    takeGroup();
  } else if (!functionCommands.has(name) && !largeOperators.has(name) && !prefixCommands.has(name) && !BINARY_RELATION_COMMANDS.has(name)) {
    // Preserve package-defined and user-defined commands. Only absorb following
    // whitespace when an actual argument follows, so relation symbols can bind
    // to their right-hand operand without swallowing the spacing before it.
    const beforeSpace = i; skipSpace();
    let hasArg = false;
    if (source[i] === "[") { const optionEnd = readBalanced(source, i, "[", "]"); if (optionEnd > i) { i = optionEnd; hasArg = true; } }
    if (source[i] === "{") hasArg = true;
    if (hasArg) {
      let args = 0;
      while (args < 6) { const before = i; takeGroup(); if (i === before) break; args++; }
    } else i = beforeSpace;
  }
  // Preserve immediately attached scripts, such as \sqrt{x}_n or \overline{AB}^{2}.
  const consumeScripts = () => {
    for (let count = 0; count < 2; count++) {
      if (source[i] === "_" || source[i] === "^") {
        i++; skipSpace();
        if (source[i] === "{") { const end = readBalanced(source, i); if (end > i) i = end; }
        else if (source[i]) i++;
      }
    }
  };
  consumeScripts();
  const consumeAtom = (at, nesting = 0) => {
    if (nesting > 6) return at;
    let j = at; while (/\s/.test(source[j] || "") && j < source.length) j++;
    const atomStart = j;
    if (source[j] === "{") { const end = readBalanced(source, j); if (end > j) j = end; else return at; }
    else if (source[j] === "\\") {
      const m = /^\\([A-Za-z]+|.)/.exec(source.slice(j));
      if (!m) return at;
      TEX_COMMAND.lastIndex = 0;
      const recognised = TEX_COMMAND.test(m[0]);
      TEX_COMMAND.lastIndex = 0;
      if (!recognised) return at;
      j = findBareTexSpan(source, j, m[0], nesting + 1);
    } else if (/[0-9]/.test(source[j] || "")) {
      const num = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(source.slice(j)); j += num?.[0].length || 1;
    } else if (/[A-Za-z]/.test(source[j] || "")) {
      if (/[A-Za-z]/.test(source[j + 1] || "")) return at; // Do not absorb an English word after an operator.
      j++;
    } else if (/[\u0370-\u03ff\u2100-\u214f∞∂∇∑∏∫√]/.test(source[j] || "")) j++;
    else return at;
    while (j < source.length && (source[j] === "_" || source[j] === "^")) {
      j++; while (/\s/.test(source[j] || "") && j < source.length) j++;
      if (source[j] === "{") { const end = readBalanced(source, j); if (end > j) j = end; }
      else if (source[j]) j++;
    }
    // Include f(x) as an atom for common function notation.
    if (source[j] === "(" && (source.slice(atomStart, j).match(/^[A-Za-z]$/) || source[atomStart] === "\\")) {
      const end = readBalanced(source, j, "(", ")"); if (end > j) j = end;
    }
    return j;
  };
  // Functions commonly take a following atom: \sin x, \log_2 n, etc.
  if (functionCommands.has(name)) {
    const next = consumeAtom(i, depth + 1);
    if (next > i) i = next;
  }
  if (prefixCommands.has(name)) {
    const next = consumeAtom(i, depth + 1);
    if (next > i) i = next;
  }
  // A summation/integral is usually followed by its term, for example
  // \sum_{i=1}^n x_i. Include that term so it is typeset as one expression.
  if (largeOperators.has(name)) {
    const next = consumeAtom(i, depth + 1);
    if (next > i) i = next;
    // Capture the conventional differential after an integral term: \int_a^b f(x) dx.
    const differential = /^\s*d\s*(?:\\[A-Za-z]+|[A-Za-z])(?:\s*(?:\\[A-Za-z]+|[A-Za-z]))?/.exec(source.slice(i));
    if (differential && /\b(?:int|iint|iiint|iiiint|oint|oiint|oiiint)$/.test(name)) i += differential[0].length;
  }
  if (BINARY_RELATION_COMMANDS.has(name)) {
    const next = consumeAtom(i, depth + 1);
    if (next > i) i = next;
  }
  // Keep arithmetic/logical expressions together rather than leaving +, =, or
  // inequalities outside the MathJax span (\frac{a}{b}=\frac{c}{d}).
  const operatorCommand = /^\\(?:times|cdot|div|pm|mp|leq|le|geq|ge|neq|ne|approx|sim|simeq|cong|equiv|propto|parallel|perp|mid|in|notin|ni|subset|subseteq|subsetneq|supset|supseteq|supsetneq|cup|cap|setminus|land|lor|implies|iff|to|mapsto|rightarrow|leftarrow|leftrightarrow|Rightarrow|Leftarrow|Leftrightarrow|Longrightarrow|longrightarrow)(?![A-Za-z])/;
  for (let count = 0; count < 10; count++) {
    let j = i; while (/\s/.test(source[j] || "") && j < source.length) j++;
    const cmd = operatorCommand.exec(source.slice(j));
    const symbol = /^[+\-−=<>≤≥≠≈±∓×÷·∗⋅∝]/.exec(source.slice(j));
    const op = cmd?.[0] || symbol?.[0];
    if (!op) break;
    const nextAt = j + op.length;
    const atomEnd = consumeAtom(nextAt, depth + 1);
    if (atomEnd <= nextAt) break;
    i = atomEnd;
  }
  return Math.max(start + command.length, i);
}

function previousMathAtomStart(source, macroStart) {
  let end = macroStart;
  while (end > 0 && /\s/.test(source[end - 1])) end--;
  if (end <= 0) return macroStart;
  let start = end;
  const matchingOpen = (closeAt, closeChar, openChar) => {
    let depth = 0, escaped = false;
    for (let j = closeAt; j >= 0; j--) {
      const c = source[j];
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if (c === closeChar) depth++;
      else if (c === openChar && --depth === 0) return j;
    }
    return -1;
  };
  const last = source[end - 1];
  if (last === "}") { const p = matchingOpen(end - 1, "}", "{"); if (p >= 0) start = p; }
  else if (last === ")") { const p = matchingOpen(end - 1, ")", "("); if (p >= 0) start = p; }
  else if (last === "]") { const p = matchingOpen(end - 1, "]", "["); if (p >= 0) start = p; }
  else if (/[A-Za-z0-9]/.test(last)) {
    while (start > 0 && /[A-Za-z0-9]/.test(source[start - 1])) start--;
    const token = source.slice(start, end);
    if (/[A-Za-z]/.test(token) && token.length > 1) {
      if (start > 0 && source[start - 1] === "\\") start--;
      else if (!/^\d+$/.test(token)) return macroStart;
    }
  } else return macroStart;
  // Include any attached subscript/superscript and the variable it belongs to.
  let changed = true;
  while (changed && start > 0) {
    changed = false;
    let j = start; while (j > 0 && /\s/.test(source[j - 1])) j--;
    if (j > 0 && (source[j - 1] === "_" || source[j - 1] === "^")) {
      start = j - 1; changed = true;
      let k = start; while (k > 0 && /\s/.test(source[k - 1])) k--;
      let baseEnd = k, baseStart = k;
      if (k > 0 && source[k - 1] === "}") { const p = matchingOpen(k - 1, "}", "{"); if (p >= 0) baseStart = p; }
      else { while (baseStart > 0 && /[A-Za-z0-9]/.test(source[baseStart - 1])) baseStart--; if (baseStart > 0 && source[baseStart - 1] === "\\") baseStart--; }
      if (baseStart < baseEnd) start = baseStart;
    }
  }
  return start;
}

export function wrapBareLatexMath(value) {
  const source = String(value ?? "");
  // Do not inspect markup tags or already-delimited formula spans.
  return source.split(/(<[^>]+>)/g).map(part => {
    if (part.startsWith("<") && part.endsWith(">")) return part;
    const pieces = part.split(MATH_DELIMITERS);
    return pieces.map(piece => {
      if (/^(?:\\\(|\\\[|\$\$|\$)/.test(piece) && /(?:\\\)|\\\]|\$)$/.test(piece)) return piece;
      let out = "", i = 0;
      while (i < piece.length) {
        const tail = piece.slice(i);
        TEX_COMMAND.lastIndex = 0;
        const match = TEX_COMMAND.exec(tail);
        if (!match) { out += piece.slice(i); break; }
        const macroStart = i + match.index;
        const end = findBareTexSpan(piece, macroStart, match[0]);
        if (end <= macroStart) { out += piece.slice(i, macroStart) + match[0]; i = macroStart + match[0].length; continue; }
        const name = match[0].slice(1);
        let spanStart = macroStart;
        if (BINARY_RELATION_COMMANDS.has(name) || /[=<>≤≥≠≈+\-−±∓×÷·∗⋅]\s*$/.test(piece.slice(0, macroStart))) {
          const prior = previousMathAtomStart(piece, macroStart);
          if (prior < spanStart) spanStart = prior;
          const beforeAtom = piece.slice(0, spanStart).match(/(?:=|<|>|≤|≥|≠|≈|[+\-−±∓×÷·∗⋅])\s*$/);
          if (beforeAtom) {
            const priorOperatorStart = spanStart - beforeAtom[0].length;
            const priorLeft = previousMathAtomStart(piece, priorOperatorStart);
            if (priorLeft < spanStart) spanStart = priorLeft;
          }
        }
        out += piece.slice(i, spanStart);
        const expression = piece.slice(spanStart, end);
        out += `\\(${expression}\\)`;
        i = end;
        TEX_COMMAND.lastIndex = 0;
      }
      TEX_COMMAND.lastIndex = 0;
      return out;
    }).join("");
  }).join("");
}

function convertPlainMathNotation(value) {
  let out = String(value ?? "")
    .replace(/([A-Za-z0-9]+)<sub>\s*1\s*<\/sub>\s*<sub>\s*0\s*<\/sub>/gi, "$1<sub>10</sub>")
    .replace(/([A-Za-z0-9]+)<sub>\s*([0-9]+)\s*<\/sub>/gi, "$1<sub>$2</sub>")
    .replace(/\^\{([^{}\n]+)\}/g, "<sup>$1</sup>")
    .replace(/\^\(([^()\n]+)\)/g, "<sup>$1</sup>")
    .replace(/\^([+-]?\d+(?:\/\d+)?)/g, "<sup>$1</sup>")
    .replace(/([A-Za-z0-9])_\{([^{}\n]+)\}/g, "$1<sub>$2</sub>")
    .replace(/([A-Za-z0-9])_([A-Za-z0-9]+)/g, "$1<sub>$2</sub>")
    .replace(/\blog(\d+)/gi, "log<sub>$1</sub>");
  const sup = { "⁰":"0","¹":"1","²":"2","³":"3","⁴":"4","⁵":"5","⁶":"6","⁷":"7","⁸":"8","⁹":"9","⁻":"-","⁺":"+","⁼":"=","⁽":"(","⁾":")","ⁱ":"i","ⁿ":"n" };
  const sub = { "₀":"0","₁":"1","₂":"2","₃":"3","₄":"4","₅":"5","₆":"6","₇":"7","₈":"8","₉":"9","₋":"-","₊":"+","₌":"=","₍":"(","₎":")","ₐ":"a","ₑ":"e","ₕ":"h","ₖ":"k","ₗ":"l","ₘ":"m","ₙ":"n","ₚ":"p","ₛ":"s","ₜ":"t" };
  const supChars = new RegExp(`[${Object.keys(sup).join("") }]+`, "g");
  const subChars = new RegExp(`[${Object.keys(sub).join("") }]+`, "g");
  out = out.replace(supChars, run => `<sup>${[...run].map(ch => sup[ch]).join("")}</sup>`);
  out = out.replace(subChars, run => `<sub>${[...run].map(ch => sub[ch]).join("")}</sub>`);
  return out;
}

export function normaliseImportedMathMarkup(value) {
  const source = String(value ?? "")
    .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .replace(/([A-Za-z0-9]+)<sub>\s*1\s*<\/sub>\s*<sub>\s*0\s*<\/sub>/gi, "$1<sub>10</sub>");
  const prepared = wrapBareLatexMath(source);
  return prepared.split(MATH_DELIMITERS).map(piece => {
    if (/^(?:\\\(|\\\[|\$\$|\$)/.test(piece) && /(?:\\\)|\\\]|\$)$/.test(piece)) return piece;
    return convertPlainMathNotation(piece);
  }).join("");
}
