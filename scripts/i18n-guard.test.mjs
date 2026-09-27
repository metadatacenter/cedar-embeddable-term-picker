/**
 * Fails when a string an author would read bypasses the translation files.
 *
 * Every user-visible string of the picker is stated in `src/assets/i18n`. A string written straight
 * into a template or passed straight to a message is English in every language, and nothing else
 * notices: the Hungarian file stays complete and the parity test stays green. This scan is what
 * notices.
 *
 * The rules, identical across the CEDAR frontends:
 *
 * 1. Every component template is scanned: the `.html` files and the inline `template:` strings of
 *    the `.ts` files under `src/app`, leaving out specs and test fixtures.
 * 2. A text node is a finding when it still holds a letter once its `{{ … }}` interpolations, its
 *    comments and its entities are removed. The Angular template parser does the removing, so the
 *    scan sees what the compiler sees.
 * 3. A static attribute is a finding when it holds literal text with a letter and is one of
 *    `aria-label`, `aria-description`, `aria-placeholder`, `aria-roledescription`, `title`,
 *    `placeholder`, `alt`, `label` or `matTooltip`. The same holds for their bound forms, including
 *    `[attr.…]`: an interpolated value is a finding when the text around its interpolations has a
 *    letter, and a bound expression is a finding when it can produce a string literal with a letter
 *    that does not pass through the `translate` pipe.
 * 4. In TypeScript, a string literal with a letter is a finding when it reaches one of the sinks
 *    listed in `SINKS` below.
 * 5. `i18n-allowlist.json` at the repository root lists the deliberate exceptions, each with a
 *    reason. A finding it does not list fails, and so does an entry that matches nothing, so the
 *    list cannot outlive what it excuses.
 *
 * One rule goes beyond that shared set, and is its own test so it can be told apart: a string
 * literal with a letter inside a text interpolation, such as `{{ open ? 'done' : 'narrow to…' }}`,
 * is as English as the text around it, and rule 2 alone does not see it.
 *
 * `CETP_I18N_ROOT` points the scan at another checkout, which is how a count is taken of a tree
 * the translation work has not reached.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as ng from '@angular/compiler';

const REPOSITORY = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = process.env.CETP_I18N_ROOT ?? REPOSITORY;
const SOURCE = join(ROOT, 'src', 'app');
const ALLOWLIST = join(REPOSITORY, 'i18n-allowlist.json');

/** Any Unicode letter. A string of digits, punctuation, symbols and spaces says nothing to translate. */
const LETTER = /\p{L}/u;

/** Attributes whose value is read to the author or shown on hover. Compared without case. */
const ATTRIBUTES = new Set(
  [
    'aria-label',
    'aria-description',
    'aria-placeholder',
    'aria-roledescription',
    'title',
    'placeholder',
    'alt',
    'label',
    'matTooltip',
  ].map((name) => name.toLowerCase()),
);

/** The pipe whose input is a translation key rather than text. */
const TRANSLATION_PIPE = 'translate';

/**
 * Where a string literal in TypeScript reaches the author, in this repository.
 *
 * Each is a place the picker has put, or would put, text on screen. A literal anywhere else is not
 * a finding: most are identifiers, keys or diagnostics.
 */
const SINKS = {
  /**
   * Arguments of an error being constructed. The terminology client reports by throwing, and the
   * picker shows what it threw.
   */
  errorConstructors: /Error$/,
  /**
   * The value written to a signal the templates show as a message, through `.set(…)`. Named by the
   * signal, which is what the template reads.
   */
  messageSignals: /(error|problem|message|notice|status|warning)$/i,
  /** The fallback a failure is shown as when it carries no message of its own. */
  fallbackFunctions: new Set(['messageOf']),
  /**
   * Any position the type checker says expects a `Message`, the picker's type for text shown to
   * the author: a return from a function that reports one, an argument to a parameter that takes
   * one, a property of a type that holds one. A key is a `string` passed to `phrase()`, so it is not
   * in such a position; a literal that is, is English passed off as a message.
   */
  messagePositions: true,
  /** Object properties that hold text for the author. */
  properties: new Set([
    'label',
    'title',
    'message',
    'placeholder',
    'ariaLabel',
    'summary',
    'tooltip',
    'description',
    'reason',
  ]),
};

function sourceFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!/^(fixtures?|__fixtures__|testing)$/.test(entry.name)) {
        found.push(...sourceFiles(path));
      }
    } else if (/\.(html|ts)$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found.sort();
}

function display(file) {
  return relative(ROOT, file).split(sep).join('/');
}

/** The line a character offset falls on, counting from one. */
function lineAt(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

/**
 * The string literals an expression can evaluate to, where they would be shown.
 *
 * A literal compared against, passed to a function, or used as a key is not shown, so only the
 * positions whose value becomes the expression's value are followed. A literal handed to the
 * `translate` pipe is a key, and so is not text; its parameters are followed, since they are
 * shown inside the translation.
 */
function shownLiterals(ast) {
  if (ast === null || ast === undefined) return [];
  if (ast instanceof ng.ASTWithSource) return shownLiterals(ast.ast);
  if (ast instanceof ng.Interpolation) return ast.expressions.flatMap(shownLiterals);
  if (ast instanceof ng.LiteralPrimitive) return typeof ast.value === 'string' ? [ast.value] : [];
  if (ast instanceof ng.TemplateLiteral) return ast.elements.map((element) => element.text);
  if (ast instanceof ng.ParenthesizedExpression) return shownLiterals(ast.expression);
  if (ast instanceof ng.Conditional) return [...shownLiterals(ast.trueExp), ...shownLiterals(ast.falseExp)];
  if (ast instanceof ng.Binary) {
    return ['+', '||', '??', '&&'].includes(ast.operation)
      ? [...shownLiterals(ast.left), ...shownLiterals(ast.right)]
      : [];
  }
  if (ast instanceof ng.LiteralMap) return ast.values.flatMap(shownLiterals);
  if (ast instanceof ng.BindingPipe) {
    const parameters = ast.args.flatMap(shownLiterals);
    return ast.name === TRANSLATION_PIPE ? parameters : [...shownLiterals(ast.exp), ...parameters];
  }
  return [];
}

/** What one template holds that bypasses translation, by rule. */
function scanTemplate(template, file, offsetOf) {
  const findings = { text: [], attributes: [], interpolations: [] };
  const where = (span) => `${display(file)}:${offsetOf(span?.start?.offset ?? 0)}`;
  const parsed = ng.parseTemplate(template, file, { preserveWhitespaces: false });
  if (parsed.errors?.length) {
    throw new Error(`${display(file)} does not parse: ${parsed.errors.map((error) => error.msg).join('; ')}`);
  }

  const attributesOf = (node) => {
    for (const attribute of node.attributes ?? []) {
      if (ATTRIBUTES.has(attribute.name.toLowerCase()) && LETTER.test(attribute.value)) {
        findings.attributes.push({ file: display(file), text: attribute.value, at: where(attribute.sourceSpan) });
      }
    }
    for (const input of node.inputs ?? []) {
      if (!ATTRIBUTES.has(input.name.toLowerCase())) continue;
      const value = input.value instanceof ng.ASTWithSource ? input.value.ast : input.value;
      const texts =
        value instanceof ng.Interpolation
          ? [...value.strings, ...value.expressions.flatMap(shownLiterals)]
          : shownLiterals(value);
      for (const text of texts.filter((candidate) => LETTER.test(candidate))) {
        findings.attributes.push({ file: display(file), text, at: where(input.sourceSpan) });
      }
    }
  };

  class Visitor extends ng.TmplAstRecursiveVisitor {
    visitText(node) {
      const text = node.value.trim();
      if (LETTER.test(text)) findings.text.push({ file: display(file), text, at: where(node.sourceSpan) });
    }
    visitBoundText(node) {
      const interpolation = node.value instanceof ng.ASTWithSource ? node.value.ast : node.value;
      if (!(interpolation instanceof ng.Interpolation)) return;
      for (const piece of interpolation.strings.map((part) => part.trim()).filter((part) => LETTER.test(part))) {
        findings.text.push({ file: display(file), text: piece, at: where(node.sourceSpan) });
      }
      for (const literal of interpolation.expressions.flatMap(shownLiterals).filter((part) => LETTER.test(part))) {
        findings.interpolations.push({ file: display(file), text: literal, at: where(node.sourceSpan) });
      }
    }
    visitElement(node) {
      attributesOf(node);
      super.visitElement(node);
    }
    visitTemplate(node) {
      attributesOf(node);
      for (const attribute of node.templateAttrs ?? []) {
        if (ATTRIBUTES.has(attribute.name.toLowerCase()) && typeof attribute.value === 'string') {
          if (LETTER.test(attribute.value)) {
            findings.attributes.push({ file: display(file), text: attribute.value, at: where(attribute.sourceSpan) });
          }
        }
      }
      super.visitTemplate(node);
    }
  }

  const visitor = new Visitor();
  for (const node of parsed.nodes) node.visit(visitor);
  return findings;
}

/** The texts a TypeScript expression can evaluate to when it is a literal or built from literals. */
function literalTexts(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
  if (ts.isParenthesizedExpression(node)) return literalTexts(node.expression);
  if (ts.isConditionalExpression(node)) return [...literalTexts(node.whenTrue), ...literalTexts(node.whenFalse)];
  if (ts.isBinaryExpression(node)) {
    const kind = node.operatorToken.kind;
    const joins = [
      ts.SyntaxKind.PlusToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
      ts.SyntaxKind.AmpersandAmpersandToken,
    ];
    return joins.includes(kind) ? [...literalTexts(node.left), ...literalTexts(node.right)] : [];
  }
  return [];
}

function calleeName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return '';
}

/** Whether a contextual type admits a phrase: an object with a `key`, as `Message` does. */
function expectsMessage(checker, node) {
  const type = checker.getContextualType(node);
  if (type === undefined) return false;
  const constituents = type.isUnion() ? type.types : [type];
  return constituents.some(
    (constituent) => constituent.getProperty('key') !== undefined && constituent.getProperty('params') !== undefined,
  );
}

/** The inline templates of a TypeScript file, and what its code passes to a sink. */
function scanTypeScript(file, program) {
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  const text = source.text;
  const findings = { text: [], attributes: [], interpolations: [], code: [] };
  const report = (node, texts) => {
    for (const literal of texts.filter((candidate) => LETTER.test(candidate))) {
      findings.code.push({
        file: display(file),
        text: literal,
        at: `${display(file)}:${lineAt(text, node.getStart())}`,
      });
    }
  };

  const visit = (node) => {
    if (
      ts.isDecorator(node) &&
      ts.isCallExpression(node.expression) &&
      calleeName(node.expression.expression) === 'Component'
    ) {
      const [metadata] = node.expression.arguments;
      const template =
        metadata && ts.isObjectLiteralExpression(metadata)
          ? metadata.properties.find(
              (property) => ts.isPropertyAssignment(property) && property.name.getText(source) === 'template',
            )
          : undefined;
      const initializer = template?.initializer;
      if (initializer && (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer))) {
        const start = initializer.getStart() + 1;
        const inline = scanTemplate(initializer.text, file, (offset) => lineAt(text, start + offset));
        findings.text.push(...inline.text);
        findings.attributes.push(...inline.attributes);
        findings.interpolations.push(...inline.interpolations);
      }
      return;
    }
    if (ts.isNewExpression(node) && SINKS.errorConstructors.test(calleeName(node.expression))) {
      report(node, (node.arguments ?? []).flatMap(literalTexts));
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'set' &&
        SINKS.messageSignals.test(calleeName(callee.expression))
      ) {
        report(node, node.arguments.slice(0, 1).flatMap(literalTexts));
      }
      if (SINKS.fallbackFunctions.has(calleeName(callee))) {
        report(node, node.arguments.slice(1).flatMap(literalTexts));
      }
    }
    if (ts.isPropertyAssignment(node) && SINKS.properties.has(node.name.getText(source).replace(/^['"]|['"]$/g, ''))) {
      report(node, literalTexts(node.initializer));
    } else if (
      SINKS.messagePositions &&
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) &&
      expectsMessage(checker, node)
    ) {
      report(node, literalTexts(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/** One program over every scanned TypeScript file, so the checker can say what a position expects. */
function programOf(files) {
  const config = ts.getParsedCommandLineOfConfigFile(
    join(REPOSITORY, 'tsconfig.eslint.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      },
    },
  );
  return ts.createProgram(files, { ...config.options, noEmit: true });
}

function scan() {
  const all = { text: [], attributes: [], interpolations: [], code: [] };
  const files = sourceFiles(SOURCE);
  const program = programOf(files.filter((file) => file.endsWith('.ts')));
  for (const file of files) {
    const found = file.endsWith('.html')
      ? scanTemplate(readFileSync(file, 'utf8'), file, (offset) => lineAt(readFileSync(file, 'utf8'), offset))
      : scanTypeScript(file, program);
    for (const rule of Object.keys(all)) all[rule].push(...(found[rule] ?? []));
  }
  return all;
}

const allowlist = existsSync(ALLOWLIST) ? JSON.parse(readFileSync(ALLOWLIST, 'utf8')) : [];
const findings = scan();
const allowed = (finding) => allowlist.some((entry) => entry.file === finding.file && entry.text === finding.text);
const unlisted = (rule) =>
  findings[rule].filter((finding) => !allowed(finding)).map((f) => `${f.at}  ${JSON.stringify(f.text)}`);

test('every allow-list entry gives a reason', () => {
  assert.ok(Array.isArray(allowlist), 'i18n-allowlist.json holds an array');
  const unexplained = allowlist.filter(
    (entry) => typeof entry.file !== 'string' || typeof entry.text !== 'string' || !String(entry.reason ?? '').trim(),
  );
  assert.deepEqual(unexplained, []);
});

test('no template text bypasses translation', () => {
  assert.deepEqual(unlisted('text'), []);
});

test('no attribute an author reads bypasses translation', () => {
  assert.deepEqual(unlisted('attributes'), []);
});

test('no string passed to a user-facing sink bypasses translation', () => {
  assert.deepEqual(unlisted('code'), []);
});

test('no literal text inside a text interpolation bypasses translation', () => {
  assert.deepEqual(unlisted('interpolations'), []);
});

test('every allow-list entry still matches a finding', () => {
  const every = Object.values(findings).flat();
  const stale = allowlist.filter((entry) => !every.some((f) => f.file === entry.file && f.text === entry.text));
  assert.deepEqual(stale, []);
});

if (process.env.CETP_I18N_REPORT) {
  for (const [rule, found] of Object.entries(findings)) {
    console.log(`${rule}: ${found.length} findings, ${found.filter((finding) => !allowed(finding)).length} unlisted`);
    for (const finding of found) console.log(`  ${finding.at}  ${JSON.stringify(finding.text)}`);
  }
}
