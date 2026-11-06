// Read only explicit webpack module exports and imports; never infer from names.
function webpackModules(ast) {
  const modules = [];
  for (const statement of ast.body) {
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const item of declaration.declarations) {
      if (item.id.name !== "__webpack_modules__" || item.init?.type !== "ObjectExpression") continue;
      for (const property of item.init.properties) {
        const fn = property.value;
        if (fn?.type !== "FunctionExpression" || fn.params.length !== 3 ||
            fn.params.some((param) => param.type !== "Identifier")) continue;
        const [, exports, require] = fn.params;
        const identifiers = [];
        const functions = [];
        const imports = new Map();
        for (const statement of fn.body.body) {
          if (statement.type === "VariableDeclaration") {
            for (const binding of statement.declarations) {
              if (binding.id.type === "Identifier" && binding.init?.type === "CallExpression" &&
                  binding.init.callee.name === require.name && binding.init.arguments.length === 1 &&
                  typeof binding.init.arguments[0].value === "string") {
                imports.set(binding.id.name, binding.init.arguments[0].value);
              }
            }
          }
          const call = statement.type === "ExpressionStatement" ? statement.expression : null;
          if (call?.type !== "CallExpression" || call.callee.type !== "MemberExpression" || call.callee.computed ||
              call.callee.object.name !== require.name || call.callee.property.name !== "d" ||
              ![2, 3].includes(call.arguments.length) || call.arguments[0].name !== exports.name ||
              call.arguments[1].type !== "ObjectExpression") continue;
          for (const entry of call.arguments[1].properties) {
            if (entry.value?.type === "ArrowFunctionExpression" && entry.value.params.length === 0 &&
                entry.value.body.type === "Identifier") identifiers.push(entry.value.body);
          }
          if (call.arguments[2]?.type === "ObjectExpression") {
            for (const entry of call.arguments[2].properties) {
              if (entry.value?.type === "FunctionExpression" || entry.value?.type === "ArrowFunctionExpression") functions.push(entry.value);
            }
          }
        }
        modules.push({ id: property.key.name ?? property.key.value, fn, identifiers, functions, imports });
      }
    }
  }
  return modules;
}

function importedCallIdentity(modules, fn, callee) {
  if (callee?.type === "SequenceExpression" && callee.expressions.length === 2 &&
      callee.expressions[0].value === 0) callee = callee.expressions[1];
  if (callee?.type !== "MemberExpression" || callee.computed || callee.object.type !== "Identifier") return null;
  const owner = modules.find((module) => module.fn.start < fn.start && module.fn.end > fn.end);
  const imported = owner?.imports.get(callee.object.name);
  return imported ? `${imported}:${callee.property.name}` : null;
}

module.exports = { webpackModules, importedCallIdentity };
