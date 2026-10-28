import fs from 'node:fs/promises';
import path from 'node:path';
import { builtinModules } from 'node:module';
import ts from 'typescript';

const root = process.cwd();
const sourceRoot = path.join(root, 'src');
const violations = [];
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const filename = path.join(directory, entry.name);
        return entry.isDirectory()
          ? walk(filename)
          : /\.(ts|tsx)$/.test(filename)
            ? [filename]
            : [];
      }),
    )
  ).flat();
}

for (const filename of await walk(sourceRoot)) {
  const relative = path.relative(sourceRoot, filename).split(path.sep).join('/');
  const area = relative.split('/')[0];
  const source = ts.createSourceFile(
    filename,
    await fs.readFile(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  function checkImport(specifier, typeOnly) {
    const resolved = specifier.startsWith('.')
      ? path.resolve(path.dirname(filename), specifier)
      : '';
    const target = resolved ? path.relative(sourceRoot, resolved).split(path.sep)[0] : '';
    if (!typeOnly && area === 'client' && (target === 'server' || builtins.has(specifier))) {
      violations.push(`${relative}: forbidden client runtime import ${specifier}`);
    }
    if (area === 'server' && target === 'client') {
      violations.push(`${relative}: forbidden server import ${specifier}`);
    }
    if (
      area === 'shared' &&
      (target === 'server' || target === 'client' || builtins.has(specifier))
    ) {
      violations.push(`${relative}: shared contract must be platform independent: ${specifier}`);
    }
  }
  function visit(node) {
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      checkImport(node.argument.literal.text, true);
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      checkImport(node.moduleReference.expression.text, node.isTypeOnly);
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const allTypes =
        clause?.namedBindings &&
        ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.length > 0 &&
        clause.namedBindings.elements.every((item) => item.isTypeOnly);
      checkImport(node.moduleSpecifier.text, clause?.isTypeOnly || (!clause?.name && allTypes));
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const allTypes =
        node.exportClause &&
        ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.length > 0 &&
        node.exportClause.elements.every((item) => item.isTypeOnly);
      checkImport(node.moduleSpecifier.text, node.isTypeOnly || allTypes);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) checkImport(argument.text, false);
      else
        violations.push(
          `${relative}: non-literal module imports require an explicit boundary design`,
        );
    }
    if (
      area === 'shared' &&
      ts.isPropertyAccessExpression(node) &&
      ['process.env', 'import.meta.env', 'window.localStorage', 'globalThis.localStorage'].includes(
        node.getText(source),
      )
    ) {
      violations.push(`${relative}: shared contract reads runtime state`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Import boundaries: passed');
}
